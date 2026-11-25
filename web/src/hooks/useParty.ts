"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { exitPartySession } from "@/lib/partyExit";
import { patchPartyPlayback } from "@/lib/partySocket";
import { shouldBindPartyRoute } from "@/lib/partySync";
import { usePartyStore } from "@/store/party";
import type { PartySettingsUpdate, PartyState, Track } from "@/types";

/**
 * Party session hook bound to the persistent app-wide Jam store
 * (`PartySessionManager` owns the SSE stream & playback sync so navigating away
 * from `/party/[code]` keeps the Jam alive).
 */
export function useParty(code: string | null) {
  const queryClient = useQueryClient();
  const activeCode = usePartyStore((s) => s.code);
  const storeParty = usePartyStore((s) => s.party);
  const ended = usePartyStore((s) => s.ended);
  const endedCode = usePartyStore((s) => s.endedCode);
  const endedReason = usePartyStore((s) => s.endedReason);
  const exitingCode = usePartyStore((s) => s.exitingCode);
  const lastExitedCode = usePartyStore((s) => s.lastExitedCode);
  const streamStatus = usePartyStore((s) => s.streamStatus);
  const streamError = usePartyStore((s) => s.streamError);
  const setActiveCode = usePartyStore((s) => s.setActiveCode);
  const applyPartyState = usePartyStore((s) => s.applyPartyState);
  const [leftCode, setLeftCode] = useState<string | null>(null);

  const normalizedCode = code ? code.toUpperCase() : null;
  const endedForThisParty = Boolean(normalizedCode && ended && endedCode === normalizedCode);
  const leavingOrLeft = Boolean(
    normalizedCode &&
      (exitingCode === normalizedCode ||
        leftCode === normalizedCode ||
        (lastExitedCode === normalizedCode && activeCode !== normalizedCode)),
  );

  // Bind this party code into the persistent manager only when opening this route.
  // Deliberately does NOT re-run when `activeCode` clears on leave/end; otherwise
  // clearing the store before `router.push("/")` unmounts this page immediately
  // re-binds the code and calls GET /party/{code} (re-adding the user on the server).
  useEffect(() => {
    if (!normalizedCode) return;
    const store = usePartyStore.getState();
    if (shouldBindPartyRoute(normalizedCode, store, leftCode)) {
      store.setActiveCode(normalizedCode);
    }
  }, [normalizedCode, leftCode]);

  const query = useQuery<PartyState>({
    queryKey: ["party", normalizedCode],
    queryFn: async () => {
      const state = await api.getParty(normalizedCode as string);
      const current = usePartyStore.getState();
      if (!state.ended && current.code === normalizedCode && current.exitingCode !== normalizedCode) {
        applyPartyState(state);
      }
      return state;
    },
    enabled: Boolean(normalizedCode) && !endedForThisParty && !leavingOrLeft && activeCode === normalizedCode,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const data: PartyState | null =
    storeParty && storeParty.code === normalizedCode
      ? storeParty
      : query.data && query.data.code === normalizedCode && !leavingOrLeft
        ? query.data
        : null;

  const create = useCallback(async (name?: string) => api.createParty(name), []);
  const join = useCallback(async () => {
    if (!normalizedCode) return;
    setLeftCode((cur) => (cur === normalizedCode ? null : cur));
    const joined = await api.joinParty(normalizedCode);
    if (usePartyStore.getState().exitingCode === normalizedCode) {
      return joined;
    }
    setActiveCode(joined.code);
    applyPartyState(joined);
    return joined;
  }, [normalizedCode, setActiveCode, applyPartyState]);

  const add = useCallback(
    async (track: Track, insert: "end" | "next" = "end") => {
      if (!normalizedCode) return;
      await api.partyAddTrack(normalizedCode, track, insert);
    },
    [normalizedCode],
  );
  const remove = useCallback(
    async (itemId: number) => {
      if (!normalizedCode) return;
      await api.partyRemoveTrack(normalizedCode, itemId);
    },
    [normalizedCode],
  );
  const reorder = useCallback(
    async (ids: number[]) => {
      if (!normalizedCode) return;
      await api.partyReorder(normalizedCode, ids);
    },
    [normalizedCode],
  );
  const setCurrent = useCallback(
    async (index: number) => {
      if (!normalizedCode) return;
      await api.partySetCurrent(normalizedCode, index);
    },
    [normalizedCode],
  );
  const setPlayback = useCallback(
    async (isPlaying: boolean, positionSec: number) => {
      if (!normalizedCode) return;
      await patchPartyPlayback(normalizedCode, isPlaying, positionSec);
    },
    [normalizedCode],
  );
  const updateSettings = useCallback(
    async (patch: PartySettingsUpdate) => {
      if (!normalizedCode) return;
      const updated = await api.partyUpdateSettings(normalizedCode, patch);
      applyPartyState(updated);
      return updated;
    },
    [normalizedCode, applyPartyState],
  );
  const kickMember = useCallback(
    async (memberKey: string) => {
      if (!normalizedCode) return;
      await api.kickPartyMember(normalizedCode, memberKey);
    },
    [normalizedCode],
  );
  const savePlaylist = useCallback(
    async (options: { name?: string; collaborative?: boolean }) => {
      if (!normalizedCode) throw new Error("Kein aktiver Jam-Code.");
      const created = await api.partySavePlaylist(normalizedCode, options);
      void queryClient.invalidateQueries({ queryKey: ["playlists"] });
      return created;
    },
    [normalizedCode, queryClient],
  );
  const transferHost = useCallback(
    async (memberKey: string) => {
      if (!normalizedCode) return;
      const updated = await api.partyTransferHost(normalizedCode, memberKey);
      applyPartyState(updated);
      return updated;
    },
    [normalizedCode, applyPartyState],
  );
  const autoDjFill = useCallback(
    async (count = 5) => {
      if (!normalizedCode) return;
      const updated = await api.partyAutoDjFill(normalizedCode, count);
      applyPartyState(updated);
      return updated;
    },
    [normalizedCode, applyPartyState],
  );
  const react = useCallback(
    async (emoji: string) => {
      if (!normalizedCode) return;
      return await api.partyReact(normalizedCode, emoji);
    },
    [normalizedCode],
  );
  const voteSkip = useCallback(
    async () => {
      if (!normalizedCode) throw new Error("Kein aktiver Jam-Code.");
      const result = await api.partyVoteSkip(normalizedCode);
      if (result.state) applyPartyState(result.state);
      return result;
    },
    [normalizedCode, applyPartyState],
  );
  const leave = useCallback(async () => {
    if (!normalizedCode) return;
    setLeftCode(normalizedCode);
    try {
      await exitPartySession(normalizedCode, "leave", { queryClient });
    } catch (error) {
      setLeftCode((cur) => (cur === normalizedCode ? null : cur));
      throw error;
    }
  }, [normalizedCode, queryClient]);
  const end = useCallback(async () => {
    if (!normalizedCode) return;
    setLeftCode(normalizedCode);
    try {
      await exitPartySession(normalizedCode, "end", { queryClient });
    } catch (error) {
      setLeftCode((cur) => (cur === normalizedCode ? null : cur));
      throw error;
    }
  }, [normalizedCode, queryClient]);

  return {
    party: data,
    ended: endedForThisParty,
    endedReason: endedForThisParty ? endedReason : null,
    hasLeft: leavingOrLeft,
    streamStatus,
    streamError,
    isLoading: (query.isLoading || (activeCode === normalizedCode && !data)) && !data,
    isError: query.isError || streamStatus === "error",
    error: query.error ?? (streamError ? new Error(streamError) : null),
    refetch: query.refetch,
    create,
    join,
    add,
    remove,
    reorder,
    setCurrent,
    setPlayback,
    updateSettings,
    kickMember,
    savePlaylist,
    transferHost,
    autoDjFill,
    react,
    voteSkip,
    leave,
    end,
  };
}
