import { describe, expect, it, vi } from 'vitest';
import { activateLocale, catalogs, getActiveLocale, strings } from '../../localization';
import { metrics } from '../../theme';
import { byTestId, elements, flatStyle, textContent } from '../../test/render';
import {
  DEFAULT_NOW_PLAYING_TAB,
  NowPlayingTabs,
} from './NowPlayingTabs';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));


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
    expect(playing.props.accessibilityState).toEqual({ selected: false, disabled: false });
    expect(playing.props.accessibilityLabel).toBe(strings.player.nowPlayingTabs.playing);
    expect(lyrics.props.accessibilityRole).toBe('tab');
    expect(lyrics.props.accessibilityState).toEqual({ selected: true, disabled: false });
    expect(lyrics.props.accessibilityLabel).toBe(strings.player.nowPlayingTabs.lyrics);
    expect(similar.props.accessibilityRole).toBe('tab');
    expect(similar.props.accessibilityState).toEqual({ selected: false, disabled: false });
    expect(similar.props.accessibilityLabel).toBe(strings.player.nowPlayingTabs.similar);
    expect(queue.props.accessibilityRole).toBe('tab');
    expect(queue.props.accessibilityState).toEqual({ selected: false, disabled: false });
    expect(queue.props.accessibilityLabel).toBe(strings.queue.title);

    const orderedTabs = elements(rendered)
      .filter((element) => element.type === 'Pressable' && element.props.accessibilityRole === 'tab')
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
    expect(flatStyle(playing.props.style)).toEqual(
      expect.objectContaining({
        flexGrow: 1,
        flexShrink: 0,
        minHeight: metrics.minimumTouchTarget,
        minWidth: 76,
      }),
    );
  });

  it('selects Queue through the typed tab callback', () => {
    const onSelect = vi.fn();
    const rendered = NowPlayingTabs({ selected: 'queue', onSelect });
    const queue = byTestId(rendered, 'now-playing-tab-queue');

    expect(queue.props.accessibilityState).toEqual({ selected: true, disabled: false });
    expect(byTestId(rendered, 'now-playing-tab-lyrics').props.accessibilityState)
      .toEqual({ selected: false, disabled: false });

    (queue.props.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledWith('queue');
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('follows a locale switch instead of freezing the labels at module load', () => {
    const initial = getActiveLocale();
    try {
      for (const locale of ['en', 'de'] as const) {
        activateLocale(locale);
        const rendered = NowPlayingTabs({ selected: 'lyrics', onSelect: vi.fn() });
        expect(byTestId(rendered, 'now-playing-tab-playing').props.accessibilityLabel)
          .toBe(catalogs[locale].player.nowPlayingTabs.playing);
        expect(byTestId(rendered, 'now-playing-tab-queue').props.accessibilityLabel)
          .toBe(catalogs[locale].queue.title);
        expect(textContent(byTestId(rendered, 'now-playing-tab-lyrics')))
          .toEqual([catalogs[locale].player.nowPlayingTabs.lyrics]);
      }
      expect(catalogs.en.queue.title).not.toBe(catalogs.de.queue.title);
    } finally {
      activateLocale(initial);
    }
  });
});
