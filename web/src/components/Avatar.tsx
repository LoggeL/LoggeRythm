"use client";

// Deterministic solid color from a name (no gradients) — every user gets a
// distinct colored avatar even without an uploaded picture.
/** Number of `--avatar-N` tokens in globals.css. */
const COLOR_COUNT = 10;

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `var(--avatar-${(h % COLOR_COUNT) + 1})`;
}

export default function Avatar({
  src,
  name = "?",
  size = 40,
  className = "",
}: {
  src?: string | null;
  name?: string;
  size?: number;
  className?: string;
}) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        style={{ width: size, height: size }}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        background: colorFor(name),
        fontSize: Math.round(size * 0.42),
      }}
      className={`rounded-full flex items-center justify-center font-bold text-foreground flex-shrink-0 ${className}`}
    >
      {initial}
    </div>
  );
}
