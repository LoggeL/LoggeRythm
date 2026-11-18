import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { byTestId, elements, flatStyle, queryByTestId } from '../../test/render';
import { colors, layout, metrics } from '../../theme';
import StandardTrackRow from './StandardTrackRow';
import TrackShelfCard from './TrackShelfCard';

const mocks = vi.hoisted(() => ({
  useTrackPresentation: vi.fn(() => ({
    active: true,
    playback: 'buffering' as const,
    serverCache: 'cached' as const,
    rollingDeviceCache: null,
    explicitDownload: { kind: 'unknown' as const },
  })),
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
vi.mock('../TrackStateIndicator', () => ({ default: 'TrackStateIndicator' }));
vi.mock('./TrackIdentityLinks', () => ({ default: 'TrackIdentityLinks' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

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
  it('keeps exact occurrence identity and independent row actions', () => {
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const rendered = StandardTrackRow({
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
    });

    expect(mocks.useTrackPresentation).toHaveBeenLastCalledWith(
      {
        trackId: '42',
        queueContext: { type: 'album', id: '9' },
        originalContextOrder: 3,
      },
      { rollingDeviceCacheSeconds: undefined },
    );
    expect(byTestID(rendered, 'row-42').props.accessibilityState).toEqual({
      selected: true,
      busy: true,
    });
    expect(byTestID(rendered, 'row-42-position').props.children).toBe(4);
    (byTestID(rendered, 'row-42').props.onPress as () => void)();
    (byTestID(rendered, 'row-42-actions').props.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onActions).toHaveBeenCalledOnce();
    expect(byTestID(rendered, 'row-42-actions').props.accessibilityRole).toBe('button');
    assertNoNestedPressables(rendered);
  });

  it('keeps one row height and marks the active occurrence', () => {
    const rendered = StandardTrackRow({
      track,
      testID: 'row-42',
      onPlay: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    const container = flatStyle(byTestID(rendered, 'row-42-container').props.style);
    expect(container.minHeight).toBe(layout.rowHeight);
    expect(container.backgroundColor).toBe(colors.accentSubtle);
    const identity = elements(rendered).find((element) => element.type === 'TrackIdentityLinks');
    expect(identity?.props.active).toBe(true);
    // No overflow control and no supplemental line unless the owner provides them.
    expect(queryByTestId(rendered, 'row-42-actions')).toBeNull();
    expect(queryByTestId(rendered, 'row-42-metadata')).toBeNull();
    expect(queryByTestId(rendered, 'row-42-position')).toBeNull();
  });

  it('renders an owner-supplied collection fact as one labelled line in the row', () => {
    const rendered = StandardTrackRow({
      track,
      testID: 'row-42',
      caption: 'New · 2 days ago',
      highlighted: true,
      onPlay: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    const fact = byTestID(rendered, 'row-42-metadata');
    expect(fact.props.children).toBe('New · 2 days ago');
    expect(fact.props.accessibilityLabel).toBe('New · 2 days ago');
    expect(fact.props.numberOfLines).toBe(2);
  });

  it('speaks an owner-supplied label instead of an abbreviated collection fact', () => {
    const rendered = StandardTrackRow({
      track,
      testID: 'row-42',
      caption: 'New · today · Artist played 3×',
      captionAccessibilityLabel: 'New, today, In your radar because you played Artist 3 times',
      onPlay: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    const fact = byTestID(rendered, 'row-42-metadata');
    expect(fact.props.children).toBe('New · today · Artist played 3×');
    expect(fact.props.accessibilityLabel).toBe(
      'New, today, In your radar because you played Artist 3 times',
    );
  });

  it('uses a dedicated artwork play target and sibling card controls', () => {
    const rendered = TrackShelfCard({
      track,
      testID: 'card-42',
      occurrence: {
        queueContext: { type: 'chart', id: 'discover' },
        originalContextOrder: 0,
      },
      rank: 1,
      onPlay: vi.fn(),
      onActions: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    const play = byTestID(rendered, 'card-42');
    expect(play.type).toBe('PressableScale');
    expect(flatStyle(play.props.style)).toMatchObject({
      width: layout.artwork.card,
      height: layout.artwork.card,
    });
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
