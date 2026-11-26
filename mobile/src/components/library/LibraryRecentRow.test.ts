import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentPlay } from '../../domain/listeningStats';
import type { TrackPresentationState } from '../../player/trackPresentation';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId as byTestID } from '../../test/render';
import { metrics } from '../../theme';
import { LibraryRecentRow } from './LibraryRecentRow';

const mocks = vi.hoisted(() => ({
  presentation: {
    active: true,
    playback: 'paused',
    serverCache: 'cached',
    rollingDeviceCache: null,
    explicitDownload: { kind: 'unknown' },
  } as TrackPresentationState,
  useTrackPresentation: vi.fn(),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('../player/TrackPresentationProvider', () => ({
  useTrackPresentation: (target: unknown) => {
    mocks.useTrackPresentation(target);
    return mocks.presentation;
  },
}));

vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../TrackStateIndicator', () => ({ default: 'TrackStateIndicator' }));
vi.mock('../track/TrackIdentityLinks', () => ({ default: 'TrackIdentityLinks' }));

const recent: RecentPlay = {
  id: 'track-1',
  title: 'Midnight Signal',
  artist: 'Primary Artist',
  artist_id: '1',
  artists: [
    { id: '1', name: 'Primary Artist' },
    { id: '2', name: 'Featured Artist' },
  ],
  album: 'Parity',
  album_id: '9',
  cover: 'https://example.test/cover.jpg',
  duration_sec: 180,
};

const occurrence = {
  queueContext: { type: 'recent' as const, id: '17' },
  originalContextOrder: 2,
};

describe('LibraryRecentRow', () => {
  const onPlay = vi.fn();
  const onActions = vi.fn();
  const onOpenAlbum = vi.fn();
  const onOpenArtist = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.presentation = {
      active: true,
      playback: 'paused',
      serverCache: 'cached',
      rollingDeviceCache: null,
      explicitDownload: { kind: 'unknown' },
    };
  });

  function render(busy = false, disabled = false) {
    return LibraryRecentRow({
      play: recent,
      index: 2,
      testID: 'library-recent-track-track-1-2',
      occurrence,
      busy,
      disabled,
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });
  }

  it('uses exact account occurrence identity and complete persisted metadata', () => {
    const row = render();
    const identity = byTestID(row, 'library-recent-track-track-1-2-identity');
    const metadata = identity.props.metadata as {
      duration: string | null;
      artists: { name: string }[];
      albumRoute: unknown;
    };

    expect(mocks.useTrackPresentation).toHaveBeenCalledExactlyOnceWith({
      trackId: 'track-1',
      ...occurrence,
    });
    expect(metadata.duration).toBe('3:00');
    expect(metadata.artists.map((artist) => artist.name)).toEqual([
      'Primary Artist',
      'Featured Artist',
    ]);
    expect(metadata.albumRoute).toEqual({ albumId: '9', title: 'Parity' });
    expect(identity.props.onOpenAlbum).toBe(onOpenAlbum);
    expect(identity.props.onOpenArtist).toBe(onOpenArtist);
  });

  it('plays from the title too, like every other track row', () => {
    const row = render();
    const play = byTestID(row, 'library-recent-track-track-1-2');
    const identity = byTestID(row, 'library-recent-track-track-1-2-identity');

    // The identity is inside the play target and has no links of its own.
    expect(byTestID(play, 'library-recent-track-track-1-2-identity')).toBe(identity);
    expect(identity.props.interactive).toBe(false);
  });

  it('keeps Play and overflow actions as sibling responders', () => {
    const row = render();
    const play = byTestID(row, 'library-recent-track-track-1-2');
    const actions = byTestID(row, 'library-recent-track-track-1-2-actions');

    expect(play.props.accessibilityRole).toBe('button');
    expect(play.props.accessibilityLabel).toBe(
      libraryStrings.library.playTrack(recent.title, recent.artist),
    );
    expect(actions.props.accessibilityRole).toBe('button');
    (play.props.onPress as () => void)();
    (actions.props.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onActions).toHaveBeenCalledOnce();
    expect(onOpenAlbum).not.toHaveBeenCalled();
    expect(onOpenArtist).not.toHaveBeenCalled();

    const playStyle = (play.props.style as (state: { pressed: boolean }) => unknown[])({
      pressed: false,
    })[0] as Record<string, number>;
    const actionStyle = (actions.props.style as (state: { pressed: boolean }) => unknown[])({
      pressed: false,
    })[0] as Record<string, number>;
    expect(playStyle.minWidth).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    expect(playStyle.minHeight).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    expect(actionStyle.width).toBe(metrics.minimumTouchTarget);
    expect(actionStyle.height).toBe(metrics.minimumTouchTarget);
  });

  it('keeps hydration busy distinct from native buffering', () => {
    const hydration = render(true, true);
    expect(byTestID(hydration, 'library-recent-track-track-1-2').props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true, selected: true },
    });
    expect(
      (byTestID(hydration, 'library-recent-track-track-1-2-state').props.presentation as TrackPresentationState)
        .playback,
    ).toBe('paused');

    mocks.presentation = { ...mocks.presentation, playback: 'buffering' };
    const buffering = render(false, false);
    expect(
      byTestID(buffering, 'library-recent-track-track-1-2').props.accessibilityState,
    ).toEqual({ disabled: false, busy: false, selected: true });
    expect(
      (byTestID(buffering, 'library-recent-track-track-1-2-state').props.presentation as TrackPresentationState)
        .playback,
    ).toBe('buffering');
  });
});
