import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { libraryStrings } from '../../screens/libraryStrings';
import { LibrarySection } from './LibrarySection';
import {
  LIBRARY_POLICY_SECTION_STATE,
  type LibraryQuerySectionState,
} from './librarySectionState';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
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

function queryState(
  overrides: Partial<LibraryQuerySectionState> = {},
): LibraryQuerySectionState {
  return {
    kind: 'query',
    hasData: true,
    empty: false,
    pending: false,
    fetching: false,
    paused: false,
    stale: false,
    error: null,
    ...overrides,
  };
}

function querySection(
  state: LibraryQuerySectionState,
  onRetry = vi.fn(),
): React.ReactElement {
  return LibrarySection({
    id: 'following',
    title: libraryStrings.library.following,
    state,
    emptyText: libraryStrings.library.noFollowing,
    onRetry,
    children: React.createElement('ArtistRows', { testID: 'artist-rows' }),
  });
}

describe('LibrarySection', () => {
  it('renders loading, known-empty, and hard-error bodies exclusively', () => {
    const loading = querySection(queryState({ hasData: false, pending: true, fetching: true }));
    expect(byTestId(loading, 'library-section-following-loading')?.props.accessibilityLiveRegion)
      .toBe('polite');
    expect(byTestId(loading, 'library-section-following-empty')).toBeNull();
    expect(byTestId(loading, 'artist-rows')).toBeNull();

    const empty = querySection(queryState({ empty: true }));
    expect(byTestId(empty, 'library-section-following-empty')?.props.accessibilityLiveRegion)
      .toBe('polite');
    expect(byTestId(empty, 'artist-rows')).toBeNull();

    const retry = vi.fn();
    const failed = querySection(
      queryState({ hasData: false, error: new Error('following unavailable') }),
      retry,
    );
    expect(byTestId(failed, 'library-section-following-error')?.props.accessibilityRole)
      .toBe('alert');
    expect(byTestId(failed, 'library-section-following-error')?.props.accessibilityLiveRegion)
      .toBe('assertive');
    expect(elements(byTestId(failed, 'library-section-following-error')).some(
      (element) => element.props.children === 'following unavailable',
    )).toBe(false);
    const retryControl = byTestId(failed, 'library-section-following-retry');
    (retryControl?.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders retryable offline states for paused and status-zero queries', () => {
    const paused = querySection(queryState({ hasData: false, pending: true, paused: true }));
    expect(byTestId(paused, 'library-section-following-offline')?.props.accessibilityRole)
      .toBe('alert');
    expect(byTestId(paused, 'library-section-following-loading')).toBeNull();

    const statusZero = Object.assign(new Error('Network request failed'), { status: 0 });
    const cached = querySection(queryState({ error: statusZero, stale: true }));
    expect(byTestId(cached, 'artist-rows')).not.toBeNull();
    expect(byTestId(cached, 'library-section-following-cached-offline')).not.toBeNull();
    expect(byTestId(cached, 'library-section-following-cached-error')).toBeNull();
  });

  it('preserves last-good content and empty results under refresh errors', () => {
    const retry = vi.fn();
    const content = querySection(queryState({ error: new Error('refresh failed') }), retry);
    expect(byTestId(content, 'artist-rows')).not.toBeNull();
    expect(byTestId(content, 'library-section-following-cached-error')?.props.accessibilityRole)
      .toBe('alert');
    expect(byTestId(content, 'library-section-following-cached-error')?.props.accessibilityLiveRegion)
      .toBe('polite');
    (byTestId(content, 'library-section-following-retry')?.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();

    const knownEmpty = querySection(
      queryState({ empty: true, error: new Error('refresh failed') }),
    );
    expect(byTestId(knownEmpty, 'library-section-following-empty')).not.toBeNull();
    expect(byTestId(knownEmpty, 'library-section-following-cached-error')).not.toBeNull();
    expect(byTestId(knownEmpty, 'artist-rows')).toBeNull();
  });

  it('keeps the Downloads capability policy outside remote query states', () => {
    const policy = LibrarySection({
      id: 'downloads',
      title: libraryStrings.library.downloads,
      state: LIBRARY_POLICY_SECTION_STATE,
      children: React.createElement('DownloadsPolicy', { testID: 'downloads-policy' }),
    });

    expect(byTestId(policy, 'library-section-downloads')).not.toBeNull();
    expect(byTestId(policy, 'downloads-policy')).not.toBeNull();
    expect(byTestId(policy, 'library-section-downloads-loading')).toBeNull();
    expect(byTestId(policy, 'library-section-downloads-retry')).toBeNull();
  });

  it('announces refresh/stale states exclusively and disables duplicate retries', () => {
    const refreshing = querySection(queryState({ fetching: true, stale: true }));
    expect(byTestId(refreshing, 'library-section-following-refreshing')?.props.accessibilityRole)
      .toBe('progressbar');
    expect(byTestId(refreshing, 'library-section-following-stale')).toBeNull();

    const stale = querySection(queryState({ stale: true }));
    expect(byTestId(stale, 'library-section-following-stale')?.props.accessibilityLiveRegion)
      .toBe('polite');

    const failed = querySection(queryState({ fetching: true, error: new Error('failed') }));
    const retry = byTestId(failed, 'library-section-following-retry');
    expect(retry?.props.disabled).toBe(true);
    expect(retry?.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
