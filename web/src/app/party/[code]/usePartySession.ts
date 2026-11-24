"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useParty } from "@/hooks/useParty";
import { usePartyStore } from "@/store/party";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import type { PartySettingsUpdate, Track } from "@/types";
import { leavePartyAndNavigate, partyFailureMessage } from "../requests";

const JOIN_FAILED = "Beitritt zur Jam fehlgeschlagen";
const LOAD_FAILED = "Jam konnte nicht geladen werden";

/** Move the id at `from` to position `to`, returning the new ordering. */
function moved(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Everything the member party page needs: live state (managed persistently by
 * `PartySessionManager`), joining, leaving/ending, settings, kicking, and
 * serialised queue/playback actions with loud error reporting.
 */
export function usePartySession(code: string) {
  const router = useRouter();
  const {
    party,
    ended,
    endedReason,
    isLoading,
    isError,
    error,
    refetch,
    join,
    add,
    remove,
    reorder,
    setCurrent,
    setPlayback,
    updateSettings,
    kickMember,
    leave,
    end,
  } = useParty(code);
  const listenLocally = usePartyStore((s) => s.listenLocally);
  const setListenLocally = usePartyStore((s) => s.setListenLocally);
  const isHost = Boolean(party?.is_host);
  const guestsCanControl = Boolean(party?.guests_can_control);

  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [settingsPending, setSettingsPending] = useState(false);
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
      const message = partyFailureMessage("Jam konnte nicht verlassen werden", cause);
      setLeaveError(message);
      toast.error(message);
    } finally {
      leaveBusy.current = false;
      setLeaving(false);
    }
  };

  const endParty = async () => {
    if (leaveBusy.current || queueBusy.current) return;
    leaveBusy.current = true;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leavePartyAndNavigate(end, () => router.push("/"));
    } catch (cause) {
      const message = partyFailureMessage("Jam konnte nicht beendet werden", cause);
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

  const saveSettings = async (patch: PartySettingsUpdate, successMessage?: string) => {
    if (settingsPending || leaveBusy.current) return;
    setSettingsPending(true);
    setQueueError(null);
    try {
      await updateSettings(patch);
      if (successMessage) toast.success(successMessage);
    } catch (cause) {
      const message = partyFailureMessage("Jam-Einstellungen konnten nicht gespeichert werden", cause);
      setQueueError(message);
      toast.error(message);
    } finally {
      setSettingsPending(false);
    }
  };

  const kick = async (memberKey: string, name: string) => {
    await mutateQueue(
      `${name} konnte nicht entfernt werden`,
      () => kickMember(memberKey),
      `${name} wurde aus der Jam entfernt.`,
    );
  };

  const togglePlayback = () => {
    if (!party) return;
    if (isHost) {
      usePlayerStore.getState().toggle();
      return;
    }
    const pos = usePlayerStore.getState().currentTime;
    void mutateQueue("Wiedergabe konnte nicht umgeschaltet werden", () =>
      setPlayback(!party.is_playing, pos),
    );
  };

  const trackIds = party ? party.tracks.map((track) => track.id) : [];

  return {
    party,
    ended,
    endedReason,
    isHost,
    guestsCanControl,
    listenLocally,
    setListenLocally,
    isLoading,
    /** The background refresh or live stream failed while older data is still shown. */
    isStale: isError,
    loadError: error ? partyFailureMessage(LOAD_FAILED, error) : "Die API hat keine Jam-Daten zurückgegeben.",
    reload,
    reloading,
    joinError,
    joining,
    retryJoin,
    leaveParty,
    endParty,
    leaving,
    leaveError,
    queuePending,
    queueError,
    settingsPending,
    /** True while a queue edit or leaving is in flight; disables queue controls. */
    queueLocked: queuePending || leaving,
    addTrack: (track: Track) =>
      mutateQueue(`"${track.title}" konnte nicht hinzugefügt werden`, () => add(track, "end"), "Zur Jam hinzugefügt."),
    addTrackNext: (track: Track) =>
      mutateQueue(`"${track.title}" konnte nicht als Nächstes eingereiht werden`, () => add(track, "next"), "Wird als Nächstes in der Jam gespielt."),
    playAt: (index: number, title: string) =>
      mutateQueue(`"${title}" konnte nicht abgespielt werden`, () => setCurrent(index)),
    nextTrack: () => {
      if (!party || party.current_index + 1 >= party.tracks.length) return;
      const target = party.tracks[party.current_index + 1];
      void mutateQueue(`"${target.title}" konnte nicht abgespielt werden`, () =>
        setCurrent(party.current_index + 1),
      );
    },
    prevTrack: () => {
      if (!party || party.current_index <= 0) return;
      const target = party.tracks[party.current_index - 1];
      void mutateQueue(`"${target.title}" konnte nicht abgespielt werden`, () =>
        setCurrent(party.current_index - 1),
      );
    },
    togglePlayback,
    moveTrack: (from: number, to: number, title: string) =>
      mutateQueue(
        `"${title}" konnte nicht nach ${to < from ? "oben" : "unten"} verschoben werden`,
        () => reorder(moved(trackIds, from, to)),
      ),
    removeTrack: (itemId: number, title: string) =>
      mutateQueue(`"${title}" konnte nicht entfernt werden`, () => remove(itemId)),
    saveSettings,
    kickMember: kick,
  };
}
