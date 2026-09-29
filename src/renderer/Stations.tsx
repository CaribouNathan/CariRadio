// Panneau de choix des stations : favoris, populaires, genres, régions/pays, recherche.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, CloseIcon, EqBars, PauseIcon, PlayIcon, SearchIcon, StarIcon } from "./icons";
import type { AppState, Area, Scope, Station, StationQuery } from "./types";

type Tab = "fav" | "top" | "genres" | "areas";

// Libellé affiché → tag Radio Browser (correspondance partielle côté API : « rock » trouve aussi « pop rock »).
const GENRES: { label: string; tag: string }[] = [
	{ label: "Pop", tag: "pop" },
	{ label: "Rock", tag: "rock" },
	{ label: "Hits", tag: "hits" },
	{ label: "Années 80", tag: "80s" },
	{ label: "Années 90", tag: "90s" },
	{ label: "Oldies", tag: "oldies" },
	{ label: "Chanson française", tag: "chanson" },
	{ label: "Jazz", tag: "jazz" },
	{ label: "Blues", tag: "blues" },
	{ label: "Soul / R&B", tag: "soul" },
	{ label: "Funk", tag: "funk" },
	{ label: "Disco", tag: "disco" },
	{ label: "Rap / Hip-hop", tag: "rap" },
	{ label: "Reggae", tag: "reggae" },
	{ label: "Électro", tag: "electro" },
	{ label: "House", tag: "house" },
	{ label: "Techno", tag: "techno" },
	{ label: "Dance", tag: "dance" },
	{ label: "Lounge", tag: "lounge" },
	{ label: "Chill", tag: "chill" },
	{ label: "Ambient", tag: "ambient" },
	{ label: "Classique", tag: "classical" },
	{ label: "Metal", tag: "metal" },
	{ label: "Folk", tag: "folk" },
	{ label: "Country", tag: "country" },
	{ label: "Latino", tag: "latin" },
	{ label: "Musiques du monde", tag: "world music" },
	{ label: "Info", tag: "news" },
	{ label: "Talk / Débats", tag: "talk" },
	{ label: "Culture", tag: "culture" },
];

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (s: string) =>
	s
		.replace(/[^\p{L}\p{N} ]/gu, "")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0])
		.join("")
		.toUpperCase() || "♪";

/** Logo de station, avec pastille de secours (initiales) si l'image manque ou ne charge pas. */
export function StationLogo({ station, size = 36, radius = 7 }: { station: Pick<Station, "name" | "favicon">; size?: number; radius?: number }) {
	const [broken, setBroken] = useState(false);
	useEffect(() => {
		setBroken(false);
	}, [station.favicon]);
	const style = { width: size, height: size, borderRadius: radius };
	if (station.favicon && !broken)
		return <img className="logo" src={station.favicon} alt="" style={style} draggable={false} onError={() => setBroken(true)} referrerPolicy="no-referrer" />;
	const h = hue(station.name);
	return (
		<span className="logo logo-fallback" style={{ ...style, fontSize: size * 0.38, background: `linear-gradient(145deg, hsl(${h} 55% 55%), hsl(${(h + 40) % 360} 55% 40%))` }}>
			{initials(station.name)}
		</span>
	);
}

/** Logo de la station en grand, à la place d'une pochette : fond flouté du logo, logo net par-dessus. */
export function StationArt({ station }: { station: Pick<Station, "name" | "favicon"> }) {
	const [broken, setBroken] = useState(false);
	const [small, setSmall] = useState(false);
	useEffect(() => {
		setBroken(false);
		setSmall(false);
	}, [station.favicon]);
	if (!station.favicon || broken) {
		const h = hue(station.name);
		return (
			<div className="art art-fallback" style={{ background: `linear-gradient(145deg, hsl(${h} 55% 55%), hsl(${(h + 40) % 360} 55% 38%))` }}>
				{initials(station.name)}
			</div>
		);
	}
	return (
		<div className={`art ${small ? "small" : ""}`}>
			<img className="art-bg" src={station.favicon} alt="" draggable={false} referrerPolicy="no-referrer" />
			<img
				className="art-fg"
				src={station.favicon}
				alt=""
				draggable={false}
				referrerPolicy="no-referrer"
				// petit favicon : affiché à taille raisonnable plutôt qu'agrandi et flou
				onLoad={(e) => setSmall(e.currentTarget.naturalWidth < 160)}
				onError={() => setBroken(true)}
			/>
		</div>
	);
}

const techLine = (s: Station) => [s.codec, s.bitrate ? `${s.bitrate} kb/s` : "", s.hls ? "HLS" : ""].filter(Boolean).join(" · ");

function StationRow(props: {
	station: Station;
	current: boolean;
	playing: boolean;
	favorite: boolean;
	onPlay: () => void;
	onFav: () => void;
	onMove?: (delta: number) => void;
	first?: boolean;
	last?: boolean;
}) {
	const { station: s } = props;
	const secondary = [s.subtitle, techLine(s)].filter(Boolean).join(" — ");
	return (
		<li className={`row ${props.current ? "current" : ""}`} onClick={props.onPlay} title={s.name}>
			<StationLogo station={s} />
			<div className="meta">
				<div className="t">
					{props.current && <EqBars playing={props.playing} />}
					{s.name}
				</div>
				<div className="a">{secondary}</div>
			</div>
			{props.onMove && (
				<div className="reorder" onClick={(e) => e.stopPropagation()}>
					<button disabled={props.first} onClick={() => props.onMove!(-1)} aria-label="Monter">
						<ArrowUp />
					</button>
					<button disabled={props.last} onClick={() => props.onMove!(1)} aria-label="Descendre" className="down">
						<ArrowUp />
					</button>
				</div>
			)}
			<button
				className={`star ${props.favorite ? "on" : ""}`}
				onClick={(e) => {
					e.stopPropagation();
					props.onFav();
				}}
				aria-label={props.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
				title={props.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
			>
				<StarIcon size={16} filled={props.favorite} />
			</button>
		</li>
	);
}

/** Liste paginée issue d'une requête Radio Browser. */
function useQuery(q: StationQuery | null) {
	const [list, setList] = useState<Station[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [hasMore, setHasMore] = useState(false);
	const key = q ? JSON.stringify(q) : "";
	const seq = useRef(0);

	const run = (offset: number) => {
		if (!q) return;
		const id = ++seq.current;
		setLoading(true);
		setError("");
		window.cari
			.query({ ...q, offset })
			.then((r) => {
				if (id !== seq.current) return;
				setList((prev) => {
					const base = offset ? prev : [];
					const seen = new Set(base.map((s) => s.id));
					return [...base, ...r.stations.filter((s) => !seen.has(s.id))];
				});
				setHasMore(r.hasMore);
			})
			.catch((e: Error) => id === seq.current && setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")))
			.finally(() => id === seq.current && setLoading(false));
	};
	const offsetRef = useRef(0);
	useEffect(() => {
		setList([]);
		setHasMore(false);
		offsetRef.current = 0;
		if (q) run(0);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);
	const more = () => {
		offsetRef.current += 60;
		run(offsetRef.current);
	};
	return { list, loading, error, hasMore, more, retry: () => run(0) };
}

export function StationsPanel({ s, playing, onClose, onToggle }: { s: AppState; playing: boolean; onClose: () => void; onToggle: () => void }) {
	const [tab, setTab] = useState<Tab>(s.favorites.length > 1 ? "fav" : "top");
	const [text, setText] = useState("");
	const [search, setSearch] = useState("");
	const [genre, setGenre] = useState<{ label: string; tag: string } | null>(null);
	const [area, setArea] = useState<Area | null>(null);
	const [areas, setAreas] = useState<Area[] | null>(null);
	const [areasError, setAreasError] = useState("");
	const scope: Scope = s.scope;
	const input = useRef<HTMLInputElement>(null);
	const scroller = useRef<HTMLDivElement>(null);

	useEffect(() => {
		input.current?.focus();
	}, []);

	// Échap : efface la recherche, sinon ferme le panneau — où que soit le focus (ex. après un clic sur une station)
	const textRef = useRef(text);
	textRef.current = text;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			if (textRef.current) setText("");
			else onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	useEffect(() => {
		const t = window.setTimeout(() => setSearch(text.trim()), 300);
		return () => window.clearTimeout(t);
	}, [text]);

	// changement de périmètre : on remonte au niveau liste
	useEffect(() => {
		setArea(null);
		setAreas(null);
	}, [scope]);

	useEffect(() => {
		if (tab !== "areas" || areas) return;
		setAreasError("");
		window.cari
			.areas(scope)
			.then(setAreas)
			.catch((e: Error) => setAreasError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")));
	}, [tab, scope, areas]);

	const query: StationQuery | null = useMemo(() => {
		if (search.length >= 2) return { kind: "search", scope, value: search };
		if (tab === "top") return { kind: "top", scope };
		if (tab === "genres" && genre) return { kind: "tag", scope, value: genre.tag };
		if (tab === "areas" && area) return scope === "FR" ? { kind: "state", value: area.value } : { kind: "country", value: area.value };
		return null;
	}, [search, tab, scope, genre, area]);
	const res = useQuery(query);

	// Accolades obligatoires : dans Chromium récent, scrollTo() renvoie une Promise ; renvoyée par l'effet,
	// React la prendrait pour une fonction de nettoyage et planterait au changement suivant.
	useEffect(() => {
		scroller.current?.scrollTo({ top: 0 });
	}, [query ? JSON.stringify(query) : tab]);

	const favIds = new Set(s.favorites.map((f) => f.id));
	const row = (st: Station, extra?: Partial<Parameters<typeof StationRow>[0]>) => (
		<StationRow
			key={st.id}
			station={st}
			current={st.id === s.current.id}
			playing={playing}
			favorite={favIds.has(st.id)}
			onPlay={() => window.cari.selectStation(st)}
			onFav={() => window.cari.toggleFavorite(st)}
			{...extra}
		/>
	);

	const results = (
		<>
			<ul className="rows">{res.list.map((st) => row(st))}</ul>
			{res.loading && <div className="hint">Chargement…</div>}
			{res.error && (
				<div className="hint err">
					{res.error}{" "}
					<button className="link-btn" onClick={res.retry}>
						Réessayer
					</button>
				</div>
			)}
			{!res.loading && !res.error && !res.list.length && <div className="hint">Aucune station trouvée.</div>}
			{!res.loading && res.hasMore && (
				<button className="more" onClick={res.more}>
					Plus de stations
				</button>
			)}
		</>
	);

	let body: React.ReactNode;
	if (search.length >= 2) body = results;
	else if (tab === "fav")
		body = s.favorites.length ? (
			<ul className="rows">
				{s.favorites.map((f, i) =>
					row(f, { onMove: (d) => window.cari.moveFavorite(f.id, d), first: i === 0, last: i === s.favorites.length - 1 }),
				)}
			</ul>
		) : (
			<div className="hint">Touchez l'étoile d'une station pour l'ajouter ici. Les favoris sont aussi dans le menu Stations (⌘1 à ⌘9) et se parcourent depuis le Stream Deck.</div>
		);
	else if (tab === "top") body = results;
	else if (tab === "genres")
		body = genre ? (
			<>
				<button className="crumb" onClick={() => setGenre(null)}>
					<ChevronLeft /> Genres <span>· {genre.label}</span>
				</button>
				{results}
			</>
		) : (
			<div className="chips">
				{GENRES.map((g) => (
					<button key={g.tag} className="chip" onClick={() => setGenre(g)}>
						{g.label}
					</button>
				))}
			</div>
		);
	else
		body = area ? (
			<>
				<button className="crumb" onClick={() => setArea(null)}>
					<ChevronLeft /> {scope === "FR" ? "Régions" : "Pays"} <span>· {area.label}</span>
				</button>
				{results}
			</>
		) : areas ? (
			<ul className="areas">
				{areas.map((a) => (
					<li key={a.value} onClick={() => setArea(a)}>
						<span className="t">{a.label}</span>
						<span className="n">{a.count}</span>
						<ChevronRight />
					</li>
				))}
			</ul>
		) : areasError ? (
			<div className="hint err">
				{areasError}{" "}
				<button className="link-btn" onClick={() => setAreas(null)}>
					Réessayer
				</button>
			</div>
		) : (
			<div className="hint">Chargement…</div>
		);

	const TABS: [Tab, string][] = [
		["fav", "Favoris"],
		["top", "Populaires"],
		["genres", "Genres"],
		["areas", scope === "FR" ? "Régions" : "Pays"],
	];

	return (
		<div className="panel" role="dialog" aria-label="Stations">
			<header className="panel-head">
				<span className="panel-title">Stations</span>
				<button className="icon-btn close" onClick={onClose} aria-label="Fermer">
					<CloseIcon />
				</button>
			</header>

			<div className="panel-tools">
				<label className="search">
					<SearchIcon />
					<input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={scope === "FR" ? "Rechercher une radio française" : "Rechercher une radio"} spellCheck={false} />
					{text && (
						<button className="clear" onClick={() => setText("")} aria-label="Effacer">
							<CloseIcon size={9} />
						</button>
					)}
				</label>
				<div className="scope" role="group" aria-label="Périmètre">
					{(["FR", "ALL"] as Scope[]).map((sc) => (
						<button key={sc} className={scope === sc ? "on" : ""} onClick={() => window.cari.setScope(sc)}>
							{sc === "FR" ? "France" : "Monde"}
						</button>
					))}
				</div>
			</div>

			{search.length < 2 && (
				<nav className="tabs">
					{TABS.map(([id, label]) => (
						<button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
							{label}
							{id === "fav" && s.favorites.length > 0 && <span className="count">{s.favorites.length}</span>}
						</button>
					))}
				</nav>
			)}

			<div className="panel-body" ref={scroller}>
				{body}
				{tab !== "fav" || search.length >= 2 ? <div className="credit">Annuaire communautaire Radio Browser</div> : null}
			</div>
			<footer className="mini">
				<button className="mini-info" onClick={onClose} title="Revenir au lecteur">
					{s.track?.cover && !s.track.coverIsStation ? (
						<img className="logo" src={s.track.cover} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: "cover" }} draggable={false} />
					) : (
						<StationLogo station={s.current} size={30} radius={6} />
					)}
					<span className="meta">
						<span className="t">{s.track?.title || s.current.name}</span>
						<span className="a">{s.track ? [s.track.artist, s.current.name].filter(Boolean).join(" — ") : s.current.subtitle}</span>
					</span>
				</button>
				<button className="icon-btn" onClick={onToggle} aria-label={playing ? "Pause" : "Lecture"}>
					{playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
				</button>
			</footer>
		</div>
	);
}
