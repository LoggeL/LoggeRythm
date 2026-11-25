import { describe, expect, it } from 'vitest';
import { strings } from '../localization';
import { WifiOnlyDownloadError } from '../offline/downloadSettings';
import { trackActionFailureMessage, type TrackActionFailureKind } from './trackActionFeedback';

describe('track action failure copy', () => {
  it('maps every external failure to localized non-diagnostic copy', () => {
    const privateDetail = 'HTTP 500 from db.internal.example: secret native bridge state';
    const expected: Record<TrackActionFailureKind, string> = {
      'play-next': strings.trackActions.playNextFailed,
      'add-to-queue': strings.trackActions.addToQueueFailed,
      'start-radio': strings.trackActions.startRadioFailed,
      'add-to-playlist': strings.trackActions.addToPlaylistFailed,
      'create-playlist': strings.trackActions.createPlaylistFailed,
      download: strings.trackActions.downloadFailed,
      'remove-download': strings.trackActions.removeDownloadFailed,
      share: strings.trackActions.shareFailed,
      remove: strings.trackActions.removeFailed,
      generic: strings.trackActions.actionFailed,
    };

    for (const [kind, message] of Object.entries(expected) as [TrackActionFailureKind, string][]) {
      const rendered = trackActionFailureMessage(kind, new Error(privateDetail));
      expect(rendered).toBe(message);
      expect(rendered).not.toContain(privateDetail);
    }
  });

  it('surfaces the explicit Wi-Fi-only message for WifiOnlyDownloadError on downloads', () => {
    expect(trackActionFailureMessage('download', new WifiOnlyDownloadError())).toBe(
      strings.profile.wifiRequiredError,
    );
  });
});
