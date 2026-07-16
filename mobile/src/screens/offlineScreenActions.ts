/** Refresh native browse state once, and only after an offline transaction commits. */
export async function runOfflinePlaylistScreenAction(
  action: () => Promise<void>,
  refreshBrowse: () => Promise<void>,
): Promise<void> {
  await action();
  await refreshBrowse();
}
