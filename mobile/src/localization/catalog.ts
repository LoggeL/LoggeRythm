import type { QueueContextType } from '../player/queueContract';

export interface StringCatalog {
  common: {
    appName: string;
    retry: string;
    retrying: string;
    showAll: string;
    working: string;
    dismiss: string;
    cancel: string;
    play: string;
    pause: string;
    shuffle: string;
    shuffleAll: string;
    nextTrack: string;
    previousTrack: string;
    loading: string;
    artworkLoadFailed: string;
    trackBy: (title: string, artist: string) => string;
    trackCount: (count: number) => string;
  };
  shell: {
    offlineTitle: string;
    offlineBody: string;
    backOnlineTitle: string;
    backOnlineBody: string;
    revalidationFailedTitle: string;
    revalidationFailedBody: string;
    revalidationRetry: string;
  };
  trackPresentation: {
    playing: string;
    paused: string;
    buffering: string;
    active: string;
    playTrack: (title: string) => string;
    pauseTrack: (title: string) => string;
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
    playlistInvite: string;
    insights: string;
    openProfile: string;
    openProfileUpdateAvailable: string;
    /** The header dot stands for a final install failure the user has not seen yet. */
    openProfileUpdateFailed: string;
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
    radarNewTrack: string;
    /** The rule that fills the radar, stated once in the Radar hero. */
    radarRule: string;
    /** Why one track is in the radar: the bounded line under its row. */
    radarReason: {
      followed: (artist: string) => string;
      played: (plays: number, artist: string) => string;
      followedUnnamed: string;
      playedUnnamed: (plays: number) => string;
    };
    /** The same reason as a full sentence for screen readers. */
    radarReasonSpoken: {
      followed: (artist: string) => string;
      played: (plays: number, artist: string) => string;
      followedUnnamed: string;
      playedUnnamed: (plays: number) => string;
    };
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
    continueListening: string;
    continueEmptyTitle: string;
    continueEmptyMessage: string;
    continueEmptyAction: string;
    radarEmptyTitle: string;
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
    playbackTitle: string;
    playbackSubtitle: string;
    crossfadeEnabled: string;
    crossfadeHint: string;
    crossfadeDuration: (seconds: number) => string;
    crossfadeSaved: string;
    crossfadeSaveFailed: string;
    crossfadeLoadFailed: string;
    storageTitle: string;
    storageSubtitle: string;
    storageDownloadsLabel: string;
    storageDownloadsSummary: (count: number, size: string) => string;
    storageFreeSpace: (size: string) => string;
    storageStreamCacheLabel: string;
    storageStreamCacheHint: string;
    clearStreamCache: string;
    clearingStreamCache: string;
    streamCacheCleared: string;
    streamCacheClearFailed: string;
    wifiOnlyLabel: string;
    wifiOnlyHint: string;
    wifiOnlySaveFailed: string;
    wifiRequiredError: string;
    playTopTrack: (title: string) => string;
    openTopArtist: (name: string) => string;
    statActionFailed: string;
    publicProfileTitle: string;
    publicProfileJoined: (date: string) => string;
    publicProfilePlaylists: string;
    publicProfileNoPlaylists: string;
    publicProfileLoadFailed: string;
    openUserProfile: (name: string) => string;
    update: {
      titleVersion: string;
      titleAvailable: string;
      /** Header while the offered release failed for good and cannot be installed. */
      titleUninstallable: string;
      installedVersion: (version: string) => string;
      installedBuild: (versionCode: number) => string;
      checking: string;
      upToDate: string;
      updatedTo: (version: string) => string;
      lastChecked: (when: string) => string;
      justNow: string;
      minutesAgo: (minutes: number) => string;
      todayAt: (time: string) => string;
      /** Last check on another day: date ("17. November") and time. */
      checkedOnDay: (date: string, time: string) => string;
      transition: (from: string, to: string) => string;
      availableMeta: (size: string, date: string) => string;
      /** The offered release without the install framing, after a final failure. */
      releaseVersion: (version: string) => string;
      notesLabel: string;
      releaseLink: string;
      install: (size: string) => string;
      preparing: string;
      downloading: (version: string) => string;
      downloadingHint: string;
      /** Static TalkBack label of the download bar; the progress is its value. */
      progressLabel: string;
      confirm: (version: string) => string;
      confirmHint: string;
      /** A broken progress report while the verified APK still reached Android's installer. */
      progressWarning: string;
      restartInstall: string;
      permission: string;
      permissionContinue: string;
      installedNewerName: (latest: string) => string;
      installedNewerBuild: (build: number, latest: string, latestBuild: number) => string;
      installedNewerHint: string;
      /** The release declares the installed build's own number: not installable, not newer. */
      installedSameBuild: (latest: string, build: number) => string;
      /** Points to the release's "Android-Versioncode" line, not to a development build. */
      installedSameBuildHint: string;
      viewRelease: string;
      recheck: string;
      retryInstall: string;
      /**
       * Announced once when a check the profile watched ends; a failed check
       * is announced by its ErrorState (or its folded live-region line) instead.
       */
      checkAnnouncement: {
        upToDate: string;
        available: (version: string) => string;
        /** Found, but its install already failed for good. */
        uninstallable: (version: string) => string;
        installedNewer: string;
        /** The release declares the installed build's own number (see `installedSameBuild`). */
        installedSameBuild: (latest: string) => string;
      };
      checkFailedTitle: string;
      installFailedTitle: string;
      /**
       * Install failure that retrying the same release cannot fix, by where
       * its cause lies: the release's data or APK (explained on the release
       * page), or this device (named in the detail above the hint).
       */
      finalFailureHint: { release: string; device: string };
      /** Prefix of a startup toast, per phase that failed. */
      startupPhase: {
        check: string;
        pendingInstall: string;
        installOutcome: string;
        /** The installer outcome channel itself could not be read or subscribed to. */
        installOutcomeUnavailable: string;
        /** The app's language could not be handed to the native update notices. */
        appLocale: string;
      };
      updatedToast: (version: string) => string;
      /**
       * Startup failure toast: the phase and a pointer to the profile, whose
       * card shows the cause and the raw detail. Android 12+ cuts a text toast
       * after two lines, so the toast carries nothing else.
       */
      startupFailureToast: (phase: string) => string;
      detail: (code: string, message: string) => string;
      errors: {
        network: string;
        rateLimited: (status: number) => string;
        http: (status: number) => string;
        releaseVersionCodeMissing: (version: string) => string;
        releaseVersionCodeAmbiguous: (version: string) => string;
        releaseInvalid: string;
        installedVersionInvalid: (version: string) => string;
        markerInvalid: string;
        permissionRequired: string;
        digestMismatch: string;
        signatureMismatch: string;
        apkNotNewer: (version: string, build: number) => string;
        apkVersionMismatch: (version: string) => string;
        apkVersionCodeMismatch: (version: string) => string;
        download: string;
        installBusy: string;
        installSession: string;
        installAborted: string;
        installRejected: string;
        installIncompatible: string;
        installBlocked: string;
        installConflict: string;
        confirmationBlocked: string;
        outcomeUnsaved: string;
        permissionSettingsUnavailable: string;
        installedUnreadable: string;
        moduleInvalidated: string;
        /** `updater-locale-*`: native update notices could not take the app's language. */
        appLocale: string;
        packageMismatch: string;
        apkInvalid: string;
        /** A failure without a localized cause; the raw detail is shown below it (ErrorState). */
        unknown: string;
        /** The same for a toast or an inline note, where the detail is not below it. */
        unknownShort: string;
        linkFailed: string;
      };
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
    autoHome: string;
    autoRadio: string;
    autoDownloadedSongs: string;
    autoRecent: string;
    autoReleaseRadar: string;
    autoDownloadedProgress: (downloaded: number, total: number) => string;
    bookkeepingFailedTitle: string;
    bookkeepingFailedMessage: string;
    commandRejectedTitle: string;
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
    playingFrom: string;
    nowPlayingHeading: string;
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
      notSynchronized: string;
      followActiveLine: string;
      syncToCurrent: string;
      autoScrollPaused: string;
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
      standardVariant: string;
      aiVariant: string;
      switchToAi: string;
      switchToStandard: string;
      shareQuote: string;
      shareQuoteHint: string;
      shareQuoteFailed: string;
    };
    sleepTimer: string;
    sleepTimerActive: (label: string) => string;
    sleepTimerSheetClose: string;
    shareTrack: string;
    shareFailed: string;
    moreTrackActions: string;
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
    libraryLikesOffline: string;
    libraryLikesLoadFailed: string;
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
    recentTitle: string;
    recentClear: string;
    recentClearLabel: string;
    recentEmpty: string;
    recentOpen: (query: string) => string;
    recentRemove: (query: string) => string;
    recentLoadFailed: string;
    recentSaveFailed: string;
    trackDuration: (duration: string) => string;
    trackPlayCount: (plays: number, listeners: number) => string;
    trackPopularity: (percent: number) => string;
    trackDeviceCache: (duration: string) => string;
    trackServerCached: string;
    playlistLoading: string;
    playlistLoadFailed: string;
    playFailed: string;
    /** The tapped search result plays, but its track radio could not be attached. */
    radioFailed: string;
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
    importStarting: string;
    importStartFailed: (detail: string) => string;
    importServerUnreachable: string;
    importServerNoDetail: string;
    importBackgroundHint: string;
    importReadingLink: string;
    importProgressLabel: string;
    importJobsTitle: string;
    importJobsLoading: string;
    importJobsLoadFailed: (detail: string) => string;
    importJobQueued: string;
    importJobReading: string;
    importJobProgress: (processed: number, total: number, matched: number) => string;
    importJobDone: (matched: number, total: number) => string;
    importJobFailed: (error: string) => string;
    importJobNoServerError: string;
    importJobOpen: string;
    importJobOpenLabel: (title: string) => string;
    importJobCancel: (title: string) => string;
    importJobRemove: (title: string) => string;
    importJobCancelConfirmTitle: string;
    importJobCancelConfirmMessage: (title: string) => string;
    importJobCancelConfirm: string;
    importJobKeepRunning: string;
    importJobRemoveFailed: (detail: string) => string;
    importJobResultLoading: string;
    importJobResultFailed: string;
    importFinishedNotice: (title: string, matched: number, total: number) => string;
    importFailedNotice: (title: string) => string;
    sections: {
      library: string;
      tracks: string;
      albums: string;
      artists: string;
      playlists: string;
    };
    openAlbum: (title: string, artist: string) => string;
    openArtist: (name: string) => string;
    openPlaylist: (title: string, count: number) => string;
    openGenre: (name: string) => string;
    topResult: string;
    noResultsHint: string;
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
    download: string;
    removeDownload: string;
    downloadFailed: string;
    removeDownloadFailed: string;
    downloadSucceeded: (title: string) => string;
    removeDownloadSucceeded: (title: string) => string;
    openAlbum: (title: string) => string;
    openArtist: (name: string) => string;
    share: string;
    shareFailed: string;
    shareSucceeded: (title: string) => string;
    searchPlaylistsPlaceholder: string;
    alreadyInPlaylist: string;
    addToSelectedPlaylists: (count: number) => string;
    addedToMultiplePlaylists: (title: string, count: number) => string;
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
    playlistCollaborativeCount: (count: number) => string;
    playlistSharedTrackCount: (owner: string, count: number) => string;
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
    reorder: (title: string) => string;
    reorderHint: string;
    remove: (title: string) => string;
    cannotRemoveCurrent: (title: string) => string;
    removeFailed: (title: string) => string;
    removed: (title: string) => string;
    nowPlayingSection: string;
    upNextSection: string;
  };
  party: {
    eyebrow: string;
    defaultName: string;
    live: string;
    stale: string;
    youAreHost: string;
    hostedBy: (name: string) => string;
    memberCount: (count: number) => string;
    codeLabel: string;
    share: string;
    shareMessage: (name: string, url: string) => string;
    shareFailed: (detail: string) => string;
    leave: string;
    leaving: string;
    leaveConfirmTitle: string;
    leaveConfirmHost: string;
    leaveConfirmMember: string;
    leaveConfirm: string;
    leaveStay: string;
    leaveFailed: (detail: string) => string;
    followHint: (host: string) => string;
    detachedTitle: string;
    detachedBody: string;
    rejoinPlayback: string;
    syncFailed: (detail: string) => string;
    broadcastFailed: (detail: string) => string;
    joining: string;
    joinFailedTitle: string;
    joinFailed: (detail: string) => string;
    retryJoin: string;
    loadFailed: (detail: string) => string;
    reload: string;
    invalidCodeTitle: string;
    invalidCodeBody: string;
    back: string;
    serverUnreachable: string;
    serverNoDetail: (status: number) => string;
    streamEnded: string;
    streamNetwork: string;
    streamTimeout: string;
    streamRejected: (status: number, detail: string) => string;
    searchLabel: string;
    searchPlaceholder: string;
    searching: string;
    searchFailed: (detail: string) => string;
    searchEmpty: (query: string) => string;
    add: (title: string) => string;
    added: (title: string) => string;
    addFailed: (title: string, detail: string) => string;
    queueTitle: string;
    queueEmpty: string;
    nowPlaying: string;
    addedBy: (name: string) => string;
    addedByYou: string;
    playAt: (title: string) => string;
    moveUp: (title: string) => string;
    moveDown: (title: string) => string;
    remove: (title: string) => string;
    playFailed: (title: string, detail: string) => string;
    moveFailed: (title: string, detail: string) => string;
    removeFailed: (title: string, detail: string) => string;
    loadReady: string;
    loadLoading: string;
    loadQueued: string;
    loadFailedState: (reason: string) => string;
    loadIdle: string;
    buffering: string;
    membersTitle: string;
    hostBadge: string;
    guestBadge: string;
    startParty: string;
    startingParty: string;
    startPartyFailed: (detail: string) => string;
    /** `null` for a party without its own name. */
    activeTitle: (name: string | null) => string;
    openParty: string;
    queueLocked: string;
    addedToParty: (title: string) => string;
    endJam: string;
    endingJam: string;
    endConfirmTitle: string;
    endConfirmBody: string;
    endConfirm: string;
    endFailed: (detail: string) => string;
    endedNotice: string;
    kickedNotice: string;
    renameLabel: string;
    renamePlaceholder: string;
    renameSave: string;
    renameFailed: (detail: string) => string;
    guestsCanControlLabel: string;
    guestsCanControlHint: string;
    settingsFailed: (detail: string) => string;
    sharedControlHint: string;
    listenOnDevice: string;
    controlOnly: string;
    controlOnlyHint: string;
    kickMember: (name: string) => string;
    kickConfirmTitle: string;
    kickConfirmBody: (name: string) => string;
    kickConfirm: string;
    kickFailed: (name: string, detail: string) => string;
    playNext: (title: string) => string;
    playNextAdded: (title: string) => string;
    playNextFailed: (title: string, detail: string) => string;
    upNextTitle: string;
    playedEarlierTitle: string;
    joinByCodeTitle: string;
    joinCodeLabel: string;
    joinCodePlaceholder: string;
    joinSubmit: string;
    joinInvalidCode: string;
    inJamStrip: (name: string, count: number) => string;
    controlledByHost: (host: string) => string;
    playbackControlFailed: (detail: string) => string;
    restoreActiveFailed: (detail: string) => string;
    guestJoinButton: string;
    guestJoinTitle: string;
    guestJoinSubtitle: string;
    guestNicknameLabel: string;
    guestNicknamePlaceholder: string;
    guestNicknameRequired: string;
    guestJoining: string;
    guestLeave: string;
  };
  share: {
    trackMessage: (title: string, artist: string, url: string) => string;
    albumMessage: (title: string, artist: string, url: string) => string;
    artistMessage: (name: string, url: string) => string;
    playlistMessage: (name: string, url: string) => string;
    lyricQuoteMessage: (quote: string, title: string, artist: string, url: string) => string;
    shareAction: string;
    shareFailed: string;
  };
  connect: {
    title: string;
    connectToDevice: string;
    thisDevice: string;
    activeDevice: string;
    otherDevices: string;
    listeningOn: (deviceName: string) => string;
    playHere: string;
    transferring: string;
    transferFailed: (detail: string) => string;
    noOtherDevices: string;
    deviceNameLabel: string;
    deviceNamePlaceholder: string;
    deviceNameSave: string;
    deviceNameSaved: string;
    deviceNameEmpty: string;
    deviceNameFailed: (detail: string) => string;
    syncEnabledLabel: string;
    syncEnabledHint: string;
    syncDisabledNotice: string;
    enableSync: string;
    connecting: string;
    connected: (count: number) => string;
    reconnecting: string;
    disconnected: string;
    connectionFailed: (detail: string) => string;
    retry: string;
    volumeLabel: string;
    mute: string;
    unmute: string;
    volumeUnsupported: string;
    commandFailed: (detail: string) => string;
    remoteQueueSubtitle: (deviceName: string) => string;
    leaveJamToSwitchTitle: string;
    leaveJamToSwitchBody: (deviceName: string) => string;
    leaveJamAndSwitch: string;
    jamSectionTitle: string;
    startJam: string;
    joinJam: string;
    openJam: string;
    devicesButton: (deviceName: string | null) => string;
    closeSheet: string;
    settingsTitle: string;
    settingsDescription: string;
    deviceTypes: {
      web: string;
      mobile: string;
      tablet: string;
      desktop: string;
      tv: string;
      speaker: string;
      other: string;
    };
  };
  voice: {
    playFromSearchFailed: string;
    noMatchesFor: (query: string) => string;
    noMatchesGeneric: string;
    offlineUnavailable: string;
    emptyLibrary: string;
    invalidIntentPayload: string;
    resumedPlayback: string;
    startedPlayback: (title: string) => string;
    searchContextLabel: (query: string) => string;
  };
}

export const de: StringCatalog = {
  common: {
    appName: 'LoggeRythm',
    retry: 'Erneut versuchen',
    retrying: 'Wird erneut versucht…',
    showAll: 'Alle anzeigen',
    working: 'Wird ausgeführt…',
    dismiss: 'Schließen',
    cancel: 'Abbrechen',
    play: 'Wiedergabe starten',
    pause: 'Wiedergabe pausieren',
    shuffle: 'Zufallswiedergabe',
    shuffleAll: 'Zufällig abspielen',
    nextTrack: 'Nächster Titel',
    previousTrack: 'Vorheriger Titel',
    loading: 'Wird geladen…',
    artworkLoadFailed: 'Cover konnte nicht geladen werden',
    trackBy: (title, artist) => `${title} von ${artist}`,
    trackCount: (count) => `${count} ${count === 1 ? 'Titel' : 'Titel'}`,
  },
  shell: {
    offlineTitle: 'Offline',
    offlineBody: 'Nur heruntergeladene Musik ist verfügbar. Online-Inhalte kehren mit der Verbindung zurück.',
    backOnlineTitle: 'Wieder online',
    backOnlineBody: 'Online-Inhalte sind wieder verfügbar.',
    revalidationFailedTitle: 'Sitzung konnte nicht geprüft werden',
    revalidationFailedBody: 'Die Online-Sitzung konnte nicht überprüft werden. Versuche es erneut.',
    revalidationRetry: 'Erneut prüfen',
  },
  trackPresentation: {
    playing: 'Wird wiedergegeben',
    paused: 'Wiedergabe pausiert',
    buffering: 'Titel wird gepuffert…',
    active: 'Aktueller Titel',
    playTrack: (title) => `„${title}“ abspielen`,
    pauseTrack: (title) => `„${title}“ pausieren`,
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
    playlistInvite: 'Playlist-Einladung',
    insights: 'Hör-Insights',
    openProfile: 'Profil öffnen',
    openProfileUpdateAvailable: 'Profil öffnen, App-Update verfügbar',
    openProfileUpdateFailed: 'Profil öffnen, Update fehlgeschlagen',
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
    radarNewTrack: 'Neu',
    radarRule:
      'Neue Releases von Künstler:innen, denen du folgst oder die du in den letzten 90 Tagen mindestens zweimal gehört hast.',
    radarReason: {
      followed: (artist) => `Du folgst ${artist}`,
      played: (plays, artist) => `${plays}× gehört: ${artist}`,
      followedUnnamed: 'Gefolgt',
      playedUnnamed: (plays) => `Artist ${plays}× gehört`,
    },
    radarReasonSpoken: {
      followed: (artist) => `Im Radar, weil du ${artist} folgst`,
      played: (plays, artist) => `Im Radar, weil du ${artist} ${plays}-mal gehört hast`,
      followedUnnamed: 'Im Radar, weil du einem Artist dieses Titels folgst',
      playedUnnamed: (plays) =>
        `Im Radar, weil du einen Artist dieses Titels ${plays}-mal gehört hast`,
    },
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
    continueListening: 'Weiterhören',
    continueEmptyTitle: 'Noch nichts gehört',
    continueEmptyMessage: 'Starte einen Titel – hier geht es danach direkt weiter.',
    continueEmptyAction: 'Musik suchen',
    radarEmptyTitle: 'Dein Radar ist noch leer',
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
    playbackTitle: 'Wiedergabe',
    playbackSubtitle: 'Crossfade-Übergänge zwischen Titeln für dein Konto.',
    crossfadeEnabled: 'Crossfade aktivieren',
    crossfadeHint: 'Blendet aufeinanderfolgende Titel sanft ineinander über.',
    crossfadeDuration: (seconds) => `${seconds} Sek.`,
    crossfadeSaved: 'Wiedergabe-Einstellungen gespeichert.',
    crossfadeSaveFailed: 'Wiedergabe-Einstellungen konnten nicht gespeichert werden.',
    crossfadeLoadFailed: 'Wiedergabe-Einstellungen konnten nicht geladen werden.',
    storageTitle: 'Speicher & Downloads',
    storageSubtitle: 'Offline-Downloads, Stream-Cache und Download-Regeln verwalten.',
    storageDownloadsLabel: 'Offline-Downloads',
    storageDownloadsSummary: (count, size) =>
      `${count} ${count === 1 ? 'Titel' : 'Titel'} · ${size}`,
    storageFreeSpace: (size) => `${size} freier Gerätespeicher`,
    storageStreamCacheLabel: 'Rolling Stream-Cache',
    storageStreamCacheHint: 'Bis zu 500 MiB zwischengespeicherte Streams für sofortige Wiedergabe.',
    clearStreamCache: 'Stream-Cache leeren',
    clearingStreamCache: 'Cache wird geleert…',
    streamCacheCleared: 'Stream-Cache wurde geleert.',
    streamCacheClearFailed: 'Stream-Cache konnte nicht geleert werden.',
    wifiOnlyLabel: 'Nur über WLAN herunterladen',
    wifiOnlyHint: 'Blockiert Offline-Downloads über Mobilfunk.',
    wifiOnlySaveFailed: 'WLAN-Einstellung konnte nicht gespeichert werden.',
    wifiRequiredError:
      'Downloads sind auf WLAN beschränkt. Verbinde dich mit einem WLAN oder ändere die Einstellung im Profil.',
    playTopTrack: (title) => `Top-Titel „${title}“ abspielen`,
    openTopArtist: (name) => `Top-Künstler:in ${name} öffnen`,
    statActionFailed: 'Konnte aus der Statistik nicht geöffnet werden.',
    publicProfileTitle: 'Profil',
    publicProfileJoined: (date) => `Dabei seit ${date}`,
    publicProfilePlaylists: 'Öffentliche Playlists',
    publicProfileNoPlaylists: 'Keine öffentlichen Playlists vorhanden.',
    publicProfileLoadFailed: 'Profil konnte nicht geladen werden.',
    openUserProfile: (name) => `Profil von ${name} öffnen`,
    update: {
      titleVersion: 'App-Version',
      titleAvailable: 'Update verfügbar',
      titleUninstallable: 'Update nicht installierbar',
      installedVersion: (version) => `LoggeRythm ${version}`,
      installedBuild: (versionCode) => `Build ${versionCode}`,
      checking: 'Suche nach Updates…',
      upToDate: 'Du hast die neueste Version.',
      updatedTo: (version) => `Auf Version ${version} aktualisiert.`,
      lastChecked: (when) => `Zuletzt geprüft: ${when}`,
      justNow: 'gerade eben',
      minutesAgo: (minutes) => `vor ${minutes} Min.`,
      todayAt: (time) => `heute, ${time}`,
      checkedOnDay: (date, time) => `${date}, ${time}`,
      transition: (from, to) => `${from} → ${to}`,
      availableMeta: (size, date) => `${size} · veröffentlicht am ${date}`,
      releaseVersion: (version) => `Release ${version}`,
      notesLabel: 'Was ist neu',
      releaseLink: 'Alle Änderungen auf GitHub',
      install: (size) => `Installieren (${size})`,
      preparing: 'Installation wird vorbereitet…',
      downloading: (version) => `Version ${version} wird geladen und geprüft…`,
      downloadingHint: 'Du kannst die App währenddessen weiter nutzen.',
      progressLabel: 'Update-Download',
      confirm: (version) =>
        `Version ${version} ist geprüft. Bestätige die Installation im Android-Dialog.`,
      confirmHint:
        'Nach der Installation öffnest du die neue Version über die Benachrichtigung oder das App-Symbol. Kein Dialog zu sehen? Starte die Installation erneut.',
      progressWarning:
        'Die Fortschrittsanzeige des Downloads war fehlerhaft. Das geprüfte Update wurde trotzdem an Android übergeben.',
      restartInstall: 'Erneut starten',
      permission:
        'Android muss LoggeRythm erlauben, Apps zu installieren. Aktiviere „Dieser Quelle vertrauen“ und kehre dann zurück.',
      permissionContinue: 'Erlaubt – fortfahren',
      installedNewerName: (latest) =>
        `Diese Version ist neuer als das letzte Release (${latest}).`,
      installedNewerBuild: (build, latest, latestBuild) =>
        `Diese Installation (Build ${build}) ist neuer als Release ${latest} (Build ${latestBuild}). Android würde das Update ablehnen, deshalb wird es nicht angeboten.`,
      installedNewerHint:
        'Das passiert bei Test- und Entwicklungs-Builds. Sobald ein Release mit höherer Versionsnummer erscheint, wird es hier angeboten.',
      installedSameBuild: (latest, build) =>
        `Release ${latest} hat dieselbe Build-Nummer (${build}) wie diese Installation und kann deshalb nicht installiert werden.`,
      installedSameBuildHint:
        'Vermutlich ist die Zeile „Android-Versioncode“ im Release falsch. Sobald sie korrigiert ist, wird das Update hier angeboten.',
      viewRelease: 'Release auf GitHub ansehen',
      recheck: 'Erneut prüfen',
      retryInstall: 'Erneut versuchen',
      checkAnnouncement: {
        upToDate: 'Keine neue Version.',
        available: (version) => `Update ${version} verfügbar.`,
        uninstallable: (version) => `Update ${version} kann nicht installiert werden.`,
        installedNewer: 'Diese Installation ist neuer als das letzte Release.',
        installedSameBuild: (latest) =>
          `Release ${latest} hat dieselbe Build-Nummer und kann nicht installiert werden.`,
      },
      checkFailedTitle: 'Update-Prüfung fehlgeschlagen',
      installFailedTitle: 'Update fehlgeschlagen',
      finalFailureHint: {
        release:
          'Ein erneuter Versuch kann dieses Release nicht installieren. Alle Details stehen auf der Release-Seite.',
        device:
          'Ein erneuter Versuch kann dieses Release auf diesem Gerät nicht installieren. Die genaue Ursache steht in den Details oben.',
      },
      startupPhase: {
        check: 'Update-Prüfung fehlgeschlagen',
        pendingInstall: 'Ergebnis des letzten Updates unklar',
        installOutcome: 'Letztes Update nicht installiert',
        installOutcomeUnavailable: 'Status des letzten Updates nicht lesbar',
        appLocale: 'Sprache der Update-Hinweise nicht gesetzt',
      },
      updatedToast: (version) => `LoggeRythm wurde auf Version ${version} aktualisiert.`,
      startupFailureToast: (phase) => `${phase} – Details im Profil`,
      detail: (code, message) => `Details: ${code} – ${message}`,
      errors: {
        network: 'GitHub ist nicht erreichbar. Prüfe deine Internetverbindung.',
        rateLimited: (status) =>
          `GitHub-Limit für Update-Prüfungen erreicht (HTTP ${status}). Versuche es später erneut.`,
        http: (status) => `GitHub antwortete mit HTTP ${status}.`,
        releaseVersionCodeMissing: (version) =>
          `Release ${version} nennt keine Build-Nummer („Android-Versioncode“). Ohne sie lässt sich nicht prüfen, ob das Update installierbar ist.`,
        releaseVersionCodeAmbiguous: (version) =>
          `Release ${version} nennt mehrere Build-Nummern. Das Release muss korrigiert werden.`,
        releaseInvalid: 'Das GitHub-Release ist unvollständig oder ungültig.',
        installedVersionInvalid: (version) =>
          `Die installierte Version „${version}“ ist keine stabile Versionsnummer und lässt sich nicht vergleichen.`,
        markerInvalid: 'Der gespeicherte Stand des letzten Updates ist beschädigt und wurde verworfen.',
        permissionRequired:
          'LoggeRythm darf noch keine Apps installieren. Erlaube es in den Android-Einstellungen.',
        digestMismatch:
          'Die Prüfsumme des Downloads stimmt nicht mit GitHub überein. Es wurde nichts installiert.',
        signatureMismatch:
          'Das Update ist anders signiert als die installierte App. Android kann es nicht darüber installieren.',
        apkNotNewer: (version, build) =>
          `Das APK von Release ${version} ist nicht neuer als diese Installation (Build ${build}). Es wurde nichts installiert.`,
        apkVersionMismatch: (version) =>
          `Das heruntergeladene APK passt nicht zu Release ${version}. Es wurde nichts installiert.`,
        apkVersionCodeMismatch: (version) =>
          `Die Build-Nummer des APK passt nicht zur Angabe in Release ${version}. Es wurde nichts installiert.`,
        download: 'Der Download wurde abgebrochen.',
        installBusy: 'Es läuft bereits ein Update.',
        installSession: 'Android konnte die Installation nicht starten.',
        installAborted: 'Installation abgebrochen. Du kannst sie erneut starten.',
        installRejected: 'Android hat die Installation abgelehnt.',
        installIncompatible: 'Dieses Gerät erfüllt die Anforderungen des Updates nicht.',
        installBlocked: 'Eine Geräterichtlinie blockiert die Installation.',
        installConflict: 'Android meldet einen Konflikt mit der installierten App.',
        confirmationBlocked:
          'Android konnte die Installation nicht zur Bestätigung anzeigen, weil LoggeRythm im Hintergrund war und Benachrichtigungen blockiert sind. Starte sie erneut, während die App geöffnet ist.',
        outcomeUnsaved:
          'Android konnte den Stand des Updates nicht speichern. Starte die Installation erneut.',
        permissionSettingsUnavailable:
          'Android bietet keine Einstellung an, mit der LoggeRythm Apps installieren darf.',
        installedUnreadable: 'Android konnte die installierte Version von LoggeRythm nicht lesen.',
        moduleInvalidated: 'Der Updater wurde beendet, bevor er fertig war. Versuche es erneut.',
        appLocale:
          'Android konnte die App-Sprache nicht für die Update-Hinweise übernehmen. Sie erscheinen womöglich in einer anderen Sprache.',
        packageMismatch:
          'Das heruntergeladene APK gehört nicht zu LoggeRythm. Es wurde nichts installiert.',
        apkInvalid:
          'Das heruntergeladene APK ist ungültig oder unvollständig. Es wurde nichts installiert.',
        unknown: 'Unbekannter Fehler – Details stehen darunter.',
        unknownShort: 'Unbekannter Fehler.',
        linkFailed: 'Die Release-Seite konnte nicht geöffnet werden.',
      },
      safety:
        'Nur signierte APKs aus LoggeL/LoggeRythm. Build-Nummer, Prüfsumme, Paket, Version und Signatur werden vor der Installation geprüft.',
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
      'Die Wiedergabe bleibt verfügbar. Ziehe die Mediathek zum erneuten Laden nach unten.',
    autoLibraryReadyLog: '[LoggeRythm] Android-Auto-Mediathek ist bereit',
    notificationChannelName: 'Wiedergabe',
    autoLikedSongs: 'Lieblingstitel',
    autoPlaylists: 'Playlists',
    autoDownloads: 'Downloads',
    autoHome: 'Start',
    autoRadio: 'Radio',
    autoDownloadedSongs: 'Heruntergeladene Titel',
    autoRecent: 'Zuletzt gehört',
    autoReleaseRadar: 'Release Radar',
    autoDownloadedProgress: (downloaded, total) =>
      `${downloaded} von ${total} Titeln heruntergeladen`,
    bookkeepingFailedTitle: 'Wiedergabedaten konnten nicht aktualisiert werden',
    bookkeepingFailedMessage:
      'Wiedergabe und Warteschlange bleiben verfügbar. Hörverlauf oder Radio konnten nicht aktualisiert werden.',
    commandRejectedTitle:
      'Die Änderung an der Warteschlange konnte nicht angewendet werden',
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
    playingFrom: 'Wiedergabe aus',
    nowPlayingHeading: 'Jetzt läuft',
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
      notSynchronized: 'Nicht synchronisiert',
      followActiveLine: 'Aktiver Zeile folgen',
      syncToCurrent: 'Zur aktuellen Zeile',
      autoScrollPaused: 'Automatisches Scrollen pausiert',
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
      standardVariant: 'Standard',
      aiVariant: 'KI-Text',
      switchToAi: 'KI-transkribierten Songtext laden',
      switchToStandard: 'Standard-Songtext laden',
      shareQuote: 'Textzeile als Zitat teilen',
      shareQuoteHint: 'Lange drücken, um diese Zeile als Zitat zu teilen',
      shareQuoteFailed: 'Zitat konnte nicht geteilt werden.',
    },
    sleepTimer: 'Sleep-Timer',
    sleepTimerActive: (label) => `Sleep-Timer aktiv: ${label}`,
    sleepTimerSheetClose: 'Sleep-Timer schließen',
    shareTrack: 'Titel teilen',
    shareFailed: 'Teilen fehlgeschlagen',
    moreTrackActions: 'Weitere Titelaktionen',
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
    libraryLikesOffline:
      'Lieblingstitel sind offline nicht verfügbar. Stelle eine Verbindung her und versuche es erneut.',
    libraryLikesLoadFailed:
      'Lieblingstitel konnten nicht geladen werden und fehlen in diesen Treffern.',
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
    recentTitle: 'Zuletzt gesucht',
    recentClear: 'Verlauf löschen',
    recentClearLabel: 'Suchverlauf löschen',
    recentEmpty: 'Noch keine letzten Suchanfragen.',
    recentOpen: (query) => `Erneut suchen: ${query}`,
    recentRemove: (query) => `Aus Suchverlauf entfernen: ${query}`,
    recentLoadFailed: 'Suchverlauf konnte nicht geladen werden.',
    recentSaveFailed: 'Suchverlauf konnte nicht gespeichert werden.',
    trackDuration: (duration) => `Dauer ${duration}`,
    trackPlayCount: (plays, listeners) =>
      `${plays.toLocaleString('de-DE')} Wiedergaben · ${listeners.toLocaleString('de-DE')} Hörer:innen (Last.fm)`,
    trackPopularity: (percent) => `Popularität ${percent} %`,
    trackDeviceCache: (duration) => `Gerätecache ${duration}`,
    trackServerCached: 'Auf dem Server gespeichert',
    playlistLoading: 'Playlist wird geladen…',
    playlistLoadFailed: 'Playlist konnte nicht geladen werden',
    playFailed: 'Suchergebnis konnte nicht wiedergegeben werden',
    radioFailed: 'Titel läuft, aber das Titelradio konnte nicht geladen werden',
    importTitle: 'Von Spotify importieren',
    importOpen: 'Spotify-Link importieren',
    importClose: 'Spotify-Import schließen',
    importIntro:
      'Füge einen Spotify-Link für einen Titel, ein Album oder eine Playlist ein. Der Import läuft im Hintergrund, auch bei großen Playlists – du kannst ihn verlassen und das Ergebnis später hier abholen. Die gefundenen Titel werden über Deezer abgespielt.',
    importInputLabel: 'Spotify-Link',
    importPlaceholder: 'https://open.spotify.com/playlist/…',
    importResolve: 'Importieren',
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
    importStarting: 'Startet…',
    importStartFailed: (detail) => `Import konnte nicht gestartet werden: ${detail}`,
    importServerUnreachable: 'Der Server ist nicht erreichbar.',
    importServerNoDetail: 'Der Server hat keinen Grund genannt.',
    importBackgroundHint:
      'Der Import läuft im Hintergrund weiter. Du kannst woanders hingehen und das Ergebnis später unter „Deine Importe“ abholen.',
    importReadingLink: 'Spotify-Link wird gelesen…',
    importProgressLabel: 'Import-Fortschritt',
    importJobsTitle: 'Deine Importe',
    importJobsLoading: 'Deine Importe werden geladen…',
    importJobsLoadFailed: (detail) => `Deine Importe konnten nicht geladen werden: ${detail}`,
    importJobQueued: 'Wartet auf Start…',
    importJobReading: 'Liest die Titel von Spotify…',
    importJobProgress: (processed, total, matched) =>
      `${processed}/${total} abgeglichen · ${matched} gefunden`,
    importJobDone: (matched, total) => `Fertig · ${matched}/${total} Titel gefunden`,
    importJobFailed: (error) => `Fehlgeschlagen: ${error}`,
    importJobNoServerError: 'ohne Fehlermeldung vom Server',
    importJobOpen: 'Öffnen',
    importJobOpenLabel: (title) => `Import öffnen: ${title}`,
    importJobCancel: (title) => `Import abbrechen: ${title}`,
    importJobRemove: (title) => `Import entfernen: ${title}`,
    importJobCancelConfirmTitle: 'Import abbrechen?',
    importJobCancelConfirmMessage: (title) =>
      `„${title}“ wird abgebrochen. Der bisherige Fortschritt geht verloren.`,
    importJobCancelConfirm: 'Import abbrechen',
    importJobKeepRunning: 'Weiterlaufen lassen',
    importJobRemoveFailed: (detail) => `Import konnte nicht entfernt werden: ${detail}`,
    importJobResultLoading: 'Importierte Titel werden geladen…',
    importJobResultFailed: 'Die importierten Titel konnten nicht geladen werden',
    importFinishedNotice: (title, matched, total) =>
      `Spotify-Import fertig: ${title} (${matched}/${total} Titel). Abholen unter Suche → Spotify-Import.`,
    importFailedNotice: (title) => `Spotify-Import fehlgeschlagen: ${title}`,
    sections: {
      library: 'In deiner Bibliothek',
      tracks: 'Titel', albums: 'Alben', artists: 'Künstler', playlists: 'Playlists',
    },
    openAlbum: (title, artist) => `Album „${title}“ von ${artist} öffnen`,
    openArtist: (name) => `Künstlerprofil von ${name} öffnen`,
    openPlaylist: (title, count) => `Playlist „${title}“ öffnen, ${count} Titel`,
    openGenre: (name) => `Genre ${name} öffnen`,
    topResult: 'Top-Ergebnis',
    noResultsHint: 'Prüfe die Schreibweise oder versuche es mit einem anderen Begriff.',
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
    download: 'Song herunterladen',
    removeDownload: 'Song-Download entfernen',
    downloadFailed: 'Song konnte nicht heruntergeladen werden',
    removeDownloadFailed: 'Song-Download konnte nicht entfernt werden',
    downloadSucceeded: (title) => `„${title}“ wurde heruntergeladen.`,
    removeDownloadSucceeded: (title) => `Der Download von „${title}“ wurde entfernt.`,
    openAlbum: (title) => `Album „${title}“ öffnen`,
    openArtist: (name) => `Künstlerprofil von ${name} öffnen`,
    share: 'Teilen',
    shareFailed: 'Titel konnte nicht geteilt werden',
    shareSucceeded: (title) => `„${title}“ wurde geteilt.`,
    searchPlaylistsPlaceholder: 'Playlists filtern…',
    alreadyInPlaylist: 'Bereits enthalten',
    addToSelectedPlaylists: (count) => `Zu ${count} Playlists hinzufügen`,
    addedToMultiplePlaylists: (title, count) => `„${title}“ wurde zu ${count} Playlists hinzugefügt.`,
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
    playlistCollaborativeCount: (count) => `Gemeinsam · ${count} Titel`,
    playlistSharedTrackCount: (owner, count) => `Von ${owner} · ${count} Titel`,
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
      party: 'Party',
      playlist: 'Playlist',
      radio: 'Radio',
      recent: 'Zuletzt gehört',
      search: 'Suche',
    })[type],
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
    reorder: (title) => `„${title}“ verschieben`,
    reorderHint: 'Ziehen, um den Titel umzusortieren. Tippen blendet die Schaltflächen zum Verschieben ein.',
    remove: (title) => `„${title}“ aus der Warteschlange entfernen`,
    cannotRemoveCurrent: (title) =>
      `Der aktuell wiedergegebene Titel „${title}“ kann nicht entfernt werden`,
    removeFailed: (title) => `„${title}“ konnte nicht entfernt werden`,
    removed: (title) => `„${title}“ wurde aus der Warteschlange entfernt.`,
    nowPlayingSection: 'Jetzt läuft',
    upNextSection: 'Als Nächstes',
  },
  party: {
    eyebrow: 'Gemeinsam hören',
    defaultName: 'Party',
    live: 'Live',
    stale: 'Nicht aktuell',
    youAreHost: 'Du bist Host',
    hostedBy: (name) => `Host: ${name}`,
    memberCount: (count) => (count === 1 ? '1 Person' : `${count} Personen`),
    codeLabel: 'Party-Code',
    share: 'Einladungslink teilen',
    shareMessage: (name, url) => `Hör mit in der Party „${name}“: ${url}`,
    shareFailed: (detail) => `Der Einladungslink konnte nicht geteilt werden: ${detail}`,
    leave: 'Party verlassen',
    leaving: 'Party wird verlassen…',
    leaveConfirmTitle: 'Party verlassen?',
    leaveConfirmHost: 'Du steuerst als Host die Wiedergabe für alle in dieser Party.',
    leaveConfirmMember:
      'Deine Wiedergabe folgt danach nicht mehr dem Host. Über den Einladungslink kannst du wieder beitreten.',
    leaveConfirm: 'Verlassen',
    leaveStay: 'Bleiben',
    leaveFailed: (detail) => `Die Party konnte nicht verlassen werden: ${detail}`,
    followHint: (host) =>
      `${host} steuert die Wiedergabe. Deine Wiedergabe folgt automatisch – Songs kannst du jederzeit hinzufügen.`,
    detachedTitle: 'Deine Wiedergabe folgt der Party nicht mehr',
    detachedBody: 'Du hast andere Musik gestartet. Die Party läuft ohne dich weiter.',
    rejoinPlayback: 'Wieder mithören',
    syncFailed: (detail) => `Die Wiedergabe konnte nicht mit der Party abgeglichen werden: ${detail}`,
    broadcastFailed: (detail) => `Die Wiedergabe konnte nicht an die Party gesendet werden: ${detail}`,
    joining: 'Party wird beigetreten…',
    joinFailedTitle: 'Beitritt nicht möglich',
    joinFailed: (detail) => `Beitritt zur Party fehlgeschlagen: ${detail}`,
    retryJoin: 'Erneut versuchen',
    loadFailed: (detail) => `Die Party ist nicht aktuell: ${detail}`,
    reload: 'Erneut laden',
    invalidCodeTitle: 'Ungültiger Party-Link',
    invalidCodeBody: 'Dieser Link enthält keinen gültigen Party-Code.',
    back: 'Zurück',
    serverUnreachable: 'Der Server ist nicht erreichbar. Prüfe deine Verbindung.',
    serverNoDetail: (status) => `Der Server hat mit HTTP ${status} geantwortet, ohne Begründung.`,
    streamEnded: 'Der Server hat die Live-Verbindung beendet.',
    streamNetwork: 'Die Live-Verbindung ist abgebrochen (Netzwerkfehler).',
    streamTimeout: 'Die Live-Verbindung hat das Zeitlimit überschritten.',
    streamRejected: (status, detail) =>
      detail === ''
        ? `Der Server hat die Live-Verbindung abgelehnt (HTTP ${status}).`
        : `Der Server hat die Live-Verbindung abgelehnt (HTTP ${status}): ${detail}`,
    searchLabel: 'Songs für die Party suchen',
    searchPlaceholder: 'Titel oder Künstler:in',
    searching: 'Suche läuft…',
    searchFailed: (detail) => `Die Suche ist fehlgeschlagen: ${detail}`,
    searchEmpty: (query) => `Keine Songs für „${query}“ gefunden.`,
    add: (title) => `„${title}“ zur Party hinzufügen`,
    added: (title) => `„${title}“ ist jetzt in der Party.`,
    addFailed: (title, detail) => `„${title}“ konnte nicht hinzugefügt werden: ${detail}`,
    queueTitle: 'Party-Warteschlange',
    queueEmpty: 'Noch keine Songs. Such oben nach Titeln und füg sie hinzu.',
    nowPlaying: 'Läuft gerade',
    addedBy: (name) => `von ${name}`,
    addedByYou: 'von dir',
    playAt: (title) => `„${title}“ für alle abspielen`,
    moveUp: (title) => `„${title}“ nach oben verschieben`,
    moveDown: (title) => `„${title}“ nach unten verschieben`,
    remove: (title) => `„${title}“ aus der Party entfernen`,
    playFailed: (title, detail) => `„${title}“ konnte nicht abgespielt werden: ${detail}`,
    moveFailed: (title, detail) => `„${title}“ konnte nicht verschoben werden: ${detail}`,
    removeFailed: (title, detail) => `„${title}“ konnte nicht entfernt werden: ${detail}`,
    loadReady: 'Geladen',
    loadLoading: 'Lädt…',
    loadQueued: 'Wartet aufs Laden',
    loadFailedState: (reason) => `Laden fehlgeschlagen: ${reason}`,
    loadIdle: 'Nicht geladen',
    buffering: 'Puffert…',
    membersTitle: 'Dabei',
    hostBadge: 'Host',
    guestBadge: 'Gast',
    startParty: 'Jam starten',
    startingParty: 'Jam wird gestartet…',
    startPartyFailed: (detail) => `Die Jam konnte nicht gestartet werden: ${detail}`,
    activeTitle: (name) => (name === null ? 'Jam läuft' : `Jam „${name}“ läuft`),
    openParty: 'Zur Jam',
    queueLocked: 'Diese Warteschlange gehört zur Jam. Bearbeite sie in der Jam.',
    addedToParty: (title) => `„${title}“ wurde zur Jam hinzugefügt.`,
    endJam: 'Jam beenden',
    endingJam: 'Jam wird beendet…',
    endConfirmTitle: 'Jam für alle beenden?',
    endConfirmBody: 'Die Jam wird sofort beendet und alle Teilnehmenden werden getrennt.',
    endConfirm: 'Beenden',
    endFailed: (detail) => `Die Jam konnte nicht beendet werden: ${detail}`,
    endedNotice: 'Der Host hat diese Jam beendet.',
    kickedNotice: 'Du wurdest aus dieser Jam entfernt.',
    renameLabel: 'Jam-Name',
    renamePlaceholder: 'Name der Jam',
    renameSave: 'Speichern',
    renameFailed: (detail) => `Der Jam-Name konnte nicht geändert werden: ${detail}`,
    guestsCanControlLabel: 'Andere dürfen Wiedergabe steuern',
    guestsCanControlHint: 'Teilnehmende können pausieren, überspringen und die Warteschlange sortieren.',
    settingsFailed: (detail) => `Jam-Einstellungen konnten nicht gespeichert werden: ${detail}`,
    sharedControlHint: 'Alle Teilnehmenden können Wiedergabe und Warteschlange steuern.',
    listenOnDevice: 'Auf diesem Gerät mithören',
    controlOnly: 'Nur steuern (ohne Audio)',
    controlOnlyHint: 'Audio bleibt hier stumm – ideal, wenn du im selben Raum die Anlage steuerst.',
    kickMember: (name) => `${name} aus der Jam entfernen`,
    kickConfirmTitle: 'Teilnehmende entfernen?',
    kickConfirmBody: (name) => `${name} wird aus dieser Jam getrennt.`,
    kickConfirm: 'Entfernen',
    kickFailed: (name, detail) => `${name} konnte nicht entfernt werden: ${detail}`,
    playNext: (title) => `„${title}“ als Nächstes in der Jam spielen`,
    playNextAdded: (title) => `„${title}“ läuft als Nächstes in der Jam.`,
    playNextFailed: (title, detail) => `„${title}“ konnte nicht als Nächstes eingereiht werden: ${detail}`,
    upNextTitle: 'Als Nächstes in der Jam',
    playedEarlierTitle: 'Bereits gespielt',
    joinByCodeTitle: 'Einer Jam beitreten',
    joinCodeLabel: '6-stelliger Jam-Code',
    joinCodePlaceholder: 'z. B. ABC123',
    joinSubmit: 'Beitreten',
    joinInvalidCode: 'Bitte gib einen gültigen 6-stelligen Code ein.',
    inJamStrip: (name, count) =>
      `${name} · ${count === 1 ? '1 Person' : `${count} Personen`}`,
    controlledByHost: (host) => `Wiedergabe wird von ${host} gesteuert`,
    playbackControlFailed: (detail) => `Wiedergabe-Befehl fehlgeschlagen: ${detail}`,
    restoreActiveFailed: (detail) => `Aktive Jam konnte nicht wiederhergestellt werden: ${detail}`,
    guestJoinButton: 'Als Gast einer Jam beitreten',
    guestJoinTitle: 'Als Gast beitreten',
    guestJoinSubtitle: 'Tritt ohne Konto per 6-stelligem Jam-Code bei und füge Songs hinzu.',
    guestNicknameLabel: 'Dein Name',
    guestNicknamePlaceholder: 'z. B. Alex',
    guestNicknameRequired: 'Bitte gib einen Namen ein.',
    guestJoining: 'Beitritt läuft…',
    guestLeave: 'Jam verlassen',
  },
  share: {
    trackMessage: (title, artist, url) => `${title} – ${artist}\n${url}`,
    albumMessage: (title, artist, url) => `Album „${title}“ von ${artist}\n${url}`,
    artistMessage: (name, url) => `${name} auf LoggeRythm\n${url}`,
    playlistMessage: (name, url) => `Playlist „${name}“ auf LoggeRythm\n${url}`,
    lyricQuoteMessage: (quote, title, artist, url) => `„${quote}“\n— ${title} · ${artist}\n${url}`,
    shareAction: 'Teilen',
    shareFailed: 'Teilen fehlgeschlagen.',
  },
  connect: {
    title: 'Geräte',
    connectToDevice: 'Mit einem Gerät verbinden',
    thisDevice: 'Dieses Gerät',
    activeDevice: 'Aktives Gerät',
    otherDevices: 'Gerät auswählen',
    listeningOn: (deviceName) => `Wiedergabe auf ${deviceName}`,
    playHere: 'Hier abspielen',
    transferring: 'Wird übertragen…',
    transferFailed: (detail) => `Wiedergabe konnte nicht übertragen werden: ${detail}`,
    noOtherDevices: 'Keine weiteren Geräte verbunden. Öffne LoggeRythm auf einem anderen Gerät mit demselben Konto.',
    deviceNameLabel: 'Gerätename',
    deviceNamePlaceholder: 'Name dieses Geräts',
    deviceNameSave: 'Speichern',
    deviceNameSaved: 'Gerätename gespeichert.',
    deviceNameEmpty: 'Bitte gib einen Gerätenamen ein.',
    deviceNameFailed: (detail) => `Gerätename konnte nicht aktualisiert werden: ${detail}`,
    syncEnabledLabel: 'Geräte-Steuerung (Connect)',
    syncEnabledHint: 'Verbindet dieses Gerät per WebSocket, um die Wiedergabe geräteübergreifend zu steuern.',
    syncDisabledNotice: 'Die Geräte-Steuerung ist deaktiviert.',
    enableSync: 'Aktivieren',
    connecting: 'Verbinde…',
    connected: (count) => (count === 1 ? '1 Gerät verbunden' : `${count} Geräte verbunden`),
    reconnecting: 'Verbindung wird wiederhergestellt…',
    disconnected: 'Nicht verbunden',
    connectionFailed: (detail) => `Geräte-Verbindung fehlgeschlagen: ${detail}`,
    retry: 'Erneut versuchen',
    volumeLabel: 'Lautstärke',
    mute: 'Stummschalten',
    unmute: 'Stummschaltung aufheben',
    volumeUnsupported: 'Die Lautstärke dieses Geräts kann nicht aus der Ferne geändert werden.',
    commandFailed: (detail) => `Geräte-Befehl fehlgeschlagen: ${detail}`,
    remoteQueueSubtitle: (deviceName) => `Warteschlange auf ${deviceName}`,
    leaveJamToSwitchTitle: 'Jam verlassen?',
    leaveJamToSwitchBody: (deviceName) =>
      `Möchtest du die aktive Jam verlassen und die Wiedergabe auf „${deviceName}“ übertragen?`,
    leaveJamAndSwitch: 'Jam verlassen & wechseln',
    jamSectionTitle: 'Gemeinsam hören (Jam)',
    startJam: 'Jam starten',
    joinJam: 'Mit Code beitreten',
    openJam: 'Aktive Jam öffnen',
    devicesButton: (deviceName) =>
      deviceName === null ? 'Geräte auswählen' : `Geräte · Aktiv: ${deviceName}`,
    closeSheet: 'Geräte-Auswahl schließen',
    settingsTitle: 'Geräte & Connect',
    settingsDescription: 'Steuere alle verbundenen Geräte deines Kontos in Echtzeit.',
    deviceTypes: {
      web: 'Webplayer',
      mobile: 'Smartphone',
      tablet: 'Tablet',
      desktop: 'Computer',
      tv: 'TV',
      speaker: 'Lautsprecher',
      other: 'Gerät',
    },
  },
  voice: {
    playFromSearchFailed: 'Sprachsuche konnte nicht abgespielt werden',
    noMatchesFor: (query) => `Keine Treffer für „${query}“ gefunden.`,
    noMatchesGeneric: 'Keine passenden Titel für deine Sprachsuche gefunden.',
    offlineUnavailable:
      'Für die Sprachsuche besteht keine Serververbindung. Prüfe deine Verbindung.',
    emptyLibrary: 'Keine gespeicherten oder zuletzt gehörten Titel zum Abspielen gefunden.',
    invalidIntentPayload: 'Die empfangene Sprachanfrage war ungültig.',
    resumedPlayback: 'Wiedergabe wird fortgesetzt.',
    startedPlayback: (title) => `Wiedergabe von „${title}“ gestartet.`,
    searchContextLabel: (query) => `Sprachsuche: „${query}“`,
  },
};

export const en: StringCatalog = {
  common: {
    appName: 'LoggeRythm', retry: 'Retry', retrying: 'Retrying…', showAll: 'Show all', working: 'Working…', dismiss: 'Dismiss', cancel: 'Cancel',
    play: 'Play', pause: 'Pause', shuffle: 'Shuffle', shuffleAll: 'Shuffle play', nextTrack: 'Next track', previousTrack: 'Previous track',
    loading: 'Loading…', artworkLoadFailed: 'Cover could not be loaded', trackBy: (title, artist) => `${title} by ${artist}`,
    trackCount: (count) => `${count} ${count === 1 ? 'track' : 'tracks'}`,
  },
  shell: {
    offlineTitle: 'Offline',
    offlineBody: 'Only downloaded music is available. Online content returns with the connection.',
    backOnlineTitle: 'Back online',
    backOnlineBody: 'Online content is available again.',
    revalidationFailedTitle: 'Could not verify session',
    revalidationFailedBody: 'Your online session could not be verified. Please try again.',
    revalidationRetry: 'Check again',
  },
  trackPresentation: {
    playing: 'Playing',
    paused: 'Playback paused',
    buffering: 'Buffering track…',
    active: 'Current track',
    playTrack: (title) => `Play ${title}`,
    pauseTrack: (title) => `Pause ${title}`,
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
    likedSongs: 'Liked Songs', playlists: 'Playlists', playlistInvite: 'Playlist Invite', insights: 'Listening insights', openProfile: 'Open profile',
    openProfileUpdateAvailable: 'Open profile, app update available',
    openProfileUpdateFailed: 'Open profile, update failed',
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
    radarNewTrack: 'New',
    radarRule:
      'New releases from artists you follow or have played at least twice in the last 90 days.',
    radarReason: {
      followed: (artist) => `You follow ${artist}`,
      played: (plays, artist) => `Played ${plays}×: ${artist}`,
      followedUnnamed: 'Following',
      playedUnnamed: (plays) => `Artist played ${plays}×`,
    },
    radarReasonSpoken: {
      followed: (artist) => `In your radar because you follow ${artist}`,
      played: (plays, artist) => `In your radar because you played ${artist} ${plays} times`,
      followedUnnamed: 'In your radar because you follow an artist on this track',
      playedUnnamed: (plays) =>
        `In your radar because you played an artist on this track ${plays} times`,
    },
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
    continueListening: 'Jump back in',
    continueEmptyTitle: 'Nothing played yet',
    continueEmptyMessage: 'Play a track and pick up right here afterwards.',
    continueEmptyAction: 'Find music',
    radarEmptyTitle: 'Your radar is still empty',
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
    playbackTitle: 'Playback',
    playbackSubtitle: 'Crossfade transitions between tracks on your account.',
    crossfadeEnabled: 'Enable crossfade',
    crossfadeHint: 'Smoothly blend between consecutive tracks.',
    crossfadeDuration: (seconds) => `${seconds}s`,
    crossfadeSaved: 'Playback settings saved.',
    crossfadeSaveFailed: 'Could not save playback settings.',
    crossfadeLoadFailed: 'Could not load playback settings.',
    storageTitle: 'Storage & Downloads',
    storageSubtitle: 'Manage offline downloads, stream cache, and download rules.',
    storageDownloadsLabel: 'Offline downloads',
    storageDownloadsSummary: (count, size) =>
      `${count} ${count === 1 ? 'track' : 'tracks'} · ${size}`,
    storageFreeSpace: (size) => `${size} free device storage`,
    storageStreamCacheLabel: 'Rolling stream cache',
    storageStreamCacheHint: 'Up to 500 MiB of cached streams for instant replay.',
    clearStreamCache: 'Clear stream cache',
    clearingStreamCache: 'Clearing cache…',
    streamCacheCleared: 'Stream cache cleared.',
    streamCacheClearFailed: 'Could not clear stream cache.',
    wifiOnlyLabel: 'Download on Wi-Fi only',
    wifiOnlyHint: 'Blocks offline downloads over cellular data.',
    wifiOnlySaveFailed: 'Could not save Wi-Fi preference.',
    wifiRequiredError:
      'Downloads are restricted to Wi-Fi. Connect to Wi-Fi or change this setting in Profile.',
    playTopTrack: (title) => `Play top track ${title}`,
    openTopArtist: (name) => `Open top artist ${name}`,
    statActionFailed: 'Could not open item from listening stats.',
    publicProfileTitle: 'Profile',
    publicProfileJoined: (date) => `Joined ${date}`,
    publicProfilePlaylists: 'Public playlists',
    publicProfileNoPlaylists: 'No public playlists yet.',
    publicProfileLoadFailed: 'Could not load profile.',
    openUserProfile: (name) => `Open ${name}’s profile`,
    update: {
      titleVersion: 'App version',
      titleAvailable: 'Update available',
      titleUninstallable: 'Update can’t be installed',
      installedVersion: (version) => `LoggeRythm ${version}`,
      installedBuild: (versionCode) => `Build ${versionCode}`,
      checking: 'Checking for updates…',
      upToDate: 'You have the latest version.',
      updatedTo: (version) => `Updated to version ${version}.`,
      lastChecked: (when) => `Last checked: ${when}`,
      justNow: 'just now',
      minutesAgo: (minutes) => `${minutes} min ago`,
      todayAt: (time) => `today, ${time}`,
      checkedOnDay: (date, time) => `${date}, ${time}`,
      transition: (from, to) => `${from} → ${to}`,
      availableMeta: (size, date) => `${size} · released ${date}`,
      releaseVersion: (version) => `Release ${version}`,
      notesLabel: 'What’s new (in German)',
      releaseLink: 'Full changelog on GitHub',
      install: (size) => `Install update (${size})`,
      preparing: 'Preparing the installation…',
      downloading: (version) => `Downloading and verifying version ${version}…`,
      downloadingHint: 'You can keep using the app meanwhile.',
      progressLabel: 'Update download',
      confirm: (version) =>
        `Version ${version} is verified. Confirm the installation in the Android dialog.`,
      confirmHint:
        'After installing, open the new version from the notification or the app icon. No dialog? Start the installation again.',
      progressWarning:
        'The download’s progress report was faulty. The verified update was still handed to Android.',
      restartInstall: 'Start again',
      permission:
        'Android must allow LoggeRythm to install apps. Turn on “Allow from this source”, then come back.',
      permissionContinue: 'Allowed – continue',
      installedNewerName: (latest) =>
        `This version is newer than the latest release (${latest}).`,
      installedNewerBuild: (build, latest, latestBuild) =>
        `This installation (build ${build}) is newer than release ${latest} (build ${latestBuild}). Android would reject the update, so it is not offered.`,
      installedNewerHint:
        'This happens with test and development builds. A release with a higher version number will be offered here once it is out.',
      installedSameBuild: (latest, build) =>
        `Release ${latest} has the same build number (${build}) as this installation, so it can’t be installed.`,
      installedSameBuildHint:
        'The release’s “Android-Versioncode” line is probably wrong. Once it is corrected, the update will be offered here.',
      viewRelease: 'View release on GitHub',
      recheck: 'Check again',
      retryInstall: 'Try again',
      checkAnnouncement: {
        upToDate: 'No new version.',
        available: (version) => `Update ${version} available.`,
        uninstallable: (version) => `Update ${version} can’t be installed.`,
        installedNewer: 'This installation is newer than the latest release.',
        installedSameBuild: (latest) =>
          `Release ${latest} has the same build number and can’t be installed.`,
      },
      checkFailedTitle: 'Update check failed',
      installFailedTitle: 'Update failed',
      finalFailureHint: {
        release: 'Trying again can’t install this release. The release page has all the details.',
        device:
          'Trying again can’t install this release on this device. The exact cause is in the details above.',
      },
      startupPhase: {
        check: 'Update check failed',
        pendingInstall: 'Outcome of the last update unclear',
        installOutcome: 'Last update not installed',
        installOutcomeUnavailable: 'Status of the last update unreadable',
        appLocale: 'Language of update notices not set',
      },
      updatedToast: (version) => `LoggeRythm was updated to version ${version}.`,
      startupFailureToast: (phase) => `${phase} – details in your profile`,
      detail: (code, message) => `Details: ${code} – ${message}`,
      errors: {
        network: 'GitHub can’t be reached. Check your internet connection.',
        rateLimited: (status) =>
          `GitHub’s limit for update checks was reached (HTTP ${status}). Try again later.`,
        http: (status) => `GitHub responded with HTTP ${status}.`,
        releaseVersionCodeMissing: (version) =>
          `Release ${version} has no build number (“Android-Versioncode”), so it can’t be checked whether the update installs.`,
        releaseVersionCodeAmbiguous: (version) =>
          `Release ${version} names more than one build number. The release needs fixing.`,
        releaseInvalid: 'The GitHub release is incomplete or invalid.',
        installedVersionInvalid: (version) =>
          `The installed version “${version}” is not a stable version number and can’t be compared.`,
        markerInvalid: 'The saved state of the last update was corrupt and has been discarded.',
        permissionRequired:
          'LoggeRythm may not install apps yet. Allow it in Android settings.',
        digestMismatch:
          'The download’s checksum doesn’t match GitHub. Nothing was installed.',
        signatureMismatch:
          'The update is signed differently from the installed app. Android can’t install it over this one.',
        apkNotNewer: (version, build) =>
          `Release ${version}’s APK is not newer than this installation (build ${build}). Nothing was installed.`,
        apkVersionMismatch: (version) =>
          `The downloaded APK doesn’t match release ${version}. Nothing was installed.`,
        apkVersionCodeMismatch: (version) =>
          `The APK’s build number doesn’t match the one declared in release ${version}. Nothing was installed.`,
        download: 'The download was interrupted.',
        installBusy: 'An update is already running.',
        installSession: 'Android couldn’t start the installation.',
        installAborted: 'Installation cancelled. You can start it again.',
        installRejected: 'Android rejected the installation.',
        installIncompatible: 'This device doesn’t meet the update’s requirements.',
        installBlocked: 'A device policy blocks the installation.',
        installConflict: 'Android reports a conflict with the installed app.',
        confirmationBlocked:
          'Android couldn’t show the installation for confirmation because LoggeRythm was in the background and notifications are blocked. Start it again while the app is open.',
        outcomeUnsaved:
          'Android couldn’t save the update’s status. Start the installation again.',
        permissionSettingsUnavailable:
          'Android offers no setting that lets LoggeRythm install apps.',
        installedUnreadable: 'Android couldn’t read the installed version of LoggeRythm.',
        moduleInvalidated: 'The updater was stopped before it finished. Try again.',
        appLocale:
          'Android couldn’t apply the app language to update notices. They may appear in another language.',
        packageMismatch:
          'The downloaded APK doesn’t belong to LoggeRythm. Nothing was installed.',
        apkInvalid:
          'The downloaded APK is invalid or incomplete. Nothing was installed.',
        unknown: 'Unknown error – details below.',
        unknownShort: 'Unknown error.',
        linkFailed: 'The release page couldn’t be opened.',
      },
      safety:
        'Only signed APKs from LoggeL/LoggeRythm. Build number, checksum, package, version and signature are verified before installing.',
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
      'Playback remains available. Pull down in Library to retry loading the Android Auto library.',
    autoLibraryReadyLog: '[LoggeRythm] Android Auto library ready',
    notificationChannelName: 'Playback', autoLikedSongs: 'Liked Songs', autoPlaylists: 'Playlists',
    autoDownloads: 'Downloads',
    autoHome: 'Home',
    autoRadio: 'Radio',
    autoDownloadedSongs: 'Downloaded Songs',
    autoRecent: 'Recently Played',
    autoReleaseRadar: 'Release Radar',
    autoDownloadedProgress: (downloaded, total) => `${downloaded} of ${total} tracks downloaded`,
    bookkeepingFailedTitle: 'Playback data could not be updated',
    bookkeepingFailedMessage:
      'Playback and the queue remain available. Listening history or radio could not be updated.',
    commandRejectedTitle: 'The queue change could not be applied',
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
    playingFrom: 'Playing from',
    nowPlayingHeading: 'Now playing',
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
      notSynchronized: 'Not synchronized',
      followActiveLine: 'Follow active line',
      syncToCurrent: 'Sync to current line',
      autoScrollPaused: 'Auto-scroll paused',
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
      standardVariant: 'Standard',
      aiVariant: 'AI Lyrics',
      switchToAi: 'Load AI-transcribed lyrics',
      switchToStandard: 'Load standard lyrics',
      shareQuote: 'Share lyric quote',
      shareQuoteHint: 'Long press to share this line as a quote',
      shareQuoteFailed: 'Could not share lyric quote.',
    },
    sleepTimer: 'Sleep timer',
    sleepTimerActive: (label) => `Sleep timer active: ${label}`,
    sleepTimerSheetClose: 'Close sleep timer',
    shareTrack: 'Share track',
    shareFailed: 'Sharing failed',
    moreTrackActions: 'More track actions',
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
    libraryLikesOffline: 'Liked Songs are unavailable offline. Connect and try again.',
    libraryLikesLoadFailed: 'Liked Songs could not be loaded and are missing from these matches.',
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
    recentTitle: 'Recent searches',
    recentClear: 'Clear history',
    recentClearLabel: 'Clear recent searches',
    recentEmpty: 'No recent searches yet.',
    recentOpen: (query) => `Search again: ${query}`,
    recentRemove: (query) => `Remove from recent searches: ${query}`,
    recentLoadFailed: 'Recent searches could not be loaded.',
    recentSaveFailed: 'Recent searches could not be saved.',
    trackDuration: (duration) => `Duration ${duration}`,
    trackPlayCount: (plays, listeners) =>
      `${plays.toLocaleString('en-US')} plays · ${listeners.toLocaleString('en-US')} listeners (Last.fm)`,
    trackPopularity: (percent) => `Popularity ${percent}%`,
    trackDeviceCache: (duration) => `Device cache ${duration}`,
    trackServerCached: 'Stored on the server',
    playlistLoading: 'Loading playlist…', playlistLoadFailed: 'Playlist could not be loaded',
    playFailed: 'Search result could not be played',
    radioFailed: 'Track is playing, but its radio could not be loaded',
    importTitle: 'Import from Spotify', importOpen: 'Import a Spotify link',
    importClose: 'Close Spotify import',
    importIntro:
      'Paste a Spotify track, album, or playlist link. The import runs in the background, even for large playlists – you can leave and pick up the result here later. Matching tracks play through Deezer.',
    importInputLabel: 'Spotify link',
    importPlaceholder: 'https://open.spotify.com/playlist/…', importResolve: 'Import',
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
    importStarting: 'Starting…',
    importStartFailed: (detail) => `Import could not be started: ${detail}`,
    importServerUnreachable: 'The server cannot be reached.',
    importServerNoDetail: 'The server gave no reason.',
    importBackgroundHint:
      'The import keeps running in the background. You can go elsewhere and pick up the result later under “Your imports”.',
    importReadingLink: 'Reading the Spotify link…',
    importProgressLabel: 'Import progress',
    importJobsTitle: 'Your imports',
    importJobsLoading: 'Loading your imports…',
    importJobsLoadFailed: (detail) => `Your imports could not be loaded: ${detail}`,
    importJobQueued: 'Waiting to start…',
    importJobReading: 'Reading the tracks from Spotify…',
    importJobProgress: (processed, total, matched) =>
      `${processed}/${total} checked · ${matched} found`,
    importJobDone: (matched, total) => `Done · ${matched}/${total} tracks found`,
    importJobFailed: (error) => `Failed: ${error}`,
    importJobNoServerError: 'without an error message from the server',
    importJobOpen: 'Open',
    importJobOpenLabel: (title) => `Open import: ${title}`,
    importJobCancel: (title) => `Cancel import: ${title}`,
    importJobRemove: (title) => `Remove import: ${title}`,
    importJobCancelConfirmTitle: 'Cancel import?',
    importJobCancelConfirmMessage: (title) =>
      `${title} will be cancelled. Its progress so far is lost.`,
    importJobCancelConfirm: 'Cancel import',
    importJobKeepRunning: 'Keep running',
    importJobRemoveFailed: (detail) => `Import could not be removed: ${detail}`,
    importJobResultLoading: 'Loading the imported tracks…',
    importJobResultFailed: 'The imported tracks could not be loaded',
    importFinishedNotice: (title, matched, total) =>
      `Spotify import finished: ${title} (${matched}/${total} tracks). Pick it up under Search → Spotify import.`,
    importFailedNotice: (title) => `Spotify import failed: ${title}`,
    sections: {
      library: 'In your library',
      tracks: 'Tracks', albums: 'Albums', artists: 'Artists', playlists: 'Playlists',
    },
    openAlbum: (title, artist) => `Open album ${title} by ${artist}`,
    openArtist: (name) => `Open artist ${name}`,
    openPlaylist: (title, count) => `Open playlist ${title}, ${count} tracks`,
    openGenre: (name) => `Open ${name} genre`,
    topResult: 'Top result',
    noResultsHint: 'Check the spelling or try a different term.',
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
    download: 'Download track',
    removeDownload: 'Remove track download',
    downloadFailed: 'Track could not be downloaded',
    removeDownloadFailed: 'Track download could not be removed',
    downloadSucceeded: (title) => `${title} was downloaded.`,
    removeDownloadSucceeded: (title) => `${title}'s download was removed.`,
    openAlbum: (title) => `Open album ${title}`,
    openArtist: (name) => `Open artist ${name}`,
    share: 'Share',
    shareFailed: 'Track could not be shared',
    shareSucceeded: (title) => `Shared ${title}.`,
    searchPlaylistsPlaceholder: 'Filter playlists…',
    alreadyInPlaylist: 'Already added',
    addToSelectedPlaylists: (count) => `Add to ${count} playlists`,
    addedToMultiplePlaylists: (title, count) => `${title} was added to ${count} playlists.`,
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
    playlistCollaborativeCount: (count) =>
      `Collaborative · ${count} ${count === 1 ? 'track' : 'tracks'}`,
    playlistSharedTrackCount: (owner, count) =>
      `By ${owner} · ${count} ${count === 1 ? 'track' : 'tracks'}`,
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
      discover: 'Discover', genre: 'Genre', home: 'Home', liked: 'Liked Songs', party: 'Party',
      playlist: 'Playlist', radio: 'Radio', recent: 'Recently played', search: 'Search',
    })[type],
    recentContext: 'Recently played',
    trackRadioContext: (title) => `Track radio: “${title}”`,
    currentlyPlaying: 'PLAYING', currentTrackSuffix: ', currently playing', skipHint: 'Skip to this track',
    loadFailed: 'Loading queue failed',
    skipLabel: (title, artist, active) => `${title} by ${artist}${active ? ', currently playing' : ''}`,
    skipFailed: (title) => `Skipping to ${title} failed`, moveUp: (title) => `Move ${title} up`,
    skippedTo: (title) => `Skipped to ${title}.`,
    moveDown: (title) => `Move ${title} down`, moveUpFailed: (title) => `Moving ${title} up failed`,
    moveDownFailed: (title) => `Moving ${title} down failed`,
    movedUp: (title) => `${title} moved up.`, movedDown: (title) => `${title} moved down.`,
    reorder: (title) => `Reorder ${title}`,
    reorderHint: 'Drag to reorder the track. Tap to show the move buttons.',
    remove: (title) => `Remove ${title} from queue`,
    cannotRemoveCurrent: (title) => `Cannot remove currently playing track ${title}`,
    removeFailed: (title) => `Removing ${title} failed`,
    removed: (title) => `${title} was removed from the queue.`,
    nowPlayingSection: 'Now playing',
    upNextSection: 'Up next',
  },
  party: {
    eyebrow: 'Listening together',
    defaultName: 'Party',
    live: 'Live',
    stale: 'Out of date',
    youAreHost: "You're the host",
    hostedBy: (name) => `Host: ${name}`,
    memberCount: (count) => (count === 1 ? '1 person' : `${count} people`),
    codeLabel: 'Party code',
    share: 'Share invite link',
    shareMessage: (name, url) => `Listen along in the party “${name}”: ${url}`,
    shareFailed: (detail) => `Sharing the invite link failed: ${detail}`,
    leave: 'Leave party',
    leaving: 'Leaving party…',
    leaveConfirmTitle: 'Leave the party?',
    leaveConfirmHost: 'As the host you control playback for everyone in this party.',
    leaveConfirmMember:
      'Your playback will no longer follow the host. You can rejoin with the invite link.',
    leaveConfirm: 'Leave',
    leaveStay: 'Stay',
    leaveFailed: (detail) => `Leaving the party failed: ${detail}`,
    followHint: (host) =>
      `${host} controls playback. Yours follows automatically – you can add songs any time.`,
    detachedTitle: 'Your playback no longer follows the party',
    detachedBody: 'You started other music. The party continues without you.',
    rejoinPlayback: 'Listen along again',
    syncFailed: (detail) => `Syncing playback with the party failed: ${detail}`,
    broadcastFailed: (detail) => `Sending playback to the party failed: ${detail}`,
    joining: 'Joining party…',
    joinFailedTitle: "Can't join",
    joinFailed: (detail) => `Joining the party failed: ${detail}`,
    retryJoin: 'Try again',
    loadFailed: (detail) => `The party is out of date: ${detail}`,
    reload: 'Reload',
    invalidCodeTitle: 'Invalid party link',
    invalidCodeBody: "This link doesn't contain a valid party code.",
    back: 'Back',
    serverUnreachable: "The server can't be reached. Check your connection.",
    serverNoDetail: (status) => `The server answered HTTP ${status} without a reason.`,
    streamEnded: 'The server ended the live connection.',
    streamNetwork: 'The live connection dropped (network error).',
    streamTimeout: 'The live connection timed out.',
    streamRejected: (status, detail) =>
      detail === ''
        ? `The server rejected the live connection (HTTP ${status}).`
        : `The server rejected the live connection (HTTP ${status}): ${detail}`,
    searchLabel: 'Search songs for the party',
    searchPlaceholder: 'Title or artist',
    searching: 'Searching…',
    searchFailed: (detail) => `Search failed: ${detail}`,
    searchEmpty: (query) => `No songs found for “${query}”.`,
    add: (title) => `Add “${title}” to the party`,
    added: (title) => `“${title}” is now in the party.`,
    addFailed: (title, detail) => `Adding “${title}” failed: ${detail}`,
    queueTitle: 'Party queue',
    queueEmpty: 'No songs yet. Search above and add some.',
    nowPlaying: 'Now playing',
    addedBy: (name) => `by ${name}`,
    addedByYou: 'by you',
    playAt: (title) => `Play “${title}” for everyone`,
    moveUp: (title) => `Move “${title}” up`,
    moveDown: (title) => `Move “${title}” down`,
    remove: (title) => `Remove “${title}” from the party`,
    playFailed: (title, detail) => `Playing “${title}” failed: ${detail}`,
    moveFailed: (title, detail) => `Moving “${title}” failed: ${detail}`,
    removeFailed: (title, detail) => `Removing “${title}” failed: ${detail}`,
    loadReady: 'Loaded',
    loadLoading: 'Loading…',
    loadQueued: 'Waiting to load',
    loadFailedState: (reason) => `Loading failed: ${reason}`,
    loadIdle: 'Not loaded',
    buffering: 'Buffering…',
    membersTitle: 'Listening',
    hostBadge: 'Host',
    guestBadge: 'Guest',
    startParty: 'Start Jam',
    startingParty: 'Starting Jam…',
    startPartyFailed: (detail) => `Starting the Jam failed: ${detail}`,
    activeTitle: (name) => (name === null ? 'Jam is on' : `Jam “${name}” is on`),
    openParty: 'Open Jam',
    queueLocked: 'This queue belongs to the Jam. Edit it inside the Jam.',
    addedToParty: (title) => `“${title}” was added to the Jam.`,
    endJam: 'End Jam',
    endingJam: 'Ending Jam…',
    endConfirmTitle: 'End Jam for everyone?',
    endConfirmBody: 'This will end the Jam immediately and disconnect all participants.',
    endConfirm: 'End Jam',
    endFailed: (detail) => `Ending the Jam failed: ${detail}`,
    endedNotice: 'The host ended this Jam.',
    kickedNotice: 'You were removed from this Jam.',
    renameLabel: 'Jam name',
    renamePlaceholder: 'Name this Jam',
    renameSave: 'Save',
    renameFailed: (detail) => `Renaming the Jam failed: ${detail}`,
    guestsCanControlLabel: 'Let others control playback',
    guestsCanControlHint: 'Participants can play, pause, skip, and reorder the queue.',
    settingsFailed: (detail) => `Saving Jam settings failed: ${detail}`,
    sharedControlHint: 'Everyone in this Jam can control playback and the queue.',
    listenOnDevice: 'Listen on this device',
    controlOnly: 'Control only (muted here)',
    controlOnlyHint: 'Audio stays paused here so you can control playback in the same room without echo.',
    kickMember: (name) => `Remove ${name} from the Jam`,
    kickConfirmTitle: 'Remove participant?',
    kickConfirmBody: (name) => `${name} will be disconnected from this Jam.`,
    kickConfirm: 'Remove',
    kickFailed: (name, detail) => `Removing ${name} failed: ${detail}`,
    playNext: (title) => `Play “${title}” next in the Jam`,
    playNextAdded: (title) => `“${title}” will play next in the Jam.`,
    playNextFailed: (title, detail) => `Queueing “${title}” next failed: ${detail}`,
    upNextTitle: 'Next in Jam',
    playedEarlierTitle: 'Played earlier',
    joinByCodeTitle: 'Join a Jam',
    joinCodeLabel: '6-character Jam code',
    joinCodePlaceholder: 'e.g. ABC123',
    joinSubmit: 'Join',
    joinInvalidCode: 'Enter a valid 6-character code.',
    inJamStrip: (name, count) =>
      `${name} · ${count === 1 ? '1 listening' : `${count} listening`}`,
    controlledByHost: (host) => `Playback controlled by ${host}`,
    playbackControlFailed: (detail) => `Playback control failed: ${detail}`,
    restoreActiveFailed: (detail) => `Restoring active Jam failed: ${detail}`,
    guestJoinButton: 'Join a Jam as Guest',
    guestJoinTitle: 'Join Jam as Guest',
    guestJoinSubtitle: 'Join without an account using a 6-character Jam code and add songs.',
    guestNicknameLabel: 'Your nickname',
    guestNicknamePlaceholder: 'e.g. Alex',
    guestNicknameRequired: 'Please enter a nickname.',
    guestJoining: 'Joining…',
    guestLeave: 'Leave Jam',
  },
  share: {
    trackMessage: (title, artist, url) => `${title} – ${artist}\n${url}`,
    albumMessage: (title, artist, url) => `Album “${title}” by ${artist}\n${url}`,
    artistMessage: (name, url) => `${name} on LoggeRythm\n${url}`,
    playlistMessage: (name, url) => `Playlist “${name}” on LoggeRythm\n${url}`,
    lyricQuoteMessage: (quote, title, artist, url) => `“${quote}”\n— ${title} · ${artist}\n${url}`,
    shareAction: 'Share',
    shareFailed: 'Sharing failed.',
  },
  connect: {
    title: 'Devices',
    connectToDevice: 'Connect to a device',
    thisDevice: 'This device',
    activeDevice: 'Current device',
    otherDevices: 'Select a device',
    listeningOn: (deviceName) => `Listening on ${deviceName}`,
    playHere: 'Play here',
    transferring: 'Transferring…',
    transferFailed: (detail) => `Transferring playback failed: ${detail}`,
    noOtherDevices: 'No other devices connected. Open LoggeRythm on another device signed into the same account.',
    deviceNameLabel: 'Device name',
    deviceNamePlaceholder: 'Name this device',
    deviceNameSave: 'Save',
    deviceNameSaved: 'Device name saved.',
    deviceNameEmpty: 'Enter a device name.',
    deviceNameFailed: (detail) => `Updating device name failed: ${detail}`,
    syncEnabledLabel: 'Multi-device control (Connect)',
    syncEnabledHint: 'Connect this device over WebSocket to control playback across all your devices.',
    syncDisabledNotice: 'Multi-device control is turned off.',
    enableSync: 'Turn on',
    connecting: 'Connecting…',
    connected: (count) => (count === 1 ? '1 device connected' : `${count} devices connected`),
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
    connectionFailed: (detail) => `Device connection failed: ${detail}`,
    retry: 'Retry',
    volumeLabel: 'Volume',
    mute: 'Mute',
    unmute: 'Unmute',
    volumeUnsupported: 'Remote volume control is not supported on this device.',
    commandFailed: (detail) => `Device command failed: ${detail}`,
    remoteQueueSubtitle: (deviceName) => `Queue on ${deviceName}`,
    leaveJamToSwitchTitle: 'Leave Jam?',
    leaveJamToSwitchBody: (deviceName) =>
      `Leave the active Jam and transfer playback to “${deviceName}”?`,
    leaveJamAndSwitch: 'Leave Jam & switch',
    jamSectionTitle: 'Listening together (Jam)',
    startJam: 'Start a Jam',
    joinJam: 'Join with code',
    openJam: 'Open active Jam',
    devicesButton: (deviceName) =>
      deviceName === null ? 'Select device' : `Devices · Active: ${deviceName}`,
    closeSheet: 'Close device selector',
    settingsTitle: 'Devices & Connect',
    settingsDescription: 'Control playback across every connected device on your account.',
    deviceTypes: {
      web: 'Web player',
      mobile: 'Phone',
      tablet: 'Tablet',
      desktop: 'Computer',
      tv: 'TV',
      speaker: 'Speaker',
      other: 'Device',
    },
  },
  voice: {
    playFromSearchFailed: 'Voice search playback failed',
    noMatchesFor: (query) => `No matches found for “${query}”.`,
    noMatchesGeneric: 'No matching music was found for your voice search.',
    offlineUnavailable:
      'Voice search could not reach the server. Check your connection.',
    emptyLibrary: 'No saved or recently played music is available to play.',
    invalidIntentPayload: 'The incoming voice search request was malformed.',
    resumedPlayback: 'Resuming playback.',
    startedPlayback: (title) => `Playing “${title}”.`,
    searchContextLabel: (query) => `Voice search: “${query}”`,
  },
};
