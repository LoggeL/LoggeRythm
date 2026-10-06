const MAX_SCALE = 0.07;

function unit(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Artwork pulse ${name} must be a finite value between 0 and 1.`);
}

/** Only real low-frequency energy and its transient can move the artwork. */
export function artworkPulseTarget(bass: number, onset: number): number {
  unit(bass, "bass");
  unit(onset, "onset");
  return bass === 0 ? 0 : Math.min(1, Math.pow(bass, 0.65) * 0.9 + onset * bass * 0.1);
}

export function approachArtworkPulse(current: number, target: number, deltaSeconds: number): number {
  unit(current, "current level");
  unit(target, "target level");
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Artwork pulse frame duration must be finite and non-negative.");
  const duration = target > current ? 0.025 : 0.15;
  return current + (target - current) * (1 - Math.exp(-Math.min(deltaSeconds, 0.1) / duration));
}

export function artworkPulseStyle(level: number) {
  unit(level, "display level");
  return {
    transform: `translateZ(0) scale(${(1 + level * MAX_SCALE).toFixed(5)})`,
    boxShadow: `0 22px 55px rgb(0 0 0 / 0.55), 0 0 ${(10 + level * 34).toFixed(2)}px rgb(var(--cover-primary-rgb, 124 92 255) / ${(0.12 + level * 0.35).toFixed(3)})`,
  };
}
