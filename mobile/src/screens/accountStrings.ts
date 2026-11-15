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
    },
  },
} satisfies Record<AppLocale, unknown>;

export const accountStrings = createRuntimeCatalog<(typeof catalogs)['de']>(catalogs);
