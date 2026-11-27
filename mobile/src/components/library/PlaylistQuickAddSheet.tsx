import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { QueryObserver, useQueryClient } from '@tanstack/react-query';
import { isRateLimitStatus, rateLimitRetryAfterSeconds } from '../../api/error';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import {
  invalidatePlaylistCaches,
  isRemoteOffline,
  musicQueries,
  musicRepository,
  optimisticallyAddPlaylistTrack,
  restorePlaylistCache,
} from '../../data';
import { strings } from '../../localization';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';
import { AppText, Artwork, BottomSheet, IconButton } from '../ui';
import { refreshAutoBrowse } from './autoBrowse';
import { InlineNotice } from './InlineNotice';
import { useKeyboardInset } from './useKeyboardInset';

export interface PlaylistQuickAddSheetProps {
  visible: boolean;
  playlistId: number;
  scope: string;
  existingTrackIds: ReadonlySet<string>;
  onClose: () => void;
}

export const QUICK_ADD_SEARCH_DEBOUNCE_MS = 280;
const MIN_QUERY_CHARS = 2;

export function formatQuickAddSearchError(cause: unknown): string {
  if (isRemoteOffline(cause, 'idle')) {
    return libraryStrings.common.offline;
  }
  if (isRateLimitStatus(cause)) {
    const waitSec = rateLimitRetryAfterSeconds(cause);
    return waitSec !== null
      ? strings.search.rateLimitedWait(waitSec)
      : strings.search.rateLimited;
  }
  return libraryStrings.common.loadFailed;
}

/**
 * Inline Quick-Add bottom sheet for editable playlists: search catalog tracks
 * and add them in one tap without leaving the playlist screen.
 */
export function PlaylistQuickAddSheet({
  visible,
  playlistId,
  scope,
  existingTrackIds,
  onClose,
}: PlaylistQuickAddSheetProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  const handledRetryNonceRef = useRef(0);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const trimmedQuery = query.trim();
  const searchable = Array.from(trimmedQuery).length >= MIN_QUERY_CHARS;

  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible && searching) {
      setSearching(false);
    }
  }

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (Array.from(value.trim()).length < MIN_QUERY_CHARS) {
      setResults([]);
      setSearching(false);
      setError(null);
      setErrorRetryable(false);
    }
  };

  useEffect(() => {
    if (!visible || !searchable) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const forceRefresh = retryNonce !== handledRetryNonceRef.current;
    handledRetryNonceRef.current = retryNonce;
    const delayMs = forceRefresh ? 0 : QUICK_ADD_SEARCH_DEBOUNCE_MS;
    const baseOptions = musicQueries.searchTracks(scope, trimmedQuery);
    const options = forceRefresh ? { ...baseOptions, staleTime: 0 } : baseOptions;
    const runSearch = () => {
      if (cancelled) return;
      setSearching(true);
      setError(null);
      setErrorRetryable(false);
      const observer = new QueryObserver(queryClient, options);
      const handleResult = (result: ReturnType<typeof observer.getCurrentResult>) => {
        if (cancelled || result.fetchStatus === 'fetching') return;
        if (result.status === 'success') {
          setResults(result.data.slice(0, 20));
          setError(null);
          setErrorRetryable(false);
          setSearching(false);
        } else if (result.status === 'error') {
          setResults([]);
          setError(formatQuickAddSearchError(result.error));
          setErrorRetryable(true);
          setSearching(false);
        }
      };
      unsubscribe = observer.subscribe(handleResult);
      if (forceRefresh) {
        void observer.refetch({ cancelRefetch: false }).catch(() => undefined);
      } else {
        handleResult(observer.getCurrentResult());
      }
    };
    const timer = delayMs === 0 ? null : setTimeout(runSearch, delayMs);
    if (timer === null) runSearch();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [queryClient, retryNonce, scope, searchable, trimmedQuery, visible]);

  // The field is focused on open and the keyboard does not resize the sheet:
  // without the spacer it covers the field and the results.
  const keyboardInset = useKeyboardInset();

  const handleAdd = async (track: Track) => {
    if (addingId !== null) return;
    // A row that already shows the check mark must not add the song again.
    if (existingTrackIds.has(track.id) || addedIds.has(track.id)) return;
    setAddingId(track.id);
    setError(null);
    setErrorRetryable(false);
    const snapshot = await optimisticallyAddPlaylistTrack(queryClient, scope, playlistId, track);
    try {
      await musicRepository.addToPlaylist(playlistId, track);
      setAddedIds((current) => {
        const next = new Set(current);
        next.add(track.id);
        return next;
      });
      AccessibilityInfo.announceForAccessibility(
        libraryStrings.playlist.quickAddAdded(track.title),
      );
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, playlistId),
        refreshAutoBrowse(),
      ]);
    } catch (cause) {
      console.error('[LoggeRythm] Quick-add to playlist failed:', cause);
      restorePlaylistCache(queryClient, scope, playlistId, snapshot);
      setError(libraryStrings.playlist.quickAddFailed);
      setErrorRetryable(false);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel={libraryStrings.common.dismiss}
      testID="playlist-quick-add-sheet"
      contentStyle={styles.sheet}
    >
      <View style={styles.header}>
        <AppText accessibilityRole="header" variant="section" numberOfLines={1} style={styles.title}>
          {libraryStrings.playlist.quickAddTitle}
        </AppText>
        <IconButton
          testID="playlist-quick-add-close"
          icon="close"
          variant="tonal"
          accessibilityLabel={libraryStrings.common.dismiss}
          onPress={onClose}
        />
      </View>

      <TextInput
        testID="playlist-quick-add-input"
        accessibilityLabel={libraryStrings.playlist.quickAddTitle}
        placeholder={libraryStrings.playlist.quickAddPlaceholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        value={query}
        onChangeText={handleQueryChange}
        autoFocus={visible}
        returnKeyType="search"
        style={styles.input}
      />

      {error !== null ? (
        <InlineNotice
          testID="playlist-quick-add-error"
          tone="danger"
          live="assertive"
          message={error}
          retry={
            errorRetryable && searchable
              ? {
                  testID: 'playlist-quick-add-retry',
                  busy: searching,
                  onRetry: () => setRetryNonce((value) => value + 1),
                }
              : undefined
          }
        />
      ) : null}

      {searching ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="small" />
        </View>
      ) : null}

      <ScrollView
        testID="playlist-quick-add-results"
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={styles.list}
      >
        {results.map((track) => {
          const alreadyAdded = existingTrackIds.has(track.id) || addedIds.has(track.id);
          const busy = addingId === track.id;
          return (
            <View key={track.id} testID={`playlist-quick-add-row-${track.id}`} style={styles.row}>
              <Artwork uri={track.cover} size={layout.artwork.sm} icon="music-note" />
              <View style={styles.rowCopy}>
                <AppText variant="bodyStrong" numberOfLines={1}>{track.title}</AppText>
                <AppText variant="caption" color="secondary" numberOfLines={1}>
                  {trackArtistLabel(track)}
                </AppText>
              </View>
              {/* An icon, not a labelled pill: the label took most of the row and
                  left the song title a few characters. */}
              <IconButton
                testID={`playlist-quick-add-btn-${track.id}`}
                variant={alreadyAdded ? 'plain' : 'tonal'}
                icon={alreadyAdded ? 'check' : 'plus'}
                color={alreadyAdded ? colors.accent : undefined}
                accessibilityLabel={
                  alreadyAdded
                    ? `${libraryStrings.playlist.quickAddInPlaylist}: ${track.title}`
                    : `${libraryStrings.playlist.quickAdd}: ${track.title}`
                }
                busy={busy}
                disabled={addingId !== null || alreadyAdded}
                onPress={() => void handleAdd(track)}
              />
            </View>
          );
        })}
      </ScrollView>
      <View testID="playlist-quick-add-keyboard-spacer" style={{ height: keyboardInset }} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  input: {
    ...typography.body,
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
  },
  loading: { paddingVertical: spacing.sm, alignItems: 'center' },
  scroll: { maxHeight: 360 },
  list: { gap: spacing.xs, paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.rowHeight,
  },
  rowCopy: { flex: 1, minWidth: 0 },
});
