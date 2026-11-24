"use client";

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { patchPartyPlayback } from "@/lib/partySocket";
import { usePlayerStore } from "@/store/player";
import { usePartyStore } from "@/store/party";
import type { PartySettingsUpdate, PartyState, Track } from "@/types";

/**
 * Party session hook bound to the persistent app-wide Jam store
 * (`PartySessionManager` owns the SSE stream & playback sync so navigating away
 * from `/party/[code]` keeps the Jam alive).
 */
export function useParty(code: string | null) {
  const activeCode = usePartyStore((s) => s.code);
  const storeParty = usePartyStore((s) => s.party);
  const ended = usePartyStore((s) => s.ended);
  const endedCode = usePartyStore((s) => s.endedCode);
  const endedReason = usePartyStore((s) => s.endedReason);
  const streamStatus = usePartyStore((s) => s.streamStatus);
  const streamError = usePartyStore((s) => s.streamError);
  const setActiveCode = usePartyStore((s) => s.setActiveCode);
  const applyPartyState = usePartyStore((s) => s.applyPartyState);
  const clearParty = usePartyStore((s) => s.clearParty);
  const setPartyBridge = usePlayerStore((s) => s.setPartyBridge);
  const setSuppressLocalAudio = usePlayerStore((s) => s.setSuppressLocalAudio);

  const normalizedCode = code ? code.toUpperCase() : null;
  const endedForThisParty = Boolean(normalizedCode && ended && endedCode === normalizedCode);

  // Bind this party code into the persistent manager when the page opens.
  useEffect(() => {
    if (!normalizedCode) return;
    if (activeCode !== normalizedCode && !endedForThisParty) {
      setActiveCode(normalizedCode);
    }
  }, [normalizedCode, activeCode, endedForThisParty, setActiveCode]);

  const query = useQuery<PartyState>({
    queryKey: ["party", normalizedCode],
    queryFn: async () => {
      const state = await api.getParty(normalizedCode as string);
      if (!state.ended) applyPartyState(state);
      return state;
    },
    enabled: Boolean(normalizedCode) && !endedForThisParty,
    refetchInterval: false,
  });

  const data: PartyState | null =
    storeParty && storeParty.code === normalizedCode
      ? storeParty
      : query.data && query.data.code === normalizedCode
        ? query.data
        : null;

  const create = useCallback(async (name?: string) => api.createParty(name), []);
  const join = useCallback(async () => {
    if (!normalizedCode) return;
    const joined = await api.joinParty(normalizedCode);
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
  const leave = useCallback(async () => {
    if (!normalizedCode) return;
    await api.leaveParty(normalizedCode);
    setPartyBridge(null);
    setSuppressLocalAudio(false);
    clearParty();
  }, [normalizedCode, setPartyBridge, setSuppressLocalAudio, clearParty]);
  const end = useCallback(async () => {
    if (!normalizedCode) return;
    await api.endParty(normalizedCode);
    setPartyBridge(null);
    setSuppressLocalAudio(false);
    clearParty();
  }, [normalizedCode, setPartyBridge, setSuppressLocalAudio, clearParty]);

  return {
    party: data,
    ended: endedForThisParty,
    endedReason: endedForThisParty ? endedReason : null,
    streamStatus,
    streamError,
    isLoading: query.isLoading && !data,
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
    leave,
    end,
  };
}
