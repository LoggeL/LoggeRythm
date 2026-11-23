import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import type { TrackPresentationState } from '../../player/trackPresentation';
import { byTestId, elements, flatStyle, queryByTestId } from '../../test/render';
import { colors, layout, metrics } from '../../theme';
import StandardTrackRow, {
  areStandardTrackRowViewPropsEqual,
  type StandardTrackRowViewProps,
} from './StandardTrackRow';
import TrackShelfCard, {
  areTrackShelfCardViewPropsEqual,
  type TrackShelfCardViewProps,
} from './TrackShelfCard';

const mocks = vi.hoisted(() => ({
  presentation: {
    active: true,
    playback: 'buffering',
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
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 1,
  },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../player/TrackPresentationProvider', () => ({
  useTrackPresentation: mocks.useTrackPresentation,
}));
// PressableScale owns animation state (a hook), so it cannot be called outside a render.
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
}));
vi.mock('../TrackLikeButton', () => ({ default: 'TrackLikeButton' }));
vi.mock('../TrackStateIndicator', () => ({
  default: 'TrackStateIndicator',
  MemoEqualizerBars: 'MemoEqualizerBars',
}));
vi.mock('./TrackIdentityLinks', () => ({ default: 'TrackIdentityLinks' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

/** Unwraps the top-level React.memo view returned by StandardTrackRow / TrackShelfCard. */
function unwrapMemoRoot(node: React.ReactElement): React.ReactNode {
  const type = node.type as { type?: (props: ElementProps) => React.ReactNode };
  if (typeof type === 'object' && type !== null && typeof type.type === 'function') {
    return type.type(node.props as ElementProps);
  }
  return node;
}

// The shared primitives (IconButton, Artwork, AppText) are real here, so the
// shared helpers expand them down to host elements.
const byTestID = byTestId;

/** Walks through function components, so a Pressable inside a primitive counts too. */
function assertNoNestedPressables(node: React.ReactNode, inside = false): void {
  if (Array.isArray(node)) {
    node.forEach((child) => assertNoNestedPressables(child, inside));
    return;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return;
  const element = node as React.ReactElement<ElementProps>;
  if (typeof element.type === 'function') {
    const render = element.type as (props: ElementProps) => React.ReactNode;
    assertNoNestedPressables(render(element.props), inside);
    return;
  }
  const pressable = element.type === 'Pressable' || element.type === 'PressableScale';
  if (inside && pressable) throw new Error('nested Pressable');
  assertNoNestedPressables(element.props.children, inside || pressable);
}

const track: Track = {
  id: '42',
  title: 'Midnight Signal',
  artist: 'Primary Artist',
  artist_id: '7',
  artists: [{ id: '7', name: 'Primary Artist' }],
  album: 'Parity',
  album_id: '9',
  cover: 'https://example.test/cover.jpg',
  duration_sec: 185,
  preview_url: null,
  rank: 750_000,
  release_date: '',
};

describe('shared track compositions', () => {
  beforeEach(() => {
    mocks.presentation = {
      active: true,
      playback: 'buffering',
      serverCache: 'cached',
      rollingDeviceCache: null,
      explicitDownload: { kind: 'unknown' },
    };
    mocks.useTrackPresentation.mockReset();
    mocks.useTrackPresentation.mockImplementation(() => mocks.presentation);
  });

  it('uses row-wide tap-to-play wrapping artwork and non-interactive identity with independent Like/Actions siblings', () => {
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const rendered = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        occurrence: {
          queueContext: { type: 'album', id: '9' },
          originalContextOrder: 3,
        },
        position: 4,
        onPlay,
        onActions,
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );

    expect(mocks.useTrackPresentation).toHaveBeenLastCalledWith(
      {
        trackId: '42',
        queueContext: { type: 'album', id: '9' },
        originalContextOrder: 3,
      },
      { rollingDeviceCacheSeconds: undefined },
    );
    const playBody = byTestID(rendered, 'row-42');
    expect(playBody.props.accessibilityState).toEqual({
      selected: true,
      busy: true,
    });
    expect(byTestID(rendered, 'row-42-position').props.children).toBe(4);
    // Identity lives inside the row-body play target in non-interactive mode so
    // tapping title/artist plays instead of hijacking to Album/Artist.
    const bodyIdentity = elements(playBody).find(
      (element) => element.type === 'TrackIdentityLinks',
    );
    expect(bodyIdentity?.props.interactive).toBe(false);
    expect(bodyIdentity?.props.active).toBe(true);

    (playBody.props.onPress as () => void)();
    (byTestID(rendered, 'row-42-actions').props.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onActions).toHaveBeenCalledOnce();
    expect(byTestID(rendered, 'row-42-actions').props.accessibilityRole).toBe('button');
    assertNoNestedPressables(rendered);
  });

  it('renders EqualizerBars on active playing and paused rows, and omits it on buffering/inactive rows', () => {
    const buffering = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );
    expect(queryByTestId(buffering, 'row-42-equalizer')).toBeNull();

    mocks.presentation = { ...mocks.presentation, active: true, playback: 'playing' };
    const playing = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );
    expect(byTestID(playing, 'row-42-equalizer').props.isPlaying).toBe(true);

    mocks.presentation = { ...mocks.presentation, active: true, playback: 'paused' };
    const paused = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );
    expect(byTestID(paused, 'row-42-equalizer').props.isPlaying).toBe(false);

    mocks.presentation = { ...mocks.presentation, active: false, playback: 'inactive' };
    const inactive = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );
    expect(queryByTestId(inactive, 'row-42-equalizer')).toBeNull();
  });

  it('keeps one row height and marks the active occurrence', () => {
    const rendered = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );

    const containerNode = byTestID(rendered, 'row-42-container');
    expect(containerNode.props.collapsable).toBe(false);
    const container = flatStyle(containerNode.props.style);
    expect(container.minHeight).toBe(layout.rowHeight);
    expect(container.backgroundColor).toBe(colors.accentSubtle);
    // Regression guard for RN 0.86 Android Fabric BackgroundStyleApplicator:
    // container must never dynamically toggle borderLeftWidth/borderWidth.
    expect(container.borderLeftWidth).toBeUndefined();
    expect(container.borderWidth).toBeUndefined();
    const accentBar = byTestID(rendered, 'row-42-active-accent');
    expect(accentBar.props).toMatchObject({
      accessible: false,
      focusable: false,
      pointerEvents: 'none',
    });
    expect(flatStyle(accentBar.props.style)).toMatchObject({
      position: 'absolute',
      left: 0,
      width: 3,
      backgroundColor: colors.accent,
    });
    const identity = elements(rendered).find((element) => element.type === 'TrackIdentityLinks');
    expect(identity?.props.active).toBe(true);
    // No overflow control and no supplemental line unless the owner provides them.
    expect(queryByTestId(rendered, 'row-42-actions')).toBeNull();
    expect(queryByTestId(rendered, 'row-42-metadata')).toBeNull();
    expect(queryByTestId(rendered, 'row-42-position')).toBeNull();

    // Active -> inactive transition keeps container borderless and restores transparent background.
    mocks.presentation = { ...mocks.presentation, active: false, playback: 'inactive' };
    const inactive = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );
    const inactiveStyle = flatStyle(byTestID(inactive, 'row-42-container').props.style);
    expect(inactiveStyle.backgroundColor).toBe('transparent');
    expect(inactiveStyle.borderLeftWidth).toBeUndefined();
    expect(inactiveStyle.borderWidth).toBeUndefined();
    expect(queryByTestId(inactive, 'row-42-active-accent')).toBeNull();
  });

  it('renders an owner-supplied collection fact as one labelled line in the row', () => {
    const rendered = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        caption: 'New · 2 days ago',
        highlighted: true,
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );

    const fact = byTestID(rendered, 'row-42-metadata');
    expect(fact.props.children).toBe('New · 2 days ago');
    expect(fact.props.accessibilityLabel).toBe('New · 2 days ago');
    expect(fact.props.numberOfLines).toBe(2);
  });

  it('speaks an owner-supplied label instead of an abbreviated collection fact', () => {
    const rendered = unwrapMemoRoot(
      StandardTrackRow({
        track,
        testID: 'row-42',
        caption: 'New · today · Artist played 3×',
        captionAccessibilityLabel: 'New, today, In your radar because you played Artist 3 times',
        onPlay: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );

    const fact = byTestID(rendered, 'row-42-metadata');
    expect(fact.props.children).toBe('New · today · Artist played 3×');
    expect(fact.props.accessibilityLabel).toBe(
      'New, today, In your radar because you played Artist 3 times',
    );
  });

  it('memo comparators skip unchanged presentation objects and detect semantic playback transitions', () => {
    const baseRowProps: StandardTrackRowViewProps = {
      track,
      testID: 'row-42',
      onPlay: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      presentation: {
        active: false,
        playback: 'inactive',
        serverCache: 'cached',
        rollingDeviceCache: null,
        explicitDownload: { kind: 'not-downloaded' },
      },
    };
    const sameRowValues: StandardTrackRowViewProps = {
      ...baseRowProps,
      presentation: {
        active: false,
        playback: 'inactive',
        serverCache: 'cached',
        rollingDeviceCache: null,
        explicitDownload: { kind: 'not-downloaded' },
      },
    };
    expect(areStandardTrackRowViewPropsEqual(baseRowProps, sameRowValues)).toBe(true);
    expect(
      areStandardTrackRowViewPropsEqual(baseRowProps, {
        ...sameRowValues,
        presentation: { ...sameRowValues.presentation, active: true, playback: 'playing' },
      }),
    ).toBe(false);

    const baseCardProps: TrackShelfCardViewProps = {
      track,
      testID: 'card-42',
      onPlay: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      presentation: baseRowProps.presentation,
    };
    expect(
      areTrackShelfCardViewPropsEqual(baseCardProps, {
        ...baseCardProps,
        presentation: { ...baseRowProps.presentation },
      }),
    ).toBe(true);
    expect(
      areTrackShelfCardViewPropsEqual(baseCardProps, {
        ...baseCardProps,
        presentation: { ...baseRowProps.presentation, playback: 'paused', active: true },
      }),
    ).toBe(false);
  });

  it('uses a dedicated artwork play target and sibling card controls with TV focus forwarding', () => {
    const onFocus = vi.fn();
    mocks.presentation = { ...mocks.presentation, active: true, playback: 'playing' };
    const rendered = unwrapMemoRoot(
      TrackShelfCard({
        track,
        testID: 'card-42',
        occurrence: {
          queueContext: { type: 'chart', id: 'discover' },
          originalContextOrder: 0,
        },
        rank: 1,
        focusable: true,
        hasTVPreferredFocus: true,
        onFocus,
        onPlay: vi.fn(),
        onActions: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    );

    const play = byTestID(rendered, 'card-42');
    expect(play.type).toBe('PressableScale');
    expect(play.props.focusable).toBe(true);
    expect(play.props.hasTVPreferredFocus).toBe(true);
    expect(play.props.onFocus).toBe(onFocus);
    expect(flatStyle(play.props.style)).toMatchObject({
      width: layout.artwork.card,
      height: layout.artwork.card,
    });
    expect(byTestID(rendered, 'card-42-equalizer').props.isPlaying).toBe(true);
    expect(elements(rendered).some((element) =>
      element.type === 'TrackLikeButton' && element.props.testID === 'card-42-like')).toBe(true);
    expect(byTestID(rendered, 'card-42-actions').props.accessibilityRole).toBe('button');
    expect(byTestID(rendered, 'card-42').props.onLongPress).toBe(
      byTestID(rendered, 'card-42-actions').props.onPress,
    );
    assertNoNestedPressables(rendered);
    expect(metrics.minimumTouchTarget).toBeGreaterThanOrEqual(48);
  });
});
