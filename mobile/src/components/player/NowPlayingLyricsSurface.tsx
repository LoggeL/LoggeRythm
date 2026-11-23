import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ArtistRef, Track } from '../../api/types';
import LyricsPanel, { LiveLyricsPanel } from './LyricsPanel';
import { MemoNowPlayingArtwork, NowPlayingArtwork } from './NowPlayingArtwork';
import NowPlayingMetadata, { MemoNowPlayingMetadata } from './NowPlayingMetadata';
import NowPlayingTransport, { LiveNowPlayingTransport } from './NowPlayingTransport';
import { colors, layout, spacing } from '../../theme';

export interface NowPlayingLyricsSurfaceProps {
  track: Track;
  position: number;
  sliderPosition: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  onOpenAlbum: () => void;
  onOpenArtist: (artist: ArtistRef) => void;
  onPositionChange: (seconds: number) => void;
  onSeek: (seconds: number) => void;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
}

export type LiveNowPlayingLyricsSurfaceProps = Omit<
  NowPlayingLyricsSurfaceProps,
  'position' | 'sliderPosition' | 'duration' | 'onPositionChange'
>;

/**
 * Production-like compact lyrics composition. It has no player hooks: the
 * owning screen supplies one playback state and one set of commands.
 */
export default function NowPlayingLyricsSurface({
  track,
  position,
  sliderPosition,
  duration,
  playing,
  buffering,
  onOpenAlbum,
  onOpenArtist,
  onPositionChange,
  onSeek,
  onPrevious,
  onTogglePlay,
  onNext,
}: NowPlayingLyricsSurfaceProps) {
  return (
    <View testID="now-playing-lyrics-surface" style={styles.surface}>
      <View testID="now-playing-lyrics-header" style={styles.header}>
        <NowPlayingArtwork
          compact
          coverUri={track.cover}
          testID="now-playing-lyrics-artwork"
          style={styles.artwork}
        />
        <NowPlayingMetadata
          compact
          track={track}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      </View>

      <LyricsPanel track={track} position={position} onSeek={onSeek} />

      <NowPlayingTransport
        variant="compact"
        testIDPrefix="now-playing-lyrics"
        position={sliderPosition}
        duration={duration}
        playing={playing}
        buffering={buffering}
        onPositionChange={onPositionChange}
        onSeek={onSeek}
        onPrevious={onPrevious}
        onTogglePlay={onTogglePlay}
        onNext={onNext}
      />
    </View>
  );
}

/**
 * Progress-isolated compact lyrics composition. Keeps the compact artwork and
 * metadata header completely static across 0.5-1Hz progress ticks while
 * scoping progress subscriptions exclusively to `LiveLyricsPanel` and
 * `LiveNowPlayingTransport`.
 */
export const LiveNowPlayingLyricsSurface = React.memo(function LiveNowPlayingLyricsSurface({
  track,
  playing,
  buffering,
  onOpenAlbum,
  onOpenArtist,
  onSeek,
  onPrevious,
  onTogglePlay,
  onNext,
}: LiveNowPlayingLyricsSurfaceProps) {
  return (
    <View testID="now-playing-lyrics-surface" style={styles.surface}>
      <View testID="now-playing-lyrics-header" style={styles.header}>
        <MemoNowPlayingArtwork
          compact
          coverUri={track.cover}
          testID="now-playing-lyrics-artwork"
          style={styles.artwork}
        />
        <MemoNowPlayingMetadata
          compact
          track={track}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      </View>

      <LiveLyricsPanel track={track} onSeek={onSeek} />

      <LiveNowPlayingTransport
        variant="compact"
        testIDPrefix="now-playing-lyrics"
        trackId={track.id}
        playing={playing}
        buffering={buffering}
        onSeek={onSeek}
        onPrevious={onPrevious}
        onTogglePlay={onTogglePlay}
        onNext={onNext}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  surface: { flex: 1, minHeight: 0 },
  header: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  artwork: { width: layout.artwork.md, height: layout.artwork.md },
});
