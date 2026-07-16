import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { strings } from '../../localization';
import type { RemoteVisualState } from '../../data/remoteState';
import SimilarPanel, { SimilarPanelView, type SimilarPanelViewProps } from './SimilarPanel';

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../../data', () => ({
  musicQueries: { similarTracks: vi.fn((id: string) => ({ queryKey: ['similar', id] })) },
}));
vi.mock('../../player/controller', () => ({ playTracks: vi.fn() }));
vi.mock('../TrackRow', () => ({ default: 'TrackRow' }));
vi.mock('../trackActions', () => ({ showTrackActions: vi.fn() }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  if (typeof element.type === 'function') {
    const rendered = (element.type as (props: ElementProps) => React.ReactNode)(element.props);
    return [element, ...elements(rendered)];
  }
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

function track(id: string, title = `Track ${id}`): Track {
  return {
    id,
    title,
    artist: 'Artist',
    artist_id: '10',
    artists: [{ id: '10', name: 'Artist' }],
    album: 'Album',
    album_id: '20',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

const content: RemoteVisualState = { body: 'content', notice: null };

function view(overrides: Partial<SimilarPanelViewProps> = {}) {
  return SimilarPanelView({
    seedId: 'seed-a',
    tracks: [track('1'), track('2')],
    state: content,
    retryBusy: false,
    runtimeError: null,
    onRetry: vi.fn(),
    onPlay: vi.fn(),
    onActions: vi.fn(),
    onOpenAlbum: vi.fn(),
    onOpenArtist: vi.fn(),
    ...overrides,
  });
}

describe('SimilarPanel view', () => {
  it.each([
    [{ body: 'loading', notice: null }, 'similar-loading'],
    [{ body: 'offline', notice: null }, 'similar-offline'],
    [{ body: 'hard-error', notice: null }, 'similar-error'],
    [{ body: 'empty', notice: null }, 'similar-empty'],
  ] as const)('renders the exclusive %s body without actionable rows', (state, testID) => {
    const rendered = view({ state });

    expect(byTestId(rendered, testID)).not.toBeNull();
    expect(byTestId(rendered, 'similar-list')).toBeNull();
  });

  it.each([
    ['cached-offline', 'similar-cached-offline'],
    ['cached-refresh-error', 'similar-cached-error'],
    ['refreshing', 'similar-refreshing'],
    ['stale', 'similar-stale'],
  ] as const)('keeps last-good rows mounted with the %s notice', (notice, testID) => {
    const rendered = view({ state: { body: 'content', notice } });

    expect(byTestId(rendered, 'similar-list')).not.toBeNull();
    expect(byTestId(rendered, testID)).not.toBeNull();
  });

  it('provides a localized retry and disables duplicate in-flight retries', () => {
    const onRetry = vi.fn();
    const rendered = view({
      state: { body: 'hard-error', notice: null },
      retryBusy: true,
      onRetry,
    });
    const retry = byTestId(rendered, 'similar-error-action');

    expect(retry?.props).toMatchObject({
      accessibilityLabel: strings.player.similar.retry,
      disabled: true,
      accessibilityState: { busy: true, disabled: true },
    });
    expect(elements(rendered).some((element) =>
      element.props.children === 'private.internal/api/radio?token=secret')).toBe(false);
  });

  it('uses a bounded virtualized list with duplicate-safe seed-owned keys and full row actions', () => {
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const duplicate = track('7', 'Duplicate');
    const rendered = view({
      tracks: [duplicate, duplicate],
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });
    const list = byTestId(rendered, 'similar-list');

    expect(list?.props).toMatchObject({
      initialNumToRender: 8,
      maxToRenderPerBatch: 8,
      windowSize: 7,
      removeClippedSubviews: true,
    });
    const keyExtractor = list?.props.keyExtractor as (item: Track, index: number) => string;
    expect(keyExtractor(duplicate, 0)).toBe('seed-a:7:0');
    expect(keyExtractor(duplicate, 1)).toBe('seed-a:7:1');

    const renderItem = list?.props.renderItem as (info: { item: Track; index: number }) => React.ReactElement<ElementProps>;
    const row = renderItem({ item: duplicate, index: 1 });
    expect(row.type).toBe('TrackRow');
    expect(row.props.track).toBe(duplicate);
    expect(row.props).toMatchObject({
      testID: 'similar-track-seed-a-7-1',
      occurrence: {
        queueContext: { type: 'radio', id: 'similar:seed-a' },
        originalContextOrder: 1,
      },
      onOpenAlbum,
      onOpenArtist,
    });
    expect(typeof row.props.onLongPress).toBe('function');
    (row.props.onPress as () => void)();
    (row.props.onLongPress as () => void)();
    expect(onPlay).toHaveBeenCalledWith(1);
    expect(onActions).toHaveBeenCalledWith(duplicate);
  });

  it('announces only safe localized runtime action feedback', () => {
    const rendered = view({ runtimeError: strings.player.similar.playFailed });
    const error = elements(rendered).find((element) =>
      element.props.testID === 'similar-runtime-error'
      && element.props.accessibilityRole === 'alert');

    expect(error?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(elements(rendered).some((element) =>
      element.props.children === strings.player.similar.playFailed)).toBe(true);
  });

  it('keys the query owner by seed so local errors and old rows remount atomically', () => {
    const seedA = track('seed-a');
    const seedB = track('seed-b');
    const callbacks = { onOpenAlbum: vi.fn(), onOpenArtist: vi.fn() };
    const first = SimilarPanel({ seed: seedA, ...callbacks });
    const replacement = SimilarPanel({ seed: seedB, ...callbacks });

    expect(first.key).toBe('seed-a');
    expect(replacement.key).toBe('seed-b');
  });
});
