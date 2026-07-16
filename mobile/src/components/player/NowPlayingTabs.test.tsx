import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { metrics } from '../../theme';
import {
  DEFAULT_NOW_PLAYING_TAB,
  NowPlayingTabs,
} from './NowPlayingTabs';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`Missing ${testID}`);
  return found;
}

describe('NowPlayingTabs', () => {
  it('defaults the web-equivalent fullscreen surface to Lyrics', () => {
    expect(DEFAULT_NOW_PLAYING_TAB).toBe('lyrics');
  });

  it('exposes the exact scrollable four-tab order with 48 dp targets', () => {
    const onSelect = vi.fn();
    const rendered = NowPlayingTabs({ selected: 'lyrics', onSelect });
    const tabList = byTestId(rendered, 'now-playing-tabs');
    const playing = byTestId(rendered, 'now-playing-tab-playing');
    const lyrics = byTestId(rendered, 'now-playing-tab-lyrics');
    const similar = byTestId(rendered, 'now-playing-tab-similar');
    const queue = byTestId(rendered, 'now-playing-tab-queue');

    expect(tabList.props.accessibilityRole).toBe('tablist');
    expect(tabList.props.accessibilityLabel).toBe(strings.player.nowPlayingTabs.label);
    expect(tabList.props.horizontal).toBe(true);
    expect(tabList.props.showsHorizontalScrollIndicator).toBe(false);
    expect(playing.props.accessibilityRole).toBe('tab');
    expect(playing.props.accessibilityState).toEqual({ selected: false });
    expect(playing.props.accessibilityLabel).toBe(strings.player.nowPlayingTabs.playing);
    expect(lyrics.props.accessibilityRole).toBe('tab');
    expect(lyrics.props.accessibilityState).toEqual({ selected: true });
    expect(lyrics.props.accessibilityLabel).toBe(strings.player.nowPlayingTabs.lyrics);
    expect(similar.props.accessibilityRole).toBe('tab');
    expect(similar.props.accessibilityState).toEqual({ selected: false });
    expect(similar.props.accessibilityLabel).toBe(strings.player.nowPlayingTabs.similar);
    expect(queue.props.accessibilityRole).toBe('tab');
    expect(queue.props.accessibilityState).toEqual({ selected: false });
    expect(queue.props.accessibilityLabel).toBe(strings.queue.title);

    const orderedTabs = elements(rendered)
      .filter((element) => element.props.accessibilityRole === 'tab')
      .map((element) => element.props.testID);
    expect(orderedTabs).toEqual([
      'now-playing-tab-playing',
      'now-playing-tab-lyrics',
      'now-playing-tab-similar',
      'now-playing-tab-queue',
    ]);

    expect(tabList.props.style).toEqual(expect.objectContaining({
      alignSelf: 'stretch',
      flexGrow: 0,
    }));
    expect(tabList.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      flexDirection: 'row',
    }));
    const style = playing.props.style as (state: { pressed: boolean }) => unknown[];
    expect(style({ pressed: false })).toContainEqual(
      expect.objectContaining({
        flexGrow: 1,
        flexShrink: 0,
        minHeight: metrics.minimumTouchTarget,
        minWidth: 112,
      }),
    );
  });

  it('selects Queue through the typed tab callback', () => {
    const onSelect = vi.fn();
    const rendered = NowPlayingTabs({ selected: 'queue', onSelect });
    const queue = byTestId(rendered, 'now-playing-tab-queue');

    expect(queue.props.accessibilityState).toEqual({ selected: true });
    expect(byTestId(rendered, 'now-playing-tab-lyrics').props.accessibilityState)
      .toEqual({ selected: false });

    (queue.props.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledWith('queue');
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
