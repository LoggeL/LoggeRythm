"use client";

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { usePartyStore } from "@/store/party";
import type { PartyState, PartyTrack, Track } from "@/types";

function partyTrackToTrack(pt: PartyTrack): Track {
  return {
    id: pt.deezer_id,
    title: pt.title,
    artist: pt.artist,
    artist_id: pt.artist_id,
    artists: pt.artists,
    album: pt.album,
    album_id: pt.album_id,
    cover: pt.cover,
    duration_sec: pt.duration_sec,
  };
}

export function useParty(code: string | null) {
  const setPartyQueue = usePlayerStore((s) => s.setPartyQueue);
  const setPartyBridge = usePlayerStore((s) => s.setPartyBridge);
  const setParty = usePartyStore((s) => s.setParty);
  const clearParty = usePartyStore((s) => s.clearParty);

  const query = useQuery<PartyState>({
    queryKey: ["party", code],
    queryFn: () => api.getParty(code as string),
    enabled: !!code,
    refetchInterval: 2000,
  });

  const data = query.data;

  // Install the bridge so player queue edits route to the party api. It is
  // re-installed whenever poll data changes so removeAt/reorder can map queue
  // indices to the server item ids from the latest party state. Cleared on
  // unmount / when the code goes away.
  useEffect(() => {
    if (!code) {
      setPartyBridge(null);
      return;
    }
    const items = data?.tracks ?? [];
    setPartyBridge({
      addToQueue: (t) => {
        void api.partyAddTrack(code, t);
      },
      removeAt: (i) => {
        const item = items[i];
        if (item) void api.partyRemoveTrack(code, item.id);
      },
      reorder: (from, to) => {
        const ids = items.map((it) => it.id);
        if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return;
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        void api.partyReorder(code, ids);
      },
      setCurrent: (i) => {
        void api.partySetCurrent(code, i);
      },
    });
    return () => {
      setPartyBridge(null);
    };
  }, [code, data, setPartyBridge]);

  // Sync poll data into player queue + party store.
  useEffect(() => {
    if (!data) return;
    const tracks = data.tracks.map(partyTrackToTrack);
    setPartyQueue(tracks, data.current_index);
    setParty({
      code: data.code,
      active: true,
      name: data.name,
      isHost: data.is_host,
      currentIndex: data.current_index,
      members: data.members,
    });
  }, [data, setPartyQueue, setParty]);

  const create = useCallback(async (name?: string) => api.createParty(name), []);
  const join = useCallback(async () => {
    if (!code) return;
    return api.joinParty(code);
  }, [code]);
  const add = useCallback(
    async (track: Track) => {
      if (!code) return;
      await api.partyAddTrack(code, track);
      await query.refetch();
    },
    [code, query],
  );
  const remove = useCallback(
    async (itemId: number) => {
      if (!code) return;
      await api.partyRemoveTrack(code, itemId);
      await query.refetch();
    },
    [code, query],
  );
  const reorder = useCallback(
    async (ids: number[]) => {
      if (!code) return;
      await api.partyReorder(code, ids);
      await query.refetch();
    },
    [code, query],
  );
  const setCurrent = useCallback(
    async (index: number) => {
      if (!code) return;
      await api.partySetCurrent(code, index);
      await query.refetch();
    },
    [code, query],
  );
  const leave = useCallback(async () => {
    if (!code) return;
    await api.leaveParty(code);
    setPartyBridge(null);
    clearParty();
  }, [code, setPartyBridge, clearParty]);

  return {
    party: data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    create,
    join,
    add,
    remove,
    reorder,
    setCurrent,
    leave,
  };
}
