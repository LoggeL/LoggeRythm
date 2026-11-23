import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { triggerHaptic } from '../../hooks/useHaptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { strings } from '../../localization';
import { colors, layout, opacity, radii, spacing, typography } from '../../theme';
import { createFocusRingController, FilterChip, FocusRingOverlay } from '../ui';

export type NowPlayingTab = 'playing' | 'lyrics' | 'similar' | 'queue';

/** Stage-first mobile default matching `web/src/components/now-playing/NowPlaying.tsx`. */
export const DEFAULT_NOW_PLAYING_TAB: NowPlayingTab = 'playing';

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

export interface TabLayoutFrame {
  readonly x: number;
  readonly width: number;
}

/**
 * Compute horizontal scroll target so the selected tab is never clipped at the
 * left or right edge (notably `"Warteschlange"` on narrow German phones).
 */
export function resolveNowPlayingTabScrollTarget(
  tabIndex: number,
  tabCount: number,
  frame: TabLayoutFrame | undefined,
  viewportWidth: number,
): { kind: 'end' } | { kind: 'offset'; x: number } | null {
  if (tabCount <= 0 || tabIndex < 0 || tabIndex >= tabCount) return null;
  if (tabIndex === 0) return { kind: 'offset', x: 0 };
  if (tabIndex === tabCount - 1) return { kind: 'end' };
  if (frame === undefined || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return null;
  return {
    kind: 'offset',
    x: Math.max(0, Math.round(frame.x - (viewportWidth - frame.width) / 2)),
  };
}

export interface NowPlayingTabsProps {
  selected: NowPlayingTab;
  onSelect: (tab: NowPlayingTab) => void;
  /** Optional subset/order override (e.g. side-panel tabs in 16:9 Android TV split mode). */
  tabs?: readonly NowPlayingTab[];
  /** Bleed to screen edges so horizontal scrolling never clips against page padding. */
  fullBleed?: boolean;
  /** Tighter pill geometry so all 3 side-panel tabs (incl. "Warteschlange") fit unclipped in TV split mode. */
  compact?: boolean;
  scrollRef?: React.Ref<ScrollView>;
  onViewportLayout?: (event: LayoutChangeEvent) => void;
  onTabLayout?: (tab: NowPlayingTab, event: LayoutChangeEvent) => void;
}

/** Stateless chip row that switches the fullscreen player surfaces. */
export function NowPlayingTabs({
  selected,
  onSelect,
  tabs = TAB_ORDER,
  fullBleed = false,
  compact = false,
  scrollRef,
  onViewportLayout,
  onTabLayout,
}: NowPlayingTabsProps) {
  return (
    <ScrollView
      ref={scrollRef}
      testID="now-playing-tabs"
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={strings.player.nowPlayingTabs.label}
      onLayout={onViewportLayout}
      style={fullBleed ? [styles.scroll, styles.fullBleedScroll] : styles.scroll}
      contentContainerStyle={
        !compact && !fullBleed
          ? styles.container
          : [
              styles.container,
              compact ? styles.compactContainer : null,
              fullBleed ? styles.fullBleedContainer : null,
            ]
      }
    >
      {tabs.map((tab) => {
        const label = tabLabel(tab);
        const isSelected = tab === selected;
        const chip = compact ? (() => {
          const focusController = createFocusRingController();
          const foreground = isSelected ? colors.onLight : colors.textPrimary;
          return (
            <Pressable
              key={tab}
              testID={`now-playing-tab-${tab}`}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: isSelected, disabled: false }}
              focusable
              onFocus={() => focusController.setFocused(true)}
              onBlur={() => focusController.setFocused(false)}
              onPress={() => {
                triggerHaptic('tap');
                onSelect(tab);
              }}
              style={({ pressed }) => [
                styles.compactTab,
                isSelected ? styles.compactTabSelected : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text numberOfLines={1} style={[styles.compactLabel, { color: foreground }]}>
                {label}
              </Text>
              <FocusRingOverlay controller={focusController} borderRadius={radii.pill} />
            </Pressable>
          );
        })() : (
          <FilterChip
            key={tab}
            testID={`now-playing-tab-${tab}`}
            accessibilityRole="tab"
            label={label}
            selected={isSelected}
            focusable
            onPress={() => onSelect(tab)}
            style={styles.tab}
          />
        );
        if (onTabLayout === undefined) return chip;
        return (
          <View
            key={tab}
            style={compact ? styles.compactTabSlot : styles.tabSlot}
            onLayout={(event) => onTabLayout(tab, event)}
          >
            {chip}
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * Memoized auto-scrolling wrapper for screen composition: keeps the selected
 * tab (including long German labels like `"Warteschlange"`) scrolled cleanly
 * into view while `NowPlayingTabs` stays hook-free and direct-callable in tests.
 */
export const MemoNowPlayingTabs = React.memo(function MemoNowPlayingTabs({
  selected,
  onSelect,
  tabs = TAB_ORDER,
  fullBleed = false,
  compact = false,
}: Pick<NowPlayingTabsProps, 'selected' | 'onSelect' | 'tabs' | 'fullBleed' | 'compact'>) {
  const scrollRef = useRef<ScrollView>(null);
  const viewportWidthRef = useRef(0);
  const tabFramesRef = useRef<Partial<Record<NowPlayingTab, TabLayoutFrame>>>({});
  const reducedMotion = useReducedMotion();

  const scrollSelectedIntoView = useCallback(
    (targetTab: NowPlayingTab, animated: boolean) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const tabIndex = tabs.indexOf(targetTab);
      const target = resolveNowPlayingTabScrollTarget(
        tabIndex,
        tabs.length,
        tabFramesRef.current[targetTab],
        viewportWidthRef.current,
      );
      if (target === null) return;
      if (target.kind === 'end') {
        scroller.scrollToEnd?.({ animated });
      } else {
        scroller.scrollTo?.({ x: target.x, animated });
      }
    },
    [tabs],
  );

  useEffect(() => {
    scrollSelectedIntoView(selected, !reducedMotion);
  }, [reducedMotion, scrollSelectedIntoView, selected]);

  const handleViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportWidthRef.current = event.nativeEvent.layout.width;
      scrollSelectedIntoView(selected, false);
    },
    [scrollSelectedIntoView, selected],
  );

  const handleTabLayout = useCallback(
    (tab: NowPlayingTab, event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      tabFramesRef.current[tab] = { x, width };
      if (tab === selected) {
        scrollSelectedIntoView(selected, false);
      }
    },
    [scrollSelectedIntoView, selected],
  );

  return (
    <NowPlayingTabs
      selected={selected}
      onSelect={onSelect}
      tabs={tabs}
      fullBleed={fullBleed}
      compact={compact}
      scrollRef={scrollRef}
      onViewportLayout={handleViewportLayout}
      onTabLayout={handleTabLayout}
    />
  );
});

const styles = StyleSheet.create({
  scroll: { alignSelf: 'stretch', flexGrow: 0 },
  fullBleedScroll: { marginHorizontal: -layout.pagePadding },
  container: { flexGrow: 1, flexDirection: 'row', gap: spacing.xs },
  compactContainer: { gap: spacing.xxs + 2 },
  fullBleedContainer: { paddingHorizontal: layout.pagePadding },
  tabSlot: { flexGrow: 1, flexShrink: 0 },
  compactTabSlot: { flexGrow: 0, flexShrink: 0 },
  // Chips share the row evenly on wide screens and scroll on narrow ones.
  tab: { flexGrow: 1, flexShrink: 0, minWidth: 76 },
  compactTab: {
    height: 36,
    paddingHorizontal: spacing.xs + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTabSelected: { backgroundColor: colors.textPrimary },
  compactLabel: { ...typography.callout, fontWeight: '600' },
  pressed: { opacity: opacity.pressed },
});
