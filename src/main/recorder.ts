// Enregistrement du flux : copie brute des octets diffusés (aucun réencodage, qualité d'origine).
// Connexion séparée du lecteur, sans métadonnées ICY (le fichier ne contient que l'audio).
// Module Node pur (testable hors Electron).
import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
import { openStream } from "./httpstream.js";

export interface RecordingInfo {
	active: boolean;
	startedAt: number; // ms epoch
	bytes: number;
	/** nom prévu (ou final, une fois l'enregistrement terminé) */
	file: string;
	error: string;
}

/** Nom de fichier sûr pour macOS (pas de « / » ni « : », longueur raisonnable). */
export function safeName(s: string): string {
	return (
		s
			.replace(/[\u0000-\u001f\u007f]/g, "")
			.replace(/[/\\]/g, "-")
			.replace(/:/g, " -")
			.replace(/["<>|?*]/g, "")
			.replace(/\s+/g, " ")
			.replace(/^[.\s-]+|[.\s]+$/g, "")
			.slice(0, 150)
			.trim() || "Enregistrement"
	);
}

const stamp = (t: number) => {
	const d = new Date(t);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
};

/** « Artiste - Titre (Station, 2026-09-29 14h48) », ou « Station 2026-09-29 14h48 » sans titre. */
export function recordingName(opts: { artist?: string; title?: string; station: string; startedAt: number }): string {
	const song = [opts.artist, opts.title].filter((x) => x && x.trim()).join(" - ");
	return safeName(song ? `${song} (${opts.station}, ${stamp(opts.startedAt)})` : `${opts.station} ${stamp(opts.startedAt)}`);
}

export function extensionFor(contentType: string, codec: string): string {
	const ct = contentType.toLowerCase();
	if (/mpeg|mp3/.test(ct)) return "mp3";
	if (/aac|mp4a/.test(ct)) return "aac";
	if (/ogg|opus|vorbis/.test(ct)) return /opus/.test(ct) ? "opus" : "ogg";
	if (/flac/.test(ct)) return "flac";
	const c = codec.toUpperCase();
	if (c.startsWith("AAC")) return "aac";
	if (c === "OGG") return "ogg";
	if (c === "FLAC") return "flac";
	return "mp3";
}

/** Chemin libre : « nom.ext », sinon « nom (2).ext »… */
export function uniquePath(dir: string, base: string, ext: string): string {
	let p = path.join(dir, `${base}.${ext}`);
	for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i}).${ext}`);
	return p;
}

/**
 * Un enregistrement en cours. Écrit dans un fichier « .part » puis le renomme à l'arrêt
 * (le nom final reprend le premier titre connu). Reconnexion automatique si le flux coupe.
 */
export class Recording {
	readonly startedAt = Date.now();
	bytes = 0;
	error = "";
	finalPath = "";
	private out: fs.WriteStream | null = null;
	private partPath = "";
	private ext = "mp3";
	private sock: net.Socket | null = null;
	private stopped = false;
	private retries = 0;
	private firstSong: { artist: string; title: string } | null = null;

	constructor(
		private readonly stream: string,
		private readonly station: { name: string; codec: string },
		private readonly dir: string,
		song: { artist: string; title: string } | null,
		private readonly onChange: () => void,
	) {
		if (song?.title) this.firstSong = song;
	}

	get plannedName(): string {
		return `${recordingName({ ...this.firstSong, station: this.station.name, startedAt: this.startedAt })}.${this.ext}`;
	}

	/** Premier titre annoncé après le début (si l'enregistrement a commencé sans titre). */
	noteSong(song: { artist: string; title: string } | null): void {
		if (!this.firstSong && song?.title) {
			this.firstSong = song;
			this.onChange();
		}
	}

	async start(): Promise<void> {
		fs.mkdirSync(this.dir, { recursive: true });
		await this.connect();
	}

	private async connect(): Promise<void> {
		try {
			const { sock, contentType, head } = await openStream(this.stream);
			if (this.stopped) {
				sock.destroy();
				return;
			}
			if (!this.partPath) this.ext = extensionFor(contentType, this.station.codec);
			this.sock = sock;
			this.retries = 0;
			this.error = "";
			const write = (b: Buffer) => {
				if (!b.length || this.stopped) return;
				// fichier créé au premier octet reçu : pas de fichier vide si le flux ne répond pas
				if (!this.out) {
					this.partPath = uniquePath(this.dir, `.${safeName(this.station.name)} ${this.startedAt}`, `${this.ext}.part`);
					this.out = fs.createWriteStream(this.partPath);
					this.out.on("error", (e) => {
						this.error = e.message;
						void this.stop();
					});
				}
				this.bytes += b.length;
				// contre-pression : si le disque suit mal, on met la socket en pause
				if (!this.out.write(b)) {
					sock.pause();
					this.out.once("drain", () => sock.resume());
				}
			};
			write(head);
			sock.on("data", write);
			sock.once("close", () => {
				if (this.sock === sock) this.sock = null;
				if (!this.stopped) this.reconnect("Flux interrompu");
			});
			sock.on("error", () => undefined); // « close » suit toujours
			sock.resume();
			this.onChange();
		} catch (e) {
			if (!this.stopped) this.reconnect(e instanceof Error ? e.message : String(e));
		}
	}

	private reconnect(reason: string): void {
		this.error = reason;
		this.onChange();
		if (this.retries++ >= 6) {
			void this.stop();
			return;
		}
		setTimeout(() => !this.stopped && void this.connect(), Math.min(15_000, 1000 * 2 ** this.retries));
	}

	/** Arrête, ferme le fichier et le renomme. Renvoie le chemin final ("" si rien n'a été reçu). */
	async stop(): Promise<string> {
		if (this.stopped) return this.finalPath;
		this.stopped = true;
		this.sock?.destroy();
		this.sock = null;
		const out = this.out;
		this.out = null;
		if (out) await new Promise<void>((r) => out.end(r));
		if (!this.partPath || this.bytes === 0) return "";
		const base = recordingName({ ...this.firstSong, station: this.station.name, startedAt: this.startedAt });
		this.finalPath = uniquePath(this.dir, base, this.ext);
		try {
			fs.renameSync(this.partPath, this.finalPath);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.finalPath = this.partPath;
		}
		this.onChange();
		return this.finalPath;
	}

	info(): RecordingInfo {
		return { active: !this.stopped, startedAt: this.startedAt, bytes: this.bytes, file: this.finalPath ? path.basename(this.finalPath) : this.plannedName, error: this.error };
	}
}
