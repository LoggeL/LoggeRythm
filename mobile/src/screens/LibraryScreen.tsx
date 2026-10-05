import React, { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { LibraryRecentRow } from '../components/library/LibraryRecentRow';
import { LibraryCreatePlaylistDialog } from '../components/library/LibraryCreatePlaylistDialog';
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
import { ActionButton, ScreenHeader } from '../components/ui';
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
import { colors, radii, spacing, typography } from '../theme';
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
              color={colors.accentSoft}
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
            <ScreenHeader
              titleTestID="library-title"
              title={libraryStrings.library.title}
              subtitle={libraryStrings.library.subtitle}
              style={styles.hero}
            />
            <ActionButton
              testID="library-create-playlist"
              label={libraryStrings.library.createPlaylist}
              icon="plus"
              onPress={() => {
                setCreateVisible(true);
                createPlaylist.reset();
              }}
              style={styles.createAction}
            />
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

      <LibraryCreatePlaylistDialog
        visible={createVisible}
        name={createName}
        description={createDescription}
        error={createValidation ?? (createPlaylist.error !== null ? libraryStrings.library.createFailed : null)}
        busy={createPlaylist.isPending}
        onNameChange={setCreateName}
        onDescriptionChange={setCreateDescription}
        onClose={closeCreate}
        onSubmit={submitCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listHeader: { gap: spacing.lg },
  hero: { paddingHorizontal: spacing.lg },
  createAction: { alignSelf: 'flex-start', marginHorizontal: spacing.lg },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: spacing.lg },
  cardStatus: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  runtimeError: {
    ...typography.caption,
    color: colors.danger,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSubtle,
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  rowSubtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  artwork: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  round: { borderRadius: radii.pill },
  artworkPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  count: { ...typography.caption, color: colors.textMuted, minWidth: 30, textAlign: 'right' },
  collectionAction: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  collectionGlyph: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.accentSubtle,
    textAlign: 'center',
    lineHeight: 52,
    fontSize: 21,
    overflow: 'hidden',
  },
  unavailableCard: {
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  unavailableTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  downloadsList: { gap: spacing.xxs },
  partialDownloadText: { color: colors.warning },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
