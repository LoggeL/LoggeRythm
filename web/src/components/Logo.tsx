"use client";

type LogoProps = {
  size?: number;
  className?: string;
};

/**
 * SpotiFrei logo mark. The source SVG in /public has a transparent background,
 * so it can sit on dark panels, fullscreen overlays, and the auth screen.
 */
export default function Logo({ size = 28, className }: LogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/Logo.svg"
      alt="SpotiFrei"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}

/**
 * Optional wordmark: "Spoti" in the foreground color, "Frei" in the accent.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-foreground">Spoti</span>
      <span className="text-accent">Frei</span>
    </span>
  );
}
