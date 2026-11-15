import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateLocale, strings } from '../../localization';
import { accountStrings } from '../../screens/accountStrings';
import { elements, queryByTestId as byTestId } from '../../test/render';
import { RadioQueryStation, RadioSection, RadioStationCard } from './RadioCards';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
// Skeleton and PressableScale own Animated state; a string mock keeps their props.
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
  Skeleton: 'Skeleton',
}));

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

afterEach(() => {
  activateLocale('de');
});

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
    expect(elements(tree).some((element) => element.props.children === strings.radio.badge))
      .toBe(true);
    expect(elements(tree).some((element) => element.props.children === 'Seed artist')).toBe(true);
    (card?.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it.each(['de', 'en'] as const)('resolves the visible radio badge from the %s catalog', (locale) => {
    activateLocale(locale);
    const tree = RadioStationCard({
      testID: `radio-${locale}`,
      title: 'Seed track',
      subtitle: 'Seed artist',
      cover: '',
      variant: 'personal',
      busy: false,
      blocked: false,
      onPress: vi.fn(),
    });

    expect(elements(tree).some((element) => element.props.children === strings.radio.badge))
      .toBe(true);
  });

  it('renders a labeled live section loading body exclusively', () => {
    const tree = section({ body: 'loading', notice: null });
    const loading = byTestId(tree, 'radio-section-genres-loading');

    expect(loading?.props.accessibilityRole).toBe('progressbar');
    expect(loading?.props.accessibilityLabel).toBe(strings.radio.genresLoading);
    expect(loading?.props.accessibilityLiveRegion).toBe('polite');
    expect(byTestId(tree, 'genre-rail')).toBeNull();
    expect(elements(loading).some((element) => element.type === 'Skeleton')).toBe(true);
    expect(elements(loading).some((element) => element.type === 'ActivityIndicator')).toBe(false);
  });

  it('marks the station that feeds the current queue as on air without changing its action', () => {
    const onPress = vi.fn();
    const tree = RadioStationCard({
      testID: 'radio-genre-7',
      title: 'Rock radio',
      subtitle: 'Rock',
      cover: '',
      variant: 'genre',
      busy: false,
      blocked: false,
      onAir: true,
      onPress,
    });
    const card = byTestId(tree, 'radio-genre-7');

    expect(card?.props.accessibilityLabel).toBe(strings.radio.startStation('Rock radio'));
    expect(card?.props.accessibilityState).toEqual({ disabled: false, busy: false, selected: true });
    expect(elements(tree).some((element) => element.props.children === accountStrings.radio.onAir))
      .toBe(true);
    expect(elements(tree).some((element) => element.props.children === strings.radio.badge))
      .toBe(false);
    (card?.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('reports a starting station as busy and ignores further presses', () => {
    const onPress = vi.fn();
    const tree = RadioStationCard({
      testID: 'radio-personal-1',
      title: 'Seed track',
      subtitle: 'Seed artist',
      cover: '',
      variant: 'personal',
      busy: true,
      blocked: false,
      onPress,
    });
    const card = byTestId(tree, 'radio-personal-1');

    expect(card?.props.accessibilityState).toEqual({ disabled: true, busy: true, selected: false });
    expect(card?.props.onPress).toBeUndefined();
    expect(elements(tree).some((element) => element.type === 'ActivityIndicator')).toBe(true);
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
