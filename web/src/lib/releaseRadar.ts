type TrackIdentity = { id: string | number };

export function radarTrackIds(tracks: readonly TrackIdentity[]): string[] {
  const ids = new Set<string>();
  for (const track of tracks) {
    const id = String(track.id);
    if (!id) {
      throw new Error("Release Radar enthielt einen Song ohne Track-ID.");
    }
    ids.add(id);
  }
  return [...ids];
}

export function countUnseenRadarTracks(
  currentTrackIds: readonly string[],
  seenTrackIds: readonly string[],
): number {
  const seen = new Set(seenTrackIds);
  const unseen = new Set(
    currentTrackIds.filter((trackId) => !seen.has(trackId)),
  );
  return unseen.size;
}

export function mergeSeenRadarTrackIds(
  seenTrackIds: readonly string[],
  visibleTrackIds: readonly string[],
): string[] {
  return [...new Set([...seenTrackIds, ...visibleTrackIds])];
}
