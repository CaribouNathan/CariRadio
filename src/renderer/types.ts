export type AudioStatus = "idle" | "loading" | "playing" | "paused" | "error";
export type Scope = "FR" | "ALL";

export interface Track {
	title: string;
	artist: string;
	album: string;
	cover: string;
	startedAt: number;
	endAt: number;
	duration: number;
	isLive: boolean;
	buyLink: string;
	/** true : `cover` est le logo de la station (le morceau n'a pas de pochette) */
	coverIsStation?: boolean;
}

export interface Station {
	id: string;
	name: string;
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
	radioking?: string;
}

export interface AppState {
	station: { id: string; name: string; subtitle: string; site: string; favicon: string; codec: string; bitrate: number; stream: string; hls: boolean; native: boolean; favorite: boolean };
	current: Station;
	favorites: Station[];
	scope: Scope;
	status: AudioStatus;
	volume: number;
	error: string;
	track: Track | null;
	history: Track[];
}

export type StationQuery =
	| { kind: "top"; scope: Scope; offset?: number }
	| { kind: "search"; scope: Scope; value: string; offset?: number }
	| { kind: "tag"; scope: Scope; value: string; offset?: number }
	| { kind: "state"; value: string; offset?: number }
	| { kind: "country"; value: string; offset?: number };

export interface Area {
	value: string;
	label: string;
	count: number;
}

export type Command =
	| { type: "play" }
	| { type: "pause" }
	| { type: "toggle" }
	| { type: "stop" }
	| { type: "volume"; value: number }
	| { type: "volumeStep"; delta: number }
	| { type: "load"; stream: string; hls: boolean; play: boolean }
	| { type: "openStations" };

export interface CariBridge {
	ready(): Promise<AppState>;
	onState(cb: (s: AppState) => void): void;
	onCommand(cb: (c: Command) => void): void;
	reportAudio(a: { status: AudioStatus; volume: number; error?: string }): void;
	openExternal(url: string): void;
	query(q: StationQuery): Promise<{ stations: Station[]; hasMore: boolean }>;
	areas(scope: Scope): Promise<Area[]>;
	selectStation(s: Station): void;
	toggleFavorite(s: Station): void;
	moveFavorite(id: string, delta: number): void;
	stepStation(delta: number): void;
	setScope(scope: Scope): void;
}

declare global {
	interface Window {
		cari: CariBridge;
	}
}
