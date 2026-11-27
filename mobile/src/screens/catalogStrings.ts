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
    rateLimited: string;
    rateLimitedWait: (seconds: number) => string;
    cachedRateLimited: string;
    cachedRateLimitedWait: (seconds: number) => string;
    empty: string;
    play: string;
    playAll: string;
    playbackFailed: string;
    sectionLoading: (title: string) => string;
    sectionEmpty: (title: string) => string;
    retrySection: (title: string) => string;
    tracks: (count: number) => string;
    openAlbum: (title: string, artist: string) => string;
    openArtist: (name: string) => string;
    openGenre: (name: string) => string;
    playTrack: (title: string, artist: string) => string;
    refresh: string;
    refreshingNow: string;
    share: string;
    shareFailed: string;
  };
  discover: {
    title: string;
    charts: string;
    genres: string;
    newReleases: string;
    playlists: string;
    jumpToSection: (title: string) => string;
    openPlaylist: (name: string, owner: string | null, count: number) => string;
    openOwnPlaylist: (name: string, count: number) => string;
    byOwner: (owner: string) => string;
    ownPlaylist: string;
    collaborativeBadge: string;
    sharedBy: (owner: string) => string;
  };
  album: {
    typeLabel: string;
    loading: string;
    empty: string;
    tracks: string;
    runtime: (minutes: number) => string;
    download: string;
    removeDownload: string;
    downloading: string;
    downloaded: string;
    downloadFailed: string;
    removeDownloadFailed: string;
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
    likedTracks: string;
    likedTracksSummary: (count: number) => string;
    likedTracksFailed: string;
    showLikedTracks: string;
    hideLikedTracks: string;
    showAllLikedTracks: (name: string, count: number) => string;
    hideLikedTracksOf: (name: string) => string;
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
    clearSongSearch: string;
    showMoreAbout: string;
    showLessAbout: string;
    startTagRadio: (tag: string) => string;
    tagRadioFailed: (tag: string) => string;
    tagRadioEmpty: (tag: string) => string;
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
      rateLimited: 'Zu viele Anfragen. Bitte warte kurz und versuche es erneut.',
      rateLimitedWait: (seconds) => `Zu viele Anfragen. Versuche es in ${seconds} Sek. erneut.`,
      cachedRateLimited: 'Zu viele Anfragen. Gespeicherte Inhalte bleiben sichtbar.',
      cachedRateLimitedWait: (seconds) =>
        `Zu viele Anfragen. Versuche es in ${seconds} Sek. erneut. Gespeicherte Inhalte bleiben sichtbar.`,
      empty: 'Hier sind gerade keine Inhalte verfügbar.',
      play: 'Abspielen',
      playAll: 'Alle abspielen',
      playbackFailed: 'Wiedergabe fehlgeschlagen',
      sectionLoading: (title) => `${title} wird geladen…`,
      sectionEmpty: (title) => `Für „${title}“ sind gerade keine Inhalte verfügbar.`,
      retrySection: (title) => `${title} erneut laden`,
      tracks: (count) => `${count} Titel`,
      openAlbum: (title, artist) => `Album „${title}“ von ${artist} öffnen`,
      openArtist: (name) => `Interpret ${name} öffnen`,
      openGenre: (name) => `Genre ${name} öffnen`,
      playTrack: (title, artist) => `${title} von ${artist} abspielen`,
      refresh: 'Aktualisieren',
      refreshingNow: 'Wird aktualisiert…',
      share: 'Teilen',
      shareFailed: 'Link konnte nicht geteilt werden.',
    },
    discover: {
      title: 'Entdecken',
      charts: 'Charts',
      genres: 'Genres',
      newReleases: 'Neue Veröffentlichungen',
      playlists: 'Playlists',
      jumpToSection: (title) => `Zu ${title} springen`,
      openPlaylist: (name, owner, count) =>
        `${name} öffnen${owner ? `, von ${owner}` : ''}, ${count} Titel`,
      openOwnPlaylist: (name, count) => `${name} öffnen, von dir, ${count} Titel`,
      byOwner: (owner) => `von ${owner}`,
      ownPlaylist: 'Von dir',
      collaborativeBadge: 'Gemeinsam',
      sharedBy: (owner) => `Geteilt von ${owner}`,
    },
    album: {
      typeLabel: 'ALBUM',
      loading: 'Album wird geladen…',
      empty: 'Dieses Album enthält keine verfügbaren Titel.',
      tracks: 'Titelliste',
      runtime: (minutes) => {
        if (minutes < 60) return `${minutes} Min.`;
        return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
      },
      download: 'Album herunterladen',
      removeDownload: 'Album-Download entfernen',
      downloading: 'Wird heruntergeladen…',
      downloaded: 'Heruntergeladen',
      downloadFailed: 'Album konnte nicht heruntergeladen werden.',
      removeDownloadFailed: 'Album-Download konnte nicht entfernt werden.',
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
      likedTracks: 'Deine Lieblingssongs',
      likedTracksSummary: (count) => `${count} ${count === 1 ? 'Song' : 'Songs'}`,
      likedTracksFailed: 'Deine Lieblingssongs konnten nicht geladen werden',
      showLikedTracks: 'Anzeigen',
      hideLikedTracks: 'Ausblenden',
      showAllLikedTracks: (name, count) => `Alle ${count} Lieblingssongs von ${name} anzeigen`,
      hideLikedTracksOf: (name) => `Lieblingssongs von ${name} ausblenden`,
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
      clearSongSearch: 'Suche leeren',
      showMoreAbout: 'Mehr anzeigen',
      showLessAbout: 'Weniger anzeigen',
      startTagRadio: (tag) => `${tag}-Radio starten`,
      tagRadioFailed: (tag) => `${tag}-Radio konnte nicht gestartet werden.`,
      tagRadioEmpty: (tag) => `Für „${tag}“ wurden keine Radio-Titel gefunden.`,
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
      rateLimited: 'Too many requests. Wait a moment and try again.',
      rateLimitedWait: (seconds) => `Too many requests. Try again in ${seconds} s.`,
      cachedRateLimited: 'Too many requests. Saved content remains visible.',
      cachedRateLimitedWait: (seconds) =>
        `Too many requests. Try again in ${seconds} s. Saved content remains visible.`,
      empty: 'There is nothing available here right now.',
      play: 'Play',
      playAll: 'Play all',
      playbackFailed: 'Playback failed',
      sectionLoading: (title) => `Loading ${title}…`,
      sectionEmpty: (title) => `There is nothing available for “${title}” right now.`,
      retrySection: (title) => `Reload ${title}`,
      tracks: (count) => `${count} ${count === 1 ? 'track' : 'tracks'}`,
      openAlbum: (title, artist) => `Open album ${title} by ${artist}`,
      openArtist: (name) => `Open artist ${name}`,
      openGenre: (name) => `Open ${name} genre`,
      playTrack: (title, artist) => `Play ${title} by ${artist}`,
      refresh: 'Refresh',
      refreshingNow: 'Refreshing…',
      share: 'Share',
      shareFailed: 'Could not share the link.',
    },
    discover: {
      title: 'Discover',
      charts: 'Charts',
      genres: 'Genres',
      newReleases: 'New releases',
      playlists: 'Playlists',
      jumpToSection: (title) => `Jump to ${title}`,
      openPlaylist: (name, owner, count) =>
        `Open ${name}${owner ? ` by ${owner}` : ''}, ${count} ${count === 1 ? 'track' : 'tracks'}`,
      openOwnPlaylist: (name, count) =>
        `Open ${name}, by you, ${count} ${count === 1 ? 'track' : 'tracks'}`,
      byOwner: (owner) => `by ${owner}`,
      ownPlaylist: 'By you',
      collaborativeBadge: 'Collaborative',
      sharedBy: (owner) => `Shared by ${owner}`,
    },
    album: {
      typeLabel: 'ALBUM',
      loading: 'Loading album…',
      empty: 'This album has no available tracks.',
      tracks: 'Track list',
      runtime: (minutes) => {
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${minutes % 60} min`;
      },
      download: 'Download album',
      removeDownload: 'Remove album download',
      downloading: 'Downloading…',
      downloaded: 'Downloaded',
      downloadFailed: 'Could not download the album.',
      removeDownloadFailed: 'Could not remove album download.',
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
      likedTracks: 'Your liked songs',
      likedTracksSummary: (count) => `${count} ${count === 1 ? 'song' : 'songs'}`,
      likedTracksFailed: 'Could not load your liked songs',
      showLikedTracks: 'Show',
      hideLikedTracks: 'Hide',
      showAllLikedTracks: (name, count) => `Show all ${count} liked songs by ${name}`,
      hideLikedTracksOf: (name) => `Hide liked songs by ${name}`,
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
      clearSongSearch: 'Clear search',
      showMoreAbout: 'Show more',
      showLessAbout: 'Show less',
      startTagRadio: (tag) => `Start ${tag} radio`,
      tagRadioFailed: (tag) => `Could not start ${tag} radio.`,
      tagRadioEmpty: (tag) => `No radio tracks found for “${tag}”.`,
    },
  },
};

export const catalogStrings = createRuntimeCatalog(catalogScreenCatalogs);
