/**
 * On-brand stand-in for missing cover art: brand-violet gradient with the
 * equalizer glyph from the logo, scaled to the tile. Pass sizing/rounding
 * (e.g. "w-10 h-10 rounded") via className, exactly like the <img> it replaces.
 */
export default function CoverPlaceholder({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`grid place-items-center overflow-hidden gradient-violet ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-[46%] w-[46%] text-white/45"
      >
        <rect x="2.6" y="11" width="3.2" height="7" rx="1.6" />
        <rect x="7.9" y="5" width="3.2" height="13" rx="1.6" />
        <rect x="13.2" y="8" width="3.2" height="10" rx="1.6" />
        <rect x="18.5" y="12.5" width="3.2" height="5.5" rx="1.6" />
      </svg>
    </div>
  );
}
