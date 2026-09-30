// Modèle de station + station native (Radio Choco Sound HD, métadonnées RadioKing).

export interface Station {
	/** stationuuid Radio Browser, ou identifiant interne pour les stations natives */
	id: string;
	name: string;
	/** ligne secondaire : genre principal, région ou pays */
	subtitle: string;
	stream: string;
	hls: boolean;
	favicon: string;
	homepage: string;
	tags: string[];
	country: string;
	countrycode: string;
	state: string;
	codec: string;
	bitrate: number;
	/** base de l'API widget RadioKing : métadonnées riches (pochette, durée, historique) */
	radioking?: string;
}

export const CHOCO: Station = {
	id: "radiochoco-sound-hd",
	name: "Radio Choco",
	subtitle: "Sound HD",
	stream: "https://radiochoco.com/sound-hd",
	hls: false,
	favicon: "https://image.radioking.io/radios/669715/logo/e0191854-a603-41f5-9729-121a1f215f57.jpeg",
	homepage: "https://radiochoco.com",
	tags: ["eclectic"],
	country: "France",
	countrycode: "FR",
	state: "",
	codec: "MP3",
	bitrate: 0, // débit non publié par RadioKing
	radioking: "https://api.radioking.io/widget/radio/radiochoco-sound",
};

/** Stations dont l'URL se lit mieux via une source native (métadonnées riches). */
export const NATIVE: Station[] = [CHOCO];

/** Version résumée, exposée à l'API locale et au menu. */
export const brief = (s: Station) => ({ id: s.id, name: s.name, subtitle: s.subtitle, favicon: s.favicon, codec: s.codec, bitrate: s.bitrate });

/** Contrôle minimal d'un objet Station reçu du renderer ou lu dans la config. */
export function isStation(x: unknown): x is Station {
	const s = x as Station;
	return !!s && typeof s.id === "string" && typeof s.name === "string" && typeof s.stream === "string" && /^https?:\/\//.test(s.stream);
}

/** Port de l'API de contrôle locale (lue par le plugin Stream Deck CariMusicDeck). */
export const CONTROL_PORT = Number(process.env.CARIRADIO_PORT) || 32700;

export const USER_AGENT = "CariRadio/1.1 (Caribou Labs; macOS)";
