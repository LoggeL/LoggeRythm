import React, { useEffect } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: keyof typeof radii;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const PULSE_LOW = 0.45;
const PULSE_STATIC = 0.72;
const PULSE_MS = 750;
const PLAYLIST_CARD_WIDTH = layout.artwork.lg + layout.artwork.card + spacing.xxl;
const PLAY_BUTTON_LG = 64;

let sharedPulseValue: Animated.Value | null = null;
let sharedPulseLoop: Animated.CompositeAnimation | null = null;
let activePulseCount = 0;

function getSharedPulseValue(): Animated.Value {
  sharedPulseValue ??= new Animated.Value(PULSE_LOW);
  return sharedPulseValue;
}

function retainSharedPulse(): () => void {
  const pulse = getSharedPulseValue();
  activePulseCount += 1;
  if (activePulseCount === 1) {
    pulse.setValue?.(PULSE_LOW);
    sharedPulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: PULSE_LOW, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    sharedPulseLoop.start();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activePulseCount = Math.max(0, activePulseCount - 1);
    if (activePulseCount === 0 && sharedPulseLoop !== null) {
      sharedPulseLoop.stop();
      sharedPulseLoop = null;
    }
  };
}

/** Test-only reset for the shared skeleton pulse clock. */
export function resetSkeletonClockForTests(): void {
  sharedPulseLoop?.stop();
  sharedPulseLoop = null;
  sharedPulseValue = null;
  activePulseCount = 0;
}

/**
 * Skeleton is one placeholder block shown while content loads. All mounted
 * skeletons share a single native-driver pulse clock (eliminating per-block
 * animation loops) and settle at a calm static opacity under reduced motion.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = 'sm',
  testID,
  style,
}: SkeletonProps) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    return retainSharedPulse();
  }, [reducedMotion]);

  const opacity = reducedMotion ? PULSE_STATIC : getSharedPulseValue();
  return (
    <Animated.View
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      style={[styles.block, { width, height, borderRadius: radii[radius], opacity }, style]}
    />
  );
}

export interface SkeletonGroupProps {
  /** Localized loading label announced for the whole group. */
  accessibilityLabel: string;
  /** Number of placeholder items. */
  count?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * TrackRowSkeleton stands in for a vertical list of track rows (artwork,
 * title line, artist line). The group is one polite `progressbar` carrying
 * the localized loading label.
 */
export function TrackRowSkeleton({
  accessibilityLabel,
  count = 6,
  testID,
  style,
}: SkeletonGroupProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.rows, style]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={layout.artwork.sm} height={layout.artwork.sm} />
          <View style={styles.rowCopy}>
            <Skeleton width={index % 2 === 0 ? '68%' : '52%'} height={14} />
            <Skeleton width={index % 2 === 0 ? '40%' : '46%'} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export type CardRailSkeletonVariant = 'card' | 'track' | 'genre' | 'playlist';

export interface CardRailSkeletonProps extends SkeletonGroupProps {
  /** Card artwork edge. Defaults to layout.artwork.card. */
  size?: number;
  /** Optional explicit card height (e.g. landscape genre tiles). */
  cardHeight?: number;
  /** Round artwork for artist rails. */
  round?: boolean;
  /** Visual shape matching the real shelf card to avoid vertical layout jumps. */
  variant?: CardRailSkeletonVariant;
}

/**
 * CardRailSkeleton stands in for a horizontal shelf of cards. Use `variant` to
 * match the real rail card height (`card`, `track`, `genre`, `playlist`) so
 * sections do not jump when data arrives.
 */
export function CardRailSkeleton({
  accessibilityLabel,
  count = 4,
  size = layout.artwork.card,
  cardHeight,
  round = false,
  variant = 'card',
  testID,
  style,
}: CardRailSkeletonProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.rail, style]}
    >
      {Array.from({ length: count }, (_, index) => {
        if (variant === 'genre') {
          return (
            <View key={index} style={{ width: size }}>
              <Skeleton width={size} height={cardHeight ?? layout.artwork.lg} radius="card" />
            </View>
          );
        }
        if (variant === 'playlist') {
          return (
            <View key={index} style={styles.playlistCard}>
              <Skeleton width={layout.artwork.lg} height={layout.artwork.lg} radius="card" />
              <View style={styles.playlistCopy}>
                <Skeleton width="82%" height={typography.bodyStrong.fontSize} />
                <Skeleton width="58%" height={typography.callout.fontSize} />
                <Skeleton width="42%" height={typography.caption.fontSize} />
              </View>
            </View>
          );
        }
        return (
          <View key={index} style={[styles.card, { width: size }]}>
            <Skeleton
              width={size}
              height={cardHeight ?? size}
              radius={round ? 'pill' : 'card'}
            />
            <Skeleton width="80%" height={14} />
            <Skeleton width="55%" height={12} />
            {variant === 'track' ? (
              <View style={styles.trackActions}>
                <Skeleton width={24} height={24} radius="pill" />
                <Skeleton width={24} height={24} radius="pill" />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export interface DetailHeroSkeletonProps {
  /** Round artwork for artist detail pages. */
  round?: boolean;
  /** Compact horizontal hero matching GenreScreen. */
  compact?: boolean;
  /** Reserve the 64dp PlayButton + secondary action row to avoid vertical jumps. */
  includeActionRow?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Reusable hero skeleton matching `CatalogDetailHero` and `PlaylistHero`
 * dimensions (including the 64dp PlayButton action row or compact Genre layout).
 */
export function DetailHeroSkeleton({
  round = false,
  compact = false,
  includeActionRow = true,
  testID,
  style,
}: DetailHeroSkeletonProps) {
  if (compact) {
    return (
      <View testID={testID} style={[styles.compactHero, style]}>
        <Skeleton
          width={layout.artwork.lg}
          height={layout.artwork.lg}
          radius={round ? 'pill' : 'panel'}
        />
        <View style={styles.compactCopy}>
          <Skeleton width="72%" height={typography.title.fontSize} />
          <Skeleton width="42%" height={typography.callout.fontSize} />
        </View>
        {includeActionRow ? (
          <Skeleton width={PLAY_BUTTON_LG} height={PLAY_BUTTON_LG} radius="pill" />
        ) : null}
      </View>
    );
  }
  return (
    <View testID={testID} style={[styles.hero, round ? styles.heroCentered : null, style]}>
      <Skeleton
        width={layout.artwork.hero}
        height={layout.artwork.hero}
        radius={round ? 'pill' : 'panel'}
        style={styles.heroArtwork}
      />
      <Skeleton width="24%" height={typography.overline.fontSize} />
      <Skeleton width="72%" height={typography.hero.fontSize} />
      <Skeleton width="44%" height={typography.callout.fontSize} />
      {includeActionRow ? (
        <View style={[styles.heroActions, round ? styles.heroActionsCentered : null]}>
          <Skeleton width={PLAY_BUTTON_LG} height={PLAY_BUTTON_LG} radius="pill" />
          <Skeleton width={116} height={metrics.minimumTouchTarget} radius="pill" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surfaceElevated },
  rows: { paddingHorizontal: layout.pagePadding },
  row: {
    height: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowCopy: { flex: 1, gap: spacing.xs },
  rail: {
    flexDirection: 'row',
    gap: layout.railGap,
    paddingHorizontal: layout.pagePadding,
    overflow: 'hidden',
  },
  card: { gap: spacing.xs },
  trackActions: {
    height: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  playlistCard: {
    width: PLAYLIST_CARD_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  playlistCopy: { flex: 1, gap: spacing.xs },
  hero: { gap: spacing.sm },
  heroCentered: { alignItems: 'center' },
  heroArtwork: { alignSelf: 'center', marginBottom: spacing.xs },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: PLAY_BUTTON_LG,
    marginTop: spacing.xs,
  },
  heroActionsCentered: { justifyContent: 'center' },
  compactHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  compactCopy: { flex: 1, gap: spacing.xs },
});
