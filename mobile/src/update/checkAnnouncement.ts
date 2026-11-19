import { strings } from '../localization';
import {
  availableAndroidUpdate,
  type AndroidUpdateSnapshot,
  type AndroidUpdateStore,
} from './androidUpdateStore';
import { androidInstallFailureIsFinal } from './updateErrors';
import { androidInstalledNewerCase } from './updatePresentation';

/**
 * What TalkBack hears when a check ends in `snapshot`: the same outcome the
 * profile card shows (an offered release, possibly one that failed for good,
 * or the check's result). Only for a finished check; a failed check is
 * announced by its ErrorState, or, folded next to a failed install, by the
 * card's polite live-region line.
 */
export function androidUpdateCheckAnnouncement(snapshot: AndroidUpdateSnapshot): string {
  const check = snapshot.check;
  if (check.kind !== 'done') {
    throw new Error(`Only a finished Android update check is announced, not one in state ${check.kind}`);
  }
  const texts = strings.profile.update.checkAnnouncement;
  const release = availableAndroidUpdate(snapshot);
  if (release !== null) {
    const install = snapshot.install;
    return install.kind === 'failed' && androidInstallFailureIsFinal(install.failure)
      ? texts.uninstallable(release.versionName)
      : texts.available(release.versionName);
  }
  switch (check.result.kind) {
    case 'up-to-date':
      return texts.upToDate;
    case 'installed-newer':
      // The card's decision: an equal build is not newer, only not installable.
      return androidInstalledNewerCase(check.result).kind === 'same-build'
        ? texts.installedSameBuild(check.result.latestVersion)
        : texts.installedNewer;
    case 'available':
      throw new Error(
        `Android update check found release ${check.result.release.versionName}, but no release is offered`,
      );
  }
}

/**
 * Announces, once each, every check that goes from `checking` to `done` while
 * subscribed. The state at subscription time is only the baseline: an older
 * finished result is never announced. Returns the unsubscribe function.
 */
export function announceAndroidUpdateCheckOutcomes(
  store: Pick<AndroidUpdateStore, 'getSnapshot' | 'subscribe'>,
  announce: (text: string) => void,
): () => void {
  let previousKind = store.getSnapshot().check.kind;
  return store.subscribe(() => {
    const snapshot = store.getSnapshot();
    const kind = snapshot.check.kind;
    const finished = previousKind === 'checking' && kind === 'done';
    previousKind = kind;
    if (finished) announce(androidUpdateCheckAnnouncement(snapshot));
  });
}
