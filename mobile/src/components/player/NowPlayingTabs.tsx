import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { strings } from '../../localization';
import { spacing } from '../../theme';
import { FilterChip } from '../ui';

export type NowPlayingTab = 'playing' | 'lyrics' | 'similar' | 'queue';

export const DEFAULT_NOW_PLAYING_TAB: NowPlayingTab = 'lyrics';

const TAB_ORDER: readonly NowPlayingTab[] = ['playing', 'lyrics', 'similar', 'queue'];

/**
 * Resolved on every render: `strings` follows the active locale, so labels
 * captured at module load would stay in the language the app started with.
 */
function tabLabel(tab: NowPlayingTab): string {
  switch (tab) {
    case 'playing':
      return strings.player.nowPlayingTabs.playing;
    case 'lyrics':
      return strings.player.nowPlayingTabs.lyrics;
    case 'similar':
      return strings.player.nowPlayingTabs.similar;
    case 'queue':
      return strings.queue.title;
  }
}

export interface NowPlayingTabsProps {
  selected: NowPlayingTab;
  onSelect: (tab: NowPlayingTab) => void;
}

/** Stateless chip row that switches the fullscreen player surfaces. */
export function NowPlayingTabs({ selected, onSelect }: NowPlayingTabsProps) {
  return (
    <ScrollView
      testID="now-playing-tabs"
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={strings.player.nowPlayingTabs.label}
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      {TAB_ORDER.map((tab) => (
        <FilterChip
          key={tab}
          testID={`now-playing-tab-${tab}`}
          accessibilityRole="tab"
          label={tabLabel(tab)}
          selected={tab === selected}
          onPress={() => onSelect(tab)}
          style={styles.tab}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { alignSelf: 'stretch', flexGrow: 0 },
  container: { flexGrow: 1, flexDirection: 'row', gap: spacing.xs },
  // Chips share the row evenly on wide screens and scroll on narrow ones.
  tab: { flexGrow: 1, flexShrink: 0, minWidth: 76 },
});
