import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePartyStore } from "@/store/party";
import { usePlayerStore } from "@/store/player";

export type PartyExitMode = "leave" | "end";

/**
 * Leave or end a Jam atomically on the server before clearing local state.
 *
 * Marks `exitingCode` while the request is in flight so SSE echoes from our own
 * leave/end do not raise false "kicked" / duplicate "ended" toasts and safety
 * polls / React Query refetches cannot re-add the user via GET /party/{code}.
 * On failure, restores the pre-exit flag and rethrows loudly.
 */
export async function exitPartySession(
  code: string,
  mode: PartyExitMode,
  options?: { queryClient?: QueryClient },
): Promise<void> {
  const normalized = code.toUpperCase();
  usePartyStore.getState().beginExit(normalized);
  if (options?.queryClient) {
    await options.queryClient.cancelQueries({ queryKey: ["party", normalized] });
  }
  try {
    if (mode === "end") await api.endParty(normalized);
    else await api.leaveParty(normalized);
  } catch (error) {
    usePartyStore.getState().cancelExit(normalized);
    throw error;
  }
  options?.queryClient?.removeQueries({ queryKey: ["party", normalized] });
  const player = usePlayerStore.getState();
  player.setPartyBridge(null);
  if (!player.remoteBridge) {
    player.setSuppressLocalAudio(false);
  }
  usePartyStore.getState().completeExit(normalized);
}
