import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ArtistAbout as ArtistAboutData } from '../../api/types';
import { catalogStrings } from '../../screens/catalogStrings';
import { colors, layout, radii, spacing } from '../../theme';
import { ActionButton, AppText } from '../ui';

/** Lines of biography shown before "Show more". */
const COLLAPSED_LINES = 5;
/** Below this length a biography fits the collapsed block on a 360dp screen. */
const COLLAPSIBLE_FROM_CHARS = 260;

/** True when the about payload carries anything worth a section. */
export function artistAboutHasContent(about: ArtistAboutData | undefined): boolean {
  return (
    about !== undefined &&
    (about.bio.trim().length > 0 ||
      about.tags.length > 0 ||
      about.listeners > 0 ||
      about.playcount > 0)
  );
}

/**
 * Biography (collapsed to a few lines, expandable), listener and play
 * counts, and genre tags of an artist.
 */
export function ArtistAbout({ about }: { about: ArtistAboutData }) {
  const [expanded, setExpanded] = useState(false);
  const bio = about.bio.trim();
  const collapsible = bio.length > COLLAPSIBLE_FROM_CHARS;
  return (
    <View testID="artist-about-content" style={styles.about}>
      {bio.length > 0 ? (
        <View style={styles.bio}>
          <AppText
            color="secondary"
            numberOfLines={collapsible && !expanded ? COLLAPSED_LINES : undefined}
          >
            {bio}
          </AppText>
          {collapsible ? (
            <ActionButton
              testID="artist-about-toggle"
              variant="ghost"
              label={
                expanded
                  ? catalogStrings.artist.showLessAbout
                  : catalogStrings.artist.showMoreAbout
              }
              onPress={() => setExpanded((value) => !value)}
              style={styles.toggle}
            />
          ) : null}
        </View>
      ) : null}
      {about.listeners > 0 || about.playcount > 0 ? (
        <View style={styles.facts}>
          {about.listeners > 0 ? (
            <AppText variant="callout" color="secondary">
              {catalogStrings.artist.listeners(about.listeners)}
            </AppText>
          ) : null}
          {about.playcount > 0 ? (
            <AppText variant="callout" color="secondary">
              {catalogStrings.artist.plays(about.playcount)}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {about.tags.length > 0 ? (
        <View style={styles.tags}>
          {about.tags.map((tag) => (
            <AppText key={tag} variant="caption" style={styles.tag}>{tag}</AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  about: { gap: layout.stackGap, paddingHorizontal: layout.pagePadding },
  bio: { gap: spacing.xxs },
  // Ghost buttons carry their own horizontal padding; pull the label onto the text edge.
  toggle: { alignSelf: 'flex-start', marginLeft: -spacing.lg },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xxs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.fill,
  },
});
