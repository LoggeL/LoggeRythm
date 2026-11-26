import { createRuntimeCatalog, type AppLocale } from '../localization';

/**
 * Copy added by the redesigned radio, profile and sign-in surfaces. It lives
 * in its own runtime catalog (same contract as `strings`: resolved per access,
 * so read it inside render) to keep the shared catalog untouched.
 */
const catalogs = {
  de: {
    auth: {
      showPassword: 'Passwort anzeigen',
      hidePassword: 'Passwort verbergen',
    },
    radio: {
      onAir: 'LÄUFT GERADE',
      onAirStation: (label: string) => `Läuft gerade: ${label}`,
      onAirUnnamed: 'Ein Radio läuft gerade.',
      stationOnAir: (title: string) => `${title} läuft gerade`,
    },
    profile: {
      statsEmptyHint: 'Spiele ein paar Titel – deine Top-Titel und Künstler erscheinen dann hier.',
      statsPeriod: 'Zeitraum der Hörstatistik',
      statsNoEntries: 'Noch keine Einträge in diesem Zeitraum.',
      statRank: (rank: number) => `Platz ${rank}`,
      quickAccessTitle: 'Schnellzugriff',
      quickInsights: 'Hör-Insights',
      quickAudioEffects: 'Klang & Effekte',
      quickDevices: 'Geräte',
      quickSleepTimer: 'Sleep-Timer',
      settingsSectionTitle: 'Einstellungen',
      settingsPlaybackTitle: 'Wiedergabe',
      settingsPlaybackSummary: 'Crossfade, DJ-Übergänge, Qualität & Sleep-Timer',
      settingsDevicesStorageTitle: 'Geräte & Speicher',
      settingsDevicesStorageSummary: 'Connect, Downloads, WLAN & Stream-Cache',
      settingsAccountAppTitle: 'Konto & App',
      settingsAccountAppSummary: 'Kontodaten, Sprache & App-Version',
      settingsAccountAppUpdateAvailable: 'Update verfügbar',
      settingsAccountAppUpdateNotice: 'Update-Hinweis',
      openSettings: (title: string) => `${title} öffnen`,
    },
  },
  en: {
    auth: {
      showPassword: 'Show password',
      hidePassword: 'Hide password',
    },
    radio: {
      onAir: 'ON AIR',
      onAirStation: (label: string) => `On air: ${label}`,
      onAirUnnamed: 'A station is on air.',
      stationOnAir: (title: string) => `${title} is on air`,
    },
    profile: {
      statsEmptyHint: 'Play a few tracks and your top tracks and artists will show up here.',
      statsPeriod: 'Listening stats period',
      statsNoEntries: 'Nothing in this period yet.',
      statRank: (rank: number) => `Rank ${rank}`,
      quickAccessTitle: 'Quick access',
      quickInsights: 'Insights',
      quickAudioEffects: 'Audio & effects',
      quickDevices: 'Devices',
      quickSleepTimer: 'Sleep timer',
      settingsSectionTitle: 'Settings',
      settingsPlaybackTitle: 'Playback',
      settingsPlaybackSummary: 'Crossfade, DJ transitions, quality & sleep timer',
      settingsDevicesStorageTitle: 'Devices & Storage',
      settingsDevicesStorageSummary: 'Connect, downloads, Wi-Fi & stream cache',
      settingsAccountAppTitle: 'Account & App',
      settingsAccountAppSummary: 'Account details, language & app version',
      settingsAccountAppUpdateAvailable: 'Update available',
      settingsAccountAppUpdateNotice: 'Update notice',
      openSettings: (title: string) => `Open ${title}`,
    },
  },
} satisfies Record<AppLocale, unknown>;

export const accountStrings = createRuntimeCatalog<(typeof catalogs)['de']>(catalogs);
