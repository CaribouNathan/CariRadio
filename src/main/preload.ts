// Pont sécurisé renderer ↔ processus principal.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cari", {
	ready: () => ipcRenderer.invoke("renderer-ready"),
	onState: (cb: (s: unknown) => void) => ipcRenderer.on("state", (_e, s) => cb(s)),
	onCommand: (cb: (c: unknown) => void) => ipcRenderer.on("command", (_e, c) => cb(c)),
	reportAudio: (a: unknown) => ipcRenderer.send("audio-state", a),
	openExternal: (url: string) => ipcRenderer.send("open-external", url),
	query: (q: unknown) => ipcRenderer.invoke("catalog-query", q),
	areas: (scope: string) => ipcRenderer.invoke("catalog-areas", scope),
	selectStation: (s: unknown) => ipcRenderer.send("select-station", s),
	toggleFavorite: (s: unknown) => ipcRenderer.send("toggle-favorite", s),
	moveFavorite: (id: string, delta: number) => ipcRenderer.send("move-favorite", id, delta),
	stepStation: (delta: number) => ipcRenderer.send("step-station", delta),
	setScope: (scope: string) => ipcRenderer.send("set-scope", scope),
	toggleRecording: () => ipcRenderer.send("record-toggle"),
	revealRecording: () => ipcRenderer.send("reveal-recording"),
});
