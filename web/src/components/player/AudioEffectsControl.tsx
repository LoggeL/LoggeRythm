"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQ_PRESET_LABELS,
  PLAYBACK_SPEEDS,
  isAudioEffectsActive,
  type EqPresetKey,
} from "@/lib/audioEffects";
import { AUDIO_QUALITY_META, AUDIO_QUALITY_ORDER } from "@/lib/audioIntelligence";
import { useMe } from "@/hooks/useAuth";
import { useAudioEffectsStore } from "@/store/audioEffects";
import { toast } from "@/store/toast";
import { useUiModalsStore } from "@/store/uiModals";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { SleepTimerSection, useSleepTimerStatus } from "@/components/player/SleepTimerControl";
import Tooltip from "@/components/ui/Tooltip";
import { AudioQualityIcon, CloseIcon, SlidersIcon } from "@/components/icons";
import type { AudioQuality, PlaybackSettings } from "@/types";

const PRESET_ORDER: Exclude<EqPresetKey, "custom">[] = ["flat", "bass", "vocal", "late_night"];

export interface PopoverAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Compute desktop popover coordinates relative to an anchor trigger rect.
 * Right-aligns when opened from right-side controls (e.g. NowPlaying) and
 * left-aligns when opened from left-side PlayerBar badges.
 */
export function computeAudioPopoverPosition({
  viewportWidth,
  viewportHeight,
  popoverWidth,
  popoverHeight,
  anchorRect,
  pad = 12,
}: {
  viewportWidth: number;
  viewportHeight: number;
  popoverWidth: number;
  popoverHeight: number;
  anchorRect: PopoverAnchorRect | null;
  pad?: number;
}): { left: number; top: number } {
  const hasAnchor = Boolean(anchorRect && (anchorRect.width > 0 || anchorRect.height > 0));
  const maxLeft = Math.max(pad, viewportWidth - popoverWidth - pad);
  const left =
    hasAnchor && anchorRect
      ? Math.max(
          pad,
          Math.min(
            anchorRect.right - popoverWidth >= pad ? anchorRect.right - popoverWidth : anchorRect.left,
            maxLeft,
          ),
        )
      : maxLeft;

  const maxTop = Math.max(pad, viewportHeight - popoverHeight - pad);
  const preferredTop =
    hasAnchor && anchorRect ? anchorRect.top - popoverHeight - 10 : viewportHeight - popoverHeight - 96;
  const top =
    preferredTop >= pad
      ? Math.min(preferredTop, maxTop)
      : Math.max(pad, Math.min((anchorRect?.bottom ?? pad) + 8, maxTop));

  return { left, top };
}

export function AudioEffectsTrigger({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const eqEnabled = useAudioEffectsStore((s) => s.eqEnabled);
  const preset = useAudioEffectsStore((s) => s.preset);
  const bands = useAudioEffectsStore((s) => s.bands);
  const compressorEnabled = useAudioEffectsStore((s) => s.compressorEnabled);
  const playbackRate = useAudioEffectsStore((s) => s.playbackRate);
  const open = useUiModalsStore((s) => s.audioEffectsOpen);
  const setOpen = useUiModalsStore((s) => s.setAudioEffectsOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const active = isAudioEffectsActive({ eqEnabled, preset, bands, compressorEnabled, playbackRate });
  const speedChanged = Math.abs(playbackRate - 1) > 0.001;
  const label = active
    ? `Klang & Tempo aktiv (${eqEnabled ? EQ_PRESET_LABELS[preset] : ""}${speedChanged ? ` ${playbackRate}×` : ""})`
    : "Equalizer & Wiedergabegeschwindigkeit";

  return (
    <button
      ref={buttonRef}
      type="button"
      data-audio-effects-trigger=""
      onClick={() => setOpen(!open, buttonRef.current)}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-pressed={active || open}
      title={label}
      className={`action-icon relative ${speedChanged && !compact ? "w-auto px-2 gap-1" : compact ? "h-10 w-10" : "h-9 w-9"} ${
        active ? "text-accent" : ""
      } ${className}`}
    >
      <SlidersIcon width={17} height={17} aria-hidden="true" />
      {speedChanged && !compact && (
        <span className="font-mono text-[10.5px] font-semibold tabular-nums">{playbackRate}×</span>
      )}
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-soft"
        />
      )}
    </button>
  );
}

export function AudioEffectsHost() {
  const open = useUiModalsStore((s) => s.audioEffectsOpen);
  const anchor = useUiModalsStore((s) => s.audioEffectsAnchor);
  const setOpen = useUiModalsStore((s) => s.setAudioEffectsOpen);
  if (!open) return null;
  return <AudioEffectsPopover anchorElement={anchor} onClose={() => setOpen(false)} />;
}

function AudioEffectsPopover({
  anchorElement,
  onClose,
}: {
  anchorElement: HTMLElement | null;
  onClose: () => void;
}) {
  const eqEnabled = useAudioEffectsStore((s) => s.eqEnabled);
  const preset = useAudioEffectsStore((s) => s.preset);
  const bands = useAudioEffectsStore((s) => s.bands);
  const compressorEnabled = useAudioEffectsStore((s) => s.compressorEnabled);
  const playbackRate = useAudioEffectsStore((s) => s.playbackRate);
  const setEqEnabled = useAudioEffectsStore((s) => s.setEqEnabled);
  const applyPreset = useAudioEffectsStore((s) => s.applyPreset);
  const setBandGain = useAudioEffectsStore((s) => s.setBandGain);
  const setCompressorEnabled = useAudioEffectsStore((s) => s.setCompressorEnabled);
  const setPlaybackRate = useAudioEffectsStore((s) => s.setPlaybackRate);
  const reset = useAudioEffectsStore((s) => s.reset);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const settingsQuery = useQuery<PlaybackSettings>({
    queryKey: ["playback-settings"],
    queryFn: api.settings,
    enabled: Boolean(me?.is_approved),
    staleTime: 5 * 60_000,
  });
  const updateQuality = useMutation({
    mutationFn: (preferred_quality: AudioQuality) => api.updateSettings({ preferred_quality }),
    onSuccess: (next) => {
      qc.setQueryData(["playback-settings"], next);
      toast.success(`Audioqualität: ${AUDIO_QUALITY_META[next.preferred_quality ?? "high"].label}`);
    },
    onError: (cause) =>
      toast.error(`Audioqualität konnte nicht geändert werden: ${cause instanceof Error ? cause.message : String(cause)}`),
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const sleep = useSleepTimerStatus();
  const hasQualitySection = Boolean(me?.is_approved && settingsQuery.data);

  useDialogFocus(true, panelRef, onClose);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const position = () => {
      if (window.innerWidth < 640) {
        el.style.left = "";
        el.style.top = "";
        return;
      }
      const { width, height } = el.getBoundingClientRect();
      const rect = anchorElement && anchorElement.isConnected ? anchorElement.getBoundingClientRect() : null;
      const { left, top } = computeAudioPopoverPosition({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        popoverWidth: width,
        popoverHeight: height,
        anchorRect: rect,
      });
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [anchorElement, hasQualitySection, sleep.armed]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorElement?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-audio-effects-trigger]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose, anchorElement]);

  if (typeof document === "undefined") return null;

  const active = isAudioEffectsActive({ eqEnabled, preset, bands, compressorEnabled, playbackRate });

  return createPortal(
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[125] bg-black/50 sm:hidden" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Klang, Tempo & Sleep-Timer"
        className="pop-in scroll-area fixed inset-x-0 bottom-0 z-[130] flex max-h-[84dvh] flex-col gap-3 overflow-y-auto rounded-t-[var(--radius-panel)] border border-hairline bg-panel p-4 shadow-[0_24px_60px_rgb(0_0_0/0.65)] sm:inset-auto sm:w-[23rem] sm:rounded-[var(--radius-panel)]"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-base font-extrabold tracking-tight text-foreground">Klang & Wiedergabe</h2>
          <div className="flex items-center gap-1">
            {active && (
              <button type="button" onClick={reset} className="action-secondary min-h-8 px-2.5 text-xs">
                Zurücksetzen
              </button>
            )}
            <button data-dialog-autofocus type="button" onClick={onClose} aria-label="Klang-Einstellungen schließen" className="action-icon h-9 w-9">
              <CloseIcon width={18} height={18} />
            </button>
          </div>
        </div>

        {/* EQ enable switch + presets */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-foreground">Equalizer</span>
            <button
              type="button"
              role="switch"
              aria-checked={eqEnabled}
              onClick={() => setEqEnabled(!eqEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                eqEnabled ? "border-accent bg-accent" : "border-border bg-white/10"
              }`}
            >
              <span className="sr-only">Equalizer umschalten</span>
              <span
                aria-hidden="true"
                className={`h-4 w-4 rounded-full transition-transform ${
                  eqEnabled ? "translate-x-5 bg-on-accent" : "translate-x-1 bg-foreground"
                }`}
              />
            </button>
          </div>

          <div role="group" aria-label="EQ-Presets" className="flex flex-wrap gap-1.5">
            {PRESET_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={eqEnabled && preset === key}
                onClick={() => applyPreset(key)}
                className="filter-chip min-h-8 px-2.5 text-xs"
              >
                {EQ_PRESET_LABELS[key]}
              </button>
            ))}
            {preset === "custom" && eqEnabled && (
              <span className="filter-chip min-h-8 px-2.5 text-xs" data-active="true">
                {EQ_PRESET_LABELS.custom}
              </span>
            )}
          </div>

          <div className={`space-y-2 rounded-[var(--radius-card)] border border-hairline bg-white/[0.025] p-2.5 ${eqEnabled ? "" : "opacity-55"}`}>
            {EQ_BANDS.map((band, idx) => {
              const value = bands[idx];
              const pct = ((value - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB)) * 100;
              return (
                <label key={band.id} className="grid grid-cols-[3.6rem_minmax(0,1fr)_3.2rem] items-center gap-2.5 text-xs">
                  <span className="font-mono text-[11px] text-muted">{band.label}</span>
                  <input
                    type="range"
                    min={EQ_MIN_DB}
                    max={EQ_MAX_DB}
                    step={0.5}
                    value={value}
                    onChange={(event) => setBandGain(idx, Number(event.target.value))}
                    aria-label={`Equalizer ${band.label}`}
                    aria-valuetext={`${value > 0 ? "+" : ""}${value} Dezibel`}
                    style={{
                      background: `linear-gradient(to right, var(--accent-soft) ${pct}%, rgb(244 240 230 / 0.16) ${pct}%)`,
                    }}
                  />
                  <span className="text-right font-mono text-[11px] tabular-nums text-foreground">
                    {value > 0 ? `+${value}` : value} dB
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Late-Night Compressor */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Nachtmodus-Kompressor</p>
            <p className="text-xs text-muted">Gleicht laute Spitzen und leise Passagen sanft an.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={compressorEnabled}
            onClick={() => setCompressorEnabled(!compressorEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
              compressorEnabled ? "border-accent bg-accent" : "border-border bg-white/10"
            }`}
          >
            <span className="sr-only">Nachtmodus-Kompressor umschalten</span>
            <span
              aria-hidden="true"
              className={`h-4 w-4 rounded-full transition-transform ${
                compressorEnabled ? "translate-x-5 bg-on-accent" : "translate-x-1 bg-foreground"
              }`}
            />
          </button>
        </div>

        {/* Playback Speed */}
        <div className="space-y-2 border-t border-hairline pt-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Geschwindigkeit</span>
            <span className="font-mono text-xs tabular-nums text-muted">{playbackRate}×</span>
          </div>
          <div role="group" aria-label="Wiedergabegeschwindigkeit" className="grid grid-cols-6 gap-1">
            {PLAYBACK_SPEEDS.map((rate) => (
              <button
                key={rate}
                type="button"
                aria-pressed={Math.abs(playbackRate - rate) < 0.001}
                onClick={() => setPlaybackRate(rate)}
                className="filter-chip min-h-8 px-1 font-mono text-[11px] tabular-nums"
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>

        {/* Streaming Audio Quality */}
        {me?.is_approved && settingsQuery.data && (
          <div className="space-y-2 border-t border-hairline pt-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Audioqualität</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
                <AudioQualityIcon
                  quality={settingsQuery.data.preferred_quality ?? "high"}
                  width={13}
                  height={13}
                  aria-hidden="true"
                />
                {AUDIO_QUALITY_META[settingsQuery.data.preferred_quality ?? "high"].badge}
              </span>
            </div>
            <div role="group" aria-label="Audioqualität wählen" className="grid grid-cols-3 gap-1.5">
              {AUDIO_QUALITY_ORDER.map((tier) => {
                const selected = (settingsQuery.data?.preferred_quality ?? "high") === tier;
                return (
                  <Tooltip
                    key={tier}
                    label={AUDIO_QUALITY_META[tier].label}
                    detail={AUDIO_QUALITY_META[tier].detail}
                    className="w-full"
                  >
                    <button
                      type="button"
                      disabled={updateQuality.isPending}
                      aria-pressed={selected}
                      onClick={() => {
                        if (!selected) updateQuality.mutate(tier);
                      }}
                      className="filter-chip min-h-8 w-full justify-center gap-1.5 px-2 font-mono text-[11px]"
                    >
                      <AudioQualityIcon quality={tier} width={13} height={13} aria-hidden="true" />
                      {AUDIO_QUALITY_META[tier].badge}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}

        <SleepTimerSection />
      </div>
    </>,
    document.body,
  );
}
