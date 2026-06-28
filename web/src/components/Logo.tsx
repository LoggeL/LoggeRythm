"use client";

import { useId } from "react";

type LogoProps = {
  size?: number;
  className?: string;
};

/**
 * Spotifrei logo mark — a vector redraw of the brand art: five equalizer pills
 * (light-lilac → violet) rising toward the centre, two end dots, and a soundwave
 * carved horizontally through the middle, all on a neon glow. Background is
 * transparent (the wave is masked out, not painted), so it sits on any surface.
 * Gradient/filter/mask ids are scoped per instance to avoid id collisions when
 * several logos render on the same page.
 */
export default function Logo({ size = 28, className }: LogoProps) {
  const uid = useId();
  const grad = `${uid}-g`;
  const soft = `${uid}-soft`;
  const tight = `${uid}-tight`;
  const wave = `${uid}-wave`;
  const marks = `${uid}-marks`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      role="img"
      aria-label="Spotifrei"
      className={className}
    >
      <defs>
        <linearGradient
          id={grad}
          gradientUnits="userSpaceOnUse"
          x1="128"
          y1="63"
          x2="128"
          y2="199"
        >
          <stop offset="0.02" stopColor="#fdcbfd" />
          <stop offset="0.20" stopColor="#ed85fc" />
          <stop offset="0.42" stopColor="#a644fc" />
          <stop offset="0.71" stopColor="#812bfb" />
          <stop offset="0.97" stopColor="#5e0fda" />
        </linearGradient>
        <filter id={soft} x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={tight} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <mask id={wave}>
          <rect width="256" height="256" fill="#ffffff" />
          <path
            d="M 75 131 C 95 126, 112 131, 128 135 C 144 139, 162 143, 183 140"
            fill="none"
            stroke="#000000"
            strokeWidth="10"
            strokeLinecap="round"
          />
        </mask>
        <g
          id={marks}
          fill={`url(#${grad})`}
          stroke={`url(#${grad})`}
          strokeWidth="15"
          strokeLinecap="round"
        >
          <circle cx="62" cy="132" r="7.5" stroke="none" />
          <circle cx="194" cy="132" r="7.5" stroke="none" />
          <line x1="84" y1="107" x2="84" y2="159" />
          <line x1="106" y1="89" x2="106" y2="174" />
          <line x1="128" y1="63" x2="128" y2="199" />
          <line x1="150" y1="90" x2="150" y2="174" />
          <line x1="172" y1="106" x2="172" y2="159" />
        </g>
      </defs>
      <g mask={`url(#${wave})`}>
        <use href={`#${marks}`} filter={`url(#${soft})`} opacity="0.55" />
        <use href={`#${marks}`} filter={`url(#${tight})`} opacity="0.9" />
        <use href={`#${marks}`} />
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
