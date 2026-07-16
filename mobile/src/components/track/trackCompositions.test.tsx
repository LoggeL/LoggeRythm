import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { metrics } from '../../theme';
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
vi.mock('../TrackLikeButton', () => ({ default: 'TrackLikeButton' }));
vi.mock('../TrackStateIndicator', () => ({ default: 'TrackStateIndicator' }));
vi.mock('./TrackIdentityLinks', () => ({ default: 'TrackIdentityLinks' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestID(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`Missing ${testID}`);
  return found;
}

function assertNoNestedPressables(node: React.ReactNode, inside = false): void {
  if (Array.isArray(node)) {
    node.forEach((child) => assertNoNestedPressables(child, inside));
    return;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return;
  const element = node as React.ReactElement<ElementProps>;
  const pressable = element.type === 'Pressable';
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
    assertNoNestedPressables(rendered);
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
    const style = play.props.style as (state: { pressed: boolean }) => unknown[];
    expect(style({ pressed: false })).toContainEqual(expect.objectContaining({
      width: 160,
      height: 160,
    }));
    expect(elements(rendered).some((element) =>
      element.type === 'TrackLikeButton' && element.props.testID === 'card-42-like')).toBe(true);
    expect(byTestID(rendered, 'card-42-actions').props.accessibilityRole).toBe('button');
    assertNoNestedPressables(rendered);
    expect(metrics.minimumTouchTarget).toBeGreaterThanOrEqual(48);
  });
});
