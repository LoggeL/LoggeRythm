import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Glyphs for dialogs, toasts and form fields. All are decorative by default. */

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...stroke} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...stroke} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

export function InfoCircleIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...stroke} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...stroke} {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...stroke} {...props}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.500 6.500 9.500 6.500a15.600 15.600 0 0 1-3 3.700M14.100 14.200A2.750 2.750 0 0 1 9.800 9.900M6.400 7.200A15.300 15.300 0 0 0 2.500 12S6 18.500 12 18.500a9 9 0 0 0 3.600-.750" />
    </svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" width={14} height={14} fill="currentColor" {...props}>
      <circle cx="4" cy="3" r="1.4" />
      <circle cx="4" cy="7" r="1.4" />
      <circle cx="4" cy="11" r="1.4" />
      <circle cx="10" cy="3" r="1.4" />
      <circle cx="10" cy="7" r="1.4" />
      <circle cx="10" cy="11" r="1.4" />
    </svg>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...stroke} {...props}>
      <path d="M3 3l18 18" />
      <path d="M5 12.500a10 10 0 0 1 3.200-2.100M2 9a15 15 0 0 1 3.400-2.500M10.500 5.100A15 15 0 0 1 22 9M14.500 10a10 10 0 0 1 4.500 2.500M8.500 16a5 5 0 0 1 6.500-.400M12 19.500v.01" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" {...stroke} {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}
