import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PartyMember, Track } from '../api/types';
import {
  ConnectedPartyNowPlayingCard,
  ConnectedPartyQueueRow,
  ConnectedPartySearchResultRow,
} from '../components/party/ConnectedPartyParts';
import {
  PartyHeader,
  PartyMembers,
  PartyNotice,
} from '../components/party/PartyParts';
import {
  PartyInteractionBar,
  PartySavePlaylistSheet,
} from '../components/party/PartyJam2Controls';
import { PartyKioskModal } from '../components/party/PartyKioskModal';
import { spotifyImportInputStyle } from '../components/search/SpotifyImportForm';
import { ActionButton, AppText, EmptyState, ErrorState, SectionHeader } from '../components/ui';
import { getApiBase, getCurrentApiBase } from '../config';
import { musicRepository } from '../data/repositories';
import { useBackHandler } from '../hooks/useBackHandler';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { wave2Strings } from '../localization/wave2Strings';
import { partyErrorDetail } from '../party/partyErrors';
import {
  canControlPartyPlayback,
  movedPartyIds,
  partyDisplayName,
  partyInviteUrl,
} from '../party/partyModel';
import { partySession, usePartySession } from '../party/partyRuntime';
import { PlaybackState, usePlaybackState } from '../player/player';
import { colors, layout, spacing } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';

const SEARCH_DEBOUNCE_MS = 300;

interface PartySearchState {
  query: string;
  results: Track[];
  loading: boolean;
  error: string | null;
}

/** Debounced song search; only the newest request may update the results. */
function usePartySearch(): [PartySearchState, (query: string) => void] {
  const [state, setState] = useState<PartySearchState>({
    query: '',
    results: [],
    loading: false,
    error: null,
  });
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    controller.current?.abort();
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const search = (query: string) => {
    controller.current?.abort();
    controller.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    const trimmed = query.trim();
    if (trimmed === '') {
      setState({ query, results: [], loading: false, error: null });
      return;
    }
    setState((previous) => ({ ...previous, query, loading: true, error: null }));
    timer.current = setTimeout(() => {
      const request = new AbortController();
      controller.current = request;
      musicRepository.searchTracks(trimmed, request.signal).then(
        (results) => {
          if (controller.current !== request) return;
          setState({ query, results, loading: false, error: null });
        },
        (error: unknown) => {
          if (controller.current !== request) return;
          setState({ query, results: [], loading: false, error: partyErrorDetail(error) });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
  };
  return [state, search];
}

interface PartyScreenProps {
  /** Already validated with normalizePartyCode. */
  code: string;
  onClose: () => void;
}

function PartyBottomSafeSpacer() {
  const insets = useSafeAreaInsets();
  if (insets.bottom <= 0) return null;
  return <View pointerEvents="none" style={{ height: insets.bottom, backgroundColor: colors.background }} />;
}

export default function PartyScreen({ code, onClose }: PartyScreenProps) {
  const session = usePartySession();
  const playbackState = usePlaybackState();
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset({ hasTabBar: false });
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'party', active: isFocused, enabled: tv.isTv });
  const [search, setQuery] = usePartySearch();
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);
  const busy = useRef(false);

  // Android Back clears an active party song search before leaving the party screen.
  useBackHandler(isFocused && search.query.trim() !== '', () => {
    setQuery('');
    return true;
  });

  useEffect(() => {
    if (session.endedNotice !== null) return;
    partySession().enter(code);
  }, [code, session.endedNotice]);

  if (session.endedNotice !== null && session.party === null) {
    return (
      <View testID="party-ended" style={styles.centered}>
        <AppText variant="title" align="center" accessibilityRole="header">
          {strings.party.defaultName}
        </AppText>
        <AppText color="secondary" align="center" accessibilityRole="alert">
          {session.endedNotice}
        </AppText>
        <ActionButton
          testID="party-ended-close"
          label={strings.party.back}
          onPress={() => {
            partySession().dismissEndedNotice();
            onClose();
          }}
        />
      </View>
    );
  }

  if (session.code !== code || session.phase === 'joining' || session.phase === 'idle') {
    return (
      <View testID="party-joining" style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <AppText color="secondary">{strings.party.joining}</AppText>
      </View>
    );
  }
  if (session.phase === 'join-failed') {
    if (session.error === null) throw new Error('A failed party join must carry its cause');
    return (
      <ErrorState
        layout="page"
        testID="party-join-failed"
        retryTestID="party-join-retry"
        title={strings.party.joinFailedTitle}
        message={session.error}
        retryLabel={strings.party.retryJoin}
        onRetry={() => partySession().retryJoin()}
      />
    );
  }
  const party = session.party;
  if (party === null) throw new Error(`Party session in phase ${session.phase} has no party state`);
  const locked = pending !== null || leaving || ending;

  /** Party edits run one at a time; the live stream brings the result back. */
  const run = (key: string, failure: (detail: string) => string, operation: () => Promise<void>, success?: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(key);
    setActionError(null);
    setFeedback(null);
    operation().then(
      () => {
        if (success !== undefined) setFeedback(success);
      },
      (error: unknown) => setActionError(failure(partyErrorDetail(error))),
    ).finally(() => {
      busy.current = false;
      setPending(null);
    });
  };

  const share = () => {
    void (async () => {
      const url = partyInviteUrl(await getApiBase(), party.code);
      await Share.share({ message: strings.party.shareMessage(partyDisplayName(party), url) });
    })().catch((error: unknown) => setActionError(strings.party.shareFailed(partyErrorDetail(error))));
  };

  const leave = () => {
    Alert.alert(
      strings.party.leaveConfirmTitle,
      party.is_host ? strings.party.leaveConfirmHost : strings.party.leaveConfirmMember,
      [
        { text: strings.party.leaveStay, style: 'cancel' },
        {
          text: strings.party.leaveConfirm,
          style: 'destructive',
          onPress: () => {
            if (busy.current) return;
            busy.current = true;
            setLeaving(true);
            setActionError(null);
            partySession().leave().then(
              () => {
                busy.current = false;
                onClose();
              },
              (error: unknown) => {
                busy.current = false;
                setLeaving(false);
                setActionError(strings.party.leaveFailed(partyErrorDetail(error)));
              },
            );
          },
        },
      ],
    );
  };

  const endJam = () => {
    Alert.alert(
      strings.party.endConfirmTitle,
      strings.party.endConfirmBody,
      [
        { text: strings.party.leaveStay, style: 'cancel' },
        {
          text: strings.party.endConfirm,
          style: 'destructive',
          onPress: () => {
            if (busy.current) return;
            busy.current = true;
            setEnding(true);
            setActionError(null);
            partySession().end().then(
              () => {
                busy.current = false;
                onClose();
              },
              (error: unknown) => {
                busy.current = false;
                setEnding(false);
                setActionError(strings.party.endFailed(partyErrorDetail(error)));
              },
            );
          },
        },
      ],
    );
  };

  const kickMember = (member: PartyMember) => {
    Alert.alert(
      strings.party.kickConfirmTitle,
      strings.party.kickConfirmBody(member.name),
      [
        { text: strings.party.leaveStay, style: 'cancel' },
        {
          text: strings.party.kickConfirm,
          style: 'destructive',
          onPress: () =>
            run(
              `kick:${member.key}`,
              (detail) => strings.party.kickFailed(member.name, detail),
              () => partySession().kickMember(member.key),
            ),
        },
      ],
    );
  };

  const transferHost = (member: PartyMember) => {
    Alert.alert(
      wave2Strings.party2.transferHostTitle,
      wave2Strings.party2.transferHostBody(member.name),
      [
        { text: strings.party.leaveStay, style: 'cancel' },
        {
          text: wave2Strings.party2.transferHostConfirm,
          onPress: () =>
            run(
              `transfer:${member.key}`,
              wave2Strings.party2.transferHostFailed,
              async () => {
                if (!musicRepository.transferPartyHost) {
                  throw new Error('Host transfer endpoint unavailable');
                }
                await musicRepository.transferPartyHost(party.code, member.key);
              },
            ),
        },
      ],
    );
  };

  const handleSaveAsPlaylist = (playlistName: string, collaborative: boolean) => {
    setSaveSheetOpen(false);
    run(
      'save-playlist',
      wave2Strings.party2.savePlaylistFailed,
      async () => {
        if (!musicRepository.savePartyAsPlaylist) {
          throw new Error('Save Jam as Playlist endpoint unavailable');
        }
        await musicRepository.savePartyAsPlaylist(party.code, {
          name: playlistName,
          collaborative,
        });
      },
      wave2Strings.party2.savedPlaylist(playlistName),
    );
  };

  const handleVoteSkip = () => {
    run(
      'vote-skip',
      wave2Strings.party2.voteSkipFailed,
      async () => {
        if (!musicRepository.voteSkipPartyTrack) {
          throw new Error('Vote skip endpoint unavailable');
        }
        const result = await musicRepository.voteSkipPartyTrack(party.code);
        if (result.skipped) {
          setFeedback(wave2Strings.party2.voteSkipTriggered);
        }
      },
    );
  };

  const handleReact = (emoji: string) => {
    void (async () => {
      try {
        if (!musicRepository.reactInParty) {
          throw new Error('Party react endpoint unavailable');
        }
        await musicRepository.reactInParty(party.code, emoji);
      } catch (error: unknown) {
        setActionError(wave2Strings.party2.reactFailed(partyErrorDetail(error)));
      }
    })();
  };

  const reload = () => {
    setReloading(true);
    partySession().reload().catch(() => {
      // The session publishes the failure as the stale notice.
    }).finally(() => setReloading(false));
  };

  const ids = party.tracks.map((entry) => entry.id);
  const buffering = playbackState === PlaybackState.Buffering && !session.detached && !session.controlOnly;
  const hasCurrent = party.current_index >= 0 && party.tracks[party.current_index] !== undefined;
  const indexedTracks = party.tracks.map((entry, index) => ({ entry, index }));
  const upcomingEntries = hasCurrent
    ? indexedTracks.filter(({ index }) => index > party.current_index)
    : indexedTracks;
  const historyEntries = hasCurrent
    ? indexedTracks.filter(({ index }) => index < party.current_index)
    : [];
  const sharedControl = canControlPartyPlayback(party);

  const renderQueueRow = (entryId: number, index: number, title: string) => (
    <ConnectedPartyQueueRow
      key={entryId}
      party={party}
      index={index}
      buffering={buffering}
      locked={locked}
      onPlay={() =>
        run(
          `play:${entryId}`,
          (detail) => strings.party.playFailed(title, detail),
          () => musicRepository.partySetCurrent(party.code, index),
        )
      }
      onMoveUp={() =>
        run(
          `move:${entryId}`,
          (detail) => strings.party.moveFailed(title, detail),
          () => musicRepository.partyReorder(party.code, movedPartyIds(ids, index, index - 1)),
        )
      }
      onMoveDown={() =>
        run(
          `move:${entryId}`,
          (detail) => strings.party.moveFailed(title, detail),
          () => musicRepository.partyReorder(party.code, movedPartyIds(ids, index, index + 1)),
        )
      }
      onRemove={() =>
        run(
          `remove:${entryId}`,
          (detail) => strings.party.removeFailed(title, detail),
          () => musicRepository.partyRemoveTrack(party.code, entryId),
        )
      }
    />
  );

  const headerAndNotices = (
    <>
      <PartyHeader
        party={party}
        phase={session.phase}
        leaving={leaving}
        ending={ending}
        locked={locked}
        controlOnly={session.controlOnly}
        onShare={share}
        onLeave={leave}
        onEnd={party.is_host ? endJam : undefined}
        onRename={
          party.is_host
            ? (nextName) =>
                run(
                  'rename',
                  strings.party.renameFailed,
                  async () => {
                    await partySession().updateSettings({ name: nextName });
                  },
                )
            : undefined
        }
        onToggleGuestsCanControl={
          party.is_host
            ? (enabled) =>
                run(
                  'guests-control',
                  strings.party.settingsFailed,
                  async () => {
                    await partySession().updateSettings({ guests_can_control: enabled });
                  },
                )
            : undefined
        }
        onToggleAutoDj={
          party.is_host
            ? (enabled) =>
                run(
                  'auto-dj',
                  strings.party.settingsFailed,
                  async () => {
                    await partySession().updateSettings({ auto_dj: enabled });
                  },
                )
            : undefined
        }
        onFillAutoDj={
          party.is_host
            ? () =>
                run(
                  'fill-auto-dj',
                  wave2Strings.party2.fillAutoDjFailed,
                  async () => {
                    if (!musicRepository.fillPartyAutoDj) {
                      throw new Error('Auto-DJ fill endpoint unavailable');
                    }
                    await musicRepository.fillPartyAutoDj(party.code, 5);
                  },
                )
            : undefined
        }
        fillingAutoDj={pending === 'fill-auto-dj'}
        onSaveAsPlaylist={() => setSaveSheetOpen(true)}
        onOpenKiosk={() => setKioskOpen(true)}
        onToggleControlOnly={
          !party.is_host
            ? (enabled) => partySession().setControlOnly(enabled)
            : undefined
        }
      />
      {session.phase === 'stale' && session.error !== null ? (
        <PartyNotice
          testID="party-stale"
          tone="danger"
          message={session.error}
          actionLabel={strings.party.reload}
          actionBusy={reloading}
          onAction={reload}
        />
      ) : null}
      {session.detached ? (
        <PartyNotice
          testID="party-detached"
          tone="info"
          title={strings.party.detachedTitle}
          message={strings.party.detachedBody}
          actionLabel={strings.party.rejoinPlayback}
          onAction={() => partySession().rejoinPlayback()}
        />
      ) : null}
      {session.playbackError !== null ? (
        <PartyNotice testID="party-playback-error" tone="danger" message={session.playbackError} />
      ) : null}
      {actionError !== null ? (
        <PartyNotice testID="party-action-error" tone="danger" message={actionError} />
      ) : null}
      {feedback !== null ? (
        <PartyNotice testID="party-feedback" tone="info" message={feedback} />
      ) : null}
      {!party.is_host && !session.detached && !session.controlOnly ? (
        <PartyNotice
          testID="party-follow-hint"
          tone="info"
          message={sharedControl ? strings.party.sharedControlHint : strings.party.followHint}
        />
      ) : null}
    </>
  );

  const nowPlayingSection = hasCurrent ? (
    <ConnectedPartyNowPlayingCard
      party={party}
      buffering={buffering}
      locked={locked}
      onPrev={() =>
        run(
          'control:prev',
          strings.party.playbackControlFailed,
          () => partySession().controlPrev(),
        )
      }
      onTogglePlay={() =>
        run(
          'control:toggle',
          strings.party.playbackControlFailed,
          () => partySession().controlTogglePlay(),
        )
      }
      onNext={() =>
        run(
          'control:next',
          strings.party.playbackControlFailed,
          () => partySession().controlNext(),
        )
      }
    />
  ) : null;

  const queueSection = (
    <View style={styles.section}>
      {nowPlayingSection}
      <PartyInteractionBar
        party={party}
        locked={locked}
        votingSkip={pending === 'vote-skip'}
        onVoteSkip={handleVoteSkip}
        onReact={handleReact}
      />
      <View style={[styles.sectionHeader, hasCurrent ? styles.upNextHeader : null]}>
        <SectionHeader
          title={hasCurrent ? strings.party.upNextTitle : strings.party.queueTitle}
          padded={false}
        />
      </View>
      {party.tracks.length === 0 ? (
        <EmptyState
          testID="party-queue-empty"
          layout="inline"
          icon="playlist-music"
          title={strings.party.queueEmpty}
        />
      ) : (
        <>
          {upcomingEntries.map(({ entry, index }) => renderQueueRow(entry.id, index, entry.title))}
          {historyEntries.length > 0 ? (
            <View style={styles.historyBlock}>
              <View style={styles.sectionHeader}>
                <SectionHeader title={strings.party.playedEarlierTitle} padded={false} />
              </View>
              {historyEntries.map(({ entry, index }) => renderQueueRow(entry.id, index, entry.title))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  const searchSection = (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <SectionHeader title={strings.party.searchLabel} padded={false} />
      </View>
      <TextInput
        testID="party-search-input"
        accessibilityLabel={strings.party.searchLabel}
        value={search.query}
        onChangeText={setQuery}
        placeholder={strings.party.searchPlaceholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        autoCorrect={false}
        returnKeyType="search"
        maxLength={200}
        style={[spotifyImportInputStyle, styles.searchInput]}
      />
      {search.loading ? (
        <View testID="party-search-loading" style={styles.inlineStatus}>
          <ActivityIndicator color={colors.accent} />
          <AppText variant="callout" color="secondary">{strings.party.searching}</AppText>
        </View>
      ) : null}
      {search.error !== null ? (
        <PartyNotice
          testID="party-search-error"
          tone="danger"
          message={strings.party.searchFailed(search.error)}
          actionLabel={strings.party.reload}
          onAction={() => setQuery(search.query)}
        />
      ) : null}
      {!search.loading && search.error === null && search.query.trim() !== '' && search.results.length === 0 ? (
        <AppText testID="party-search-empty" variant="callout" color="secondary" style={styles.inlineStatus}>
          {strings.party.searchEmpty(search.query.trim())}
        </AppText>
      ) : null}
      {search.results.map((track) => (
        <ConnectedPartySearchResultRow
          key={track.id}
          track={track}
          locked={locked}
          adding={pending === `add:${track.id}`}
          addingNext={pending === `next:${track.id}`}
          onPlayNext={() =>
            run(
              `next:${track.id}`,
              (detail) => strings.party.playNextFailed(track.title, detail),
              () => musicRepository.partyAddTrack(party.code, track, 'next'),
              strings.party.playNextAdded(track.title),
            )
          }
          onAdd={() =>
            run(
              `add:${track.id}`,
              (detail) => strings.party.addFailed(track.title, detail),
              () => musicRepository.partyAddTrack(party.code, track, 'end'),
              strings.party.added(track.title),
            )
          }
        />
      ))}
    </View>
  );

  const membersSection = (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <SectionHeader title={strings.party.membersTitle} padded={false} />
      </View>
      <PartyMembers
        members={party.members}
        isHost={party.is_host}
        locked={locked}
        onKick={party.is_host ? kickMember : undefined}
        onTransferHost={party.is_host ? transferHost : undefined}
      />
    </View>
  );

  const modals = (
    <>
      <PartySavePlaylistSheet
        visible={saveSheetOpen}
        party={party}
        saving={pending === 'save-playlist'}
        onClose={() => setSaveSheetOpen(false)}
        onSave={handleSaveAsPlaylist}
      />
      <PartyKioskModal
        visible={kioskOpen}
        party={party}
        joinUrl={partyInviteUrl(getCurrentApiBase(), party.code)}
        onClose={() => setKioskOpen(false)}
      />
    </>
  );

  if (tv.isTv) {
    const leftWidth = Math.round(tv.contentWidth * tv.splitPrimaryRatio);
    return (
      <TvFocusScope scope="party">
        <View
          testID="party-screen"
          style={[
            styles.screen,
            styles.tvSplit,
            { gap: tv.gridGap },
          ]}
        >
          <ScrollView
            testID="party-tv-left-pane"
            showsVerticalScrollIndicator={false}
            style={{ width: leftWidth, flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{ paddingBottom: bottomInset }}
            keyboardShouldPersistTaps="handled"
          >
            {headerAndNotices}
            {searchSection}
            {membersSection}
          </ScrollView>
          <ScrollView
            testID="party-tv-queue-pane"
            showsVerticalScrollIndicator={false}
            style={styles.tvQueuePane}
            contentContainerStyle={{ paddingBottom: bottomInset }}
            keyboardShouldPersistTaps="handled"
          >
            {queueSection}
          </ScrollView>
        </View>
        {modals}
      </TvFocusScope>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        testID="party-screen"
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        keyboardShouldPersistTaps="handled"
      >
        {headerAndNotices}
        {queueSection}
        {searchSection}
        {membersSection}
      </ScrollView>
      <PartyBottomSafeSpacer />
      {modals}
    </View>
  );
}

/** A party link whose code cannot be valid. */
export function InvalidPartyLink({ onClose }: { onClose: () => void }) {
  return (
    <View testID="party-invalid-link" style={styles.centered}>
      <AppText variant="title" align="center" accessibilityRole="header">
        {strings.party.invalidCodeTitle}
      </AppText>
      <AppText color="secondary" align="center" accessibilityRole="alert">
        {strings.party.invalidCodeBody}
      </AppText>
      <ActionButton testID="party-invalid-link-back" label={strings.party.back} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  section: { paddingTop: layout.sectionGap },
  upNextHeader: { paddingTop: layout.stackGap },
  historyBlock: { paddingTop: layout.stackGap },
  sectionHeader: { paddingHorizontal: layout.pagePadding, paddingBottom: layout.headerGap },
  searchInput: { marginHorizontal: layout.pagePadding },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.md,
  },
  tvSplit: { flexDirection: 'row', alignItems: 'stretch' },
  tvQueuePane: { flex: 1, minWidth: 0 },
});
