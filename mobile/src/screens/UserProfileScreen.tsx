import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaylistBlendResult, PublicProfile } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { CatalogArtistCard, HorizontalCatalogRail } from '../components/catalog/CatalogCards';
import { LibraryPlaylistRow } from '../components/library/LibraryRows';
import {
  ActionButton,
  AppText,
  Artwork,
  EmptyState,
  ErrorState,
  SectionHeader,
  Surface,
  TrackRowSkeleton,
} from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries, musicRepository, queryKeys } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { wave2Strings } from '../localization/wave2Strings';
import { colors, layout, spacing } from '../theme';
import { TvFocusScope, useTvEnvironment } from '../tv';
import { catalogTestIdSegment, type ArtistRouteParams } from './catalogModel';
import type { LibraryPlaylistRouteParams } from './libraryModel';

export interface UserProfileRouteParams {
  userId: number;
  name?: string;
}

export interface UserProfileScreenProps extends UserProfileRouteParams {
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

export interface UserProfileViewProps {
  profile: PublicProfile | undefined;
  fallbackName?: string;
  apiBase: string;
  isPending: boolean;
  isError: boolean;
  refreshing: boolean;
  bottomInset: number;
  cardSize?: number;
  onRefresh: () => void;
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  blendSection?: React.ReactNode;
}

export function UserProfileView({
  profile,
  fallbackName,
  apiBase,
  isPending,
  isError,
  refreshing,
  bottomInset,
  cardSize,
  onRefresh,
  onOpenPlaylist,
  onOpenArtist,
  blendSection,
}: UserProfileViewProps) {
  if (isPending && profile === undefined) {
    return (
      <View testID="user-profile-loading" style={[styles.container, styles.padded]}>
        <TrackRowSkeleton count={4} accessibilityLabel={strings.common.loading} />
      </View>
    );
  }
  if (isError && profile === undefined) {
    return (
      <View testID="user-profile-error" style={[styles.container, styles.padded]}>
        <ErrorState
          layout="page"
          testID="user-profile-error-state"
          retryTestID="user-profile-retry"
          message={strings.profile.publicProfileLoadFailed}
          onRetry={onRefresh}
        />
      </View>
    );
  }

  const displayName =
    profile?.display_name?.trim()
    || fallbackName?.trim()
    || strings.profile.publicProfileTitle;
  const avatarUri =
    profile?.avatar_url ? resolveServerUrl(profile.avatar_url, apiBase) : null;
  const playlists = profile?.playlists ?? [];
  const topArtists = profile?.top_artists ?? [];

  return (
    <ScrollView
      testID="user-profile-screen"
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surfaceElevated}
        />
      }
    >
      <View testID="user-profile-hero" style={styles.hero}>
        <Artwork uri={avatarUri} size={layout.artwork.lg} shape="round" icon="account" />
        <AppText
          testID="user-profile-name"
          accessibilityRole="header"
          variant="hero"
          align="center"
          numberOfLines={2}
        >
          {displayName}
        </AppText>
        {blendSection}
      </View>

      {topArtists.length > 0 ? (
        <View testID="user-profile-top-artists" style={styles.section}>
          <SectionHeader title={strings.profile.topArtists} />
          <HorizontalCatalogRail
            id="user-profile-artists"
            data={topArtists}
            keyExtractor={(artist) => String(artist.id)}
            renderItem={(artist) => (
              <CatalogArtistCard
                artist={artist}
                cardSize={cardSize}
                testID={`user-profile-artist-${catalogTestIdSegment(artist.id)}`}
                onPress={() => onOpenArtist({ artistId: artist.id, name: artist.name })}
              />
            )}
          />
        </View>
      ) : null}

      <View testID="user-profile-playlists" style={styles.section}>
        <SectionHeader title={strings.profile.publicProfilePlaylists} />
        {playlists.length === 0 ? (
          <EmptyState
            testID="user-profile-no-playlists"
            icon="playlist-music-outline"
            title={strings.profile.publicProfileNoPlaylists}
          />
        ) : (
          playlists.map((playlist) => (
            <LibraryPlaylistRow
              key={playlist.id}
              playlist={playlist}
              apiBase={apiBase}
              onOpenPlaylist={onOpenPlaylist}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function TasteBlendCard({
  otherUserId,
  onOpenPlaylist,
}: {
  otherUserId: number;
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<PlaylistBlendResult | null>(null);
  const [blendError, setBlendError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!musicRepository.createPlaylistBlend) {
        throw new Error('Taste Blend endpoint is unavailable');
      }
      return musicRepository.createPlaylistBlend(otherUserId);
    },
    onMutate: () => {
      setBlendError(null);
    },
    onSuccess: (created) => {
      setResult(created);
      if (user !== null) {
        const scope = musicCacheScope(getCurrentApiBase(), user.id);
        void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.owned(scope) });
      }
    },
    onError: (cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setBlendError(`${wave2Strings.blend.failed} (${detail})`);
    },
  });

  if (user !== null && user.id === otherUserId) return null;

  return (
    <View testID="user-profile-blend" style={styles.blendWrap}>
      {result === null ? (
        <ActionButton
          testID="user-profile-create-blend"
          icon="heart-multiple-outline"
          variant="primary"
          label={mutation.isPending ? wave2Strings.blend.creating : wave2Strings.blend.createButton}
          busy={mutation.isPending}
          disabled={mutation.isPending}
          onPress={() => mutation.mutate()}
        />
      ) : (
        <Surface padded testID="user-profile-blend-result" style={styles.blendCard}>
          <AppText variant="title" color="accent">
            {wave2Strings.blend.matchBadge(result.match_percent)}
          </AppText>
          {result.shared_artists.length > 0 ? (
            <AppText variant="callout" color="primary">
              {wave2Strings.blend.sharedArtists(result.shared_artists.slice(0, 5).join(', '))}
            </AppText>
          ) : null}
          <AppText variant="caption" color="secondary">
            {wave2Strings.blend.sharedTracks(result.shared_tracks_count)}
          </AppText>
          <ActionButton
            testID="user-profile-open-blend"
            icon="playlist-music"
            variant="primary"
            label={wave2Strings.blend.openPlaylist}
            onPress={() =>
              onOpenPlaylist({
                kind: 'playlist',
                playlistId: result.playlist.id,
                name: result.playlist.name,
              })
            }
          />
        </Surface>
      )}
      {blendError !== null ? (
        <AppText testID="user-profile-blend-error" accessibilityRole="alert" variant="caption" color="danger">
          {blendError}
        </AppText>
      ) : null}
    </View>
  );
}

/** Public listener profile backed by GET /api/users/{user_id}. */
export default function UserProfileScreen({
  userId,
  name,
  onOpenPlaylist,
  onOpenArtist,
}: UserProfileScreenProps) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error(`UserProfileScreen requires a positive userId, received ${String(userId)}`);
  }
  const apiBase = getCurrentApiBase();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  const query = useQuery(musicQueries.publicProfile(userId));

  return (
    <TvFocusScope scope="user-profile">
      <UserProfileView
        profile={query.data}
        fallbackName={name}
        apiBase={apiBase}
        isPending={query.isPending}
        isError={query.isError}
        refreshing={query.isFetching && !query.isPending}
        bottomInset={bottomInset}
        cardSize={tv.isTv ? tv.cardSize : undefined}
        onRefresh={() => void query.refetch()}
        onOpenPlaylist={onOpenPlaylist}
        onOpenArtist={onOpenArtist}
        blendSection={<TasteBlendCard otherUserId={userId} onOpenPlaylist={onOpenPlaylist} />}
      />
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  padded: { padding: layout.pagePadding },
  content: { gap: layout.sectionGap, paddingTop: spacing.xl },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: layout.pagePadding,
  },
  blendWrap: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.xs,
  },
  blendCard: {
    width: '100%',
    gap: spacing.xs,
    alignItems: 'center',
  },
  section: { gap: layout.headerGap },
});
