import * as localization from './index';
import type { AppLocale } from './index';
import type { AudioQualityTier, StatsInsightsRange } from '../api/types';
import type { EqualizerPresetName, LoudnessPresetName } from '../../modules/loggerythm-player/src';

export interface Wave2Strings {
  audioEffects: {
    openButton: string;
    closeButton: string;
    title: string;
    subtitle: string;
    eqTitle: string;
    eqEnabled: string;
    eqUnsupported: string;
    presetsLabel: string;
    presets: Record<EqualizerPresetName, string>;
    bassBoostTitle: string;
    bassBoostEnabled: string;
    bassBoostStrength: (percent: number) => string;
    loudnessTitle: string;
    loudnessEnabled: string;
    loudnessPresets: Record<LoudnessPresetName, string>;
    speedTitle: string;
    speedValue: (speed: number) => string;
    pitchReset: string;
    qualityTitle: string;
    qualitySubtitle: string;
    qualityOptions: Record<AudioQualityTier, { label: string; hint: string }>;
    qualityBadges: Record<AudioQualityTier, string>;
    loadFailed: string;
    updateFailed: string;
    nativeUnavailable: string;
    openFromProfile: string;
  };
  audioOutput: {
    title: string;
    openSwitcher: string;
    activeOutput: (name: string) => string;
    noDevices: string;
    switcherFailed: string;
    loadFailed: string;
  };
  waveform: {
    seekLabel: string;
    bpmBadge: (bpm: number) => string;
    lufsBadge: (lufs: number) => string;
    metaUnavailable: string;
  };
  lyrics: {
    instrumentalTitle: string;
    instrumentalBody: string;
    unsyncedHint: string;
    karaokeBadge: string;
  };
  visualizer: {
    openButton: string;
    closeButton: string;
    title: string;
    permissionTitle: string;
    permissionBody: string;
    permissionButton: string;
    permissionDenied: string;
    sessionUnavailable: string;
    genericError: string;
    activeLabel: string;
  };
  party2: {
    savePlaylistButton: string;
    savePlaylistTitle: string;
    savePlaylistNameLabel: string;
    savePlaylistCollaborative: string;
    savePlaylistConfirm: string;
    savingPlaylist: string;
    savedPlaylist: (name: string) => string;
    savePlaylistFailed: (detail: string) => string;
    transferHost: (name: string) => string;
    transferHostTitle: string;
    transferHostBody: (name: string) => string;
    transferHostConfirm: string;
    transferHostFailed: (detail: string) => string;
    autoDjLabel: string;
    autoDjHint: string;
    fillAutoDj: string;
    fillingAutoDj: string;
    fillAutoDjFailed: (detail: string) => string;
    voteSkip: string;
    voteSkipProgress: (votes: number, needed: number) => string;
    voteSkipVoted: (votes: number, needed: number) => string;
    voteSkipTriggered: string;
    voteSkipFailed: (detail: string) => string;
    reactionsLabel: string;
    reactFailed: (detail: string) => string;
    kioskButton: string;
    kioskClose: string;
    kioskTitle: string;
    kioskCodeLabel: string;
    kioskJoinHint: string;
    kioskAddedBy: (name: string) => string;
    kioskUpNext: string;
    kioskEmptyUpNext: string;
  };
  insights: {
    title: string;
    subtitle: string;
    openButton: string;
    openHint: string;
    ranges: Record<StatsInsightsRange, string>;
    listeningTime: string;
    formatDuration: (hours: number, minutes: number) => string;
    plays: string;
    uniqueTracks: string;
    uniqueArtists: string;
    currentStreak: string;
    longestStreak: string;
    streakDays: (days: number) => string;
    newArtists: string;
    topTracks: string;
    topArtists: string;
    topAlbums: string;
    hourlyTitle: string;
    weekdayTitle: string;
    weekdays: readonly [string, string, string, string, string, string, string];
    recentPlays: string;
    shareButton: string;
    shareMessage: (rangeLabel: string, duration: string, plays: number, topArtist: string) => string;
    shareFailed: string;
    emptyTitle: string;
    emptyBody: string;
    loadFailed: string;
  };
  friends: {
    title: string;
    subtitle: string;
    empty: string;
    shareActivityLabel: string;
    shareActivityHint: string;
    liveBadge: string;
    playingNow: string;
    recentTrack: string;
    joinJam: string;
    streamError: string;
  };
  blend: {
    createButton: string;
    creating: string;
    matchBadge: (percent: number) => string;
    sharedArtists: (artists: string) => string;
    sharedTracks: (count: number) => string;
    openPlaylist: string;
    failed: string;
  };
  collab: {
    liveBadge: string;
    updatedNotice: string;
    revokedNotice: string;
    deletedNotice: string;
    streamError: string;
  };
  homeMixes: {
    personalTitle: string;
  };
  playlistTools: {
    startRadio: string;
    startRadioHint: string;
    startingRadio: string;
    radioStarted: (name: string) => string;
    radioFailed: string;
    findDuplicates: string;
    findDuplicatesHint: string;
    duplicatesTitle: string;
    duplicatesLoading: string;
    duplicatesEmpty: string;
    duplicatesFound: (count: number) => string;
    duplicatesGroupCopies: (count: number) => string;
    deduplicateAction: (count: number) => string;
    deduplicating: string;
    deduplicated: (count: number) => string;
    duplicatesFailed: string;
    syncManifestSize: (tracks: number, size: string) => string;
  };
  importTarget: {
    label: string;
    modeNone: string;
    modeNew: string;
    modeExisting: string;
    newPlaylistPlaceholder: string;
    openCreatedPlaylist: string;
  };
  connectContinuity: {
    resumeTitle: string;
    resumeTrack: (title: string, artist: string) => string;
    resumeAction: string;
    resuming: string;
    resumeFailed: (detail: string) => string;
  };
}

const catalogs: Readonly<Record<AppLocale, Wave2Strings>> = {
  de: {
    audioEffects: {
      openButton: 'Klang',
      closeButton: 'Klang-Einstellungen schließen',
      title: 'Klang & Effekte',
      subtitle: 'Equalizer, Bass-Boost, Lautstärke-Normalisierung und Stream-Qualität.',
      eqTitle: '5-Band-Equalizer',
      eqEnabled: 'Equalizer aktivieren',
      eqUnsupported: 'Equalizer wird auf diesem Gerät nicht unterstützt.',
      presetsLabel: 'Voreinstellungen',
      presets: {
        flat: 'Linear',
        bass_boost: 'Bass',
        vocal: 'Stimmen',
        electronic: 'Electronic',
        rock: 'Rock',
        jazz: 'Jazz',
        classical: 'Klassik',
        acoustic: 'Akustik',
        late_night: 'Nacht',
      },
      bassBoostTitle: 'Bass-Boost',
      bassBoostEnabled: 'Bass-Boost aktivieren',
      bassBoostStrength: (percent) => `Stärke: ${percent} %`,
      loudnessTitle: 'Lautstärke-Normalisierung',
      loudnessEnabled: 'ReplayGain / Loudness aktivieren',
      loudnessPresets: {
        quiet: 'Leise',
        normal: 'Normal',
        loud: 'Laut',
      },
      speedTitle: 'Wiedergabegeschwindigkeit',
      speedValue: (speed) => `${speed.toFixed(2).replace(/\.00$/, '')}×`,
      pitchReset: 'Tonhöhe zurücksetzen',
      qualityTitle: 'Audio-Qualität',
      qualitySubtitle: 'Gilt für neue Streams und Offline-Downloads.',
      qualityOptions: {
        lossless: { label: 'Lossless (FLAC)', hint: 'Verlustfrei, höchster Datenverbrauch' },
        high: { label: 'Hoch (320 kbit/s)', hint: 'Standard-MP3 in hoher Qualität' },
        saver: { label: 'Datensparmodus (128 kbit/s)', hint: 'Geringerer Datenverbrauch unterwegs' },
      },
      qualityBadges: {
        lossless: 'FLAC',
        high: '320',
        saver: '128',
      },
      loadFailed: 'Klangeinstellungen konnten nicht geladen werden.',
      updateFailed: 'Klangeinstellung konnte nicht übernommen werden.',
      nativeUnavailable: 'Native Audio-Effekte sind auf dieser Plattform nicht verfügbar.',
      openFromProfile: 'Equalizer & Effekte öffnen',
    },
    audioOutput: {
      title: 'Audio-Ausgabe',
      openSwitcher: 'Ausgabegerät wechseln',
      activeOutput: (name) => `Aktiv: ${name}`,
      noDevices: 'Standard-Audioausgang des Geräts',
      switcherFailed: 'Audio-Auswahl konnte nicht geöffnet werden.',
      loadFailed: 'Audio-Ausgabegeräte konnten nicht geladen werden.',
    },
    waveform: {
      seekLabel: 'Wellenform-Fortschritt',
      bpmBadge: (bpm) => `${Math.round(bpm)} BPM`,
      lufsBadge: (lufs) => `${lufs.toFixed(1)} LUFS`,
      metaUnavailable: 'Wellenform wird analysiert …',
    },
    lyrics: {
      instrumentalTitle: 'Instrumental',
      instrumentalBody: 'Dieser Titel enthält keinen Gesangstext.',
      unsyncedHint: 'Text ohne Zeitstempel',
      karaokeBadge: 'Karaoke',
    },
    visualizer: {
      openButton: 'Visualizer',
      closeButton: 'Visualizer schließen',
      title: 'Live-Visualizer',
      permissionTitle: 'Audio-Zugriff für Visualizer',
      permissionBody:
        'Android benötigt die Mikrofon-Berechtigung (RECORD_AUDIO), um das laufende Audiosignal als Echtzeit-Spektrum darzustellen. Es wird nichts aufgenommen.',
      permissionButton: 'Freigeben & starten',
      permissionDenied:
        'Die Berechtigung für den Live-Visualizer wurde verweigert. Aktiviere sie in den App-Einstellungen.',
      sessionUnavailable:
        'Keine aktive Audio-Session verfügbar. Starte zuerst die Wiedergabe auf diesem Gerät.',
      genericError: 'Der Live-Visualizer konnte nicht gestartet werden.',
      activeLabel: 'Echtzeit-Audiospektrum aktiv',
    },
    party2: {
      savePlaylistButton: 'Als Playlist speichern',
      savePlaylistTitle: 'Jam als Playlist speichern',
      savePlaylistNameLabel: 'Playlist-Name',
      savePlaylistCollaborative: 'Als gemeinsame Playlist anlegen',
      savePlaylistConfirm: 'Speichern',
      savingPlaylist: 'Wird gespeichert …',
      savedPlaylist: (name) => `Playlist „${name}“ wurde gespeichert.`,
      savePlaylistFailed: (detail) => `Jam konnte nicht gespeichert werden: ${detail}`,
      transferHost: (name) => `Host an ${name} übergeben`,
      transferHostTitle: 'Host-Rolle übergeben?',
      transferHostBody: (name) =>
        `${name} übernimmt die Steuerung dieses Jams. Du bleibst als Mitglied dabei.`,
      transferHostConfirm: 'Übergeben',
      transferHostFailed: (detail) => `Host-Übergabe fehlgeschlagen: ${detail}`,
      autoDjLabel: 'Auto-DJ',
      autoDjHint: 'Füllt die Jam-Warteschlange automatisch mit passenden Titeln auf.',
      fillAutoDj: 'Queue auffüllen',
      fillingAutoDj: 'Wird aufgefüllt …',
      fillAutoDjFailed: (detail) => `Auto-DJ konnte keine Titel laden: ${detail}`,
      voteSkip: 'Skip abstimmen',
      voteSkipProgress: (votes, needed) => `Skip (${votes}/${needed})`,
      voteSkipVoted: (votes, needed) => `Abgestimmt (${votes}/${needed})`,
      voteSkipTriggered: 'Titel wurde per Abstimmung übersprungen.',
      voteSkipFailed: (detail) => `Skip-Abstimmung fehlgeschlagen: ${detail}`,
      reactionsLabel: 'Reaktion senden',
      reactFailed: (detail) => `Reaktion fehlgeschlagen: ${detail}`,
      kioskButton: 'Party-Screen',
      kioskClose: 'Party-Screen schließen',
      kioskTitle: 'Party-Screen',
      kioskCodeLabel: 'Beitrittscode',
      kioskJoinHint: 'Code auf loggerythm eingeben oder QR-Muster scannen',
      kioskAddedBy: (name) => `Hinzugefügt von ${name}`,
      kioskUpNext: 'Als Nächstes',
      kioskEmptyUpNext: 'Füge Titel hinzu, um die Party am Laufen zu halten.',
    },
    insights: {
      title: 'Deine Hör-Insights',
      subtitle: 'Hörzeit, Serien, Spitzenzeiten und deine Favoriten im Überblick.',
      openButton: 'Alle Hör-Insights öffnen',
      openHint: 'Serien, Top-Alben, Uhrzeiten und Rückblick ansehen',
      ranges: {
        '7d': '7 Tage',
        '30d': '30 Tage',
        '90d': '90 Tage',
        year: 'Jahr',
        all: 'Gesamt',
      },
      listeningTime: 'Hörzeit',
      formatDuration: (hours, minutes) =>
        hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`,
      plays: 'Wiedergaben',
      uniqueTracks: 'Verschiedene Titel',
      uniqueArtists: 'Künstler:innen',
      currentStreak: 'Aktuelle Serie',
      longestStreak: 'Längste Serie',
      streakDays: (days) => (days === 1 ? '1 Tag' : `${days} Tage`),
      newArtists: 'Neu entdeckt',
      topTracks: 'Top-Titel',
      topArtists: 'Top-Künstler:innen',
      topAlbums: 'Top-Alben',
      hourlyTitle: 'Wann du am meisten hörst (24 Std.)',
      weekdayTitle: 'Nach Wochentag',
      weekdays: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
      recentPlays: 'Verlauf',
      shareButton: 'Rückblick teilen',
      shareMessage: (rangeLabel, duration, plays, topArtist) =>
        `Mein LoggeRythm-Rückblick (${rangeLabel}): ${duration} gehört, ${plays} Wiedergaben${topArtist ? `, Top-Artist: ${topArtist}` : ''}.`,
      shareFailed: 'Rückblick konnte nicht geteilt werden.',
      emptyTitle: 'Noch keine Hördaten in diesem Zeitraum',
      emptyBody: 'Spiele ein paar Titel ab, um deinen persönlichen Rückblick zu füllen.',
      loadFailed: 'Hör-Insights konnten nicht geladen werden.',
    },
    friends: {
      title: 'Freunde hören gerade',
      subtitle: 'Live-Aktivität aus deiner Community.',
      empty: 'Gerade teilt niemand seine Wiedergabe.',
      shareActivityLabel: 'Höraktivität teilen',
      shareActivityHint: 'Zeigt anderen, welchen Titel du gerade hörst.',
      liveBadge: 'LIVE',
      playingNow: 'Hört gerade',
      recentTrack: 'Zuletzt gehört',
      joinJam: 'Jam beitreten',
      streamError: 'Live-Feed der Freunde unterbrochen.',
    },
    blend: {
      createButton: 'Taste Blend erstellen',
      creating: 'Blend wird erstellt …',
      matchBadge: (percent) => `${Math.round(percent)} % Match`,
      sharedArtists: (artists) => `Gemeinsame Artists: ${artists}`,
      sharedTracks: (count) => `${count} gemeinsame Favoriten`,
      openPlaylist: 'Blend-Playlist öffnen',
      failed: 'Taste Blend konnte nicht erstellt werden.',
    },
    collab: {
      liveBadge: 'Live-Sync',
      updatedNotice: 'Playlist wurde live aktualisiert.',
      revokedNotice: 'Dein Zugriff auf diese Playlist wurde widerrufen.',
      deletedNotice: 'Diese Playlist wurde gelöscht.',
      streamError: 'Live-Sync der Playlist wurde unterbrochen.',
    },
    homeMixes: {
      personalTitle: 'Für dich gemixt',
    },
    playlistTools: {
      startRadio: 'Playlist-Radio starten',
      startRadioHint: 'Ähnliche Titel passend zu dieser Auswahl abspielen',
      startingRadio: 'Radio wird gestartet …',
      radioStarted: (name) => `Radio basierend auf „${name}“ gestartet.`,
      radioFailed: 'Radio konnte nicht gestartet werden.',
      findDuplicates: 'Duplikate suchen',
      findDuplicatesHint: 'Doppelte Einträge prüfen und bereinigen',
      duplicatesTitle: 'Duplikate in Playlist',
      duplicatesLoading: 'Suche nach doppelten Titeln …',
      duplicatesEmpty: 'Keine Duplikate gefunden – deine Playlist ist sauber.',
      duplicatesFound: (count) =>
        count === 1 ? '1 doppelter Eintrag gefunden.' : `${count} doppelte Einträge gefunden.`,
      duplicatesGroupCopies: (count) => `${count} überzählige Kopien`,
      deduplicateAction: (count) =>
        count === 1 ? '1 Duplikat entfernen' : `${count} Duplikate entfernen`,
      deduplicating: 'Wird bereinigt …',
      deduplicated: (count) =>
        count === 1 ? '1 Duplikat wurde entfernt.' : `${count} Duplikate wurden entfernt.`,
      duplicatesFailed: 'Duplikat-Prüfung fehlgeschlagen.',
      syncManifestSize: (tracks, size) => `${tracks} Titel · ca. ${size}`,
    },
    importTarget: {
      label: 'Direkt speichern in',
      modeNone: 'Nur auflösen',
      modeNew: 'Neue Playlist',
      modeExisting: 'Vorhandene Playlist',
      newPlaylistPlaceholder: 'Name der neuen Playlist',
      openCreatedPlaylist: 'Erstellte Playlist öffnen',
    },
    connectContinuity: {
      resumeTitle: 'Letzte Sitzung fortsetzen',
      resumeTrack: (title, artist) => `${title} · ${artist}`,
      resumeAction: 'Hier fortsetzen',
      resuming: 'Wird fortgesetzt …',
      resumeFailed: (detail) => `Sitzung konnte nicht fortgesetzt werden: ${detail}`,
    },
  },
  en: {
    audioEffects: {
      openButton: 'Audio',
      closeButton: 'Close audio effects',
      title: 'Audio Craft',
      subtitle: 'Equalizer, bass boost, loudness normalization, and stream quality.',
      eqTitle: '5-Band Equalizer',
      eqEnabled: 'Enable equalizer',
      eqUnsupported: 'Equalizer is not supported on this device.',
      presetsLabel: 'Presets',
      presets: {
        flat: 'Flat',
        bass_boost: 'Bass Boost',
        vocal: 'Vocal',
        electronic: 'Electronic',
        rock: 'Rock',
        jazz: 'Jazz',
        classical: 'Classical',
        acoustic: 'Acoustic',
        late_night: 'Late Night',
      },
      bassBoostTitle: 'Bass Boost',
      bassBoostEnabled: 'Enable bass boost',
      bassBoostStrength: (percent) => `Strength: ${percent}%`,
      loudnessTitle: 'Loudness Normalization',
      loudnessEnabled: 'Enable ReplayGain / Loudness',
      loudnessPresets: {
        quiet: 'Quiet',
        normal: 'Normal',
        loud: 'Loud',
      },
      speedTitle: 'Playback Speed',
      speedValue: (speed) => `${speed.toFixed(2).replace(/\.00$/, '')}×`,
      pitchReset: 'Reset pitch',
      qualityTitle: 'Audio Quality',
      qualitySubtitle: 'Applies to new streams and offline downloads.',
      qualityOptions: {
        lossless: { label: 'Lossless (FLAC)', hint: 'Bit-perfect audio, highest data usage' },
        high: { label: 'High (320 kbps)', hint: 'Standard high-quality MP3' },
        saver: { label: 'Data Saver (128 kbps)', hint: 'Lower bandwidth on cellular' },
      },
      qualityBadges: {
        lossless: 'FLAC',
        high: '320',
        saver: '128',
      },
      loadFailed: 'Could not load audio settings.',
      updateFailed: 'Could not apply audio setting.',
      nativeUnavailable: 'Native audio effects are unavailable on this platform.',
      openFromProfile: 'Open Equalizer & Effects',
    },
    audioOutput: {
      title: 'Audio Output',
      openSwitcher: 'Switch audio output',
      activeOutput: (name) => `Active: ${name}`,
      noDevices: 'Default device audio output',
      switcherFailed: 'Could not open audio output switcher.',
      loadFailed: 'Could not load audio output devices.',
    },
    waveform: {
      seekLabel: 'Waveform playback progress',
      bpmBadge: (bpm) => `${Math.round(bpm)} BPM`,
      lufsBadge: (lufs) => `${lufs.toFixed(1)} LUFS`,
      metaUnavailable: 'Analyzing waveform…',
    },
    lyrics: {
      instrumentalTitle: 'Instrumental',
      instrumentalBody: 'This track has no vocal lyrics.',
      unsyncedHint: 'Unsynced lyrics',
      karaokeBadge: 'Karaoke',
    },
    visualizer: {
      openButton: 'Visualizer',
      closeButton: 'Close visualizer',
      title: 'Live Visualizer',
      permissionTitle: 'Audio Permission for Visualizer',
      permissionBody:
        'Android requires RECORD_AUDIO permission to render the active audio session as a real-time spectrum. Nothing is recorded.',
      permissionButton: 'Allow & start',
      permissionDenied:
        'Permission for the live visualizer was denied. Enable it in system app settings.',
      sessionUnavailable:
        'No active audio session available. Start playback on this device first.',
      genericError: 'Could not start the live visualizer.',
      activeLabel: 'Real-time audio spectrum active',
    },
    party2: {
      savePlaylistButton: 'Save as Playlist',
      savePlaylistTitle: 'Save Jam as Playlist',
      savePlaylistNameLabel: 'Playlist name',
      savePlaylistCollaborative: 'Create as collaborative playlist',
      savePlaylistConfirm: 'Save',
      savingPlaylist: 'Saving…',
      savedPlaylist: (name) => `Saved playlist “${name}”.`,
      savePlaylistFailed: (detail) => `Could not save Jam: ${detail}`,
      transferHost: (name) => `Make ${name} host`,
      transferHostTitle: 'Transfer host role?',
      transferHostBody: (name) =>
        `${name} will take over hosting this Jam. You will stay in the room as a member.`,
      transferHostConfirm: 'Transfer',
      transferHostFailed: (detail) => `Host transfer failed: ${detail}`,
      autoDjLabel: 'Auto-DJ',
      autoDjHint: 'Automatically keeps the Jam queue topped up with matching tracks.',
      fillAutoDj: 'Fill queue',
      fillingAutoDj: 'Filling…',
      fillAutoDjFailed: (detail) => `Auto-DJ failed: ${detail}`,
      voteSkip: 'Vote to skip',
      voteSkipProgress: (votes, needed) => `Skip (${votes}/${needed})`,
      voteSkipVoted: (votes, needed) => `Voted (${votes}/${needed})`,
      voteSkipTriggered: 'Track skipped by group vote.',
      voteSkipFailed: (detail) => `Vote skip failed: ${detail}`,
      reactionsLabel: 'Send reaction',
      reactFailed: (detail) => `Reaction failed: ${detail}`,
      kioskButton: 'Party-Screen',
      kioskClose: 'Close Party-Screen',
      kioskTitle: 'Party-Screen',
      kioskCodeLabel: 'Join Code',
      kioskJoinHint: 'Enter code in LoggeRythm or scan the code pattern',
      kioskAddedBy: (name) => `Added by ${name}`,
      kioskUpNext: 'Up Next',
      kioskEmptyUpNext: 'Add tracks to keep the party moving.',
    },
    insights: {
      title: 'Listening Insights',
      subtitle: 'Listening time, streaks, peak hours, and your favorites.',
      openButton: 'Open Listening Insights',
      openHint: 'View streaks, top albums, listening clock, and recap',
      ranges: {
        '7d': '7 Days',
        '30d': '30 Days',
        '90d': '90 Days',
        year: 'Year',
        all: 'All Time',
      },
      listeningTime: 'Listening Time',
      formatDuration: (hours, minutes) =>
        hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
      plays: 'Plays',
      uniqueTracks: 'Unique Tracks',
      uniqueArtists: 'Artists',
      currentStreak: 'Current Streak',
      longestStreak: 'Longest Streak',
      streakDays: (days) => (days === 1 ? '1 day' : `${days} days`),
      newArtists: 'New Artists',
      topTracks: 'Top Tracks',
      topArtists: 'Top Artists',
      topAlbums: 'Top Albums',
      hourlyTitle: 'Listening Clock (24h)',
      weekdayTitle: 'By Day of Week',
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      recentPlays: 'Recent Plays',
      shareButton: 'Share Recap',
      shareMessage: (rangeLabel, duration, plays, topArtist) =>
        `My LoggeRythm recap (${rangeLabel}): ${duration} listened, ${plays} plays${topArtist ? `, top artist: ${topArtist}` : ''}.`,
      shareFailed: 'Could not share recap.',
      emptyTitle: 'No listening activity in this range',
      emptyBody: 'Play a few tracks to build your personal recap.',
      loadFailed: 'Could not load listening insights.',
    },
    friends: {
      title: 'Friends Listening Now',
      subtitle: 'Live listening activity from your community.',
      empty: 'Nobody is sharing their listening activity right now.',
      shareActivityLabel: 'Share listening activity',
      shareActivityHint: 'Let friends see what track you are listening to.',
      liveBadge: 'LIVE',
      playingNow: 'Listening now',
      recentTrack: 'Recently played',
      joinJam: 'Join Jam',
      streamError: 'Friends live feed disconnected.',
    },
    blend: {
      createButton: 'Create Blend',
      creating: 'Creating Blend…',
      matchBadge: (percent) => `${Math.round(percent)}% match`,
      sharedArtists: (artists) => `Shared artists: ${artists}`,
      sharedTracks: (count) => `${count} shared favorites`,
      openPlaylist: 'Open Blend playlist',
      failed: 'Could not create Taste Blend.',
    },
    collab: {
      liveBadge: 'Live Sync',
      updatedNotice: 'Playlist updated live.',
      revokedNotice: 'Your access to this playlist was revoked.',
      deletedNotice: 'This playlist was deleted.',
      streamError: 'Live playlist sync disconnected.',
    },
    homeMixes: {
      personalTitle: 'Mixed for You',
    },
    playlistTools: {
      startRadio: 'Start Playlist Radio',
      startRadioHint: 'Play similar tracks seeded from this selection',
      startingRadio: 'Starting radio…',
      radioStarted: (name) => `Started radio from “${name}”.`,
      radioFailed: 'Could not start radio.',
      findDuplicates: 'Find Duplicates',
      findDuplicatesHint: 'Inspect and remove duplicate entries',
      duplicatesTitle: 'Playlist Duplicates',
      duplicatesLoading: 'Scanning for duplicate tracks…',
      duplicatesEmpty: 'No duplicates found — this playlist is clean.',
      duplicatesFound: (count) =>
        count === 1 ? '1 duplicate entry found.' : `${count} duplicate entries found.`,
      duplicatesGroupCopies: (count) => `${count} extra copies`,
      deduplicateAction: (count) =>
        count === 1 ? 'Remove 1 duplicate' : `Remove ${count} duplicates`,
      deduplicating: 'Removing duplicates…',
      deduplicated: (count) =>
        count === 1 ? 'Removed 1 duplicate.' : `Removed ${count} duplicates.`,
      duplicatesFailed: 'Could not inspect playlist duplicates.',
      syncManifestSize: (tracks, size) => `${tracks} tracks · ~${size}`,
    },
    importTarget: {
      label: 'Save directly to',
      modeNone: 'Resolve only',
      modeNew: 'New playlist',
      modeExisting: 'Existing playlist',
      newPlaylistPlaceholder: 'New playlist name',
      openCreatedPlaylist: 'Open created playlist',
    },
    connectContinuity: {
      resumeTitle: 'Resume last session',
      resumeTrack: (title, artist) => `${title} · ${artist}`,
      resumeAction: 'Resume here',
      resuming: 'Resuming…',
      resumeFailed: (detail) => `Could not resume session: ${detail}`,
    },
  },
};

function currentWave2Locale(): AppLocale {
  const candidate = (localization as { activeLocale?: unknown }).activeLocale;
  return candidate === 'en' ? 'en' : 'de';
}

export const wave2Strings: Wave2Strings = new Proxy({} as Wave2Strings, {
  get(_target, property) {
    return Reflect.get(catalogs[currentWave2Locale()], property);
  },
});
