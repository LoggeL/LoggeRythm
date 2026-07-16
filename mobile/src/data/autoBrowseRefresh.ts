/**
 * Re-publish the account's native car library after a server-confirmed Library
 * mutation. Native publication is bookkeeping: a failure may be surfaced, but
 * it must never turn a completed server mutation into a failed mutation.
 */
export async function refreshLibraryAutoBrowse(
  refresh: () => Promise<void>,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await refresh();
  } catch (error) {
    try {
      onError?.(error);
    } catch {
      // Presentation callbacks must not change the completed mutation result.
    }
  }
}
