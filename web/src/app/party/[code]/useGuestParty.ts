"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  | { kind: "ended"; reason: string }
  | { kind: "error"; message: string };

/** Move the id at `from` to position `to`, returning the new ordering. */
function moved(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Read the party with this browser's guest cookie; only a 401 asks for a nickname. */
async function readPhase(code: string): Promise<GuestPhase> {
  try {
    const party = await api.getParty(code);
    if (party.ended) {
      return { kind: "ended", reason: "Diese Jam wurde vom Host beendet." };
    }
    return { kind: "joined", party };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) return { kind: "nickname" };
    return { kind: "error", message: partyFailureMessage("Jam konnte nicht geladen werden", cause) };
  }
}

/**
 * Anonymous participation in a Jam. The guest token is an HttpOnly cookie
 * scoped to this party's API path, so a reload simply reads the party again;
 * only a 401 asks for a nickname. Live updates come from the same SSE stream
 * members use, and stored-track icons come from `/api/party/{code}/cached-tracks`
 * plus live `PartyTrack.is_stored` flags.
 */
export function useGuestParty(code: string) {
  const [phase, setPhase] = useState<GuestPhase>({ kind: "checking" });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [cachedIds, setCachedIds] = useState<Set<string>>(() => new Set());
  const [cacheError, setCacheError] = useState<string | null>(null);
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

  const loadPartyCachedTracks = useCallback(async () => {
    try {
      const res = await api.partyCachedTracks(code);
      if (!Array.isArray(res.ids)) {
        throw new Error("API /party/cached-tracks: Eine Liste gültiger Titel-IDs wurde erwartet.");
      }
      setCacheError(null);
      setCachedIds((prev) => {
        const next = new Set(prev);
        for (const id of res.ids) next.add(String(id));
        return next;
      });
    } catch (cause) {
      const message = partyFailureMessage("Server-Cache konnte nicht geladen werden", cause);
      setCacheError(message);
      toast.error(message);
    }
  }, [code]);

  const reload = async () => {
    setPhase({ kind: "checking" });
    setPhase(await readPhase(code));
  };

  const joined = phase.kind === "joined";
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    void api
      .partyCachedTracks(code)
      .then((res) => {
        if (cancelled) return;
        if (!Array.isArray(res.ids)) {
          throw new Error("API /party/cached-tracks: Eine Liste gültiger Titel-IDs wurde erwartet.");
        }
        setCacheError(null);
        setCachedIds((prev) => {
          const next = new Set(prev);
          for (const id of res.ids) next.add(String(id));
          return next;
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = partyFailureMessage("Server-Cache konnte nicht geladen werden", cause);
        setCacheError(message);
        toast.error(message);
      });
    const dispose = openPartyStream(code, (party) => {
      if (party.ended) {
        toast.info("Die Jam wurde vom Host beendet.");
        setPhase({ kind: "ended", reason: "Die Jam wurde vom Host beendet." });
        return;
      }
      const hasKeys = party.members.length > 0 && party.members.every((m) => Boolean(m.key));
      if (hasKeys && party.viewer_key && !party.members.some((m) => m.key === party.viewer_key)) {
        const reason = "Du wurdest vom Host aus der Jam entfernt.";
        toast.error(reason);
        setPhase({ kind: "ended", reason });
        return;
      }
      const newlyStored = party.tracks
        .filter((track) => track.is_stored || track.load_state === "ready")
        .map((track) => String(track.deezer_id));
      if (newlyStored.length > 0) {
        setCachedIds((prev) => {
          if (newlyStored.every((id) => prev.has(id))) return prev;
          const next = new Set(prev);
          for (const id of newlyStored) next.add(id);
          return next;
        });
      }
      setPhase({ kind: "joined", party });
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [code, joined]);

  const join = async (nickname: string) => {
    setJoining(true);
    setJoinError(null);
    try {
      const party = await api.joinPartyAsGuest(code, nickname);
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
      toast.error(partyFailureMessage("Jam konnte nicht verlassen werden", cause));
    } finally {
      busy.current = false;
      setLeaving(false);
    }
  };

  const party = phase.kind === "joined" ? phase.party : null;
  const trackIds = party ? party.tracks.map((track) => track.id) : [];

  return {
    phase,
    cachedIds,
    cacheError,
    retryCache: loadPartyCachedTracks,
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
      mutate(`"${track.title}" konnte nicht hinzugefügt werden`, () => api.partyAddTrack(code, track, "end"), "Zur Jam hinzugefügt."),
    addTrackNext: (track: Track) =>
      mutate(`"${track.title}" konnte nicht als Nächstes eingereiht werden`, () => api.partyAddTrack(code, track, "next"), "Wird als Nächstes in der Jam gespielt."),
    removeTrack: (itemId: number, title: string) =>
      mutate(`"${title}" konnte nicht entfernt werden`, () => api.partyRemoveTrack(code, itemId)),
    playAt: (index: number, title: string) =>
      mutate(`"${title}" konnte nicht abgespielt werden`, () => api.partySetCurrent(code, index)),
    moveTrack: (from: number, to: number, title: string) =>
      mutate(
        `"${title}" konnte nicht nach ${to < from ? "oben" : "unten"} verschoben werden`,
        () => api.partyReorder(code, moved(trackIds, from, to)),
      ),
    togglePlayback: () => {
      if (!party) return;
      void mutate("Wiedergabe konnte nicht umgeschaltet werden", () =>
        api.partyPatchPlayback(code, !party.is_playing, party.position_sec),
      );
    },
    nextTrack: () => {
      if (!party || party.current_index + 1 >= party.tracks.length) return;
      const target = party.tracks[party.current_index + 1];
      void mutate(`"${target.title}" konnte nicht abgespielt werden`, () =>
        api.partySetCurrent(code, party.current_index + 1),
      );
    },
    prevTrack: () => {
      if (!party || party.current_index <= 0) return;
      const target = party.tracks[party.current_index - 1];
      void mutate(`"${target.title}" konnte nicht abgespielt werden`, () =>
        api.partySetCurrent(code, party.current_index - 1),
      );
    },
  };
}
