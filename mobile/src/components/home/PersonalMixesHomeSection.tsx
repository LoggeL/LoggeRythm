import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HomeShelf } from '../../api/types';
import { musicQueries } from '../../data';
import { wave2Strings } from '../../localization/wave2Strings';
import { playableHomeShelves } from '../../screens/homeModel';
import { homeFeedSection } from '../../screens/useHomeFeed';
import { HomeShelfRail } from './HomeRails';
import { HomeSection } from './HomeSection';

export interface PersonalMixesHomeSectionProps {
  scope: string;
  cardSize?: number;
  paddingHorizontal?: number;
  gap?: number;
  tvMode?: boolean;
  onCardFocus?: (focusKey: string) => void;
  onOpenMix: (shelf: HomeShelf) => void;
}

/**
 * Dynamic personal mixes shelf on Home (`GET /api/home/personal-mixes`:
 * On Repeat, Forgotten Favorites, Unheard Cuts).
 */
export function PersonalMixesHomeSection({
  scope,
  cardSize,
  paddingHorizontal,
  gap,
  tvMode,
  onCardFocus,
  onOpenMix,
}: PersonalMixesHomeSectionProps) {
  const query = useQuery(musicQueries.personalMixes(scope));
  const section = homeFeedSection(query);
  const shelves = useMemo(() => playableHomeShelves(section.data), [section.data]);

  if (!section.state.pending && section.state.error === null && shelves.length === 0) {
    return null;
  }

  return (
    <HomeSection
      id="personal-mixes"
      title={wave2Strings.homeMixes.personalTitle}
      {...section.state}
      skeletonVariant="card"
      skeletonCardSize={cardSize}
      paddingHorizontal={paddingHorizontal}
      tvMode={tvMode}
      empty={section.data !== undefined && shelves.length === 0}
    >
      <HomeShelfRail
        id="personal-mixes"
        testIdPrefix="home-shelf-card-personal-mixes"
        shelves={shelves}
        action="open"
        cardSize={cardSize}
        paddingHorizontal={paddingHorizontal}
        gap={gap}
        onCardFocus={onCardFocus}
        onPress={onOpenMix}
      />
    </HomeSection>
  );
}
