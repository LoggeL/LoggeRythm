"use client";

type LogoProps = {
  size?: number;
  className?: string;
};

/**
 * Loggerythm logo mark — the same equalizer glyph used as the app favicon.
 * The source SVG in /public has a transparent background, so it sits on dark
 * panels, fullscreen overlays and the auth screen.
 */
export default function Logo({ size = 28, className }: LogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/Logo.svg"
      alt="LoggeRythm"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}

/**
 * Wordmark: "Logge" in the foreground colour, a thin divider, then "Rythm" in
 * the accent — matching the Loggerythm masthead.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`flex items-center gap-0 ${className ?? ""}`}>
      <span className="text-lg font-bold tracking-tight text-foreground">
        Logge
      </span>
      <span className="text-lg font-bold tracking-tight text-accent-soft">
        Rythm
      </span>
    </span>
  );
}
