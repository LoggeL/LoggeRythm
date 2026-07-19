import type { QueueContextType } from '../player/queueContract';

export interface StringCatalog {
  common: {
    appName: string;
    retry: string;
    working: string;
    dismiss: string;
    cancel: string;
    play: string;
    pause: string;
    nextTrack: string;
    previousTrack: string;
    loading: string;
    trackBy: (title: string, artist: string) => string;
    trackCount: (count: number) => string;
  };
  shell: {
    offlineTitle: string;
    offlineBody: string;
    backOnlineTitle: string;
    backOnlineBody: string;
  };
  trackPresentation: {
    playing: string;
    paused: string;
    buffering: string;
    active: string;
    downloaded: string;
    serverCached: string;
    rollingDeviceCache: (duration: string) => string;
  };
  auth: {
    restoreFailedTitle: string;
    restoreFailedMessage: string;
    retryRestoreFailed: string;
    forgetSession: string;
    forgetSessionFailed: string;
    restoringSession: string;
    inviteLinkFailed: string;
    signInSubtitle: string;
    createAccountSubtitle: string;
    server: string;
    serverPlaceholder: string;
    serverCredentialNotice: string;
    serverInvalid: string;
    productionLinkServerChanged: string;
    displayName: string;
    email: string;
    password: string;
    confirmPassword: string;
    inviteOptional: string;
    signIn: string;
    createAccount: string;
    signingIn: string;
    creatingAccount: string;
    signInFailed: string;
    createAccountFailed: string;
    signedIn: string;
    accountCreated: string;
    signInInstead: string;
    createAccountInstead: string;
    existingAccountPrompt: string;
    newAccountPrompt: string;
    credentialsRequired: string;
    displayNameRequired: string;
    displayNameTooLong: string;
    emailRequired: string;
    emailInvalid: string;
    passwordRequired: string;
    passwordConfirmationRequired: string;
    passwordTooShort: string;
    passwordTooLong: string;
    passwordsDoNotMatch: string;
    approvalTitle: string;
    approvalBody: (email: string) => string;
    accountFallback: string;
    checkAgain: string;
    checkingApproval: string;
    approvalCheckFailed: string;
    approvalStillPending: string;
    approvalGranted: string;
    signOut: string;
    signingOut: string;
    logoutFailed: string;
    logoutFailedMessage: string;
    accountChangeFailed: string;
    accountCleanupFailed: string;
  };
  navigation: {
    home: string;
    search: string;
    discover: string;
    radio: string;
    library: string;
    profile: string;
    album: string;
    artist: string;
    genre: string;
    likedSongs: string;
    playlists: string;
    openProfile: string;
    profileUnavailable: string;
    invalidLinkTitle: string;
    invalidLinkBody: string;
    invalidLinkBack: string;
  };
  home: {
    greetingNight: string;
    greetingMorning: string;
    greetingDay: string;
    greetingEvening: string;
    greeting: (salutation: string, name: string | null) => string;
    subtitle: string;
    moods: {
      top: string;
      chill: string;
      focus: string;
      workout: string;
      party: string;
    };
    moodResults: (mood: string) => string;
    recentlyHeard: string;
    mixes: string;
    mixNotFound: string;
    releaseRadar: string;
    radarSubtitle: string;
    radarTypeLabel: string;
    radarEmpty: string;
    radarNewCount: (count: number) => string;
    radarSeenStateFailed: string;
    radarRelativeDate: {
      today: string;
      yesterday: string;
      daysAgo: (days: number) => string;
      oneWeekAgo: string;
      weeksAgo: (weeks: number) => string;
      oneMonthAgo: string;
      monthsAgo: (months: number) => string;
    };
    becauseYouListened: string;
    chartCollections: string;
    charts: string;
    newReleases: string;
    communityPlaylists: string;
    genres: string;
    sectionLoading: (title: string) => string;
    sectionEmpty: (title: string) => string;
    sectionLoadFailed: string;
    sectionRefreshing: string;
    sectionStale: string;
    sectionOffline: string;
    cachedOffline: string;
    cachedRefreshFailed: string;
    retrySection: (title: string) => string;
    playTrack: (title: string, artist: string) => string;
    playShelf: (title: string, count: number) => string;
    openShelf: (title: string, count: number) => string;
    openAlbum: (title: string, artist: string) => string;
    openArtist: (name: string) => string;
    openGenre: (name: string) => string;
    albumBy: (artist: string) => string;
    playFailed: string;
  };
  radio: {
    badge: string;
    title: string;
    subtitle: string;
    personalTitle: string;
    personalSubtitle: string;
    personalLoading: string;
    personalEmpty: string;
    personalResolutionFailed: string;
    moodsTitle: string;
    genresTitle: string;
    genresLoading: string;
    genresEmpty: string;
    startStation: (title: string) => string;
    starting: string;
    retryStation: (title: string) => string;
    stationEmpty: string;
    moodLoading: (title: string) => string;
    loadFailed: string;
    sectionOffline: string;
    cachedOffline: string;
    refreshing: string;
    stale: string;
    cachedRefreshFailed: string;
    startFailed: (title: string) => string;
    started: (title: string) => string;
    dismissError: string;
    genreRadio: (name: string) => string;
    moods: {
      chill: { title: string; subtitle: string };
      focus: { title: string; subtitle: string };
      workout: { title: string; subtitle: string };
      party: { title: string; subtitle: string };
    };
  };
  profile: {
    title: string;
    subtitle: string;
    accountTitle: string;
    member: string;
    administrator: string;
    approved: string;
    pendingApproval: string;
    serverOrigin: (origin: string) => string;
    avatarDeferred: string;
    languageTitle: string;
    languageSubtitle: string;
    languageGerman: string;
    languageEnglish: string;
    languageChanging: string;
    languageChanged: (language: string) => string;
    languageChangeFailed: string;
    editTitle: string;
    displayName: string;
    email: string;
    newPassword: string;
    confirmPassword: string;
    passwordHint: string;
    save: string;
    saving: string;
    saved: string;
    noChanges: string;
    saveFailed: string;
    validation: {
      displayNameRequired: string;
      displayNameTooLong: string;
      emailInvalid: string;
      passwordTooShort: string;
      passwordTooLong: string;
      passwordMismatch: string;
    };
    statsTitle: string;
    allTime: string;
    lastThirtyDays: string;
    plays: string;
    playCount: (count: number) => string;
    topTracks: string;
    topArtists: string;
    statsLoading: string;
    statsRefreshing: string;
    statsEmpty: string;
    statsLoadFailed: string;
    statsOffline: string;
    statsCachedOffline: string;
    statsStale: string;
    statsRefreshFailed: string;
    refreshStats: string;
    sleepTitle: string;
    sleepSubtitle: string;
    timerOff: string;
    timerRemaining: (remaining: string) => string;
    timerEndOfTrack: string;
    minutes: (minutes: number) => string;
    endOfTrack: string;
    currentTrackRemaining: string;
    cancelTimer: string;
    noActiveTrack: string;
    noRemainingTime: string;
    sleepSetFailed: string;
    update: {
      title: string;
      checking: string;
      current: (version: string) => string;
      available: (version: string, megabytes: number) => string;
      install: string;
      downloading: string;
      retryInstall: string;
      permission: string;
      confirm: (version: string) => string;
      failed: string;
      safety: string;
    };
    dangerTitle: string;
    dangerBody: string;
    deleteAccount: string;
    deleteTitle: string;
    deleteWarning: string;
    deleteCancel: string;
    deleteConfirm: string;
    deleting: string;
    deleteFailed: string;
  };
  player: {
    preparing: string;
    startFailedTitle: string;
    startFailedMessage: string;
    playerErrorDismiss: string;
    autoLibraryFailed: string;
    autoLibraryRefreshFailedMessage: string;
    autoLibraryReadyLog: string;
    notificationChannelName: string;
    autoLikedSongs: string;
    autoPlaylists: string;
    autoDownloads: string;
    autoDownloadedProgress: (downloaded: number, total: number) => string;
    bookkeepingFailedTitle: string;
    bookkeepingFailedMessage: string;
    recovery: {
      stoppedTitle: string;
      skippedTitle: string;
      failedTitle: string;
      attempts: (count: number) => string;
      explanations: {
        network: string;
        session: string;
        authorization: string;
        source: string;
        backend: string;
        renderer: string;
        unknown: string;
      };
      sessionExpired: (title: string) => string;
      skipped: (title: string, attempts: string, reason: string) => string;
      skipFailed: (title: string, attempts: string) => string;
      stopped: (title: string, attempts: string, reason: string, atQueueEnd: boolean) => string;
      noActiveTrack: string;
      unexpected: string;
      pauseFailed: string;
    };
    openNowPlaying: (title: string, artist: string) => string;
    openQueue: string;
    closeNowPlaying: string;
    nothingPlaying: string;
    nowPlayingTabs: {
      label: string;
      playing: string;
      lyrics: string;
      similar: string;
    };
    similar: {
      title: string;
      loading: string;
      empty: string;
      loadFailed: string;
      offline: string;
      retry: string;
      refreshing: string;
      cachedOffline: string;
      cachedRefreshFailed: string;
      stale: string;
      playFailed: string;
      actionFailed: string;
      context: (seedTitle: string) => string;
      started: (title: string) => string;
    };
    lyrics: {
      title: string;
      loading: string;
      empty: string;
      loadFailed: string;
      offline: string;
      retry: string;
      refreshing: string;
      cachedOffline: string;
      cachedRefreshFailed: string;
      stale: string;
      synchronized: string;
      aiGenerated: string;
      cached: string;
      source: (provider: string) => string;
      sources: {
        lrclib: string;
        loggerythmAi: string;
        external: string;
      };
      instrumentalLine: string;
      lineLabel: (text: string, timestamp: string) => string;
      lineSeekHint: string;
    };
    playbackPosition: string;
    buffering: string;
    likeTrack: string;
    unlikeTrack: string;
    likeFailed: string;
    likedTrack: (title: string) => string;
    unlikedTrack: (title: string) => string;
    likeStateUnavailable: (title: string) => string;
    likeStateLoading: (title: string) => string;
    retryLikeState: (title: string) => string;
    likeStateOffline: string;
    likeStateLoadFailed: string;
    likeStateRefreshing: string;
    likeStateStale: string;
    enableShuffle: string;
    disableShuffle: string;
    changeRepeatMode: string;
    repeatOff: string;
    repeatAll: string;
    repeatOne: string;
    playPauseFailed: string;
    nextFailed: string;
    previousFailed: string;
    seekFailed: string;
    shuffleFailed: string;
    repeatFailed: string;
  };
  search: {
    inputLabel: string;
    placeholder: string;
    clear: string;
    preparing: string;
    searching: string;
    minimumQueryHint: string;
    noResults: string;
    noResultsFor: (query: string) => string;
    partialError: string;
    remoteOffline: (section: string) => string;
    remoteLoadFailed: (section: string) => string;
    remoteCachedOffline: (section: string) => string;
    remoteCachedRefreshFailed: (section: string) => string;
    remoteLoading: (section: string) => string;
    remoteRefreshing: (section: string) => string;
    remoteStale: (section: string) => string;
    retrySection: (section: string) => string;
    metadataTitle: string;
    tabs: {
      all: string;
      track: string;
      album: string;
      artist: string;
      playlist: string;
    };
    sortLabel: string;
    sorts: {
      relevance: string;
      title: string;
      durationAscending: string;
      durationDescending: string;
    };
    browseTitle: string;
    browsePrompt: string;
    browseLoading: string;
    trackDuration: (duration: string) => string;
    trackPlayCount: (plays: number, listeners: number) => string;
    trackPopularity: (percent: number) => string;
    trackDeviceCache: (duration: string) => string;
    trackServerCached: string;
    playlistLoading: string;
    playlistLoadFailed: string;
    playFailed: string;
    importTitle: string;
    importOpen: string;
    importClose: string;
    importIntro: string;
    importInputLabel: string;
    importPlaceholder: string;
    importResolve: string;
    importResolving: string;
    importInvalid: string;
    importAmbiguous: string;
    importTooLong: string;
    importResolveFailed: string;
    importType: { track: string; album: string; playlist: string };
    importMatched: (matched: number, total: number) => string;
    importUnmatched: (count: number) => string;
    importTruncated: (sourceTotal: number, processed: number) => string;
    importPlayAll: string;
    importSaveTitle: string;
    importNewPlaylistName: string;
    importCreateAndSave: string;
    importExistingPlaylists: string;
    importNoPlaylists: string;
    importSaveToPlaylist: (name: string) => string;
    importSaving: string;
    importSaved: (added: number, name: string) => string;
    importSaveFailed: string;
    importUnmatchedTitle: string;
    sections: {
      tracks: string;
      albums: string;
      artists: string;
      playlists: string;
    };
    openAlbum: (title: string, artist: string) => string;
    openArtist: (name: string) => string;
    openPlaylist: (title: string, count: number) => string;
    openGenre: (name: string) => string;
  };
  library: {
    openLikedSongs: string;
    noPlaylists: string;
    playlistLabel: (name: string, count: number) => string;
    loadingPlaylists: string;
  };
  playlist: {
    noTracks: string;
    loadingTracks: string;
  };
  trackActions: {
    moreActionsHint: string;
    moreActionsLabel: string;
    playNext: string;
    addToQueue: string;
    startRadio: string;
    addToPlaylist: string;
    openAlbum: (title: string) => string;
    openArtist: (name: string) => string;
    remove: string;
    removeFailed: string;
    removeSucceeded: (title: string) => string;
    navigationUnavailable: string;
    addToPlaylistTitle: string;
    addToPlaylistFailed: string;
    addToPlaylistSucceeded: (title: string) => string;
    addToNamedPlaylist: (title: string, playlist: string) => string;
    addToNamedPlaylistSucceeded: (title: string, playlist: string) => string;
    newPlaylist: string;
    newPlaylistName: string;
    createAndAdd: string;
    createPlaylistFailed: string;
    loadingPlaylists: string;
    noPlaylists: string;
    playlistTrackCount: (count: number) => string;
    close: string;
    back: string;
    backToPlaylists: string;
    playNextFailed: string;
    addToQueueFailed: string;
    startRadioFailed: string;
    actionFailed: string;
    playNextSucceeded: (title: string) => string;
    addToQueueSucceeded: (title: string) => string;
    startRadioSucceeded: (title: string) => string;
  };
  queue: {
    title: string;
    upcomingCount: (count: number) => string;
    close: string;
    done: string;
    loading: string;
    emptyTitle: string;
    emptyDetail: string;
    shuffle: string;
    restoreOrder: string;
    clearUpcoming: string;
    clearUpcomingHint: string;
    clearUpcomingFailed: string;
    shuffleEnabled: string;
    orderRestored: string;
    clearedUpcoming: (count: number) => string;
    historySection: string;
    currentSection: string;
    manualSection: string;
    contextSection: (label: string) => string;
    unknownContext: string;
    legacyContextLabel: (type: QueueContextType) => string;
    searchContext: (query: string) => string;
    recentContext: string;
    trackRadioContext: (title: string) => string;
    manualPriority: string;
    currentlyPlaying: string;
    currentTrackSuffix: string;
    skipHint: string;
    loadFailed: string;
    skipLabel: (title: string, artist: string, active: boolean) => string;
    skipFailed: (title: string) => string;
    skippedTo: (title: string) => string;
    moveUp: (title: string) => string;
    moveDown: (title: string) => string;
    moveUpFailed: (title: string) => string;
    moveDownFailed: (title: string) => string;
    movedUp: (title: string) => string;
    movedDown: (title: string) => string;
    remove: (title: string) => string;
    cannotRemoveCurrent: (title: string) => string;
    removeFailed: (title: string) => string;
    removed: (title: string) => string;
  };
}

export const de: StringCatalog = {
  common: {
    appName: 'LoggeRythm',
    retry: 'Erneut versuchen',
    working: 'Wird ausgeführt…',
    dismiss: 'Schließen',
    cancel: 'Abbrechen',
    play: 'Wiedergabe starten',
    pause: 'Wiedergabe pausieren',
    nextTrack: 'Nächster Titel',
    previousTrack: 'Vorheriger Titel',
    loading: 'Wird geladen…',
    trackBy: (title, artist) => `${title} von ${artist}`,
    trackCount: (count) => `${count} ${count === 1 ? 'Titel' : 'Titel'}`,
  },
  shell: {
    offlineTitle: 'Offline',
    offlineBody: 'Nur heruntergeladene Musik ist verfügbar. Online-Inhalte kehren mit der Verbindung zurück.',
    backOnlineTitle: 'Wieder online',
    backOnlineBody: 'Online-Inhalte sind wieder verfügbar.',
  },
  trackPresentation: {
    playing: 'Wird wiedergegeben',
    paused: 'Wiedergabe pausiert',
    buffering: 'Titel wird gepuffert…',
    active: 'Aktueller Titel',
    downloaded: 'Heruntergeladen',
    serverCached: 'Auf dem Server gespeichert',
    rollingDeviceCache: (duration) => `Automatischer Gerätecache ${duration}`,
  },
  auth: {
    restoreFailedTitle: 'Sitzung konnte nicht wiederhergestellt werden',
    restoreFailedMessage:
      'Deine Sitzung konnte nicht wiederhergestellt werden. Prüfe die Verbindung und versuche es erneut.',
    retryRestoreFailed: 'Die Sitzung konnte nicht erneut geprüft werden. Versuche es noch einmal.',
    forgetSession: 'Sitzung verwerfen und anmelden',
    forgetSessionFailed:
      'Die gespeicherte Sitzung konnte auf diesem Gerät nicht sicher verworfen werden. Versuche es erneut.',
    restoringSession: 'Sitzung wird wiederhergestellt…',
    inviteLinkFailed:
      'Der Einladungslink konnte nicht geöffnet werden. Gib den Einladungscode bei Bedarf manuell ein.',
    signInSubtitle: 'Melde dich bei deiner Mediathek an',
    createAccountSubtitle: 'Erstelle dein Konto',
    server: 'Server-URL',
    serverPlaceholder: 'https://dein-server.example',
    serverCredentialNotice:
      'Nutze nur einen vertrauenswürdigen Server. Dessen Betreiber erhält E-Mail, Passwort und ggf. Einladungscode.',
    serverInvalid: 'Gib eine gültige HTTPS-Server-URL ohne Pfad ein.',
    productionLinkServerChanged:
      'Der Link gehört zum LoggeRythm-Produktionsserver. Zum Schutz deiner Anmeldedaten wurde das Formular vor dem Serverwechsel geleert.',
    displayName: 'Anzeigename',
    email: 'E-Mail-Adresse',
    password: 'Passwort',
    confirmPassword: 'Passwort bestätigen',
    inviteOptional: 'Einladungscode (optional)',
    signIn: 'Anmelden',
    createAccount: 'Konto erstellen',
    signingIn: 'Anmeldung läuft…',
    creatingAccount: 'Konto wird erstellt…',
    signInFailed: 'Die Anmeldung ist fehlgeschlagen. Prüfe deine Angaben und versuche es erneut.',
    createAccountFailed:
      'Das Konto konnte nicht erstellt werden. Prüfe deine Angaben und versuche es erneut.',
    signedIn: 'Anmeldung erfolgreich.',
    accountCreated: 'Konto wurde erstellt.',
    signInInstead: 'Stattdessen anmelden',
    createAccountInstead: 'Konto erstellen',
    existingAccountPrompt: 'Du hast bereits ein Konto? Anmelden',
    newAccountPrompt: 'Neu hier? Konto erstellen',
    credentialsRequired: 'E-Mail-Adresse und Passwort sind erforderlich.',
    displayNameRequired: 'Ein Anzeigename ist erforderlich.',
    displayNameTooLong: 'Der Anzeigename darf höchstens 120 Zeichen lang sein.',
    emailRequired: 'Eine E-Mail-Adresse ist erforderlich.',
    emailInvalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
    passwordRequired: 'Ein Passwort ist erforderlich.',
    passwordConfirmationRequired: 'Bitte bestätige das Passwort.',
    passwordTooShort: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
    passwordTooLong: 'Das Passwort darf höchstens 128 Zeichen lang sein.',
    passwordsDoNotMatch: 'Die Passwörter stimmen nicht überein.',
    approvalTitle: 'Freigabe ausstehend',
    approvalBody: (email) =>
      `${email} ist angemeldet. Ein Administrator muss das Konto noch freigeben.`,
    accountFallback: 'Dieses Konto',
    checkAgain: 'Erneut prüfen',
    checkingApproval: 'Freigabe wird geprüft…',
    approvalCheckFailed: 'Die Freigabe konnte nicht geprüft werden. Versuche es erneut.',
    approvalStillPending: 'Die Freigabe steht weiterhin aus.',
    approvalGranted: 'Das Konto wurde freigegeben.',
    signOut: 'Abmelden',
    signingOut: 'Wird abgemeldet…',
    logoutFailed: 'Abmelden fehlgeschlagen',
    logoutFailedMessage:
      'Die Abmeldung konnte auf diesem Gerät nicht sicher abgeschlossen werden. Versuche es erneut.',
    accountChangeFailed:
      'Dieses Gerät konnte nicht sicher für ein anderes Konto vorbereitet werden. Versuche es erneut.',
    accountCleanupFailed:
      'Die vorherige Sitzung konnte auf diesem Gerät nicht vollständig bereinigt werden. Versuche es erneut.',
  },
  navigation: {
    home: 'Start',
    search: 'Suche',
    discover: 'Entdecken',
    radio: 'Radio',
    library: 'Mediathek',
    profile: 'Profil',
    album: 'Album',
    artist: 'Künstler:in',
    genre: 'Genre',
    likedSongs: 'Lieblingstitel',
    playlists: 'Playlists',
    openProfile: 'Profil öffnen',
    profileUnavailable: 'Das Profil kann gerade nicht geöffnet werden.',
    invalidLinkTitle: 'Dieser Link ist ungültig',
    invalidLinkBody: 'Der angeforderte Inhalt konnte nicht sicher geöffnet werden.',
    invalidLinkBack: 'Zurück zur App',
  },
  home: {
    greetingNight: 'Gute Nacht',
    greetingMorning: 'Guten Morgen',
    greetingDay: 'Guten Tag',
    greetingEvening: 'Guten Abend',
    greeting: (salutation, name) => `${salutation}${name ? `, ${name}` : ''} 👋`,
    subtitle: 'Entdecke neue Musik, die dich bewegt.',
    moods: { top: 'Top-Auswahl', chill: 'Chill', focus: 'Fokus', workout: 'Workout', party: 'Party' },
    moodResults: (mood) => `${mood} für dich`,
    recentlyHeard: 'Zuletzt gehört',
    mixes: 'Für dich',
    mixNotFound: 'Diese persönliche Playlist wurde nicht gefunden.',
    releaseRadar: 'Dein Release Radar',
    radarSubtitle: 'Neues von Künstler:innen, die du hörst und folgst',
    radarTypeLabel: 'Playlist',
    radarEmpty:
      'Noch keine frischen Releases von deinen Künstler:innen. Folge Artists oder höre mehr, dann füllt sich dein Radar.',
    radarNewCount: (count) => `${count} neu`,
    radarSeenStateFailed: 'Der Gesehen-Status des Release Radars konnte nicht geladen werden.',
    radarRelativeDate: {
      today: 'heute',
      yesterday: 'gestern',
      daysAgo: (days) => `vor ${days} Tagen`,
      oneWeekAgo: 'vor 1 Woche',
      weeksAgo: (weeks) => `vor ${weeks} Wochen`,
      oneMonthAgo: 'vor 1 Monat',
      monthsAgo: (months) => `vor ${months} Monaten`,
    },
    becauseYouListened: 'Weil du das gehört hast',
    chartCollections: 'Chart-Sammlungen',
    charts: 'Charts',
    newReleases: 'Neue Veröffentlichungen',
    communityPlaylists: 'Playlists der Community',
    genres: 'Genres',
    sectionLoading: (title) => `${title} wird geladen…`,
    sectionEmpty: (title) => `Für „${title}“ sind gerade keine Inhalte verfügbar.`,
    sectionLoadFailed: 'Inhalte konnten nicht geladen werden. Versuche es erneut.',
    sectionRefreshing: 'Inhalte werden aktualisiert…',
    sectionStale: 'Gespeicherte Inhalte werden angezeigt.',
    sectionOffline: 'Keine Verbindung. Stelle die Verbindung wieder her und versuche es erneut.',
    cachedOffline: 'Du bist offline. Gespeicherte Inhalte bleiben sichtbar.',
    cachedRefreshFailed: 'Die Aktualisierung ist fehlgeschlagen. Gespeicherte Inhalte bleiben sichtbar.',
    retrySection: (title) => `${title} erneut laden`,
    playTrack: (title, artist) => `${title} von ${artist} abspielen`,
    playShelf: (title, count) => `${title} abspielen, ${count} Titel`,
    openShelf: (title, count) => `${title} öffnen, ${count} Titel`,
    openAlbum: (title, artist) => `Album „${title}“ von ${artist} öffnen`,
    openArtist: (name) => `${name} öffnen`,
    openGenre: (name) => `Genre ${name} öffnen`,
    albumBy: (artist) => `von ${artist}`,
    playFailed: 'Wiedergabe der Startseite fehlgeschlagen',
  },
  radio: {
    badge: 'RADIO',
    title: 'Radio',
    subtitle: 'Endlose Musik, abgestimmt auf deinen Geschmack.',
    personalTitle: 'Für dich gemacht',
    personalSubtitle: 'Radios auf Basis deiner zuletzt gehörten Titel.',
    personalLoading: 'Deine persönlichen Radios werden vorbereitet…',
    personalEmpty: 'Höre ein paar Titel, dann bauen wir hier Radios für dich.',
    personalResolutionFailed: 'Einige zuletzt gehörte Titel konnten nicht geladen werden.',
    moodsTitle: 'Stimmungs-Radios',
    genresTitle: 'Genre-Radios',
    genresLoading: 'Genres werden geladen…',
    genresEmpty: 'Keine Genres verfügbar.',
    startStation: (title) => `${title} starten`,
    starting: 'Wird gestartet…',
    retryStation: (title) => `${title} erneut laden`,
    stationEmpty: 'Keine Titel verfügbar',
    moodLoading: (title) => `${title} wird geladen…`,
    loadFailed: 'Die Radios konnten nicht geladen werden.',
    sectionOffline: 'Du bist offline. Stelle eine Verbindung her und versuche es erneut.',
    cachedOffline: 'Du bist offline. Gespeicherte Radios bleiben verfügbar.',
    refreshing: 'Radios werden aktualisiert…',
    stale: 'Gespeicherte Radios werden angezeigt.',
    cachedRefreshFailed: 'Die Aktualisierung ist fehlgeschlagen. Gespeicherte Radios bleiben verfügbar.',
    startFailed: (title) => `${title} konnte nicht gestartet werden`,
    started: (title) => `${title} wurde gestartet.`,
    dismissError: 'Radio-Fehler schließen',
    genreRadio: (name) => `${name}-Radio`,
    moods: {
      chill: { title: 'Chill-Radio', subtitle: 'Entspannte Töne für ruhige Momente' },
      focus: { title: 'Fokus-Radio', subtitle: 'Konzentriert bleiben, ohne Ablenkung' },
      workout: { title: 'Workout-Radio', subtitle: 'Energie für dein Training' },
      party: { title: 'Party-Radio', subtitle: 'Voller Beats für die Nacht' },
    },
  },
  profile: {
    title: 'Profil',
    subtitle: 'Konto, Hörstatistik und Wiedergabe-Timer verwalten.',
    accountTitle: 'Dein Konto',
    member: 'Mitglied',
    administrator: 'Administrator',
    approved: 'Freigegeben',
    pendingApproval: 'Freigabe ausstehend',
    serverOrigin: (origin) => `Server: ${origin}`,
    avatarDeferred: 'Das Profilbild kann derzeit nur im Web geändert werden.',
    languageTitle: 'Sprache',
    languageSubtitle: 'Gilt für die LoggeRythm-App auf diesem Gerät.',
    languageGerman: 'Deutsch',
    languageEnglish: 'Englisch',
    languageChanging: 'Sprache wird gespeichert…',
    languageChanged: (language) => `Sprache auf ${language} geändert.`,
    languageChangeFailed: 'Die Sprache konnte nicht gespeichert werden.',
    editTitle: 'Kontodaten bearbeiten',
    displayName: 'Anzeigename',
    email: 'E-Mail-Adresse',
    newPassword: 'Neues Passwort',
    confirmPassword: 'Neues Passwort bestätigen',
    passwordHint: 'Leer lassen, um das aktuelle Passwort zu behalten.',
    save: 'Änderungen speichern',
    saving: 'Wird gespeichert…',
    saved: 'Änderungen wurden gespeichert.',
    noChanges: 'Keine Änderungen zum Speichern.',
    saveFailed: 'Änderungen konnten nicht gespeichert werden',
    validation: {
      displayNameRequired: 'Der Anzeigename darf nicht leer sein.',
      displayNameTooLong: 'Der Anzeigename darf höchstens 120 Zeichen lang sein.',
      emailInvalid: 'Gib eine gültige E-Mail-Adresse ein.',
      passwordTooShort: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
      passwordTooLong: 'Das Passwort darf höchstens 128 Zeichen lang sein.',
      passwordMismatch: 'Die Passwörter stimmen nicht überein.',
    },
    statsTitle: 'Hörstatistik',
    allTime: 'Gesamt',
    lastThirtyDays: 'Letzte 30 Tage',
    plays: 'Wiedergaben',
    playCount: (count) => `${count} ${count === 1 ? 'Wiedergabe' : 'Wiedergaben'}`,
    topTracks: 'Top-Titel',
    topArtists: 'Top-Künstler',
    statsLoading: 'Hörstatistik wird geladen…',
    statsRefreshing: 'Hörstatistik wird aktualisiert…',
    statsEmpty: 'Noch keine Höraktivität vorhanden.',
    statsLoadFailed: 'Die Hörstatistik konnte nicht geladen werden.',
    statsOffline: 'Du bist offline. Stelle eine Verbindung her und versuche es erneut.',
    statsCachedOffline: 'Du bist offline. Gespeicherte Hörstatistik bleibt sichtbar.',
    statsStale: 'Gespeicherte Hörstatistik wird angezeigt.',
    statsRefreshFailed: 'Aktualisierung fehlgeschlagen. Gespeicherte Statistik bleibt sichtbar.',
    refreshStats: 'Hörstatistik erneut laden',
    sleepTitle: 'Sleep-Timer',
    sleepSubtitle: 'Wiedergabe nach einer Zeitspanne oder am Titelende pausieren.',
    timerOff: 'Kein Sleep-Timer aktiv',
    timerRemaining: (remaining) => `Verbleibende Zeit: ${remaining}`,
    timerEndOfTrack: 'Wiedergabe endet nach dem aktuellen Titel.',
    minutes: (minutes) => `${minutes} Min.`,
    endOfTrack: 'Am Titelende',
    currentTrackRemaining: 'Aktuelle Restzeit',
    cancelTimer: 'Sleep-Timer abbrechen',
    noActiveTrack: 'Für diese Aktion muss ein Titel aktiv sein.',
    noRemainingTime: 'Für den aktuellen Titel ist keine Restzeit verfügbar.',
    sleepSetFailed: 'Sleep-Timer konnte nicht geändert werden',
    update: {
      title: 'Android-Updates',
      checking: 'GitHub Releases werden auf eine neue stabile Version geprüft…',
      current: (version) => `Version ${version} ist aktuell.`,
      available: (version, megabytes) =>
        `Version ${version} ist verfügbar (${megabytes} MB).`,
      install: 'Update laden',
      downloading: 'Update wird geprüft und geladen…',
      retryInstall: 'Berechtigung prüfen und fortfahren',
      permission:
        'Erlaube LoggeRythm in den Android-Einstellungen Updates zu installieren und tippe danach erneut.',
      confirm: (version) =>
        `Version ${version} wurde sicher geprüft. Bestätige die Installation im Android-Dialog.`,
      failed: 'Update fehlgeschlagen',
      safety:
        'Es werden nur stabile APKs aus LoggeL/LoggeRythm akzeptiert. SHA-256, Paketname, Version und App-Signatur werden vor der Android-Bestätigung geprüft.',
    },
    dangerTitle: 'Gefahrenbereich',
    dangerBody: 'Das Konto und alle zugehörigen Daten werden dauerhaft gelöscht.',
    deleteAccount: 'Konto löschen',
    deleteTitle: 'Konto dauerhaft löschen?',
    deleteWarning: 'Dieser Vorgang kann nicht rückgängig gemacht werden. Playlists, Likes und Hörverlauf werden gelöscht.',
    deleteCancel: 'Konto behalten',
    deleteConfirm: 'Endgültig löschen',
    deleting: 'Konto wird gelöscht…',
    deleteFailed: 'Konto konnte nicht gelöscht werden',
  },
  player: {
    preparing: 'Audiowiedergabe wird vorbereitet…',
    startFailedTitle: 'Audiowiedergabe konnte nicht gestartet werden',
    startFailedMessage: 'Die Audiowiedergabe konnte nicht vorbereitet werden. Versuche es erneut.',
    playerErrorDismiss: 'Player-Fehler schließen',
    autoLibraryFailed: 'Android-Auto-Mediathek konnte nicht geladen werden',
    autoLibraryRefreshFailedMessage:
      'Die Wiedergabe bleibt verfügbar. Die Android-Auto-Mediathek wird beim nächsten Aktualisieren erneut geladen.',
    autoLibraryReadyLog: '[LoggeRythm] Android-Auto-Mediathek ist bereit',
    notificationChannelName: 'Wiedergabe',
    autoLikedSongs: 'Lieblingstitel',
    autoPlaylists: 'Playlists',
    autoDownloads: 'Downloads',
    autoDownloadedProgress: (downloaded, total) =>
      `${downloaded} von ${total} Titeln heruntergeladen`,
    bookkeepingFailedTitle: 'Wiedergabedaten konnten nicht aktualisiert werden',
    bookkeepingFailedMessage:
      'Wiedergabe und Warteschlange bleiben verfügbar. Hörverlauf oder Radio konnten nicht aktualisiert werden.',
    recovery: {
      stoppedTitle: 'Wiedergabe angehalten',
      skippedTitle: 'Titel übersprungen',
      failedTitle: 'Wiederherstellung der Wiedergabe fehlgeschlagen',
      attempts: (count) =>
        count === 1 ? '1 Wiederherstellungsversuch' : `${count} Wiederherstellungsversuchen`,
      explanations: {
        network: 'das Netzwerk nicht verfügbar blieb oder die Anfrage ablief',
        session: 'die Anmeldesitzung abgelaufen ist',
        authorization: 'der Server den Zugriff auf diesen Titel verweigert hat',
        source: 'die Titelquelle fehlte oder den angeforderten Bereich abgelehnt hat',
        backend: 'der Server den vollständigen Titel nicht bereitstellen konnte',
        renderer: 'das Gerät diesen Titel nicht dekodieren oder wiedergeben konnte',
        unknown: 'der Wiedergabefehler nicht sicher eingeordnet werden konnte',
      },
      sessionExpired: (title) =>
        `Deine Sitzung ist beim Laden von „${title}“ abgelaufen. Melde dich erneut an. Die Warteschlange wurde beibehalten.`,
      skipped: (title, attempts, reason) =>
        `„${title}“ wurde nach ${attempts} übersprungen, weil ${reason}.`,
      skipFailed: (title, attempts) =>
        `„${title}“ konnte nach ${attempts} nicht sicher übersprungen werden. Die Wiedergabe wurde angehalten und die Warteschlange beibehalten.`,
      stopped: (title, attempts, reason, atQueueEnd) =>
        `„${title}“ konnte nach ${attempts} nicht wiederhergestellt werden, weil ${reason}.${
          atQueueEnd ? ' Der Titel befindet sich am Ende der Warteschlange.' : ''
        } Die Wiedergabe wurde angehalten und die Warteschlange beibehalten.`,
      noActiveTrack:
        'Der native Player ist ohne aktiven Titel ausgefallen. Die Wiedergabe wurde angehalten.',
      unexpected:
        'Bei der Wiederherstellung ist ein unerwarteter Fehler aufgetreten. Die Wiedergabe wurde angehalten und die Warteschlange beibehalten.',
      pauseFailed: 'Der native Player konnte zusätzlich nicht angehalten werden.',
    },
    openNowPlaying: (title, artist) => `Aktuelle Wiedergabe öffnen: ${title} von ${artist}`,
    openQueue: 'Warteschlange öffnen',
    closeNowPlaying: 'Aktuelle Wiedergabe schließen',
    nothingPlaying: 'Aktuell wird nichts wiedergegeben.',
    nowPlayingTabs: {
      label: 'Ansicht der aktuellen Wiedergabe',
      playing: 'Jetzt läuft',
      lyrics: 'Songtext',
      similar: 'Ähnliche Titel',
    },
    similar: {
      title: 'Ähnliche Titel',
      loading: 'Ähnliche Titel werden geladen…',
      empty: 'Für diesen Titel wurden keine ähnlichen Songs gefunden.',
      loadFailed: 'Ähnliche Titel konnten nicht geladen werden.',
      offline: 'Du bist offline. Stelle eine Verbindung her und versuche es erneut.',
      retry: 'Ähnliche Titel erneut laden',
      refreshing: 'Ähnliche Titel werden aktualisiert…',
      cachedOffline: 'Du bist offline. Gespeicherte ähnliche Titel bleiben sichtbar.',
      cachedRefreshFailed:
        'Die Aktualisierung ist fehlgeschlagen. Gespeicherte ähnliche Titel bleiben sichtbar.',
      stale: 'Gespeicherte ähnliche Titel werden angezeigt.',
      playFailed: 'Ähnliche Titel konnten nicht wiedergegeben werden.',
      actionFailed: 'Die Titelaktion konnte nicht ausgeführt werden.',
      context: (seedTitle) => `Ähnliche Titel zu „${seedTitle}“`,
      started: (title) => `„${title}“ aus den ähnlichen Titeln wird wiedergegeben.`,
    },
    lyrics: {
      title: 'Songtext',
      loading: 'Songtext wird geladen…',
      empty: 'Für diesen Titel ist kein Songtext verfügbar.',
      loadFailed: 'Songtext konnte nicht geladen werden.',
      offline: 'Du bist offline. Stelle eine Verbindung her und versuche es erneut.',
      retry: 'Songtext erneut laden',
      refreshing: 'Songtext wird aktualisiert…',
      cachedOffline: 'Du bist offline. Der gespeicherte Songtext bleibt sichtbar.',
      cachedRefreshFailed:
        'Die Aktualisierung ist fehlgeschlagen. Der gespeicherte Songtext bleibt sichtbar.',
      stale: 'Gespeicherter Songtext wird angezeigt.',
      synchronized: 'Synchronisiert',
      aiGenerated: 'KI-transkribiert',
      cached: 'Vom Server gespeichert',
      source: (provider) => `Quelle: ${provider}`,
      sources: {
        lrclib: 'LRCLIB',
        loggerythmAi: 'LoggeRythm AI',
        external: 'Externe Quelle',
      },
      instrumentalLine: '♪',
      lineLabel: (text, timestamp) => `${text}, bei ${timestamp}`,
      lineSeekHint: 'Springt zu dieser Stelle im Titel',
    },
    playbackPosition: 'Wiedergabeposition',
    buffering: 'Titel wird gepuffert…',
    likeTrack: 'Titel mit „Gefällt mir“ markieren',
    unlikeTrack: '„Gefällt mir“ entfernen',
    likeFailed: '„Gefällt mir“ konnte nicht geändert werden',
    likedTrack: (title) => `„${title}“ wurde mit „Gefällt mir“ markiert.`,
    unlikedTrack: (title) => `„Gefällt mir“ wurde für „${title}“ entfernt.`,
    likeStateUnavailable: (title) => `„Gefällt mir“-Status für „${title}“ nicht verfügbar`,
    likeStateLoading: (title) => `„Gefällt mir“-Status für „${title}“ wird geladen`,
    retryLikeState: (title) => `„Gefällt mir“-Status für „${title}“ erneut laden`,
    likeStateOffline: 'Du bist offline. Erneut versuchen, sobald eine Verbindung besteht.',
    likeStateLoadFailed: 'Der Status konnte nicht geladen werden. Erneut versuchen.',
    likeStateRefreshing: 'Der gespeicherte Status wird im Hintergrund aktualisiert.',
    likeStateStale: 'Gespeicherter „Gefällt mir“-Status wird angezeigt.',
    enableShuffle: 'Zufällige Wiedergabe aktivieren',
    disableShuffle: 'Zufällige Wiedergabe deaktivieren',
    changeRepeatMode: 'Wiederholungsmodus ändern',
    repeatOff: 'Wiederholung aus',
    repeatAll: 'Alle Titel wiederholen',
    repeatOne: 'Aktuellen Titel wiederholen',
    playPauseFailed: 'Wiedergabe/Pause fehlgeschlagen',
    nextFailed: 'Nächster Titel konnte nicht gestartet werden',
    previousFailed: 'Vorheriger Titel konnte nicht gestartet werden',
    seekFailed: 'Springen im Titel fehlgeschlagen',
    shuffleFailed: 'Zufällige Wiedergabe konnte nicht geändert werden',
    repeatFailed: 'Wiederholungsmodus konnte nicht geändert werden',
  },
  search: {
    inputLabel: 'Titel, Alben, Künstler und Playlists durchsuchen',
    placeholder: 'Titel, Künstler, Alben, Playlists…',
    clear: 'Suche leeren',
    preparing: 'Suche wird vorbereitet…',
    searching: 'Suche läuft…',
    minimumQueryHint: 'Gib mindestens zwei Zeichen ein.',
    noResults: 'Keine Ergebnisse gefunden.',
    noResultsFor: (query) => `Keine Ergebnisse für „${query}“ gefunden.`,
    partialError: 'Einige Suchergebnisse konnten nicht geladen werden.',
    remoteOffline: (section) => `${section} ist offline nicht verfügbar. Stelle eine Verbindung her und versuche es erneut.`,
    remoteLoadFailed: (section) => `${section} konnte nicht geladen werden.`,
    remoteCachedOffline: (section) => `${section}: Du bist offline. Gespeicherte Daten bleiben sichtbar.`,
    remoteCachedRefreshFailed: (section) => `${section}: Aktualisierung fehlgeschlagen. Gespeicherte Daten bleiben sichtbar.`,
    remoteLoading: (section) => `${section} wird geladen…`,
    remoteRefreshing: (section) => `${section} wird aktualisiert…`,
    remoteStale: (section) => `${section}: Gespeicherte Daten werden angezeigt.`,
    retrySection: (section) => `${section} erneut laden`,
    metadataTitle: 'Zusätzliche Titeldetails',
    tabs: { all: 'Alle', track: 'Titel', album: 'Alben', artist: 'Künstler', playlist: 'Playlists' },
    sortLabel: 'Sortierung',
    sorts: {
      relevance: 'Relevanz',
      title: 'Titel A–Z',
      durationAscending: 'Dauer aufsteigend',
      durationDescending: 'Dauer absteigend',
    },
    browseTitle: 'Zum Stöbern',
    browsePrompt: 'Wonach suchst du?',
    browseLoading: 'Genres werden geladen…',
    trackDuration: (duration) => `Dauer ${duration}`,
    trackPlayCount: (plays, listeners) =>
      `${plays.toLocaleString('de-DE')} Wiedergaben · ${listeners.toLocaleString('de-DE')} Hörer:innen (Last.fm)`,
    trackPopularity: (percent) => `Popularität ${percent} %`,
    trackDeviceCache: (duration) => `Gerätecache ${duration}`,
    trackServerCached: 'Auf dem Server gespeichert',
    playlistLoading: 'Playlist wird geladen…',
    playlistLoadFailed: 'Playlist konnte nicht geladen werden',
    playFailed: 'Suchergebnis konnte nicht wiedergegeben werden',
    importTitle: 'Von Spotify importieren',
    importOpen: 'Spotify-Link importieren',
    importClose: 'Spotify-Import schließen',
    importIntro:
      'Füge einen Spotify-Link für einen Titel, ein Album oder eine Playlist ein. Die gefundenen Titel werden über Deezer abgespielt.',
    importInputLabel: 'Spotify-Link',
    importPlaceholder: 'https://open.spotify.com/playlist/…',
    importResolve: 'Auflösen',
    importResolving: 'Spotify-Link wird mit Deezer abgeglichen…',
    importInvalid: 'Teile oder füge einen gültigen Spotify-Link für Titel, Album oder Playlist ein.',
    importAmbiguous: 'Der geteilte Text enthält mehrere verschiedene Spotify-Links.',
    importTooLong: 'Der geteilte Text ist zu lang.',
    importResolveFailed: 'Spotify-Link konnte nicht aufgelöst werden',
    importType: { track: 'Titel', album: 'Album', playlist: 'Playlist' },
    importMatched: (matched, total) => `${matched} von ${total} Titeln über Deezer gefunden`,
    importUnmatched: (count) => `${count} nicht verfügbar`,
    importTruncated: (sourceTotal, processed) =>
      `${sourceTotal} Titel insgesamt; die ersten ${processed} wurden verarbeitet.`,
    importPlayAll: 'Alle abspielen',
    importSaveTitle: 'In deiner Bibliothek speichern',
    importNewPlaylistName: 'Name der neuen Playlist',
    importCreateAndSave: 'Neue Playlist erstellen',
    importExistingPlaylists: 'Oder zu einer vorhandenen Playlist hinzufügen',
    importNoPlaylists: 'Noch keine vorhandene Playlist.',
    importSaveToPlaylist: (name) => `Alle zu „${name}“ hinzufügen`,
    importSaving: 'Speichert…',
    importSaved: (added, name) =>
      `${added} ${added === 1 ? 'Titel wurde' : 'Titel wurden'} in „${name}“ gespeichert.`,
    importSaveFailed: 'Import konnte nicht gespeichert werden',
    importUnmatchedTitle: 'Nicht auf Deezer gefunden',
    sections: { tracks: 'Titel', albums: 'Alben', artists: 'Künstler', playlists: 'Playlists' },
    openAlbum: (title, artist) => `Album „${title}“ von ${artist} öffnen`,
    openArtist: (name) => `Künstlerprofil von ${name} öffnen`,
    openPlaylist: (title, count) => `Playlist „${title}“ öffnen, ${count} Titel`,
    openGenre: (name) => `Genre ${name} öffnen`,
  },
  library: {
    openLikedSongs: 'Lieblingstitel öffnen',
    noPlaylists: 'Noch keine Playlists vorhanden.',
    playlistLabel: (name, count) => `${name}, ${count} ${count === 1 ? 'Titel' : 'Titel'}`,
    loadingPlaylists: 'Playlists werden geladen…',
  },
  playlist: {
    noTracks: 'Hier sind noch keine Titel.',
    loadingTracks: 'Titel werden geladen…',
  },
  trackActions: {
    moreActionsHint: 'Lange drücken für weitere Titelaktionen',
    moreActionsLabel: 'Weitere Titelaktionen öffnen',
    playNext: 'Als Nächstes spielen',
    addToQueue: 'Zur Warteschlange hinzufügen',
    startRadio: 'Titelradio starten',
    addToPlaylist: 'Zu Playlist hinzufügen…',
    openAlbum: (title) => `Album „${title}“ öffnen`,
    openArtist: (name) => `Künstlerprofil von ${name} öffnen`,
    remove: 'Aus dieser Playlist entfernen',
    removeFailed: 'Entfernen aus der Playlist fehlgeschlagen',
    removeSucceeded: (title) => `„${title}“ wurde aus der Playlist entfernt.`,
    navigationUnavailable: 'Dieses Titeldetail kann gerade nicht geöffnet werden.',
    addToPlaylistTitle: 'Zu Playlist hinzufügen',
    addToPlaylistFailed: 'Hinzufügen zur Playlist fehlgeschlagen',
    addToPlaylistSucceeded: (title) => `„${title}“ wurde zur Playlist hinzugefügt.`,
    addToNamedPlaylist: (title, playlist) => `„${title}“ zu „${playlist}“ hinzufügen`,
    addToNamedPlaylistSucceeded: (title, playlist) =>
      `„${title}“ wurde zu „${playlist}“ hinzugefügt.`,
    newPlaylist: 'Neue Playlist',
    newPlaylistName: 'Name der neuen Playlist',
    createAndAdd: 'Erstellen und hinzufügen',
    createPlaylistFailed: 'Playlist konnte nicht erstellt werden',
    loadingPlaylists: 'Playlists werden geladen…',
    noPlaylists: 'Noch keine Playlists. Erstelle oben eine neue.',
    playlistTrackCount: (count) => `${count} Titel`,
    close: 'Titelaktionen schließen',
    back: 'Zurück',
    backToPlaylists: 'Zur Playlist-Auswahl zurückkehren',
    playNextFailed: '„Als Nächstes spielen“ fehlgeschlagen',
    addToQueueFailed: 'Hinzufügen zur Warteschlange fehlgeschlagen',
    startRadioFailed: 'Titelradio konnte nicht gestartet werden',
    actionFailed: 'Die Titelaktion konnte nicht abgeschlossen werden.',
    playNextSucceeded: (title) => `„${title}“ wird als Nächstes wiedergegeben.`,
    addToQueueSucceeded: (title) => `„${title}“ wurde zur Warteschlange hinzugefügt.`,
    startRadioSucceeded: (title) => `Titelradio für „${title}“ wurde gestartet.`,
  },
  queue: {
    title: 'Warteschlange',
    upcomingCount: (count) => `${count} ${count === 1 ? 'Titel' : 'Titel'} als Nächstes`,
    close: 'Warteschlange schließen',
    done: 'Fertig',
    loading: 'Warteschlange wird geladen…',
    emptyTitle: 'Deine Warteschlange ist leer.',
    emptyDetail: 'Füge einen Titel aus der Suche oder Mediathek hinzu.',
    shuffle: 'Mischen',
    restoreOrder: 'Reihenfolge',
    clearUpcoming: 'Nächste löschen',
    clearUpcomingHint: 'Entfernt alle Titel nach dem aktuell wiedergegebenen Titel',
    clearUpcomingFailed: 'Die nächsten Titel konnten nicht gelöscht werden',
    shuffleEnabled: 'Die Kontexttitel wurden gemischt. Manuell eingereihte Titel bleiben vorne.',
    orderRestored: 'Die ursprüngliche Reihenfolge der Kontexttitel wurde wiederhergestellt.',
    clearedUpcoming: (count) =>
      `${count} ${count === 1 ? 'kommender Titel wurde' : 'kommende Titel wurden'} gelöscht.`,
    historySection: 'Bereits gespielt',
    currentSection: 'Aktueller Titel',
    manualSection: 'Manuell als Nächstes',
    contextSection: (label) => `Weiter aus „${label}“`,
    unknownContext: 'Wiedergabekontext',
    legacyContextLabel: (type) => ({
      album: 'Album',
      artist: 'Künstler:in',
      chart: 'Charts',
      collection: 'Sammlung',
      discover: 'Entdecken',
      genre: 'Genre',
      home: 'Start',
      liked: 'Lieblingstitel',
      playlist: 'Playlist',
      radio: 'Radio',
      recent: 'Zuletzt gehört',
      search: 'Suche',
    })[type],
    searchContext: (query) => `Suche: „${query}“`,
    recentContext: 'Zuletzt gehört',
    trackRadioContext: (title) => `Titelradio: „${title}“`,
    manualPriority: 'MANUELL EINGEREIHT',
    currentlyPlaying: 'WIRD WIEDERGEGEBEN',
    currentTrackSuffix: ', wird gerade wiedergegeben',
    skipHint: 'Zu diesem Titel springen',
    loadFailed: 'Warteschlange konnte nicht geladen werden',
    skipLabel: (title, artist, active) =>
      `${title} von ${artist}${active ? ', wird gerade wiedergegeben' : ''}`,
    skipFailed: (title) => `Springen zu „${title}“ fehlgeschlagen`,
    skippedTo: (title) => `Zu „${title}“ gesprungen.`,
    moveUp: (title) => `„${title}“ nach oben verschieben`,
    moveDown: (title) => `„${title}“ nach unten verschieben`,
    moveUpFailed: (title) => `„${title}“ konnte nicht nach oben verschoben werden`,
    moveDownFailed: (title) => `„${title}“ konnte nicht nach unten verschoben werden`,
    movedUp: (title) => `„${title}“ wurde nach oben verschoben.`,
    movedDown: (title) => `„${title}“ wurde nach unten verschoben.`,
    remove: (title) => `„${title}“ aus der Warteschlange entfernen`,
    cannotRemoveCurrent: (title) =>
      `Der aktuell wiedergegebene Titel „${title}“ kann nicht entfernt werden`,
    removeFailed: (title) => `„${title}“ konnte nicht entfernt werden`,
    removed: (title) => `„${title}“ wurde aus der Warteschlange entfernt.`,
  },
};

export const en: StringCatalog = {
  common: {
    appName: 'LoggeRythm', retry: 'Retry', working: 'Working…', dismiss: 'Dismiss', cancel: 'Cancel',
    play: 'Play', pause: 'Pause', nextTrack: 'Next track', previousTrack: 'Previous track',
    loading: 'Loading…', trackBy: (title, artist) => `${title} by ${artist}`,
    trackCount: (count) => `${count} ${count === 1 ? 'track' : 'tracks'}`,
  },
  shell: {
    offlineTitle: 'Offline',
    offlineBody: 'Only downloaded music is available. Online content returns with the connection.',
    backOnlineTitle: 'Back online',
    backOnlineBody: 'Online content is available again.',
  },
  trackPresentation: {
    playing: 'Playing',
    paused: 'Playback paused',
    buffering: 'Buffering track…',
    active: 'Current track',
    downloaded: 'Downloaded',
    serverCached: 'Stored on the server',
    rollingDeviceCache: (duration) => `Automatic device cache ${duration}`,
  },
  auth: {
    restoreFailedTitle: 'Couldn’t restore your session', forgetSession: 'Forget session and sign in',
    restoreFailedMessage: 'Your session could not be restored. Check the connection and try again.',
    retryRestoreFailed: 'Your session could not be checked again. Please retry.',
    forgetSessionFailed: 'The saved session could not be safely removed from this device. Please retry.',
    restoringSession: 'Restoring session…',
    inviteLinkFailed: 'The invite link could not be opened. Enter the invite code manually if needed.',
    signInSubtitle: 'Sign in to your library',
    createAccountSubtitle: 'Create your account',
    server: 'Server URL',
    serverPlaceholder: 'https://your-server.example',
    serverCredentialNotice:
      'Use only a server you trust. Its operator receives your email, password, and any invite code.',
    serverInvalid: 'Enter a valid HTTPS server URL without a path.',
    productionLinkServerChanged:
      'This link belongs to the LoggeRythm production server. To protect your sign-in details, the form was cleared before switching servers.',
    displayName: 'Display name',
    email: 'Email address', password: 'Password', confirmPassword: 'Confirm password',
    inviteOptional: 'Invite code (optional)', signIn: 'Sign in', createAccount: 'Create account',
    signingIn: 'Signing in…', creatingAccount: 'Creating account…',
    signInFailed: 'Sign-in failed. Check your details and try again.',
    createAccountFailed: 'Your account could not be created. Check your details and try again.',
    signedIn: 'Signed in successfully.', accountCreated: 'Account created.',
    signInInstead: 'Sign in instead', createAccountInstead: 'Create an account',
    existingAccountPrompt: 'Already have an account? Sign in', newAccountPrompt: 'New here? Create account',
    credentialsRequired: 'Email and password are required.',
    displayNameRequired: 'A display name is required.',
    displayNameTooLong: 'Display name must be at most 120 characters.',
    emailRequired: 'Email address is required.', emailInvalid: 'Enter a valid email address.',
    passwordRequired: 'Password is required.',
    passwordConfirmationRequired: 'Confirm your password.',
    passwordTooShort: 'Password must be at least 8 characters.',
    passwordTooLong: 'Password must be at most 128 characters.',
    passwordsDoNotMatch: 'Passwords do not match.', approvalTitle: 'Waiting for approval',
    approvalBody: (email) => `${email} is signed in, but an administrator still needs to approve it.`,
    accountFallback: 'This account', checkAgain: 'Check again', checkingApproval: 'Checking approval…',
    approvalCheckFailed: 'Approval could not be checked. Please retry.',
    approvalStillPending: 'Approval is still pending.', approvalGranted: 'Your account was approved.',
    signOut: 'Sign out', signingOut: 'Signing out…', logoutFailed: 'Logout failed',
    logoutFailedMessage: 'Sign-out could not be safely completed on this device. Please retry.',
    accountChangeFailed: 'This device could not be safely prepared for another account. Please retry.',
    accountCleanupFailed: 'The previous session could not be fully cleared from this device. Please retry.',
  },
  navigation: {
    home: 'Home', search: 'Search', discover: 'Discover', radio: 'Radio', library: 'Library',
    profile: 'Profile', album: 'Album', artist: 'Artist', genre: 'Genre',
    likedSongs: 'Liked Songs', playlists: 'Playlists', openProfile: 'Open profile',
    profileUnavailable: 'Profile is not available right now.',
    invalidLinkTitle: 'This link is invalid',
    invalidLinkBody: 'The requested content could not be opened safely.',
    invalidLinkBack: 'Back to the app',
  },
  home: {
    greetingNight: 'Good night', greetingMorning: 'Good morning', greetingDay: 'Good afternoon',
    greetingEvening: 'Good evening',
    greeting: (salutation, name) => `${salutation}${name ? `, ${name}` : ''} 👋`,
    subtitle: 'Discover new music that moves you.',
    moods: { top: 'Top picks', chill: 'Chill', focus: 'Focus', workout: 'Workout', party: 'Party' },
    moodResults: (mood) => `${mood} for you`, recentlyHeard: 'Recently Heard',
    mixes: 'For you', mixNotFound: 'This personal playlist was not found', releaseRadar: 'Your Release Radar',
    radarSubtitle: 'New from artists you listen to and follow', radarTypeLabel: 'Playlist',
    radarEmpty: 'No fresh releases from your artists yet. Follow artists or listen more to fill your radar.',
    radarNewCount: (count) => `${count} new`,
    radarSeenStateFailed: 'The Release Radar seen state could not be loaded.',
    radarRelativeDate: {
      today: 'today', yesterday: 'yesterday', daysAgo: (days) => `${days} days ago`,
      oneWeekAgo: '1 week ago', weeksAgo: (weeks) => `${weeks} weeks ago`,
      oneMonthAgo: '1 month ago', monthsAgo: (months) => `${months} months ago`,
    },
    becauseYouListened: 'Because you listened', chartCollections: 'Chart collections', charts: 'Charts',
    newReleases: 'New releases', communityPlaylists: 'Community playlists', genres: 'Genres',
    sectionLoading: (title) => `Loading ${title}…`,
    sectionEmpty: (title) => `There is nothing available for “${title}” right now.`,
    sectionLoadFailed: 'Content could not be loaded. Try again.',
    sectionRefreshing: 'Refreshing content…', sectionStale: 'Showing saved content.',
    sectionOffline: 'No connection. Reconnect and try again.',
    cachedOffline: 'You are offline. Saved content remains visible.',
    cachedRefreshFailed: 'Refresh failed. Saved content remains visible.',
    retrySection: (title) => `Reload ${title}`,
    playTrack: (title, artist) => `Play ${title} by ${artist}`,
    playShelf: (title, count) => `Play ${title}, ${count} tracks`,
    openShelf: (title, count) => `Open ${title}, ${count} tracks`,
    openAlbum: (title, artist) => `Open album ${title} by ${artist}`,
    openArtist: (name) => `Open artist ${name}`,
    openGenre: (name) => `Open ${name} genre`, albumBy: (artist) => `by ${artist}`,
    playFailed: 'Home playback failed',
  },
  radio: {
    badge: 'RADIO',
    title: 'Radio', subtitle: 'Endless music tuned to your taste.',
    personalTitle: 'Made for you', personalSubtitle: 'Stations based on your recent listening.',
    personalLoading: 'Preparing your personal stations…',
    personalEmpty: 'Listen to a few tracks and your personal stations will appear here.',
    personalResolutionFailed: 'Some recently played tracks could not be loaded.',
    moodsTitle: 'Mood radio', genresTitle: 'Genre radio', genresLoading: 'Loading genres…',
    genresEmpty: 'No genres available.', startStation: (title) => `Start ${title}`,
    starting: 'Starting…', retryStation: (title) => `Reload ${title}`,
    stationEmpty: 'No tracks available', moodLoading: (title) => `Loading ${title}…`,
    loadFailed: 'Stations could not be loaded.',
    sectionOffline: 'You are offline. Connect and try again.',
    cachedOffline: 'You are offline. Saved stations remain available.',
    refreshing: 'Refreshing stations…',
    stale: 'Showing saved stations.',
    cachedRefreshFailed: 'Refresh failed. Saved stations remain available.',
    startFailed: (title) => `${title} could not be started`, started: (title) => `${title} started.`,
    dismissError: 'Dismiss radio error',
    genreRadio: (name) => `${name} radio`,
    moods: {
      chill: { title: 'Chill radio', subtitle: 'Relaxed sounds for quiet moments' },
      focus: { title: 'Focus radio', subtitle: 'Stay focused without distraction' },
      workout: { title: 'Workout radio', subtitle: 'Energy for your workout' },
      party: { title: 'Party radio', subtitle: 'Full of beats for the night' },
    },
  },
  profile: {
    title: 'Profile', subtitle: 'Manage your account, listening history, and playback timer.',
    accountTitle: 'Your account', member: 'Member', administrator: 'Administrator',
    approved: 'Approved', pendingApproval: 'Approval pending',
    serverOrigin: (origin) => `Server: ${origin}`,
    avatarDeferred: 'Your profile picture can currently be changed on the web only.',
    languageTitle: 'Language',
    languageSubtitle: 'Applies to the LoggeRythm app on this device.',
    languageGerman: 'German',
    languageEnglish: 'English',
    languageChanging: 'Saving language…',
    languageChanged: (language) => `Language changed to ${language}.`,
    languageChangeFailed: 'The language could not be saved.',
    editTitle: 'Edit account details', displayName: 'Display name', email: 'Email address',
    newPassword: 'New password', confirmPassword: 'Confirm new password',
    passwordHint: 'Leave blank to keep your current password.', save: 'Save changes',
    saving: 'Saving…', saved: 'Your changes were saved.', noChanges: 'There are no changes to save.',
    saveFailed: 'Your changes could not be saved',
    validation: {
      displayNameRequired: 'Display name cannot be blank.',
      displayNameTooLong: 'Display name must be 120 characters or fewer.',
      emailInvalid: 'Enter a valid email address.',
      passwordTooShort: 'Password must be at least 8 characters.',
      passwordTooLong: 'Password must be 128 characters or fewer.',
      passwordMismatch: 'The passwords do not match.',
    },
    statsTitle: 'Listening stats', allTime: 'All time', lastThirtyDays: 'Last 30 days', plays: 'Plays',
    playCount: (count) => `${count} ${count === 1 ? 'play' : 'plays'}`, topTracks: 'Top tracks',
    topArtists: 'Top artists', statsLoading: 'Loading listening stats…',
    statsRefreshing: 'Refreshing listening stats…',
    statsEmpty: 'No listening activity yet.',
    statsLoadFailed: 'Listening stats could not be loaded.',
    statsOffline: 'You are offline. Connect and try again.',
    statsCachedOffline: 'You are offline. Saved listening stats remain visible.',
    statsStale: 'Showing saved listening stats.',
    statsRefreshFailed: 'Refresh failed. Saved listening stats remain visible.',
    refreshStats: 'Reload listening stats', sleepTitle: 'Sleep timer',
    sleepSubtitle: 'Pause playback after a duration or at the end of the current track.',
    timerOff: 'No sleep timer is active', timerRemaining: (remaining) => `Time remaining: ${remaining}`,
    timerEndOfTrack: 'Playback will stop after the current track.', minutes: (minutes) => `${minutes} min`,
    endOfTrack: 'End of track', currentTrackRemaining: 'Current time remaining',
    cancelTimer: 'Cancel sleep timer', noActiveTrack: 'A track must be active for this action.',
    noRemainingTime: 'The current track has no available time remaining.',
    sleepSetFailed: 'The sleep timer could not be changed',
    update: {
      title: 'Android updates',
      checking: 'Checking GitHub Releases for a newer stable version…',
      current: (version) => `Version ${version} is up to date.`,
      available: (version, megabytes) =>
        `Version ${version} is available (${megabytes} MB).`,
      install: 'Download update',
      downloading: 'Verifying and downloading update…',
      retryInstall: 'Check permission and continue',
      permission:
        'Allow LoggeRythm to install updates in Android settings, then tap again.',
      confirm: (version) =>
        `Version ${version} passed verification. Confirm installation in Android's system dialog.`,
      failed: 'Update failed',
      safety:
        'Only stable APKs from LoggeL/LoggeRythm are accepted. SHA-256, package, version, and app signature are verified before Android asks for confirmation.',
    },
    dangerTitle: 'Danger zone',
    dangerBody: 'Your account and all associated data will be permanently deleted.',
    deleteAccount: 'Delete account', deleteTitle: 'Permanently delete account?',
    deleteWarning: 'This cannot be undone. Your playlists, likes, and listening history will be deleted.',
    deleteCancel: 'Keep account', deleteConfirm: 'Delete permanently', deleting: 'Deleting account…',
    deleteFailed: 'Your account could not be deleted',
  },
  player: {
    preparing: 'Preparing native audio…', startFailedTitle: 'Audio player couldn’t start',
    startFailedMessage: 'The audio player could not be prepared. Please retry.',
    playerErrorDismiss: 'Dismiss player error', autoLibraryFailed: 'Android Auto library failed to load',
    autoLibraryRefreshFailedMessage:
      'Playback remains available. The Android Auto library will retry on its next refresh.',
    autoLibraryReadyLog: '[LoggeRythm] Android Auto library ready',
    notificationChannelName: 'Playback', autoLikedSongs: 'Liked Songs', autoPlaylists: 'Playlists',
    autoDownloads: 'Downloads',
    autoDownloadedProgress: (downloaded, total) => `${downloaded} of ${total} tracks downloaded`,
    bookkeepingFailedTitle: 'Playback data could not be updated',
    bookkeepingFailedMessage:
      'Playback and the queue remain available. Listening history or radio could not be updated.',
    recovery: {
      stoppedTitle: 'Playback stopped',
      skippedTitle: 'Track skipped',
      failedTitle: 'Playback recovery failed',
      attempts: (count) => `${count} recovery ${count === 1 ? 'attempt' : 'attempts'}`,
      explanations: {
        network: 'the network stayed unavailable or timed out',
        session: 'the authenticated session expired',
        authorization: 'the server refused access to this track',
        source: 'the track source was missing or rejected the requested range',
        backend: 'the backend could not materialize the full track',
        renderer: 'the device could not decode or render this track',
        unknown: 'the playback failure could not be classified safely',
      },
      sessionExpired: (title) =>
        `Your session expired while loading “${title}”. Sign in again. The queue was preserved.`,
      skipped: (title, attempts, reason) =>
        `“${title}” was skipped after ${attempts} because ${reason}.`,
      skipFailed: (title, attempts) =>
        `“${title}” could not be skipped safely after ${attempts}. Playback stopped and the queue was preserved.`,
      stopped: (title, attempts, reason, atQueueEnd) =>
        `“${title}” could not recover after ${attempts} because ${reason}.${
          atQueueEnd ? ' The track is at the queue end.' : ''
        } Playback stopped and the queue was preserved.`,
      noActiveTrack: 'The native player failed without an active track. Playback stopped.',
      unexpected:
        'Playback recovery encountered an unexpected error. Playback stopped and the queue was preserved.',
      pauseFailed: 'The native player also could not be paused.',
    },
    openNowPlaying: (title, artist) => `Open Now Playing for ${title} by ${artist}`,
    openQueue: 'Open queue', closeNowPlaying: 'Close Now Playing', nothingPlaying: 'Nothing playing.',
    nowPlayingTabs: {
      label: 'Now Playing view',
      playing: 'Playing',
      lyrics: 'Lyrics',
      similar: 'Similar',
    },
    similar: {
      title: 'Similar tracks',
      loading: 'Loading similar tracks…',
      empty: 'No similar tracks were found for this track.',
      loadFailed: 'Similar tracks could not be loaded.',
      offline: 'You are offline. Connect and try again.',
      retry: 'Reload similar tracks',
      refreshing: 'Refreshing similar tracks…',
      cachedOffline: 'You are offline. Saved similar tracks remain visible.',
      cachedRefreshFailed: 'Refresh failed. Saved similar tracks remain visible.',
      stale: 'Showing saved similar tracks.',
      playFailed: 'Similar tracks could not be played.',
      actionFailed: 'The track action could not be completed.',
      context: (seedTitle) => `Similar tracks to “${seedTitle}”`,
      started: (title) => `Playing ${title} from similar tracks.`,
    },
    lyrics: {
      title: 'Lyrics',
      loading: 'Loading lyrics…',
      empty: 'No lyrics are available for this track.',
      loadFailed: 'Lyrics could not be loaded.',
      offline: 'You are offline. Connect and try again.',
      retry: 'Reload lyrics',
      refreshing: 'Refreshing lyrics…',
      cachedOffline: 'You are offline. Saved lyrics remain visible.',
      cachedRefreshFailed: 'Refresh failed. Saved lyrics remain visible.',
      stale: 'Showing saved lyrics.',
      synchronized: 'Synchronized',
      aiGenerated: 'AI transcription',
      cached: 'Saved on the server',
      source: (provider) => `Source: ${provider}`,
      sources: {
        lrclib: 'LRCLIB',
        loggerythmAi: 'LoggeRythm AI',
        external: 'External source',
      },
      instrumentalLine: '♪',
      lineLabel: (text, timestamp) => `${text}, at ${timestamp}`,
      lineSeekHint: 'Seeks to this point in the track',
    },
    playbackPosition: 'Playback position', buffering: 'Buffering track…', likeTrack: 'Like track',
    unlikeTrack: 'Unlike track', likeFailed: 'Like failed',
    likedTrack: (title) => `${title} was liked.`,
    unlikedTrack: (title) => `${title} was unliked.`,
    likeStateUnavailable: (title) => `Like status unavailable for ${title}`,
    likeStateLoading: (title) => `Loading like status for ${title}`,
    retryLikeState: (title) => `Retry loading like status for ${title}`,
    likeStateOffline: 'You are offline. Retry when connected.',
    likeStateLoadFailed: 'Like status could not be loaded. Retry.',
    likeStateRefreshing: 'Refreshing the saved like status in the background.',
    likeStateStale: 'Showing saved like status.',
    enableShuffle: 'Enable shuffle',
    disableShuffle: 'Disable shuffle', changeRepeatMode: 'Change repeat mode', repeatOff: 'Repeat off',
    repeatAll: 'Repeat all tracks', repeatOne: 'Repeat current track', playPauseFailed: 'Play/pause failed',
    nextFailed: 'Skipping to the next track failed', previousFailed: 'Previous track failed',
    seekFailed: 'Seeking failed', shuffleFailed: 'Changing shuffle failed', repeatFailed: 'Changing repeat failed',
  },
  search: {
    inputLabel: 'Search tracks, albums, artists, and playlists',
    placeholder: 'Tracks, artists, albums, playlists…', clear: 'Clear search',
    preparing: 'Preparing search…', searching: 'Searching…',
    minimumQueryHint: 'Type at least two characters to search.', noResults: 'No results found.',
    noResultsFor: (query) => `No results found for “${query}”.`,
    partialError: 'Some search results could not be loaded.',
    remoteOffline: (section) => `${section} is unavailable offline. Connect and try again.`,
    remoteLoadFailed: (section) => `${section} could not be loaded.`,
    remoteCachedOffline: (section) => `${section}: You are offline. Saved data remains visible.`,
    remoteCachedRefreshFailed: (section) => `${section}: Refresh failed. Saved data remains visible.`,
    remoteLoading: (section) => `Loading ${section}…`,
    remoteRefreshing: (section) => `Refreshing ${section}…`,
    remoteStale: (section) => `${section}: Showing saved data.`,
    retrySection: (section) => `Reload ${section}`,
    metadataTitle: 'Additional track details',
    tabs: { all: 'All', track: 'Tracks', album: 'Albums', artist: 'Artists', playlist: 'Playlists' },
    sortLabel: 'Sort',
    sorts: {
      relevance: 'Relevance', title: 'Title A–Z',
      durationAscending: 'Duration ascending', durationDescending: 'Duration descending',
    },
    browseTitle: 'Browse', browsePrompt: 'What are you looking for?',
    browseLoading: 'Loading genres…',
    trackDuration: (duration) => `Duration ${duration}`,
    trackPlayCount: (plays, listeners) =>
      `${plays.toLocaleString('en-US')} plays · ${listeners.toLocaleString('en-US')} listeners (Last.fm)`,
    trackPopularity: (percent) => `Popularity ${percent}%`,
    trackDeviceCache: (duration) => `Device cache ${duration}`,
    trackServerCached: 'Stored on the server',
    playlistLoading: 'Loading playlist…', playlistLoadFailed: 'Playlist could not be loaded',
    playFailed: 'Search result could not be played',
    importTitle: 'Import from Spotify', importOpen: 'Import a Spotify link',
    importClose: 'Close Spotify import',
    importIntro:
      'Paste a Spotify track, album, or playlist link. Matching tracks play through Deezer.',
    importInputLabel: 'Spotify link',
    importPlaceholder: 'https://open.spotify.com/playlist/…', importResolve: 'Resolve',
    importResolving: 'Matching the Spotify link with Deezer…',
    importInvalid: 'Share or paste a valid Spotify track, album, or playlist link.',
    importAmbiguous: 'The shared text contains multiple different Spotify links.',
    importTooLong: 'The shared text is too long.',
    importResolveFailed: 'Spotify link could not be resolved',
    importType: { track: 'Track', album: 'Album', playlist: 'Playlist' },
    importMatched: (matched, total) => `${matched} of ${total} tracks matched on Deezer`,
    importUnmatched: (count) => `${count} unavailable`,
    importTruncated: (sourceTotal, processed) =>
      `${sourceTotal} tracks in total; the first ${processed} were processed.`,
    importPlayAll: 'Play all', importSaveTitle: 'Save to your library',
    importNewPlaylistName: 'New playlist name', importCreateAndSave: 'Create new playlist',
    importExistingPlaylists: 'Or add to an existing playlist',
    importNoPlaylists: 'No existing playlists yet.',
    importSaveToPlaylist: (name) => `Add all to ${name}`, importSaving: 'Saving…',
    importSaved: (added, name) =>
      `${added} ${added === 1 ? 'track was' : 'tracks were'} saved to ${name}.`,
    importSaveFailed: 'Import could not be saved',
    importUnmatchedTitle: 'Not found on Deezer',
    sections: { tracks: 'Tracks', albums: 'Albums', artists: 'Artists', playlists: 'Playlists' },
    openAlbum: (title, artist) => `Open album ${title} by ${artist}`,
    openArtist: (name) => `Open artist ${name}`,
    openPlaylist: (title, count) => `Open playlist ${title}, ${count} tracks`,
    openGenre: (name) => `Open ${name} genre`,
  },
  library: {
    openLikedSongs: 'Open Liked Songs', noPlaylists: 'No playlists yet.',
    playlistLabel: (name, count) => `${name}, ${count} ${count === 1 ? 'track' : 'tracks'}`,
    loadingPlaylists: 'Loading playlists…',
  },
  playlist: { noTracks: 'No tracks here yet.', loadingTracks: 'Loading tracks…' },
  trackActions: {
    moreActionsHint: 'Long press for more track actions', moreActionsLabel: 'Open more track actions',
    playNext: 'Play next', addToQueue: 'Add to queue', startRadio: 'Start radio',
    addToPlaylist: 'Add to playlist…',
    openAlbum: (title) => `Open album ${title}`,
    openArtist: (name) => `Open artist ${name}`,
    remove: 'Remove from this playlist',
    removeFailed: 'Removing from the playlist failed',
    removeSucceeded: (title) => `${title} was removed from the playlist.`,
    navigationUnavailable: 'This track detail cannot be opened right now.',
    addToPlaylistTitle: 'Add to playlist',
    addToPlaylistFailed: 'Adding to playlist failed',
    addToPlaylistSucceeded: (title) => `${title} was added to the playlist.`,
    addToNamedPlaylist: (title, playlist) => `Add ${title} to ${playlist}`,
    addToNamedPlaylistSucceeded: (title, playlist) => `${title} was added to ${playlist}.`,
    newPlaylist: 'New playlist', newPlaylistName: 'New playlist name',
    createAndAdd: 'Create and add', createPlaylistFailed: 'Playlist could not be created',
    loadingPlaylists: 'Loading playlists…',
    noPlaylists: 'No playlists yet. Create one above.',
    playlistTrackCount: (count) => `${count} ${count === 1 ? 'track' : 'tracks'}`,
    close: 'Close track actions', back: 'Back', backToPlaylists: 'Back to playlist selection',
    playNextFailed: 'Play next failed', addToQueueFailed: 'Add to queue failed',
    startRadioFailed: 'Starting radio failed',
    actionFailed: 'The track action could not be completed.',
    playNextSucceeded: (title) => `${title} will play next.`,
    addToQueueSucceeded: (title) => `${title} was added to the queue.`,
    startRadioSucceeded: (title) => `Track radio for ${title} started.`,
  },
  queue: {
    title: 'Queue', upcomingCount: (count) => `${count} upcoming ${count === 1 ? 'track' : 'tracks'}`,
    close: 'Close queue', done: 'Done', loading: 'Loading the native queue…',
    emptyTitle: 'Your queue is empty.', emptyDetail: 'Add a track from Search or Library.',
    shuffle: 'Shuffle', restoreOrder: 'Restore order', clearUpcoming: 'Clear upcoming',
    clearUpcomingHint: 'Removes every track after the currently playing track',
    clearUpcomingFailed: 'Clearing upcoming tracks failed', manualPriority: 'MANUALLY QUEUED',
    shuffleEnabled: 'Context tracks shuffled. Manually queued tracks remain first.',
    orderRestored: 'Original context order restored.',
    clearedUpcoming: (count) => `${count} upcoming ${count === 1 ? 'track was' : 'tracks were'} cleared.`,
    historySection: 'Previously played', currentSection: 'Current track',
    manualSection: 'Manually queued next', contextSection: (label) => `More from “${label}”`,
    unknownContext: 'Playback context',
    legacyContextLabel: (type) => ({
      album: 'Album', artist: 'Artist', chart: 'Charts', collection: 'Collection',
      discover: 'Discover', genre: 'Genre', home: 'Home', liked: 'Liked Songs',
      playlist: 'Playlist', radio: 'Radio', recent: 'Recently played', search: 'Search',
    })[type],
    searchContext: (query) => `Search: “${query}”`, recentContext: 'Recently played',
    trackRadioContext: (title) => `Track radio: “${title}”`,
    currentlyPlaying: 'PLAYING', currentTrackSuffix: ', currently playing', skipHint: 'Skip to this track',
    loadFailed: 'Loading queue failed',
    skipLabel: (title, artist, active) => `${title} by ${artist}${active ? ', currently playing' : ''}`,
    skipFailed: (title) => `Skipping to ${title} failed`, moveUp: (title) => `Move ${title} up`,
    skippedTo: (title) => `Skipped to ${title}.`,
    moveDown: (title) => `Move ${title} down`, moveUpFailed: (title) => `Moving ${title} up failed`,
    moveDownFailed: (title) => `Moving ${title} down failed`,
    movedUp: (title) => `${title} moved up.`, movedDown: (title) => `${title} moved down.`,
    remove: (title) => `Remove ${title} from queue`,
    cannotRemoveCurrent: (title) => `Cannot remove currently playing track ${title}`,
    removeFailed: (title) => `Removing ${title} failed`,
    removed: (title) => `${title} was removed from the queue.`,
  },
};
