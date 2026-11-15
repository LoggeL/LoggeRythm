import { refreshLibraryAutoBrowse } from '../../data';
import { strings } from '../../localization';
import { refreshBrowseTree, refreshOfflineBrowseTree } from '../../player/browseTree';
import { reportPlayerNotice } from '../../player/notices';

/** A failed car-library refresh is reported as a player notice, never swallowed. */
export function reportAutoBrowseRefreshFailure(): void {
  reportPlayerNotice(
    'bookkeeping',
    'auto-library-refresh',
    strings.player.autoLibraryFailed,
    strings.player.autoLibraryRefreshFailedMessage,
  );
}

/** Republishes the Android Auto library after a remote library change. */
export function refreshAutoBrowse(): Promise<void> {
  return refreshLibraryAutoBrowse(refreshBrowseTree, reportAutoBrowseRefreshFailure);
}

/** Republishes only the verified local Android Auto state after an offline commit. */
export function refreshOfflineAutoBrowse(): Promise<void> {
  return refreshLibraryAutoBrowse(refreshOfflineBrowseTree, reportAutoBrowseRefreshFailure);
}
