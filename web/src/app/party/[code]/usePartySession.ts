"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useParty } from "@/hooks/useParty";
import { usePartyStore } from "@/store/party";
import { toast } from "@/store/toast";
import type { Track } from "@/types";
import { leavePartyAndNavigate, partyFailureMessage } from "../requests";
import { usePartyPlaybackSync } from "./usePartyPlaybackSync";

const JOIN_FAILED = "Beitritt zur Party fehlgeschlagen";
const LOAD_FAILED = "Party konnte nicht geladen werden";

/** Move the id at `from` to position `to`, returning the new ordering. */
function moved(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Everything the party page needs to know about the session: live state,
 * joining, leaving and queue edits. Queue edits and leaving are serialised —
 * only one runs at a time — and every failure is surfaced both inline and as
 * a toast.
 */
export function usePartySession(code: string) {
  const router = useRouter();
  const { party, isLoading, isError, error, refetch, join, add, remove, reorder, setCurrent, setPlayback, leave } =
    useParty(code);
  const isHost = !!party?.is_host;
  const listenMode = usePartyStore((s) => s.listenMode);
  const setListenMode = usePartyStore((s) => s.setListenMode);
  usePartyPlaybackSync(code, isHost, !!party && listenMode === "device", setPlayback);

  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const queueBusy = useRef(false);
  const leaveBusy = useRef(false);

  // Join on mount; a failed join gets a visible retry instead of only a toast.
  useEffect(() => {
    if (!code) return;
    let active = true;
    join()
      .then(() => {
        if (active) setJoinError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const message = partyFailureMessage(JOIN_FAILED, cause);
        setJoinError(message);
        toast.error(message);
      });
    return () => {
      active = false;
    };
  }, [code, join]);

  const retryJoin = async () => {
    setJoining(true);
    try {
      await join();
      setJoinError(null);
    } catch (cause) {
      const message = partyFailureMessage(JOIN_FAILED, cause);
      setJoinError(message);
      toast.error(message);
    } finally {
      setJoining(false);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      await refetch({ throwOnError: true });
    } catch (cause) {
      toast.error(partyFailureMessage(LOAD_FAILED, cause));
    } finally {
      setReloading(false);
    }
  };

  const leaveParty = async () => {
    if (leaveBusy.current || queueBusy.current) return;
    leaveBusy.current = true;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leavePartyAndNavigate(leave, () => router.push("/"));
    } catch (cause) {
      const message = partyFailureMessage("Party konnte nicht verlassen werden", cause);
      setLeaveError(message);
      toast.error(message);
    } finally {
      leaveBusy.current = false;
      setLeaving(false);
    }
  };

  const mutateQueue = async (failure: string, operation: () => Promise<void>, successMessage?: string) => {
    if (queueBusy.current || leaveBusy.current) return;
    queueBusy.current = true;
    setQueuePending(true);
    setQueueError(null);
    try {
      await operation();
      if (successMessage) toast.success(successMessage);
    } catch (cause) {
      const message = partyFailureMessage(failure, cause);
      setQueueError(message);
      toast.error(message);
    } finally {
      queueBusy.current = false;
      setQueuePending(false);
    }
  };

  const trackIds = party ? party.tracks.map((track) => track.id) : [];

  return {
    party,
    isHost,
    /** Where this browser hears the party (members only; the host always plays). */
    listenMode,
    setListenMode,
    isLoading,
    /** The background refresh failed while older party data is still shown. */
    isStale: isError,
    loadError: error ? partyFailureMessage(LOAD_FAILED, error) : "Die API hat keine Party-Daten zurückgegeben.",
    reload,
    reloading,
    joinError,
    joining,
    retryJoin,
    leaveParty,
    leaving,
    leaveError,
    queuePending,
    queueError,
    /** True while a queue edit or leaving is in flight; disables queue controls. */
    queueLocked: queuePending || leaving,
    addTrack: (track: Track) =>
      mutateQueue(`"${track.title}" konnte nicht hinzugefügt werden`, () => add(track), "Zur Party hinzugefügt."),
    playAt: (index: number, title: string) =>
      mutateQueue(`"${title}" konnte nicht abgespielt werden`, () => setCurrent(index)),
    moveTrack: (from: number, to: number, title: string) =>
      mutateQueue(
        `"${title}" konnte nicht nach ${to < from ? "oben" : "unten"} verschoben werden`,
        () => reorder(moved(trackIds, from, to)),
      ),
    removeTrack: (itemId: number, title: string) =>
      mutateQueue(`"${title}" konnte nicht entfernt werden`, () => remove(itemId)),
  };
}
