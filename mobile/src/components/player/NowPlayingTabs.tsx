import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { strings } from '../../localization';
import { colors, metrics } from '../../theme';

export type NowPlayingTab = 'playing' | 'lyrics' | 'similar' | 'queue';

export const DEFAULT_NOW_PLAYING_TAB: NowPlayingTab = 'lyrics';

const TABS: readonly { key: NowPlayingTab; label: string }[] = [
  { key: 'playing', label: strings.player.nowPlayingTabs.playing },
  { key: 'lyrics', label: strings.player.nowPlayingTabs.lyrics },
  { key: 'similar', label: strings.player.nowPlayingTabs.similar },
  { key: 'queue', label: strings.queue.title },
];

export interface NowPlayingTabsProps {
  selected: NowPlayingTab;
  onSelect: (tab: NowPlayingTab) => void;
}

/** Stateless, native tab affordance shared by the fullscreen player surfaces. */
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
      {TABS.map((tab) => {
        const active = tab.key === selected;
        return (
          <Pressable
            key={tab.key}
            testID={`now-playing-tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              active && styles.activeTab,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { alignSelf: 'stretch', flexGrow: 0 },
  container: {
    flexGrow: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    padding: 3,
    backgroundColor: colors.surface,
  },
  tab: {
    flexGrow: 1,
    flexShrink: 0,
    minHeight: metrics.minimumTouchTarget,
    minWidth: 112,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    paddingHorizontal: 14,
  },
  activeTab: { backgroundColor: colors.accent },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  activeLabel: { color: colors.onAccent },
  pressed: { opacity: 0.74 },
});
