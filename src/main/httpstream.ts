// Ouverture brute d'un flux radio en HTTP/1.0 (socket TCP/TLS), partagée par l'enregistrement et la sonde.
// Plutôt que fetch : les vieux serveurs Shoutcast répondent « ICY 200 OK », refusé par le parseur HTTP de Node,
// et HTTP/1.0 garantit une réponse non découpée (pas de chunked).
import net from "node:net";
import tls from "node:tls";
import { USER_AGENT } from "./station.js";

export interface Opened {
	sock: net.Socket;
	contentType: string;
	/** en-têtes de réponse (clés en minuscules) */
	headers: Map<string, string>;
	/** URL finale après redirections */
	url: string;
	/** octets audio déjà reçus avec les en-têtes */
	head: Buffer;
}

/** Ouvre le flux en HTTP/1.0 (accepte aussi les vieux « ICY 200 OK »), suit les redirections. */
export async function openStream(url: string, opts: { deadline?: number; icy?: boolean } = {}): Promise<Opened> {
	const deadline = opts.deadline ?? 15_000;
	let target = new URL(url);
	for (let hop = 0; hop < 5; hop++) {
		const r = await new Promise<Opened | { redirect: string }>((resolve, reject) => {
			const secure = target.protocol === "https:";
			if (!secure && target.protocol !== "http:") return reject(new Error(`Protocole non géré : ${target.protocol}`));
			const port = Number(target.port) || (secure ? 443 : 80);
			const sock = secure
				? tls.connect({ host: target.hostname, port, servername: net.isIP(target.hostname) ? undefined : target.hostname })
				: net.connect({ host: target.hostname, port });
			const timer = setTimeout(() => {
				sock.destroy();
				reject(new Error("Délai de connexion dépassé"));
			}, deadline);
			let buf = Buffer.alloc(0);
			const onData = (chunk: Buffer) => {
				buf = Buffer.concat([buf, chunk]);
				const end = buf.indexOf("\r\n\r\n");
				if (end < 0) {
					if (buf.length > 16_384) fail(new Error("En-têtes invalides"));
					return;
				}
				sock.off("data", onData);
				sock.pause();
				clearTimeout(timer);
				const lines = buf.subarray(0, end).toString("latin1").split("\r\n");
				const status = Number(/^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/i.exec(lines[0])?.[1] ?? 0);
				const h = new Map<string, string>();
				for (const l of lines.slice(1)) {
					const i = l.indexOf(":");
					if (i > 0) h.set(l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim());
				}
				if (status >= 300 && status < 400 && h.get("location")) {
					sock.destroy();
					return resolve({ redirect: new URL(h.get("location")!, target).toString() });
				}
				if (status !== 200) {
					sock.destroy();
					return reject(new Error(`HTTP ${status || "?"}`));
				}
				resolve({ sock, contentType: h.get("content-type") ?? "", headers: h, url: target.toString(), head: buf.subarray(end + 4) });
			};
			const fail = (e: Error) => {
				clearTimeout(timer);
				sock.destroy();
				reject(e);
			};
			sock.once(secure ? "secureConnect" : "connect", () => {
				sock.write(
					`GET ${target.pathname || "/"}${target.search} HTTP/1.0\r\nHost: ${target.host}\r\nUser-Agent: ${USER_AGENT}\r\nAccept: */*\r\n${opts.icy ? "Icy-MetaData: 1\r\n" : ""}Connection: close\r\n\r\n`,
				);
			});
			sock.on("data", onData);
			sock.once("error", fail);
		});
		if ("redirect" in r) {
			target = new URL(r.redirect);
			continue;
		}
		return r;
	}
	throw new Error("Trop de redirections");
}

