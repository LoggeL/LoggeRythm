"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  openPartyStream,
  patchPartyPlayback,
  type PartyLiveState,
} from "@/lib/partySocket";
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

  // Live state fed by the SSE stream. The initial full-state frame arrives on
  // connect; every mutation pushes a fresh frame. React Query below is only the
  // one-shot initial load plus a long safety-net refetch in case the stream
  // silently stalls.
  const [live, setLive] = useState<PartyLiveState | null>(null);

  const query = useQuery<PartyState>({
    queryKey: ["party", code],
    queryFn: () => api.getParty(code as string),
    enabled: !!code,
    // Safety fallback only — SSE is the real-time source of truth.
    refetchInterval: 20000,
  });

  // The backend always includes the playback fields; the query type predates
  // them, so widen it here.
  const initial = query.data as PartyLiveState | undefined;
  const data: PartyLiveState | null = live ?? initial ?? null;

  // Open the SSE stream. On new code / unmount the previous stream is closed.
  useEffect(() => {
    if (!code) return;
    const dispose = openPartyStream(code, (state) => setLive(state));
    return () => {
      dispose();
      setLive(null);
    };
  }, [code]);

  // Install the bridge so player queue edits route to the party api. It is
  // re-installed whenever state changes so removeAt/reorder can map queue
  // indices to the server item ids from the latest party state.
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

  // Sync live state into the player queue + party store.
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
      isPlaying: data.is_playing,
      positionSec: data.position_sec,
      playbackUpdatedAt: data.playback_updated_at
        ? Date.parse(data.playback_updated_at)
        : null,
    });
  }, [data, setPartyQueue, setParty]);

  const create = useCallback(async (name?: string) => api.createParty(name), []);
  const join = useCallback(async () => {
    if (!code) return;
    return api.joinParty(code);
  }, [code]);
  // Mutations rely on the SSE stream to echo the resulting state back, so they
  // no longer refetch — the broadcast (and the 20s safety poll) keep us fresh.
  const add = useCallback(
    async (track: Track) => {
      if (!code) return;
      await api.partyAddTrack(code, track);
    },
    [code],
  );
  const remove = useCallback(
    async (itemId: number) => {
      if (!code) return;
      await api.partyRemoveTrack(code, itemId);
    },
    [code],
  );
  const reorder = useCallback(
    async (ids: number[]) => {
      if (!code) return;
      await api.partyReorder(code, ids);
    },
    [code],
  );
  const setCurrent = useCallback(
    async (index: number) => {
      if (!code) return;
      await api.partySetCurrent(code, index);
    },
    [code],
  );
  // Host-only playback broadcast (guarded server-side with a 403 for guests).
  const setPlayback = useCallback(
    async (isPlaying: boolean, positionSec: number) => {
      if (!code) return;
      await patchPartyPlayback(code, isPlaying, positionSec);
    },
    [code],
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
    setPlayback,
    leave,
  };
}
