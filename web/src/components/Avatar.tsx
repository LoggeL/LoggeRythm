"use client";

// Deterministic solid color from a name (no gradients) — every user gets a
// distinct colored avatar even without an uploaded picture.
const COLORS = [
  "#7c5cff",
  "#e0507a",
  "#3aa0ff",
  "#2bbf7a",
  "#ff8c42",
  "#b14bff",
  "#1fb8c4",
  "#d9486e",
  "#5a8dee",
  "#e8a13a",
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
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
      className={`rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 ${className}`}
    >
      {initial}
    </div>
  );
}
