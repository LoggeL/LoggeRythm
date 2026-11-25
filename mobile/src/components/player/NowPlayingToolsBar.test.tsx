import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { strings } from '../../localization';
import { byTestId } from '../../test/render';
import { NowPlayingToolsBar } from './NowPlayingToolsBar';

const mocks = vi.hoisted(() => ({
  sleepSheetOpen: false,
  setSleepSheetOpen: vi.fn(),
  timer: null as { type: 'time'; remainingSeconds: number; fadeOutSeconds: number } | { type: 'mediaItem'; index: number } | null,
  setTimer: vi.fn(),
  shareTrack: vi.fn(async () => undefined),
  showTrackActions: vi.fn(),
  reportPlayerError: vi.fn(),
  hapticTrigger: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  let stateCall = 0;
  return {
    ...actual,
    default: actual,
    useEffect: vi.fn(),
    useState: () => {
      const slot = stateCall++ % 2;
      return slot === 0
        ? [mocks.sleepSheetOpen, mocks.setSleepSheetOpen]
        : [mocks.timer, mocks.setTimer];
    },
  };
});

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));
vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: mocks.hapticTrigger }),
}));
vi.mock('../../player/errors', () => ({
  reportPlayerError: mocks.reportPlayerError,
}));
vi.mock('../../player/setup', () => ({
  isPlayerReady: () => true,
}));
vi.mock('../../screens/profileSleepTimer', () => ({
  nativeSleepTimerGateway: { read: () => mocks.timer },
}));
vi.mock('../../share/outboundShare', () => ({
  shareTrack: mocks.shareTrack,
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../profile/SleepTimerPanel', () => ({ SleepTimerPanel: 'SleepTimerPanel' }));
vi.mock('./NowPlayingAudioTools', () => ({ NowPlayingAudioTools: 'NowPlayingAudioTools' }));
vi.mock('../trackActions', () => ({ showTrackActions: mocks.showTrackActions }));
vi.mock('../ui', () => ({
  AppText: 'AppText',
  BottomSheet: 'BottomSheet',
  IconButton: 'IconButton',
}));

const track: Track = {
  id: '3135556',
  title: 'Instant Crush',
  artist: 'Daft Punk',
  artist_id: '27',
  artists: [{ id: '27', name: 'Daft Punk' }],
  album: 'Random Access Memories',
  album_id: '6575789',
  cover: '',
  duration_sec: 337,
  preview_url: null,
  rank: 1,
  release_date: '2013-05-17',
};

describe('NowPlayingToolsBar', () => {
  beforeEach(() => {
    mocks.sleepSheetOpen = false;
    mocks.timer = null;
    vi.clearAllMocks();
  });

  it('opens the sleep timer sheet, shares the track, and opens TrackActions overflow', async () => {
    const tree = NowPlayingToolsBar({ track });
    const sleepBtn = byTestId(tree, 'now-playing-sleep-timer');
    expect(sleepBtn.props.accessibilityLabel).toBe(strings.player.sleepTimer);
    (sleepBtn.props.onPress as () => void)();
    expect(mocks.setSleepSheetOpen).toHaveBeenCalledExactlyOnceWith(true);

    const shareBtn = byTestId(tree, 'now-playing-share');
    (shareBtn.props.onPress as () => void)();
    await vi.waitFor(() => expect(mocks.shareTrack).toHaveBeenCalledExactlyOnceWith(track));

    const moreBtn = byTestId(tree, 'now-playing-more');
    (moreBtn.props.onPress as () => void)();
    expect(mocks.showTrackActions).toHaveBeenCalledWith(track, expect.any(Function));
  });

  it('renders an active remaining-time badge when a sleep timer is running', () => {
    mocks.timer = { type: 'time', remainingSeconds: 900, fadeOutSeconds: 0 };
    const tree = NowPlayingToolsBar({ track });
    const sleepBtn = byTestId(tree, 'now-playing-sleep-timer');
    expect(sleepBtn.props.accessibilityState).toEqual({ selected: true });
    expect(sleepBtn.props.accessibilityLabel).toContain('15:00');
  });
});
