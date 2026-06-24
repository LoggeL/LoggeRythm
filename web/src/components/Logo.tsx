import type { SVGProps } from "react";

type LogoProps = {
  size?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "width" | "height">;

/**
 * Spotifrei logo mark: a solid purple rounded-square badge containing a
 * stylized equalizer / soundwave. Solid colors only, no gradients or glow.
 */
export default function Logo({ size = 28, className, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Spotifrei"
      className={className}
      {...props}
    >
      {/* Badge */}
      <rect width="32" height="32" rx="8" fill="#7c5cff" />
      {/* Equalizer bars in solid white */}
      <g fill="#ffffff">
        <rect x="8" y="13" width="3" height="6" rx="1.5" />
        <rect x="14.5" y="8" width="3" height="16" rx="1.5" />
        <rect x="21" y="11" width="3" height="10" rx="1.5" />
      </g>
    </svg>
  );
}

/**
 * Optional wordmark: "Spoti" in the foreground color, "frei" in the accent.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-foreground">Spoti</span>
      <span className="text-accent">frei</span>
    </span>
  );
}
