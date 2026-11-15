import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { colors } from '../../theme';
import { EmptyState, ErrorState, RetryButton } from './states';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('RetryButton', () => {
  it('is a secondary refresh button with the shared retry wording', () => {
    const onRetry = vi.fn();
    const rendered = RetryButton({ onRetry, testID: 'albums-retry' });
    const button = byTestId(rendered, 'albums-retry');
    expect(button.type).toBe('Pressable');
    expect(button.props.accessibilityLabel).toBe(strings.common.retry);
    expect(button.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(byType(rendered, 'AppIcon')[0].props.name).toBe('refresh');
    expect(textContent(rendered)).toEqual([strings.common.retry]);
    (button.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('switches wording, shows a spinner and blocks presses while busy', () => {
    const rendered = RetryButton({
      onRetry: vi.fn(),
      busy: true,
      accessibilityLabel: 'Alben erneut laden',
      testID: 'albums-retry',
    });
    const button = byTestId(rendered, 'albums-retry');
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityLabel).toBe('Alben erneut laden');
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(textContent(rendered)).toEqual([strings.common.retrying]);
    expect(byType(rendered, 'ActivityIndicator')).toHaveLength(1);
  });
});

describe('ErrorState', () => {
  it('announces the message assertively and wires the retry button', () => {
    const onRetry = vi.fn();
    const rendered = ErrorState({
      title: 'Nicht geladen',
      message: 'Das Album konnte nicht geladen werden.',
      onRetry,
      testID: 'album-error',
      retryTestID: 'album-retry',
    });
    const root = byTestId(rendered, 'album-error');
    expect(root.props.accessibilityRole).toBe('alert');
    expect(root.props.accessibilityLiveRegion).toBe('assertive');
    expect(textContent(rendered)).toEqual([
      'Nicht geladen',
      'Das Album konnte nicht geladen werden.',
      strings.common.retry,
    ]);
    expect(byType(rendered, 'AppIcon')[0].props).toMatchObject({
      name: 'alert-circle-outline',
      color: colors.danger,
    });
    (byTestId(rendered, 'album-retry').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('fills the page, marks offline, and omits retry when none is possible', () => {
    const rendered = ErrorState({
      message: 'Keine Verbindung.',
      kind: 'offline',
      layout: 'page',
      testID: 'album-offline',
    });
    expect(flatStyle(byTestId(rendered, 'album-offline').props.style)).toMatchObject({
      flex: 1,
      backgroundColor: colors.background,
    });
    expect(byType(rendered, 'AppIcon')[0].props.name).toBe('wifi-off');
    expect(byType(rendered, 'Pressable')).toHaveLength(0);
  });

  it('forwards the busy retry state', () => {
    const rendered = ErrorState({
      message: 'Fehler',
      onRetry: vi.fn(),
      retryBusy: true,
      retryAccessibilityLabel: 'Charts erneut laden',
      retryTestID: 'retry',
    });
    const retry = byTestId(rendered, 'retry');
    expect(retry.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(retry.props.accessibilityLabel).toBe('Charts erneut laden');
  });
});

describe('EmptyState', () => {
  it('politely presents an empty result with optional copy and action', () => {
    const action = React.createElement('Action', { testID: 'empty-action' });
    const rendered = EmptyState({
      title: 'Noch keine Playlists',
      message: 'Erstelle deine erste Playlist.',
      icon: 'playlist-plus',
      action,
      testID: 'playlists-empty',
    });
    const root = byTestId(rendered, 'playlists-empty');
    expect(root.props.accessibilityLiveRegion).toBe('polite');
    expect(root.props.accessibilityRole).toBeUndefined();
    expect(textContent(rendered)).toEqual(['Noch keine Playlists', 'Erstelle deine erste Playlist.']);
    expect(byType(rendered, 'AppIcon')[0].props.name).toBe('playlist-plus');
    expect(queryByTestId(rendered, 'empty-action')).not.toBeNull();
  });

  it('renders a title alone and can fill the page', () => {
    const rendered = EmptyState({ title: 'Nichts gefunden', layout: 'page', testID: 'empty' });
    expect(textContent(rendered)).toEqual(['Nichts gefunden']);
    expect(flatStyle(byTestId(rendered, 'empty').props.style).flex).toBe(1);
  });
});
