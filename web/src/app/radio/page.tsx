"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { startTrackRadio, startTrackListRadio } from "@/lib/radio";
import { trackArtistLabel } from "@/lib/trackArtists";
import { useRecentTracks } from "@/hooks/useRecentTracks";
import { toast } from "@/store/toast";
import { usePlayerStore } from "@/store/player";
import { PlayIcon, RadioIcon, SpinnerIcon } from "@/components/icons";
import Shelf from "@/components/browse/Shelf";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import SectionHeader from "@/components/ui/SectionHeader";
import type { Genre } from "@/types";

const MOOD_STATIONS = [
  { tag: "chill", title: "Chill-Radio", subtitle: "Entspannte Töne für ruhige Momente", label: "Zur Ruhe kommen", tone: "gradient-teal" },
  { tag: "focus", title: "Fokus-Radio", subtitle: "Konzentriert bleiben, ohne Ablenkung", label: "Im Flow bleiben", tone: "gradient-blue" },
  { tag: "workout", title: "Workout-Radio", subtitle: "Energie für dein Training", label: "In Bewegung", tone: "gradient-orange" },
  { tag: "party", title: "Party-Radio", subtitle: "Voller Beats für die Nacht", label: "Zusammen feiern", tone: "gradient-pink" },
] as const;

const GENRE_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6";

/** The round state indicator of a station: play, starting, or on air. */
function StationSignal({ busy, live, className = "" }: { busy: boolean; live: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={`play-fab ${className}`}>
      {busy ? (
        <SpinnerIcon className="animate-spin" width={18} height={18} />
      ) : live ? (
        <span className="flex h-4 items-end gap-[3px]">
          {[0, 1, 2].map((bar) => (
            <span key={bar} className="eq-bar h-full w-[3px] rounded-full bg-current" style={{ animationDelay: `${bar * 0.18}s` }} />
          ))}
        </span>
      ) : (
        <PlayIcon width={18} height={18} />
      )}
    </span>
  );
}

function LiveBadge() {
  return <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-backdrop">Läuft gerade</span>;
}

export default function RadioPage() {
  const recent = useRecentTracks();
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // A ref reserves the request immediately, including clicks before React rerenders.
  const startingRef = useRef<string | null>(null);
  const genres = useQuery<Genre[]>({ queryKey: ["genres"], queryFn: () => api.genres() });
  // Stations name the queue they start, which identifies the one on air.
  const liveStation = usePlayerStore((state) => (state.radioActive ? state.queueContext : null));

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

  const personal = recent.slice(0, 12);
  const starting = startingKey !== null;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="page-eyebrow">Ein Start, immer neue Musik</p>
        <h1 className="page-title">Radio</h1>
        <p className="page-description">Wähle einen Song, eine Stimmung oder ein Genre. Wir spielen passende Musik weiter.</p>
        {liveStation && (
          <p className="mt-5 inline-flex max-w-full items-center gap-3 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-4 text-sm">
            <StationSignal busy={false} live className="h-8 w-8 shadow-none" />
            <span className="min-w-0 truncate">
              <span className="text-muted">Läuft gerade:</span> <span className="font-semibold">{liveStation}</span>
            </span>
          </p>
        )}
      </header>

      {startError && (
        <div role="alert" className="error-panel">
          {startError}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {starting ? "Radio wird gestartet. Bitte einen Moment warten." : ""}
      </div>

      <section aria-labelledby="mood-radio-title">
        <SectionHeader id="mood-radio-title" title="Was passt gerade?" description="Stimmungs-Radios für deinen Tag." />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
          {MOOD_STATIONS.map((station) => {
            const busy = startingKey === `mood:${station.tag}`;
            const live = liveStation === station.title;
            return (
              <button
                key={station.tag}
                type="button"
                disabled={starting}
                aria-busy={busy}
                aria-pressed={live}
                onClick={() => {
                  void startStation(`mood:${station.tag}`, station.title, async (session) => {
                    const tracks = await api.homeMood(station.tag);
                    playFetchedStation(tracks, station.title, session);
                  });
                }}
                className={`group press relative flex min-h-36 flex-col items-start overflow-hidden rounded-xl p-4 text-left disabled:cursor-wait sm:min-h-44 sm:p-5 ${station.tone} ${starting && !busy ? "opacity-60" : ""} ${live ? "ring-2 ring-accent-soft" : ""}`}
              >
                <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/70">
                  {station.label}
                  {live && <LiveBadge />}
                </span>
                <h3 className="mt-2 text-xl font-bold tracking-tight">{station.title}</h3>
                <span className="mt-1 max-w-[80%] text-sm text-foreground/75">{station.subtitle}</span>
                <span className="mt-auto flex w-full items-center justify-between gap-3 pt-4">
                  <span className="text-xs font-semibold text-foreground/85">{busy ? "Wird gestartet…" : live ? "Neu starten" : "Radio starten"}</span>
                  <StationSignal busy={busy} live={live} className="h-11 w-11 transition-transform group-hover:scale-105" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="personal-radio-title">
        <SectionHeader id="personal-radio-title" title="Von deinen letzten Songs inspiriert" description="Starte mit einem vertrauten Titel und entdecke mehr davon." />
        {personal.length === 0 ? (
          <EmptyState
            icon={<RadioIcon width={24} height={24} />}
            title="Dein persönliches Radio beginnt mit einem Song."
            action={
              <Link href="/search" className="action-secondary">
                Musik suchen
              </Link>
            }
          >
            Sobald du Musik hörst, findest du hier passende Stationen.
          </EmptyState>
        ) : (
          <Shelf label="Radios zu deinen letzten Songs">
            {personal.map((track) => {
              const busy = startingKey === `track:${track.id}`;
              const live = liveStation === `Radio – ${track.title}`;
              return (
                <button
                  key={track.id}
                  type="button"
                  disabled={starting}
                  aria-label={`Radio mit ${track.title} von ${trackArtistLabel(track)} starten`}
                  aria-busy={busy}
                  aria-pressed={live}
                  onClick={() => {
                    void startStation(`track:${track.id}`, `${track.title}-Radio`, () => startTrackRadio(track));
                  }}
                  className={`music-card group block w-full p-2.5 text-left disabled:cursor-wait sm:p-3 ${starting && !busy ? "opacity-60" : ""}`}
                >
                  <span className="relative mb-3 block">
                    <Cover src={track.cover} className={`aspect-square w-full rounded-xl ${live ? "ring-2 ring-accent-soft" : ""}`} />
                    <StationSignal
                      busy={busy}
                      live={live}
                      className={`absolute bottom-2 right-2 h-10 w-10 transition-opacity ${busy || live ? "" : "opacity-0 group-hover:opacity-100"}`}
                    />
                  </span>
                  <span className="block truncate text-sm font-semibold">{track.title}</span>
                  <span className="mt-1 block truncate text-xs text-muted">{live ? "Läuft gerade" : `Radio · ${trackArtistLabel(track)}`}</span>
                </button>
              );
            })}
          </Shelf>
        )}
      </section>

      <section aria-labelledby="genre-radio-title" aria-busy={genres.isLoading}>
        <SectionHeader id="genre-radio-title" title="Genre-Radios" description="Ein Sound, viele Entdeckungen." />
        <QueryError label="Genre-Radios" query={genres} className="mb-4" />
        {genres.isError && genres.data !== undefined && <p className="mb-4 text-xs text-subtle">Der zuletzt geladene Stand bleibt sichtbar.</p>}
        {genres.isLoading ? (
          <div role="status" aria-label="Genre-Radios werden geladen" className={GENRE_GRID}>
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        ) : genres.data?.length ? (
          <div className={GENRE_GRID}>
            {genres.data.map((genre) => {
              const busy = startingKey === `genre:${genre.id}`;
              const live = liveStation === `${genre.name}-Radio`;
              return (
                <button
                  key={String(genre.id)}
                  type="button"
                  disabled={starting}
                  aria-label={`${genre.name}-Radio starten`}
                  aria-busy={busy}
                  aria-pressed={live}
                  onClick={() => {
                    void startStation(`genre:${genre.id}`, `${genre.name}-Radio`, async (session) => {
                      const detail = await api.genre(String(genre.id));
                      playFetchedStation(detail?.tracks, `${genre.name}-Radio`, session);
                    });
                  }}
                  className={`group press flex h-16 min-w-0 items-center gap-3 overflow-hidden rounded-xl bg-white/[0.06] pr-3 text-left hover:bg-white/[0.11] disabled:cursor-wait ${starting && !busy ? "opacity-60" : ""} ${live ? "ring-2 ring-accent-soft" : ""}`}
                >
                  {genre.picture ? (
                    <Cover src={genre.picture} className="h-16 w-16" />
                  ) : (
                    <span aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center bg-white/[0.06] text-muted">
                      <RadioIcon width={20} height={20} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{genre.name}</span>
                    {live && <span className="block truncate text-xs text-accent-soft">Läuft gerade</span>}
                  </span>
                  <span aria-hidden="true" className={`shrink-0 ${live ? "text-accent-soft" : "text-muted group-hover:text-foreground"}`}>
                    {busy ? <SpinnerIcon className="animate-spin" width={16} height={16} /> : <PlayIcon width={16} height={16} />}
                  </span>
                </button>
              );
            })}
          </div>
        ) : genres.data !== undefined ? (
          <EmptyState
            icon={<RadioIcon width={24} height={24} />}
            title="Zurzeit sind keine Genres verfügbar."
            action={
              <Link href="/genre" className="action-secondary">
                Musik entdecken
              </Link>
            }
          >
            Die Stimmungs-Radios oben funktionieren trotzdem.
          </EmptyState>
        ) : null}
      </section>
    </div>
  );
}
