import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LyricsLine, LyricsResponse } from '../../api/types';
import { strings } from '../../localization';
import { LyricsPanelView } from './LyricsPanel';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../../data', () => ({ musicQueries: { lyrics: vi.fn() } }));

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

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

const lines: LyricsLine[] = [
  { t: 12.5, text: 'Signal in the dark' },
  { t: 20, text: '' },
];

const response = (overrides: Partial<LyricsResponse> = {}): LyricsResponse => ({
  lines,
  synced: true,
  source: 'lrclib',
  ai_generated: false,
  ...overrides,
});

function view(
  overrides: Partial<Parameters<typeof LyricsPanelView>[0]> = {},
): React.ReactElement {
  return LyricsPanelView({
    response: undefined,
    error: null,
    isPending: true,
    isFetching: true,
    isStale: false,
    fetchStatus: 'idle',
    activeIndex: -1,
    onSeek: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  });
}

describe('LyricsPanelView', () => {
  it('renders exclusive accessible loading, hard-error, and empty states', () => {
    const loading = view();
    expect(byTestId(loading, 'lyrics-loading')?.props.accessibilityRole).toBe('progressbar');
    expect(byTestId(loading, 'lyrics-error')).toBeNull();

    const retry = vi.fn();
    const error = view({
      error: new Error('private backend diagnostic'),
      isPending: false,
      isFetching: false,
      onRetry: retry,
    });
    expect(byTestId(error, 'lyrics-error')?.props.accessibilityRole).toBe('alert');
    expect(textContent(error)).toContain(strings.player.lyrics.loadFailed);
    expect(textContent(error)).not.toContain('private backend diagnostic');
    (byTestId(error, 'lyrics-retry')?.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();

    const empty = view({
      response: response({ lines: null }),
      isPending: false,
      isFetching: false,
    });
    expect(byTestId(empty, 'lyrics-empty')).not.toBeNull();
    expect(byTestId(empty, 'lyrics-list')).toBeNull();
  });

  it('exposes synchronized/source/AI/cache provenance without raw provider text', () => {
    const rendered = view({
      response: response({
        source: 'untrusted provider stack trace',
        ai_generated: true,
        cached: true,
      }),
      isPending: false,
      isFetching: false,
      activeIndex: 0,
    });

    expect(byTestId(rendered, 'lyrics-synced')).not.toBeNull();
    expect(byTestId(rendered, 'lyrics-ai-generated')).not.toBeNull();
    expect(byTestId(rendered, 'lyrics-cached')).not.toBeNull();
    expect(textContent(byTestId(rendered, 'lyrics-source'))).toBe(
      strings.player.lyrics.source(strings.player.lyrics.sources.external),
    );
    expect(textContent(rendered)).not.toContain('stack trace');
  });

  it('marks the active line and seeks once to the exact server timestamp', () => {
    const onSeek = vi.fn();
    const rendered = view({
      response: response(),
      isPending: false,
      isFetching: false,
      activeIndex: 0,
      onSeek,
    });
    const list = byTestId(rendered, 'lyrics-list');
    const renderItem = list?.props.renderItem as (info: {
      item: LyricsLine;
      index: number;
    }) => React.ReactElement<ElementProps>;
    const active = renderItem({ item: lines[0], index: 0 });
    const instrumental = renderItem({ item: lines[1], index: 1 });

    expect(active.props.accessibilityRole).toBe('button');
    expect(active.props.accessibilityState).toEqual({ selected: true });
    expect(active.props.accessibilityLabel).toBe(
      strings.player.lyrics.lineLabel('Signal in the dark', '0:12'),
    );
    (active.props.onPress as () => void)();
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(12.5);
    expect(instrumental.props.accessibilityState).toEqual({ selected: false });
    expect(instrumental.props.accessibilityLabel).toBe(
      strings.player.lyrics.lineLabel(strings.player.lyrics.instrumentalLine, '0:20'),
    );
  });

  it('keeps last-good lyrics visible during refresh and cached refresh failure', () => {
    const refreshing = view({
      response: response(),
      isPending: false,
      isFetching: true,
      isStale: true,
      fetchStatus: 'fetching',
    });
    expect(byTestId(refreshing, 'lyrics-list')).not.toBeNull();
    expect(byTestId(refreshing, 'lyrics-refreshing')).not.toBeNull();

    const retry = vi.fn();
    const failed = view({
      response: response(),
      error: new Error('refresh failed'),
      isPending: false,
      isFetching: false,
      onRetry: retry,
    });
    expect(byTestId(failed, 'lyrics-list')).not.toBeNull();
    expect(byTestId(failed, 'lyrics-cached-error')?.props.accessibilityRole).toBe('alert');
    (byTestId(failed, 'lyrics-retry')?.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders retryable offline and cached-offline states without hiding lyrics', () => {
    const blockingRetry = vi.fn();
    const blocking = view({
      error: { status: 0 },
      isPending: false,
      isFetching: false,
      isStale: true,
      fetchStatus: 'idle',
      onRetry: blockingRetry,
    });
    expect(byTestId(blocking, 'lyrics-offline')?.props.accessibilityRole).toBe('alert');
    expect(byTestId(blocking, 'lyrics-list')).toBeNull();
    (byTestId(blocking, 'lyrics-retry')?.props.onPress as () => void)();
    expect(blockingRetry).toHaveBeenCalledOnce();

    const cachedRetry = vi.fn();
    const cached = view({
      response: response(),
      error: null,
      isPending: false,
      isFetching: false,
      isStale: true,
      fetchStatus: 'paused',
      onRetry: cachedRetry,
    });
    expect(byTestId(cached, 'lyrics-list')).not.toBeNull();
    expect(byTestId(cached, 'lyrics-cached-offline')?.props.accessibilityRole).toBe('alert');
    (byTestId(cached, 'lyrics-retry')?.props.onPress as () => void)();
    expect(cachedRetry).toHaveBeenCalledOnce();
  });

  it('announces saved stale lyrics without claiming a refresh is active', () => {
    const stale = view({
      response: response(),
      isPending: false,
      isFetching: false,
      isStale: true,
      fetchStatus: 'idle',
    });
    expect(byTestId(stale, 'lyrics-list')).not.toBeNull();
    expect(byTestId(stale, 'lyrics-stale')?.props.accessibilityLiveRegion).toBe('polite');
    expect(byTestId(stale, 'lyrics-refreshing')).toBeNull();
  });
});
