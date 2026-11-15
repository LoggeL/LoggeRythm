import type { NavigatorScreenParams } from '@react-navigation/native';
import type {
  AlbumRouteParams,
  ArtistRouteParams,
  GenreRouteParams,
} from '../screens/catalogModel';
import type { HomeMixRouteParams } from '../screens/homeModel';
import type { LibraryPlaylistRouteParams } from '../screens/libraryModel';

/**
 * Route names are a contract: navigationLinking.ts, navigationPersistence.ts
 * and the on-device QA scripts allowlist them. Never rename a route.
 */
export type SectionStackParams = {
  Home: undefined;
  Search: undefined;
  Discover: undefined;
  Radio: undefined;
  Library: undefined;
  Mix: HomeMixRouteParams;
  Radar: undefined;
  Album: AlbumRouteParams;
  Genre: GenreRouteParams;
  Artist: ArtistRouteParams;
  Playlist: LibraryPlaylistRouteParams;
};

export type AppTabParams = {
  HomeTab: NavigatorScreenParams<SectionStackParams> | undefined;
  SearchTab: NavigatorScreenParams<SectionStackParams> | undefined;
  DiscoverTab: NavigatorScreenParams<SectionStackParams> | undefined;
  RadioTab: NavigatorScreenParams<SectionStackParams> | undefined;
  LibraryTab: NavigatorScreenParams<SectionStackParams> | undefined;
};

export type RootStackParams = {
  Tabs: NavigatorScreenParams<AppTabParams> | undefined;
  Profile: undefined;
  NowPlaying: undefined;
  Queue: undefined;
};
