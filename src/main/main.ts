// CariRadio — processus principal Electron.
import { app, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { countries, frenchRegions, queryStations, reportClick, type Scope, stationById, type StationQuery } from "./catalog.js";
import { MetadataPoller } from "./radio.js";
import { startControlServer, type Command } from "./server.js";
import { brief, CHOCO, CONTROL_PORT, isStation, NATIVE, type Station } from "./station.js";

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
let quitting = false;
let rendererReady = false;
let pendingAutoplay = process.argv.includes("--autoplay");

// ---------- réglages persistants ----------
interface Config {
	volume: number;
	station: Station;
	favorites: Station[];
	scope: Scope;
}
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
	const favorites = Array.isArray(c.favorites) ? c.favorites.filter(isStation).map(fresh) : [CHOCO];
	return {
		volume: Number.isFinite(c.volume) ? Number(c.volume) : 70,
		station: isStation(c.station) ? fresh(c.station) : CHOCO,
		favorites,
		scope: c.scope === "ALL" ? "ALL" : "FR",
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

let cfg: Config = { volume: 70, station: CHOCO, favorites: [CHOCO], scope: "FR" };
const audio: { status: AudioStatus; error: string } = { status: "idle", error: "" };

const poller = new MetadataPoller(() => pushState());

const isFavorite = (id: string) => cfg.favorites.some((f) => f.id === id);

function state() {
	const st = cfg.station;
	const cur = poller.current;
	// morceau sans pochette : on expose le logo de la station (lu tel quel par CariCover)
	const track = cur ? { ...cur, cover: cur.cover || st.favicon, coverIsStation: !cur.cover && !!st.favicon } : null;
	return {
		app: "CariRadio",
		version: app.getVersion(),
		station: {
			id: st.id,
			name: st.name,
			subtitle: st.subtitle,
			site: st.homepage,
			favicon: st.favicon,
			codec: st.codec,
			bitrate: st.bitrate,
			stream: st.stream,
			hls: st.hls,
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
		history: poller.history,
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
	const changed = st.id !== cfg.station.id || st.stream !== cfg.station.stream;
	cfg.station = st;
	// un favori garde la version la plus récente de sa fiche
	cfg.favorites = cfg.favorites.map((f) => (f.id === st.id ? st : f));
	saveConfig();
	if (changed) poller.setStation(st);
	buildMenus();
	pushState();
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
		console.error("[CariRadio] station introuvable :", id, e);
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

function moveFavorite(id: string, delta: number): void {
	const i = cfg.favorites.findIndex((f) => f.id === id);
	const j = i + delta;
	if (i < 0 || j < 0 || j >= cfg.favorites.length) return;
	const list = [...cfg.favorites];
	[list[i], list[j]] = [list[j], list[i]];
	cfg.favorites = list;
	saveConfig();
	buildMenus();
	pushState();
}

// ---------- commandes (menus, API locale) ----------
function command(c: Command): void {
	switch (c.type) {
		case "show":
			return showWindow();
		case "station":
			return void selectStationById(c.id);
		case "stationStep":
			return stepStation(c.delta);
		case "play":
		case "toggle":
			poller.refresh();
			return toRenderer(c);
		default:
			return toRenderer(c);
	}
}

function showWindow(): void {
	if (!win) createWindow();
	win!.show();
	win!.focus();
}

function createWindow(): void {
	win = new BrowserWindow({
		width: 380,
		height: 760,
		minWidth: 340,
		minHeight: 600,
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

function buildMenus(): void {
	const favItems: MenuItemConstructorOptions[] = cfg.favorites.map((f, i) => ({
		label: f.subtitle ? `${f.name} — ${f.subtitle}` : f.name,
		type: "radio",
		checked: f.id === cfg.station.id,
		accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
		click: () => selectStation(f),
	}));
	const fav = isFavorite(cfg.station.id);
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{ role: "appMenu" },
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
				],
			},
			{
				label: "Stations",
				submenu: [
					{
						label: "Choisir une station…",
						accelerator: "CmdOrCtrl+K",
						click: () => {
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
					{ label: "Site de la station", enabled: !!cfg.station.homepage, click: () => void shell.openExternal(cfg.station.homepage) },
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
ipcMain.on("audio-state", (_e, a: { status: AudioStatus; volume: number; error?: string }) => {
	const vol = Math.round(a.volume);
	if (vol !== cfg.volume) {
		cfg.volume = vol;
		saveConfig();
	}
	audio.status = a.status;
	audio.error = a.error ?? "";
	poller.setActive(a.status === "playing" || a.status === "loading");
	pushState();
});
ipcMain.on("open-external", (_e, url: string) => {
	if (typeof url === "string" && /^https:\/\//.test(url)) void shell.openExternal(url);
});
ipcMain.handle("catalog-query", (_e, q: StationQuery) => queryStations(q));
ipcMain.handle("catalog-areas", (_e, scope: Scope) => (scope === "ALL" ? countries() : frenchRegions()));
ipcMain.on("select-station", (_e, st: unknown) => {
	if (isStation(st)) selectStation(st);
});
ipcMain.on("toggle-favorite", (_e, st: unknown) => {
	if (isStation(st)) toggleFavorite(st);
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
app.on("before-quit", () => {
	quitting = true;
});

app.whenReady().then(() => {
	session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); // l'app n'a besoin d'aucune permission
	session.defaultSession.setPermissionCheckHandler((_wc, permission) => !CAPTURE_PERMISSIONS.has(permission));
	session.defaultSession.setDevicePermissionHandler(() => false);
	cfg = loadConfig();
	buildMenus();
	createWindow();
	poller.setStation(cfg.station);
	startControlServer(CONTROL_PORT, state, stationsPayload, command);
});
