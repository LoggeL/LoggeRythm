/**
 * Animated "now playing" equalizer indicator. Three (or more) bars bounce on a
 * staggered loop. Honors prefers-reduced-motion via the global `.eq-bar` rule.
 */
export default function EqualizerBars({
  bars = 3,
  className = "",
  barClassName = "bg-accent",
  height = 16,
}: {
  bars?: number;
  className?: string;
  barClassName?: string;
  height?: number;
}) {
  return (
    <span
      className={`inline-flex items-end gap-[3px] ${className}`}
      style={{ height }}
      aria-hidden
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`eq-bar w-[3px] h-full rounded-full ${barClassName}`}
          style={{ animationDelay: `${(i * 0.15).toFixed(2)}s` }}
        />
      ))}
    </span>
  );
}
