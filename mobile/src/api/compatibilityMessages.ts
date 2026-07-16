import { createRuntimeCatalog, type AppLocale } from '../localization';

interface CompatibilityMessages {
  unsupportedServer: (appContract: string, serverContracts: readonly string[]) => string;
  checkTimedOut: string;
  networkFailed: string;
  serverUnavailable: (status: number) => string;
}

const catalogs = {
  de: {
    unsupportedServer: (appContract: string, serverContracts: readonly string[]) => {
      const advertised = serverContracts.length > 0 ? serverContracts.join(', ') : 'unbekannt';
      return (
        'Dieser Server wird von dieser Android-Version nicht unterstützt. ' +
        `Aktualisiere Server oder App. App-Vertrag: ${appContract}; Server: ${advertised}.`
      );
    },
    checkTimedOut:
      'Die Server-Kompatibilität konnte wegen einer Zeitüberschreitung nicht geprüft werden. Versuche es erneut.',
    networkFailed:
      'Die Server-Kompatibilität konnte wegen eines Netzwerkfehlers nicht geprüft werden. Prüfe die Verbindung und versuche es erneut.',
    serverUnavailable: (status: number) =>
      `Die Server-Kompatibilität konnte nicht geprüft werden (HTTP ${status}). Versuche es erneut.`,
  },
  en: {
    unsupportedServer: (appContract: string, serverContracts: readonly string[]) => {
      const advertised = serverContracts.length > 0 ? serverContracts.join(', ') : 'unknown';
      return (
        'This server is not supported by this Android version. ' +
        `Update the server or app. App contract: ${appContract}; server: ${advertised}.`
      );
    },
    checkTimedOut: 'The server compatibility check timed out. Try again.',
    networkFailed:
      'Server compatibility could not be checked because of a network error. Check the connection and try again.',
    serverUnavailable: (status: number) =>
      `Server compatibility could not be checked (HTTP ${status}). Try again.`,
  },
} satisfies Record<AppLocale, CompatibilityMessages>;

export const compatibilityMessages: CompatibilityMessages = createRuntimeCatalog(catalogs);
