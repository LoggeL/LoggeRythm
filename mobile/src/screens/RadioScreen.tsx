import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { trackArtistLabel } from '../api/trackArtists';
import {
  RadioQueryStation,
  RadioSection,
  RadioStationCard,
} from '../components/radio/RadioCards';
import { RadioHero } from '../components/radio/RadioHero';
import { useOnAirStation } from '../components/radio/useOnAirStation';
import { radioStationKey, useRadioStations } from '../components/radio/useRadioStations';
import { AppText, IconButton, SectionHeader, Surface } from '../components/ui';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { colors, layout, spacing } from '../theme';

export default function RadioScreen() {
  const radio = useRadioStations();
  const onAir = useOnAirStation();
  const bottom = useBottomInset();
  const { startingKey } = radio;
  const stationState = (key: string) => ({
    busy: startingKey === key,
    blocked: startingKey !== null && startingKey !== key,
  });

  return (
    <View testID="radio-screen" style={styles.container}>
      <ScrollView
        testID="radio-scroll"
        refreshControl={
          <RefreshControl
            refreshing={radio.refreshing}
            onRefresh={radio.refresh}
            accessibilityLabel={strings.radio.refreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      >
        <View style={styles.gutter}>
          <RadioHero onAir={onAir} />
        </View>

        {radio.startError ? (
          <Surface
            testID="radio-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={[styles.gutter, styles.errorBanner]}
          >
            <AppText variant="callout" color="danger" style={styles.errorText}>{radio.startError}</AppText>
            <IconButton
              testID="radio-error-dismiss"
              icon="close"
              size="sm"
              accessibilityLabel={strings.radio.dismissError}
              onPress={radio.dismissStartError}
            />
          </Surface>
        ) : null}

        <RadioSection
          id="personal"
          title={strings.radio.personalTitle}
          subtitle={strings.radio.personalSubtitle}
          state={radio.personalState}
          loadingText={strings.radio.personalLoading}
          emptyText={strings.radio.personalEmpty}
          busy={radio.personalBusy}
          onRetry={radio.retryPersonal}
        >
          <ScrollView
            testID="radio-personal-list"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {radio.personal.map(({ id, track }) => (
              <RadioStationCard
                key={id}
                testID={`radio-personal-${id}`}
                title={track.title}
                subtitle={trackArtistLabel(track)}
                cover={track.cover}
                variant="personal"
                {...stationState(radioStationKey.personal(String(track.id)))}
                onAir={onAir?.id === String(track.id)}
                onPress={() => radio.startPersonal(track)}
              />
            ))}
          </ScrollView>
        </RadioSection>

        <View testID="radio-section-moods" style={styles.section}>
          <SectionHeader title={strings.radio.moodsTitle} />
          <ScrollView
            testID="radio-mood-list"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {radio.moods.map((mood) => {
              const copy = strings.radio.moods[mood.tag];
              const key = radioStationKey.mood(mood.tag);
              const state = stationState(key);
              return (
                <RadioQueryStation
                  key={mood.tag}
                  testID={`radio-mood-${mood.tag}`}
                  title={copy.title}
                  subtitle={copy.subtitle}
                  cover={mood.cover}
                  state={mood.state}
                  queryBusy={mood.busy}
                  stationBusy={state.busy}
                  blocked={state.blocked}
                  onAir={onAir?.id === key}
                  loadingText={strings.radio.moodLoading(copy.title)}
                  emptyText={strings.radio.stationEmpty}
                  onRetry={mood.retry}
                  onPress={() => radio.startMood(mood.tag)}
                />
              );
            })}
          </ScrollView>
        </View>

        <RadioSection
          id="genres"
          title={strings.radio.genresTitle}
          state={radio.genreState}
          loadingText={strings.radio.genresLoading}
          emptyText={strings.radio.genresEmpty}
          busy={radio.genresBusy}
          onRetry={radio.retryGenres}
        >
          <ScrollView
            testID="radio-genre-list"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {radio.genres.map((genre) => {
              const key = radioStationKey.genre(genre.id);
              return (
                <RadioStationCard
                  key={genre.id}
                  testID={`radio-genre-${genre.id}`}
                  title={strings.radio.genreRadio(genre.name)}
                  subtitle={genre.name}
                  cover={genre.picture}
                  variant="genre"
                  {...stationState(key)}
                  onAir={onAir?.id === key}
                  onPress={() => radio.startGenre(genre.id, genre.name)}
                />
              );
            })}
          </ScrollView>
        </RadioSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: layout.sectionGap, paddingTop: spacing.md },
  gutter: { marginHorizontal: layout.pagePadding },
  section: { gap: layout.headerGap },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xxs,
  },
  errorText: { flex: 1 },
  rail: { gap: layout.railGap, paddingHorizontal: layout.pagePadding },
});
