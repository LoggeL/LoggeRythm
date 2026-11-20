"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { subscribeAudioSpectrum } from "@/lib/audioSpectrum";
import { classifyFeatures, createGenreListener } from "@/lib/genreListener";
import {
  advanceDecision, initialDecision, metadataScene,
  type GenreRef, type MetadataState, type SceneDecision, type SceneKey, type ScenePreference,
} from "@/lib/visualizerScenes";
import type { Track } from "@/types";

/** How often the listener re-evaluates its guess. */
const EVALUATE_MS = 500;
const GENRES_STALE_MS = 24 * 60 * 60 * 1000;

export interface VisualizerSceneChoice {
  /** The scene to render. */
  scene: SceneKey;
  /** The automatic choice for this track (shown even when the user picked one by hand). */
  decision: SceneDecision;
  manual: boolean;
}

async function fetchAlbumGenres(albumId: string): Promise<GenreRef[]> {
  const album = await api.album(albumId);
  if (!Array.isArray(album.genres)) {
    throw new Error(`Album ${albumId} kam ohne Genre-Liste von der API.`);
  }
  return album.genres;
}

/**
 * Picks the fullscreen visualizer's scene for the current track: the album's
 * Deezer genre first, then listening to the live spectrum to confirm, decide
 * or overrule it (see visualizerScenes). A manual preference always wins.
 */
export function useVisualizerScene({ track, preference, listening }: {
  /** null while nothing is loaded; the result is then the undecided scene. */
  track: Track | null;
  preference: ScenePreference;
  /** The visualizer is on and music is playing; only then is it worth listening. */
  listening: boolean;
}): VisualizerSceneChoice {
  const trackId = track?.id ?? null;
  const albumId = track?.album_id !== undefined && track.album_id !== "" ? String(track.album_id) : null;
  const genres = useQuery({
    queryKey: ["album-genres", albumId],
    queryFn: () => fetchAlbumGenres(albumId!),
    enabled: albumId !== null,
    staleTime: GENRES_STALE_MS,
  });

  const metadata = useMemo<MetadataState>(() => {
    if (albumId === null) return { kind: "none", names: [] };
    if (genres.isPending) return { kind: "loading" };
    if (genres.isError) return { kind: "error", message: genres.error.message };
    const match = metadataScene(genres.data);
    return match ? { kind: "genre", ...match } : { kind: "none", names: genres.data.map((genre) => genre.name) };
  }, [albumId, genres.isPending, genres.isError, genres.error, genres.data]);

  const [decided, setDecided] = useState(() => ({ trackId, metadata, decision: initialDecision(metadata) }));
  // A new track or newly arrived metadata restarts the choice, unless listening already settled it.
  let current = decided;
  if (decided.trackId !== trackId || decided.metadata !== metadata) {
    const keep = decided.trackId === trackId && decided.decision.locked && decided.decision.source === "listening";
    current = { trackId, metadata, decision: keep ? decided.decision : initialDecision(metadata) };
    setDecided(current);
  }

  const metadataRef = useRef(metadata);
  useEffect(() => { metadataRef.current = metadata; }, [metadata]);

  const locked = current.decision.locked;
  const shouldListen = trackId !== null && listening && preference === "auto" && !locked;
  useEffect(() => {
    if (!shouldListen) return;
    const listener = createGenreListener();
    const unsubscribe = subscribeAudioSpectrum((frame) => listener.push(frame));
    const timer = window.setInterval(() => {
      const features = listener.features();
      const guesses = features ? classifyFeatures(features) : null;
      setDecided((previous) => {
        if (previous.trackId !== trackId) return previous;
        const next = advanceDecision(previous.decision, metadataRef.current, guesses, listener.seconds);
        return next === previous.decision ? previous : { ...previous, decision: next };
      });
    }, EVALUATE_MS);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [shouldListen, trackId]);

  const manual = preference !== "auto";
  return { scene: manual ? preference : current.decision.scene, decision: current.decision, manual };
}
