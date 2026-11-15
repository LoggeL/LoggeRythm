import React from 'react';
import { StyleSheet } from 'react-native';
import type { ArtistDetail } from '../../api/types';
import { catalogStrings } from '../../screens/catalogStrings';
import { ActionButton, AppText } from '../ui';
import { CatalogHeroArtwork } from './CatalogCards';
import { CatalogDetailHero } from './CatalogDetailHero';
import { CatalogQueryBoundary } from './CatalogStates';
import { catalogQueryFlags, type CatalogQueryFlags } from './catalogQueryState';

export interface ArtistHeroProps {
  artist: ArtistDetail;
  /** The follow-state query: its flags plus whether a response exists. */
  followState: CatalogQueryFlags & { data: unknown; refetch: () => unknown };
  following: boolean;
  followUpdating: boolean;
  onToggleFollow: () => void;
  onPlay: () => void;
}

/**
 * The Artist page hero: round portrait, name, fan count, and one action row
 * with Follow (left) and the PlayButton (right). Follow is the light primary
 * pill until the artist is followed, then a quiet "Following" toggle; while
 * its state loads a pill-shaped skeleton keeps the row from jumping.
 */
export function ArtistHero({
  artist,
  followState,
  following,
  followUpdating,
  onToggleFollow,
  onPlay,
}: ArtistHeroProps) {
  return (
    <CatalogDetailHero
      centered
      artwork={<CatalogHeroArtwork uri={artist.picture} round />}
      eyebrow={catalogStrings.artist.typeLabel}
      eyebrowTestID="artist-type-label"
      title={artist.name}
      titleTestID="artist-title"
      play={{
        testID: 'artist-play-all',
        accessibilityLabel: catalogStrings.common.play,
        disabled: artist.top.length === 0,
        onPress: onPlay,
      }}
      actions={
        <CatalogQueryBoundary
          id="artist-follow-state"
          hasData={followState.data !== undefined}
          empty={false}
          {...catalogQueryFlags(followState)}
          loadingLabel={catalogStrings.artist.followLoading}
          emptyLabel={catalogStrings.artist.followStateFailed}
          errorLabel={catalogStrings.artist.followStateFailed}
          retryLabel={catalogStrings.common.retry}
          onRetry={() => void followState.refetch()}
          skeleton="pill"
          padded={false}
          refreshIndicator={false}
          style={styles.follow}
        >
          <ActionButton
            testID="artist-follow-toggle"
            label={
              followUpdating
                ? catalogStrings.artist.followUpdating
                : following
                  ? catalogStrings.artist.following
                  : catalogStrings.artist.follow
            }
            accessibilityLabel={
              following
                ? catalogStrings.artist.unfollowArtist(artist.name)
                : catalogStrings.artist.followArtist(artist.name)
            }
            disabled={followUpdating}
            busy={followUpdating}
            variant={following ? 'secondary' : 'primary'}
            icon={following ? 'check' : 'plus'}
            onPress={onToggleFollow}
            style={styles.followButton}
          />
        </CatalogQueryBoundary>
      }
    >
      {artist.fans > 0 ? (
        <AppText testID="artist-fans" variant="callout" color="secondary" align="center">
          {catalogStrings.artist.fans(artist.fans)}
        </AppText>
      ) : null}
    </CatalogDetailHero>
  );
}

const styles = StyleSheet.create({
  follow: { flex: 1, minWidth: 0 },
  followButton: { alignSelf: 'flex-start' },
});
