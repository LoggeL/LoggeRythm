import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import QueueScreen, {
  QueueSurface,
  QueueSurfaceGlobalFeedback,
  QueueSurfaceHeader,
  queueSurfacePadding,
} from './QueueScreen';

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  SectionList: 'SectionList',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 1,
  },
  Text: 'Text',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 20, left: 0 }),
}));

vi.mock('@rntp/player', () => ({
  default: { addEventListener: vi.fn() },
  Event: { QueueChanged: 'QueueChanged', MediaItemTransition: 'MediaItemTransition' },
  useProgress: () => ({ cached: 0 }),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../components/PlayerNoticeBanner', () => ({ default: 'PlayerNoticeBanner' }));
vi.mock('../data', () => ({ musicQueries: { cachedTrackIds: vi.fn(() => ({})) } }));
vi.mock('../player/controller', () => ({
  clearUpcomingQueue: vi.fn(),
  getQueueSnapshot: vi.fn(),
  isContextShuffleEnabled: vi.fn(() => false),
  moveQueueItem: vi.fn(),
  removeQueueItem: vi.fn(),
  skipToQueueItem: vi.fn(),
  toggleShuffle: vi.fn(),
}));
vi.mock('../player/errors', () => ({
  clearPlayerError: vi.fn(),
  reportPlayerError: vi.fn(),
  usePlayerError: vi.fn(() => null),
}));
vi.mock('../player/mediaItem', () => ({ mediaItemToTrack: vi.fn() }));
vi.mock('../player/queueContract', () => ({
  queueContextOf: vi.fn(),
  queueOriginOf: vi.fn(),
  queueStableIdOf: vi.fn(),
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

describe('Queue surface standalone and embedded contracts', () => {
  it('keeps the navigation route as a thin standalone QueueSurface wrapper', () => {
    const goBack = vi.fn();
    const rendered = QueueScreen({ navigation: { goBack } } as never);

    expect(rendered.type).toBe(QueueSurface);
    expect(rendered.props.embedded).toBeUndefined();
    (rendered.props.onClose as () => void)();
    expect(goBack).toHaveBeenCalledOnce();
  });

  it('owns safe-area padding only when rendered as the standalone route', () => {
    expect(queueSurfacePadding(false, 24, 20)).toEqual({
      paddingTop: 32,
      paddingBottom: 20,
    });
    expect(queueSurfacePadding(false, 0, 0)).toEqual({
      paddingTop: 8,
      paddingBottom: 12,
    });
    expect(queueSurfacePadding(true, 24, 20)).toEqual({
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it('keeps the title/count and standalone dismissal semantics', () => {
    const onClose = vi.fn();
    const rendered = QueueSurfaceHeader({ embedded: false, upcomingCount: 3, onClose });
    const close = byTestId(rendered, 'queue-close');

    expect(byTestId(rendered, 'queue-header')).not.toBeNull();
    expect(elements(rendered).some((element) =>
      element.props.children === strings.queue.upcomingCount(3))).toBe(true);
    expect(close?.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: strings.queue.close,
    });
    (close?.props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the title/count but removes the duplicate close affordance when embedded', () => {
    const rendered = QueueSurfaceHeader({
      embedded: true,
      upcomingCount: 2,
      onClose: vi.fn(),
    });

    expect(byTestId(rendered, 'queue-header')).not.toBeNull();
    expect(elements(rendered).some((element) =>
      element.props.children === strings.queue.upcomingCount(2))).toBe(true);
    expect(byTestId(rendered, 'queue-close')).toBeNull();
  });

  it('keeps standalone global errors/notices and suppresses both for an embedded owner', () => {
    const standalone = QueueSurfaceGlobalFeedback({
      embedded: false,
      playerError: 'Safe player error',
    });

    expect(byTestId(standalone, 'queue-error')?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(elements(standalone).some((element) => element.type === 'PlayerNoticeBanner'))
      .toBe(true);
    expect(QueueSurfaceGlobalFeedback({ embedded: true, playerError: 'Duplicate' })).toBeNull();
  });
});
