// Métadonnées de la station en cours. Module Node pur (testable hors Electron).
//  - Station RadioKing (Radio Choco) : piste en cours + historique via l'API widget, sans ouvrir le flux.
//  - Autres stations : titre ICY lu sur le flux (seulement pendant la lecture), pochette via iTunes,
//    historique construit localement au fil des changements de titre.
import { lookupArtwork, NoIcyError, readIcyTitle, splitStreamTitle } from "./icy.js";
import type { Station } from "./station.js";

export interface Track {
	title: string;
	artist: string;
	album: string;
	cover: string;
	startedAt: number; // ms epoch (0 si inconnu)
	endAt: number; // ms epoch (0 si inconnu)
	duration: number; // s
	isLive: boolean;
	buyLink: string;
}

type Raw = Record<string, unknown>;

// RadioKing renvoie « +0000 » (sans deux-points) pour la piste en cours : on normalise pour Date.parse.
const parseDate = (s: unknown) => {
	if (typeof s !== "string" || !s) return 0;
	const iso = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : 0;
};

function toTrack(r: Raw): Track {
	return {
		title: String(r.title ?? ""),
		artist: String(r.artist ?? ""),
		album: r.album ? String(r.album) : "",
		cover: String(r.cover ?? r.cover_url ?? ""),
		startedAt: parseDate(r.started_at),
		endAt: parseDate(r.end_at),
		duration: Number(r.duration ?? 0),
		isLive: !!r.is_live,
		buyLink: String(r.buy_link ?? ""),
	};
}

export async function fetchCurrent(api: string): Promise<Track | null> {
	const res = await fetch(`${api}/track/current`, { signal: AbortSignal.timeout(6000) });
	if (!res.ok) throw new Error(`RadioKing HTTP ${res.status}`);
	const r = (await res.json()) as Raw;
	return r && r.title ? toTrack(r) : null;
}

export async function fetchHistory(api: string, limit = 6): Promise<Track[]> {
	const res = await fetch(`${api}/track/ckoi?limit=${limit}`, { signal: AbortSignal.timeout(6000) });
	if (!res.ok) throw new Error(`RadioKing HTTP ${res.status}`);
	const list = (await res.json()) as Raw[];
	return (Array.isArray(list) ? list : []).filter((r) => r.type === undefined || r.type === "music").map(toTrack);
}

// Titres ICY qui ne sont pas des morceaux (jingles, pubs, nom de la station…).
const NOT_A_SONG = /^(pub|publicit|jingle|advert|commercial|en direct|live|unknown|inconnu)/i;

export class MetadataPoller {
	current: Track | null = null;
	history: Track[] = [];
	error = "";
	/** false tant qu'on n'a jamais obtenu de titre pour la station ICY en cours */
	hasMetadata = false;
	private station: Station | null = null;
	private active = false; // lecture en cours (le flux ICY n'est ouvert que dans ce cas)
	private noIcy = false;
	private timer: NodeJS.Timeout | null = null;
	private gen = 0; // invalide les réponses tardives après un changement de station
	private lastIcy = "";

	constructor(private onChange: () => void) {}

	setStation(st: Station): void {
		this.station = st;
		this.gen++;
		this.current = null;
		this.history = [];
		this.error = "";
		this.hasMetadata = !!st.radioking;
		this.noIcy = st.hls; // pas d'ICY dans un flux HLS
		this.lastIcy = "";
		this.onChange();
		this.schedule(0);
	}

	/** Appelé à chaque changement d'état de lecture. */
	setActive(active: boolean): void {
		if (active === this.active) return;
		this.active = active;
		if (active && this.station && !this.station.radioking) this.schedule(300);
	}

	/** Force une mise à jour immédiate (ex. reprise de la lecture). */
	refresh(): void {
		this.schedule(0);
	}

	stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.station = null;
	}

	private schedule(ms: number): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.tick(), ms);
	}

	private async tick(): Promise<void> {
		const st = this.station;
		if (!st) return;
		const gen = this.gen;
		const delay = st.radioking ? await this.tickRadioKing(st.radioking, gen) : await this.tickIcy(st, gen);
		if (gen === this.gen && delay > 0) this.schedule(delay);
	}

	/** Renvoie le délai avant la prochaine interrogation (0 : en attente d'une reprise de lecture). */
	private async tickRadioKing(api: string, gen: number): Promise<number> {
		try {
			const t = await fetchCurrent(api);
			if (gen !== this.gen) return 0;
			const changed = !!t && (!this.current || t.title !== this.current.title || t.startedAt !== this.current.startedAt);
			this.current = t;
			const hadError = !!this.error;
			this.error = "";
			if (changed || !this.history.length) {
				try {
					// l'historique RadioKing inclut la piste en cours : on la retire
					const h = (await fetchHistory(api, 7)).filter((x) => !(t && x.title === t.title && x.artist === t.artist)).slice(0, 6);
					if (gen !== this.gen) return 0;
					this.history = h;
				} catch {
					/* historique facultatif */
				}
			}
			if (changed || hadError) this.onChange();
			return t?.endAt ? Math.min(30_000, Math.max(5_000, t.endAt - Date.now() + 2_000)) : 15_000;
		} catch (e) {
			if (gen !== this.gen) return 0;
			const msg = e instanceof Error ? e.message : String(e);
			if (msg !== this.error) {
				this.error = msg;
				this.onChange();
			}
			return 10_000;
		}
	}

	private async tickIcy(st: Station, gen: number): Promise<number> {
		if (!this.active) return 0; // on n'ouvre pas de connexion quand la radio est coupée
		if (this.noIcy) return st.hls ? 0 : 120_000; // retente rarement : certains serveurs varient
		try {
			const raw = await readIcyTitle(st.stream);
			if (gen !== this.gen) return 0;
			if (raw === this.lastIcy) return 15_000;
			this.lastIcy = raw;
			const clean = raw.trim();
			const sameAsStation = clean.toLowerCase() === st.name.toLowerCase();
			if (!clean || sameAsStation || NOT_A_SONG.test(clean)) {
				if (this.current) {
					this.pushHistory(this.current);
					this.current = null;
					this.onChange();
				}
				return 15_000;
			}
			const { artist, title } = splitStreamTitle(clean);
			if (this.current) this.pushHistory(this.current);
			this.current = { title, artist, album: "", cover: "", startedAt: Date.now(), endAt: 0, duration: 0, isLive: true, buyLink: "" };
			this.hasMetadata = true;
			this.onChange();
			const track = this.current;
			void lookupArtwork(artist, title).then((art) => {
				if (!art || gen !== this.gen) return;
				Object.assign(track, { cover: art.cover, album: art.album, buyLink: art.buyLink, duration: art.duration });
				this.onChange();
			});
			return 15_000;
		} catch (e) {
			if (gen !== this.gen) return 0;
			if (e instanceof NoIcyError) {
				this.noIcy = true;
				return 120_000;
			}
			return 20_000; // réseau : la lecture a sa propre gestion d'erreur, on reste discret
		}
	}

	private pushHistory(t: Track): void {
		if (!t.title) return;
		this.history = [t, ...this.history.filter((h) => !(h.title === t.title && h.artist === t.artist))].slice(0, 6);
	}
}
