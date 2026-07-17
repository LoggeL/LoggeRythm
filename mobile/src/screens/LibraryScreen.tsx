import React, { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { LibraryRecentRow } from '../components/library/LibraryRecentRow';
import {
  LibraryVirtualizedList,
  type LibraryListItem,
  type LibrarySectionPresentations,
} from '../components/library/LibraryVirtualizedList';
import type { RecentPlay } from '../domain/listeningStats';
import {
  LIBRARY_POLICY_SECTION_STATE,
  libraryQuerySectionState,
  refreshLibraryQueries,
} from '../components/library/librarySectionState';
import StandardTrackRow from '../components/track/StandardTrackRow';
import AppIcon from '../components/AppIcon';
import { showTrackActions } from '../components/trackActions';
import { getCurrentApiBase } from '../config';
import {
  musicCacheScope,
  musicMutations,
  musicQueries,
  queryKeys,
  refreshLibraryAutoBrowse,
} from '../data';
import { strings } from '../localization';
import type { OfflinePlaylistBrowseSummary } from '../offline/browse';
import { useOfflineDownloads } from '../offline/hooks';
import { refreshBrowseTree } from '../player/browseTree';
import { playTracks } from '../player/controller';
import { reportPlayerNotice } from '../player/notices';
import { colors, metrics } from '../theme';
import {
  assertLibraryRouteCallbacks,
  libraryFollowArtistRoute,
  libraryPlaybackSelection,
  libraryTestIdSegment,
  likedTrackOccurrence,
  playlistCreateRequest,
  recentPlayTrack,
  recentTrackOccurrence,
  type LibraryAlbumRouteParams,
  type LibraryArtistRouteParams,
  type LibraryRouteCallbacks,
} from './libraryModel';
import { libraryStrings } from './libraryStrings';
import {
  accountOfflineAvailability,
  accountOfflinePlaylistSummaries,
  type AccountOfflineAvailability,
} from './offlineScreenModel';
import { playlistFailureMessage, playlistNameValidation } from './playlistFeedback';
import { startRecentlyHeardPlayback } from './homePlayback';

export type LibraryScreenProps = LibraryRouteCallbacks;
export type {
  LibraryAlbumRouteParams,
  LibraryArtistRouteParams,
  LibraryPlaylistRouteParams,
  LikedPlaylistRouteParams,
  OwnedPlaylistRouteParams,
} from './libraryModel';

function Artwork({ uri, round = false }: { uri: string | null; round?: boolean }) {
  return uri ? (
    <Image accessible={false} source={{ uri }} style={[styles.artwork, round && styles.round]} />
  ) : (
    <View style={[styles.artwork, styles.artworkPlaceholder, round && styles.round]}>
      <AppIcon name="music-note" color={colors.textSecondary} size={22} />
    </View>
  );
}

export interface LibraryDownloadsListProps {
  availability: AccountOfflineAvailability;
  playlists: readonly OfflinePlaylistBrowseSummary[];
  apiBase: string;
  onOpenPlaylist: LibraryRouteCallbacks['onOpenPlaylist'];
}

/** Account-filtered local collection rendered inside the fixed Downloads section. */
export function LibraryDownloadsList({
  availability,
  playlists,
  apiBase,
  onOpenPlaylist,
}: LibraryDownloadsListProps) {
  if (availability === 'loading') {
    return (
      <Text
        testID="library-downloads-loading"
        accessibilityRole="progressbar"
        accessibilityLiveRegion="polite"
        style={styles.status}
      >
        {libraryStrings.library.downloadsLoading}
      </Text>
    );
  }
  if (availability === 'unavailable') {
    return (
      <View
        testID="library-downloads-unavailable"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.unavailableCard}
      >
        <Text style={styles.unavailableTitle}>
          {libraryStrings.library.downloadsUnavailable}
        </Text>
        <Text style={styles.cardStatus}>{libraryStrings.library.downloadsUnavailableBody}</Text>
      </View>
    );
  }
  if (playlists.length === 0) {
    return (
      <View testID="library-downloads-empty" style={styles.unavailableCard}>
        <Text style={styles.unavailableTitle}>{libraryStrings.library.noDownloads}</Text>
        <Text style={styles.cardStatus}>{libraryStrings.library.noDownloadsBody}</Text>
      </View>
    );
  }

  return (
    <View testID="library-downloads-list" style={styles.downloadsList}>
      {playlists.map((playlist) => {
        const downloaded = playlist.offline.downloadedOccurrences;
        const total = playlist.offline.totalOccurrences;
        const status = playlist.offline.status === 'complete'
          ? libraryStrings.library.downloadedPlaylist(downloaded, total)
          : libraryStrings.library.partialDownload(
              downloaded,
              total,
              playlist.offline.failedOccurrences,
            );
        return (
          <Pressable
            key={playlist.id}
            testID={`library-download-${playlist.id}`}
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.library.openDownload(
              playlist.name,
              downloaded,
              total,
            )}
            onPress={() => onOpenPlaylist({
              kind: 'playlist',
              playlistId: playlist.id,
              name: playlist.name,
            })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Artwork
              uri={playlist.cover_url === null
                ? null
                : resolveServerUrl(playlist.cover_url, apiBase)}
            />
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle} numberOfLines={1}>{playlist.name}</Text>
              <Text
                testID={`library-download-${playlist.id}-status`}
                accessibilityLiveRegion="polite"
                style={[
                  styles.rowSubtitle,
                  playlist.offline.status === 'partial' && styles.partialDownloadText,
                ]}
              >
                {status}
              </Text>
            </View>
            <AppIcon name="download" color={colors.accentSoft} size={22} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function LibraryLikedTrackRow({
  track,
  index,
  accountId,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
}: {
  track: Track;
  index: number;
  accountId: string | number;
  onPlay: () => void;
  onActions: () => void;
  onOpenAlbum: (params: LibraryAlbumRouteParams) => void;
  onOpenArtist: (params: LibraryArtistRouteParams) => void;
}) {
  const rowId = `library-liked-track-${libraryTestIdSegment(track.id)}-${index}`;
  return (
    <StandardTrackRow
      track={track}
      testID={rowId}
      occurrence={likedTrackOccurrence(accountId, index)}
      position={index + 1}
      onPlay={onPlay}
      onActions={onActions}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export default function LibraryScreen(props: LibraryScreenProps) {
  assertLibraryRouteCallbacks(props);
  const { onOpenPlaylist, onOpenAlbum, onOpenArtist } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('LibraryScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const offlineSnapshot = useOfflineDownloads();
  const offlineAvailability = accountOfflineAvailability(offlineSnapshot, scope);
  const offlinePlaylists = accountOfflinePlaylistSummaries(offlineSnapshot, scope);
  const queryClient = useQueryClient();
  const playlists = useQuery(musicQueries.playlists(scope));
  const likes = useQuery(musicQueries.likes(scope));
  const stats = useQuery(musicQueries.stats(scope));
  const following = useQuery(musicQueries.following(scope));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [recentPlaybackIndex, setRecentPlaybackIndex] = useState<number | null>(null);
  const recentPlaybackInFlight = useRef(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createValidation, setCreateValidation] = useState<string | null>(null);

  const createPlaylist = useMutation({
    ...musicMutations.createPlaylist(scope),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.playlists.owned(scope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.playlists.public(scope) }),
        refreshLibraryAutoBrowse(refreshBrowseTree, () => {
          reportPlayerNotice(
            'bookkeeping',
            'auto-library-refresh',
            strings.player.autoLibraryFailed,
            strings.player.autoLibraryRefreshFailedMessage,
          );
        }),
      ]);
      setCreateVisible(false);
      setCreateName('');
      setCreateDescription('');
      setCreateValidation(null);
      AccessibilityInfo.announceForAccessibility(libraryStrings.library.created(created.name));
      onOpenPlaylist({ kind: 'playlist', playlistId: created.id, name: created.name });
    },
  });

  const queries = [playlists, likes, stats, following];
  const refreshing = queries.some((query) => query.isFetching && !query.isPending);

  const refresh = () => {
    setRuntimeError(null);
    void refreshLibraryQueries(queries);
  };

  const playContext = (tracks: Track[], index: number) => {
    try {
      const selected = libraryPlaybackSelection(tracks, index);
      setRuntimeError(null);
      void playTracks(selected.tracks, selected.startIndex, {
        context: {
          type: 'liked',
          id: String(user.id),
          label: strings.navigation.likedSongs,
        },
      }).catch((error) =>
        setRuntimeError(playlistFailureMessage('playback', error)),
      );
    } catch (error) {
      setRuntimeError(playlistFailureMessage('playback', error));
    }
  };

  const playRecent = (recent: readonly RecentPlay[], index: number) => {
    if (recentPlaybackInFlight.current) return;
    recentPlaybackInFlight.current = true;
    setRecentPlaybackIndex(index);
    setRuntimeError(null);
    void startRecentlyHeardPlayback({
      recent,
      startIndex: index,
      contextId: user.id,
      contextLabel: strings.queue.recentContext,
      resolveTrack: (id) => queryClient.fetchQuery(musicQueries.track(id)),
      startPlayback: playTracks,
    })
      .catch((error) => setRuntimeError(playlistFailureMessage('playback', error)))
      .finally(() => {
        recentPlaybackInFlight.current = false;
        setRecentPlaybackIndex(null);
      });
  };

  const submitCreate = () => {
    const validation = playlistNameValidation(createName);
    setCreateValidation(validation);
    if (validation !== null) return;
    createPlaylist.reset();
    try {
      createPlaylist.mutate(playlistCreateRequest(createName, createDescription));
    } catch (error) {
      setCreateValidation(playlistFailureMessage('create', error));
    }
  };

  const closeCreate = () => {
    if (createPlaylist.isPending) return;
    setCreateVisible(false);
    setCreateValidation(null);
    createPlaylist.reset();
  };

  const likedTracks = likes.data ?? [];
  const recentTracks = stats.data?.recent ?? [];

  const presentations: LibrarySectionPresentations = {
    playlists: {
      title: libraryStrings.library.playlists,
      state: libraryQuerySectionState(playlists, playlists.data?.length === 0),
      emptyText: libraryStrings.library.noPlaylists,
      onRetry: () => void playlists.refetch(),
      action: (
        <View style={styles.actionRow}>
          <Pressable
            testID="library-create-playlist"
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.library.createPlaylist}
            onPress={() => {
              setCreateVisible(true);
              createPlaylist.reset();
            }}
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
          >
            <AppIcon name="plus" color={colors.onAccent} size={20} />
            <Text style={styles.primaryActionText}>{libraryStrings.library.createPlaylist}</Text>
          </Pressable>
        </View>
      ),
    },
    liked: {
      title: libraryStrings.library.likedTracks,
      state: libraryQuerySectionState(likes, likes.data?.length === 0),
      emptyText: libraryStrings.library.noLikes,
      onRetry: () => void likes.refetch(),
    },
    recent: {
      title: libraryStrings.library.recentlyHeard,
      state: libraryQuerySectionState(stats, stats.data?.recent.length === 0),
      emptyText: libraryStrings.library.noRecent,
      onRetry: () => void stats.refetch(),
    },
    downloads: {
      title: libraryStrings.library.downloads,
      state: LIBRARY_POLICY_SECTION_STATE,
    },
    following: {
      title: libraryStrings.library.following,
      state: libraryQuerySectionState(following, following.data?.length === 0),
      emptyText: libraryStrings.library.noFollowing,
      onRetry: () => void following.refetch(),
    },
  };

  const renderLibraryItem = (item: LibraryListItem) => {
    switch (item.kind) {
      case 'playlist': {
        const { playlist } = item;
        return (
          <Pressable
            testID={`library-playlist-${playlist.id}`}
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.library.openPlaylist(
              playlist.name,
              playlist.track_count,
            )}
            onPress={() =>
              onOpenPlaylist({
                kind: 'playlist',
                playlistId: playlist.id,
                name: playlist.name,
              })
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Artwork
              uri={
                playlist.cover_url === null
                  ? null
                  : resolveServerUrl(playlist.cover_url, apiBase)
              }
            />
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle} numberOfLines={1}>{playlist.name}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={2}>
                {playlist.description?.trim()
                  || libraryStrings.common.tracks(playlist.track_count)}
              </Text>
            </View>
            <Text style={styles.count}>{playlist.track_count}</Text>
          </Pressable>
        );
      }
      case 'liked-collection':
        return (
          <Pressable
            testID="library-open-liked"
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.library.openLiked(likedTracks.length)}
            onPress={() =>
              onOpenPlaylist({ kind: 'liked', name: libraryStrings.library.likedTracks })
            }
            style={({ pressed }) => [styles.collectionAction, pressed && styles.pressed]}
          >
            <AppIcon
              name="heart"
              color={colors.onAccent}
              size={21}
              style={styles.collectionGlyph}
            />
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{libraryStrings.library.likedTracks}</Text>
              <Text style={styles.rowSubtitle}>
                {libraryStrings.common.tracks(likedTracks.length)}
              </Text>
            </View>
            <AppIcon name="chevron-right" color={colors.textSecondary} size={28} />
          </Pressable>
        );
      case 'liked-track':
        return (
          <LibraryLikedTrackRow
            track={item.track}
            index={item.index}
            accountId={user.id}
            onPlay={() => playContext(likedTracks, item.index)}
            onActions={() => showTrackActions(
              item.track,
              (message) => setRuntimeError(playlistFailureMessage('track-action', message)),
            )}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        );
      case 'recent-track': {
        const testID = `library-recent-track-${libraryTestIdSegment(item.play.id)}-${item.index}`;
        return (
          <LibraryRecentRow
            play={item.play}
            index={item.index}
            testID={testID}
            occurrence={recentTrackOccurrence(user.id, item.index)}
            busy={recentPlaybackIndex === item.index}
            disabled={recentPlaybackIndex !== null}
            onPlay={() => playRecent(recentTracks, item.index)}
            onActions={() => showTrackActions(
              recentPlayTrack(item.play),
              (message) => setRuntimeError(playlistFailureMessage('track-action', message)),
            )}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        );
      }
      case 'downloads-policy':
        return (
          <LibraryDownloadsList
            availability={offlineAvailability}
            playlists={offlinePlaylists}
            apiBase={apiBase}
            onOpenPlaylist={onOpenPlaylist}
          />
        );
      case 'following-artist':
        return (
          <Pressable
            testID={`library-following-${libraryTestIdSegment(item.artist.id)}`}
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.library.openArtist(item.artist.name)}
            onPress={() => onOpenArtist(libraryFollowArtistRoute(item.artist))}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Artwork uri={item.artist.picture || null} round />
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{item.artist.name}</Text>
            </View>
            <AppIcon name="chevron-right" color={colors.textSecondary} size={28} />
          </Pressable>
        );
    }
  };

  return (
    <View testID="library-screen" style={styles.container}>
      <LibraryVirtualizedList
        collections={{
          playlists: playlists.data ?? [],
          likedTracks,
          recentTracks,
          following: following.data ?? [],
        }}
        presentations={presentations}
        refreshing={refreshing}
        onRefresh={refresh}
        header={
          <View style={styles.listHeader}>
            <View style={styles.hero}>
              <Text testID="library-title" accessibilityRole="header" style={styles.title}>
                {libraryStrings.library.title}
              </Text>
              <Text style={styles.subtitle}>{libraryStrings.library.subtitle}</Text>
            </View>
            {runtimeError !== null ? (
              <Text
                testID="library-runtime-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.runtimeError}
              >
                {runtimeError}
              </Text>
            ) : null}
          </View>
        }
        renderItem={renderLibraryItem}
      />

      <Modal
        visible={createVisible}
        transparent
        animationType="fade"
        onRequestClose={closeCreate}
      >
        <View testID="library-create-modal" style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.modalCard}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              {libraryStrings.library.createTitle}
            </Text>
            <TextInput
              testID="library-create-name"
              accessibilityLabel={libraryStrings.library.name}
              placeholder={libraryStrings.library.name}
              placeholderTextColor={colors.textSecondary}
              value={createName}
              onChangeText={setCreateName}
              editable={!createPlaylist.isPending}
              autoFocus
              maxLength={120}
              style={styles.input}
            />
            <TextInput
              testID="library-create-description"
              accessibilityLabel={libraryStrings.library.description}
              placeholder={libraryStrings.library.description}
              placeholderTextColor={colors.textSecondary}
              value={createDescription}
              onChangeText={setCreateDescription}
              editable={!createPlaylist.isPending}
              multiline
              maxLength={500}
              style={[styles.input, styles.descriptionInput]}
            />
            {createValidation !== null || createPlaylist.error !== null ? (
              <Text
                testID="library-create-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.errorText}
              >
                {createValidation ?? libraryStrings.library.createFailed}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                testID="library-create-cancel"
                accessibilityRole="button"
                accessibilityLabel={libraryStrings.common.cancel}
                disabled={createPlaylist.isPending}
                onPress={closeCreate}
                style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryActionText}>{libraryStrings.common.cancel}</Text>
              </Pressable>
              <Pressable
                testID="library-create-submit"
                accessibilityRole="button"
                accessibilityLabel={
                  createPlaylist.isPending
                    ? libraryStrings.library.creating
                    : libraryStrings.library.createPlaylist
                }
                accessibilityState={{ disabled: createPlaylist.isPending, busy: createPlaylist.isPending }}
                disabled={createPlaylist.isPending}
                onPress={submitCreate}
                style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
              >
                <Text style={styles.primaryActionText}>
                  {createPlaylist.isPending
                    ? libraryStrings.library.creating
                    : libraryStrings.library.createPlaylist}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listHeader: { gap: 30 },
  hero: { gap: 7, paddingHorizontal: 16 },
  title: { color: colors.textPrimary, fontSize: 32, lineHeight: 38, fontWeight: '900' },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, maxWidth: 460 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  cardStatus: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  runtimeError: {
    color: colors.danger,
    marginHorizontal: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  rowSubtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  artwork: {
    width: 50,
    height: 50,
    borderRadius: 7,
    backgroundColor: colors.surfaceElevated,
  },
  round: { borderRadius: 25 },
  artworkPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  artworkGlyph: { color: colors.accentSoft, fontSize: 20 },
  count: { color: colors.textSecondary, minWidth: 30, textAlign: 'right' },
  chevron: { color: colors.textSecondary, fontSize: 28 },
  actionRow: { paddingHorizontal: 16 },
  primaryAction: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  primaryActionText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  secondaryAction: {
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
  },
  secondaryActionText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  collectionAction: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
  },
  collectionGlyph: {
    width: 50,
    height: 50,
    borderRadius: 7,
    color: colors.onAccent,
    backgroundColor: colors.accent,
    textAlign: 'center',
    lineHeight: 50,
    fontSize: 21,
    overflow: 'hidden',
  },
  unavailableCard: {
    gap: 7,
    marginHorizontal: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
  },
  unavailableTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  downloadsList: { gap: 2 },
  partialDownloadText: { color: colors.warning },
  downloadGlyph: { color: colors.accent, fontSize: 24, fontWeight: '800', paddingRight: 6 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  modalCard: {
    gap: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.backgroundElevated,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' },
  input: {
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  descriptionInput: { minHeight: 92, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
