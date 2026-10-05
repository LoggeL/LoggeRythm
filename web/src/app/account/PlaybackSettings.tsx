"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { ClockIcon, VisualizerIcon } from "@/components/icons";
import type { PlaybackSettings } from "@/types";
import styles from "./account.module.css";

const SLEEP_PRESETS = [15, 30, 45, 60];

export function SleepTimerSection() {
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAfterTrack = usePlayerStore((s) => s.setSleepAfterTrack);

  // Tick once a second while armed so the remaining time counts down live.
  const [now, setNow] = useState(() => Date.now());
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  function selectTimer(minutes: number | null) {
    setNow(Date.now());
    setSelectedPreset(minutes);
    setSleepTimer(minutes);
  }
  useEffect(() => {
    if (sleepAt == null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [sleepAt]);

  const remainingSec =
    sleepAt == null ? null : Math.max(0, Math.round((sleepAt - now) / 1000));
  const armed = sleepAt != null || sleepAfterTrack;

  return (
    <section className={`${styles.panelCard} ${styles.sleepCard}`}>
      <div className={styles.sleepContent}>
        <div>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionIcon} aria-hidden>
              <ClockIcon />
            </span>
            <div>
              <span className={styles.panelKicker}>Nachtmodus</span>
              <h2>Sleep-Timer</h2>
            </div>
          </div>
          <p className={styles.sectionDescription}>
            Wähle, wann die Wiedergabe automatisch pausiert.
          </p>

          <div className={styles.presetGrid} aria-label="Sleep-Timer auswählen">
            <button
              type="button"
              onClick={() => selectTimer(null)}
              aria-pressed={!armed}
              className={`${styles.presetButton} ${
                !armed ? styles.presetActive : ""
              }`}
            >
              Aus
            </button>
            {SLEEP_PRESETS.map((m) => {
              const active = sleepAt != null && selectedPreset === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectTimer(m)}
                  aria-pressed={active}
                  className={`${styles.presetButton} ${
                    active ? styles.presetActive : ""
                  }`}
                >
                  <strong>{m}</strong>
                  <span>min</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSleepAfterTrack(true)}
              aria-pressed={sleepAfterTrack}
              className={`${styles.presetButton} ${styles.presetTrackEnd} ${
                sleepAfterTrack ? styles.presetActive : ""
              }`}
            >
              Ende des Titels
            </button>
          </div>
        </div>

        <div className={styles.timerDial} data-armed={armed} role="timer" aria-live="off" aria-label="Sleep-Timer">
          <ClockIcon className={styles.timerIcon} />
          {remainingSec != null ? (
            <>
              <strong>
                {Math.floor(remainingSec / 60)}:
                {String(remainingSec % 60).padStart(2, "0")}
              </strong>
              <span>bis zur Pause</span>
            </>
          ) : sleepAfterTrack ? (
            <>
              <strong>Titelende</strong>
              <span>nach diesem Titel</span>
            </>
          ) : (
            <>
              <strong>∞</strong>
              <span>läuft weiter</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function PlaybackSettingsSection() {
  const qc = useQueryClient();
  const [draftDuration, setDraftDuration] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery<PlaybackSettings>({
    queryKey: ["playback-settings"],
    queryFn: api.settings,
  });

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<PlaybackSettings>) => api.updateSettings(patch),
    onSuccess: (next, patch) => {
      qc.setQueryData(["playback-settings"], next);
      if (patch.crossfade_duration_sec !== undefined) setDraftDuration(null);
      toast.success("Wiedergabe aktualisiert.");
    },
    onError: (err) =>
      toast.error(
        err instanceof Error
          ? err.message
          : "Wiedergabe konnte nicht aktualisiert werden.",
      ),
  });

  const enabled = data?.crossfade_enabled;
  const duration = draftDuration ?? data?.crossfade_duration_sec;

  return (
    <section className={`${styles.panelCard} ${styles.playbackCard}`}>
      <div className={styles.panelHeaderRow}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon} aria-hidden>
            <VisualizerIcon />
          </span>
          <div>
            <span className={styles.panelKicker}>Wiedergabe</span>
            <h2>Crossfade</h2>
          </div>
        </div>

        {data && <label className={styles.switchLabel}>
          <span>{enabled ? "Aktiv" : "Aus"}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Crossfade aktivieren"
            checked={data.crossfade_enabled}
            disabled={updateSettings.isPending}
            onChange={(e) =>
              updateSettings.mutate({ crossfade_enabled: e.target.checked })
            }
            className={styles.switchInput}
          />
          <span className={styles.switchTrack} aria-hidden>
            <span className={styles.switchThumb} />
          </span>
        </label>}
      </div>

      <p className={styles.sectionDescription}>
        Blende den nächsten Titel ein, bevor der aktuelle endet.
      </p>

      {isLoading && <p className={styles.stateMessage}>Lädt…</p>}
      {error && (
        <p className="error-panel" role="alert">
          {error instanceof Error
            ? error.message
            : "Einstellungen konnten nicht geladen werden."}
        </p>
      )}

      {data && (
        <div className={styles.crossfadeControl} data-enabled={enabled}>
          <div className={styles.rangeBlock}>
            <div className={styles.rangeLabels}>
              <span>Crossfade-Dauer</span>
              <span>{duration} Sekunden</span>
            </div>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={duration}
              disabled={!enabled || updateSettings.isPending}
              onChange={(event) => setDraftDuration(Number(event.target.value))}
              aria-label="Crossfade-Dauer"
              className={styles.crossfadeRange}
            />
            <div className={styles.rangeScale}>
              <span>Direkt</span>
              <span>12 s</span>
            </div>
            {draftDuration !== null && draftDuration !== data.crossfade_duration_sec && (
              <div className={styles.durationActions}>
                <button type="button" onClick={() => setDraftDuration(null)} disabled={updateSettings.isPending} className="action-secondary">Verwerfen</button>
                <button type="button" onClick={() => updateSettings.mutate({ crossfade_duration_sec: draftDuration })} disabled={updateSettings.isPending} className="action-primary">
                  {updateSettings.isPending ? "Speichert…" : "Dauer speichern"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
