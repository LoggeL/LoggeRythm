import type { NavigatorScreenParams } from '@react-navigation/native';
import type {
  AlbumRouteParams,
  ArtistRouteParams,
  GenreRouteParams,
} from '../screens/catalogModel';
import type { HomeMixRouteParams } from '../screens/homeModel';
import type { LibraryPlaylistRouteParams } from '../screens/libraryModel';
import type { UserProfileRouteParams } from '../screens/UserProfileScreen';

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
  UserProfile: UserProfileRouteParams;
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
  Insights: undefined;
  NowPlaying: undefined;
  Queue: undefined;
  /** Launcher shortcut (`loggerythm://party/start`): opens active Jam or starts a new one. */
  PartyStart: undefined;
  /** `code` comes from links and is validated by the route before use. */
  Party: { code: string };
  /** `token` comes from collaborative playlist invite links and is validated before use. */
  PlaylistInvite: { token: string };
};
