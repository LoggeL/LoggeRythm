import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { RadioQueryStation, RadioSection, RadioStationCard } from './RadioCards';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
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

function section(
  state: Parameters<typeof RadioSection>[0]['state'],
  onRetry = vi.fn(),
): React.ReactElement {
  return RadioSection({
    id: 'genres',
    title: strings.radio.genresTitle,
    state,
    loadingText: strings.radio.genresLoading,
    emptyText: strings.radio.genresEmpty,
    busy: false,
    onRetry,
    children: React.createElement('GenreRail', { testID: 'genre-rail' }),
  });
}

function mood(
  state: Parameters<typeof RadioQueryStation>[0]['state'],
  onRetry = vi.fn(),
): React.ReactElement {
  return RadioQueryStation({
    testID: 'radio-mood-chill',
    title: strings.radio.moods.chill.title,
    subtitle: strings.radio.moods.chill.subtitle,
    cover: '',
    state,
    queryBusy: false,
    stationBusy: false,
    blocked: false,
    loadingText: strings.radio.moodLoading(strings.radio.moods.chill.title),
    emptyText: strings.radio.stationEmpty,
    onPress: vi.fn(),
    onRetry,
  });
}

describe('Radio query-state presentation', () => {
  it('keeps station cards limited to the playback action and trusted subtitle copy', () => {
    const onPress = vi.fn();
    const tree = RadioStationCard({
      testID: 'radio-personal-seed',
      title: 'Seed track',
      subtitle: 'Seed artist',
      cover: '',
      variant: 'personal',
      busy: false,
      blocked: false,
      onPress,
    });
    const card = byTestId(tree, 'radio-personal-seed');

    expect(card?.props.accessibilityLabel).toBe(strings.radio.startStation('Seed track'));
    expect(card?.props.disabled).toBe(false);
    expect(elements(tree).some((element) => element.props.children === 'Seed artist')).toBe(true);
    (card?.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('renders a labeled live section loading body exclusively', () => {
    const tree = section({ body: 'loading', notice: null });
    const loading = byTestId(tree, 'radio-section-genres-loading');

    expect(loading?.props.accessibilityRole).toBe('progressbar');
    expect(loading?.props.accessibilityLabel).toBe(strings.radio.genresLoading);
    expect(loading?.props.accessibilityLiveRegion).toBe('polite');
    expect(byTestId(tree, 'genre-rail')).toBeNull();
  });

  it('keeps a known-empty section visible under a retryable refresh failure', () => {
    const onRetry = vi.fn();
    const tree = section({ body: 'empty', notice: 'cached-refresh-error' }, onRetry);

    expect(byTestId(tree, 'radio-section-genres-empty')).not.toBeNull();
    expect(byTestId(tree, 'radio-section-genres-cached-error')?.props.accessibilityLiveRegion)
      .toBe('polite');
    (byTestId(tree, 'radio-section-genres-cached-error-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps section content mounted with one cached-offline notice', () => {
    const tree = section({ body: 'content', notice: 'cached-offline' });

    expect(byTestId(tree, 'genre-rail')).not.toBeNull();
    expect(byTestId(tree, 'radio-section-genres-cached-offline')).not.toBeNull();
    expect(byTestId(tree, 'radio-section-genres-cached-error')).toBeNull();
    expect(byTestId(tree, 'radio-section-genres-stale')).toBeNull();
  });

  it('renders safe assertive mood failures and an owned retry', () => {
    const onRetry = vi.fn();
    const tree = mood({ body: 'hard-error', notice: null }, onRetry);
    const error = byTestId(tree, 'radio-mood-chill-error');

    expect(error?.props.accessibilityRole).toBe('alert');
    expect(error?.props.accessibilityLiveRegion).toBe('assertive');
    (byTestId(tree, 'radio-mood-chill-error-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(byTestId(tree, 'radio-mood-chill')).toBeNull();
  });

  it('preserves a playable mood card under cached failure and refresh states', () => {
    const failed = mood({ body: 'content', notice: 'cached-refresh-error' });
    expect(byTestId(failed, 'radio-mood-chill')).not.toBeNull();
    expect(byTestId(failed, 'radio-mood-chill-cached-error')).not.toBeNull();

    const refreshing = mood({ body: 'content', notice: 'refreshing' });
    expect(byTestId(refreshing, 'radio-mood-chill')).not.toBeNull();
    expect(byTestId(refreshing, 'radio-mood-chill-refreshing')?.props.accessibilityRole)
      .toBe('progressbar');
    expect(byTestId(refreshing, 'radio-mood-chill-stale')).toBeNull();
  });
});
