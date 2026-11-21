import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { PartyMember, PartyState, PartyTrack, Track } from '../../api/types';
import { strings } from '../../localization';
import { canRemovePartyTrack, partyDisplayName, partyLoadLabel } from '../../party/partyModel';
import type { PartyListenMode, PartyPhase } from '../../party/partySession';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { ActionButton, AppText, Artwork, FilterChip, IconButton } from '../ui';

interface PartyHeaderProps {
  party: PartyState;
  phase: PartyPhase;
  leaving: boolean;
  locked: boolean;
  onShare: () => void;
  onLeave: () => void;
}

/** Name, live status, role, member count, the big code and the two party-level actions. */
export function PartyHeader({ party, phase, leaving, locked, onShare, onLeave }: PartyHeaderProps) {
  const stale = phase === 'stale';
  return (
    <View testID="party-header" style={styles.header}>
      <AppText variant="overline" color="accent">{strings.party.eyebrow}</AppText>
      <AppText variant="hero" accessibilityRole="header" numberOfLines={2}>
        {partyDisplayName(party)}
      </AppText>
      <View style={styles.statusLine}>
        <View
          testID="party-live-status"
          accessibilityLabel={stale ? strings.party.stale : strings.party.live}
          style={styles.statusItem}
        >
          <View style={[styles.dot, stale ? styles.dotStale : styles.dotLive]} />
          <AppText variant="label" color={stale ? 'danger' : 'accent'}>
            {stale ? strings.party.stale : strings.party.live}
          </AppText>
        </View>
        <AppText variant="callout" color="secondary" numberOfLines={1} style={styles.statusText}>
          {party.is_host ? strings.party.youAreHost : strings.party.hostedBy(party.host_name)}
          {' · '}
          {strings.party.memberCount(party.members.length)}
        </AppText>
      </View>
      <View style={styles.codeRow}>
        <View style={styles.codeCopy}>
          <AppText variant="overline" color="muted">{strings.party.codeLabel}</AppText>
          <AppText
            testID="party-code"
            variant="display"
            selectable
            accessibilityLabel={`${strings.party.codeLabel} ${party.code.split('').join(' ')}`}
          >
            {party.code}
          </AppText>
        </View>
        <IconButton
          testID="party-share"
          icon="share-variant"
          variant="tonal"
          accessibilityLabel={strings.party.share}
          onPress={onShare}
        />
      </View>
      <ActionButton
        testID="party-leave"
        label={leaving ? strings.party.leaving : strings.party.leave}
        icon="logout"
        variant="secondary"
        busy={leaving}
        disabled={locked}
        onPress={onLeave}
      />
    </View>
  );
}

interface PartyNoticeProps {
  testID: string;
  message: string;
  tone: 'danger' | 'info';
  title?: string;
  actionLabel?: string;
  actionBusy?: boolean;
  onAction?: () => void;
}

/** A full-width message row; danger ones are alerts, info ones are plain hints. */
export function PartyNotice({
  testID,
  message,
  tone,
  title,
  actionLabel,
  actionBusy = false,
  onAction,
}: PartyNoticeProps) {
  if ((actionLabel === undefined) !== (onAction === undefined)) {
    throw new Error('Party notice actions require both a label and callback');
  }
  const danger = tone === 'danger';
  return (
    <View
      testID={testID}
      accessibilityRole={danger ? 'alert' : undefined}
      accessibilityLiveRegion={danger ? 'assertive' : 'polite'}
      style={[styles.notice, danger ? styles.noticeDanger : styles.noticeInfo]}
    >
      <View style={styles.noticeCopy}>
        <AppIcon
          name={danger ? 'alert-circle-outline' : 'information-outline'}
          color={danger ? colors.danger : colors.textSecondary}
          size={20}
        />
        <View style={styles.noticeText}>
          {title !== undefined ? <AppText variant="bodyStrong">{title}</AppText> : null}
          <AppText variant="callout" color={danger ? 'danger' : 'secondary'}>{message}</AppText>
        </View>
      </View>
      {actionLabel !== undefined && onAction !== undefined ? (
        <ActionButton
          testID={`${testID}-action`}
          label={actionLabel}
          variant="secondary"
          busy={actionBusy}
          disabled={actionBusy}
          onPress={onAction}
        />
      ) : null}
    </View>
  );
}

const LOAD_ICONS: Record<PartyTrack['load_state'], AppIconName> = {
  ready: 'check-circle-outline',
  loading: 'progress-download',
  queued: 'clock-outline',
  failed: 'alert-circle-outline',
  idle: 'cloud-outline',
};

/** Server cache state of one entry; the running entry also shows this device buffering. */
export function PartyLoadBadge({ entry, buffering }: { entry: PartyTrack; buffering: boolean }) {
  const label = buffering ? strings.party.buffering : partyLoadLabel(entry);
  const failed = entry.load_state === 'failed' && !buffering;
  const busy = buffering || entry.load_state === 'loading';
  return (
    <View testID={`party-load-${entry.id}`} accessibilityLabel={label} style={styles.badge}>
      {busy ? (
        <ActivityIndicator size="small" color={colors.accentSoft} />
      ) : (
        <AppIcon
          name={LOAD_ICONS[entry.load_state]}
          size={14}
          color={failed ? colors.danger : entry.load_state === 'ready' ? colors.success : colors.textMuted}
        />
      )}
      <AppText
        variant="caption"
        color={failed ? 'danger' : entry.load_state === 'ready' ? 'success' : 'muted'}
        numberOfLines={2}
        style={styles.badgeText}
      >
        {label}
      </AppText>
    </View>
  );
}

interface PartyQueueRowProps {
  party: PartyState;
  index: number;
  /** This device is buffering the running entry. */
  buffering: boolean;
  locked: boolean;
  onPlay: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

/** One party entry: who added it, its load state and the actions this viewer may take. */
export function PartyQueueRow({
  party,
  index,
  buffering,
  locked,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
}: PartyQueueRowProps) {
  const entry = party.tracks[index];
  if (entry === undefined) throw new RangeError(`Party queue row ${index} does not exist`);
  const current = index === party.current_index;
  const own = entry.added_by_member !== '' && entry.added_by_member === party.viewer_key;
  const addedBy = own
    ? strings.party.addedByYou
    : entry.added_by === ''
      ? null
      : strings.party.addedBy(entry.added_by);
  const removable = canRemovePartyTrack(party, index);
  const body = (
    <>
      <Artwork uri={entry.cover} size={layout.artwork.sm} icon="music-note" />
      <View style={styles.rowCopy}>
        {current ? (
          <AppText variant="overline" color="accent">{strings.party.nowPlaying}</AppText>
        ) : null}
        <AppText variant="bodyStrong" color={current ? 'accent' : 'primary'} numberOfLines={1}>
          {entry.title}
        </AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1}>
          {addedBy === null ? entry.artist : `${entry.artist} · ${addedBy}`}
        </AppText>
        <PartyLoadBadge entry={entry} buffering={current && buffering} />
      </View>
    </>
  );
  return (
    <View
      testID={`party-track-${entry.id}`}
      style={[styles.row, current ? styles.rowCurrent : null]}
    >
      {party.is_host ? (
        <Pressable
          testID={`party-track-${entry.id}-play`}
          accessibilityRole="button"
          accessibilityLabel={strings.party.playAt(entry.title)}
          accessibilityState={{ selected: current, disabled: locked }}
          disabled={locked}
          onPress={onPlay}
          style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.rowMain}>{body}</View>
      )}
      {party.is_host ? (
        <View style={styles.rowActions}>
          <IconButton
            testID={`party-track-${entry.id}-up`}
            icon="chevron-up"
            size="sm"
            accessibilityLabel={strings.party.moveUp(entry.title)}
            disabled={locked || index === 0}
            onPress={onMoveUp}
          />
          <IconButton
            testID={`party-track-${entry.id}-down`}
            icon="chevron-down"
            size="sm"
            accessibilityLabel={strings.party.moveDown(entry.title)}
            disabled={locked || index === party.tracks.length - 1}
            onPress={onMoveDown}
          />
        </View>
      ) : null}
      {removable ? (
        <IconButton
          testID={`party-track-${entry.id}-remove`}
          icon="close"
          size="sm"
          accessibilityLabel={strings.party.remove(entry.title)}
          disabled={locked}
          onPress={onRemove}
        />
      ) : null}
    </View>
  );
}

interface PartySearchResultRowProps {
  track: Track;
  locked: boolean;
  adding: boolean;
  onAdd: () => void;
}

export function PartySearchResultRow({ track, locked, adding, onAdd }: PartySearchResultRowProps) {
  return (
    <View testID={`party-search-result-${track.id}`} style={styles.row}>
      <View style={styles.rowMain}>
        <Artwork uri={track.cover} size={layout.artwork.sm} icon="music-note" />
        <View style={styles.rowCopy}>
          <AppText variant="bodyStrong" numberOfLines={1}>{track.title}</AppText>
          <AppText variant="callout" color="secondary" numberOfLines={1}>{track.artist}</AppText>
        </View>
      </View>
      <IconButton
        testID={`party-search-result-${track.id}-add`}
        icon="playlist-plus"
        variant="tonal"
        size="sm"
        accessibilityLabel={strings.party.add(track.title)}
        busy={adding}
        disabled={locked}
        onPress={onAdd}
      />
    </View>
  );
}

interface PartyListenChoiceProps {
  hostName: string;
  mode: PartyListenMode;
  onChange: (mode: PartyListenMode) => void;
}

/**
 * A member picks where they hear the party: in step on this device, or
 * together at the host's speaker with this device silent.
 */
export function PartyListenChoice({ hostName, mode, onChange }: PartyListenChoiceProps) {
  return (
    <View testID="party-listen-choice" style={styles.listen}>
      <AppText variant="bodyStrong" accessibilityRole="header">{strings.party.listenTitle}</AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={strings.party.listenTitle} style={styles.listenOptions}>
        <FilterChip
          testID="party-listen-device"
          label={strings.party.listenOnDevice}
          icon="cellphone"
          accessibilityRole="radio"
          selected={mode === 'device'}
          onPress={() => onChange('device')}
        />
        <FilterChip
          testID="party-listen-host"
          label={strings.party.listenAtHost}
          icon="speaker"
          accessibilityRole="radio"
          selected={mode === 'host'}
          onPress={() => onChange('host')}
        />
      </View>
      <AppText testID="party-listen-hint" variant="callout" color="secondary">
        {mode === 'device' ? strings.party.followHint(hostName) : strings.party.listenAtHostHint(hostName)}
      </AppText>
    </View>
  );
}

/** Everyone in the party; the host first is the server's order, badges mark host and guests. */
export function PartyMembers({ members, hostName }: { members: readonly PartyMember[]; hostName: string }) {
  return (
    <View testID="party-members" style={styles.members}>
      {members.map((member, index) => (
        <View key={`${member.name}-${index}`} style={styles.member}>
          <Artwork uri={member.avatar_url ?? ''} size={layout.artwork.xs} icon="account" />
          <AppText variant="body" numberOfLines={1} style={styles.memberName}>{member.name}</AppText>
          {member.name === hostName ? (
            <AppText variant="micro" color="accent" style={styles.memberBadge}>
              {strings.party.hostBadge}
            </AppText>
          ) : null}
          {member.is_guest ? (
            <AppText variant="micro" color="muted" style={styles.memberBadge}>
              {strings.party.guestBadge}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: layout.pagePadding, paddingTop: spacing.md, gap: spacing.sm },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: radii.pill },
  dotLive: { backgroundColor: colors.accent },
  dotStale: { backgroundColor: colors.danger },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  codeCopy: { flex: 1, minWidth: 0 },
  notice: {
    marginHorizontal: layout.pagePadding,
    marginTop: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.md,
  },
  noticeDanger: { backgroundColor: colors.dangerSubtle },
  noticeInfo: { backgroundColor: colors.fill },
  noticeCopy: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1, minWidth: 0, gap: spacing.xxs },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: 18 },
  badgeText: { flexShrink: 1 },
  row: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: layout.pagePadding,
    paddingRight: spacing.xs,
  },
  rowCurrent: { backgroundColor: colors.accentSubtle },
  rowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowActions: { flexDirection: 'row' },
  pressed: { opacity: opacity.pressed },
  listen: {
    marginHorizontal: layout.pagePadding,
    marginTop: spacing.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.fill,
  },
  listenOptions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.xs },
  members: { paddingHorizontal: layout.pagePadding, gap: spacing.xs },
  member: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  memberName: { flex: 1, minWidth: 0 },
  memberBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    overflow: 'hidden',
  },
});
