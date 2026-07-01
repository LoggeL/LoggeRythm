/**
 * Upscale a Deezer CDN cover URL to a larger square size.
 *
 * Deezer cover URLs embed the size as a ``/{w}x{h}-…`` segment (e.g.
 * ``/cover/<hash>/250x250-000000-80-0-0.jpg``). Swapping it for a bigger size
 * yields a sharper image for large surfaces like the fullscreen player. URLs
 * that don't match (e.g. ``api.deezer.com/album/<id>/image``) are returned
 * unchanged.
 */
export function hiResCover(url: string | undefined | null, size = 1000): string {
  if (!url) return "";
  return url.replace(/\/\d+x\d+(?=-)/, `/${size}x${size}`);
}
