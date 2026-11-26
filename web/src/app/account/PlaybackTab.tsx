"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePlayerStore } from "@/store/player";
import { useConnectStore } from "@/store/connect";
import { api } from "@/lib/api";
import { AUDIO_QUALITY_META, AUDIO_QUALITY_ORDER } from "@/lib/audioIntelligence";
import { toast } from "@/store/toast";
import { ClockIcon, DevicesIcon, RefreshIcon, SlidersIcon, VisualizerIcon } from "@/components/icons";
import type { AudioQuality, PlaybackSettings } from "@/types";
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
    <SettingsCard title="Übergänge" icon={<VisualizerIcon width={18} height={18} />}>
      {isLoading && (
        <div role="status" aria-label="Wiedergabe-Einstellungen werden geladen" className="flex flex-col gap-4">
          <span className="skeleton block h-11 rounded-xl" />
          <span className="skeleton block h-11 rounded-xl" />
        </div>
      )}
      {error && <SectionError label="Die Wiedergabe-Einstellungen" error={error} retrying={isFetching} onRetry={() => void refetch()} />}
      {data && (
        <>
          <SettingsRow label="Crossfade">
            <Switch
              label="Crossfade aktivieren"
              checked={data.crossfade_enabled}
              disabled={updateSettings.isPending}
              onChange={(checked) => updateSettings.mutate({ crossfade_enabled: checked })}
            />
          </SettingsRow>
          <SettingsRow
            label="Dauer des Übergangs"
            description={data.crossfade_enabled ? undefined : "Schalte Crossfade ein, um die Dauer zu ändern."}
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
    <SettingsCard title="Sleep-Timer" icon={<ClockIcon width={18} height={18} />}>
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
          {armed && (
            <p className="mt-1 text-sm text-muted">
              {remainingSec != null ? `Pause um ${endsAt} Uhr` : "Pause, sobald der aktuelle Titel endet"}
            </p>
          )}
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

function ConnectSettings() {
  const enabled = useConnectStore((s) => s.enabled);
  const status = useConnectStore((s) => s.status);
  const error = useConnectStore((s) => s.error);
  const deviceName = useConnectStore((s) => s.deviceName);
  const devices = useConnectStore((s) => s.devices);
  const actions = useConnectStore((s) => s.actions);
  const setEnabled = useConnectStore((s) => s.setEnabled);

  const [draftName, setDraftName] = useState<string | null>(null);
  const inputValue = draftName ?? deviceName;
  const trimmed = inputValue.trim();
  const dirty = draftName !== null && trimmed !== "" && trimmed !== deviceName;

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    try {
      if (actions) await actions.renameDevice(trimmed);
      else useConnectStore.getState().setDeviceNameLocal(trimmed);
      setDraftName(null);
      toast.success("Gerätename aktualisiert.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const statusText =
    status === "connected"
      ? `Verbunden · ${devices.length} ${devices.length === 1 ? "Gerät" : "Geräte"} online`
      : status === "connecting"
        ? "Verbindet mit Connect-Hub…"
        : status === "reconnecting"
          ? "Verbindung wird wiederhergestellt…"
          : status === "disabled"
            ? "Deaktiviert"
            : "Verbindungsfehler";

  return (
    <SettingsCard
      title="Geräte & Connect"
      icon={<DevicesIcon width={18} height={18} />}
    >
      <SettingsRow
        label="Multi-Device Connect"
        description="Dieses Browser-Fenster als steuerbares Gerät anmelden."
      >
        <Switch
          label="Multi-Device Connect aktivieren"
          checked={enabled}
          onChange={(checked) => setEnabled(checked)}
        />
      </SettingsRow>
      <SettingsRow label="Status">
        <div className="flex items-center gap-2 text-xs">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              status === "connected"
                ? "bg-accent"
                : status === "error"
                  ? "bg-danger"
                  : "bg-muted"
            }`}
          />
          <span className="font-mono text-muted">{statusText}</span>
        </div>
      </SettingsRow>
      {error && (
        <div role="alert" className="error-panel mt-3 flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
          <span className="min-w-0">{error}</span>
          {actions && (
            <button type="button" onClick={actions.reconnect} className="action-secondary min-h-8 gap-1.5 px-3 text-xs">
              <RefreshIcon width={14} height={14} />
              Erneut verbinden
            </button>
          )}
        </div>
      )}
      <form onSubmit={(e) => void saveName(e)} className="mt-4 flex flex-wrap items-end gap-2 border-t border-hairline pt-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="connect-device-name" className="label-mono mb-1.5 block text-[10px]">
            Gerätename
          </label>
          <input
            id="connect-device-name"
            type="text"
            value={inputValue}
            onChange={(event) => setDraftName(event.target.value)}
            maxLength={60}
            className="field-input min-h-10 text-sm"
          />
        </div>
        <button type="submit" disabled={!dirty} className="action-primary min-h-10 px-4 text-sm">
          Speichern
        </button>
      </form>
    </SettingsCard>
  );
}

function AudioQualitySettings() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useQuery<PlaybackSettings>({
    queryKey: ["playback-settings"],
    queryFn: api.settings,
  });

  const updateQuality = useMutation({
    mutationFn: (preferred_quality: AudioQuality) => api.updateSettings({ preferred_quality }),
    onSuccess: (next) => {
      qc.setQueryData(["playback-settings"], next);
      toast.success(`Audioqualität auf ${AUDIO_QUALITY_META[next.preferred_quality ?? "high"].label} umgestellt.`);
    },
    onError: (err) => toast.error(`Audioqualität konnte nicht geändert werden: ${errorMessage(err)}`),
  });

  const current: AudioQuality = data?.preferred_quality ?? "high";

  return (
    <SettingsCard
      title="Audioqualität"
      description="Gilt für neue Titel."
      icon={<SlidersIcon width={18} height={18} />}
    >
      {isLoading && <span className="skeleton block h-24 rounded-xl" />}
      {error && (
        <SectionError
          label="Die Qualitäts-Einstellungen"
          error={error}
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      )}
      {data && (
        <div role="radiogroup" aria-label="Streaming-Qualität" className="flex flex-col gap-2">
          {AUDIO_QUALITY_ORDER.map((tier) => {
            const meta = AUDIO_QUALITY_META[tier];
            const selected = current === tier;
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={updateQuality.isPending}
                onClick={() => {
                  if (!selected) updateQuality.mutate(tier);
                }}
                className={`flex min-h-12 items-center justify-between gap-3 rounded-[var(--radius-card)] border px-3.5 py-2.5 text-left transition-colors ${
                  selected
                    ? "border-accent/55 bg-accent/10 text-foreground"
                    : "border-hairline bg-white/[0.02] text-muted hover:border-border hover:text-foreground"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                  <p className="text-xs text-muted">{meta.detail}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] ${
                    selected
                      ? "border-accent bg-accent text-on-accent"
                      : "border-hairline text-subtle"
                  }`}
                >
                  {meta.badge}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}

/** "Wiedergabe" tab: audio quality, crossfade, sleep timer, and multi-device Connect settings. */
export default function PlaybackTab() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <AudioQualitySettings />
      <CrossfadeSettings />
      <SleepTimer />
      <ConnectSettings />
    </div>
  );
}
