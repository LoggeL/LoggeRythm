import Link from "next/link";
import type { ReactNode } from "react";

const TONES = [
  "gradient-violet",
  "gradient-teal",
  "gradient-orange",
  "gradient-blue",
  "gradient-pink",
  "gradient-green",
  "gradient-red",
  "gradient-aurora",
] as const;

/**
 * Coloured category tile (genre, radio, discovery entry). `tone` picks the
 * gradient, so neighbouring tiles in a grid differ; the artwork or icon sits
 * tilted in the corner.
 */
export default function BrowseTile({
  href,
  title,
  hint,
  image,
  icon,
  tone = 0,
}: {
  href: string;
  title: string;
  hint?: string;
  image?: string | null;
  icon?: ReactNode;
  tone?: number;
}) {
  return (
    <Link href={href} className={`group hover-lift relative block h-24 overflow-hidden rounded-[var(--radius-card)] p-3.5 sm:h-32 sm:p-4 ${TONES[tone % TONES.length]}`}>
      <span className="font-display relative z-10 block max-w-[75%] text-[17px] font-extrabold leading-none tracking-[-0.03em] [overflow-wrap:anywhere] sm:text-2xl">{title}</span>
      {hint && <span className="relative z-10 mt-1 block max-w-[70%] text-xs leading-snug text-foreground/75">{hint}</span>}
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute -bottom-2 -right-3 h-16 w-16 rotate-[22deg] rounded-md object-cover shadow-lg transition-transform duration-300 group-hover:rotate-[16deg] group-hover:scale-105 sm:h-20 sm:w-20"
        />
      ) : (
        icon && (
          <span aria-hidden="true" className="absolute -bottom-1 -right-1 text-foreground/30 transition-transform duration-300 group-hover:scale-110">
            {icon}
          </span>
        )
      )}
    </Link>
  );
}
