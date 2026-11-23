import React from 'react';
import type { TextStyle } from 'react-native';
import type { HomeShelf, Track } from '../../api/types';
import type { QueueContext } from '../../player/queueContract';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { testIdSegment } from '../../screens/homeModel';
import { HomeShelfCard, HomeTrackCard } from './HomeCards';
import { HorizontalShelf } from './HorizontalShelf';

interface HomeTrackRailProps {
  id: string;
  /** Card testIDs are `${testIdPrefix}-<track id>-<index>`. */
  testIdPrefix: string;
  tracks: readonly Track[];
  /** The queue context every card of this rail plays in. */
  context: QueueContext;
  onPlay: (index: number) => void;
  onActions: (track: Track) => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  paddingHorizontal?: number;
  gap?: number;
}

/** A rail of directly playable tracks that share one queue context. */
export function HomeTrackRail({
  id,
  testIdPrefix,
  tracks,
  context,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
  paddingHorizontal,
  gap,
}: HomeTrackRailProps) {
  return (
    <HorizontalShelf
      id={id}
      data={tracks}
      paddingHorizontal={paddingHorizontal}
      gap={gap}
      keyExtractor={(track, index) => `${track.id}:${index}`}
      renderItem={(track, index) => (
        <HomeTrackCard
          track={track}
          testID={`${testIdPrefix}-${testIdSegment(track.id)}-${index}`}
          occurrence={{ queueContext: context, originalContextOrder: index }}
          onPress={() => onPlay(index)}
          onLongPress={() => onActions(track)}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      )}
    />
  );
}

interface HomeShelfRailProps {
  id: string;
  /** Card testIDs are `${testIdPrefix}-<shelf key>`. */
  testIdPrefix: string;
  shelves: readonly HomeShelf[];
  action: 'play' | 'open';
  onPress: (shelf: HomeShelf) => void;
  cardSize?: number;
  paddingHorizontal?: number;
  gap?: number;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
  onCardFocus?: (focusKey: string) => void;
}

/** A rail of mix / collection cards that all play or all open. */
export function HomeShelfRail({
  id,
  testIdPrefix,
  shelves,
  action,
  onPress,
  cardSize,
  paddingHorizontal,
  gap,
  titleStyle,
  subtitleStyle,
  onCardFocus,
}: HomeShelfRailProps) {
  return (
    <HorizontalShelf
      id={id}
      data={shelves}
      paddingHorizontal={paddingHorizontal}
      gap={gap}
      keyExtractor={(shelf) => shelf.key}
      renderItem={(shelf) => {
        const cardTestId = `${testIdPrefix}-${testIdSegment(shelf.key)}`;
        return (
          <HomeShelfCard
            shelf={shelf}
            testID={cardTestId}
            action={action}
            cardSize={cardSize}
            titleStyle={titleStyle}
            subtitleStyle={subtitleStyle}
            onFocus={onCardFocus ? () => onCardFocus(cardTestId) : undefined}
            onPress={() => onPress(shelf)}
          />
        );
      }}
    />
  );
}
