import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { PartyMember, PartyState, PartyTrack, Track } from '../../api/types';
import { strings } from '../../localization';
import { wave2Strings } from '../../localization/wave2Strings';
import {
  canControlPartyPlayback,
  canRemovePartyTrack,
  isPartyTrackStored,
  partyDisplayName,
  partyLoadLabel,
} from '../../party/partyModel';
import type { PartyPhase } from '../../party/partySession';
import type { TrackPresentationState } from '../../player/trackPresentation';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { spotifyImportInputStyle } from '../search/SpotifyImportForm';
import { trackStateIndicatorCopy } from '../track/trackPresentationCopy';
import TrackStateIndicator, { MemoEqualizerBars } from '../TrackStateIndicator';
import { ActionButton, AppText, Artwork, IconButton } from '../ui';

interface PartyHeaderProps {
  party: PartyState;
  phase: PartyPhase;
  leaving: boolean;
  ending?: boolean;
  locked: boolean;
  controlOnly?: boolean;
  onShare: () => void;
  onLeave: () => void;
  onEnd?: () => void;
  onRename?: (nextName: string) => void;
  onToggleGuestsCanControl?: (enabled: boolean) => void;
  onToggleAutoDj?: (enabled: boolean) => void;
  onFillAutoDj?: () => void;
  fillingAutoDj?: boolean;
  onSaveAsPlaylist?: () => void;
  onOpenKiosk?: () => void;
  onToggleControlOnly?: (enabled: boolean) => void;
}

/**
 * Spotify Jam-aligned party header: name (editable by host), live status,
 * stacked member avatars, role & settings controls, big 6-char code + share,
 * and host End Jam vs Leave Jam controls.
 */
export function PartyHeader({
  party,
  phase,
  leaving,
  ending = false,
  locked,
  controlOnly = false,
  onShare,
  onLeave,
  onEnd,
  onRename,
  onToggleGuestsCanControl,
  onToggleAutoDj,
  onFillAutoDj,
  fillingAutoDj = false,
  onSaveAsPlaylist,
  onOpenKiosk,
  onToggleControlOnly,
}: PartyHeaderProps) {
  const stale = phase === 'stale';
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(party.name);
  const stackedAvatars = party.members.slice(0, 5);

  const openRename = () => {
    setDraftName(party.name);
    setEditingName(true);
  };

  const commitRename = () => {
    if (onRename === undefined) return;
    setEditingName(false);
    onRename(draftName.trim());
  };

  return (
    <View testID="party-header" style={styles.header}>
      <AppText variant="overline" color="accent">{strings.party.eyebrow}</AppText>

      {editingName && party.is_host && onRename !== undefined ? (
        <View testID="party-rename-form" style={styles.renameRow}>
          <TextInput
            testID="party-rename-input"
            accessibilityLabel={strings.party.renameLabel}
            value={draftName}
            onChangeText={setDraftName}
            placeholder={strings.party.renamePlaceholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={commitRename}
            style={[spotifyImportInputStyle, styles.renameInput]}
          />
          <ActionButton
            testID="party-rename-save"
            label={strings.party.renameSave}
            variant="primary"
            disabled={locked}
            onPress={commitRename}
          />
        </View>
      ) : (
        <View style={styles.titleRow}>
          <AppText
            variant="hero"
            accessibilityRole="header"
            numberOfLines={2}
            style={styles.titleText}
          >
            {partyDisplayName(party)}
          </AppText>
          {party.is_host && onRename !== undefined ? (
            <IconButton
              testID="party-rename-open"
              icon="pencil-outline"
              size="sm"
              accessibilityLabel={strings.party.renameLabel}
              disabled={locked}
              onPress={openRename}
            />
          ) : null}
        </View>
      )}

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

      {stackedAvatars.length > 0 ? (
        <View testID="party-avatar-stack" style={styles.avatarStack}>
          {stackedAvatars.map((member, index) => (
            <View
              key={`${member.key || member.name}-${index}`}
              style={[styles.avatarRing, index > 0 ? styles.avatarOverlap : null]}
            >
              <Artwork uri={member.avatar_url ?? ''} size={28} icon="account" />
            </View>
          ))}
        </View>
      ) : null}

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

      {party.is_host && onToggleGuestsCanControl !== undefined ? (
        <Pressable
          testID="party-guests-control-toggle"
          accessibilityRole="switch"
          accessibilityLabel={strings.party.guestsCanControlLabel}
          accessibilityHint={strings.party.guestsCanControlHint}
          accessibilityState={{ checked: party.guests_can_control, disabled: locked }}
          disabled={locked}
          onPress={() => onToggleGuestsCanControl(!party.guests_can_control)}
          style={({ pressed }) => [
            styles.toggleRow,
            party.guests_can_control ? styles.toggleRowActive : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.toggleCopy}>
            <AppText variant="bodyStrong">{strings.party.guestsCanControlLabel}</AppText>
            <AppText variant="caption" color="secondary">{strings.party.guestsCanControlHint}</AppText>
          </View>
          <AppIcon
            name={party.guests_can_control ? 'toggle-switch' : 'toggle-switch-off-outline'}
            size={32}
            color={party.guests_can_control ? colors.accent : colors.textMuted}
          />
        </Pressable>
      ) : null}

      {!party.is_host && onToggleControlOnly !== undefined ? (
        <Pressable
          testID="party-listen-mode-toggle"
          accessibilityRole="switch"
          accessibilityLabel={controlOnly ? strings.party.controlOnly : strings.party.listenOnDevice}
          accessibilityHint={strings.party.controlOnlyHint}
          accessibilityState={{ checked: !controlOnly, disabled: locked }}
          disabled={locked}
          onPress={() => onToggleControlOnly(!controlOnly)}
          style={({ pressed }) => [
            styles.toggleRow,
            !controlOnly ? styles.toggleRowActive : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.toggleCopy}>
            <AppText variant="bodyStrong">
              {controlOnly ? strings.party.controlOnly : strings.party.listenOnDevice}
            </AppText>
            <AppText variant="caption" color="secondary">{strings.party.controlOnlyHint}</AppText>
          </View>
          <AppIcon
            name={!controlOnly ? 'volume-high' : 'volume-off'}
            size={24}
            color={!controlOnly ? colors.accent : colors.textMuted}
          />
        </Pressable>
      ) : null}

      {party.is_host && onToggleAutoDj !== undefined ? (
        <Pressable
          testID="party-auto-dj-toggle"
          accessibilityRole="switch"
          accessibilityLabel={wave2Strings.party2.autoDjLabel}
          accessibilityHint={wave2Strings.party2.autoDjHint}
          accessibilityState={{ checked: party.auto_dj === true, disabled: locked }}
          disabled={locked}
          onPress={() => onToggleAutoDj(!(party.auto_dj === true))}
          style={({ pressed }) => [
            styles.toggleRow,
            party.auto_dj === true ? styles.toggleRowActive : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.toggleCopy}>
            <AppText variant="bodyStrong">{wave2Strings.party2.autoDjLabel}</AppText>
            <AppText variant="caption" color="secondary">{wave2Strings.party2.autoDjHint}</AppText>
          </View>
          <AppIcon
            name={party.auto_dj === true ? 'toggle-switch' : 'toggle-switch-off-outline'}
            size={32}
            color={party.auto_dj === true ? colors.accent : colors.textMuted}
          />
        </Pressable>
      ) : null}

      <View style={styles.headerActions}>
        {onOpenKiosk !== undefined ? (
          <ActionButton
            testID="party-open-kiosk"
            label={wave2Strings.party2.kioskButton}
            icon="television"
            variant="primary"
            disabled={locked}
            onPress={onOpenKiosk}
          />
        ) : null}
        {onSaveAsPlaylist !== undefined && party.tracks.length > 0 ? (
          <ActionButton
            testID="party-save-playlist"
            label={wave2Strings.party2.savePlaylistButton}
            icon="playlist-plus"
            variant="secondary"
            disabled={locked}
            onPress={onSaveAsPlaylist}
          />
        ) : null}
        {party.is_host && onFillAutoDj !== undefined ? (
          <ActionButton
            testID="party-fill-auto-dj"
            label={fillingAutoDj ? wave2Strings.party2.fillingAutoDj : wave2Strings.party2.fillAutoDj}
            icon="auto-fix"
            variant="secondary"
            busy={fillingAutoDj}
            disabled={locked}
            onPress={onFillAutoDj}
          />
        ) : null}
        {party.is_host && onEnd !== undefined ? (
          <ActionButton
            testID="party-end"
            label={ending ? strings.party.endingJam : strings.party.endJam}
            icon="stop-circle-outline"
            variant="danger"
            busy={ending}
            disabled={locked}
            onPress={onEnd}
          />
        ) : null}
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

/**
 * Transient server load status for party entries.
 * Stored/downloaded state uses the standard `TrackStateIndicator` icons instead;
 * this badge surfaces only active loading, queued preloads, buffering, or explicit
 * load errors.
 */
export function PartyLoadBadge({ entry, buffering }: { entry: PartyTrack; buffering: boolean }) {
  const showTransient =
    buffering
    || entry.load_state === 'loading'
    || entry.load_state === 'queued'
    || entry.load_state === 'failed';
  if (!showTransient) return null;

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
          color={failed ? colors.danger : colors.textMuted}
        />
      )}
      <AppText
        variant="caption"
        color={failed ? 'danger' : 'muted'}
        numberOfLines={2}
        style={styles.badgeText}
      >
        {label}
      </AppText>
    </View>
  );
}

export function partyTrackPresentation(
  entry: Pick<PartyTrack, 'is_stored' | 'load_state'>,
  base: TrackPresentationState | undefined,
  active: boolean,
  isPlaying: boolean,
  buffering: boolean,
): TrackPresentationState {
  const serverCached = isPartyTrackStored(entry) || base?.serverCache === 'cached';
  const playback: TrackPresentationState['playback'] = !active
    ? 'inactive'
    : buffering
      ? 'buffering'
      : isPlaying
        ? 'playing'
        : 'paused';
  return {
    active,
    playback,
    serverCache: serverCached ? 'cached' : base?.serverCache ?? 'not-cached',
    rollingDeviceCache: base?.rollingDeviceCache ?? null,
    explicitDownload: base?.explicitDownload ?? { kind: 'unknown' },
  };
}

function addedByLabel(party: PartyState, entry: PartyTrack): string | null {
  const own = entry.added_by_member !== '' && entry.added_by_member === party.viewer_key;
  if (own) return strings.party.addedByYou;
  return entry.added_by === '' ? null : strings.party.addedBy(entry.added_by);
}

export interface PartyNowPlayingCardProps {
  party: PartyState;
  buffering: boolean;
  locked: boolean;
  presentation?: TrackPresentationState;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
}

/** Spotify Jam "Now Playing" hero card with contributor info and shared controls. */
export function PartyNowPlayingCard({
  party,
  buffering,
  locked,
  presentation,
  onPrev,
  onTogglePlay,
  onNext,
}: PartyNowPlayingCardProps) {
  const entry = party.current_index >= 0 ? party.tracks[party.current_index] : undefined;
  if (entry === undefined) return null;
  const canControl = canControlPartyPlayback(party);
  const effectivePresentation = partyTrackPresentation(
    entry,
    presentation,
    true,
    party.is_playing,
    buffering,
  );
  const addedBy = addedByLabel(party, entry);
  const hasPrev = party.current_index > 0;
  const hasNext = party.current_index < party.tracks.length - 1;

  return (
    <View testID="party-now-playing" style={styles.nowPlayingCard}>
      <AppText variant="overline" color="accent">{strings.party.nowPlaying}</AppText>
      <View style={styles.nowPlayingBody}>
        <Artwork uri={entry.cover} size={layout.artwork.md} icon="music-note" />
        <View style={styles.rowCopy}>
          <View style={styles.titleIndicatorLine}>
            <AppText variant="bodyStrong" color="accent" numberOfLines={1} style={styles.flexShrinkText}>
              {entry.title}
            </AppText>
            <MemoEqualizerBars
              testID={`party-now-playing-eq-${entry.id}`}
              isPlaying={party.is_playing && !buffering}
            />
            <TrackStateIndicator
              presentation={effectivePresentation}
              copy={trackStateIndicatorCopy}
              testID={`party-now-playing-state-${entry.id}`}
            />
          </View>
          <AppText variant="callout" color="secondary" numberOfLines={1}>
            {addedBy === null ? entry.artist : `${entry.artist} · ${addedBy}`}
          </AppText>
          <PartyLoadBadge entry={entry} buffering={buffering} />
        </View>
      </View>

      {canControl ? (
        <View testID="party-now-playing-controls" style={styles.nowPlayingControls}>
          <IconButton
            testID="party-now-playing-prev"
            icon="skip-previous"
            variant="tonal"
            disabled={locked || !hasPrev}
            accessibilityLabel={strings.common.previousTrack}
            onPress={onPrev}
          />
          <IconButton
            testID="party-now-playing-toggle"
            icon={party.is_playing ? 'pause' : 'play'}
            variant="tonal"
            disabled={locked}
            accessibilityLabel={party.is_playing ? strings.common.pause : strings.common.play}
            onPress={onTogglePlay}
          />
          <IconButton
            testID="party-now-playing-next"
            icon="skip-next"
            variant="tonal"
            disabled={locked || !hasNext}
            accessibilityLabel={strings.common.nextTrack}
            onPress={onNext}
          />
        </View>
      ) : (
        <AppText variant="caption" color="muted">
          {strings.party.controlledByHost(party.host_name)}
        </AppText>
      )}
    </View>
  );
}

export interface PartyQueueRowProps {
  party: PartyState;
  index: number;
  /** This device is buffering the running entry. */
  buffering: boolean;
  locked: boolean;
  /** Optional TrackPresentation from TrackPresentationProvider (explicit downloads + server cache). */
  presentation?: TrackPresentationState;
  onPlay: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

/**
 * One party entry: contributor attribution, standard stored/downloaded icons
 * (`TrackStateIndicator`), transient load status, and role-permitted actions.
 */
export function PartyQueueRow({
  party,
  index,
  buffering,
  locked,
  presentation,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
}: PartyQueueRowProps) {
  const entry = party.tracks[index];
  if (entry === undefined) throw new RangeError(`Party queue row ${index} does not exist`);
  const current = index === party.current_index;
  const canControl = canControlPartyPlayback(party);
  const addedBy = addedByLabel(party, entry);
  const removable = canRemovePartyTrack(party, index);
  const effectivePresentation = partyTrackPresentation(
    entry,
    presentation,
    current,
    party.is_playing,
    current && buffering,
  );
  const body = (
    <>
      <Artwork uri={entry.cover} size={layout.artwork.sm} icon="music-note" />
      <View style={styles.rowCopy}>
        {current ? (
          <AppText variant="overline" color="accent">{strings.party.nowPlaying}</AppText>
        ) : null}
        <View style={styles.titleIndicatorLine}>
          <AppText
            variant="bodyStrong"
            color={current ? 'accent' : 'primary'}
            numberOfLines={1}
            style={styles.flexShrinkText}
          >
            {entry.title}
          </AppText>
          {current ? (
            <MemoEqualizerBars
              testID={`party-track-${entry.id}-equalizer`}
              isPlaying={party.is_playing && !(current && buffering)}
            />
          ) : null}
          <TrackStateIndicator
            presentation={effectivePresentation}
            copy={trackStateIndicatorCopy}
            testID={`party-track-${entry.id}-state`}
          />
        </View>
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
      {canControl ? (
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
      {canControl ? (
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

export interface PartySearchResultRowProps {
  track: Track;
  locked: boolean;
  adding: boolean;
  addingNext?: boolean;
  presentation?: TrackPresentationState;
  onAdd: () => void;
  onPlayNext?: () => void;
}

export function PartySearchResultRow({
  track,
  locked,
  adding,
  addingNext = false,
  presentation,
  onAdd,
  onPlayNext,
}: PartySearchResultRowProps) {
  return (
    <View testID={`party-search-result-${track.id}`} style={styles.row}>
      <View style={styles.rowMain}>
        <Artwork uri={track.cover} size={layout.artwork.sm} icon="music-note" />
        <View style={styles.rowCopy}>
          <View style={styles.titleIndicatorLine}>
            <AppText variant="bodyStrong" numberOfLines={1} style={styles.flexShrinkText}>
              {track.title}
            </AppText>
            {presentation !== undefined ? (
              <TrackStateIndicator
                presentation={presentation}
                copy={trackStateIndicatorCopy}
                testID={`party-search-result-${track.id}-state`}
              />
            ) : null}
          </View>
          <AppText variant="callout" color="secondary" numberOfLines={1}>{track.artist}</AppText>
        </View>
      </View>
      {onPlayNext !== undefined ? (
        <IconButton
          testID={`party-search-result-${track.id}-play-next`}
          icon="playlist-play"
          size="sm"
          accessibilityLabel={strings.party.playNext(track.title)}
          busy={addingNext}
          disabled={locked}
          onPress={onPlayNext}
        />
      ) : null}
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

interface PartyMembersProps {
  members: readonly PartyMember[];
  isHost?: boolean;
  locked?: boolean;
  onKick?: (member: PartyMember) => void;
  onTransferHost?: (member: PartyMember) => void;
}

/** Everyone in the Jam; marks host and guests, and lets the host transfer role or remove participants. */
export function PartyMembers({
  members,
  isHost = false,
  locked = false,
  onKick,
  onTransferHost,
}: PartyMembersProps) {
  return (
    <View testID="party-members" style={styles.members}>
      {members.map((member, index) => {
        const memberIsHost = member.is_host;
        const canKick = isHost && !memberIsHost && member.key !== '' && onKick !== undefined;
        const canTransfer =
          isHost
          && !memberIsHost
          && !member.is_guest
          && member.key !== ''
          && onTransferHost !== undefined;
        return (
          <View key={`${member.key || member.name}-${index}`} style={styles.member}>
            <Artwork uri={member.avatar_url ?? ''} size={layout.artwork.xs} icon="account" />
            <AppText variant="body" numberOfLines={1} style={styles.memberName}>{member.name}</AppText>
            {memberIsHost ? (
              <AppText variant="micro" color="accent" style={styles.memberBadge}>
                {strings.party.hostBadge}
              </AppText>
            ) : null}
            {member.is_guest ? (
              <AppText variant="micro" color="muted" style={styles.memberBadge}>
                {strings.party.guestBadge}
              </AppText>
            ) : null}
            {canTransfer ? (
              <IconButton
                testID={`party-member-transfer-${member.key}`}
                icon="crown-outline"
                size="sm"
                accessibilityLabel={wave2Strings.party2.transferHost(member.name)}
                disabled={locked}
                onPress={() => onTransferHost(member)}
              />
            ) : null}
            {canKick ? (
              <IconButton
                testID={`party-member-kick-${member.key}`}
                icon="account-remove-outline"
                size="sm"
                accessibilityLabel={strings.party.kickMember(member.name)}
                disabled={locked}
                onPress={() => onKick(member)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: layout.pagePadding, paddingTop: spacing.md, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  titleText: { flex: 1, minWidth: 0 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  renameInput: { flex: 1, minWidth: 0 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { flex: 1, minWidth: 0 },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatarRing: {
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.background,
    overflow: 'hidden',
  },
  avatarOverlap: { marginLeft: -8 },
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    minHeight: metrics.minimumTouchTarget,
  },
  toggleRowActive: { borderColor: colors.accentSubtle, backgroundColor: colors.surfaceElevated },
  toggleCopy: { flex: 1, minWidth: 0, gap: 2 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
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
  nowPlayingCard: {
    marginHorizontal: layout.pagePadding,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.accentSubtle,
    gap: spacing.sm,
  },
  nowPlayingBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nowPlayingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: 18 },
  badgeText: { flexShrink: 1 },
  titleIndicatorLine: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  flexShrinkText: { flexShrink: 1, minWidth: 0 },
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
