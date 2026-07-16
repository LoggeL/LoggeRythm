import React from 'react';
import type { Track } from '../api/types';
import type { AlbumRouteParams, ArtistRouteParams } from '../screens/catalogModel';
import StandardTrackRow, {
  type TrackOccurrenceTarget,
} from './track/StandardTrackRow';

export interface TrackRowProps {
  track: Track;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  onPress: () => void;
  onLongPress?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/**
 * Compact compatibility wrapper used by Similar. It delegates all native and
 * server state to the single app-level presentation provider; no row owns a
 * query, progress poll, or player subscription.
 */
export default function TrackRow({
  track,
  testID,
  occurrence,
  onPress,
  onLongPress,
  onOpenAlbum,
  onOpenArtist,
}: TrackRowProps) {
  return (
    <StandardTrackRow
      track={track}
      testID={testID}
      occurrence={occurrence}
      popularity="none"
      showAlbumLabel={false}
      showDuration={false}
      onPlay={onPress}
      onActions={onLongPress}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}
