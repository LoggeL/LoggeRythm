"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useCoverColors } from "@/hooks/useCoverColors";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useLocalJson } from "@/hooks/useLocalJson";
import { hiResCover } from "@/lib/cover";
import { fullscreenTheme } from "@/lib/fullscreenTheme";
import { INITIAL_VISUALIZER_PREFERENCES, validateVisualizerPreferences, type VisualizerPreferences } from "@/lib/visualizerScenes";
import { useVisualizerScene } from "@/hooks/useVisualizerScene";
import { ChevronDownIcon } from "@/components/icons";
import LikeButton from "@/components/LikeButton";
import Scrubber from "@/components/player/Scrubber";
import FullscreenVisualizer, { type VisualizerStatus } from "@/components/FullscreenVisualizer";
import SceneVisualizer from "@/components/SceneVisualizer";
import Stage, { VisualizerControls } from "./Stage";
import QueuePanel from "./QueuePanel";
import SimilarPanel from "./SimilarPanel";
import LyricsPanel from "./LyricsPanel";
import { TrackHeading } from "./TrackMeta";
import { TransportRow, VolumeRow } from "./Controls";
import { useSwipeToClose } from "./useSwipeToClose";
import styles from "./fullscreen.module.css";

/** The content beside (wide) or instead of (narrow) the artwork stage. */
type PanelKey = "lyrics" | "queue" | "similar";
/** `stage` only exists on narrow screens, where one view shows at a time. */
type ViewKey = "stage" | PanelKey;

const PANELS: { key: PanelKey; label: string }[] = [
  { key: "lyrics", label: "Songtext" },
  { key: "queue", label: "Warteschlange" },
  { key: "similar", label: "Ähnliche Titel" },
];
const PANEL_KEYS = PANELS.map((panel) => panel.key);

/** From this width the stage and a panel sit side by side. */
const SPLIT_QUERY = "(min-width: 1024px)";

function subscribeSplit(listener: () => void) {
  const media = window.matchMedia(SPLIT_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const splitSnapshot = () => window.matchMedia(SPLIT_QUERY).matches;
const serverSplitSnapshot = () => false;

function validatePanel(value: unknown): PanelKey {
  if (!PANEL_KEYS.includes(value as PanelKey)) {
    throw new Error(`Gespeicherte Vollbild-Ansicht ist ungültig: ${JSON.stringify(value)}. Erwartet: ${PANEL_KEYS.join(", ")}.`);
  }
  return value as PanelKey;
}

/**
 * Fullscreen now-playing view, laid out as three bands that together use the
 * whole screen: a slim header, the body, and a full-width transport console.
 *
 * Wide screens split the body: the artwork stage with the track heading on
 * the left, and one panel (lyrics, queue or similar tracks) on the right —
 * the choice is remembered. Narrow screens are a sheet (slides up, swipe down
 * to close) showing either the stage or one panel, with the heading folded
 * into the console. Backdrop and accents follow the cover art.
 */
export default function NowPlaying({ onClose }: { onClose: () => void }) {
  const track = usePlayerStore(currentTrack);
  const error = usePlayerStore((s) => s.error);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const queueContext = usePlayerStore((s) => s.queueContext);
  const palette = useCoverColors(track?.cover);
  const split = useSyncExternalStore(subscribeSplit, splitSnapshot, serverSplitSnapshot);

  const [storedPanel, setStoredPanel] = useLocalJson<PanelKey>("player:fullscreen-panel", "lyrics");
  const panel = validatePanel(storedPanel);
  const [stageOnNarrow, setStageOnNarrow] = useState(true);
  const view: ViewKey = !split && stageOnNarrow ? "stage" : panel;

  const [storedPreferences, setStoredPreferences] = useLocalJson<VisualizerPreferences>("player:visualizer", INITIAL_VISUALIZER_PREFERENCES);
  const preferences = validateVisualizerPreferences(storedPreferences);
  const [signalStatus, setSignalStatus] = useState<VisualizerStatus>("waiting");
  const sceneChoice = useVisualizerScene({ track, preference: preferences.scene, listening: preferences.enabled && isPlaying });

  const rootRef = useRef<HTMLDivElement>(null);
  const albumRef = useRef<HTMLDivElement>(null);
  const swipeHandlers = useSwipeToClose(rootRef, onClose);
  useDialogFocus(!!track, rootRef, onClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const tabs: { key: ViewKey; label: string }[] = split ? PANELS : [{ key: "stage", label: "Jetzt läuft" }, ...PANELS];

  const select = (key: ViewKey) => {
    if (key === "stage") {
      setStageOnNarrow(true);
      return;
    }
    setStageOnNarrow(false);
    setStoredPanel(key);
  };

  const moveTab = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = tabs.findIndex((item) => item.key === view);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const key = tabs[next].key;
    select(key);
    rootRef.current?.querySelector<HTMLButtonElement>(`#now-playing-tab-${key}`)?.focus();
  };

  if (!track) return null;

  const tablist = (
    <div data-np-scroll role="tablist" aria-label="Playeransicht" className="no-scrollbar flex flex-shrink-0 gap-6 overflow-x-auto border-b border-hairline max-lg:-mx-5 max-lg:px-5">
      {tabs.map(({ key, label }) => {
        const active = view === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`now-playing-tab-${key}`}
            aria-controls="now-playing-panel"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(key)}
            onKeyDown={moveTab}
            className={`font-display relative -mb-px min-h-11 whitespace-nowrap border-b-2 pb-2 text-[17px] font-bold tracking-tight transition-colors lg:text-xl ${
              active ? "border-[var(--accent-soft)] text-foreground" : "border-transparent text-foreground/45 hover:text-foreground/80"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const panelContent = (
    <>
      {view === "lyrics" && <LyricsPanel track={track} />}
      {view === "queue" && <QueuePanel onClose={onClose} />}
      {view === "similar" && <SimilarPanel seedId={track.id} onClose={onClose} />}
    </>
  );

  const visualizerControls = (
    <VisualizerControls preferences={preferences} choice={sceneChoice} signalStatus={signalStatus} onChange={setStoredPreferences} />
  );
  const stage = <Stage track={track} albumRef={albumRef} preferences={preferences} footer={split ? undefined : visualizerControls} />;
  const showVisualizer = preferences.enabled && (split || view === "stage");

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Vollbildplayer"
      {...swipeHandlers}
      style={fullscreenTheme(palette) as CSSProperties}
      className={`${styles.scope} fixed inset-0 z-[80] flex h-dvh animate-[sheetUp_.34s_var(--ease-out)] flex-col overflow-hidden bg-backdrop pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] motion-reduce:animate-none lg:animate-[fadeIn_.28s_var(--ease-out)]`}
    >
      {track.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hiResCover(track.cover)} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-3xl saturate-150" />
      )}
      <div aria-hidden className={`${styles.backdrop} pointer-events-none absolute inset-0`} />
      {/* Spans the whole player, behind header, body and console; composed around the artwork. */}
      {showVisualizer && (sceneChoice.scene === "aura" ? (
        <FullscreenVisualizer
          isPlaying={isPlaying}
          anchorRef={albumRef}
          palette={palette}
          onStatusChange={setSignalStatus}
          className="pointer-events-none absolute inset-0 block h-full w-full"
        />
      ) : (
        <SceneVisualizer
          scene={sceneChoice.scene}
          isPlaying={isPlaying}
          anchorRef={albumRef}
          palette={palette}
          trackId={track.id}
          onStatusChange={setSignalStatus}
          className="pointer-events-none absolute inset-0 block h-full w-full"
        />
      ))}

      {/* Drag affordance for the swipe-down gesture (touch layouts) */}
      <div aria-hidden className="relative mx-auto mt-2 h-1 w-9 flex-shrink-0 rounded-full bg-white/30 lg:hidden" />

      <header className="relative flex h-14 flex-shrink-0 items-center gap-3 px-3 lg:h-16 lg:px-6">
        <button data-dialog-autofocus type="button" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)" className="action-icon h-11 w-11 text-foreground">
          <ChevronDownIcon width={26} height={26} />
        </button>
        <p className="flex min-w-0 flex-1 items-baseline gap-2.5 max-lg:flex-col max-lg:items-center max-lg:gap-0 max-lg:pr-11 max-lg:text-center">
          <span className="label-mono flex-shrink-0">{queueContext ? "Wiedergabe aus" : "Jetzt läuft"}</span>
          {queueContext && <span className="max-w-full truncate text-sm font-semibold">{queueContext}</span>}
        </p>
      </header>

      {error && (
        <p role="alert" className="error-panel relative mx-5 mb-3 max-h-28 flex-shrink-0 overflow-y-auto lg:mx-10">
          {error}
        </p>
      )}

      {split ? (
        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-10 px-10 pb-2 xl:gap-16 xl:px-14">
          <div className="flex min-h-0 flex-col gap-6">
            {stage}
            <div className="flex-shrink-0">
              <TrackHeading track={track} onNavigate={onClose} variant="display" />
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            {tablist}
            <div role="tabpanel" id="now-playing-panel" aria-labelledby={`now-playing-tab-${view}`} className="flex min-h-0 flex-1 flex-col pt-3">
              {panelContent}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col px-5">
          {tablist}
          <div role="tabpanel" id="now-playing-panel" aria-labelledby={`now-playing-tab-${view}`} className="flex min-h-0 flex-1 flex-col pt-3">
            {view === "stage" ? stage : panelContent}
          </div>
        </div>
      )}

      {/* Console: seek across the full width, transport centred beneath it. */}
      <div className={`${styles.console} like-celebration-surface relative flex-shrink-0 px-5 pb-4 pt-3 lg:px-10 lg:pb-6 lg:pt-4 xl:px-14`}>
        {!split && (
          <div className="mb-3">
            <TrackHeading track={track} onNavigate={onClose} variant="row" thumbnail={view !== "stage"} />
          </div>
        )}
        <Scrubber />
        {split ? (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6">
            <div className="flex min-w-0 items-center gap-1">
              <LikeButton key={track.id} track={track} />
              {visualizerControls}
            </div>
            <TransportRow />
            <div className="flex justify-end">
              <VolumeRow />
            </div>
          </div>
        ) : (
          <TransportRow className="mt-1" />
        )}
      </div>
    </div>
  );
}
