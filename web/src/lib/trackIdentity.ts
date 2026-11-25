/**
 * Canonical track recording identity shared across likes and library search.
 *
 * Mirrors `api/app/services/track_identity.py`:
 * 1. Exact track ID match.
 * 2. Normalized ISRC match (same studio recording across Single / EP / Album / Deluxe).
 * 3. Fallback (only when ISRC is absent on at least one side): folded primary
 *    artist + folded title + duration within 3 seconds.
 */

export interface TrackIdentityFields {
  id: string | number;
  title?: string | null;
  artist?: string | null;
  duration_sec?: number | null;
  isrc?: string | null;
}

const DURATION_TOLERANCE_SEC = 3;

const PLAIN_LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
  ı: "i",
};

export function normalizeIsrc(raw?: string | null): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  if (cleaned.length < 4 || /^0+$/.test(cleaned)) return "";
  return cleaned;
}

export function foldTrackText(value?: string | null): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, (letter) => PLAIN_LETTERS[letter])
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function fallbackSignature(track: TrackIdentityFields): string | null {
  const artist = foldTrackText(track.artist);
  const title = foldTrackText(track.title);
  if (!artist || !title) return null;
  return `${artist}\0${title}`;
}

function normalizedDuration(track: TrackIdentityFields): number {
  const value = track.duration_sec;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

export function isSameRecording(
  a: TrackIdentityFields,
  b: TrackIdentityFields,
): boolean {
  const idA = String(a.id ?? "").trim();
  const idB = String(b.id ?? "").trim();
  if (idA && idB && idA === idB) return true;

  const isrcA = normalizeIsrc(a.isrc);
  const isrcB = normalizeIsrc(b.isrc);
  if (isrcA && isrcB) return isrcA === isrcB;

  const sigA = fallbackSignature(a);
  const sigB = fallbackSignature(b);
  if (!sigA || sigA !== sigB) return false;

  const durA = normalizedDuration(a);
  const durB = normalizedDuration(b);
  if (isrcA || isrcB) {
    return (
      durA > 0 &&
      durB > 0 &&
      Math.abs(durA - durB) <= DURATION_TOLERANCE_SEC
    );
  }
  if (durA > 0 && durB > 0) {
    return Math.abs(durA - durB) <= DURATION_TOLERANCE_SEC;
  }
  return true;
}

/**
 * Shared mutation key identity: same ISRC -> same key across releases, so
 * clicking Like on Single and Album simultaneously shares one pending state.
 */
export function trackLikeIdentityKey(track: TrackIdentityFields | string | number): string {
  if (typeof track === "string" || typeof track === "number") {
    return String(track);
  }
  const isrc = normalizeIsrc(track.isrc);
  return isrc ? `isrc:${isrc}` : String(track.id);
}

export interface LikedTrackIndex<T extends TrackIdentityFields = TrackIdentityFields> {
  readonly byId: ReadonlyMap<string, T>;
  readonly byIsrc: ReadonlyMap<string, T>;
  readonly byFallback: ReadonlyMap<string, readonly T[]>;
}

const likedIndexCache = new WeakMap<readonly TrackIdentityFields[], LikedTrackIndex>();

export function getLikedTrackIndex<T extends TrackIdentityFields>(
  tracks: readonly T[],
): LikedTrackIndex<T> {
  const cached = likedIndexCache.get(tracks);
  if (cached) return cached as LikedTrackIndex<T>;

  const byId = new Map<string, T>();
  const byIsrc = new Map<string, T>();
  const byFallback = new Map<string, T[]>();

  for (const track of tracks) {
    const id = String(track.id ?? "").trim();
    if (id && !byId.has(id)) byId.set(id, track);

    const isrc = normalizeIsrc(track.isrc);
    if (isrc && !byIsrc.has(isrc)) byIsrc.set(isrc, track);

    const sig = fallbackSignature(track);
    if (sig) {
      const bucket = byFallback.get(sig);
      if (bucket) bucket.push(track);
      else byFallback.set(sig, [track]);
    }
  }

  const index: LikedTrackIndex<T> = { byId, byIsrc, byFallback };
  likedIndexCache.set(tracks, index);
  return index;
}

export function findLikedTrack<T extends TrackIdentityFields>(
  tracksOrIndex: readonly T[] | LikedTrackIndex<T>,
  candidate: TrackIdentityFields,
): T | undefined {
  const index = Array.isArray(tracksOrIndex)
    ? getLikedTrackIndex(tracksOrIndex)
    : (tracksOrIndex as LikedTrackIndex<T>);

  const id = String(candidate.id ?? "").trim();
  if (id) {
    const direct = index.byId.get(id);
    if (direct) return direct;
  }

  const isrc = normalizeIsrc(candidate.isrc);
  if (isrc) {
    const byIsrc = index.byIsrc.get(isrc);
    if (byIsrc) return byIsrc;
  }

  const sig = fallbackSignature(candidate);
  if (!sig) return undefined;
  const bucket = index.byFallback.get(sig);
  if (!bucket) return undefined;
  for (const item of bucket) {
    if (isSameRecording(item, candidate)) return item;
  }
  return undefined;
}

export function isTrackLiked<T extends TrackIdentityFields>(
  tracksOrIndex: readonly T[] | LikedTrackIndex<T>,
  candidate: TrackIdentityFields,
): boolean {
  return findLikedTrack(tracksOrIndex, candidate) !== undefined;
}
