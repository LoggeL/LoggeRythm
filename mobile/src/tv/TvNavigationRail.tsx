import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AppIcon, { type AppIconName } from '../components/AppIcon';
import BrandLockup from '../components/BrandLockup';
import { AppText } from '../components/ui/AppText';
import { strings } from '../localization';
import { colors, metrics, radii, spacing } from '../theme';
import { useTvEnvironment } from './tvEnvironment';
import { TvFocusScope } from './TvFocusRegistry';
import { TvFocusable } from './TvFocusable';

export type TvNavPrimaryKey = 'HomeTab' | 'SearchTab' | 'LibraryTab' | 'DiscoverTab' | 'RadioTab';
export type TvNavDestinationKey = TvNavPrimaryKey | 'NowPlaying' | 'Queue' | 'Profile';

export const TV_NAV_RAIL_SCOPE = 'tv-nav-rail';

export const TV_NAV_FOCUS_KEYS: Readonly<Record<TvNavDestinationKey, string>> = Object.freeze({
  HomeTab: 'tv-nav-home',
  SearchTab: 'tv-nav-search',
  LibraryTab: 'tv-nav-library',
  DiscoverTab: 'tv-nav-discover',
  RadioTab: 'tv-nav-radio',
  NowPlaying: 'tv-nav-now-playing',
  Queue: 'tv-nav-queue',
  Profile: 'tv-nav-profile',
});

export interface TvPrimaryDestinationMeta {
  readonly key: TvNavPrimaryKey;
  readonly icon: AppIconName;
  readonly testID: string;
  readonly focusKey: string;
  readonly getLabel: () => string;
}

/**
 * Primary TV navigation destinations, ordered for 10-foot living-room reach
 * (matching `web/`'s left sidebar and `mobile/src/navigation.tsx`'s tab routes).
 */
export const TV_PRIMARY_DESTINATIONS: readonly TvPrimaryDestinationMeta[] = Object.freeze([
  {
    key: 'HomeTab',
    icon: 'home',
    testID: 'tv-nav-home',
    focusKey: TV_NAV_FOCUS_KEYS.HomeTab,
    getLabel: () => strings.navigation.home,
  },
  {
    key: 'SearchTab',
    icon: 'magnify',
    testID: 'tv-nav-search',
    focusKey: TV_NAV_FOCUS_KEYS.SearchTab,
    getLabel: () => strings.navigation.search,
  },
  {
    key: 'LibraryTab',
    icon: 'bookshelf',
    testID: 'tv-nav-library',
    focusKey: TV_NAV_FOCUS_KEYS.LibraryTab,
    getLabel: () => strings.navigation.library,
  },
  {
    key: 'DiscoverTab',
    icon: 'compass-outline',
    testID: 'tv-nav-discover',
    focusKey: TV_NAV_FOCUS_KEYS.DiscoverTab,
    getLabel: () => strings.navigation.discover,
  },
  {
    key: 'RadioTab',
    icon: 'radio',
    testID: 'tv-nav-radio',
    focusKey: TV_NAV_FOCUS_KEYS.RadioTab,
    getLabel: () => strings.navigation.radio,
  },
]);

export interface TvNavNowPlayingSummary {
  readonly title: string;
  readonly artist: string;
  readonly isPlaying: boolean;
  readonly queueCount?: number;
}

export interface TvNavigationRailProps {
  /** Currently active tab or modal route. */
  activeRoute: TvNavDestinationKey;
  /** Switch to one of the primary tab stacks. */
  onSelectTab: (tab: TvNavPrimaryKey) => void;
  /** Quick shortcut to fullscreen NowPlaying (shown when provided). */
  onOpenNowPlaying?: () => void;
  /** Quick shortcut to Queue (shown when provided). */
  onOpenQueue?: () => void;
  /** Open Profile / account settings. */
  onOpenProfile: () => void;
  /** Optional current playback metadata displayed in the NowPlaying / Queue quick section. */
  nowPlaying?: TvNavNowPlayingSummary | null;
  /** Show an accent attention indicator on Profile (e.g. pending Android update). */
  profileAttention?: boolean;
  /** Include the Radio tab in the primary rail. Defaults to `true`. */
  showRadio?: boolean;
  /** Focus key in the main content area to jump to when pressing D-Pad Right. */
  contentEntryFocusKey?: string;
  /** Request initial TV focus on the active rail item. */
  preferredFocus?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const RAIL_FOCUS_SCALE = 1.02;
const ACTIVE_MARKER_WIDTH = 3;
const ACTIVE_MARKER_HEIGHT = 20;
const NAV_ICON_SIZE = 20;
/** Compact 10-foot row height so all 8 rail items (including Profile) fit inside 540dp TV height with 5% overscan. */
const RAIL_ROW_MIN_HEIGHT = 40;
const RAIL_NOW_PLAYING_MIN_HEIGHT = 48;

interface RailRowProps {
  label: string;
  subtitle?: string;
  badgeText?: string;
  icon: AppIconName;
  active: boolean;
  attentionDot?: boolean;
  testID: string;
  focusKey: string;
  accessibilityLabel: string;
  accessibilityRole: 'tab' | 'button';
  preferredFocus?: boolean;
  nextFocusRightKey?: string;
  minHeight: number;
  textStyle: { fontSize: number; lineHeight: number; fontWeight: '600' | '700' | '400' };
  subtitleStyle: { fontSize: number; lineHeight: number; fontWeight: '400' | '600' };
  onPress: () => void;
}

function RailRow({
  label,
  subtitle,
  badgeText,
  icon,
  active,
  attentionDot = false,
  testID,
  focusKey,
  accessibilityLabel,
  accessibilityRole,
  preferredFocus = false,
  nextFocusRightKey,
  minHeight,
  textStyle,
  subtitleStyle,
  onPress,
}: RailRowProps) {
  return (
    <TvFocusable
      testID={testID}
      focusKey={focusKey}
      focusScope={TV_NAV_RAIL_SCOPE}
      preferredFocus={preferredFocus}
      nextFocusRightKey={nextFocusRightKey}
      ringRadius="md"
      focusScale={RAIL_FOCUS_SCALE}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ focused }) => [
        styles.row,
        { minHeight },
        active ? styles.rowActive : null,
        focused ? styles.rowFocused : null,
      ]}
    >
      {({ focused }) => (
        <>
          {active ? (
            <View
              testID={`${testID}-active-marker`}
              accessible={false}
              importantForAccessibility="no"
              style={styles.activeMarker}
            />
          ) : null}
          <AppIcon
            name={icon}
            size={NAV_ICON_SIZE}
            color={focused ? colors.brand : active ? colors.accentSoft : colors.textSecondary}
          />
          <View style={styles.rowTextBlock}>
            <AppText
              variant="label"
              color={focused || active ? 'primary' : 'secondary'}
              numberOfLines={1}
              style={textStyle}
            >
              {label}
            </AppText>
            {subtitle ? (
              <AppText
                variant="caption"
                color="muted"
                numberOfLines={1}
                style={subtitleStyle}
              >
                {subtitle}
              </AppText>
            ) : null}
          </View>
          {badgeText ? (
            <View style={styles.badge}>
              <AppText variant="micro" color="primary" numberOfLines={1}>
                {badgeText}
              </AppText>
            </View>
          ) : null}
          {attentionDot ? (
            <View
              testID={`${testID}-attention-dot`}
              accessible={false}
              importantForAccessibility="no"
              style={styles.attentionDot}
            />
          ) : null}
        </>
      )}
    </TvFocusable>
  );
}

/**
 * Persistent 10-foot left navigation rail for Android TV mode, inspired by `web/`'s
 * desktop sidebar. Keeps phone bottom-tab navigation completely untouched on phones.
 */
export function TvNavigationRail({
  activeRoute,
  onSelectTab,
  onOpenNowPlaying,
  onOpenQueue,
  onOpenProfile,
  nowPlaying = null,
  profileAttention = false,
  showRadio = true,
  contentEntryFocusKey,
  preferredFocus = false,
  testID = 'tv-navigation-rail',
  style,
}: TvNavigationRailProps) {
  const tv = useTvEnvironment();
  const destinations = showRadio
    ? TV_PRIMARY_DESTINATIONS
    : TV_PRIMARY_DESTINATIONS.filter((item) => item.key !== 'RadioTab');

  const labelTextStyle = {
    fontSize: tv.typography.label.fontSize,
    lineHeight: tv.typography.label.lineHeight,
    fontWeight: tv.typography.label.fontWeight as '600',
  };
  const subtitleTextStyle = {
    fontSize: tv.typography.caption.fontSize,
    lineHeight: tv.typography.caption.lineHeight,
    fontWeight: tv.typography.caption.fontWeight as '400',
  };

  const hasPlaybackShortcuts = Boolean(onOpenNowPlaying || onOpenQueue);
  const nowPlayingLabel = nowPlaying ? nowPlaying.title : strings.player.nowPlayingHeading;
  const nowPlayingSubtitle = nowPlaying ? nowPlaying.artist : strings.player.nothingPlaying;
  const nowPlayingAccessibility = nowPlaying
    ? strings.player.openNowPlaying(nowPlaying.title, nowPlaying.artist)
    : strings.player.nowPlayingHeading;
  const nowPlayingIcon: AppIconName = nowPlaying
    ? nowPlaying.isPlaying
      ? 'pause-circle'
      : 'play-circle'
    : 'music-note';
  const queueCount = nowPlaying?.queueCount;
  const queueBadge = typeof queueCount === 'number' && queueCount > 0 ? String(queueCount) : undefined;

  const railRowMinHeight = Math.round(RAIL_ROW_MIN_HEIGHT * tv.scale);
  const railNowPlayingMinHeight = Math.round(RAIL_NOW_PLAYING_MIN_HEIGHT * tv.scale);

  return (
    <TvFocusScope scope={TV_NAV_RAIL_SCOPE}>
      <View
        testID={testID}
        accessibilityRole="tablist"
        style={[
          styles.rail,
          {
            width: tv.isTv ? tv.navRailTotalWidth : 224,
            paddingLeft: tv.overscan.left + spacing.sm,
            paddingTop: tv.overscan.top + spacing.xs,
            paddingBottom: tv.overscan.bottom + spacing.xs,
          },
          style,
        ]}
      >
        <View style={styles.brandHeader}>
          <BrandLockup
            compact
            horizontal
            accessible={false}
            focusable={false}
            importantForAccessibility="no-hide-descendants"
          />
        </View>

        <View style={styles.primaryGroup}>
          {destinations.map((destination) => {
            const label = destination.getLabel();
            const isActive = activeRoute === destination.key;
            return (
              <RailRow
                key={destination.key}
                label={label}
                icon={destination.icon}
                active={isActive}
                testID={destination.testID}
                focusKey={destination.focusKey}
                accessibilityLabel={label}
                accessibilityRole="tab"
                preferredFocus={preferredFocus && isActive}
                nextFocusRightKey={contentEntryFocusKey}
                minHeight={railRowMinHeight}
                textStyle={labelTextStyle}
                subtitleStyle={subtitleTextStyle}
                onPress={() => onSelectTab(destination.key)}
              />
            );
          })}
        </View>

        {hasPlaybackShortcuts ? (
          <View style={styles.sectionDividerGroup}>
            <View style={styles.divider} />
            {onOpenNowPlaying ? (
              <RailRow
                label={nowPlayingLabel}
                subtitle={nowPlayingSubtitle}
                icon={nowPlayingIcon}
                active={activeRoute === 'NowPlaying'}
                testID="tv-nav-now-playing"
                focusKey={TV_NAV_FOCUS_KEYS.NowPlaying}
                accessibilityLabel={nowPlayingAccessibility}
                accessibilityRole="button"
                preferredFocus={preferredFocus && activeRoute === 'NowPlaying'}
                nextFocusRightKey={contentEntryFocusKey}
                minHeight={railNowPlayingMinHeight}
                textStyle={labelTextStyle}
                subtitleStyle={subtitleTextStyle}
                onPress={onOpenNowPlaying}
              />
            ) : null}
            {onOpenQueue ? (
              <RailRow
                label={strings.queue.title}
                badgeText={queueBadge}
                icon="playlist-play"
                active={activeRoute === 'Queue'}
                testID="tv-nav-queue"
                focusKey={TV_NAV_FOCUS_KEYS.Queue}
                accessibilityLabel={strings.player.openQueue}
                accessibilityRole="button"
                preferredFocus={preferredFocus && activeRoute === 'Queue'}
                nextFocusRightKey={contentEntryFocusKey}
                minHeight={railRowMinHeight}
                textStyle={labelTextStyle}
                subtitleStyle={subtitleTextStyle}
                onPress={onOpenQueue}
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.footerGroup}>
          <View style={styles.divider} />
          <RailRow
            label={strings.navigation.profile}
            icon="account-circle-outline"
            active={activeRoute === 'Profile'}
            attentionDot={profileAttention}
            testID="tv-nav-profile"
            focusKey={TV_NAV_FOCUS_KEYS.Profile}
            accessibilityLabel={
              profileAttention
                ? strings.navigation.openProfileUpdateAvailable
                : strings.navigation.openProfile
            }
            accessibilityRole="button"
            preferredFocus={preferredFocus && activeRoute === 'Profile'}
            nextFocusRightKey={contentEntryFocusKey}
            minHeight={railRowMinHeight}
            textStyle={labelTextStyle}
            subtitleStyle={subtitleTextStyle}
            onPress={onOpenProfile}
          />
        </View>
      </View>
    </TvFocusScope>
  );
}

export interface TvShellLayoutProps extends TvNavigationRailProps {
  children: React.ReactNode;
  contentTestID?: string;
}

/**
 * Adaptive root layout container: renders `[TvNavigationRail | 16:9 Content]` on
 * Android TV (with 5% overscan safety margins) and renders `children` untouched on phones.
 */
export function TvShellLayout({
  children,
  contentTestID = 'tv-shell-content',
  ...railProps
}: TvShellLayoutProps) {
  const tv = useTvEnvironment();
  if (!tv.isTv) {
    return <>{children}</>;
  }
  return (
    <View testID="tv-shell-layout" style={styles.shell}>
      <TvNavigationRail {...railProps} />
      <View
        testID={contentTestID}
        style={[
          styles.shellContent,
          {
            paddingTop: tv.overscan.top,
            paddingRight: tv.overscan.right,
            paddingBottom: tv.overscan.bottom,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  shellContent: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.background,
  },
  rail: {
    backgroundColor: colors.backdrop,
    borderRightWidth: 1,
    borderRightColor: colors.hairline,
    paddingRight: spacing.sm,
    gap: spacing.xs,
  },
  brandHeader: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xxs,
  },
  primaryGroup: {
    gap: spacing.xxs / 2,
  },
  sectionDividerGroup: {
    gap: spacing.xxs,
  },
  footerGroup: {
    marginTop: 'auto',
    gap: spacing.xxs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginVertical: spacing.xxs / 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.md,
    position: 'relative',
  },
  rowActive: {
    backgroundColor: colors.fillStrong,
  },
  rowFocused: {
    backgroundColor: colors.surfaceElevated,
  },
  activeMarker: {
    position: 'absolute',
    left: 0,
    width: ACTIVE_MARKER_WIDTH,
    height: ACTIVE_MARKER_HEIGHT,
    borderTopRightRadius: radii.pill,
    borderBottomRightRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  rowTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs / 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSubtle,
  },
  attentionDot: {
    width: metrics.badgeDot - metrics.badgeDotRing,
    height: metrics.badgeDot - metrics.badgeDotRing,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
