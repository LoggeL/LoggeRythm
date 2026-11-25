import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  getGuestPartyState,
  guestAddPartyTrack,
  guestLeaveParty,
  guestSearchTracks,
  joinPartyAsGuest,
  type GuestPartySession,
} from '../../api/guestParty';
import { trackArtistLabel } from '../../api/trackArtists';
import type { PartyState, Track } from '../../api/types';
import { normalizeSignInApiBase } from '../../config';
import { strings } from '../../localization';
import { normalizePartyCode } from '../../party/partyCode';
import { partyErrorDetail } from '../../party/partyErrors';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';
import { ActionButton, AppText, Artwork, IconButton } from '../ui';

export interface GuestJamEntryProps {
  serverUrl: string;
  disabled?: boolean;
}

const SEARCH_DEBOUNCE_MS = 280;

/**
 * Signed-out Guest Jam entry & lightweight remote queue controller for mobile
 * and Android TV. Guests join with a 6-character code and nickname, inspect
 * the live Jam queue, and search + add tracks without creating an account.
 */
export function GuestJamEntry({ serverUrl, disabled = false }: GuestJamEntryProps) {
  const [open, setOpen] = useState(false);
  const [boundServerUrl, setBoundServerUrl] = useState(serverUrl);
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<GuestPartySession | null>(null);
  const [party, setParty] = useState<PartyState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);

  if (boundServerUrl !== serverUrl) {
    setBoundServerUrl(serverUrl);
    if (session !== null || party !== null) {
      setSession(null);
      setParty(null);
      setSearchQuery('');
      setResults([]);
      setError(null);
    }
  }

  const applyPartyState = (latest: PartyState, activeSession: GuestPartySession) => {
    if (latest.ended) {
      setSession(null);
      setParty(null);
      setSearchQuery('');
      setResults([]);
      setError(strings.party.endedNotice);
      return;
    }
    setSession(activeSession);
    setParty(latest);
  };

  const handleSearchQueryChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!open || session === null) return undefined;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void guestSearchTracks(session.origin, trimmed, controller.signal)
        .then((tracks) => {
          if (!controller.signal.aborted) setResults(tracks.slice(0, 12));
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(strings.party.searchFailed(partyErrorDetail(cause)));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, searchQuery, session]);

  const handleJoin = async () => {
    if (joining) return;
    setError(null);
    const normalizedCode = normalizePartyCode(code);
    if (normalizedCode === null) {
      setError(strings.party.joinInvalidCode);
      return;
    }
    const trimmedNickname = nickname.trim();
    if (trimmedNickname.length === 0) {
      setError(strings.party.guestNicknameRequired);
      return;
    }
    let normalizedServer: string;
    try {
      normalizedServer = normalizeSignInApiBase(serverUrl);
    } catch {
      setError(strings.auth.serverInvalid);
      return;
    }
    setJoining(true);
    try {
      const joined = await joinPartyAsGuest(normalizedCode, trimmedNickname, normalizedServer);
      setSearchQuery('');
      setResults([]);
      applyPartyState(joined.state, joined.session);
    } catch (cause) {
      setError(strings.party.joinFailed(partyErrorDetail(cause)));
    } finally {
      setJoining(false);
    }
  };

  const handleRefresh = async () => {
    if (session === null || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const latest = await getGuestPartyState(session);
      applyPartyState(latest, session);
    } catch (cause) {
      setError(strings.party.loadFailed(partyErrorDetail(cause)));
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddTrack = async (track: Track) => {
    if (session === null || addingTrackId !== null) return;
    setAddingTrackId(track.id);
    setError(null);
    try {
      await guestAddPartyTrack(session, track);
      AccessibilityInfo.announceForAccessibility(strings.party.added(track.title));
      const latest = await getGuestPartyState(session);
      applyPartyState(latest, session);
    } catch (cause) {
      setError(strings.party.addFailed(track.title, partyErrorDetail(cause)));
    } finally {
      setAddingTrackId(null);
    }
  };

  const handleLeave = async () => {
    if (session === null) {
      setOpen(false);
      return;
    }
    if (leaving) return;
    setLeaving(true);
    setError(null);
    try {
      await guestLeaveParty(session);
      setSession(null);
      setParty(null);
      setSearchQuery('');
      setResults([]);
      setOpen(false);
    } catch (cause) {
      setError(strings.party.leaveFailed(partyErrorDetail(cause)));
    } finally {
      setLeaving(false);
    }
  };

  const closeModal = () => {
    if (joining || leaving) return;
    setOpen(false);
  };

  return (
    <>
      <ActionButton
        testID="login-guest-jam"
        label={strings.party.guestJoinButton}
        icon="account-group-outline"
        variant="secondary"
        fullWidth
        disabled={disabled}
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
      />

      <Modal
        testID="guest-jam-modal"
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <AppText accessibilityRole="header" variant="section" numberOfLines={1}>
                  {party !== null
                    ? (party.name || strings.party.defaultName)
                    : strings.party.guestJoinTitle}
                </AppText>
                <AppText variant="caption" color="secondary" numberOfLines={1}>
                  {party !== null
                    ? `${party.code} · ${strings.party.memberCount(party.members.length)}`
                    : strings.party.guestJoinSubtitle}
                </AppText>
              </View>
              {party !== null ? (
                <IconButton
                  testID="guest-jam-refresh"
                  icon="refresh"
                  variant="tonal"
                  busy={refreshing}
                  disabled={refreshing}
                  accessibilityLabel={strings.party.reload}
                  onPress={() => void handleRefresh()}
                />
              ) : null}
              <IconButton
                testID="guest-jam-close"
                icon="close"
                variant="tonal"
                disabled={joining || leaving}
                accessibilityLabel={strings.common.dismiss}
                onPress={closeModal}
              />
            </View>

            {error !== null ? (
              <AppText
                testID="guest-jam-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                variant="callout"
                color="danger"
              >
                {error}
              </AppText>
            ) : null}

            {session === null || party === null ? (
              <View style={styles.form}>
                <View style={styles.field}>
                  <AppText variant="label" color="secondary">
                    {strings.party.joinCodeLabel}
                  </AppText>
                  <TextInput
                    testID="guest-jam-code-input"
                    accessibilityLabel={strings.party.joinCodeLabel}
                    placeholder={strings.party.joinCodePlaceholder}
                    placeholderTextColor={colors.textMuted}
                    selectionColor={colors.accent}
                    value={code}
                    onChangeText={(value) => setCode(value.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={6}
                    editable={!joining}
                    returnKeyType="next"
                    style={styles.input}
                  />
                </View>

                <View style={styles.field}>
                  <AppText variant="label" color="secondary">
                    {strings.party.guestNicknameLabel}
                  </AppText>
                  <TextInput
                    testID="guest-jam-nickname-input"
                    accessibilityLabel={strings.party.guestNicknameLabel}
                    placeholder={strings.party.guestNicknamePlaceholder}
                    placeholderTextColor={colors.textMuted}
                    selectionColor={colors.accent}
                    value={nickname}
                    onChangeText={setNickname}
                    maxLength={40}
                    editable={!joining}
                    returnKeyType="done"
                    onSubmitEditing={() => void handleJoin()}
                    style={styles.input}
                  />
                </View>

                <ActionButton
                  testID="guest-jam-submit"
                  label={joining ? strings.party.guestJoining : strings.party.joinSubmit}
                  icon="login"
                  variant="primary"
                  fullWidth
                  busy={joining}
                  disabled={joining}
                  onPress={() => void handleJoin()}
                />
              </View>
            ) : (
              <ScrollView
                testID="guest-jam-body"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={styles.scroll}
                contentContainerStyle={styles.body}
              >
                <TextInput
                  testID="guest-jam-search-input"
                  accessibilityLabel={strings.party.searchLabel}
                  placeholder={strings.party.searchPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  selectionColor={colors.accent}
                  value={searchQuery}
                  onChangeText={handleSearchQueryChange}
                  returnKeyType="search"
                  style={styles.input}
                />

                {searching ? (
                  <View style={styles.loading}>
                    <ActivityIndicator color={colors.accent} size="small" />
                  </View>
                ) : null}

                {results.length > 0 ? (
                  <View testID="guest-jam-search-results" style={styles.section}>
                    {results.map((track) => (
                      <View
                        key={track.id}
                        testID={`guest-jam-result-${track.id}`}
                        style={styles.trackRow}
                      >
                        <Artwork uri={track.cover} size={layout.artwork.sm} icon="music-note" />
                        <View style={styles.trackCopy}>
                          <AppText variant="bodyStrong" numberOfLines={1}>{track.title}</AppText>
                          <AppText variant="caption" color="secondary" numberOfLines={1}>
                            {trackArtistLabel(track)}
                          </AppText>
                        </View>
                        <IconButton
                          testID={`guest-jam-add-${track.id}`}
                          icon="plus"
                          variant="tonal"
                          busy={addingTrackId === track.id}
                          disabled={addingTrackId !== null}
                          accessibilityLabel={strings.party.add(track.title)}
                          onPress={() => void handleAddTrack(track)}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}

                <View testID="guest-jam-queue" style={styles.section}>
                  <AppText variant="overline" color="muted">
                    {strings.party.queueTitle}
                  </AppText>
                  {party.tracks.length === 0 ? (
                    <AppText variant="callout" color="secondary">
                      {strings.party.queueEmpty}
                    </AppText>
                  ) : (
                    party.tracks.map((item, index) => (
                      <View
                        key={item.id}
                        testID={`guest-jam-queue-${item.id}`}
                        style={styles.trackRow}
                      >
                        <Artwork uri={item.cover} size={layout.artwork.xs} icon="music-note" />
                        <View style={styles.trackCopy}>
                          <AppText
                            variant="bodyStrong"
                            color={index === party.current_index ? 'accent' : 'primary'}
                            numberOfLines={1}
                          >
                            {item.title}
                          </AppText>
                          <AppText variant="caption" color="secondary" numberOfLines={1}>
                            {`${trackArtistLabel(item)} · ${strings.party.addedBy(item.added_by)}`}
                          </AppText>
                        </View>
                      </View>
                    ))
                  )}
                </View>

                <ActionButton
                  testID="guest-jam-leave"
                  label={leaving ? strings.party.leaving : strings.party.guestLeave}
                  icon="logout"
                  variant="danger"
                  fullWidth
                  busy={leaving}
                  disabled={leaving}
                  onPress={() => void handleLeave()}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.scrim,
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  form: { gap: spacing.md },
  field: { gap: spacing.xs },
  input: {
    ...typography.body,
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  scroll: { flexGrow: 0 },
  body: { gap: spacing.md, paddingBottom: spacing.md },
  loading: { paddingVertical: spacing.xs, alignItems: 'center' },
  section: { gap: spacing.xs },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: metrics.minimumTouchTarget,
  },
  trackCopy: { flex: 1, minWidth: 0 },
});
