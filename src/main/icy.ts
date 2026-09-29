// Titre en cours pour les flux Icecast/Shoutcast (métadonnées ICY) + pochette via l'API iTunes Search.
// Chromium n'expose pas les métadonnées ICY à <audio> : on ouvre une connexion courte à part,
// on lit le premier bloc de métadonnées, puis on referme (≈ 16 ko par interrogation).
import net from "node:net";
import tls from "node:tls";
import { USER_AGENT } from "./station.js";

export class NoIcyError extends Error {
	constructor() {
		super("Pas de métadonnées ICY sur ce flux");
	}
}

function decode(buf: Uint8Array): string {
	const utf8 = new TextDecoder("utf-8").decode(buf);
	// beaucoup de serveurs Shoutcast envoient du Latin-1 : on retombe dessus si l'UTF-8 est invalide
	return utf8.includes("�") ? new TextDecoder("latin1").decode(buf) : utf8;
}

export function parseStreamTitle(meta: string): string {
	const m = /StreamTitle='(.*?)';/s.exec(meta);
	return (m ? m[1] : "").replace(/\0+$/, "").trim();
}

/**
 * Renvoie le StreamTitle courant ("" si le flux n'annonce rien pour l'instant).
 * Lève NoIcyError si le serveur ne gère pas les métadonnées ICY.
 *
 * Socket brute en HTTP/1.0 plutôt que fetch : les vieux serveurs Shoutcast répondent « ICY 200 OK »,
 * que le parseur HTTP de Node refuse ; HTTP/1.0 garantit aussi une réponse non découpée (pas de chunked).
 */
export async function readIcyTitle(url: string, timeoutMs = 12_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let target = new URL(url);
	for (let hop = 0; hop < 4; hop++) {
		const r = await icyRequest(target, deadline);
		if (r.kind === "redirect") {
			target = new URL(r.location, target);
			continue;
		}
		return r.title;
	}
	throw new Error("Trop de redirections");
}

type IcyResult = { kind: "title"; title: string } | { kind: "redirect"; location: string };

function icyRequest(u: URL, deadline: number): Promise<IcyResult> {
	return new Promise((resolve, reject) => {
		const secure = u.protocol === "https:";
		if (!secure && u.protocol !== "http:") return reject(new Error(`Protocole non géré : ${u.protocol}`));
		const port = Number(u.port) || (secure ? 443 : 80);
		const sock: net.Socket = secure ? tls.connect({ host: u.hostname, port, servername: net.isIP(u.hostname) ? undefined : u.hostname }) : net.connect({ host: u.hostname, port });
		let done = false;
		const finish = (err: Error | null, res?: IcyResult) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			sock.destroy();
			if (err) reject(err);
			else resolve(res!);
		};
		const timer = setTimeout(() => finish(new Error("Délai dépassé")), Math.max(1000, deadline - Date.now()));
		sock.once(secure ? "secureConnect" : "connect", () => {
			sock.write(
				`GET ${u.pathname || "/"}${u.search} HTTP/1.0\r\nHost: ${u.host}\r\nUser-Agent: ${USER_AGENT}\r\nIcy-MetaData: 1\r\nAccept: */*\r\nConnection: close\r\n\r\n`,
			);
		});
		sock.on("error", (e) => finish(e));
		sock.on("close", () => finish(new Error("Flux interrompu")));

		let buf = Buffer.alloc(0);
		let metaint = -1; // -1 : en-têtes pas encore lus
		let pos = 0; // début du prochain bloc audio dans buf
		let blocks = 0;
		sock.on("data", (chunk: Buffer) => {
			buf = Buffer.concat([buf, chunk]);
			if (metaint < 0) {
				const end = buf.indexOf("\r\n\r\n");
				if (end < 0) {
					if (buf.length > 16_384) finish(new Error("En-têtes invalides"));
					return;
				}
				const lines = buf.subarray(0, end).toString("latin1").split("\r\n");
				const status = Number(/^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/i.exec(lines[0])?.[1] ?? 0);
				const headers = new Map<string, string>();
				for (const l of lines.slice(1)) {
					const i = l.indexOf(":");
					if (i > 0) headers.set(l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim());
				}
				if (status >= 300 && status < 400 && headers.get("location")) return finish(null, { kind: "redirect", location: headers.get("location")! });
				if (status !== 200) return finish(new Error(`HTTP ${status || "?"}`));
				const mi = Number(headers.get("icy-metaint"));
				if (!Number.isFinite(mi) || mi <= 0) return finish(new NoIcyError());
				metaint = mi;
				buf = buf.subarray(end + 4);
			}
			// Jusqu'à 2 blocs : certains serveurs envoient un bloc vide juste après la connexion.
			while (!done) {
				const lenAt = pos + metaint;
				if (buf.length <= lenAt) return;
				const len = buf[lenAt] * 16;
				if (buf.length < lenAt + 1 + len) return;
				if (len > 0) return finish(null, { kind: "title", title: parseStreamTitle(decode(buf.subarray(lenAt + 1, lenAt + 1 + len))) });
				if (++blocks >= 2) return finish(null, { kind: "title", title: "" });
				buf = buf.subarray(lenAt + 1);
				pos = 0;
			}
		});
	});
}

/** "Artiste - Titre" → { artist, title }. Sans séparateur, tout va dans title. */
export function splitStreamTitle(t: string): { artist: string; title: string } {
	const i = t.indexOf(" - ");
	if (i > 0) return { artist: t.slice(0, i).trim(), title: t.slice(i + 3).trim() };
	return { artist: "", title: t.trim() };
}

export interface Artwork {
	cover: string;
	album: string;
	buyLink: string;
	duration: number; // s
}

const artCache = new Map<string, Artwork | null>();

/** Pochette 600 px et lien Apple Music, cherchés par artiste + titre. null si rien de fiable. */
export async function lookupArtwork(artist: string, title: string): Promise<Artwork | null> {
	if (!artist || !title) return null;
	const key = `${artist}\n${title}`.toLowerCase();
	if (artCache.has(key)) return artCache.get(key)!;
	const clean = (s: string) => s.replace(/\(.*?\)|\[.*?\]|feat\..*$|ft\..*$/gi, "").trim();
	const term = encodeURIComponent(`${clean(artist)} ${clean(title)}`);
	let art: Artwork | null = null;
	try {
		const res = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=5&country=FR`, {
			signal: AbortSignal.timeout(6000),
		});
		const data = (await res.json()) as { results?: Record<string, unknown>[] };
		const norm = (s: unknown) =>
			String(s ?? "")
				.toLowerCase()
				.normalize("NFD")
				.replace(/[^a-z0-9]/g, "");
		const a = norm(clean(artist));
		// garde-fou : l'artiste renvoyé doit recouper celui annoncé par la radio
		const hit = (data.results ?? []).find((r) => {
			const ra = norm(r.artistName);
			return ra && a && (ra.includes(a) || a.includes(ra));
		});
		if (hit?.artworkUrl100) {
			art = {
				cover: String(hit.artworkUrl100).replace(/\/\d+x\d+bb\./, "/600x600bb."),
				album: String(hit.collectionName ?? ""),
				buyLink: String(hit.trackViewUrl ?? ""),
				duration: Math.round(Number(hit.trackTimeMillis ?? 0) / 1000),
			};
		}
	} catch {
		return null; // réseau : on retentera au prochain titre, sans mettre en cache
	}
	if (artCache.size > 300) artCache.clear();
	artCache.set(key, art);
	return art;
}
