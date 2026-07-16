import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ArtistRef, Track } from '../../api/types';
import LyricsPanel from './LyricsPanel';
import { NowPlayingArtwork } from './NowPlayingArtwork';
import NowPlayingMetadata from './NowPlayingMetadata';
import NowPlayingTransport from './NowPlayingTransport';

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

const styles = StyleSheet.create({
  surface: { flex: 1, minHeight: 0 },
  header: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
  },
  artwork: { width: 56, height: 56 },
});
