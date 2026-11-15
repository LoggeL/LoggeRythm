"use client";

import { useState, type MouseEvent } from "react";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { PlayIcon, SpinnerIcon } from "@/components/icons";
import styles from "./cards.module.css";

/**
 * Round play button floating on a card's artwork. `load` resolves the tracks
 * to play (fetching them if the card only knows an id); a failed or empty
 * load is reported instead of silently doing nothing.
 */
export default function CardPlayButton({
  label,
  load,
  onPlayed,
}: {
  /** Accessible name, e.g. "Discovery von Daft Punk abspielen". */
  label: string;
  load: () => Promise<{ tracks: Track[]; context: string }> | { tracks: Track[]; context: string };
  /** Called once the loaded tracks have started playing. */
  onPlayed?: () => void;
}) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const [busy, setBusy] = useState(false);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const { tracks, context } = await load();
      if (tracks.length === 0) throw new Error(`„${context}“ enthält keine abspielbaren Titel.`);
      playQueue(tracks, 0, context);
      onPlayed?.();
    } catch (error) {
      toast.error(`Wiedergabe konnte nicht gestartet werden: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={styles.fab} data-busy={busy}>
      <button type="button" onClick={handleClick} disabled={busy} aria-busy={busy} aria-label={label} title={label} className="play-fab h-11 w-11 disabled:opacity-100">
        {busy ? <SpinnerIcon width={20} height={20} className="animate-spin" /> : <PlayIcon width={22} height={22} />}
      </button>
    </span>
  );
}
