// Sonde de qualité d'un flux : en-têtes du serveur + analyse des premières trames audio réellement reçues
// (MP3, AAC/ADTS, Ogg Vorbis/Opus, FLAC). Module Node pur (testable hors Electron).
import { openStream } from "./httpstream.js";

export interface StreamInfo {
	/** « MP3 », « AAC », « HE-AAC », « Vorbis », « Opus », « FLAC » ou "" si inconnu */
	format: string;
	/** précision : « MPEG-1 Layer III », « AAC-LC »… */
	detail: string;
	/** débit mesuré sur les trames reçues (kb/s, 0 si inconnu) */
	bitrate: number;
	/** débit variable détecté sur l'échantillon */
	vbr: boolean;
	/** débit annoncé par le serveur (icy-br), kb/s */
	declaredBitrate: number;
	sampleRate: number;
	channels: string;
	contentType: string;
	server: string;
	host: string;
	secure: boolean;
	probedAt: number;
}

// ---------- MP3 ----------
const BR = {
	v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
	v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
	v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
	v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface Mp3Frame {
	version: number; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
	layer: number; // 1, 2, 3
	bitrate: number;
	sampleRate: number;
	mode: number;
	length: number;
}

function mp3Header(b: Uint8Array, i: number): Mp3Frame | null {
	if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
	const version = (b[i + 1] >> 3) & 3;
	const layerBits = (b[i + 1] >> 1) & 3;
	const brIdx = b[i + 2] >> 4;
	const srIdx = (b[i + 2] >> 2) & 3;
	if (version === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
	const layer = 4 - layerBits;
	const table = version === 3 ? (layer === 1 ? BR.v1l1 : layer === 2 ? BR.v1l2 : BR.v1l3) : layer === 1 ? BR.v2l1 : BR.v2l23;
	const bitrate = table[brIdx];
	const sampleRate = SR[version][srIdx];
	const pad = (b[i + 2] >> 1) & 1;
	const length =
		layer === 1
			? (Math.floor((12 * bitrate * 1000) / sampleRate) + pad) * 4
			: Math.floor(((layer === 3 && version !== 3 ? 72 : 144) * bitrate * 1000) / sampleRate) + pad;
	if (length < 24) return null;
	return { version, layer, bitrate, sampleRate, mode: b[i + 3] >> 6, length };
}

// ---------- AAC (ADTS) ----------
const AAC_SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
interface AdtsFrame {
	profile: number;
	sampleRate: number;
	channels: number;
	length: number;
}
function adtsHeader(b: Uint8Array, i: number): AdtsFrame | null {
	if (i + 7 > b.length || b[i] !== 0xff || (b[i + 1] & 0xf6) !== 0xf0) return null;
	const profile = b[i + 2] >> 6;
	const srIdx = (b[i + 2] >> 2) & 0xf;
	const channels = ((b[i + 2] & 1) << 2) | (b[i + 3] >> 6);
	const length = ((b[i + 3] & 3) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5);
	if (srIdx >= AAC_SR.length || length < 7) return null;
	return { profile, sampleRate: AAC_SR[srIdx], channels, length };
}

/** Trouve une suite d'au moins 3 trames enchaînées (évite les faux positifs dans les données). */
function chain<T extends { length: number }>(b: Uint8Array, parse: (b: Uint8Array, i: number) => T | null): T[] {
	for (let i = 0; i < Math.min(b.length, 8192); i++) {
		const first = parse(b, i);
		if (!first) continue;
		const frames: T[] = [first];
		let j = i + first.length;
		for (;;) {
			const f = parse(b, j);
			if (!f) break;
			frames.push(f);
			j += f.length;
		}
		if (frames.length >= 3) return frames;
	}
	return [];
}

const MODES = ["stéréo", "joint stéréo", "double mono", "mono"];

export function analyze(b: Uint8Array, contentType = ""): Pick<StreamInfo, "format" | "detail" | "bitrate" | "vbr" | "sampleRate" | "channels"> {
	const none = { format: "", detail: "", bitrate: 0, vbr: false, sampleRate: 0, channels: "" };
	const ct = contentType.toLowerCase();
	const ascii = Buffer.from(b.subarray(0, Math.min(b.length, 16384))).toString("latin1");

	// Ogg (Vorbis / Opus / FLAC)
	if (ascii.includes("OggS")) {
		const vi = ascii.indexOf("\x01vorbis");
		if (vi >= 0) {
			const d = Buffer.from(b.subarray(vi));
			const ch = d[11];
			const sr = d.readUInt32LE(12);
			const nominal = d.readInt32LE(20);
			return { format: "Vorbis", detail: "Ogg Vorbis", bitrate: nominal > 0 ? Math.round(nominal / 1000) : 0, vbr: true, sampleRate: sr, channels: ch === 1 ? "mono" : ch === 2 ? "stéréo" : `${ch} canaux` };
		}
		const oi = ascii.indexOf("OpusHead");
		if (oi >= 0) {
			const ch = b[oi + 9];
			return { format: "Opus", detail: "Ogg Opus", bitrate: 0, vbr: true, sampleRate: 48000, channels: ch === 1 ? "mono" : ch === 2 ? "stéréo" : `${ch} canaux` };
		}
		if (ascii.includes("\x7fFLAC")) return { ...none, format: "FLAC", detail: "Ogg FLAC" };
	}
	if (ascii.startsWith("fLaC")) {
		const d = Buffer.from(b);
		const sr = (d[18] << 12) | (d[19] << 4) | (d[20] >> 4);
		const ch = ((d[20] >> 1) & 7) + 1;
		return { ...none, format: "FLAC", detail: "FLAC", sampleRate: sr, channels: ch === 2 ? "stéréo" : ch === 1 ? "mono" : `${ch} canaux` };
	}

	// AAC en ADTS (essayé avant MP3 : même octet de synchronisation)
	const adts = chain(b, adtsHeader);
	if (adts.length) {
		const f = adts[0];
		const bytes = adts.reduce((n, x) => n + x.length, 0);
		const kbps = Math.round((bytes * 8 * f.sampleRate) / (1024 * adts.length) / 1000);
		// HE-AAC (SBR implicite) : l'ADTS annonce la moitié de la fréquence de sortie
		const he = f.sampleRate <= 24000 || /aacp/.test(ct);
		const profiles = ["AAC Main", "AAC-LC", "AAC SSR", "AAC LTP"];
		return {
			format: he ? "HE-AAC" : "AAC",
			detail: he ? "HE-AAC (AAC+)" : profiles[f.profile] ?? "AAC",
			bitrate: kbps,
			vbr: false, // la taille des trames AAC varie toujours (réservoir de bits) : pas d'indication fiable
			sampleRate: he && f.sampleRate <= 24000 ? f.sampleRate * 2 : f.sampleRate,
			channels: f.channels === 1 ? "mono" : f.channels === 2 ? "stéréo" : `${f.channels} canaux`,
		};
	}

	const mp3 = chain(b, mp3Header);
	if (mp3.length) {
		const f = mp3[0];
		const rates = new Set(mp3.map((x) => x.bitrate));
		const avg = Math.round(mp3.reduce((n, x) => n + x.bitrate, 0) / mp3.length);
		const v = f.version === 3 ? "MPEG-1" : f.version === 2 ? "MPEG-2" : "MPEG-2.5";
		return {
			format: f.layer === 3 ? "MP3" : `MP${f.layer}`,
			detail: `${v} Layer ${"I".repeat(f.layer)}`,
			bitrate: avg,
			vbr: rates.size > 1,
			sampleRate: f.sampleRate,
			channels: MODES[f.mode],
		};
	}
	return none;
}

/** Ouvre le flux quelques instants et renvoie ce qu'il transporte réellement. */
export async function probeStream(url: string, bytes = 24_000, timeoutMs = 8000): Promise<StreamInfo> {
	const { sock, contentType, headers, head, url: finalUrl } = await openStream(url, { deadline: timeoutMs });
	const data = await new Promise<Buffer>((resolve) => {
		let buf = head;
		const done = () => {
			clearTimeout(timer);
			sock.destroy();
			resolve(buf);
		};
		const timer = setTimeout(done, timeoutMs);
		sock.on("data", (c: Buffer) => {
			buf = Buffer.concat([buf, c]);
			if (buf.length >= bytes) done();
		});
		sock.once("close", done);
		sock.on("error", () => undefined);
		sock.resume();
	});
	const u = new URL(finalUrl);
	return {
		...analyze(data, contentType),
		declaredBitrate: Number.parseInt(headers.get("icy-br") ?? "", 10) || 0,
		contentType,
		server: headers.get("server") ?? headers.get("icy-notice2")?.replace(/<br>/gi, "").trim() ?? "",
		host: u.hostname,
		secure: u.protocol === "https:",
		probedAt: Date.now(),
	};
}
