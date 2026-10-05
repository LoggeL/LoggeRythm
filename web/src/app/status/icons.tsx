import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const icon = (path: ReactNode) =>
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={19}
        height={19}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
        {...props}
      >
        {path}
      </svg>
    );
  };

export const KeyIcon = icon(
  <>
    <circle cx="8" cy="8" r="3.5" />
    <path d="M10.5 10.5 19 19m-3-3 2-2m-4 0 2-2" />
  </>,
);
export const DiskIcon = icon(
  <>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </>,
);
export const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3.2 3.2 0 0 1 0 6.2M16.5 19a5.5 5.5 0 0 0-2.2-4.4" />
  </>,
);
export const ContentIcon = icon(
  <>
    <path d="M9 18V6l11-2v12" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </>,
);
export const PlugIcon = icon(
  <>
    <path d="M9 2v6m6-6v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5" />
  </>,
);
export const ServerIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </>,
);
export const RefreshIcon = icon(
  <>
    <path d="M20 11a8 8 0 1 0-2.35 5.65" />
    <path d="M20 5v6h-6" />
  </>,
);
export const ArrowIcon = icon(<path d="m9 18 6-6-6-6" />);
export const BackIcon = icon(<path d="m15 18-6-6 6-6" />);
