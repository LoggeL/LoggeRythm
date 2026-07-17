import React, { type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RemoteVisualState } from '../../data/remoteState';
import { strings } from '../../localization';
import type { RadioContentState } from '../../screens/radioModel';
import { colors, metrics } from '../../theme';
import AppIcon from '../AppIcon';

interface RadioSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  state: RadioContentState;
  loadingText: string;
  emptyText: string;
  busy: boolean;
  onRetry: () => void;
  children: ReactNode;
}

export function RadioSection({
  id,
  title,
  subtitle,
  state,
  loadingText,
  emptyText,
  busy,
  onRetry,
  children,
}: RadioSectionProps) {
  const retryButton = (suffix: string) => (
    <Pressable
      testID={`radio-section-${id}-${suffix}-retry`}
      accessibilityRole="button"
      accessibilityLabel={strings.radio.retryStation(title)}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onRetry}
      style={({ pressed }) => [styles.retryButton, pressed && styles.pressed, busy && styles.disabled]}
    >
      <Text style={styles.retryText}>{strings.common.retry}</Text>
    </Pressable>
  );

  return (
    <View testID={`radio-section-${id}`} style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {state.body === 'loading' ? (
        <View
          testID={`radio-section-${id}-loading`}
          accessibilityRole="progressbar"
          accessibilityLabel={loadingText}
          accessibilityLiveRegion="polite"
          style={styles.statusRow}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.status}>{loadingText}</Text>
        </View>
      ) : null}
      {state.body === 'offline' ? (
        <View
          testID={`radio-section-${id}-offline`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.error}>{strings.radio.sectionOffline}</Text>
          {retryButton('offline')}
        </View>
      ) : null}
      {state.body === 'hard-error' ? (
        <View
          testID={`radio-section-${id}-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.error}>{strings.radio.loadFailed}</Text>
          {retryButton('error')}
        </View>
      ) : null}
      {state.body === 'empty' ? (
        <Text
          testID={`radio-section-${id}-empty`}
          accessibilityLiveRegion="polite"
          style={styles.empty}
        >
          {emptyText}
        </Text>
      ) : null}
      {state.body === 'content' ? children : null}
      {state.notice === 'cached-offline' ? (
        <View
          testID={`radio-section-${id}-cached-offline`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <Text style={styles.warning}>{strings.radio.cachedOffline}</Text>
          {retryButton('cached-offline')}
        </View>
      ) : null}
      {state.notice === 'cached-refresh-error' ? (
        <View
          testID={`radio-section-${id}-cached-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <Text style={styles.warning}>{strings.radio.cachedRefreshFailed}</Text>
          {retryButton('cached-error')}
        </View>
      ) : null}
      {state.notice === 'refreshing' ? (
        <View
          testID={`radio-section-${id}-refreshing`}
          accessibilityRole="progressbar"
          accessibilityLabel={strings.radio.refreshing}
          accessibilityLiveRegion="polite"
          style={styles.statusRow}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.status}>{strings.radio.refreshing}</Text>
        </View>
      ) : null}
      {state.notice === 'stale' ? (
        <Text
          testID={`radio-section-${id}-stale`}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {strings.radio.stale}
        </Text>
      ) : null}
    </View>
  );
}

interface RadioStationCardProps {
  testID: string;
  title: string;
  subtitle: string;
  cover: string;
  variant: 'personal' | 'mood' | 'genre';
  busy: boolean;
  blocked: boolean;
  onPress: () => void;
}

export function RadioStationCard({
  testID,
  title,
  subtitle,
  cover,
  variant,
  busy,
  blocked,
  onPress,
}: RadioStationCardProps) {
  const disabled = blocked || busy;
  const actionText = busy
    ? strings.radio.starting
    : strings.radio.startStation(title);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.radio.startStation(title)}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles[`${variant}Card`],
        pressed && styles.pressed,
        disabled && !busy && styles.disabled,
      ]}
    >
      {cover ? (
        <Image accessible={false} source={{ uri: cover }} style={[styles.artwork, styles[`${variant}Artwork`]]} />
      ) : (
        <View style={[styles.artwork, styles[`${variant}Artwork`], styles.placeholder]}>
          <AppIcon name="radio" color={colors.accentSoft} size={31} />
        </View>
      )}
      <View style={styles.cardMeta}>
        <Text style={styles.radioLabel}>{strings.radio.badge}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.cardSubtitle} numberOfLines={2}>{subtitle}</Text>
        <View style={styles.actionRow}>
          {busy ? (
            <ActivityIndicator color={colors.onAccent} size="small" />
          ) : (
            <AppIcon name="play" color={colors.onAccent} size={20} />
          )}
          <Text style={styles.actionText} numberOfLines={1}>{actionText}</Text>
        </View>
      </View>
    </Pressable>
  );
}

interface RadioQueryStationProps {
  testID: string;
  title: string;
  subtitle: string;
  cover: string;
  state: RemoteVisualState;
  queryBusy: boolean;
  stationBusy: boolean;
  blocked: boolean;
  loadingText: string;
  emptyText: string;
  onPress: () => void;
  onRetry: () => void;
}

/** A mood station owns its query body/notice separately from its playback action state. */
export function RadioQueryStation({
  testID,
  title,
  subtitle,
  cover,
  state,
  queryBusy,
  stationBusy,
  blocked,
  loadingText,
  emptyText,
  onPress,
  onRetry,
}: RadioQueryStationProps) {
  const retryButton = (suffix: string) => (
    <Pressable
      testID={`${testID}-${suffix}-retry`}
      accessibilityRole="button"
      accessibilityLabel={strings.radio.retryStation(title)}
      accessibilityState={{ disabled: queryBusy, busy: queryBusy }}
      disabled={queryBusy}
      onPress={onRetry}
      style={({ pressed }) => [styles.retryButton, pressed && styles.pressed, queryBusy && styles.disabled]}
    >
      <Text style={styles.retryText}>{strings.common.retry}</Text>
    </Pressable>
  );
  const blockingMessage = state.body === 'offline'
    ? strings.radio.sectionOffline
    : state.body === 'hard-error'
      ? strings.radio.loadFailed
      : null;

  return (
    <View testID={`${testID}-query`} style={styles.queryStation}>
      {state.body === 'loading' ? (
        <View
          testID={`${testID}-loading`}
          accessibilityRole="progressbar"
          accessibilityLabel={loadingText}
          accessibilityLiveRegion="polite"
          style={styles.moodStateBox}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.status}>{loadingText}</Text>
        </View>
      ) : null}
      {blockingMessage !== null ? (
        <View
          testID={`${testID}-${state.body === 'offline' ? 'offline' : 'error'}`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.moodStateBox}
        >
          <Text style={styles.error}>{blockingMessage}</Text>
          {retryButton(state.body === 'offline' ? 'offline' : 'error')}
        </View>
      ) : null}
      {state.body === 'empty' ? (
        <Text
          testID={`${testID}-empty`}
          accessibilityLiveRegion="polite"
          style={[styles.empty, styles.moodStateBox]}
        >
          {emptyText}
        </Text>
      ) : null}
      {state.body === 'content' ? (
        <RadioStationCard
          testID={testID}
          title={title}
          subtitle={subtitle}
          cover={cover}
          variant="mood"
          busy={stationBusy}
          blocked={blocked}
          onPress={onPress}
        />
      ) : null}
      {state.notice === 'cached-offline' || state.notice === 'cached-refresh-error' ? (
        <View
          testID={`${testID}-${state.notice === 'cached-offline' ? 'cached-offline' : 'cached-error'}`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.cardNotice}
        >
          <Text style={styles.warning}>
            {state.notice === 'cached-offline' ? strings.radio.cachedOffline : strings.radio.cachedRefreshFailed}
          </Text>
          {retryButton(state.notice === 'cached-offline' ? 'cached-offline' : 'cached-error')}
        </View>
      ) : null}
      {state.notice === 'refreshing' ? (
        <View
          testID={`${testID}-refreshing`}
          accessibilityRole="progressbar"
          accessibilityLabel={strings.radio.refreshing}
          accessibilityLiveRegion="polite"
          style={styles.cardStatus}
        >
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.status}>{strings.radio.refreshing}</Text>
        </View>
      ) : null}
      {state.notice === 'stale' ? (
        <Text testID={`${testID}-stale`} accessibilityLiveRegion="polite" style={styles.cardStatus}>
          {strings.radio.stale}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  sectionHeader: { gap: 3, paddingHorizontal: 16 },
  sectionTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 18 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  notice: { gap: 8, paddingHorizontal: 16 },
  empty: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginHorizontal: 16, padding: 22, textAlign: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  errorBox: { marginHorizontal: 16, padding: 12, gap: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surfaceElevated },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  retryButton: { minHeight: metrics.minimumTouchTarget, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 24, backgroundColor: colors.accent },
  retryText: { color: colors.onAccent, fontSize: 13, fontWeight: '700' },
  queryStation: { width: 260, gap: 8 },
  moodStateBox: { width: 260, minHeight: 154, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  cardNotice: { gap: 7, paddingBottom: 4 },
  cardStatus: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 7 },
  card: { overflow: 'hidden', borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  personalCard: { width: 170, minHeight: 270 },
  moodCard: { width: 260, minHeight: 154, flexDirection: 'row', padding: 14, gap: 13, borderColor: colors.accent },
  genreCard: { width: 205, minHeight: 152, flexDirection: 'row', padding: 12, gap: 11 },
  pressed: { opacity: 0.72, backgroundColor: colors.surfacePressed },
  disabled: { opacity: 0.48 },
  artwork: { backgroundColor: colors.surface },
  personalArtwork: { width: 168, height: 168 },
  moodArtwork: { width: 104, height: 124, borderRadius: 11 },
  genreArtwork: { width: 82, height: 126, borderRadius: 10 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  radioGlyph: { color: colors.accentSoft, fontSize: 30 },
  cardMeta: { flex: 1, minWidth: 0, padding: 11, gap: 3 },
  radioLabel: { color: colors.accentSoft, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  cardSubtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  actionRow: { minHeight: metrics.minimumTouchTarget, marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },
  playGlyph: { width: 34, height: 34, borderRadius: 17, textAlign: 'center', textAlignVertical: 'center', color: colors.onAccent, backgroundColor: colors.accent, fontSize: 14 },
  actionText: { flex: 1, color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
});
