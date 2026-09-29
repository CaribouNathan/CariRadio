// Lecture du flux. Radio en direct : « pause » coupe le flux, « lecture » le reprend au direct.
// Flux classiques (MP3/AAC/Ogg) : lecteur natif. Flux HLS (.m3u8, ex. RTL, Radio France) : hls.js.
import Hls from "hls.js";
import type { AudioStatus } from "./types";

export class Player {
	status: AudioStatus = "idle";
	volume = 70;
	error = "";
	private audio = new Audio();
	private hls: Hls | null = null;
	private stream = "";
	private isHls = false;
	private wantPlay = false;
	private retry: number | null = null;
	private retries = 0;

	constructor(private onChange: () => void) {
		this.audio.preload = "none";
		const a = this.audio;
		a.addEventListener("playing", () => {
			this.retries = 0;
			this.set("playing");
		});
		a.addEventListener("waiting", () => this.wantPlay && this.set("loading"));
		a.addEventListener("error", () => {
			// ignore les erreurs tardives d'un flux déjà détaché (changement de station)
			if (a.getAttribute("src")) this.fail("Flux indisponible");
		});
		a.addEventListener("ended", () => this.fail("Flux interrompu"));
		a.addEventListener("stalled", () => this.wantPlay && this.set("loading"));
	}

	private set(s: AudioStatus, error = ""): void {
		this.status = s;
		this.error = error;
		this.onChange();
	}

	private fail(msg: string): void {
		if (!this.wantPlay) return;
		this.set("error", msg);
		if (this.retry) window.clearTimeout(this.retry);
		// reconnexion progressive : 2 s, 4 s, 8 s… plafonné à 30 s
		const delay = Math.min(30_000, 2000 * 2 ** this.retries++);
		this.retry = window.setTimeout(() => this.wantPlay && this.start(), delay);
	}

	private detach(): void {
		if (this.retry) window.clearTimeout(this.retry);
		this.retry = null;
		this.hls?.destroy();
		this.hls = null;
		this.audio.pause();
		this.audio.removeAttribute("src"); // coupe le téléchargement du flux
		this.audio.load();
	}

	private start(): void {
		this.detach();
		if (!this.stream) return this.set("error", "Aucune station");
		this.set("loading");
		if (this.isHls && Hls.isSupported()) {
			const h = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 });
			this.hls = h;
			h.on(Hls.Events.ERROR, (_e, d) => {
				if (d.fatal && this.hls === h) this.fail("Flux indisponible");
			});
			h.loadSource(this.stream);
			h.attachMedia(this.audio);
		} else {
			this.audio.src = this.stream;
			this.audio.load();
		}
		this.audio.play().catch((e: Error) => {
			if (e.name !== "AbortError") this.fail(e.message || "Lecture impossible");
		});
	}

	/** Change de flux ; relance immédiatement si demandé (ou si la radio jouait déjà). */
	load(stream: string, hls: boolean, play: boolean): void {
		const same = stream === this.stream;
		this.stream = stream;
		this.isHls = hls || /\.m3u8(\?|$)/i.test(stream);
		if (play) {
			if (same && this.wantPlay && (this.status === "playing" || this.status === "loading")) return;
			this.wantPlay = true;
			this.retries = 0;
			this.start();
		} else if (!same && this.wantPlay) {
			this.retries = 0;
			this.start();
		}
	}

	play(): void {
		if (this.wantPlay && (this.status === "playing" || this.status === "loading")) return;
		this.wantPlay = true;
		this.retries = 0;
		this.start();
	}

	pause(): void {
		this.wantPlay = false;
		this.detach();
		this.set("paused");
	}

	toggle(): void {
		if (this.wantPlay) this.pause();
		else this.play();
	}

	setVolume(v: number, report = true): void {
		this.volume = Math.max(0, Math.min(100, Math.round(v)));
		// courbe perceptive : le curseur suit mieux l'oreille qu'un gain linéaire
		this.audio.volume = (this.volume / 100) ** 2;
		if (report) this.onChange();
	}
}
