import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import type { Track } from '../api/types';
import {
  PartyHeader,
  PartyListenChoice,
  PartyMembers,
  PartyNotice,
  PartyQueueRow,
  PartySearchResultRow,
} from '../components/party/PartyParts';
import { spotifyImportInputStyle } from '../components/search/SpotifyImportForm';
import { ActionButton, AppText, EmptyState, ErrorState, SectionHeader } from '../components/ui';
import { getApiBase } from '../config';
import { musicRepository } from '../data/repositories';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { partyErrorDetail } from '../party/partyErrors';
import { movedPartyIds, partyDisplayName, partyInviteUrl } from '../party/partyModel';
import { partySession, usePartySession } from '../party/partyRuntime';
import { PlaybackState, usePlaybackState } from '../player/player';
import { colors, layout, spacing } from '../theme';

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

export default function PartyScreen({ code, onClose }: PartyScreenProps) {
  const session = usePartySession();
  const playbackState = usePlaybackState();
  const bottomInset = useBottomInset({ hasTabBar: false });
  const [search, setQuery] = usePartySearch();
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    partySession().enter(code);
  }, [code]);

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
  const locked = pending !== null || leaving;

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

  const reload = () => {
    setReloading(true);
    partySession().reload().catch(() => {
      // The session publishes the failure as the stale notice.
    }).finally(() => setReloading(false));
  };

  const ids = party.tracks.map((entry) => entry.id);
  // Only a device that plays the party buffers it.
  const buffering =
    playbackState === PlaybackState.Buffering && !session.detached && session.listenMode === 'device';

  const changeListenMode = (mode: 'device' | 'host') => {
    setActionError(null);
    try {
      partySession().setListenMode(mode);
    } catch (error) {
      setActionError(strings.party.listenSwitchFailed(partyErrorDetail(error)));
    }
  };

  return (
    <ScrollView
      testID="party-screen"
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
    >
      <PartyHeader
        party={party}
        phase={session.phase}
        leaving={leaving}
        locked={locked}
        onShare={share}
        onLeave={leave}
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
      {!party.is_host && !session.detached ? (
        <PartyListenChoice
          hostName={party.host_name}
          mode={session.listenMode}
          onChange={changeListenMode}
        />
      ) : null}

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
          <PartySearchResultRow
            key={track.id}
            track={track}
            locked={locked}
            adding={pending === `add:${track.id}`}
            onAdd={() =>
              run(
                `add:${track.id}`,
                (detail) => strings.party.addFailed(track.title, detail),
                () => musicRepository.partyAddTrack(party.code, track),
                strings.party.added(track.title),
              )
            }
          />
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <SectionHeader title={strings.party.queueTitle} padded={false} />
        </View>
        {party.tracks.length === 0 ? (
          <EmptyState
            testID="party-queue-empty"
            layout="inline"
            icon="playlist-music"
            title={strings.party.queueEmpty}
          />
        ) : (
          party.tracks.map((entry, index) => (
            <PartyQueueRow
              key={entry.id}
              party={party}
              index={index}
              buffering={buffering}
              locked={locked}
              onPlay={() =>
                run(
                  `play:${entry.id}`,
                  (detail) => strings.party.playFailed(entry.title, detail),
                  () => musicRepository.partySetCurrent(party.code, index),
                )
              }
              onMoveUp={() =>
                run(
                  `move:${entry.id}`,
                  (detail) => strings.party.moveFailed(entry.title, detail),
                  () => musicRepository.partyReorder(party.code, movedPartyIds(ids, index, index - 1)),
                )
              }
              onMoveDown={() =>
                run(
                  `move:${entry.id}`,
                  (detail) => strings.party.moveFailed(entry.title, detail),
                  () => musicRepository.partyReorder(party.code, movedPartyIds(ids, index, index + 1)),
                )
              }
              onRemove={() =>
                run(
                  `remove:${entry.id}`,
                  (detail) => strings.party.removeFailed(entry.title, detail),
                  () => musicRepository.partyRemoveTrack(party.code, entry.id),
                )
              }
            />
          ))
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <SectionHeader title={strings.party.membersTitle} padded={false} />
        </View>
        <PartyMembers members={party.members} hostName={party.host_name} />
      </View>
    </ScrollView>
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
  sectionHeader: { paddingHorizontal: layout.pagePadding, paddingBottom: layout.headerGap },
  searchInput: { marginHorizontal: layout.pagePadding },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.md,
  },
});
