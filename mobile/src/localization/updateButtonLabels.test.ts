import { describe, expect, it } from 'vitest';
import { formatAndroidUpdateBytes } from '../update/downloadProgress';
import { catalogs, type AppLocale } from './index';

/**
 * The update card's buttons are one line (`ActionButton` truncates its label).
 * On a 360dp phone the label gets 218dp: 360 − 2 × 20 page gutter − 2 × 16
 * card padding − 2 × 20 button padding − 20 icon − 8 gap − 2 border. At the
 * 14sp label style that is about 26 characters; a longer label is cut off
 * with an ellipsis. Questions and explanations belong into the caption text
 * next to the button, not into its label.
 */
const LABEL_BUDGET = 26;

/** The longest size an APK below 1 GiB is shown with ("1.024 MB" / "1,024 MB"). */
const WIDEST_APK_BYTES = 1024 * 1024 * 1024 - 1;

describe('update card button labels', () => {
  it.each(['de', 'en'] as AppLocale[])('fit one line on a 360dp phone in %s', (locale) => {
    const update = catalogs[locale].profile.update;
    const size = formatAndroidUpdateBytes(WIDEST_APK_BYTES, locale);
    expect(size).toHaveLength(8);
    const labels = {
      install: update.install(size),
      permissionContinue: update.permissionContinue,
      restartInstall: update.restartInstall,
      recheck: update.recheck,
      retryInstall: update.retryInstall,
      releaseLink: update.releaseLink,
      viewRelease: update.viewRelease,
    };
    const tooLong = Object.entries(labels)
      .filter(([, label]) => label.length > LABEL_BUDGET)
      .map(([key, label]) => `${key}: "${label}" (${label.length})`);
    expect(tooLong).toEqual([]);
  });

  it.each(['de', 'en'] as AppLocale[])('asks about a missing Android dialog in the caption, not the button, in %s', (locale) => {
    const update = catalogs[locale].profile.update;
    expect(update.restartInstall).not.toContain('?');
    expect(update.confirmHint).toContain('?');
  });
});
