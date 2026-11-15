import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { strings } from '../localization';
import { useLocaleRevision } from '../localization/LocaleProvider';
import { ProfileButton, brandedRootOptions, sectionScreenOptions } from './headerChrome';
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

/** The detail routes every tab stack can push, so a tab keeps its own back stack. */
function detailScreens() {
  return (
    <>
      <SectionStack.Screen
        name="Mix"
        component={MixRoute}
        options={({ route }) => ({
          title: route.params.title || strings.home.mixes,
          headerRight: profileHeader,
        })}
      />
      <SectionStack.Screen
        name="Radar"
        component={RadarRoute}
        options={{ title: strings.home.releaseRadar, headerRight: profileHeader }}
      />
      <SectionStack.Screen
        name="Album"
        component={AlbumRoute}
        options={({ route }) => ({
          title: route.params.title || strings.navigation.album,
          headerRight: profileHeader,
        })}
      />
      <SectionStack.Screen
        name="Genre"
        component={GenreRoute}
        options={({ route }) => ({
          title: route.params.name || strings.navigation.genre,
          headerRight: profileHeader,
        })}
      />
      <SectionStack.Screen
        name="Artist"
        component={ArtistRoute}
        options={({ route }) => ({
          title: route.params.name || strings.navigation.artist,
          headerRight: profileHeader,
        })}
      />
      <SectionStack.Screen
        name="Playlist"
        component={PlaylistRoute}
        options={({ route }) => ({
          title: route.params?.name || strings.navigation.playlists,
          headerRight: profileHeader,
        })}
      />
    </>
  );
}

/**
 * One factory for the five tab stacks: the tab's root screen with the branded
 * header, followed by the shared detail routes. `rootScreen` builds the
 * (fully typed) root `<SectionStack.Screen>`; `title` is read on every render
 * so it follows a locale switch.
 */
function createSectionNavigator(
  initialRouteName: SectionRootName,
  title: () => string,
  rootScreen: (options: ReturnType<typeof brandedRootOptions>) => React.ReactElement,
) {
  function SectionNavigator() {
    useLocaleRevision();
    return (
      <SectionStack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={sectionScreenOptions}
      >
        {rootScreen(brandedRootOptions(title()))}
        {detailScreens()}
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
