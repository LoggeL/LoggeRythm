"use client";

import { useState } from "react";
import Link from "next/link";
import QueryState, { type StatefulQuery } from "@/components/browse/QueryState";
import EmptyState from "@/components/ui/EmptyState";
import { RowListSkeleton } from "@/components/Skeleton";
import { DownloadIcon, DownloadedIcon, HeartIcon, RadioIcon, SpinnerIcon } from "@/components/icons";
import { startSeededRadio } from "@/lib/radio";
import { usePlaylistOffline } from "@/app/playlist/_components/usePlaylistOffline";
import type { Track } from "@/types";
import TabHeader from "./TabHeader";
import TrackCollection from "./TrackCollection";

function LikedRadioButton({ tracks }: { tracks: Track[] }) {
  const [starting, setStarting] = useState(false);
  if (tracks.length === 0) return null;
  async function handleStart() {
    if (starting) return;
    setStarting(true);
    try {
      await startSeededRadio(tracks, "Lieblingssongs-Radio");
    } catch {
      // startSeededRadio already displays toast.error loudly.
    } finally {
      setStarting(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void handleStart()}
      disabled={starting}
      className="action-secondary min-h-9 gap-1.5 px-3 text-xs"
    >
      {starting ? <SpinnerIcon width={15} height={15} className="animate-spin" /> : <RadioIcon width={15} height={15} />}
      {starting ? "Startet…" : "Lieblingssongs-Radio"}
    </button>
  );
}

function LikedOfflineButton({ tracks }: { tracks: Track[] }) {
  const offline = usePlaylistOffline("liked", "Gelikte Titel", tracks, { kind: "liked" });
  if (!offline.supported || tracks.length === 0) return null;
  const label =
    offline.pending === "remove"
      ? "Offline-Download wird entfernt…"
      : offline.pending === "download"
        ? "Wird heruntergeladen…"
        : offline.downloaded
          ? "Offline-Download entfernen"
          : "Offline verfügbar machen";
  return (
    <div className="flex items-center gap-2">
      {offline.progress && (
        <span role="status" className="text-xs tabular-nums text-muted">
          {offline.progress.done}/{offline.progress.total}
        </span>
      )}
      <button
        type="button"
        onClick={() => void offline.toggle()}
        disabled={offline.pending !== null}
        aria-pressed={offline.downloaded}
        aria-busy={offline.pending !== null}
        aria-label={label}
        title={label}
        className="action-secondary min-h-9 px-3 text-xs"
      >
        {offline.pending ? (
          <SpinnerIcon width={15} height={15} className="animate-spin" />
        ) : offline.downloaded ? (
          <DownloadedIcon width={15} height={15} className="text-success" />
        ) : (
          <DownloadIcon width={16} height={16} />
        )}
        {offline.downloaded ? "Offline gespeichert" : "Offline speichern"}
      </button>
    </div>
  );
}

export default function LikedTab({ query }: { query: StatefulQuery<Track[]> }) {
  const tracks = query.data ?? [];
  return (
    <section aria-labelledby="liked-heading">
      <TabHeader id="liked-heading" title="Gelikte Titel" meta={query.data ? `${query.data.length} Titel` : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <LikedRadioButton tracks={tracks} />
          <LikedOfflineButton tracks={tracks} />
        </div>
      </TabHeader>
      <QueryState
        query={query}
        label="Deine gelikten Titel"
        skeleton={<RowListSkeleton />}
        empty={
          <EmptyState
            icon={<HeartIcon width={24} height={24} />}
            title="Du hast noch keine Titel geliked."
            action={
              <Link href="/search" className="action-secondary">
                Lieblingsmusik suchen
              </Link>
            }
          >
            Tippe bei einem Titel auf das Herz, dann findest du ihn hier wieder.
          </EmptyState>
        }
      >
        {(items) => <TrackCollection tracks={items} context="Gelikte Titel" filterLabel="In gelikten Titeln suchen" sortable />}
      </QueryState>
    </section>
  );
}
