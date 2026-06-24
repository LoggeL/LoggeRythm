"use client";

export default function Equalizer({
  playing = true,
  small = false,
  className = "",
}: {
  playing?: boolean;
  small?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`eq ${small ? "eq-sm" : ""} ${playing ? "" : "paused"} ${className}`}
    >
      <i />
      <i />
      <i />
    </span>
  );
}
