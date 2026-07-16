import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MeUpdateRequest } from '../../api/endpoints';
import type { StatEntry, User, UserStats } from '../../api/types';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
} from '../../data/remoteState';
import { strings } from '../../localization';
import { ensurePlayer, isPlayerReady } from '../../player/setup';
import { colors, metrics } from '../../theme';
import AppIcon from '../AppIcon';
import {
  SLEEP_PRESETS_MINUTES,
  buildProfilePatch,
  formatTimerRemaining,
  initialProfileForm,
  profileInitials,
  profilePatchHasChanges,
  type ProfileForm,
} from '../../screens/profileModel';
import {
  clearSleepTimer,
  nativeSleepTimerGateway,
  setCurrentTrackRemainingSleepTimer,
  setEndOfTrackSleepTimer,
  setPresetSleepTimer,
  type ProfileSleepTimerState,
} from '../../screens/profileSleepTimer';
import {
  profileSaveFailureMessage,
  profileSleepTimerFailureMessage,
} from '../../screens/profileFeedback';

interface ProfileIdentityCardProps {
  user: User;
  avatarUri: string | null;
  serverHost: string;
}

function AvatarImage({ uri, fallback }: { uri: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Text style={styles.avatarFallbackText}>{fallback}</Text>;
  }
  return (
    <Image
      testID="profile-avatar-image"
      accessible={false}
      source={{ uri }}
      onError={() => setFailed(true)}
      style={styles.avatarImage}
    />
  );
}

export function ProfileIdentityCard({ user, avatarUri, serverHost }: ProfileIdentityCardProps) {
  const name = user.display_name?.trim() || user.email;
  return (
    <View testID="profile-identity" style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{strings.profile.accountTitle}</Text>
      <View style={styles.identityRow}>
        <View
          testID="profile-avatar"
          accessibilityRole="image"
          accessibilityLabel={name}
          style={styles.avatar}
        >
          {avatarUri ? (
            <AvatarImage key={avatarUri} uri={avatarUri} fallback={profileInitials(user.display_name, user.email)} />
          ) : (
            <Text style={styles.avatarFallbackText}>{profileInitials(user.display_name, user.email)}</Text>
          )}
        </View>
        <View style={styles.identityCopy}>
          <Text testID="profile-name" style={styles.identityName}>{name}</Text>
          <Text testID="profile-email-value" style={styles.identityEmail}>{user.email}</Text>
          <View style={styles.badges}>
            <View testID="profile-role" style={styles.badge}>
              <Text style={styles.badgeText}>
                {user.is_admin ? strings.profile.administrator : strings.profile.member}
              </Text>
            </View>
            <View
              testID="profile-approval"
              style={[styles.badge, user.is_approved ? styles.approvedBadge : styles.pendingBadge]}
            >
              <Text style={[styles.badgeText, user.is_approved ? styles.approvedText : styles.pendingText]}>
                {user.is_approved ? strings.profile.approved : strings.profile.pendingApproval}
              </Text>
            </View>
          </View>
        </View>
      </View>
      <Text testID="profile-server-origin" style={styles.helperText}>
        {strings.profile.serverOrigin(serverHost)}
      </Text>
      <Text testID="profile-avatar-deferred" style={styles.helperText}>{strings.profile.avatarDeferred}</Text>
    </View>
  );
}

interface ProfileEditFormProps {
  user: User;
  onSave: (patch: MeUpdateRequest) => Promise<void>;
}

type FormStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export function ProfileEditForm({ user, onSave }: ProfileEditFormProps) {
  const [form, setForm] = useState<ProfileForm>(() => initialProfileForm({
    displayName: user.display_name,
    email: user.email,
  }));
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });
  const saving = status.kind === 'saving';

  const update = (field: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus({ kind: 'idle' });
  };

  const submit = async () => {
    if (saving) return;
    let patch: MeUpdateRequest;
    try {
      patch = buildProfilePatch(form, { displayName: user.display_name, email: user.email });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: profileSaveFailureMessage(error, strings.profile),
      });
      return;
    }
    if (!profilePatchHasChanges(patch)) {
      setStatus({ kind: 'success', message: strings.profile.noChanges });
      return;
    }
    setStatus({ kind: 'saving' });
    try {
      await onSave(patch);
      setForm((current) => ({ ...current, password: '', confirmPassword: '' }));
      setStatus({ kind: 'success', message: strings.profile.saved });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: profileSaveFailureMessage(error, strings.profile),
      });
    }
  };

  return (
    <View testID="profile-edit" style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{strings.profile.editTitle}</Text>
      <View style={styles.fieldGroup}>
        <Text nativeID="profile-display-name-label" style={styles.label}>{strings.profile.displayName}</Text>
        <TextInput
          testID="profile-display-name"
          accessibilityLabelledBy="profile-display-name-label"
          value={form.displayName}
          autoCapitalize="words"
          autoCorrect={false}
          editable={!saving}
          onChangeText={(value) => update('displayName', value)}
          style={styles.input}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text nativeID="profile-email-label" style={styles.label}>{strings.profile.email}</Text>
        <TextInput
          testID="profile-email"
          accessibilityLabelledBy="profile-email-label"
          value={form.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          onChangeText={(value) => update('email', value)}
          style={styles.input}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text nativeID="profile-password-label" style={styles.label}>{strings.profile.newPassword}</Text>
        <TextInput
          testID="profile-password"
          accessibilityLabelledBy="profile-password-label"
          value={form.password}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          onChangeText={(value) => update('password', value)}
          style={styles.input}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text nativeID="profile-password-confirm-label" style={styles.label}>{strings.profile.confirmPassword}</Text>
        <TextInput
          testID="profile-password-confirm"
          accessibilityLabelledBy="profile-password-confirm-label"
          value={form.confirmPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          onChangeText={(value) => update('confirmPassword', value)}
          style={styles.input}
        />
        <Text style={styles.helperText}>{strings.profile.passwordHint}</Text>
      </View>
      {status.kind === 'error' || status.kind === 'success' ? (
        <Text
          testID={status.kind === 'error' ? 'profile-save-error' : 'profile-save-status'}
          accessibilityRole={status.kind === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion={status.kind === 'error' ? 'assertive' : 'polite'}
          style={status.kind === 'error' ? styles.errorText : styles.successText}
        >
          {status.message}
        </Text>
      ) : null}
      <Pressable
        testID="profile-save"
        accessibilityRole="button"
        accessibilityLabel={saving ? strings.profile.saving : strings.profile.save}
        accessibilityState={{ disabled: saving, busy: saving }}
        disabled={saving}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, saving && styles.disabled]}
      >
        {saving ? <ActivityIndicator color={colors.onAccent} /> : null}
        <Text style={styles.primaryButtonText}>{saving ? strings.profile.saving : strings.profile.save}</Text>
      </Pressable>
    </View>
  );
}

interface ListeningStatsPanelProps {
  data: UserStats | undefined;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  onRefresh: () => void;
}

function StatRows({ id, title, entries }: { id: string; title: string; entries: StatEntry[] }) {
  return (
    <View testID={`profile-stats-${id}`} style={styles.statList}>
      <Text style={styles.statListTitle}>{title}</Text>
      {entries.length === 0 ? (
        <Text testID={`profile-stats-${id}-empty`} style={styles.emptySubtext}>—</Text>
      ) : entries.slice(0, 5).map((entry, index) => (
        <View
          key={`${entry.key}:${index}`}
          testID={`profile-stats-${id}-${index}`}
          accessible
          accessibilityLabel={`${entry.label}, ${entry.sublabel}, ${strings.profile.playCount(entry.count)}`}
          style={styles.statRow}
        >
          {entry.cover ? <Image accessible={false} source={{ uri: entry.cover }} style={styles.statCover} /> : <View style={styles.statCoverFallback} />}
          <View style={styles.statCopy}>
            <Text numberOfLines={1} style={styles.statLabel}>{entry.label}</Text>
            <Text numberOfLines={1} style={styles.statSublabel}>{entry.sublabel}</Text>
          </View>
          <Text style={styles.statCount}>{entry.count}</Text>
        </View>
      ))}
    </View>
  );
}

function StatsPeriod({
  id,
  title,
  total,
  tracks,
  artists,
}: {
  id: string;
  title: string;
  total: number;
  tracks: StatEntry[];
  artists: StatEntry[];
}) {
  return (
    <View testID={`profile-stat-${id}`} style={styles.statsPeriod}>
      <View style={styles.periodHeader}>
        <Text style={styles.periodTitle}>{title}</Text>
        <View style={styles.playCountPill}>
          <Text style={styles.playCountValue}>{total}</Text>
          <Text style={styles.playCountLabel}>{strings.profile.plays}</Text>
        </View>
      </View>
      <StatRows id={`${id}-tracks`} title={strings.profile.topTracks} entries={tracks} />
      <StatRows id={`${id}-artists`} title={strings.profile.topArtists} entries={artists} />
    </View>
  );
}

export function ListeningStatsPanel({
  data,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  onRefresh,
}: ListeningStatsPanelProps) {
  const hasData = data !== undefined;
  const empty = data !== undefined
    && data.total_plays === 0
    && data.total_plays_month === 0
    && data.top_tracks.length === 0
    && data.top_artists.length === 0
    && data.top_tracks_month.length === 0
    && data.top_artists_month.length === 0
    && data.recent.length === 0;
  const visual = resolveRemoteVisualState({
    hasData,
    empty,
    pending,
    fetching,
    stale,
    fetchStatus,
    error,
  });
  const retryButton = (testID: string) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.profile.refreshStats}
      accessibilityState={{ disabled: fetching, busy: fetching }}
      disabled={fetching}
      onPress={onRefresh}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, fetching && styles.disabled]}
    >
      <Text style={styles.secondaryButtonText}>{strings.common.retry}</Text>
    </Pressable>
  );

  return (
    <View testID="profile-stats" style={styles.card}>
      <View style={styles.sectionHeaderRow}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{strings.profile.statsTitle}</Text>
        <Pressable
          testID="profile-stats-refresh"
          accessibilityRole="button"
          accessibilityLabel={strings.profile.refreshStats}
          accessibilityState={{ disabled: fetching, busy: fetching }}
          disabled={fetching}
          onPress={onRefresh}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, fetching && styles.disabled]}
        >
          {fetching ? (
            <ActivityIndicator color={colors.accentSoft} />
          ) : (
            <AppIcon name="refresh" color={colors.accentSoft} size={20} />
          )}
        </Pressable>
      </View>
      {visual.body === 'loading' ? (
        <View
          testID="profile-stats-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.profile.statsLoading}
          accessibilityLiveRegion="polite"
          style={styles.centerState}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.stateText}>{strings.profile.statsLoading}</Text>
        </View>
      ) : null}
      {visual.body === 'offline' ? (
        <View
          testID="profile-stats-offline"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorState}
        >
          <Text style={styles.errorText}>{strings.profile.statsOffline}</Text>
          {retryButton('profile-stats-retry')}
        </View>
      ) : null}
      {visual.body === 'hard-error' ? (
        <View
          testID="profile-stats-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorState}
        >
          <Text style={styles.errorText}>{strings.profile.statsLoadFailed}</Text>
          {retryButton('profile-stats-retry')}
        </View>
      ) : null}
      {visual.notice === 'cached-offline' ? (
        <View
          testID="profile-stats-cached-offline"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.noticeState}
        >
          <Text style={styles.warningText}>{strings.profile.statsCachedOffline}</Text>
          {retryButton('profile-stats-notice-retry')}
        </View>
      ) : null}
      {visual.notice === 'cached-refresh-error' ? (
        <View
          testID="profile-stats-cached-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.noticeState}
        >
          <Text style={styles.warningText}>{strings.profile.statsRefreshFailed}</Text>
          {retryButton('profile-stats-notice-retry')}
        </View>
      ) : null}
      {visual.notice === 'refreshing' ? (
        <View
          testID="profile-stats-refreshing"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.profile.statsRefreshing}
          accessibilityLiveRegion="polite"
          style={styles.inlineStatus}
        >
          <ActivityIndicator color={colors.accentSoft} />
          <Text style={styles.staleText}>{strings.profile.statsRefreshing}</Text>
        </View>
      ) : null}
      {visual.notice === 'stale' ? (
        <Text testID="profile-stats-stale" accessibilityLiveRegion="polite" style={styles.staleText}>
          {strings.profile.statsStale}
        </Text>
      ) : null}
      {visual.body === 'empty' ? (
        <Text testID="profile-stats-empty" accessibilityLiveRegion="polite" style={styles.emptyText}>
          {strings.profile.statsEmpty}
        </Text>
      ) : null}
      {visual.body === 'content' && data ? (
        <View testID="profile-stats-periods" style={styles.periods}>
          <StatsPeriod
            id="all-time"
            title={strings.profile.allTime}
            total={data.total_plays}
            tracks={data.top_tracks}
            artists={data.top_artists}
          />
          <StatsPeriod
            id="30-days"
            title={strings.profile.lastThirtyDays}
            total={data.total_plays_month}
            tracks={data.top_tracks_month}
            artists={data.top_artists_month}
          />
        </View>
      ) : null}
    </View>
  );
}

function timerStatus(timer: ProfileSleepTimerState): string {
  if (timer === null) return strings.profile.timerOff;
  if (timer.type === 'mediaItem') return strings.profile.timerEndOfTrack;
  return strings.profile.timerRemaining(formatTimerRemaining(timer.remainingSeconds));
}

export function SleepTimerPanel() {
  const [timer, setTimer] = useState<ProfileSleepTimerState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (!isPlayerReady()) return;
      try {
        setTimer(nativeSleepTimerGateway.read());
      } catch {
        // The MediaController can disappear while Android is tearing down;
        // explicit user actions below surface their failures.
      }
    };
    const immediate = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, []);

  const run = async (key: string, operation: () => ProfileSleepTimerState) => {
    if (busy !== null) return;
    setBusy(key);
    setError(null);
    try {
      await ensurePlayer();
      setTimer(operation());
    } catch (failure) {
      setError(profileSleepTimerFailureMessage(failure, strings.profile));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="profile-sleep" style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{strings.profile.sleepTitle}</Text>
      <Text style={styles.sectionSubtitle}>{strings.profile.sleepSubtitle}</Text>
      <View testID="profile-sleep-status" accessibilityLiveRegion="polite" style={styles.timerStatus}>
        <View style={[styles.timerDot, timer !== null && styles.timerDotActive]} />
        <Text style={styles.timerStatusText}>{timerStatus(timer)}</Text>
      </View>
      <View style={styles.timerGrid}>
        {SLEEP_PRESETS_MINUTES.map((minutes) => {
          const key = String(minutes);
          return (
            <Pressable
              key={minutes}
              testID={`profile-sleep-${minutes}`}
              accessibilityRole="button"
              accessibilityLabel={strings.profile.minutes(minutes)}
              accessibilityState={{ disabled: busy !== null, busy: busy === key }}
              disabled={busy !== null}
              onPress={() => void run(key, () => setPresetSleepTimer(minutes))}
              style={({ pressed }) => [styles.timerButton, pressed && styles.pressed, busy !== null && styles.disabled]}
            >
              <Text style={styles.timerButtonText}>{strings.profile.minutes(minutes)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        testID="profile-sleep-end-track"
        accessibilityRole="button"
        accessibilityState={{ disabled: busy !== null, busy: busy === 'end' }}
        disabled={busy !== null}
        onPress={() => void run('end', setEndOfTrackSleepTimer)}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy !== null && styles.disabled]}
      >
        <Text style={styles.secondaryButtonText}>{strings.profile.endOfTrack}</Text>
      </Pressable>
      <Pressable
        testID="profile-sleep-current-remaining"
        accessibilityRole="button"
        accessibilityState={{ disabled: busy !== null, busy: busy === 'remaining' }}
        disabled={busy !== null}
        onPress={() => void run('remaining', setCurrentTrackRemainingSleepTimer)}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy !== null && styles.disabled]}
      >
        <Text style={styles.secondaryButtonText}>{strings.profile.currentTrackRemaining}</Text>
      </Pressable>
      <Pressable
        testID="profile-sleep-cancel"
        accessibilityRole="button"
        accessibilityState={{ disabled: timer === null || busy !== null, busy: busy === 'cancel' }}
        disabled={timer === null || busy !== null}
        onPress={() => void run('cancel', clearSleepTimer)}
        style={({ pressed }) => [
          styles.cancelTimerButton,
          pressed && styles.pressed,
          (timer === null || busy !== null) && styles.disabled,
        ]}
      >
        <Text style={styles.cancelTimerText}>{strings.profile.cancelTimer}</Text>
      </Pressable>
      {error ? (
        <Text testID="profile-sleep-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorText}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 16, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionTitle: { flex: 1, color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 84, height: 84, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 42, backgroundColor: colors.accent },
  avatarImage: { width: '100%', height: '100%' },
  avatarFallbackText: { color: colors.onAccent, fontSize: 28, fontWeight: '900' },
  identityCopy: { flex: 1, gap: 5 },
  identityName: { color: colors.textPrimary, fontSize: 21, fontWeight: '800' },
  identityEmail: { color: colors.textSecondary, fontSize: 14 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  badge: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  badgeText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  approvedBadge: { borderColor: colors.success },
  pendingBadge: { borderColor: colors.warning },
  approvedText: { color: colors.success },
  pendingText: { color: colors.warning },
  fieldGroup: { gap: 7 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  input: { minHeight: metrics.minimumTouchTarget, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, backgroundColor: colors.backgroundElevated, fontSize: 16 },
  helperText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: metrics.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18, borderRadius: 24, backgroundColor: colors.accent },
  primaryButtonText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  secondaryButton: { minHeight: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  secondaryButtonText: { color: colors.accentSoft, fontSize: 14, fontWeight: '800' },
  iconButton: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.surfaceElevated },
  refreshGlyph: { color: colors.accentSoft, fontSize: 25, fontWeight: '700' },
  centerState: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorState: { gap: 12 },
  noticeState: { gap: 8 },
  inlineStatus: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stateText: { color: colors.textSecondary, fontSize: 14 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  successText: { color: colors.success, fontSize: 13, lineHeight: 19 },
  staleText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  warningText: { color: colors.warning, fontSize: 12, lineHeight: 18 },
  emptyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 8 },
  emptySubtext: { minHeight: 32, color: colors.textSecondary, fontSize: 15 },
  periods: { gap: 16 },
  statsPeriod: { gap: 14, padding: 14, borderRadius: 14, backgroundColor: colors.backgroundElevated },
  periodHeader: { minHeight: metrics.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  periodTitle: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  playCountPill: { alignItems: 'flex-end' },
  playCountValue: { color: colors.accentSoft, fontSize: 22, fontWeight: '900' },
  playCountLabel: { color: colors.textSecondary, fontSize: 11, textTransform: 'uppercase' },
  statList: { gap: 4 },
  statListTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  statRow: { minHeight: metrics.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statCover: { width: 40, height: 40, borderRadius: 6, backgroundColor: colors.surfaceElevated },
  statCoverFallback: { width: 40, height: 40, borderRadius: 6, backgroundColor: colors.surfaceElevated },
  statCopy: { flex: 1, gap: 2 },
  statLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  statSublabel: { color: colors.textSecondary, fontSize: 12 },
  statCount: { minWidth: 30, color: colors.accentSoft, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  timerStatus: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.backgroundElevated },
  timerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.textSecondary },
  timerDotActive: { backgroundColor: colors.success },
  timerStatusText: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  timerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timerButton: { minWidth: 72, minHeight: metrics.minimumTouchTarget, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 24, backgroundColor: colors.accent },
  timerButtonText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  cancelTimerButton: { minHeight: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  cancelTimerText: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
