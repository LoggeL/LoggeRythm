import { createRuntimeCatalog, type AppLocale } from '../localization';

export interface CatalogScreenStrings {
  common: {
    retry: string;
    retrying: string;
    loading: string;
    loadFailed: string;
    offline: string;
    cachedOffline: string;
    refreshing: string;
    stale: string;
    cachedRefreshFailed: string;
    empty: string;
    play: string;
    playAll: string;
    playbackFailed: string;
    sectionLoading: (title: string) => string;
    sectionEmpty: (title: string) => string;
    retrySection: (title: string) => string;
    tracks: (count: number) => string;
    releaseYear: (year: string) => string;
    openAlbum: (title: string, artist: string) => string;
    openArtist: (name: string) => string;
    openGenre: (name: string) => string;
    playTrack: (title: string, artist: string) => string;
  };
  discover: {
    title: string;
    subtitle: string;
    charts: string;
    genres: string;
    newReleases: string;
    communityPlaylists: string;
    openPlaylist: (name: string, owner: string | null, count: number) => string;
    byOwner: (owner: string) => string;
  };
  album: {
    typeLabel: string;
    loading: string;
    empty: string;
    tracks: string;
    byArtist: (artist: string) => string;
    runtime: (minutes: number) => string;
  };
  genre: {
    loading: string;
    empty: string;
    popularTracks: string;
    albums: string;
    artists: string;
  };
  artist: {
    typeLabel: string;
    loading: string;
    empty: string;
    topTracks: string;
    albums: string;
    relatedArtists: string;
    searchSongs: string;
    searchSongsPlaceholder: (name: string) => string;
    searchSongsLabel: (name: string) => string;
    searchSongsLoading: string;
    searchSongsEmpty: (query: string) => string;
    searchSongsFailed: string;
    trackPlayCount: (plays: number, listeners: number) => string;
    about: string;
    aboutUnavailable: string;
    fans: (count: number) => string;
    albumsCount: (count: number) => string;
    follow: string;
    following: string;
    followArtist: (name: string) => string;
    unfollowArtist: (name: string) => string;
    followLoading: string;
    followUpdating: string;
    followFailed: string;
    followStateFailed: string;
    listeners: (count: number) => string;
    plays: (count: number) => string;
  };
}

export const catalogScreenCatalogs: Readonly<Record<AppLocale, CatalogScreenStrings>> = {
  de: {
    common: {
      retry: 'Erneut versuchen',
      retrying: 'Wird erneut versucht…',
      loading: 'Wird geladen…',
      loadFailed: 'Inhalte konnten nicht geladen werden. Versuche es erneut.',
      offline: 'Du bist offline. Stelle eine Verbindung her und versuche es erneut.',
      cachedOffline: 'Du bist offline. Gespeicherte Inhalte bleiben sichtbar.',
      refreshing: 'Inhalte werden aktualisiert…',
      stale: 'Gespeicherte Inhalte werden angezeigt.',
      cachedRefreshFailed: 'Aktualisierung fehlgeschlagen. Gespeicherte Inhalte bleiben sichtbar.',
      empty: 'Hier sind gerade keine Inhalte verfügbar.',
      play: 'Abspielen',
      playAll: 'Alle abspielen',
      playbackFailed: 'Wiedergabe fehlgeschlagen',
      sectionLoading: (title) => `${title} wird geladen…`,
      sectionEmpty: (title) => `Für „${title}“ sind gerade keine Inhalte verfügbar.`,
      retrySection: (title) => `${title} erneut laden`,
      tracks: (count) => `${count} Titel`,
      releaseYear: (year) => `Veröffentlicht ${year}`,
      openAlbum: (title, artist) => `Album „${title}“ von ${artist} öffnen`,
      openArtist: (name) => `Interpret ${name} öffnen`,
      openGenre: (name) => `Genre ${name} öffnen`,
      playTrack: (title, artist) => `${title} von ${artist} abspielen`,
    },
    discover: {
      title: 'Entdecken',
      subtitle: 'Charts, Genres und neue Musik aus der Community.',
      charts: 'Charts',
      genres: 'Genres',
      newReleases: 'Neue Veröffentlichungen',
      communityPlaylists: 'Community-Playlists',
      openPlaylist: (name, owner, count) =>
        `${name} öffnen${owner ? `, von ${owner}` : ''}, ${count} Titel`,
      byOwner: (owner) => `von ${owner}`,
    },
    album: {
      typeLabel: 'ALBUM',
      loading: 'Album wird geladen…',
      empty: 'Dieses Album enthält keine verfügbaren Titel.',
      tracks: 'Titelliste',
      byArtist: (artist) => `Album von ${artist}`,
      runtime: (minutes) => {
        if (minutes < 60) return `${minutes} Min.`;
        return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
      },
    },
    genre: {
      loading: 'Genre wird geladen…',
      empty: 'Für dieses Genre sind gerade keine Inhalte verfügbar.',
      popularTracks: 'Beliebte Titel',
      albums: 'Alben',
      artists: 'Interpreten',
    },
    artist: {
      typeLabel: 'INTERPRET',
      loading: 'Interpret wird geladen…',
      empty: 'Für diesen Interpreten sind gerade keine Inhalte verfügbar.',
      topTracks: 'Beliebt',
      albums: 'Diskografie',
      relatedArtists: 'Ähnliche Interpreten',
      searchSongs: 'Songs durchsuchen',
      searchSongsPlaceholder: (name) => `Songs von ${name} suchen…`,
      searchSongsLabel: (name) => `Songs von ${name} suchen`,
      searchSongsLoading: 'Songs werden gesucht…',
      searchSongsEmpty: (query) => `Keine Songs für „${query}“ gefunden.`,
      searchSongsFailed: 'Songs konnten nicht geladen werden',
      trackPlayCount: (plays, listeners) =>
        `${plays.toLocaleString('de-DE')} Wiedergaben · ${listeners.toLocaleString('de-DE')} Hörer:innen (Last.fm)`,
      about: 'Über den Interpreten',
      aboutUnavailable: 'Keine Biografie verfügbar.',
      fans: (count) => `${count.toLocaleString('de-DE')} Fans`,
      albumsCount: (count) => `${count} Alben`,
      follow: 'Folgen',
      following: 'Gefolgt',
      followArtist: (name) => `${name} folgen`,
      unfollowArtist: (name) => `${name} nicht mehr folgen`,
      followLoading: 'Status wird geladen…',
      followUpdating: 'Wird aktualisiert…',
      followFailed: 'Folgen-Status konnte nicht geändert werden',
      followStateFailed: 'Folgen-Status konnte nicht geladen werden',
      listeners: (count) => `${count.toLocaleString('de-DE')} Hörer`,
      plays: (count) => `${count.toLocaleString('de-DE')} Wiedergaben`,
    },
  },
  en: {
    common: {
      retry: 'Retry',
      retrying: 'Retrying…',
      loading: 'Loading…',
      loadFailed: 'Content could not be loaded. Try again.',
      offline: 'You are offline. Connect and try again.',
      cachedOffline: 'You are offline. Saved content remains visible.',
      refreshing: 'Refreshing content…',
      stale: 'Showing saved content.',
      cachedRefreshFailed: 'Refresh failed. Saved content remains visible.',
      empty: 'There is nothing available here right now.',
      play: 'Play',
      playAll: 'Play all',
      playbackFailed: 'Playback failed',
      sectionLoading: (title) => `Loading ${title}…`,
      sectionEmpty: (title) => `There is nothing available for “${title}” right now.`,
      retrySection: (title) => `Reload ${title}`,
      tracks: (count) => `${count} ${count === 1 ? 'track' : 'tracks'}`,
      releaseYear: (year) => `Released ${year}`,
      openAlbum: (title, artist) => `Open album ${title} by ${artist}`,
      openArtist: (name) => `Open artist ${name}`,
      openGenre: (name) => `Open ${name} genre`,
      playTrack: (title, artist) => `Play ${title} by ${artist}`,
    },
    discover: {
      title: 'Discover',
      subtitle: 'Charts, genres, and new music from the community.',
      charts: 'Charts',
      genres: 'Genres',
      newReleases: 'New releases',
      communityPlaylists: 'Community playlists',
      openPlaylist: (name, owner, count) =>
        `Open ${name}${owner ? ` by ${owner}` : ''}, ${count} ${count === 1 ? 'track' : 'tracks'}`,
      byOwner: (owner) => `by ${owner}`,
    },
    album: {
      typeLabel: 'ALBUM',
      loading: 'Loading album…',
      empty: 'This album has no available tracks.',
      tracks: 'Track list',
      byArtist: (artist) => `Album by ${artist}`,
      runtime: (minutes) => {
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${minutes % 60} min`;
      },
    },
    genre: {
      loading: 'Loading genre…',
      empty: 'There is nothing available for this genre right now.',
      popularTracks: 'Popular tracks',
      albums: 'Albums',
      artists: 'Artists',
    },
    artist: {
      typeLabel: 'ARTIST',
      loading: 'Loading artist…',
      empty: 'There is nothing available for this artist right now.',
      topTracks: 'Popular tracks',
      albums: 'Discography',
      relatedArtists: 'Related artists',
      searchSongs: 'Search songs',
      searchSongsPlaceholder: (name) => `Search songs by ${name}…`,
      searchSongsLabel: (name) => `Search songs by ${name}`,
      searchSongsLoading: 'Searching songs…',
      searchSongsEmpty: (query) => `No songs found for “${query}”.`,
      searchSongsFailed: 'Could not load songs',
      trackPlayCount: (plays, listeners) =>
        `${plays.toLocaleString('en-US')} plays · ${listeners.toLocaleString('en-US')} listeners (Last.fm)`,
      about: 'About',
      aboutUnavailable: 'No biography is available.',
      fans: (count) => `${count.toLocaleString('en-US')} fans`,
      albumsCount: (count) => `${count} ${count === 1 ? 'album' : 'albums'}`,
      follow: 'Follow',
      following: 'Following',
      followArtist: (name) => `Follow ${name}`,
      unfollowArtist: (name) => `Unfollow ${name}`,
      followLoading: 'Loading status…',
      followUpdating: 'Updating…',
      followFailed: 'Could not update follow status',
      followStateFailed: 'Could not load follow status',
      listeners: (count) => `${count.toLocaleString('en-US')} listeners`,
      plays: (count) => `${count.toLocaleString('en-US')} plays`,
    },
  },
};

export const catalogStrings = createRuntimeCatalog(catalogScreenCatalogs);
