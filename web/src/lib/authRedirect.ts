const AUTH_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

const PLAYLIST_INVITE_PATH_RE = /^\/playlist\/join\/([^/]+)\/?$/;
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Validate a relative in-app redirect target (`?next=...`).
 * Rejects external origins, protocol-relative URLs, backslashes, control
 * characters, and auth pages to prevent open redirects and redirect loops.
 */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (trimmed.includes("\\")) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed, "https://loggerythm.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://loggerythm.invalid") return null;
  if (!parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) return null;
  if (AUTH_PATHS.has(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Build `/login` or `/register` preserving a validated relative `?next=` path. */
export function buildAuthHref(
  authPath: "/login" | "/register",
  nextPath?: string | null,
): string {
  const safe = sanitizeNextPath(nextPath);
  if (!safe || safe === "/") return authPath;
  return `${authPath}?next=${encodeURIComponent(safe)}`;
}

/** True for `/playlist/join/<token>` invite URLs. */
export function isPlaylistInvitePath(pathname: string): boolean {
  return PLAYLIST_INVITE_PATH_RE.test(pathname);
}

/** Matches backend `secrets.token_urlsafe(24)` token shape (`^[A-Za-z0-9_-]{16,128}$`). */
export function isValidPlaylistInviteToken(token: string): boolean {
  return INVITE_TOKEN_RE.test(token);
}
