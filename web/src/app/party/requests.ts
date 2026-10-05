/** Only the newest search may update the party search UI. */
export function createPartySearchRequests() {
  let current: AbortController | null = null;

  return {
    start() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => current === controller && !controller.signal.aborted,
      };
    },
    cancel() {
      current?.abort();
      current = null;
    },
  };
}

export function partyFailureMessage(action: string, error: unknown): string {
  return `${action}: ${error instanceof Error ? error.message : String(error)}`;
}

/** Stay in the party until the server has confirmed leaving it. */
export async function leavePartyAndNavigate(
  leave: () => Promise<void>,
  navigate: () => void,
): Promise<void> {
  await leave();
  navigate();
}
