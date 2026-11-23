import React, { useMemo } from 'react';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { strings } from '../localization';
import { useLocaleRevision } from '../localization/LocaleProvider';
import { useTvEnvironment } from '../tv';
import {
  ProfileButton,
  brandedRootOptions,
  buildSectionScreenOptions,
} from './headerChrome';
import {
  AlbumRoute,
  ArtistRoute,
  DiscoverRoute,
  GenreRoute,
  HomeRoute,
  LibraryRoute,
  MixRoute,
  PlaylistRoute,
  RadarRoute,
  RadioRoute,
  SearchRoute,
} from './routes';
import type { SectionStackParams } from './types';

const SectionStack = createNativeStackNavigator<SectionStackParams>();

type SectionRootName = 'Home' | 'Search' | 'Discover' | 'Radio' | 'Library';

const profileHeader = () => <ProfileButton />;

function createDetailOptionBuilders(isTv: boolean) {
  const headerRight = isTv ? undefined : profileHeader;
  return {
    mix: ({ route }: { route: { params: SectionStackParams['Mix'] } }): NativeStackNavigationOptions => ({
      title: route.params.title || strings.home.mixes,
      headerRight,
    }),
    radar: {
      title: strings.home.releaseRadar,
      headerRight,
    } satisfies NativeStackNavigationOptions,
    album: ({ route }: { route: { params: SectionStackParams['Album'] } }): NativeStackNavigationOptions => ({
      title: route.params.title || strings.navigation.album,
      headerRight,
    }),
    genre: ({ route }: { route: { params: SectionStackParams['Genre'] } }): NativeStackNavigationOptions => ({
      title: route.params.name || strings.navigation.genre,
      headerRight,
    }),
    artist: ({ route }: { route: { params: SectionStackParams['Artist'] } }): NativeStackNavigationOptions => ({
      title: route.params.name || strings.navigation.artist,
      headerRight,
    }),
    playlist: ({ route }: { route: { params?: SectionStackParams['Playlist'] } }): NativeStackNavigationOptions => ({
      title: route.params?.name || strings.navigation.playlists,
      headerRight,
    }),
  };
}

/**
 * One factory for the five tab stacks: the tab's root screen with the branded
 * header, followed by the shared detail routes. Options are memoized per
 * locale, reduced-motion, and TV mode so detail screens avoid unnecessary
 * option-object churn on re-renders.
 */
function createSectionNavigator(
  initialRouteName: SectionRootName,
  title: () => string,
  rootScreen: (options: NativeStackNavigationOptions) => React.ReactElement,
) {
  function SectionNavigator() {
    const localeRevision = useLocaleRevision();
    const reducedMotion = useReducedMotion();
    const tv = useTvEnvironment();
    const screenOptions = useMemo(
      () => buildSectionScreenOptions(reducedMotion),
      [reducedMotion],
    );
    const rootOptions = useMemo(
      () => brandedRootOptions(title(), tv.isTv),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- title() reads strings for active locale
      [localeRevision, tv.isTv],
    );
    const detailOptions = useMemo(
      () => createDetailOptionBuilders(tv.isTv),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- localized fallback titles track localeRevision
      [localeRevision, tv.isTv],
    );

    return (
      <SectionStack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={screenOptions}
      >
        {rootScreen(rootOptions)}
        <SectionStack.Screen
          name="Mix"
          component={MixRoute}
          options={detailOptions.mix}
        />
        <SectionStack.Screen
          name="Radar"
          component={RadarRoute}
          options={detailOptions.radar}
        />
        <SectionStack.Screen
          name="Album"
          component={AlbumRoute}
          options={detailOptions.album}
        />
        <SectionStack.Screen
          name="Genre"
          component={GenreRoute}
          options={detailOptions.genre}
        />
        <SectionStack.Screen
          name="Artist"
          component={ArtistRoute}
          options={detailOptions.artist}
        />
        <SectionStack.Screen
          name="Playlist"
          component={PlaylistRoute}
          options={detailOptions.playlist}
        />
      </SectionStack.Navigator>
    );
  }
  SectionNavigator.displayName = `${initialRouteName}Navigator`;
  return SectionNavigator;
}

export const HomeNavigator = createSectionNavigator(
  'Home',
  () => strings.navigation.home,
  (options) => <SectionStack.Screen name="Home" component={HomeRoute} options={options} />,
);

export const SearchNavigator = createSectionNavigator(
  'Search',
  () => strings.navigation.search,
  (options) => <SectionStack.Screen name="Search" component={SearchRoute} options={options} />,
);

export const DiscoverNavigator = createSectionNavigator(
  'Discover',
  () => strings.navigation.discover,
  (options) => <SectionStack.Screen name="Discover" component={DiscoverRoute} options={options} />,
);

export const RadioNavigator = createSectionNavigator(
  'Radio',
  () => strings.navigation.radio,
  (options) => <SectionStack.Screen name="Radio" component={RadioRoute} options={options} />,
);

export const LibraryNavigator = createSectionNavigator(
  'Library',
  () => strings.navigation.library,
  (options) => <SectionStack.Screen name="Library" component={LibraryRoute} options={options} />,
);
