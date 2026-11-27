import * as localization from './index';
import type { AppLocale } from './index';
import type {
  AudioQualityTier,
  StatsInsightsRange,
  WrappedCardTemplateId,
  WrappedThemeId,
} from '../api/types';
import type { EqualizerPresetName, LoudnessPresetName } from '../../modules/loggerythm-player/src';

export interface Wave2Strings {
  audioEffects: {
    openButton: string;
    closeButton: string;
    title: string;
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
    metaFailed: string;
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
    savePlaylistClose: string;
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
    openButton: string;
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
  wrapped: {
    launchEyebrow: string;
    launchTitle: string;
    launchSubtitle: (rangeLabel: string, plays: number, duration: string) => string;
    launchButton: string;
    launchPending: string;
    launchError: string;
    studioTitle: string;
    closeButton: string;
    modes: {
      story: string;
      studio: string;
    };
    storyControls: {
      previous: string;
      next: string;
      pause: string;
      play: string;
      openCard: string;
      chapterCounter: (current: number, total: number) => string;
    };
    chapters: {
      intro: {
        eyebrow: string;
        title: string;
        subtitle: string;
        hoursLabel: string;
        playsLabel: string;
        avgDailyLabel: string;
      };
      obsession: {
        eyebrow: string;
        title: string;
        replayBadge: (count: number) => string;
        shareLabel: string;
        peakDayLabel: (date: string, plays: number) => string;
        emptyNote: string;
      };
      festival: {
        eyebrow: string;
        title: string;
        headlinerLabel: string;
        coHeadlinersLabel: string;
        undercardLabel: string;
        emptyNote: string;
      };
      aura: {
        eyebrow: string;
        title: string;
        peakHourLabel: (hour: number) => string;
        weekendLabel: string;
        discoveryLabel: string;
        bpmLabel: (bpm: number, vibe: string) => string;
      };
      peak: {
        eyebrow: string;
        title: string;
        currentStreakLabel: string;
        longestStreakLabel: string;
        activeDaysLabel: (active: number, total: number) => string;
        peakDayLabel: string;
      };
      persona: {
        eyebrow: string;
        title: string;
        emptyNote: string;
      };
      finale: {
        eyebrow: string;
        title: string;
        body: string;
        cta: string;
      };
    };
    templates: Record<WrappedCardTemplateId, { label: string; badge: string }>;
    themes: Record<WrappedThemeId, string>;
    toggles: {
      showUser: string;
      showCounts: string;
    };
    actions: {
      share: string;
      sharing: string;
      openSvg: string;
      openingSvg: string;
    };
    errors: {
      shareFailed: string;
      openSvgFailed: string;
      emptyReport: string;
    };
    card: {
      brandMark: string;
      listeningHours: string;
      plays: string;
      topArtists: string;
      topTracks: string;
      dnaWave: string;
      receiptHeader: string;
      receiptOrder: (rangeLabel: string, listener: string) => string;
      receiptSubtotal: string;
      receiptTotal: string;
      receiptQty: string;
      receiptItem: string;
      receiptTime: string;
      festivalTitle: string;
      headliner: string;
      coHeadliners: string;
      undercard: string;
      obsessionLoops: (count: number) => string;
      obsessionShare: (pct: number) => string;
      obsessionPeak: (date: string, plays: number) => string;
      auraClockTitle: string;
      auraPeakHour: (hour: number) => string;
      auraDiscovery: (pct: number) => string;
      auraRepeat: (pct: number) => string;
      peakTitle: string;
      longestStreak: string;
      currentStreak: string;
      activeDays: (active: number, total: number) => string;
      peakDayPlays: (plays: number, duration: string) => string;
      userBadge: (name: string) => string;
      anonymousListener: string;
      shareMessage: (
        templateLabel: string,
        rangeLabel: string,
        duration: string,
        plays: number,
        topArtist: string,
        topTrack: string,
        cardUrl: string,
      ) => string;
    };
  };
  friends: {
    title: string;
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
    startingRadio: string;
    radioStarted: (name: string) => string;
    radioFailed: string;
    findDuplicates: string;
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
        lossless: { label: 'Lossless (FLAC)', hint: 'Höchster Datenverbrauch' },
        high: { label: 'Hoch (320 kbit/s)', hint: 'MP3' },
        saver: { label: 'Datensparmodus (128 kbit/s)', hint: 'Geringster Datenverbrauch' },
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
      metaFailed: 'Wellenform konnte nicht geladen werden',
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
      savePlaylistClose: 'Speichern abbrechen',
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
      openButton: 'Alle Hör-Insights öffnen',
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
    wrapped: {
      launchEyebrow: 'DEIN LOGGERYTHM WRAPPED',
      launchTitle: 'Dein Wrapped · Share-Cards',
      launchSubtitle: (rangeLabel, plays, duration) =>
        `${rangeLabel}: ${plays} Wiedergaben · ${duration} · 7 Share-Cards & Story-Modus`,
      launchButton: 'Story & Share-Cards öffnen',
      launchPending: 'Wrapped-Report wird geladen …',
      launchError: 'Wrapped-Report konnte nicht geladen werden.',
      studioTitle: 'Wrapped Studio',
      closeButton: 'Wrapped schließen',
      modes: {
        story: 'Story',
        studio: 'Share-Cards',
      },
      storyControls: {
        previous: 'Zurück',
        next: 'Weiter',
        pause: 'Pause',
        play: 'Abspielen',
        openCard: 'Card öffnen',
        chapterCounter: (current, total) => `${current} / ${total}`,
      },
      chapters: {
        intro: {
          eyebrow: 'KAPITEL 01 · DEIN SOUND',
          title: 'So klang deine Zeit',
          subtitle: 'Jede Session hinterlässt Spuren in deinem persönlichen Klangprofil.',
          hoursLabel: 'Hörzeit',
          playsLabel: 'Wiedergaben',
          avgDailyLabel: 'Pro Tag',
        },
        obsession: {
          eyebrow: 'KAPITEL 02 · DEIN #1 OHRWURM',
          title: 'Dieser Track ließ dich nicht los',
          replayBadge: (count) => `${count}× gespielt`,
          shareLabel: 'Anteil an deiner Hörzeit',
          peakDayLabel: (date, plays) => `Rekordtag ${date}: ${plays}× in Schleife`,
          emptyNote: 'Noch kein dominanter Ohrwurm in diesem Zeitraum.',
        },
        festival: {
          eyebrow: 'KAPITEL 03 · DEIN LINE-UP',
          title: 'Dein persönliches Festival',
          headlinerLabel: 'Headliner',
          coHeadlinersLabel: 'Co-Headliner',
          undercardLabel: 'Weitere Acts',
          emptyNote: 'Spiele mehr Artists, um dein Line-up zu füllen.',
        },
        aura: {
          eyebrow: 'KAPITEL 04 · KLANG-AURA & RADAR',
          title: 'Wann dein Sound pulsiert',
          peakHourLabel: (hour) => `Peak um ${String(hour).padStart(2, '0')}:00 Uhr`,
          weekendLabel: 'Wochenend-Anteil',
          discoveryLabel: 'Entdecker-Score',
          bpmLabel: (bpm, vibe) => `${bpm} BPM · ${vibe}`,
        },
        peak: {
          eyebrow: 'KAPITEL 05 · REKORD-TAG & SERIE',
          title: 'Dein stärkster Lauf',
          currentStreakLabel: 'Aktuelle Serie',
          longestStreakLabel: 'Längste Serie',
          activeDaysLabel: (active, total) => `${active} von ${total} Tagen aktiv`,
          peakDayLabel: 'Dein intensiver Hörmoment',
        },
        persona: {
          eyebrow: 'KAPITEL 06 · KLANG-PERSÖNLICHKEIT',
          title: 'Dein Hör-Typ',
          emptyNote: 'Für eine Klang-Persönlichkeit braucht es noch ein paar Wiedergaben.',
        },
        finale: {
          eyebrow: 'KAPITEL 07 · DEINE CARDS',
          title: 'Bereit zum Teilen',
          body: 'Wähle aus 7 kuratierten Designs und 5 Farbpaletten deinen Favoriten.',
          cta: 'Card-Studio öffnen',
        },
      },
      templates: {
        summary: { label: 'Übersicht', badge: '01' },
        persona: { label: 'Persona', badge: '02' },
        receipt: { label: 'Sound-Beleg', badge: '03' },
        festival: { label: 'Festival', badge: '04' },
        obsession: { label: 'Vinyl #1', badge: '05' },
        aura: { label: 'Aura 24h', badge: '06' },
        peak: { label: 'Rekord-Tag', badge: '07' },
      },
      themes: {
        signal: 'Signal Ink',
        cover: 'Cover-Aura',
        vinyl: 'Analog Sunset',
        neon: 'Mitternacht',
        paper: 'Studio Paper',
      },
      toggles: {
        showUser: 'Name anzeigen',
        showCounts: 'Zahlen anzeigen',
      },
      actions: {
        share: 'Card teilen',
        sharing: 'Wird geteilt …',
        openSvg: 'SVG-Card öffnen',
        openingSvg: 'Wird geöffnet …',
      },
      errors: {
        shareFailed: 'Wrapped-Card konnte nicht geteilt werden.',
        openSvgFailed: 'SVG-Card konnte nicht geöffnet werden.',
        emptyReport: 'Für diesen Zeitraum liegen noch keine Wiedergaben vor.',
      },
      card: {
        brandMark: 'LOGGERYTHM WRAPPED',
        listeningHours: 'HÖRZEIT',
        plays: 'WIEDERGABEN',
        topArtists: 'TOP-KÜNSTLER:INNEN',
        topTracks: 'TOP-TITEL',
        dnaWave: 'KLANG-DNA',
        receiptHeader: 'SOUND-BELEG',
        receiptOrder: (rangeLabel, listener) => `${rangeLabel.toUpperCase()} · ${listener}`,
        receiptSubtotal: 'ZWISCHENSUMME',
        receiptTotal: 'GESAMT',
        receiptQty: 'ANZ',
        receiptItem: 'TITEL',
        receiptTime: 'ZEIT',
        festivalTitle: 'LOGGERYTHM FEST',
        headliner: 'HEADLINER',
        coHeadliners: 'CO-HEADLINER',
        undercard: 'LINE-UP',
        obsessionLoops: (count) => `${count}× IN SCHLEIFE`,
        obsessionShare: (pct) => `${pct}% DEINER HÖRZEIT`,
        obsessionPeak: (date, plays) => `Rekordtag ${date} · ${plays}×`,
        auraClockTitle: '24H-HÖRUHR',
        auraPeakHour: (hour) => `Peak ${String(hour).padStart(2, '0')}:00`,
        auraDiscovery: (pct) => `${pct}% Entdecker`,
        auraRepeat: (pct) => `${pct}% Repeat`,
        peakTitle: 'REKORD-TAG & SERIE',
        longestStreak: 'LÄNGSTE SERIE',
        currentStreak: 'AKTUELL',
        activeDays: (active, total) => `${active}/${total} Tage aktiv`,
        peakDayPlays: (plays, duration) => `${plays} Plays · ${duration}`,
        userBadge: (name) => `FÜR ${name.toUpperCase()}`,
        anonymousListener: 'DEIN SOUND',
        shareMessage: (templateLabel, rangeLabel, duration, plays, topArtist, topTrack, cardUrl) =>
          `Mein LoggeRythm Wrapped · ${templateLabel} (${rangeLabel}): ${duration}, ${plays} Wiedergaben${topArtist ? `, #1 Artist: ${topArtist}` : ''}${topTrack ? `, #1 Track: ${topTrack}` : ''}.\n${cardUrl}`,
      },
    },
    friends: {
      title: 'Freunde hören gerade',
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
      startingRadio: 'Radio wird gestartet …',
      radioStarted: (name) => `Radio basierend auf „${name}“ gestartet.`,
      radioFailed: 'Radio konnte nicht gestartet werden.',
      findDuplicates: 'Duplikate suchen',
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
        lossless: { label: 'Lossless (FLAC)', hint: 'Highest data usage' },
        high: { label: 'High (320 kbps)', hint: 'MP3' },
        saver: { label: 'Data Saver (128 kbps)', hint: 'Lowest data usage' },
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
      metaFailed: 'The waveform could not be loaded',
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
      savePlaylistClose: 'Cancel saving',
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
      openButton: 'Open Listening Insights',
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
    wrapped: {
      launchEyebrow: 'YOUR LOGGERYTHM WRAPPED',
      launchTitle: 'Your Wrapped · Share Cards',
      launchSubtitle: (rangeLabel, plays, duration) =>
        `${rangeLabel}: ${plays} plays · ${duration} · 7 Share Cards & Story Mode`,
      launchButton: 'Open Story & Share Cards',
      launchPending: 'Loading Wrapped report…',
      launchError: 'Could not load Wrapped report.',
      studioTitle: 'Wrapped Studio',
      closeButton: 'Close Wrapped',
      modes: {
        story: 'Story',
        studio: 'Share Cards',
      },
      storyControls: {
        previous: 'Back',
        next: 'Next',
        pause: 'Pause',
        play: 'Resume',
        openCard: 'Open Card',
        chapterCounter: (current, total) => `${current} / ${total}`,
      },
      chapters: {
        intro: {
          eyebrow: 'CHAPTER 01 · YOUR SOUND',
          title: 'How your time sounded',
          subtitle: 'Every listening session shapes your personal audio signature.',
          hoursLabel: 'Listening Time',
          playsLabel: 'Plays',
          avgDailyLabel: 'Daily Avg',
        },
        obsession: {
          eyebrow: 'CHAPTER 02 · #1 OBSESSION',
          title: 'The track you kept on repeat',
          replayBadge: (count) => `${count}× played`,
          shareLabel: 'Share of your listening',
          peakDayLabel: (date, plays) => `Peak day ${date}: ${plays}× plays`,
          emptyNote: 'No dominant obsession track in this range yet.',
        },
        festival: {
          eyebrow: 'CHAPTER 03 · YOUR LINEUP',
          title: 'Your personal festival',
          headlinerLabel: 'Headliner',
          coHeadlinersLabel: 'Co-Headliners',
          undercardLabel: 'Supporting Acts',
          emptyNote: 'Play more artists to build your festival lineup.',
        },
        aura: {
          eyebrow: 'CHAPTER 04 · SOUND AURA & RADAR',
          title: 'When your rhythm peaks',
          peakHourLabel: (hour) => `Peak at ${String(hour).padStart(2, '0')}:00`,
          weekendLabel: 'Weekend share',
          discoveryLabel: 'Discovery score',
          bpmLabel: (bpm, vibe) => `${bpm} BPM · ${vibe}`,
        },
        peak: {
          eyebrow: 'CHAPTER 05 · PEAK DAY & STREAK',
          title: 'Your strongest run',
          currentStreakLabel: 'Current Streak',
          longestStreakLabel: 'Longest Streak',
          activeDaysLabel: (active, total) => `${active} of ${total} active days`,
          peakDayLabel: 'Your heaviest listening day',
        },
        persona: {
          eyebrow: 'CHAPTER 06 · SOUND PERSONA',
          title: 'Your listener archetype',
          emptyNote: 'Keep listening to unlock your personal sound archetype.',
        },
        finale: {
          eyebrow: 'CHAPTER 07 · YOUR CARDS',
          title: 'Ready to share',
          body: 'Pick from 7 curated card templates and 5 custom palettes.',
          cta: 'Open Card Studio',
        },
      },
      templates: {
        summary: { label: 'Summary', badge: '01' },
        persona: { label: 'Persona', badge: '02' },
        receipt: { label: 'Receipt', badge: '03' },
        festival: { label: 'Festival', badge: '04' },
        obsession: { label: 'Vinyl #1', badge: '05' },
        aura: { label: 'Aura 24h', badge: '06' },
        peak: { label: 'Peak Day', badge: '07' },
      },
      themes: {
        signal: 'Signal Ink',
        cover: 'Cover Aura',
        vinyl: 'Analog Sunset',
        neon: 'Midnight Club',
        paper: 'Studio Paper',
      },
      toggles: {
        showUser: 'Show name',
        showCounts: 'Show counts',
      },
      actions: {
        share: 'Share Card',
        sharing: 'Sharing…',
        openSvg: 'Open SVG Card',
        openingSvg: 'Opening…',
      },
      errors: {
        shareFailed: 'Could not share Wrapped card.',
        openSvgFailed: 'Could not open SVG card.',
        emptyReport: 'No listening plays recorded in this range yet.',
      },
      card: {
        brandMark: 'LOGGERYTHM WRAPPED',
        listeningHours: 'LISTENING',
        plays: 'PLAYS',
        topArtists: 'TOP ARTISTS',
        topTracks: 'TOP TRACKS',
        dnaWave: 'SOUND DNA',
        receiptHeader: 'SOUND RECEIPT',
        receiptOrder: (rangeLabel, listener) => `${rangeLabel.toUpperCase()} · ${listener}`,
        receiptSubtotal: 'SUBTOTAL',
        receiptTotal: 'TOTAL',
        receiptQty: 'QTY',
        receiptItem: 'TRACK',
        receiptTime: 'TIME',
        festivalTitle: 'LOGGERYTHM FEST',
        headliner: 'HEADLINER',
        coHeadliners: 'CO-HEADLINERS',
        undercard: 'LINEUP',
        obsessionLoops: (count) => `${count}× ON REPEAT`,
        obsessionShare: (pct) => `${pct}% OF LISTENING`,
        obsessionPeak: (date, plays) => `Peak ${date} · ${plays}×`,
        auraClockTitle: '24H RADAR',
        auraPeakHour: (hour) => `Peak ${String(hour).padStart(2, '0')}:00`,
        auraDiscovery: (pct) => `${pct}% Discovery`,
        auraRepeat: (pct) => `${pct}% Repeat`,
        peakTitle: 'PEAK DAY & STREAK',
        longestStreak: 'LONGEST STREAK',
        currentStreak: 'CURRENT',
        activeDays: (active, total) => `${active}/${total} active days`,
        peakDayPlays: (plays, duration) => `${plays} plays · ${duration}`,
        userBadge: (name) => `FOR ${name.toUpperCase()}`,
        anonymousListener: 'YOUR SOUND',
        shareMessage: (templateLabel, rangeLabel, duration, plays, topArtist, topTrack, cardUrl) =>
          `My LoggeRythm Wrapped · ${templateLabel} (${rangeLabel}): ${duration}, ${plays} plays${topArtist ? `, #1 Artist: ${topArtist}` : ''}${topTrack ? `, #1 Track: ${topTrack}` : ''}.\n${cardUrl}`,
      },
    },
    friends: {
      title: 'Friends Listening Now',
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
      startingRadio: 'Starting radio…',
      radioStarted: (name) => `Started radio from “${name}”.`,
      radioFailed: 'Could not start radio.',
      findDuplicates: 'Find Duplicates',
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
