// Catalogue Radio Browser (https://api.radio-browser.info) — base communautaire ouverte, sans clé.
// Module Node pur (testable hors Electron). Bonnes pratiques de l'API respectées :
// User-Agent explicite, découverte des serveurs miroirs, signalement du clic à la lecture.
import { type Station, USER_AGENT } from "./station.js";

export type Scope = "FR" | "ALL";

export type StationQuery =
	| { kind: "top"; scope: Scope; offset?: number }
	| { kind: "search"; scope: Scope; value: string; offset?: number }
	| { kind: "tag"; scope: Scope; value: string; offset?: number }
	| { kind: "state"; value: string; offset?: number } // région française
	| { kind: "country"; value: string; offset?: number }; // code ISO du pays

export interface QueryResult {
	stations: Station[];
	hasMore: boolean;
}

export interface Area {
	/** valeur à passer à la requête (nom de région ou code pays) */
	value: string;
	label: string;
	count: number;
}

const PAGE = 60;
const FALLBACK_SERVERS = ["de1.api.radio-browser.info", "de2.api.radio-browser.info", "fi1.api.radio-browser.info"];

type Raw = Record<string, unknown>;

let servers: string[] | null = null;
let serversAt = 0;

async function getServers(): Promise<string[]> {
	if (servers && Date.now() - serversAt < 6 * 3600_000) return servers;
	try {
		const res = await fetch("https://all.api.radio-browser.info/json/servers", {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(5000),
		});
		const list = ((await res.json()) as Raw[]).map((s) => String(s.name ?? "")).filter((n) => n.endsWith(".api.radio-browser.info"));
		const uniq = [...new Set(list)].sort(() => Math.random() - 0.5); // répartit la charge entre miroirs
		servers = uniq.length ? uniq : FALLBACK_SERVERS;
	} catch {
		servers = FALLBACK_SERVERS;
	}
	serversAt = Date.now();
	return servers;
}

/** Appelle l'API sur le premier miroir qui répond ; le miroir fautif passe en fin de liste. */
async function rb<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
	const list = await getServers();
	let last: unknown;
	for (const host of [...list]) {
		try {
			const res = await fetch(`https://${host}${path}${qs.size ? `?${qs}` : ""}`, {
				headers: { "User-Agent": USER_AGENT },
				signal: AbortSignal.timeout(8000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return (await res.json()) as T;
		} catch (e) {
			last = e;
			servers = [...list.filter((h) => h !== host), host];
		}
	}
	throw new Error(`Radio Browser injoignable (${last instanceof Error ? last.message : String(last)})`);
}

const cap = (t: string) => t.replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

const JUNK_TAGS = new Set([
	"radio", "webradio", "web radio", "music", "musique", "fm", "france", "french", "aac", "aac+", "mp3", "ogg", "hls", "m3u8", "flac",
	"internet radio", "online radio", "radio locale", "local radio", "public radio", "radio france", "hd", "hq", "stereo",
]);
const isJunkTag = (t: string) => JUNK_TAGS.has(t) || /\d+\s*k(bps|b\/s)?$/.test(t) || t.length > 24;

export function toStation(r: Raw): Station {
	const tags = String(r.tags ?? "")
		.split(",")
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	const stream = String(r.url_resolved || r.url || "");
	const mainTag = tags.find((t) => !isJunkTag(t));
	const state = String(r.state ?? "").trim();
	const country = String(r.country ?? "").trim();
	const countrycode = String(r.countrycode ?? "");
	// à défaut de genre : la région (si renseignée proprement), puis le pays hors France
	const place = state && !/^(france|europe|world|none|aucun)$/i.test(state) && !/\d/.test(state) ? state : countrycode !== "FR" ? country : "";
	return {
		id: String(r.stationuuid),
		name: String(r.name ?? "").trim().replace(/\s{2,}/g, " "),
		subtitle: mainTag ? cap(mainTag) : place,
		stream,
		hls: Number(r.hls) === 1 || /\.m3u8(\?|$)/i.test(stream),
		favicon: /^https?:\/\//.test(String(r.favicon ?? "")) ? String(r.favicon) : "",
		homepage: /^https?:\/\//.test(String(r.homepage ?? "")) ? String(r.homepage) : "",
		tags,
		country,
		countrycode,
		state,
		codec: String(r.codec ?? "") === "UNKNOWN" ? "" : String(r.codec ?? ""),
		bitrate: Number(r.bitrate) || 0,
	};
}

/** Clé de dédoublonnage : la base contient souvent plusieurs fiches pour la même radio
 *  (« RTL2 » / « RTL 2 », « FIP » / « FIP (no pub) », « RMC » / « RMC FR »…). */
export function dedupeKey(s: Pick<Station, "name">): string {
	const base = s.name
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\(.*?\)|\[.*?\]/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\b(hq|hd|hifi|fm|radio)\b/g, " ")
		.trim();
	const words = base.split(/\s+/).filter(Boolean);
	if (words.length > 1 && /^(fr|france)$/.test(words[words.length - 1])) words.pop();
	return words.join("");
}

/** Garde la fiche la plus écoutée de chaque radio (la liste arrive triée par popularité). */
export function dedupe(list: Station[]): Station[] {
	const seen = new Set<string>();
	return list.filter((s) => {
		if (!s.stream || !s.name) return false;
		const k = dedupeKey(s) || s.id;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

export async function queryStations(q: StationQuery): Promise<QueryResult> {
	const offset = Math.max(0, q.offset ?? 0);
	const params: Record<string, string | number | undefined> = {
		// hors France, le compteur de clics est faussé par quelques stations très « cliquées » : les votes sont plus fiables
		order: "scope" in q && q.scope === "ALL" && q.kind === "top" ? "votes" : "clickcount",
		reverse: "true",
		hidebroken: "true",
		limit: PAGE,
		offset,
	};
	switch (q.kind) {
		case "top":
			if (q.scope === "FR") params.countrycode = "FR";
			break;
		case "search":
			params.name = q.value.trim();
			if (q.scope === "FR") params.countrycode = "FR";
			break;
		case "tag":
			params.tag = q.value;
			if (q.scope === "FR") params.countrycode = "FR";
			break;
		case "state": {
			// région aux variantes multiples : une requête par variante, résultats fusionnés
			const names = q.value.split("|").filter(Boolean);
			if (names.length > 1) {
				const parts = await Promise.all(names.map((n) => queryStations({ kind: "state", value: n, offset: q.offset })));
				return { stations: dedupe(parts.flatMap((p) => p.stations)), hasMore: parts.some((p) => p.hasMore) };
			}
			params.countrycode = "FR";
			params.state = names[0] ?? "";
			params.stateExact = "true";
			break;
		}
		case "country":
			params.countrycode = q.value;
			break;
	}
	const raw = await rb<Raw[]>("/json/stations/search", params);
	return { stations: dedupe(raw.map(toStation)), hasMore: raw.length === PAGE };
}

// Libellés parasites présents dans le champ « state » de la base pour la France.
const NOT_REGIONS = new Set(["france", "francecontinentale", "europe", "pangea", "world", "internet", "outsideus", "aucun", "none"]);
// Variantes d'écriture ramenées au libellé officiel.
const REGION_ALIASES: Record<string, string> = {
	paca: "Provence-Alpes-Côte d'Azur",
	iledefrance: "Île-de-France",
	hautsdefrance: "Hauts-de-France",
	breizhbretagne: "Bretagne",
	centre: "Centre-Val de Loire",
	reunion: "La Réunion",
	lareunion: "La Réunion",
};
const regionKey = (n: string) =>
	n
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z]/g, "");

/**
 * Régions françaises (et villes) telles que renseignées dans la base, par nombre de stations.
 * Les variantes d'une même région sont fusionnées ; `value` les liste toutes, séparées par « | ».
 */
export async function frenchRegions(): Promise<Area[]> {
	const raw = await rb<Raw[]>("/json/states/France/", { order: "stationcount", reverse: "true", hidebroken: "true" });
	const merged = new Map<string, { label: string; names: string[]; count: number }>();
	for (const r of raw) {
		const name = String(r.name ?? "").trim();
		const count = Number(r.stationcount) || 0;
		const clean = name.replace(/^[^\p{L}]+/u, "");
		const k = regionKey(clean);
		if (!k || NOT_REGIONS.has(k) || /\d|,/.test(clean)) continue;
		const label = REGION_ALIASES[k] ?? clean;
		const key = regionKey(label);
		const m = merged.get(key) ?? { label, names: [], count: 0 };
		m.names.push(name);
		m.count += count;
		// le libellé retenu est l'écriture officielle si on la connaît, sinon la plus fréquente (liste triée)
		merged.set(key, m);
	}
	return [...merged.values()]
		.filter((m) => m.count >= 3)
		.sort((a, b) => b.count - a.count)
		.map((m) => ({ value: m.names.join("|"), label: m.label, count: m.count }));
}

export async function countries(): Promise<Area[]> {
	const raw = await rb<Raw[]>("/json/countries", { order: "stationcount", reverse: "true", hidebroken: "true" });
	const names = new Intl.DisplayNames(["fr"], { type: "region" });
	return raw
		.filter((r) => /^[A-Z]{2}$/.test(String(r.iso_3166_1 ?? "")) && Number(r.stationcount) >= 20)
		.map((r) => {
			const code = String(r.iso_3166_1);
			let label = String(r.name ?? code);
			try {
				label = names.of(code) ?? label;
			} catch {
				/* code inconnu d'Intl */
			}
			return { value: code, label, count: Number(r.stationcount) || 0 };
		});
}

export async function stationById(id: string): Promise<Station | null> {
	const raw = await rb<Raw[]>("/json/stations/byuuid", { uuids: id });
	return raw[0] ? toStation(raw[0]) : null;
}

/** Signale l'écoute à Radio Browser (alimente le classement « populaires »). Sans effet sur la lecture. */
export function reportClick(id: string): void {
	if (!/^[0-9a-f-]{36}$/i.test(id)) return;
	void rb(`/json/url/${id}`).catch(() => undefined);
}
