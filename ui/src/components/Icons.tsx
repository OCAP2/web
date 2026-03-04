import type { JSX } from "solid-js";

export type IconProps = { size?: number };

function s(size?: number): number {
  return size ?? 16;
}

// ---------------------------------------------------------------------------
// Playback icons (verbatim from recording-playback/components/Icons.tsx)
// ---------------------------------------------------------------------------

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

export const EyeOffIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
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

// ---------------------------------------------------------------------------
// Recording-selector icons (converted from object pattern to named exports)
// ---------------------------------------------------------------------------

export const SearchIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const CalendarIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export const TagIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

export const ArrowRightIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

export const GlobeIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width={s(p.size) + 2} height={s(p.size) + 2}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export const SortAscIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 4} height={s(p.size) - 4}>
    <path d="M12 5v14M5 12l7 7 7-7" />
  </svg>
);

export const SortDescIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 4} height={s(p.size) - 4}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const GitHubIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={s(p.size) - 2} height={s(p.size) - 2}>
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

export const ExternalLinkIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 5} height={s(p.size) - 5}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export const HeartIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={s(p.size) - 6} height={s(p.size) - 6}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

export const LockIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const SteamIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={s(p.size)} height={s(p.size)}>
    <path d="M11.979 0C5.678 0 .511 4.86.022 10.942l6.432 2.658a3.387 3.387 0 0 1 1.912-.588c.063 0 .125.002.188.006l2.861-4.142V8.77a4.508 4.508 0 0 1 4.505-4.505 4.508 4.508 0 0 1 4.505 4.505 4.508 4.508 0 0 1-4.505 4.506h-.105l-4.077 2.91c0 .053.003.106.003.16a3.39 3.39 0 0 1-3.388 3.388 3.393 3.393 0 0 1-3.349-2.868L.2 15.099A11.979 11.979 0 0 0 11.979 24c6.627 0 12-5.373 12-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61a2.54 2.54 0 0 0 4.867-.863 2.542 2.542 0 0 0-2.537-2.54 2.54 2.54 0 0 0-.946.183l1.522.63a1.868 1.868 0 0 1-1.433 3.2zm8.38-6.249a3.005 3.005 0 0 0 3.002-3.002 3.005 3.005 0 0 0-3.002-3.002 3.005 3.005 0 0 0-3.003 3.002 3.005 3.005 0 0 0 3.003 3.002z" />
  </svg>
);

export const ShieldIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 6} height={s(p.size) - 6}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const UploadIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export const LogOutIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const EditIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const TrashIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const RefreshCwIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const NavigationIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polygon points="3 11 22 2 13 21 11 13" />
  </svg>
);

export const CheckIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const AlertTriangleIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const FilePlusIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) + 2} height={s(p.size) + 2}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

export const TerminalIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export const HardDriveIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <line x1="22" y1="12" x2="2" y2="12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    <line x1="6" y1="16" x2="6.01" y2="16" />
    <line x1="10" y1="16" x2="10.01" y2="16" />
  </svg>
);

export const GridIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

export const ListIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

export const PaletteIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
    <circle cx="6.5" cy="12" r="0.5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </svg>
);

export const StepBackIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const StepForwardIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width={s(p.size) - 2} height={s(p.size) - 2}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const SkipToKillBackIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 3} height={s(p.size) - 3}>
    <polyline points="11 17 6 12 11 7" />
    <polyline points="18 17 13 12 18 7" />
  </svg>
);

export const SkipToKillIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size) - 3} height={s(p.size) - 3}>
    <polyline points="13 17 18 12 13 7" />
    <polyline points="6 17 11 12 6 7" />
  </svg>
);

export const SquareIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={s(p.size)} height={s(p.size)}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

export const HourglassIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M5 22h14" /><path d="M5 2h14" />
    <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
  </svg>
);

export const CheckCircleIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export const XCircleIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={s(p.size)} height={s(p.size)}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);
