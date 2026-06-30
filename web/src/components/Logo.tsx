"use client";

type LogoProps = {
  size?: number;
  className?: string;
};

/**
 * LoggeRythm brand mark: a rounded violet tile with a white symmetric audio
 * waveform. Rendered inline (not an <img>) so it can glow on dark chrome.
 */
export default function Logo({ size = 44, className }: LogoProps) {
  // Symmetric waveform bar heights (fraction of the inner height).
  const bars = [0.34, 0.6, 0.9, 0.55, 1, 0.55, 0.9, 0.6, 0.34];
  const inner = 24; // viewBox space for the bars
  const gap = 2.6;
  const barW = 1.6;
  const totalW = bars.length * barW + (bars.length - 1) * gap;
  const startX = (inner - totalW) / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      className={className}
      aria-label="LoggeRythm"
    >
      <defs>
        <linearGradient id="lgTile" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9b6bff" />
          <stop offset="1" stopColor="#5b3ee0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="42" height="42" rx="13" fill="url(#lgTile)" />
      <g transform="translate(10 10)">
        {bars.map((h, i) => {
          const x = startX + i * (barW + gap);
          const barH = h * 18;
          const y = (inner - barH) / 2;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={barW / 2}
              fill="#fff"
            />
          );
        })}
      </g>
    </svg>
  );
}

/**
 * Wordmark: "Logge" in the foreground colour, a thin divider, then "rythm" in
 * the accent — matching the LoggeRythm masthead.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <span className="text-2xl font-extrabold tracking-tight text-foreground">
        Logge
      </span>
      <span className="h-6 w-px bg-white/35" />
      <span className="text-2xl font-extrabold tracking-tight text-accent">
        Rythm
      </span>
    </span>
  );
}
