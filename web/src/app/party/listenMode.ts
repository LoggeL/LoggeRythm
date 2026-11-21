/**
 * Where a party member hears the music: `device` plays it in this browser in
 * step with the host; `host` listens together at the host's speaker, so this
 * browser stays silent and only adds songs. The host always plays.
 */
export type PartyListenMode = "device" | "host";

/** What the local player does with a fresh party frame. */
export type PartyPlayerAction = "mirror" | "release" | "none";

/**
 * Mirror the party queue while listening here; while listening at the host,
 * drop the party from this browser's player once (`release`) and then leave it
 * alone (`none`).
 */
export function partyPlayerAction(
  isHost: boolean,
  mode: PartyListenMode,
  playerHoldsParty: boolean,
): PartyPlayerAction {
  if (isHost && mode !== "device") {
    throw new Error("The host plays the party in this browser and cannot listen elsewhere.");
  }
  if (mode === "device") return "mirror";
  return playerHoldsParty ? "release" : "none";
}
