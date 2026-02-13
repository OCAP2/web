import type { JSX } from "solid-js";

type IconProps = { size?: number };

function s(size?: number): number {
  return size ?? 16;
}

export const PlayIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={s(p.size) + 2} height={s(p.size) + 2}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const PauseIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={s(p.size) + 2} height={s(p.size) + 2}>
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

export const SkipBackIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <polygon points="19 20 9 12 19 4" />
    <line x1="5" y1="19" x2="5" y2="5" />
  </svg>
);

export const SkipForwardIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <polygon points="5 4 15 12 5 20" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </svg>
);

export const UsersIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const ActivityIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export const BarChartIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

export const MessageSquareIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const CrosshairIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="22" y1="12" x2="18" y2="12" />
    <line x1="6" y1="12" x2="2" y2="12" />
    <line x1="12" y1="6" x2="12" y2="2" />
    <line x1="12" y1="22" x2="12" y2="18" />
  </svg>
);

export const SkullIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 16 16" fill="currentColor" width={s(p.size)} height={s(p.size)}>
    {/* Cranium */}
    <path d="M8 1C4.7 1 2 3.5 2 6.5c0 1.8.9 3.4 2.3 4.5H5v1h6v-1h.7C12.1 9.9 14 8.3 14 6.5 14 3.5 11.3 1 8 1z" />
    {/* Eye holes */}
    <ellipse cx="5.8" cy="6.5" rx="1.3" ry="1.5" fill="var(--bg-base, #0d1520)" />
    <ellipse cx="10.2" cy="6.5" rx="1.3" ry="1.5" fill="var(--bg-base, #0d1520)" />
    {/* Nose */}
    <path d="M7.3 9.2L8 10l.7-.8-.3-.7h-.8z" fill="var(--bg-base, #0d1520)" />
    {/* Jaw / teeth row */}
    <rect x="5" y="12.5" width="6" height="2.5" rx=".5" />
    {/* Teeth gaps */}
    <rect x="6.2" y="12.5" width=".6" height="2.5" fill="var(--bg-base, #0d1520)" />
    <rect x="7.7" y="12.5" width=".6" height="2.5" fill="var(--bg-base, #0d1520)" />
    <rect x="9.2" y="12.5" width=".6" height="2.5" fill="var(--bg-base, #0d1520)" />
  </svg>
);

export const ZapIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={s(p.size) - 4} height={s(p.size) - 4}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10" />
  </svg>
);

export const BulletIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 16 16" fill="currentColor" width={s(p.size) - 2} height={s(p.size) - 2}>
    {/* Horizontal bullet: rounded tip on right, flat casing on left */}
    <rect x="1" y="5.5" width="7" height="5" rx=".5" />
    <path d="M8 5.5h1.5c2.5 0 5.5 2.5 5.5 2.5s-3 2.5-5.5 2.5H8V5.5z" />
  </svg>
);

export const LinkIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 4} height={s(p.size) - 4}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const DownloadIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const ShareIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

export const InfoIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const ArrowLeftIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width={s(p.size)} height={s(p.size)}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const XIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const LayersIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <polygon points="12 2 2 7 12 12 22 7" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

export const MapIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2" />
    <line x1="8" y1="2" x2="8" y2="18" />
    <line x1="16" y1="6" x2="16" y2="22" />
  </svg>
);

export const EyeIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const ClockIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 4} height={s(p.size) - 4}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const TargetIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

export const SettingsIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
