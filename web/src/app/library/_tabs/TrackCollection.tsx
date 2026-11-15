"use client";

import { useState } from "react";
import TrackRow from "@/components/TrackRow";
import { PlayIcon, ShuffleIcon } from "@/components/icons";
import { usePlayerStore } from "@/store/player";
import type { Track } from "@/types";
import ListFilter, { NoFilterMatch } from "./ListFilter";
import { FILTER_THRESHOLD, matchesFilter } from "./filter";

type SortKey = "added" | "title" | "artist";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Zuletzt hinzugefügt" },
  { key: "title", label: "Titel A bis Z" },
  { key: "artist", label: "Künstler A bis Z" },
];

function sortTracks(tracks: Track[], sort: SortKey): Track[] {
  if (sort === "added") return tracks;
  return [...tracks].sort((a, b) => a[sort].localeCompare(b[sort], "de"));
}

/**
 * A playable track list with play-all, shuffle and, for longer lists, a
 * filter and sort order. Playback always queues what is currently listed.
 * `context` names the queue, e.g. "Gelikte Titel".
 */
export default function TrackCollection({ tracks, context, filterLabel, sortable = false }: { tracks: Track[]; context: string; filterLabel: string; sortable?: boolean }) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<SortKey>("added");
  const listed = sortTracks(
    tracks.filter((track) => matchesFilter(term, track.title, track.artist, track.album)),
    sort,
  );
  const long = tracks.length > FILTER_THRESHOLD;

  function playShuffled() {
    playQueue(listed, Math.floor(Math.random() * listed.length), context);
    // playQueue keeps the player's shuffle setting; switch it on if it was off.
    const player = usePlayerStore.getState();
    if (!player.shuffle) player.toggleShuffle();
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" className="play-fab h-12 w-12" aria-label={`${context} abspielen`} disabled={listed.length === 0} onClick={() => playQueue(listed, 0, context)}>
          <PlayIcon width={20} height={20} />
        </button>
        <button type="button" className="action-icon" aria-label={`${context} zufällig abspielen`} title="Zufällig abspielen" disabled={listed.length === 0} onClick={playShuffled}>
          <ShuffleIcon width={20} height={20} />
        </button>
        {long && (
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 max-sm:basis-full">
            <ListFilter label={filterLabel} value={term} onChange={setTerm} className="flex-1 sm:max-w-64" />
            {sortable && (
              <select
                aria-label="Titel sortieren"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className="field-input w-auto shrink-0 rounded-full py-2 pl-4 pr-3 text-xs font-semibold sm:min-h-10"
              >
                {SORTS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
      {listed.length === 0 ? (
        <NoFilterMatch term={term} onReset={() => setTerm("")} />
      ) : (
        <div className="flex flex-col">
          {listed.map((track, index) => (
            <TrackRow key={`${track.id}-${index}`} track={track} index={index} onPlay={() => playQueue(listed, index, context)} />
          ))}
        </div>
      )}
    </>
  );
}
