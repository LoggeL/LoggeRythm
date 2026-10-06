export const LIKE_BURST_DURATION = 1400;

type Rectangle = { left: number; top: number; width: number; height: number };
export type LikeBurstParticle = {
  kind: "spark" | "heart";
  x: number;
  y: number;
  rotation: number;
  delay: number;
  size: number;
  color: string;
};
export type LikeBurstGeometry = {
  x: number;
  y: number;
  surface: Rectangle | null;
  particles: LikeBurstParticle[];
};

const COLORS = ["#fff7ff", "#ff86cc", "#be9cff", "#f861b6", "#9175ff"];

export function getLikeBurstGeometry(
  button: Pick<HTMLButtonElement, "getBoundingClientRect" | "closest">,
  viewportWidth: number,
  viewportHeight: number,
): LikeBurstGeometry {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
    throw new Error("Like animation requires a positive, finite viewport size.");
  }
  const buttonRect = button.getBoundingClientRect();
  const x = buttonRect.left + buttonRect.width / 2;
  const y = buttonRect.top + buttonRect.height / 2;
  const container = button.closest<HTMLElement>(".like-celebration-surface");
  const surfaceRect = container?.getBoundingClientRect();
  const surface = surfaceRect ? {
    left: Math.max(0, surfaceRect.left),
    top: Math.max(0, surfaceRect.top),
    width: Math.max(0, Math.min(viewportWidth, surfaceRect.left + surfaceRect.width) - Math.max(0, surfaceRect.left)),
    height: Math.max(0, Math.min(viewportHeight, surfaceRect.top + surfaceRect.height) - Math.max(0, surfaceRect.top)),
  } : null;

  const particles = Array.from({ length: 40 }, (_, index): LikeBurstParticle => {
    const kind = index < 28 ? "spark" : "heart";
    // The golden angle keeps both kinds dispersed without a rigid wheel. Two
    // radii and staggered starts give the bloom a sharp hit and a softer tail.
    const angle = (index * 137.508 - 90) * Math.PI / 180;
    const distance = kind === "spark" ? 65 + (index % 6) * 11 : 80 + (index % 5) * 14;
    const size = kind === "spark" ? 6 + (index % 4) * 2 : 8 + (index % 4) * 3;
    const margin = size / 2 + 5;
    // Keep particles visible at the edges, especially a row's right-hand like
    // button and the player bar at the bottom of a phone.
    const targetX = Math.max(margin, Math.min(viewportWidth - margin, x + Math.cos(angle) * distance));
    const targetY = Math.max(margin, Math.min(viewportHeight - margin, y + Math.sin(angle) * distance - (kind === "heart" ? 22 : 0)));
    return {
      kind,
      x: targetX - x,
      y: targetY - y,
      rotation: kind === "heart" ? (index % 5 - 2) * 14 : index * 137.508 + 90,
      delay: kind === "spark" ? (index % 5) * 12 : 70 + (index % 4) * 26,
      size,
      color: COLORS[index % COLORS.length],
    };
  });

  return { x, y, surface, particles };
}
