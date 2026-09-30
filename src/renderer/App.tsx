import { useEffect, useMemo, useRef, useState } from "react";
import {
	ChevronDown,
	CloseIcon,
	CompactIcon,
	ExpandIcon,
	ExternalIcon,
	HeartIcon,
	InfoIcon,
	ListIcon,
	NextIcon,
	PauseIcon,
	PlayIcon,
	PrevIcon,
	RecIcon,
	SpeakerHigh,
	SpeakerLow,
	StarIcon,
} from "./icons";
import { Player } from "./player";
import { StationArt, StationLogo, StationsPanel } from "./Stations";
import type { AppState, Command, Like, Track } from "./types";

const fmt = (ms: number) => {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Fiche Apple Music du morceau ; à défaut de lien direct, recherche Apple Music artiste + titre. */
const appleMusicUrl = (t: Pick<Track, "title" | "artist" | "buyLink"> | null | undefined) =>
	!t?.title ? "" : t.buyLink || `https://music.apple.com/fr/search?term=${encodeURIComponent([t.artist, t.title].filter(Boolean).join(" "))}`;
const fmtBytes = (b: number) => (b < 1e6 ? `${Math.round(b / 1e3)} ko` : `${(b / 1e6).toFixed(1).replace(".", ",")} Mo`);
const hhmm = (t: number) => (t ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
/** « 14:05 », « hier 14:05 », « 12/09 14:05 » */
function when(t: number): string {
	if (!t) return "";
	const d = new Date(t);
	const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
	if (diff === 0) return hhmm(t);
	if (diff === 1) return `hier ${hhmm(t)}`;
	return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${hhmm(t)}`;
}
const khz = (hz: number) => (hz ? `${(hz / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kHz` : "");

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
	recording: { available: true, active: false, startedAt: 0, bytes: 0, file: "", error: "", dir: "", last: null },
	likes: [],
	quality: { info: null, probing: false, dropouts: 0, buffer: 0, hls: null },
	source: { fallback: false, fallbackName: "", host: "", searching: false, message: "" },
	compact: false,
	onTop: true,
};

type Health = "good" | "warn" | "bad" | "idle";

export function App() {
	const [s, setS] = useState<AppState>(EMPTY);
	const [, force] = useState(0);
	const [now, setNow] = useState(Date.now());
	const [panel, setPanel] = useState(false);
	const [tab, setTab] = useState<"history" | "likes">("history");
	const [qualityOpen, setQualityOpen] = useState(false);
	const [brokenCover, setBrokenCover] = useState(""); // pochette qui ne charge pas → logo de la station
	const playerRef = useRef<Player | null>(null);

	// Lecteur + pont avec le processus principal
	useEffect(() => {
		const report = () => {
			const p = playerRef.current!;
			window.cari.reportAudio({ status: p.status, volume: p.volume, error: p.error, retries: p.failures, dropouts: p.dropouts, buffer: Math.round(p.bufferAhead * 10) / 10, hls: p.hlsInfo });
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
			p.load(st.station.stream || st.current.stream, st.station.hls, false);
			setS(st);
			force((n) => n + 1);
		});
		const t = window.setInterval(() => setNow(Date.now()), 500);
		// tampon et coupures remontés régulièrement pendant la lecture (fiche qualité)
		const q = window.setInterval(() => {
			if (p.status === "playing") report();
		}, 3000);

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
			window.clearInterval(q);
			window.removeEventListener("keydown", onKey);
		};
	}, []);

	const p = playerRef.current;
	const status = p?.status ?? "idle";
	const playing = status === "playing" || status === "loading";
	const tr = s.track;
	const st = s.station;
	const art = tr?.cover || ""; // pochette, ou logo de la station quand le morceau n'en a pas
	const realCover = !!tr?.cover && !tr.coverIsStation && brokenCover !== tr.cover;

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

	const rec = s.recording ?? EMPTY.recording;
	const q = s.quality ?? EMPTY.quality;
	const src = s.source ?? EMPTY.source;
	const recentRec = !!rec.last && now - rec.last.at < 10_000;
	const trackUrl = appleMusicUrl(tr);
	const canStep = s.favorites.length > 1 || (s.favorites.length === 1 && s.favorites[0].id !== st.id);
	const liked = !!tr?.liked;

	// qualité : format réellement mesuré si la sonde a répondu, sinon ce qu'annonce l'annuaire
	const fmtLabel = q.info?.format || (q.hls ? "HLS" : st.codec);
	const rate = q.info?.bitrate || q.hls?.bitrate || q.info?.declaredBitrate || st.bitrate;
	const qualityLabel = [fmtLabel, rate ? `${rate} kb/s` : ""].filter(Boolean).join(" · ") || "Qualité";
	const health: Health =
		status === "error" || q.dropouts > 3 ? "bad" : status === "idle" || status === "paused" ? "idle" : q.dropouts > 0 || src.fallback || status === "loading" ? "warn" : "good";

	const badge =
		status === "playing"
			? { cls: "live", text: "En direct" }
			: status === "loading"
				? { cls: "loading", text: "Connexion…" }
				: status === "error"
					? { cls: "error", text: "Reconnexion…" }
					: { cls: "idle", text: status === "paused" ? "En pause" : "Prêt" };

	const heartBtn = (size = 20) => (
		<button
			className={`icon-btn heart ${liked ? "on" : ""}`}
			onClick={() => window.cari.toggleLike()}
			disabled={!tr?.title}
			title={liked ? "Retirer des morceaux aimés (⌘L)" : "J'aime ce morceau (⌘L)"}
			aria-label={liked ? "Retirer des morceaux aimés" : "J'aime ce morceau"}
		>
			<HeartIcon size={size} filled={liked} />
		</button>
	);
	const recBtn = (size = 20) => (
		<button
			className={`icon-btn rec-btn ${rec.active ? "on" : ""}`}
			onClick={() => window.cari.toggleRecording()}
			disabled={!rec.active && !rec.available}
			title={!rec.available ? "Enregistrement indisponible pour les flux HLS" : rec.active ? `Arrêter l'enregistrement (⌘R) — ${fmt(now - rec.startedAt)}` : "Enregistrer le flux (⌘R)"}
			aria-label={rec.active ? "Arrêter l'enregistrement" : "Enregistrer"}
		>
			<RecIcon size={size} active={rec.active} />
		</button>
	);

	// ---------- mode compact ----------
	if (s.compact) {
		return (
			<div className="app compact">
				{(art || st.favicon) && <div className="backdrop soft" style={{ backgroundImage: `url("${art || st.favicon}")` }} />}
				<header className="c-bar">
					<span className="c-station">
						{status === "playing" && <span className="live-dot" />}
						{st.name}
						{rec.active && <span className="c-rec">REC {fmt(now - rec.startedAt)}</span>}
					</span>
					<button className="icon-btn c-expand" onClick={() => window.cari.setCompact(false)} title="Fenêtre complète (⇧⌘M)" aria-label="Fenêtre complète">
						<ExpandIcon />
					</button>
				</header>
				<div className="c-body">
					<div className={`c-cover ${trackUrl ? "clickable" : ""}`} onClick={() => trackUrl && window.cari.openExternal(trackUrl)} title={trackUrl ? "Ouvrir dans Apple Music" : undefined}>
						{realCover ? <img src={art} alt="" draggable={false} onError={() => setBrokenCover(art)} /> : <StationArt station={st} />}
					</div>
					<div className="c-main">
						<button className="c-meta" onClick={() => trackUrl && window.cari.openExternal(trackUrl)} disabled={!trackUrl} title={trackUrl ? "Ouvrir dans Apple Music" : undefined}>
							<span className="c-title">{tr?.title || st.name}</span>
							<span className="c-artist">{tr ? tr.artist || st.subtitle : st.subtitle || " "}</span>
						</button>
						<div className="c-controls">
							{heartBtn(17)}
							<button className="icon-btn" onClick={() => window.cari.stepStation(-1)} disabled={!canStep} title="Favori précédent (⌘[)">
								<PrevIcon size={18} />
							</button>
							<button className="icon-btn c-play" onClick={() => p?.toggle()} aria-label={playing ? "Pause" : "Lecture"}>
								{playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
							</button>
							<button className="icon-btn" onClick={() => window.cari.stepStation(1)} disabled={!canStep} title="Favori suivant (⌘])">
								<NextIcon size={18} />
							</button>
							{recBtn(17)}
						</div>
					</div>
				</div>
			</div>
		);
	}

	// ---------- fenêtre complète ----------
	return (
		<div className="app" onClick={() => qualityOpen && setQualityOpen(false)}>
			{(art || st.favicon) && <div className={`backdrop ${realCover ? "" : "soft"}`} style={{ backgroundImage: `url("${art || st.favicon}")` }} />}
			<header className="titlebar">
				<button className="station-btn" onClick={() => setPanel(true)} title="Choisir une station (⌘K)">
					<span className="station">
						{st.name}
						{st.subtitle && <span className="sub"> · {st.subtitle}</span>}
					</span>
					<ChevronDown />
				</button>
				<div className="titlebar-tools">
					<button className={`icon-btn star ${st.favorite ? "on" : ""}`} onClick={() => window.cari.toggleFavorite(s.current)} title={st.favorite ? "Retirer la station des favoris (⌘D)" : "Ajouter la station aux favoris (⌘D)"} disabled={!st.id}>
						<StarIcon size={15} filled={st.favorite} />
					</button>
					<button className="icon-btn" onClick={() => window.cari.setCompact(true)} title="Mode compact (⇧⌘M)" aria-label="Mode compact">
						<CompactIcon />
					</button>
					<button className="icon-btn" onClick={() => setPanel(true)} title="Stations (⌘K)" aria-label="Stations">
						<ListIcon size={16} />
					</button>
				</div>
			</header>

			<main className="now">
				<div
					className={`cover ${playing ? "" : "dimmed"} ${trackUrl ? "clickable" : ""}`}
					onClick={() => trackUrl && window.cari.openExternal(trackUrl)}
					title={trackUrl ? (tr?.buyLink ? "Ouvrir dans Apple Music" : "Rechercher dans Apple Music") : undefined}
				>
					{realCover ? <img src={art} alt="" draggable={false} onError={() => setBrokenCover(art)} /> : <StationArt station={st} />}
				</div>

				<div className="badges">
					<div className={`badge ${badge.cls}`}>
						<span className="dot" />
						{badge.text}
					</div>
					<div className="q-wrap" onClick={(e) => e.stopPropagation()}>
						<button className={`badge quality ${health}`} onClick={() => setQualityOpen((o) => !o)} title="Qualité du flux">
							<span className="dot" />
							{qualityLabel}
						</button>
						{qualityOpen && <QualityCard s={s} health={health} onClose={() => setQualityOpen(false)} />}
					</div>
					{rec.active ? (
						<button className="badge rec" onClick={() => window.cari.toggleRecording()} title={`Enregistrement en cours : ${rec.file}\nCliquer pour arrêter (⌘R)`}>
							<span className="dot" />
							REC {fmt(now - rec.startedAt)} · {fmtBytes(rec.bytes)}
						</button>
					) : recentRec ? (
						<button className="badge saved" onClick={() => window.cari.revealRecording()} title={`${rec.last!.file}\nAfficher dans le Finder`}>
							Enregistré ✓
						</button>
					) : null}
				</div>

				{trackUrl ? (
					<button className="now-link" onClick={() => window.cari.openExternal(trackUrl)} title={tr?.buyLink ? "Ouvrir dans Apple Music" : "Rechercher dans Apple Music"}>
						<h1 className="title">{tr!.title}</h1>
						<div className="artist">
							{tr!.artist || st.name} <ExternalIcon />
						</div>
					</button>
				) : (
					<>
						<h1 className="title" title={tr?.title}>
							{tr?.title || st.name}
						</h1>
						<div className="artist">{tr ? tr.artist || st.name : st.subtitle || " "}</div>
					</>
				)}
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
							<span>{src.host}</span>
						</div>
					</div>
				)}

				<div className="controls">
					{heartBtn()}
					<button className="icon-btn" onClick={() => window.cari.stepStation(-1)} disabled={!canStep} title="Favori précédent (⌘[)">
						<PrevIcon />
					</button>
					<button className="play" onClick={() => p?.toggle()} aria-label={playing ? "Pause" : "Lecture"}>
						{playing ? <PauseIcon size={34} /> : <PlayIcon size={34} />}
					</button>
					<button className="icon-btn" onClick={() => window.cari.stepStation(1)} disabled={!canStep} title="Favori suivant (⌘])">
						<NextIcon />
					</button>
					{recBtn()}
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

				{(src.fallback || src.searching || src.message) && (
					<div className={`source-note ${src.message ? "warn" : ""}`}>
						<InfoIcon />
						{src.searching ? (
							<span>Flux muet : recherche d'une autre source…</span>
						) : src.fallback ? (
							<>
								<span>Source de secours · {src.host}</span>
								<button className="link-btn" onClick={() => window.cari.keepFallback()}>
									Garder
								</button>
							</>
						) : (
							<span>{src.message}</span>
						)}
					</div>
				)}
				{(p?.error || s.error || rec.error) && !src.searching && <div className="error">{p?.error || s.error || rec.error}</div>}
			</main>

			<section className="history">
				<nav className="h-tabs">
					<button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
						Précédemment
					</button>
					<button className={tab === "likes" ? "on" : ""} onClick={() => setTab("likes")}>
						J'aime{s.likes.length > 0 && <span className="count">{s.likes.length}</span>}
					</button>
				</nav>
				{tab === "history" ? (
					<ul>
						{s.history.map((h: Track) => (
							<li key={`${h.startedAt}-${h.title}`} onClick={() => appleMusicUrl(h) && window.cari.openExternal(appleMusicUrl(h))} className={appleMusicUrl(h) ? "link" : ""}>
								{h.cover ? <img src={h.cover} alt="" draggable={false} /> : <StationLogo station={st} size={34} radius={4} />}
								<div className="meta">
									<div className="t">{h.title}</div>
									<div className="a">{h.artist}</div>
								</div>
								<div className="when">
									{when(h.startedAt)}
									{appleMusicUrl(h) && <ExternalIcon />}
								</div>
							</li>
						))}
						{!s.history.length && (
							<li className="empty">{st.hls ? "Cette station ne publie pas ses titres" : "Les titres diffusés s'afficheront ici"}</li>
						)}
					</ul>
				) : (
					<ul>
						{s.likes.map((l: Like) => (
							<li key={l.id} className="link like" onClick={() => window.cari.openExternal(appleMusicUrl(l))}>
								{l.cover ? <img src={l.cover} alt="" draggable={false} /> : <StationLogo station={{ name: l.station, favicon: "" }} size={34} radius={4} />}
								<div className="meta">
									<div className="t">{l.title}</div>
									<div className="a">
										{l.artist}
										<span className="src"> · {l.station}</span>
									</div>
								</div>
								<div className="when">{when(l.at)}</div>
								<button
									className="unlike"
									title="Retirer des morceaux aimés"
									aria-label="Retirer des morceaux aimés"
									onClick={(e) => {
										e.stopPropagation();
										window.cari.removeLike(l.id);
									}}
								>
									<CloseIcon size={9} />
								</button>
							</li>
						))}
						{!s.likes.length && <li className="empty">Touchez ♡ pendant un morceau pour le retrouver ici</li>}
					</ul>
				)}
			</section>

			<footer className="footer">
				<span className="ok-dot" /> Pilotable depuis le Stream Deck (CariMusicDeck)
			</footer>

			{panel && <StationsPanel s={s} playing={playing} onClose={() => setPanel(false)} onToggle={() => p?.toggle()} />}
		</div>
	);
}

/** Fiche détaillée de la qualité du flux (format réel, débits, tampon, coupures, source). */
function QualityCard({ s, health, onClose }: { s: AppState; health: Health; onClose: () => void }) {
	const q = s.quality;
	const i = q.info;
	const src = s.source;
	const st = s.station;
	useEffect(() => {
		const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", k);
		return () => window.removeEventListener("keydown", k);
	}, [onClose]);
	const rows: [string, string][] = [];
	if (i?.format) rows.push(["Format", [i.detail || i.format, khz(i.sampleRate), i.channels].filter(Boolean).join(" · ")]);
	else if (q.hls) rows.push(["Format", ["HLS", q.hls.codec].filter(Boolean).join(" · ")]);
	else rows.push(["Format", q.probing ? "Analyse…" : st.codec || "Inconnu"]);
	if (i?.bitrate) rows.push(["Débit mesuré", `${i.bitrate} kb/s${i.vbr ? " (variable)" : ""}`]);
	if (q.hls?.bitrate) rows.push(["Débit HLS", `${q.hls.bitrate} kb/s`]);
	const declared = i?.declaredBitrate || st.bitrate;
	if (declared) rows.push(["Débit annoncé", `${declared} kb/s`]);
	rows.push(["Tampon", s.status === "playing" ? `${q.buffer.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s` : "—"]);
	rows.push(["Coupures", q.dropouts ? `${q.dropouts} depuis le début de l'écoute` : "aucune"]);
	rows.push(["Serveur", [src.host, i?.server].filter(Boolean).join(" · ") || "—"]);
	if (i) rows.push(["Connexion", i.secure ? "HTTPS" : "HTTP (non chiffrée)"]);
	const verdict = { good: "Flux stable", warn: "Flux instable", bad: "Flux en difficulté", idle: "À l'arrêt" }[health];
	return (
		<div className="q-card" role="dialog" aria-label="Qualité du flux">
			<div className={`q-head ${health}`}>
				<span className="dot" />
				{verdict}
			</div>
			<dl>
				{rows.map(([k, v]) => (
					<div key={k}>
						<dt>{k}</dt>
						<dd>{v}</dd>
					</div>
				))}
			</dl>
			{src.fallback && (
				<div className="q-source">
					Source de secours (fiche « {src.fallbackName} »).
					<button className="link-btn" onClick={() => window.cari.keepFallback()}>
						Garder cette source
					</button>
				</div>
			)}
		</div>
	);
}
