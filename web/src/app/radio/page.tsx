"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { startTrackRadio, startTrackListRadio } from "@/lib/radio";
import { useLocalJson } from "@/hooks/useLocalJson";
import { toast } from "@/store/toast";
import { CardGridSkeleton } from "@/components/Skeleton";
import { PlayIcon, RadioIcon, SpinnerIcon } from "@/components/icons";
import type { Track, Genre } from "@/types";

const EMPTY_TRACKS: Track[] = [];

// Mood radios → Last.fm tag (via /home/mood/{tag}), each with its own theme.
const MOOD_STATIONS: {
  tag: string;
  title: string;
  subtitle: string;
  gradient: string;
}[] = [
  { tag: "chill", title: "Chill-Radio", subtitle: "Entspannte Töne für ruhige Momente", gradient: "gradient-aurora" },
  { tag: "focus", title: "Fokus-Radio", subtitle: "Konzentriert bleiben, ohne Ablenkung", gradient: "gradient-blue" },
  { tag: "workout", title: "Workout-Radio", subtitle: "Energie für dein Training", gradient: "gradient-orange" },
  { tag: "party", title: "Party-Radio", subtitle: "Voller Beats für die Nacht", gradient: "gradient-red" },
];

export default function RadioPage() {
  const [recent] = useLocalJson<Track[]>("sf_recent_tracks", EMPTY_TRACKS);
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const genres = useQuery<Genre[]>({
    queryKey: ["genres"],
    queryFn: () => api.genres(),
  });

  async function startMood(tag: string, title: string) {
    setStartingKey(`mood:${tag}`);
    try {
      const tracks = await api.homeMood(tag);
      startTrackListRadio(tracks, title);
    } catch (err) {
      toast.error(
        `${title} konnte nicht gestartet werden — ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setStartingKey(null);
    }
  }

  async function startGenre(id: string, name: string) {
    setStartingKey(`genre:${id}`);
    try {
      const detail = await api.genre(id);
      startTrackListRadio(detail.tracks, `${name}-Radio`);
    } catch (err) {
      toast.error(
        `${name}-Radio konnte nicht gestartet werden — ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setStartingKey(null);
    }
  }

  const personal = recent.slice(0, 12);

  return (
    <div className="flex flex-col gap-8 animate-in">
      {/* Header */}
      <header className="relative overflow-hidden rounded-2xl border border-white/10 gradient-violet p-6 md:p-8 isolate">
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="flex items-center gap-4">
          <span className="flex-shrink-0 w-14 h-14 rounded-full bg-white/15 backdrop-blur flex items-center justify-center glow-sm">
            <RadioIcon width={30} height={30} />
          </span>
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold">Radio</h1>
            <p className="text-white/80 mt-1">
              Endlose Musik, abgestimmt auf deinen Geschmack.
            </p>
          </div>
        </div>
      </header>

      {/* Personal radios — seeded from recently played tracks */}
      <section>
        <h2 className="text-2xl font-bold mb-1">Für dich gemacht</h2>
        <p className="text-muted mb-4">
          Radios auf Basis deiner zuletzt gehörten Titel.
        </p>
        {personal.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-panel/40 px-6 py-8 text-center text-muted">
            Höre ein paar Titel, dann bauen wir hier Radios für dich.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {personal.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => startTrackRadio(track)}
                className="group relative block text-left bg-panel/70 hover:bg-panel-hover border border-white/5 rounded-2xl p-4 transition hover-lift"
              >
                <div className="relative mb-3 overflow-hidden rounded-xl">
                  {track.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.cover}
                      alt=""
                      className="w-full aspect-square object-cover rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full aspect-square rounded-xl gradient-violet opacity-80" />
                  )}
                  <span className="absolute bottom-2 right-2 w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center shadow-lg glow-sm opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition">
                    <PlayIcon width={22} height={22} />
                  </span>
                </div>
                <div className="text-[11px] uppercase tracking-widest text-accent-soft font-bold">
                  Radio
                </div>
                <div className="truncate font-semibold">{track.title}</div>
                <div className="truncate text-sm text-muted">{track.artist}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Mood radios */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Stimmungs-Radios</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {MOOD_STATIONS.map((m) => {
            const busy = startingKey === `mood:${m.tag}`;
            return (
              <button
                key={m.tag}
                type="button"
                disabled={busy}
                onClick={() => startMood(m.tag, m.title)}
                className={`group relative overflow-hidden rounded-2xl border border-white/10 shadow-xl shadow-black/15 hover-lift text-left min-h-[132px] p-5 ${m.gradient}`}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
                <div className="relative z-10 flex flex-col h-full">
                  <h3 className="text-lg font-extrabold drop-shadow">{m.title}</h3>
                  <p className="text-sm text-white/85 mt-1 line-clamp-2">
                    {m.subtitle}
                  </p>
                  <span className="mt-auto pt-4 inline-flex items-center gap-2 text-sm font-semibold">
                    <span className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                      {busy ? (
                        <SpinnerIcon className="animate-spin" width={18} height={18} />
                      ) : (
                        <PlayIcon width={18} height={18} />
                      )}
                    </span>
                    {busy ? "Wird gestartet…" : "Radio starten"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Genre radios */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Genre-Radios</h2>
        {genres.isLoading && <CardGridSkeleton count={12} />}
        {!genres.isLoading && (genres.data?.length ?? 0) === 0 && (
          <p className="text-muted">Keine Genres verfügbar.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {(genres.data ?? []).map((g) => {
            const busy = startingKey === `genre:${g.id}`;
            return (
              <button
                key={String(g.id)}
                type="button"
                disabled={busy}
                onClick={() => startGenre(String(g.id), g.name)}
                className="group relative block overflow-hidden rounded-2xl aspect-[4/3] bg-panel hover-lift transition text-left"
              >
                {g.picture && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.picture}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-60 transition-transform duration-300 group-hover:scale-105"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <span className="absolute bottom-2 left-3 right-3 font-bold text-lg drop-shadow truncate transition-[right] group-hover:right-14">
                  {g.name}
                </span>
                <span className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center shadow-lg glow-sm opacity-0 group-hover:opacity-100 transition">
                  {busy ? (
                    <SpinnerIcon className="animate-spin" width={16} height={16} />
                  ) : (
                    <PlayIcon width={16} height={16} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
