import { useEffect } from 'react';
import { Platform, ToastAndroid } from 'react-native';
import { strings } from '../localization';
import {
  androidUpdateStore,
  type AndroidUpdateStartupFailure,
  type AndroidUpdateStartupReport,
} from './androidUpdateStore';
import { androidUpdateFailure } from './updateErrors';
import { androidUpdateStartupFailureToast } from './updatePresentation';

/**
 * Phase and a pointer to the profile only (see `androidUpdateStartupFailureToast`):
 * the profile card shows the cause and the raw detail of every startup failure.
 */
function presentStartupFailure({ phase }: AndroidUpdateStartupFailure): void {
  ToastAndroid.show(androidUpdateStartupFailureToast(phase), ToastAndroid.LONG);
}

function presentStartupReport(report: AndroidUpdateStartupReport): void {
  if (report.updatedTo !== null) {
    ToastAndroid.show(strings.profile.update.updatedToast(report.updatedTo), ToastAndroid.LONG);
  }
  report.failures.forEach(presentStartupFailure);
}

/**
 * Starts the shared update store once localization is ready: startup check,
 * pending-install outcome and foreground re-checks. It only toasts what would
 * otherwise go unnoticed: a completed self-update and every startup failure.
 * An available update is shown by the header dot and the profile card.
 */
export default function AndroidUpdateToastHost() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    let mounted = true;
    void androidUpdateStore.start().then(
      (report) => {
        if (mounted) presentStartupReport(report);
      },
      (error: unknown) => {
        // A rejected start never got past its own setup: shown as a check
        // failure (the store keeps it as a startup note for the card).
        if (mounted) presentStartupFailure({ phase: 'check', failure: androidUpdateFailure(error) });
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  return null;
}
