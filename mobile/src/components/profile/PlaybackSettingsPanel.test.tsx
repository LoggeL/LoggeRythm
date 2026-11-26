import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, textContent } from '../../test/render';
import { PlaybackSettingsPanelView } from './PlaybackSettingsPanel';

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../config', () => ({ getCurrentApiBase: () => 'https://music.example.test' }));
vi.mock('../../data', () => ({
  musicCacheScope: vi.fn(),
  musicQueries: { playbackSettings: vi.fn() },
  musicRepository: { updatePlaybackSettings: vi.fn() },
  queryKeys: { profile: { settings: vi.fn() } },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Skeleton: 'Skeleton',
}));

describe('PlaybackSettingsPanelView', () => {
  it('toggles crossfade and updates preset durations', () => {
    const onUpdate = vi.fn();
    const tree = PlaybackSettingsPanelView({
      settings: { crossfade_enabled: false, crossfade_duration_sec: 0 },
      isPending: false,
      isError: false,
      saving: false,
      savedNotice: false,
      saveError: null,
      onRetry: vi.fn(),
      onUpdate,
    });

    (byTestId(tree, 'profile-crossfade-toggle').props.onValueChange as (next: boolean) => void)(true);
    expect(onUpdate).toHaveBeenCalledWith({ crossfade_enabled: true, crossfade_duration_sec: 4 });

    (byTestId(tree, 'profile-crossfade-8').props.onPress as () => void)();
    expect(onUpdate).toHaveBeenCalledWith({ crossfade_enabled: true, crossfade_duration_sec: 8 });

    (byTestId(tree, 'profile-crossfade-0').props.onPress as () => void)();
    expect(onUpdate).toHaveBeenCalledWith({ crossfade_enabled: false, crossfade_duration_sec: 0 });
  });

  it('shows DJ transitions off by default and saves the toggle', () => {
    const onUpdate = vi.fn();
    const tree = PlaybackSettingsPanelView({
      settings: { crossfade_enabled: false, crossfade_duration_sec: 0 },
      isPending: false,
      isError: false,
      saving: false,
      savedNotice: false,
      saveError: null,
      onRetry: vi.fn(),
      onUpdate,
    });
    const toggle = byTestId(tree, 'profile-dj-transitions-toggle');
    expect(toggle.props.value).toBe(false);
    expect(toggle.props.accessibilityLabel).toBe(strings.profile.djTransitionsEnabled);
    (toggle.props.onValueChange as (next: boolean) => void)(true);
    expect(onUpdate).toHaveBeenCalledWith({ dj_transitions_enabled: true });
  });

  it('shows retryable load error and assertive save errors', () => {
    const onRetry = vi.fn();
    const errTree = PlaybackSettingsPanelView({
      settings: undefined,
      isPending: false,
      isError: true,
      saving: false,
      savedNotice: false,
      saveError: null,
      onRetry,
      onUpdate: vi.fn(),
    });
    (byTestId(errTree, 'profile-playback-retry').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    const saveErrTree = PlaybackSettingsPanelView({
      settings: { crossfade_enabled: true, crossfade_duration_sec: 6 },
      isPending: false,
      isError: false,
      saving: false,
      savedNotice: false,
      saveError: strings.profile.crossfadeSaveFailed,
      onRetry: vi.fn(),
      onUpdate: vi.fn(),
    });
    expect(byTestId(saveErrTree, 'profile-crossfade-save-error').props.accessibilityRole).toBe('alert');
  });

  it('omits the duplicate Playback group heading when hideHeader is enabled while keeping all controls', () => {
    const tree = PlaybackSettingsPanelView({
      settings: { crossfade_enabled: true, crossfade_duration_sec: 4, preferred_quality: 'high' },
      isPending: false,
      isError: false,
      saving: false,
      savedNotice: false,
      saveError: null,
      onRetry: vi.fn(),
      onUpdate: vi.fn(),
      onOpenAudioEffects: vi.fn(),
      hideHeader: true,
    });

    expect(byTestId(tree, 'profile-playback')).toBeDefined();
    expect(textContent(tree)).not.toContain(strings.profile.playbackTitle);
    expect(byTestId(tree, 'profile-crossfade-toggle')).toBeDefined();
    expect(byTestId(tree, 'profile-dj-transitions-toggle')).toBeDefined();
    expect(byTestId(tree, 'profile-quality-high')).toBeDefined();
    expect(byTestId(tree, 'profile-share-activity-toggle')).toBeDefined();
    expect(byTestId(tree, 'profile-open-audio-effects')).toBeDefined();
  });
});
