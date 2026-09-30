// Données persistées dans ~/Library/Application Support/CariRadio : historique par station et morceaux aimés.
// Module Node pur (testable hors Electron) : on lui passe le dossier.
import fs from "node:fs";
import path from "node:path";
import type { Track } from "./radio.js";

class JsonFile<T> {
	private timer: NodeJS.Timeout | null = null;
	constructor(
		private readonly file: string,
		public data: T,
	) {
		try {
			this.data = JSON.parse(fs.readFileSync(file, "utf8")) as T;
		} catch {
			/* premier lancement ou fichier illisible : on repart de la valeur par défaut */
		}
	}
	save(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), 1000);
	}
	flush(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		try {
			fs.mkdirSync(path.dirname(this.file), { recursive: true });
			const tmp = `${this.file}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify(this.data));
			fs.renameSync(tmp, this.file); // écriture atomique
		} catch {
			/* non bloquant */
		}
	}
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
export const songKey = (t: { artist: string; title: string }) => `${norm(t.artist)}|${norm(t.title)}`;

// ---------- historique par station ----------
const PER_STATION = 50;
const MAX_STATIONS = 200;

export class HistoryStore {
	private f: JsonFile<Record<string, { at: number; tracks: Track[] }>>;
	constructor(dir: string) {
		this.f = new JsonFile(path.join(dir, "history.json"), {});
	}

	get(stationId: string): Track[] {
		return this.f.data[stationId]?.tracks ?? [];
	}

	/** Fusionne des titres (dédoublonnés : même morceau à moins de 3 min d'écart), du plus récent au plus ancien. */
	merge(stationId: string, tracks: Track[]): Track[] {
		const cur = this.get(stationId);
		const out = [...cur];
		let changed = false;
		for (const t of tracks) {
			if (!t?.title) continue;
			const k = songKey(t);
			const i = out.findIndex((x) => songKey(x) === k && Math.abs((x.startedAt || 0) - (t.startedAt || 0)) < 180_000);
			if (i >= 0) {
				// complète une entrée existante (pochette arrivée après coup, lien…)
				const merged = { ...out[i], ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== "" && v !== 0)) } as Track;
				if (JSON.stringify(merged) !== JSON.stringify(out[i])) {
					out[i] = merged;
					changed = true;
				}
			} else {
				out.push(t);
				changed = true;
			}
		}
		if (!changed) return cur;
		out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
		this.f.data[stationId] = { at: Date.now(), tracks: out.slice(0, PER_STATION) };
		// on oublie les stations les moins récemment écoutées
		const ids = Object.keys(this.f.data);
		if (ids.length > MAX_STATIONS) {
			ids.sort((a, b) => this.f.data[a].at - this.f.data[b].at)
				.slice(0, ids.length - MAX_STATIONS)
				.forEach((id) => delete this.f.data[id]);
		}
		this.f.save();
		return this.f.data[stationId].tracks;
	}

	clear(stationId: string): void {
		delete this.f.data[stationId];
		this.f.save();
	}

	flush(): void {
		this.f.flush();
	}
}

// ---------- morceaux aimés ----------
export interface Like {
	id: string;
	title: string;
	artist: string;
	album: string;
	cover: string;
	buyLink: string;
	station: string;
	stationId: string;
	at: number;
}

export class LikesStore {
	private f: JsonFile<Like[]>;
	constructor(dir: string) {
		this.f = new JsonFile<Like[]>(path.join(dir, "likes.json"), []);
		if (!Array.isArray(this.f.data)) this.f.data = [];
	}
	list(): Like[] {
		return this.f.data;
	}
	has(t: { artist: string; title: string }): boolean {
		const k = songKey(t);
		return this.f.data.some((l) => songKey(l) === k);
	}
	/** Ajoute ou retire le morceau ; renvoie true s'il est désormais aimé. */
	toggle(t: Track, station: { id: string; name: string }): boolean {
		const k = songKey(t);
		if (this.has(t)) {
			this.f.data = this.f.data.filter((l) => songKey(l) !== k);
			this.f.save();
			return false;
		}
		this.f.data = [
			{
				id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
				title: t.title,
				artist: t.artist,
				album: t.album,
				cover: t.cover,
				buyLink: t.buyLink,
				station: station.name,
				stationId: station.id,
				at: Date.now(),
			},
			...this.f.data,
		];
		this.f.save();
		return true;
	}
	remove(id: string): void {
		this.f.data = this.f.data.filter((l) => l.id !== id);
		this.f.save();
	}
	/** Complète un morceau aimé avant l'arrivée de sa pochette / de son lien. */
	enrich(t: Track): void {
		const k = songKey(t);
		const l = this.f.data.find((x) => songKey(x) === k);
		if (!l) return;
		let changed = false;
		if (!l.cover && t.cover) (l.cover = t.cover), (changed = true);
		if (!l.buyLink && t.buyLink) (l.buyLink = t.buyLink), (changed = true);
		if (!l.album && t.album) (l.album = t.album), (changed = true);
		if (changed) this.f.save();
	}
	flush(): void {
		this.f.flush();
	}
}
