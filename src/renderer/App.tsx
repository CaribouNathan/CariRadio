import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalIcon, ListIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, SpeakerHigh, SpeakerLow, StarIcon } from "./icons";
import { Player } from "./player";
import { StationArt, StationLogo, StationsPanel } from "./Stations";
import type { AppState, Command, Track } from "./types";

const fmt = (ms: number) => {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const hhmm = (t: number) => (t ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

const EMPTY_STATION = { id: "", name: "CariRadio", subtitle: "", stream: "", hls: false, favicon: "", homepage: "", tags: [], country: "", countrycode: "", state: "", codec: "", bitrate: 0 };
const EMPTY: AppState = {
	station: { id: "", name: "CariRadio", subtitle: "", site: "", favicon: "", codec: "", bitrate: 0, stream: "", hls: false, native: false, favorite: false },
	current: EMPTY_STATION,
	favorites: [],
	scope: "FR",
	status: "idle",
	volume: 70,
	error: "",
	track: null,
	history: [],
};

export function App() {
	const [s, setS] = useState<AppState>(EMPTY);
	const [, force] = useState(0);
	const [now, setNow] = useState(Date.now());
	const [panel, setPanel] = useState(false);
	const playerRef = useRef<Player | null>(null);

	// Lecteur + pont avec le processus principal
	useEffect(() => {
		const report = () => {
			const p = playerRef.current!;
			window.cari.reportAudio({ status: p.status, volume: p.volume, error: p.error });
			force((n) => n + 1);
		};
		const p = new Player(report);
		playerRef.current = p;
		window.cari.onState((st) => setS(st));
		window.cari.onCommand((c: Command) => {
			if (c.type === "play") p.play();
			else if (c.type === "pause" || c.type === "stop") p.pause();
			else if (c.type === "toggle") p.toggle();
			else if (c.type === "volume") p.setVolume(c.value);
			else if (c.type === "volumeStep") p.setVolume(p.volume + c.delta);
			else if (c.type === "load") p.load(c.stream, c.hls, c.play);
			else if (c.type === "openStations") setPanel(true);
		});
		void window.cari.ready().then((st) => {
			p.setVolume(st.volume, false); // pas de remontée : on reprend simplement la valeur mémorisée
			p.load(st.current.stream, st.current.hls, false);
			setS(st);
			force((n) => n + 1);
		});
		const t = window.setInterval(() => setNow(Date.now()), 500);

		// Espace : lecture/pause, sauf dans un champ de saisie
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement;
			if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) {
				e.preventDefault();
				p.toggle();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.clearInterval(t);
			window.removeEventListener("keydown", onKey);
		};
	}, []);

	const p = playerRef.current;
	const status = p?.status ?? "idle";
	const playing = status === "playing" || status === "loading";
	const tr = s.track;
	const st = s.station;
	const art = tr?.cover || ""; // pochette, ou logo de la station quand le morceau n'en a pas
	const realCover = !!tr?.cover && !tr.coverIsStation;

	// Centre de contrôle macOS / touches média
	useEffect(() => {
		if (!("mediaSession" in navigator)) return;
		const artwork = art ? [{ src: art, sizes: "600x600", type: "image/jpeg" }] : st.favicon ? [{ src: st.favicon }] : [];
		navigator.mediaSession.metadata = new MediaMetadata({
			title: tr?.title || st.name,
			artist: tr?.artist || st.subtitle,
			album: st.subtitle ? `${st.name} — ${st.subtitle}` : st.name,
			artwork,
		});
		navigator.mediaSession.setActionHandler("play", () => playerRef.current?.play());
		navigator.mediaSession.setActionHandler("pause", () => playerRef.current?.pause());
		navigator.mediaSession.setActionHandler("stop", () => playerRef.current?.pause());
		// touches ⏮ ⏭ : favori précédent / suivant
		navigator.mediaSession.setActionHandler("previoustrack", () => window.cari.stepStation(-1));
		navigator.mediaSession.setActionHandler("nexttrack", () => window.cari.stepStation(1));
	}, [tr?.title, tr?.artist, art, st.name, st.subtitle, st.favicon]);
	useEffect(() => {
		if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
	}, [playing]);

	const progress = useMemo(() => {
		if (!tr?.startedAt || !tr.endAt || tr.endAt <= tr.startedAt) return null;
		const total = tr.endAt - tr.startedAt;
		const el = Math.min(total, Math.max(0, now - tr.startedAt));
		return { frac: el / total, el, rest: total - el };
	}, [tr?.startedAt, tr?.endAt, now]);

	const tech = [st.codec, st.bitrate ? `${st.bitrate} kb/s` : ""].filter(Boolean).join(" · ");
	const canStep = s.favorites.length > 1 || (s.favorites.length === 1 && s.favorites[0].id !== st.id);

	const badge =
		status === "playing"
			? { cls: "live", text: "En direct" }
			: status === "loading"
				? { cls: "loading", text: "Connexion…" }
				: status === "error"
					? { cls: "error", text: "Reconnexion…" }
					: { cls: "idle", text: status === "paused" ? "En pause" : "Prêt" };

	return (
		<div className="app">
			{(art || st.favicon) && <div className={`backdrop ${realCover ? "" : "soft"}`} style={{ backgroundImage: `url("${art || st.favicon}")` }} />}
			<header className="titlebar">
				<button className="station-btn" onClick={() => setPanel(true)} title="Choisir une station (⌘K)">
					<span className="station">
						{st.name}
						{st.subtitle && <span className="sub"> · {st.subtitle}</span>}
					</span>
					<ChevronDown />
				</button>
			</header>

			<main className="now">
				<div className={`cover ${playing ? "" : "dimmed"}`}>
					{realCover ? <img src={art} alt="" draggable={false} /> : <StationArt station={st} />}
				</div>

				<div className={`badge ${badge.cls}`}>
					<span className="dot" />
					{badge.text}
				</div>

				<h1 className="title" title={tr?.title}>
					{tr?.title || st.name}
				</h1>
				<div className="artist">{tr ? tr.artist || st.name : st.subtitle || " "}</div>
				{tr?.album ? <div className="album">{tr.album}</div> : <div className="album">{" "}</div>}

				{progress ? (
					<div className="progress">
						<div className="bar">
							<div className="fill" style={{ width: `${progress.frac * 100}%` }} />
						</div>
						<div className="times">
							<span>{fmt(progress.el)}</span>
							<span>-{fmt(progress.rest)}</span>
						</div>
					</div>
				) : (
					<div className="progress live-info">
						<div className="bar" />
						<div className="times">
							<span>{tr?.startedAt ? `Depuis ${hhmm(tr.startedAt)}` : "Direct"}</span>
							<span>{tech}</span>
						</div>
					</div>
				)}

				<div className="controls">
					<button className={`icon-btn star ${st.favorite ? "on" : ""}`} onClick={() => window.cari.toggleFavorite(s.current)} title={st.favorite ? "Retirer des favoris (⌘D)" : "Ajouter aux favoris (⌘D)"} disabled={!st.id}>
						<StarIcon filled={st.favorite} />
					</button>
					<button className="icon-btn" onClick={() => window.cari.stepStation(-1)} disabled={!canStep} title="Favori précédent (⌘[)">
						<PrevIcon />
					</button>
					<button className="play" onClick={() => p?.toggle()} aria-label={playing ? "Pause" : "Lecture"}>
						{playing ? <PauseIcon size={34} /> : <PlayIcon size={34} />}
					</button>
					<button className="icon-btn" onClick={() => window.cari.stepStation(1)} disabled={!canStep} title="Favori suivant (⌘])">
						<NextIcon />
					</button>
					<button className="icon-btn" onClick={() => setPanel(true)} title="Stations (⌘K)">
						<ListIcon />
					</button>
				</div>

				<div className="volume">
					<SpeakerLow />
					<input
						type="range"
						min={0}
						max={100}
						value={p?.volume ?? s.volume}
						onChange={(e) => p?.setVolume(Number(e.target.value))}
						style={{ ["--v" as string]: `${p?.volume ?? s.volume}%` }}
						aria-label="Volume"
					/>
					<SpeakerHigh />
				</div>
				{(p?.error || s.error) && <div className="error">{p?.error || s.error}</div>}
			</main>

			<section className="history">
				<h2>Précédemment</h2>
				<ul>
					{s.history.map((h: Track) => (
						<li key={`${h.startedAt}-${h.title}`} onClick={() => h.buyLink && window.cari.openExternal(h.buyLink)} className={h.buyLink ? "link" : ""}>
							{h.cover ? <img src={h.cover} alt="" draggable={false} /> : <StationLogo station={st} size={34} radius={4} />}
							<div className="meta">
								<div className="t">{h.title}</div>
								<div className="a">{h.artist}</div>
							</div>
							<div className="when">
								{hhmm(h.startedAt)}
								{h.buyLink && <ExternalIcon />}
							</div>
						</li>
					))}
					{!s.history.length && (
						<li className="empty">{st.native ? "Historique indisponible" : st.hls ? "Cette station ne publie pas ses titres" : "Les titres diffusés s'afficheront ici"}</li>
					)}
				</ul>
			</section>

			<footer className="footer">
				<span className="ok-dot" /> Pilotable depuis le Stream Deck (CariCover)
			</footer>

			{panel && <StationsPanel s={s} playing={playing} onClose={() => setPanel(false)} onToggle={() => p?.toggle()} />}
		</div>
	);
}
