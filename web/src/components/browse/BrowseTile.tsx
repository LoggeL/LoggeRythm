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
 * tilted in the corner. With `onClick` instead of `href` it is a button (an
 * in-page action) that looks exactly like the linked tiles beside it.
 */
export default function BrowseTile({
  href,
  onClick,
  title,
  hint,
  image,
  icon,
  tone = 0,
}: ({ href: string; onClick?: never } | { href?: never; onClick: () => void }) & {
  title: string;
  hint?: string;
  image?: string | null;
  icon?: ReactNode;
  tone?: number;
}) {
  const className = `group hover-lift relative block h-24 w-full overflow-hidden rounded-[var(--radius-card)] p-3.5 text-left sm:h-32 sm:p-4 ${TONES[tone % TONES.length]}`;
  const content = (
    <>
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
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  if (href === undefined) throw new Error(`BrowseTile „${title}“ braucht href oder onClick.`);
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
