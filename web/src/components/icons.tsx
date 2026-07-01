import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18} {...props}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18} {...props}>
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18} {...props}>
      <path d="M6 5l8.5 7L6 19zM16 5h2.5v14H16z" />
    </svg>
  );
}

export function PrevIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={18} height={18} {...props}>
      <path d="M18 5l-8.5 7L18 19zM5.5 5H8v14H5.5z" />
    </svg>
  );
}

export function DownloadedIcon(props: IconProps) {
  // Filled disc (currentColor) with a contrasting down arrow — the common
  // "available offline" marker.
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} {...props}>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path
        d="M12 6.5v7m0 0l-3.2-3.2M12 13.5l3.2-3.2M7.5 17h9"
        fill="none"
        stroke="#08130c"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeartIcon({
  filled,
  ...props
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      {...props}
    >
      <path d="M12 21s-7.5-4.6-10-9.3C.5 8.4 2 5 5.4 5c2 0 3.3 1.1 4.1 2.3l.5.8.5-.8C11.3 6.1 12.6 5 14.6 5 18 5 19.5 8.4 18 11.7 15.5 16.4 12 21 12 21z" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 11.5L12 4l8 7.5" />
      <path d="M5.5 10.5V20h5v-6h3v6h5v-9.5" />
    </svg>
  );
}

export function NotesIcon(props: IconProps) {
  // Document/notes page with a folded corner — used for "Bibliothek".
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      {...props}
    >
      <circle cx={11} cy={11} r={7} />
      <path d="M21 21l-4-4" strokeLinecap="round" />
    </svg>
  );
}

export function LibraryIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
      <path d="M4 4h2v16H4zM8 4h2v16H8zM13 4l6 1.5-3.5 14L9.5 18z" />
    </svg>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" {...props}>
      <path d="M3 9v6h4l5 5V4L7 9zM16 7.5a5 5 0 010 9v-2a3 3 0 000-5z" />
    </svg>
  );
}

export function VolumeMutedIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" {...props}>
      <path d="M3 9v6h4l5 5V4L7 9z" />
      <path
        d="M16 9l5 5M21 9l-5 5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 3h5v5M4 20l16-16M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}

export function RepeatIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 014-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 01-4 4H3" />
    </svg>
  );
}

export function RepeatOneIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 014-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 01-4 4H3" />
      <text x="9" y="15.5" fontSize="8" fill="currentColor" stroke="none">
        1
      </text>
    </svg>
  );
}

export function QueueIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 6h9" />
      <path d="M4 12h7" />
      <path d="M4 18h8" />
      <path d="M16 7.5v8.25" />
      <path d="M16 7.5l4 1.2v8.05" />
      <circle cx="14.5" cy="18" r="2" />
      <circle cx="18.5" cy="19" r="2" />
    </svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} opacity={0.25} />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" {...props}>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

export function MusicNoteIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" {...props}>
      <path d="M9 17.5a2.5 2.5 0 11-2.5-2.5c.55 0 1.06.18 1.5.47V5l9-2v9.5a2.5 2.5 0 11-2.5-2.5c.55 0 1.06.18 1.5.47V6.2L9 7.6z" />
    </svg>
  );
}

export function LyricsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 5h10" />
      <path d="M5 9h8" />
      <path d="M5 13h11" />
      <path d="M5 17h7" />
      <path d="M18 6v8.5" />
      <path d="M18 6l2.5.8" />
      <circle cx="16.5" cy="17" r="2" />
    </svg>
  );
}

export function CompassIcon(props: IconProps) {
  // Discover/explore: a ring with an angled needle.
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RadioIcon(props: IconProps) {
  // Broadcast: a centre dot flanked by signal arcs.
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7" />
      <path d="M5.8 5.8a9 9 0 000 12.4M18.2 5.8a9 9 0 010 12.4" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  // Circle with a download arrow.
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v6m0 0l-2.5-2.5M12 14l2.5-2.5" />
    </svg>
  );
}

export function VerifiedIcon(props: IconProps) {
  // Filled scalloped verified badge with a check.
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" {...props}>
      <path
        d="M12 2.2l2.3 1.7 2.9-.2 1 2.7 2.4 1.6-.8 2.8.8 2.8-2.4 1.6-1 2.7-2.9-.2L12 21.8l-2.3-1.7-2.9.2-1-2.7-2.4-1.6.8-2.8-.8-2.8 2.4-1.6 1-2.7 2.9.2z"
        fill="currentColor"
      />
      <path
        d="M8.5 12.2l2.3 2.3 4.5-4.7"
        fill="none"
        stroke="#0b0b12"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function VisualizerIcon(props: IconProps) {
  // Equalizer / spectrum bars.
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M5 14v4M9.5 9v9M14.5 6v12M19 11v7" />
    </svg>
  );
}

export function ImportIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M20 21a8 8 0 00-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 01-3.4 0" />
    </svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
    </svg>
  );
}

export function CastIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 16a6 6 0 016 6M2 12a10 10 0 0110 10M2 20h.01" />
      <rect x="2" y="4" width="20" height="14" rx="2" opacity="0.5" />
    </svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function StatusIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
