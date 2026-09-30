// Icônes SVG inline (aucune police d'icônes externe).
type P = { size?: number };

export const PlayIcon = ({ size = 30 }: P) => (
	<svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
		<path d="M9 5.8c0-1.2 1.3-1.9 2.3-1.3l14.2 8.9c1 .6 1 2 0 2.6L11.3 24.9c-1 .6-2.3-.1-2.3-1.3z" fill="currentColor" />
	</svg>
);

export const PauseIcon = ({ size = 30 }: P) => (
	<svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
		<rect x="7" y="5" width="5.5" height="20" rx="1.6" fill="currentColor" />
		<rect x="17.5" y="5" width="5.5" height="20" rx="1.6" fill="currentColor" />
	</svg>
);

export const SpeakerLow = ({ size = 16 }: P) => (
	<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
		<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
	</svg>
);

export const SpeakerHigh = ({ size = 16 }: P) => (
	<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
		<path d="M1 6h2.5L7 3v10L3.5 10H1z" fill="currentColor" />
		<path d="M9.5 5.5a3.5 3.5 0 0 1 0 5M11.5 3.5a6.3 6.3 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
	</svg>
);

export const RadioGlyph = ({ size = 64 }: P) => (
	<svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
		<circle cx="32" cy="34" r="6" fill="currentColor" />
		<path d="M20 22a17 17 0 0 0 0 24M44 22a17 17 0 0 1 0 24M13 15a27 27 0 0 0 0 38M51 15a27 27 0 0 1 0 38" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
	</svg>
);

export const ExternalIcon = ({ size = 12 }: P) => (
	<svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
		<path d="M5 2H2.5A.5.5 0 0 0 2 2.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V7M7 2h3v3M10 2 5.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

export const PrevIcon = ({ size = 22 }: P) => (
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect x="4" y="5" width="2.4" height="14" rx="1" fill="currentColor" />
		<path d="M20 6.2v11.6c0 .9-1 1.4-1.7.9L9.6 13a1.2 1.2 0 0 1 0-2l8.7-5.7c.7-.5 1.7 0 1.7.9z" fill="currentColor" />
	</svg>
);

export const NextIcon = ({ size = 22 }: P) => (
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect x="17.6" y="5" width="2.4" height="14" rx="1" fill="currentColor" />
		<path d="M4 6.2v11.6c0 .9 1 1.4 1.7.9l8.7-5.7a1.2 1.2 0 0 0 0-2L5.7 5.3C5 4.8 4 5.3 4 6.2z" fill="currentColor" />
	</svg>
);

export const StarIcon = ({ size = 18, filled = false }: P & { filled?: boolean }) => (
	<svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
		<path
			d="M10 2.6l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.9l5-.7z"
			fill={filled ? "currentColor" : "none"}
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
		/>
	</svg>
);

export const ListIcon = ({ size = 18 }: P) => (
	<svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
		<circle cx="4" cy="5" r="1.3" fill="currentColor" />
		<circle cx="4" cy="10" r="1.3" fill="currentColor" />
		<circle cx="4" cy="15" r="1.3" fill="currentColor" />
		<path d="M8 5h9M8 10h9M8 15h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
	</svg>
);

export const SearchIcon = ({ size = 14 }: P) => (
	<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
		<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
		<path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
	</svg>
);

export const CloseIcon = ({ size = 12 }: P) => (
	<svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
		<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
	</svg>
);

export const ChevronDown = ({ size = 10 }: P) => (
	<svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
		<path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

export const ChevronLeft = ({ size = 12 }: P) => (
	<svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
		<path d="M7.5 2 3.5 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

export const ChevronRight = ({ size = 10 }: P) => (
	<svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
		<path d="M4.5 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

export const ArrowUp = ({ size = 10 }: P) => (
	<svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
		<path d="M5 8.5V1.5M2 4.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

/** Petites barres animées « en cours de lecture ». */
export const EqBars = ({ playing }: { playing: boolean }) => (
	<span className={`eq ${playing ? "on" : ""}`} aria-hidden="true">
		<i />
		<i />
		<i />
	</span>
);

/** Enregistrement : rond rouge ; en cours : carré « stop ». */
export const RecIcon = ({ size = 20, active = false }: P & { active?: boolean }) => (
	<svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
		<circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
		{active ? <rect x="6.6" y="6.6" width="6.8" height="6.8" rx="1.4" fill="currentColor" /> : <circle cx="10" cy="10" r="4.6" fill="currentColor" />}
	</svg>
);

/** Poignée de glisser-déposer (6 points). */
export const GripIcon = ({ size = 16 }: P) => (
	<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
		{[4, 8, 12].map((y) => (
			<g key={y}>
				<circle cx="5.5" cy={y} r="1.25" fill="currentColor" />
				<circle cx="10.5" cy={y} r="1.25" fill="currentColor" />
			</g>
		))}
	</svg>
);

export const HeartIcon = ({ size = 20, filled = false }: P & { filled?: boolean }) => (
	<svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
		<path
			d="M10 16.6s-6.4-3.9-6.4-8.6A3.6 3.6 0 0 1 10 5.7a3.6 3.6 0 0 1 6.4 2.3c0 4.7-6.4 8.6-6.4 8.6z"
			fill={filled ? "currentColor" : "none"}
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
		/>
	</svg>
);

/** Réduire en mode compact. */
export const CompactIcon = ({ size = 16 }: P) => (
	<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
		<rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
		<rect x="4.2" y="9.2" width="7.6" height="2.3" rx="0.8" fill="currentColor" />
	</svg>
);

/** Revenir à la fenêtre complète. */
export const ExpandIcon = ({ size = 14 }: P) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<path d="M8.5 2h3.5v3.5M12 2 8 6M5.5 12H2V8.5M2 12l4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

export const InfoIcon = ({ size = 13 }: P) => (
	<svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
		<circle cx="7" cy="7" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
		<path d="M7 6.3v3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		<circle cx="7" cy="4.3" r="0.85" fill="currentColor" />
	</svg>
);
