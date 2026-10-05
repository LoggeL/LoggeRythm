"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { startTrackRadio, startTrackListRadio } from "@/lib/radio";
import { trackArtistLabel } from "@/lib/trackArtists";
import { useLocalJson } from "@/hooks/useLocalJson";
import { toast } from "@/store/toast";
import { usePlayerStore } from "@/store/player";
import { CardGridSkeleton } from "@/components/Skeleton";
import { PlayIcon, RadioIcon, SpinnerIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import type { Track, Genre } from "@/types";

const EMPTY_TRACKS: Track[] = [];

const MOOD_STATIONS = [
  { tag: "chill", title: "Chill-Radio", subtitle: "Entspannte Töne für ruhige Momente", label: "Zur Ruhe kommen" },
  { tag: "focus", title: "Fokus-Radio", subtitle: "Konzentriert bleiben, ohne Ablenkung", label: "Im Flow bleiben" },
  { tag: "workout", title: "Workout-Radio", subtitle: "Energie für dein Training", label: "In Bewegung" },
  { tag: "party", title: "Party-Radio", subtitle: "Voller Beats für die Nacht", label: "Zusammen feiern" },
] as const;

export default function RadioPage() {
  const [recent] = useLocalJson<Track[]>("sf_recent_tracks", EMPTY_TRACKS);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // A ref reserves the request immediately, including clicks before React rerenders.
  const startingRef = useRef<string | null>(null);
  const genres = useQuery<Genre[]>({ queryKey: ["genres"], queryFn: () => api.genres() });

  async function startStation(key: string, title: string, start: (session: number) => void | Promise<void>) {
    if (startingRef.current !== null) return;
    startingRef.current = key;
    setStartingKey(key);
    setStartError(null);
    usePlayerStore.getState().setRadioActive(false);
    const session = usePlayerStore.getState().radioSession;
    try {
      await start(session);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const message = `${title} konnte nicht gestartet werden: ${detail}`;
      setStartError(message);
      if (key.startsWith("track:")) {
        usePlayerStore.getState()._setError(message);
      } else {
        toast.error(message);
      }
    } finally {
      startingRef.current = null;
      setStartingKey(null);
    }
  }

  function playFetchedStation(tracks: unknown, title: string, session: number) {
    if (!Array.isArray(tracks)) {
      throw new Error(`Die Antwort für ${title} enthält keine gültige Titelliste.`);
    }
    // Explicit playback elsewhere owns the player after it changes the session.
    if (usePlayerStore.getState().radioSession !== session) return;
    if (!tracks.length) throw new Error("Für dieses Radio wurden keine Titel gefunden.");
    startTrackListRadio(tracks, title);
  }

  if (!Array.isArray(recent)) {
    throw new Error('Der gespeicherte Hörverlauf in localStorage "sf_recent_tracks" enthält keine gültige Titelliste.');
  }
  const personal = recent.slice(0, 12);
  const starting = startingKey !== null;

  return (
    <div className="flex flex-col gap-9 animate-in">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Ein Start, immer neue Musik</p>
          <h1 className="page-title">Radio</h1>
          <p className="page-description">Wähle einen Song, eine Stimmung oder ein Genre. Wir spielen passende Musik weiter.</p>
        </div>
        <span aria-hidden="true" className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-accent-soft sm:flex">
          <RadioIcon width={24} height={24} />
        </span>
      </header>

      {startError && <div role="alert" className="error-panel">{startError}</div>}
      <div className="sr-only" role="status" aria-live="polite">{starting ? "Radio wird gestartet. Bitte einen Moment warten." : ""}</div>

      <section aria-labelledby="personal-radio-title">
        <div className="section-heading">
          <div>
            <h2 id="personal-radio-title">Von deinen letzten Songs inspiriert</h2>
            <p className="mt-1 text-sm text-muted">Starte mit einem vertrauten Titel und entdecke mehr davon.</p>
          </div>
        </div>
        {personal.length === 0 ? (
          <div className="empty-panel flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">Dein persönliches Radio beginnt mit einem Song.</p>
              <p className="mt-1 text-sm text-muted">Sobald du Musik hörst, findest du hier passende Stationen.</p>
            </div>
            <Link href="/search" className="action-secondary shrink-0">Musik suchen</Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {personal.map((track) => {
              const busy = startingKey === `track:${track.id}`;
              return (
                <button key={track.id} type="button" disabled={starting} aria-label={`Radio mit ${track.title} von ${trackArtistLabel(track)} starten`} aria-busy={busy} onClick={() => { void startStation(`track:${track.id}`, `${track.title}-Radio`, () => startTrackRadio(track)); }} className="music-card group flex min-w-0 items-center gap-3 p-3 text-left disabled:cursor-wait disabled:opacity-60">
                  {track.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.cover} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <CoverPlaceholder className="h-14 w-14 shrink-0 rounded-lg" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{track.title}</p>
                    <p className="mt-1 truncate text-xs text-muted">{trackArtistLabel(track)}</p>
                  </div>
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-accent-soft transition group-hover:bg-accent/15">
                    {busy ? <SpinnerIcon className="animate-spin" width={17} height={17} /> : <PlayIcon width={17} height={17} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="mood-radio-title">
        <div className="section-heading">
          <div>
            <h2 id="mood-radio-title">Was passt gerade?</h2>
            <p className="mt-1 text-sm text-muted">Stimmungs-Radios für deinen Tag.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MOOD_STATIONS.map((station) => {
            const busy = startingKey === `mood:${station.tag}`;
            return (
              <button key={station.tag} type="button" disabled={starting} aria-busy={busy} onClick={() => { void startStation(`mood:${station.tag}`, station.title, async (session) => { const tracks = await api.homeMood(station.tag); playFetchedStation(tracks, station.title, session); }); }} className="surface-card group flex min-h-[180px] flex-col items-start p-5 text-left transition hover:border-accent/35 disabled:cursor-wait disabled:opacity-60">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-soft">{station.label}</p>
                <h3 className="mt-3 text-lg font-semibold">{station.title}</h3>
                <p className="mt-1 text-sm text-muted">{station.subtitle}</p>
                <span className="mt-auto inline-flex items-center gap-2 pt-5 text-xs font-medium text-foreground">
                  <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-accent-soft">{busy ? <SpinnerIcon className="animate-spin" width={14} height={14} /> : <PlayIcon width={14} height={14} />}</span>
                  {busy ? "Wird gestartet…" : "Radio starten"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="genre-radio-title" aria-busy={genres.isLoading}>
        <div className="section-heading">
          <div>
            <h2 id="genre-radio-title">Genre-Radios</h2>
            <p className="mt-1 text-sm text-muted">Ein Sound, viele Entdeckungen.</p>
          </div>
        </div>
        {genres.error && (
          <div role="alert" className="error-panel mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">Genre-Radios konnten nicht geladen werden.</p>
              <p className="mt-1 text-sm break-words">{genres.error.message}{genres.data !== undefined && " Der zuletzt geladene Stand bleibt sichtbar."}</p>
            </div>
            <button type="button" disabled={genres.isFetching} onClick={() => { void genres.refetch(); }} className="action-secondary shrink-0">{genres.isFetching ? "Wird geladen…" : "Erneut versuchen"}</button>
          </div>
        )}
        {genres.isLoading ? (
          <CardGridSkeleton count={12} />
        ) : genres.data?.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {genres.data.map((genre) => {
              const busy = startingKey === `genre:${genre.id}`;
              return (
                <button key={String(genre.id)} type="button" disabled={starting} aria-label={`${genre.name}-Radio starten`} aria-busy={busy} onClick={() => { void startStation(`genre:${genre.id}`, `${genre.name}-Radio`, async (session) => { const detail = await api.genre(String(genre.id)); playFetchedStation(detail?.tracks, `${genre.name}-Radio`, session); }); }} className="music-card group flex min-w-0 items-center gap-3 p-3 text-left disabled:cursor-wait disabled:opacity-60">
                  {genre.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={genre.picture} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted"><RadioIcon width={18} height={18} /></span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{genre.name}</span>
                  <span aria-hidden="true" className="shrink-0 text-accent-soft">{busy ? <SpinnerIcon className="animate-spin" width={15} height={15} /> : <PlayIcon width={15} height={15} />}</span>
                </button>
              );
            })}
          </div>
        ) : !genres.error ? (
          <div className="empty-panel">Zurzeit sind keine Genres verfügbar.</div>
        ) : null}
      </section>
    </div>
  );
}
