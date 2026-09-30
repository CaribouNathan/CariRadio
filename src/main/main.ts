// CariRadio — processus principal Electron.
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions,
	nativeImage,
	nativeTheme,
	type Rectangle,
	session,
	shell,
	Tray,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { alternatives, countries, frenchRegions, queryStations, reportClick, type Scope, stationById, type StationQuery } from "./catalog.js";
import { MetadataPoller, type Track } from "./radio.js";
import { Recording } from "./recorder.js";
import { startControlServer, type Command } from "./server.js";
import { brief, CHOCO, CONTROL_PORT, isStation, NATIVE, type Station } from "./station.js";
import { HistoryStore, LikesStore, songKey } from "./store.js";
import { probeStream, type StreamInfo } from "./streaminfo.js";

nativeTheme.themeSource = "system";

// ---------- journal d'erreurs ----------
// ~/Library/Logs/CariRadio/cariradio.log — menu Aide > Afficher le journal d'erreurs.
const logFile = () => path.join(app.getPath("logs"), "cariradio.log");
function log(...parts: unknown[]): void {
	try {
		fs.mkdirSync(path.dirname(logFile()), { recursive: true });
		const line = parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === "string" ? p : JSON.stringify(p))).join(" ");
		fs.appendFileSync(logFile(), `${new Date().toISOString()} v${app.getVersion()} ${line}\n`);
	} catch {
		/* le journal ne doit jamais faire planter l'app */
	}
}
process.on("uncaughtException", (e) => log("[main] exception :", e));
process.on("unhandledRejection", (e) => log("[main] promesse rejetée :", e));

// ---------- micro : jamais ----------
// CariRadio ne fait que lire des flux. On coupe l'entrée audio de Chromium à la racine (aucun périphérique
// d'entrée n'est ouvert ni énuméré) et on refuse toute demande de capture côté page.
app.commandLine.appendSwitch("disable-audio-input");
const CAPTURE_PERMISSIONS = new Set(["media", "audioCapture", "videoCapture", "microphone", "camera", "speaker-selection", "display-capture"]);

type AudioStatus = "idle" | "loading" | "playing" | "paused" | "error";

/** Commandes transmises au lecteur (renderer). */
type RendererCommand =
	| { type: "play" }
	| { type: "pause" }
	| { type: "toggle" }
	| { type: "stop" }
	| { type: "volume"; value: number }
	| { type: "volumeStep"; delta: number }
	| { type: "load"; stream: string; hls: boolean; play: boolean }
	| { type: "openStations" };

// Une seule instance : un second lancement (ex. depuis le Stream Deck) réveille la première.
if (!app.requestSingleInstanceLock()) app.exit(0);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let rendererReady = false;
let pendingAutoplay = process.argv.includes("--autoplay");

// ---------- réglages persistants ----------
interface Config {
	volume: number;
	station: Station;
	favorites: Station[];
	scope: Scope;
	/** dossier des enregistrements ("" = ~/Music/CariRadio) */
	recordDir: string;
	compact: boolean;
	/** mode compact : fenêtre toujours au premier plan */
	onTop: boolean;
	/** taille de la fenêtre normale (restaurée en sortant du mode compact) */
	bounds: Rectangle | null;
	/** icône dans la barre des menus */
	tray: boolean;
}
const DEFAULTS: Config = { volume: 70, station: CHOCO, favorites: [CHOCO], scope: "FR", recordDir: "", compact: false, onTop: true, bounds: null, tray: true };
const configPath = () => path.join(app.getPath("userData"), "config.json");
function loadConfig(): Config {
	let c: Partial<Config> & Record<string, unknown> = {};
	try {
		c = JSON.parse(fs.readFileSync(configPath(), "utf8"));
	} catch {
		/* premier lancement */
	}
	// les stations natives sont toujours relues depuis le code (URL / API à jour)
	const fresh = (s: Station) => NATIVE.find((n) => n.id === s.id) ?? s;
	const b = c.bounds as Rectangle | null | undefined;
	return {
		volume: Number.isFinite(c.volume) ? Number(c.volume) : 70,
		station: isStation(c.station) ? fresh(c.station) : CHOCO,
		favorites: Array.isArray(c.favorites) ? c.favorites.filter(isStation).map(fresh) : [CHOCO],
		scope: c.scope === "ALL" ? "ALL" : "FR",
		recordDir: typeof c.recordDir === "string" ? c.recordDir : "",
		compact: c.compact === true,
		onTop: c.onTop !== false,
		bounds: b && [b.x, b.y, b.width, b.height].every(Number.isFinite) ? b : null,
		tray: c.tray !== false,
	};
}
let saveTimer: NodeJS.Timeout | null = null;
function saveConfig(): void {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			fs.mkdirSync(path.dirname(configPath()), { recursive: true });
			fs.writeFileSync(configPath(), JSON.stringify(cfg, null, "\t"));
		} catch {
			/* non bloquant */
		}
	}, 800);
}

let cfg: Config = { ...DEFAULTS };
const audio: {
	status: AudioStatus;
	error: string;
	/** coupures depuis le chargement du flux (attentes / erreurs après le début de la lecture) */
	dropouts: number;
	/** secondes d'audio en avance dans le tampon */
	buffer: number;
	hls: { bitrate: number; codec: string } | null;
} = { status: "idle", error: "", dropouts: 0, buffer: 0, hls: null };

let history: HistoryStore;
let likes: LikesStore;

// ---------- source de secours ----------
// Si le flux ne répond plus (3 échecs d'affilée), on essaie les autres fiches Radio Browser de la même radio.
const fb: {
	stationId: string;
	alts: Station[] | null;
	tried: Set<string>;
	active: Station | null;
	searching: boolean;
	message: string;
} = { stationId: "", alts: null, tried: new Set(), active: null, searching: false, message: "" };

function resetFallback(): void {
	Object.assign(fb, { stationId: "", alts: null, tried: new Set<string>(), active: null, searching: false, message: "" });
}

/** Station réellement lue : la station choisie, ou sa source de secours (même identité, autre flux). */
function eff(): Station {
	const a = fb.active;
	return a ? { ...cfg.station, stream: a.stream, hls: a.hls, codec: a.codec || cfg.station.codec, bitrate: a.bitrate || cfg.station.bitrate } : cfg.station;
}

async function tryFallback(): Promise<void> {
	const st = cfg.station;
	fb.searching = true;
	fb.message = "";
	pushState();
	try {
		if (fb.stationId !== st.id || !fb.alts) {
			fb.stationId = st.id;
			fb.tried = new Set([st.stream]);
			fb.alts = await alternatives(st);
		}
		if (cfg.station.id !== st.id) return; // l'utilisateur a changé de station entre-temps
		const next = fb.alts.find((a) => !fb.tried.has(a.stream));
		if (!next) {
			fb.message = fb.alts.length ? "Aucune autre source de cette radio ne répond" : "Aucune autre source connue pour cette radio";
			return;
		}
		fb.tried.add(next.stream);
		fb.active = next;
		log("[source] bascule :", st.name, "→", next.stream);
		poller.setStation(eff());
		quality.info = null;
		toRenderer({ type: "load", stream: next.stream, hls: next.hls, play: true });
	} catch (e) {
		fb.message = "Recherche d'une autre source impossible";
		log("[source]", e);
	} finally {
		fb.searching = false;
		buildMenus();
		pushState();
	}
}

/** Adopte définitivement la source de secours pour cette station (et son favori). */
function keepFallback(): void {
	if (!fb.active) return;
	const kept = eff();
	cfg.station = kept;
	cfg.favorites = cfg.favorites.map((f) => (f.id === kept.id ? kept : f));
	fb.active = null;
	fb.tried = new Set([kept.stream]);
	saveConfig();
	buildMenus();
	pushState();
}

// ---------- qualité du flux ----------
const quality: { info: StreamInfo | null; probing: boolean; stream: string } = { info: null, probing: false, stream: "" };
async function probeQuality(): Promise<void> {
	const st = eff();
	if (st.hls || quality.probing || (quality.info && quality.stream === st.stream)) return;
	quality.probing = true;
	try {
		const info = await probeStream(st.stream);
		if (eff().stream === st.stream) {
			quality.info = info;
			quality.stream = st.stream;
		}
	} catch (e) {
		log("[qualité]", st.stream, e);
	} finally {
		quality.probing = false;
		pushState();
	}
}

// ---------- métadonnées + historique persistant ----------
const poller = new MetadataPoller(() => {
	const cur = poller.current;
	recording?.noteSong(cur);
	if (cur) likes?.enrich(cur);
	history?.merge(cfg.station.id, cur ? [cur, ...poller.history] : poller.history);
	pushState();
	updateTray();
});

/** Historique affiché : ce qu'on a gardé pour cette station, sans le morceau en cours. */
function stationHistory(): Track[] {
	const cur = poller.current;
	return history
		.get(cfg.station.id)
		.filter((t) => !(cur && songKey(t) === songKey(cur) && Math.abs((t.startedAt || 0) - (cur.startedAt || 0)) < 180_000));
}

// ---------- enregistrement ----------
const recordDir = () => cfg.recordDir || path.join(app.getPath("music"), "CariRadio");
let recording: Recording | null = null;
let lastRecording: { file: string; path: string; at: number } | null = null;
let recordTicker: NodeJS.Timeout | null = null;
let recordError = "";

function startRecording(): void {
	if (recording) return;
	const st = eff();
	if (st.hls) {
		recordError = "Enregistrement impossible : cette station diffuse en HLS";
		pushState();
		return;
	}
	recordError = "";
	const cur = poller.current;
	const rec = new Recording(st.stream, { name: st.name, codec: st.codec }, recordDir(), cur ? { artist: cur.artist, title: cur.title } : null, () => pushState());
	recording = rec;
	recordTicker = setInterval(() => pushState(), 1000); // durée et taille à jour
	rec.start().catch((e) => {
		recordError = e instanceof Error ? e.message : String(e);
		log("[rec] démarrage :", e);
		void stopRecording();
	});
	buildMenus();
	pushState();
	updateTray();
}

async function stopRecording(): Promise<void> {
	const rec = recording;
	if (!rec) return;
	recording = null;
	if (recordTicker) clearInterval(recordTicker);
	recordTicker = null;
	const file = await rec.stop();
	if (file) lastRecording = { file: path.basename(file), path: file, at: Date.now() };
	else if (!recordError) recordError = rec.error ? `Enregistrement vide : ${rec.error}` : "Enregistrement vide";
	if (rec.error) log("[rec]", rec.error);
	buildMenus();
	pushState();
	updateTray();
}

function revealRecordings(): void {
	if (lastRecording && fs.existsSync(lastRecording.path)) return shell.showItemInFolder(lastRecording.path);
	fs.mkdirSync(recordDir(), { recursive: true });
	void shell.openPath(recordDir());
}

async function chooseRecordDir(): Promise<void> {
	const r = await dialog.showOpenDialog({ title: "Dossier des enregistrements", defaultPath: recordDir(), properties: ["openDirectory", "createDirectory"] });
	if (r.canceled || !r.filePaths[0]) return;
	cfg.recordDir = r.filePaths[0];
	saveConfig();
	pushState();
}

const toggleRecording = () => (recording ? void stopRecording() : startRecording());

// ---------- morceaux aimés ----------
function toggleLike(): void {
	const cur = poller.current;
	if (!cur?.title) return;
	likes.toggle(cur, { id: cfg.station.id, name: cfg.station.name });
	buildMenus();
	pushState();
	updateTray();
}

const isFavorite = (id: string) => cfg.favorites.some((f) => f.id === id);

const hostOf = (u: string) => {
	try {
		return new URL(u).hostname;
	} catch {
		return "";
	}
};

function state() {
	const st = cfg.station;
	const cur = poller.current;
	const e = eff();
	// morceau sans pochette : on expose le logo de la station (lu tel quel par CariMusicDeck)
	const track = cur ? { ...cur, cover: cur.cover || st.favicon, coverIsStation: !cur.cover && !!st.favicon, liked: likes.has(cur) } : null;
	return {
		app: "CariRadio",
		version: app.getVersion(),
		station: {
			id: st.id,
			name: st.name,
			subtitle: st.subtitle,
			site: st.homepage,
			favicon: st.favicon,
			codec: e.codec,
			bitrate: e.bitrate,
			stream: e.stream,
			hls: e.hls,
			native: !!st.radioking,
			favorite: isFavorite(st.id),
		},
		/** fiche complète de la station en cours et des favoris (le renderer en a besoin pour les relancer) */
		current: st,
		favorites: cfg.favorites,
		scope: cfg.scope,
		status: audio.status,
		volume: cfg.volume,
		error: audio.error || poller.error,
		track,
		/** image à afficher : pochette du morceau, sinon logo de la station */
		artwork: cur?.cover || st.favicon,
		history: stationHistory(),
		likes: likes.list(),
		recording: {
			available: !e.hls,
			...(recording ? recording.info() : { active: false, startedAt: 0, bytes: 0, file: "", error: "" }),
			error: recording?.info().error || recordError,
			dir: recordDir(),
			last: lastRecording,
		},
		quality: {
			info: quality.info && quality.stream === e.stream ? quality.info : null,
			probing: quality.probing,
			dropouts: audio.dropouts,
			buffer: audio.buffer,
			hls: e.hls ? audio.hls : null,
		},
		source: {
			fallback: !!fb.active,
			fallbackName: fb.active?.name ?? "",
			host: hostOf(e.stream),
			searching: fb.searching,
			message: fb.message,
		},
		compact: cfg.compact,
		onTop: cfg.onTop,
		serverTime: Date.now(),
	};
}

const stationsPayload = () => ({ current: cfg.station.id, stations: cfg.favorites.map(brief) });

function pushState(): void {
	win?.webContents.send("state", state());
}

function toRenderer(c: RendererCommand): void {
	if (!win || !rendererReady) {
		if (c.type === "play" || c.type === "toggle" || (c.type === "load" && c.play)) pendingAutoplay = true;
		return;
	}
	win.webContents.send("command", c);
}

// ---------- stations ----------
function selectStation(st: Station, play = true): void {
	const changed = st.id !== cfg.station.id || st.stream !== cfg.station.stream || !!fb.active;
	if (changed && recording) void stopRecording(); // un fichier = une station
	if (changed) resetFallback();
	cfg.station = st;
	// un favori garde la version la plus récente de sa fiche
	cfg.favorites = cfg.favorites.map((f) => (f.id === st.id ? st : f));
	saveConfig();
	if (changed) {
		poller.setStation(st);
		audio.dropouts = 0;
		audio.hls = null;
	}
	buildMenus();
	pushState();
	updateTray();
	if (play) reportClick(st.id);
	toRenderer({ type: "load", stream: st.stream, hls: st.hls, play: play || audio.status === "playing" || audio.status === "loading" });
}

async function selectStationById(id: string): Promise<void> {
	const known = [...cfg.favorites, ...NATIVE, cfg.station].find((s) => s.id === id);
	if (known) return selectStation(known);
	try {
		const st = await stationById(id);
		if (st) selectStation(st);
	} catch (e) {
		log("[station] introuvable :", id, e);
	}
}

function stepStation(delta: number): void {
	const list = cfg.favorites;
	if (!list.length) return;
	const i = list.findIndex((f) => f.id === cfg.station.id);
	const next = i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
	selectStation(list[next]);
}

function toggleFavorite(st: Station): void {
	cfg.favorites = isFavorite(st.id) ? cfg.favorites.filter((f) => f.id !== st.id) : [...cfg.favorites, st];
	saveConfig();
	buildMenus();
	pushState();
}

function setFavorites(list: Station[]): void {
	cfg.favorites = list;
	saveConfig();
	buildMenus();
	pushState();
}

function moveFavorite(id: string, delta: number): void {
	const i = cfg.favorites.findIndex((f) => f.id === id);
	const j = i + delta;
	if (i < 0 || j < 0 || j >= cfg.favorites.length) return;
	const list = [...cfg.favorites];
	[list[i], list[j]] = [list[j], list[i]];
	setFavorites(list);
}

// ---------- commandes (menus, barre des menus, API locale) ----------
function command(c: Command): void {
	switch (c.type) {
		case "show":
			return showWindow();
		case "station":
			return void selectStationById(c.id);
		case "stationStep":
			return stepStation(c.delta);
		case "record":
			if (c.action === "start") return startRecording();
			if (c.action === "stop") return void stopRecording();
			return toggleRecording();
		case "like":
			return toggleLike();
		case "compact":
			return setCompact(!cfg.compact);
		case "play":
		case "toggle":
			poller.refresh();
			return toRenderer(c);
		default:
			return toRenderer(c);
	}
}

// ---------- fenêtre + mode compact ----------
const NORMAL = { width: 380, height: 760, minWidth: 340, minHeight: 600 };
const COMPACT = { width: 380, height: 136, minWidth: 320 };

function showWindow(): void {
	if (!win) createWindow();
	win!.show();
	win!.focus();
}

function applyWindowMode(animate: boolean): void {
	if (!win) return;
	if (cfg.compact) {
		win.setMinimumSize(COMPACT.minWidth, COMPACT.height);
		win.setMaximumSize(1200, COMPACT.height);
		const b = win.getBounds();
		win.setBounds({ x: b.x, y: b.y, width: Math.min(b.width, 520), height: COMPACT.height }, animate);
		win.setAlwaysOnTop(cfg.onTop, "floating");
		win.setVisibleOnAllWorkspaces(cfg.onTop, { visibleOnFullScreen: true });
	} else {
		win.setMaximumSize(0, 0); // 0 = sans limite
		win.setMinimumSize(NORMAL.minWidth, NORMAL.minHeight);
		const b = cfg.bounds;
		const cur = win.getBounds();
		win.setBounds(b ? { ...b, x: cur.x, y: cur.y } : { x: cur.x, y: cur.y, width: NORMAL.width, height: NORMAL.height }, animate);
		win.setAlwaysOnTop(false);
		win.setVisibleOnAllWorkspaces(false);
	}
}

function setCompact(on: boolean): void {
	if (on === cfg.compact) return;
	if (on && win) cfg.bounds = win.getBounds(); // taille normale à restaurer
	cfg.compact = on;
	saveConfig();
	applyWindowMode(true);
	buildMenus();
	pushState();
	showWindow();
}

function setOnTop(on: boolean): void {
	cfg.onTop = on;
	saveConfig();
	applyWindowMode(false);
	buildMenus();
	pushState();
}

function createWindow(): void {
	const b = cfg.bounds;
	win = new BrowserWindow({
		width: cfg.compact ? COMPACT.width : (b?.width ?? NORMAL.width),
		height: cfg.compact ? COMPACT.height : (b?.height ?? NORMAL.height),
		minWidth: cfg.compact ? COMPACT.minWidth : NORMAL.minWidth,
		minHeight: cfg.compact ? COMPACT.height : NORMAL.minHeight,
		title: "CariRadio",
		titleBarStyle: "hiddenInset",
		vibrancy: "under-window",
		visualEffectState: "active",
		backgroundColor: "#00000000",
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			backgroundThrottling: false, // la lecture et les métadonnées continuent fenêtre masquée
			autoplayPolicy: "no-user-gesture-required",
		},
	});
	win.loadFile(path.join(__dirname, "renderer", "index.html"));
	win.once("ready-to-show", () => win?.show());
	applyWindowMode(false);
	// mémorise la taille de la fenêtre normale
	win.on("resized", () => {
		if (win && !cfg.compact) {
			cfg.bounds = win.getBounds();
			saveConfig();
		}
	});
	// erreurs du renderer (dont celles attrapées par le filet d'affichage) → journal
	win.webContents.on("console-message", (...args: unknown[]) => {
		const ev = args[0] as { level?: string | number; message?: string };
		const level = ev?.level ?? args[1];
		const message = ev?.message ?? args[2];
		if (level === "error" || level === 3) log("[renderer]", String(message));
	});
	// processus d'affichage tué (mémoire, GPU…) : on journalise et on recharge au lieu de laisser une fenêtre vide
	win.webContents.on("render-process-gone", (_e, details) => {
		log("[renderer] processus arrêté :", details);
		if (details.reason !== "clean-exit") setTimeout(() => win?.webContents.reload(), 500);
	});
	// Fermer la fenêtre ne coupe pas la radio (comme Musique) ; ⌘Q pour quitter.
	win.on("close", (e) => {
		if (!quitting) {
			e.preventDefault();
			win?.hide();
		}
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https:\/\//.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
}

// ---------- barre des menus ----------
function trayMenu(): Menu {
	const cur = poller.current;
	const playing = audio.status === "playing" || audio.status === "loading";
	const st = cfg.station;
	const items: MenuItemConstructorOptions[] = [
		{ label: `${playing ? "▶︎" : "❚❚"}  ${st.name}${st.subtitle ? ` · ${st.subtitle}` : ""}`, enabled: false },
		...(cur?.title ? [{ label: `${cur.artist ? `${cur.artist} — ` : ""}${cur.title}`.slice(0, 70), enabled: false } as MenuItemConstructorOptions] : []),
		{ type: "separator" },
		{ label: playing ? "Pause" : "Lecture", click: () => command({ type: "toggle" }) },
		{ label: cur && likes.has(cur) ? "♥︎ Retirer des morceaux aimés" : "♡ J'aime ce morceau", enabled: !!cur?.title, click: toggleLike },
		{ label: recording ? "■ Arrêter l'enregistrement" : "● Enregistrer le flux", enabled: !!recording || !eff().hls, click: toggleRecording },
		{ type: "separator" },
		...cfg.favorites.slice(0, 15).map((f) => ({ label: f.name, type: "radio" as const, checked: f.id === st.id, click: () => selectStation(f) })),
		...(cfg.favorites.length ? [{ type: "separator" } as MenuItemConstructorOptions] : []),
		{ label: "Volume +", click: () => command({ type: "volumeStep", delta: 10 }) },
		{ label: "Volume −", click: () => command({ type: "volumeStep", delta: -10 }) },
		{ type: "separator" },
		{ label: "Mode compact", type: "checkbox", checked: cfg.compact, click: () => setCompact(!cfg.compact) },
		{ label: "Afficher CariRadio", click: showWindow },
		{ type: "separator" },
		{ label: "Quitter CariRadio", click: () => app.quit() },
	];
	return Menu.buildFromTemplate(items);
}

function setupTray(): void {
	if (!cfg.tray) {
		tray?.destroy();
		tray = null;
		return;
	}
	if (tray) return;
	const img = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png"));
	img.setTemplateImage(true);
	tray = new Tray(img);
	tray.setIgnoreDoubleClickEvents(true);
	// menu reconstruit à chaque ouverture : toujours à jour sans le régénérer à chaque changement d'état
	const open = () => tray?.popUpContextMenu(trayMenu());
	tray.on("click", open);
	tray.on("right-click", open);
	updateTray();
}

function updateTray(): void {
	if (!tray) return;
	const cur = poller.current;
	const song = cur?.title ? `${cur.artist ? `${cur.artist} — ` : ""}${cur.title}` : "";
	tray.setToolTip([`CariRadio — ${cfg.station.name}`, song].filter(Boolean).join("\n"));
	tray.setTitle(recording ? " REC" : ""); // rappel discret à côté de l'icône pendant un enregistrement
}

function setTrayEnabled(on: boolean): void {
	cfg.tray = on;
	saveConfig();
	setupTray();
	buildMenus();
}

// ---------- menus de l'application ----------
function buildMenus(): void {
	const favItems: MenuItemConstructorOptions[] = cfg.favorites.map((f, i) => ({
		label: f.subtitle ? `${f.name} — ${f.subtitle}` : f.name,
		type: "radio",
		checked: f.id === cfg.station.id,
		accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
		click: () => selectStation(f),
	}));
	const fav = isFavorite(cfg.station.id);
	const cur = poller.current;
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				role: "appMenu",
				submenu: [
					{ role: "about" },
					{ type: "separator" },
					{ label: "Icône dans la barre des menus", type: "checkbox", checked: cfg.tray, click: () => setTrayEnabled(!cfg.tray) },
					{ type: "separator" },
					{ role: "hide" },
					{ role: "hideOthers" },
					{ role: "unhide" },
					{ type: "separator" },
					{ role: "quit" },
				],
			},
			{ role: "editMenu" },
			{
				label: "Commandes",
				submenu: [
					// Espace est géré par la fenêtre (hors champ de saisie) : pas d'accélérateur global,
					// sinon il serait impossible de taper une espace dans la recherche.
					{ label: "Lecture / Pause", accelerator: "Space", registerAccelerator: false, click: () => command({ type: "toggle" }) },
					{ type: "separator" },
					{ label: "Monter le volume", accelerator: "CmdOrCtrl+Up", click: () => command({ type: "volumeStep", delta: 5 }) },
					{ label: "Baisser le volume", accelerator: "CmdOrCtrl+Down", click: () => command({ type: "volumeStep", delta: -5 }) },
					{ type: "separator" },
					{ label: cur && likes.has(cur) ? "Retirer des morceaux aimés" : "J'aime ce morceau", accelerator: "CmdOrCtrl+L", enabled: !!cur?.title, click: toggleLike },
					{ type: "separator" },
					{
						label: recording ? "Arrêter l'enregistrement" : "Enregistrer le flux",
						accelerator: "CmdOrCtrl+R",
						enabled: !!recording || !eff().hls,
						click: toggleRecording,
					},
					{ label: "Afficher les enregistrements", click: () => revealRecordings() },
					{ label: "Dossier des enregistrements…", click: () => void chooseRecordDir() },
				],
			},
			{
				label: "Stations",
				submenu: [
					{
						label: "Choisir une station…",
						accelerator: "CmdOrCtrl+K",
						click: () => {
							if (cfg.compact) setCompact(false);
							showWindow();
							toRenderer({ type: "openStations" });
						},
					},
					{ type: "separator" },
					...(favItems.length ? favItems : [{ label: "Aucun favori", enabled: false } as MenuItemConstructorOptions]),
					{ type: "separator" },
					{ label: "Favori suivant", accelerator: "CmdOrCtrl+]", enabled: cfg.favorites.length > 0, click: () => stepStation(1) },
					{ label: "Favori précédent", accelerator: "CmdOrCtrl+[", enabled: cfg.favorites.length > 0, click: () => stepStation(-1) },
					{ type: "separator" },
					{ label: fav ? "Retirer des favoris" : "Ajouter aux favoris", accelerator: "CmdOrCtrl+D", click: () => toggleFavorite(cfg.station) },
					{ label: "Garder la source de secours", enabled: !!fb.active, click: keepFallback },
					{ label: "Site de la station", enabled: !!cfg.station.homepage, click: () => void shell.openExternal(cfg.station.homepage) },
				],
			},
			{
				label: "Présentation",
				submenu: [
					{ label: "Mode compact", type: "checkbox", checked: cfg.compact, accelerator: "CmdOrCtrl+Shift+M", click: () => setCompact(!cfg.compact) },
					{ label: "Mode compact au premier plan", type: "checkbox", checked: cfg.onTop, click: () => setOnTop(!cfg.onTop) },
				],
			},
			{ role: "windowMenu" },
			{
				role: "help",
				submenu: [
					{ label: "Afficher le journal d'erreurs", click: () => (fs.existsSync(logFile()) ? shell.showItemInFolder(logFile()) : void shell.openPath(path.dirname(logFile()))) },
				],
			},
		]),
	);
	app.dock?.setMenu(
		Menu.buildFromTemplate([
			{ label: "Lecture / Pause", click: () => command({ type: "toggle" }) },
			{ type: "separator" },
			...cfg.favorites.slice(0, 12).map((f) => ({ label: f.name, type: "radio" as const, checked: f.id === cfg.station.id, click: () => selectStation(f) })),
		]),
	);
}

// ---------- IPC ----------
ipcMain.handle("renderer-ready", () => {
	rendererReady = true;
	const s = state();
	if (pendingAutoplay) {
		pendingAutoplay = false;
		setTimeout(() => command({ type: "play" }), 50);
	}
	return s;
});
ipcMain.on(
	"audio-state",
	(
		_e,
		a: { status: AudioStatus; volume: number; error?: string; retries?: number; dropouts?: number; buffer?: number; hls?: { bitrate: number; codec: string } | null },
	) => {
		const vol = Math.round(a.volume);
		if (vol !== cfg.volume) {
			cfg.volume = vol;
			saveConfig();
		}
		const was = audio.status;
		audio.status = a.status;
		audio.error = a.error ?? "";
		audio.dropouts = Number(a.dropouts) || 0;
		audio.buffer = Number(a.buffer) || 0;
		audio.hls = a.hls ?? null;
		poller.setActive(a.status === "playing" || a.status === "loading");
		if (a.status === "playing") {
			fb.message = "";
			void probeQuality();
		}
		// 3e échec d'affilée : on cherche une autre source de la même radio
		if (a.status === "error" && (a.retries ?? 0) >= 2 && !fb.searching) void tryFallback();
		if (was !== a.status) updateTray();
		pushState();
	},
);
ipcMain.on("open-external", (_e, url: string) => {
	if (typeof url === "string" && /^https:\/\//.test(url)) void shell.openExternal(url);
});
ipcMain.on("record-toggle", () => toggleRecording());
ipcMain.on("reveal-recording", () => revealRecordings());
ipcMain.on("like-toggle", () => toggleLike());
ipcMain.on("like-remove", (_e, id: string) => {
	likes.remove(String(id));
	buildMenus();
	pushState();
});
ipcMain.on("keep-fallback", () => keepFallback());
ipcMain.on("set-compact", (_e, on: boolean) => setCompact(!!on));
ipcMain.handle("catalog-query", (_e, q: StationQuery) => queryStations(q));
ipcMain.handle("catalog-areas", (_e, scope: Scope) => (scope === "ALL" ? countries() : frenchRegions()));
ipcMain.on("select-station", (_e, st: unknown) => {
	if (isStation(st)) selectStation(st);
});
ipcMain.on("toggle-favorite", (_e, st: unknown) => {
	if (isStation(st)) toggleFavorite(st);
});
ipcMain.on("reorder-favorites", (_e, ids: unknown) => {
	if (!Array.isArray(ids)) return;
	const byId = new Map(cfg.favorites.map((f) => [f.id, f]));
	const next = ids.map((id) => byId.get(String(id))).filter((f): f is Station => !!f);
	// sécurité : un favori absent de la liste reçue n'est jamais perdu
	for (const f of cfg.favorites) if (!next.includes(f)) next.push(f);
	setFavorites(next);
});
ipcMain.on("move-favorite", (_e, id: string, delta: number) => moveFavorite(String(id), Math.sign(Number(delta))));
ipcMain.on("step-station", (_e, delta: number) => stepStation(Math.sign(Number(delta)) || 1));
ipcMain.on("set-scope", (_e, scope: Scope) => {
	cfg.scope = scope === "ALL" ? "ALL" : "FR";
	saveConfig();
	pushState();
});

// ---------- cycle de vie ----------
app.on("second-instance", (_e, argv) => {
	if (argv.includes("--autoplay")) command({ type: "play" });
	showWindow();
});
app.on("activate", () => showWindow());
app.on("before-quit", (e) => {
	quitting = true;
	history?.flush();
	likes?.flush();
	// on termine proprement l'enregistrement (fermeture + renommage du fichier) avant de quitter
	if (recording) {
		e.preventDefault();
		void stopRecording().finally(() => app.quit());
	}
});

app.whenReady().then(() => {
	session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); // l'app n'a besoin d'aucune permission
	session.defaultSession.setPermissionCheckHandler((_wc, permission) => !CAPTURE_PERMISSIONS.has(permission));
	session.defaultSession.setDevicePermissionHandler(() => false);
	cfg = loadConfig();
	history = new HistoryStore(app.getPath("userData"));
	likes = new LikesStore(app.getPath("userData"));
	buildMenus();
	createWindow();
	setupTray();
	poller.setStation(cfg.station);
	startControlServer(CONTROL_PORT, state, stationsPayload, command);
});
