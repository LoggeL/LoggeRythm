type PlaybackElement = Pick<HTMLMediaElement, "error" | "load" | "play">;

/** A failed physical source needs a fresh request before an explicit play. */
export async function playWithMediaRecovery(
  element: PlaybackElement,
  beforeReload: () => void,
): Promise<void> {
  if (element.error) {
    beforeReload();
    element.load();
  }
  await element.play();
}
