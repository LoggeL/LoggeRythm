"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { ClockIcon, VisualizerIcon } from "@/components/icons";
import type { PlaybackSettings } from "@/types";
import { errorMessage, SectionError, SettingsCard, SettingsRow, Switch } from "./presentation";

const SLEEP_PRESETS = [15, 30, 45, 60];
const MAX_CROSSFADE_SEC = 12;

function CrossfadeSettings() {
  const qc = useQueryClient();
  const [draftDuration, setDraftDuration] = useState<number | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery<PlaybackSettings>({
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
    onError: (err) => toast.error(`Wiedergabe konnte nicht aktualisiert werden: ${errorMessage(err)}`),
  });

  const duration = draftDuration ?? data?.crossfade_duration_sec ?? 0;
  const dirty = data !== undefined && draftDuration !== null && draftDuration !== data.crossfade_duration_sec;

  return (
    <SettingsCard title="Übergänge" description="Blende den nächsten Titel ein, bevor der aktuelle endet." icon={<VisualizerIcon width={18} height={18} />}>
      {isLoading && (
        <div role="status" aria-label="Wiedergabe-Einstellungen werden geladen" className="flex flex-col gap-4">
          <span className="skeleton block h-11 rounded-xl" />
          <span className="skeleton block h-11 rounded-xl" />
        </div>
      )}
      {error && <SectionError label="Die Wiedergabe-Einstellungen" error={error} retrying={isFetching} onRetry={() => void refetch()} />}
      {data && (
        <>
          <SettingsRow label="Crossfade" description="Titel gehen fließend ineinander über.">
            <Switch
              label="Crossfade aktivieren"
              checked={data.crossfade_enabled}
              disabled={updateSettings.isPending}
              onChange={(checked) => updateSettings.mutate({ crossfade_enabled: checked })}
            />
          </SettingsRow>
          <SettingsRow
            label="Dauer des Übergangs"
            description={data.crossfade_enabled ? "Wie lange sich zwei Titel überlappen." : "Schalte Crossfade ein, um die Dauer zu ändern."}
          >
            <div className="flex w-full flex-col gap-2 sm:w-64">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={MAX_CROSSFADE_SEC}
                  step={1}
                  value={duration}
                  disabled={!data.crossfade_enabled || updateSettings.isPending}
                  onChange={(event) => setDraftDuration(Number(event.target.value))}
                  aria-label="Crossfade-Dauer"
                  aria-valuetext={`${duration} Sekunden`}
                  className="h-1.5 min-w-0 flex-1"
                  style={{
                    background: `linear-gradient(to right, var(--accent) ${(duration / MAX_CROSSFADE_SEC) * 100}%, var(--hairline) ${(duration / MAX_CROSSFADE_SEC) * 100}%)`,
                  }}
                />
                <output className="w-12 text-right text-sm font-semibold tabular-nums">{duration} s</output>
              </div>
              <div aria-hidden="true" className="flex justify-between pr-[3.75rem] text-[11px] text-subtle">
                <span>Direkt</span>
                <span>{MAX_CROSSFADE_SEC} s</span>
              </div>
            </div>
          </SettingsRow>
          {dirty && draftDuration !== null && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-hairline pt-4">
              <button type="button" onClick={() => setDraftDuration(null)} disabled={updateSettings.isPending} className="action-secondary">
                Verwerfen
              </button>
              <button
                type="button"
                onClick={() => updateSettings.mutate({ crossfade_duration_sec: draftDuration })}
                disabled={updateSettings.isPending}
                className="action-primary"
              >
                {updateSettings.isPending ? "Speichert…" : "Dauer speichern"}
              </button>
            </div>
          )}
        </>
      )}
    </SettingsCard>
  );
}

function SleepTimer() {
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

  const remainingSec = sleepAt == null ? null : Math.max(0, Math.round((sleepAt - now) / 1000));
  const armed = sleepAt != null || sleepAfterTrack;
  const endsAt = sleepAt == null ? null : new Date(sleepAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <SettingsCard title="Sleep-Timer" description="Die Wiedergabe pausiert automatisch – praktisch zum Einschlafen." icon={<ClockIcon width={18} height={18} />}>
      <div
        role="timer"
        aria-live="off"
        aria-label="Sleep-Timer"
        className={`flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border px-4 py-4 transition-colors ${
          armed ? "border-accent/40 bg-accent/10" : "border-hairline bg-white/[0.03]"
        }`}
      >
        <div className="min-w-0">
          <p className={`font-display text-3xl font-bold tabular-nums tracking-tight ${armed ? "text-foreground" : "text-subtle"}`}>
            {remainingSec != null
              ? `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`
              : sleepAfterTrack
                ? "Titelende"
                : "Aus"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {remainingSec != null
              ? `Pause um ${endsAt} Uhr`
              : sleepAfterTrack
                ? "Pause, sobald der aktuelle Titel endet"
                : "Die Musik läuft weiter, bis du sie stoppst."}
          </p>
        </div>
        {armed && (
          <button type="button" onClick={() => selectTimer(null)} className="action-secondary">
            Timer beenden
          </button>
        )}
      </div>

      <div role="group" aria-label="Sleep-Timer auswählen" className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => selectTimer(null)} aria-pressed={!armed} className="filter-chip min-h-11 sm:min-h-9">
          Aus
        </button>
        {SLEEP_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => selectTimer(minutes)}
            aria-pressed={sleepAt != null && selectedPreset === minutes}
            className="filter-chip min-h-11 sm:min-h-9"
          >
            {minutes} min
          </button>
        ))}
        <button type="button" onClick={() => setSleepAfterTrack(true)} aria-pressed={sleepAfterTrack} className="filter-chip min-h-11 sm:min-h-9">
          Ende des Titels
        </button>
      </div>
    </SettingsCard>
  );
}

/** "Wiedergabe" tab: crossfade and sleep timer. */
export default function PlaybackTab() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <CrossfadeSettings />
      <SleepTimer />
    </div>
  );
}
