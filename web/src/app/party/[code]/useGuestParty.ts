"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { openPartyStream, type PartyLiveState } from "@/lib/partySocket";
import { toast } from "@/store/toast";
import type { Track } from "@/types";
import { partyFailureMessage } from "../requests";

export type GuestPhase =
  | { kind: "checking" }
  | { kind: "nickname" }
  | { kind: "joined"; party: PartyLiveState }
  | { kind: "left" }
  | { kind: "error"; message: string };

/** Read the party with this browser's guest cookie; only a 401 asks for a nickname. */
async function readPhase(code: string): Promise<GuestPhase> {
  try {
    const party = (await api.getParty(code)) as PartyLiveState;
    return { kind: "joined", party };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) return { kind: "nickname" };
    return { kind: "error", message: partyFailureMessage("Party konnte nicht geladen werden", cause) };
  }
}

/**
 * Anonymous participation in a party. The guest token is an HttpOnly cookie
 * scoped to this party's API path, so a reload simply reads the party again;
 * only a 401 asks for a nickname. Live updates come from the same SSE stream
 * members use.
 */
export function useGuestParty(code: string) {
  const [phase, setPhase] = useState<GuestPhase>({ kind: "checking" });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    void readPhase(code).then((next) => {
      if (active) setPhase(next);
    });
    return () => {
      active = false;
    };
  }, [code]);

  const reload = async () => {
    setPhase({ kind: "checking" });
    setPhase(await readPhase(code));
  };

  const joined = phase.kind === "joined";
  useEffect(() => {
    if (!joined) return;
    return openPartyStream(code, (party) => setPhase({ kind: "joined", party }));
  }, [code, joined]);

  const join = async (nickname: string) => {
    setJoining(true);
    setJoinError(null);
    try {
      const party = (await api.joinPartyAsGuest(code, nickname)) as PartyLiveState;
      setPhase({ kind: "joined", party });
    } catch (cause) {
      setJoinError(partyFailureMessage("Beitritt fehlgeschlagen", cause));
    } finally {
      setJoining(false);
    }
  };

  const mutate = async (failure: string, operation: () => Promise<void>, success?: string) => {
    if (busy.current) return;
    busy.current = true;
    setQueuePending(true);
    setQueueError(null);
    try {
      await operation();
      if (success) toast.success(success);
    } catch (cause) {
      const message = partyFailureMessage(failure, cause);
      setQueueError(message);
      toast.error(message);
    } finally {
      busy.current = false;
      setQueuePending(false);
    }
  };

  const leave = async () => {
    if (busy.current) return;
    busy.current = true;
    setLeaving(true);
    try {
      await api.leaveParty(code);
      setPhase({ kind: "left" });
    } catch (cause) {
      toast.error(partyFailureMessage("Party konnte nicht verlassen werden", cause));
    } finally {
      busy.current = false;
      setLeaving(false);
    }
  };

  return {
    phase,
    reload,
    join,
    joining,
    joinError,
    queuePending,
    queueError,
    queueLocked: queuePending || leaving,
    leaving,
    leave,
    rejoin: () => setPhase({ kind: "nickname" }),
    addTrack: (track: Track) =>
      mutate(`"${track.title}" konnte nicht hinzugefügt werden`, () => api.partyAddTrack(code, track), "Zur Party hinzugefügt."),
    removeTrack: (itemId: number, title: string) =>
      mutate(`"${title}" konnte nicht entfernt werden`, () => api.partyRemoveTrack(code, itemId)),
  };
}
