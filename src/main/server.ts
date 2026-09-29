// API de contrôle locale (127.0.0.1 uniquement) — utilisée par le plugin Stream Deck CariCover.
//   GET  /state                     → état complet (JSON)
//   GET  /stations                  → favoris (ordre du menu) + station en cours
//   POST /play | /pause | /toggle | /stop
//   POST /volume?value=0-100 | /volume/up?step=5 | /volume/down?step=5
//   POST /station?id=<id>           → lance une station (favori, ou identifiant Radio Browser)
//   POST /station/next | /station/prev → favori suivant / précédent
//   POST /show                      → affiche la fenêtre
// Les requêtes GET sont acceptées pour les commandes (pratique pour tester avec curl).
import http from "node:http";

export type Command =
	| { type: "play" }
	| { type: "pause" }
	| { type: "toggle" }
	| { type: "stop" }
	| { type: "volume"; value: number }
	| { type: "volumeStep"; delta: number }
	| { type: "station"; id: string }
	| { type: "stationStep"; delta: number }
	| { type: "show" };

export function startControlServer(
	port: number,
	getState: () => unknown,
	getStations: () => unknown,
	onCommand: (c: Command) => void,
): http.Server {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const json = (code: number, body: unknown) => {
			res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
			res.end(JSON.stringify(body));
		};
		const num = (k: string, d: number) => {
			const v = Number(url.searchParams.get(k));
			return Number.isFinite(v) && url.searchParams.has(k) ? v : d;
		};
		let cmd: Command | null = null;
		switch (url.pathname) {
			case "/state":
				return json(200, getState());
			case "/stations":
				return json(200, getStations());
			case "/play":
				cmd = { type: "play" };
				break;
			case "/pause":
				cmd = { type: "pause" };
				break;
			case "/toggle":
				cmd = { type: "toggle" };
				break;
			case "/stop":
				cmd = { type: "stop" };
				break;
			case "/volume":
				cmd = { type: "volume", value: Math.max(0, Math.min(100, num("value", 50))) };
				break;
			case "/volume/up":
				cmd = { type: "volumeStep", delta: Math.abs(num("step", 5)) };
				break;
			case "/volume/down":
				cmd = { type: "volumeStep", delta: -Math.abs(num("step", 5)) };
				break;
			case "/station": {
				const id = (url.searchParams.get("id") ?? "").trim();
				if (!id) return json(400, { error: "paramètre id manquant" });
				cmd = { type: "station", id };
				break;
			}
			case "/station/next":
				cmd = { type: "stationStep", delta: 1 };
				break;
			case "/station/prev":
				cmd = { type: "stationStep", delta: -1 };
				break;
			case "/show":
				cmd = { type: "show" };
				break;
			default:
				return json(404, { error: "inconnu" });
		}
		onCommand(cmd);
		json(200, { ok: true });
	});
	server.on("error", (e) => console.error(`[CariRadio] API de contrôle indisponible sur le port ${port} :`, e.message));
	server.listen(port, "127.0.0.1");
	return server;
}
