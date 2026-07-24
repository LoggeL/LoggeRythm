import { useEffect } from 'react';
import { Platform, ToastAndroid } from 'react-native';
import { strings } from '../localization';
import {
  checkForAndroidUpdate,
  type AndroidUpdateCheck,
} from './githubReleaseUpdater';

function errorDetail(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function presentAndroidUpdateToast(result: AndroidUpdateCheck): void {
  if (result.kind !== 'available') return;
  ToastAndroid.show(
    strings.profile.update.toastAvailable(result.release.versionName),
    ToastAndroid.LONG,
  );
}

export function presentAndroidUpdateCheckFailure(value: unknown): void {
  ToastAndroid.show(
    `${strings.profile.update.startupCheckFailed}: ${errorDetail(value)}`,
    ToastAndroid.LONG,
  );
}

/**
 * Checks once per app process after localization is ready. The profile update
 * card remains the durable place where the user can inspect and install it.
 */
export default function AndroidUpdateToastHost() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    let mounted = true;
    void checkForAndroidUpdate().then(
      (result) => {
        if (mounted) presentAndroidUpdateToast(result);
      },
      (error) => {
        if (mounted) presentAndroidUpdateCheckFailure(error);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  return null;
}
