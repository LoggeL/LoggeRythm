/**
 * Upscale a Deezer CDN cover URL to a larger square size.
 *
 * This deliberately matches the production web helper: only a `/123x123-`
 * path segment is replaced. Other providers and Deezer URL shapes pass
 * through unchanged.
 */
export function hiResCover(
  url: string | undefined | null,
  size = 1000,
): string {
  if (!url) return '';
  return url.replace(/\/\d+x\d+(?=-)/u, `/${size}x${size}`);
}

/** Treat legacy blank cover fields as absent before giving them to Image. */
export function usableHiResCover(
  url: string | undefined | null,
  size = 1000,
): string | null {
  const normalized = url?.trim() ?? '';
  return normalized.length === 0 ? null : hiResCover(normalized, size);
}
