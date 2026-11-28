import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";

const outgoingTrack = {
  id: "track-out",
  title: "Midnight Signal",
  artist: "Nora Vance",
  album: "Night Shift",
  album_id: "alb-out",
  cover: "https://cdn.example.test/cover-out.jpg",
  duration_sec: 210,
};

const incomingTrack = {
  id: "track-in",
  title: "Solar Drift",
  artist: "Kaito Waves",
  album: "Daybreak",
  album_id: "alb-in",
  cover: "https://cdn.example.test/cover-in.jpg",
  duration_sec: 198,
};

const fixture = {
  track: outgoingTrack,
  transition: null,
  lastTransitionEnd: null,
  display: { phase: "idle" },
};
globalThis.__transitionUiFixture = fixture;

const reactUrl = import.meta.resolve("react");
const noopComponent = moduleUrl("export default function Stub() { return null; }");

const stubs = {
  "@/hooks/useHydratedTrack": moduleUrl("export const useHydratedTrack = track => track;"),
  react: reactUrl,
  "react-dom": import.meta.resolve("react-dom"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link({ href, children, transitionTypes: _t, ...props }) { return createElement("a", { ...props, href }, children); }`,
  ),
  "@tanstack/react-query": moduleUrl(
    "export function useQuery() { return { data: { preferred_quality: 'high' } }; }",
  ),
  "@/lib/api": moduleUrl("export const api = { settings: async () => ({}) };"),
  "@/hooks/useAuth": moduleUrl(
    "export const useMe = () => ({ data: { id: 'u1', is_approved: true } });",
  ),
  "@/store/player": moduleUrl(`
    const state = () => ({
      index: 0,
      queue: [globalThis.__transitionUiFixture.track],
      isPlaying: true,
      isBuffering: false,
      shuffle: false,
      repeat: "off",
      currentTime: 204,
      duration: 210,
      volume: 0.8,
      muted: false,
      queueOpen: false,
      lyricsOpen: false,
      nowPlayingOpen: false,
      error: null,
      preloadError: null,
      transition: globalThis.__transitionUiFixture.transition,
      lastTransitionEnd: globalThis.__transitionUiFixture.lastTransitionEnd,
      toggle() {},
      next() {},
      prev() {},
      toggleShuffle() {},
      cycleRepeat() {},
      setVolume() {},
      toggleMute() {},
      toggleQueue() {},
      toggleLyrics() {},
    });
    export const currentTrack = () => globalThis.__transitionUiFixture.track;
    export const usePlayerStore = Object.assign((sel) => sel(state()), {
      getState: state,
      subscribe: () => () => {},
    });
  `),
  "@/store/connect": moduleUrl(
    "export const canControlActiveVolume = () => true; export const useConnectStore = (sel) => sel({ enabled: false, status: 'disabled', activeDeviceId: null, deviceId: 'd1', devices: [] });",
  ),
  "@/store/party": moduleUrl(
    "export const canControlPartyPlayback = () => true; export const usePartyStore = (sel) => sel({ active: false, detached: false, isHost: false, guestsCanControl: true, hostName: '' });",
  ),
  "@/store/uiModals": moduleUrl(
    "const s = { audioEffectsOpen: false, setAudioEffectsOpen() {} }; export const useUiModalsStore = Object.assign((sel) => sel(s), { getState: () => s });",
  ),
  "@/store/audioEffects": moduleUrl(
    "const s = { eqEnabled: false, preset: 'flat', bands: [0, 0, 0, 0, 0], compressorEnabled: false, playbackRate: 1 }; export const useAudioEffectsStore = (sel) => sel(s);",
  ),
  "@/components/LikeButton": noopComponent,
  "@/components/EqualizerBars": noopComponent,
  "@/components/now-playing/NowPlaying": noopComponent,
  "@/components/TrackContext": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function TrackContext({ children, className }) { return createElement("div", { className }, children); }`,
  ),
  "@/components/TrackTitle": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function TrackTitle({ track, className }) { return createElement("span", { className }, track.title); }`,
  ),
  "@/components/TrackMenu": noopComponent,
  "@/components/CacheMarker": noopComponent,
  "@/components/ArtistLinks": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function ArtistLinks({ track, className }) { return createElement("span", { className }, track.artist); }`,
  ),
  "@/components/CoverPlaceholder": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function CoverPlaceholder({ className }) { return createElement("span", { className, "data-cover-placeholder": "true" }); }`,
  ),
  "@/components/BassReactiveArtwork": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function BassReactiveArtwork({ children, className }) { return createElement("div", { className, "data-bass-reactive": "true" }, children); }`,
  ),
  "@/components/ui/Cover": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function Cover({ src, alt, className }) { return src ? createElement("img", { src, alt: alt ?? "", className }) : createElement("span", { className, "data-cover-placeholder": "true" }); }`,
  ),
  "@/components/player/Scrubber": moduleUrl(
    "export default function Scrubber() { return null; } export function ProgressLine() { return null; } export const rangeFill = () => '';",
  ),
  "@/components/player/DeviceSelector": moduleUrl("export function DeviceSelectorTrigger() { return null; }"),
  "@/components/player/SleepTimerControl": moduleUrl(
    "export function useSleepTimerStatus() { return { sleepAt: null, sleepAfterTrack: false, armed: false, remaining: null, statusLabel: 'Aus', endsAt: null }; }",
  ),
  "@/components/player/PictureInPictureButton": noopComponent,
  "@/components/player/ActiveOutputBanner": noopComponent,
  "@/components/player/usePlayerSideEffects": moduleUrl("export const setNowPlayingOpen = () => {};"),
  "@/lib/format": moduleUrl("export const formatTime = () => '3:24';"),
  "@/lib/morph": moduleUrl("export const NAV_FORWARD = [];"),
  "@/lib/cover": moduleUrl("export const hiResCover = (u) => u;"),
  "@/lib/trackArtists": moduleUrl("export const trackArtistLabel = (t) => t.artist;"),
  "@/lib/visualizerScenes": moduleUrl(
    "export const SCENE_KEYS = ['aura']; export const SCENE_LABELS = { aura: 'Aura' };",
  ),
};

await compileInto(
  stubs,
  [
    ["@/lib/audioEffects", "src/lib/audioEffects.ts"],
    ["@/lib/playbackClock", "src/lib/playbackClock.ts"],
    ["@/lib/audioIntelligence", "src/lib/audioIntelligence.ts"],
    ["@/lib/trackSwap", "src/lib/trackSwap.ts"],
    ["@/components/icons", "src/components/icons.tsx"],
    ["@/components/ui/Tooltip", "src/components/ui/Tooltip.tsx"],
    ["@/components/player/TrackSwap", "src/components/player/TrackSwap.tsx"],
    ["./transitionDisplay", "src/components/player/transitionDisplay.ts"],
    ["@/components/player/transitionDisplay", "src/components/player/transitionDisplay.ts"],
    ["./useTrackTransition", "src/components/player/useTrackTransition.ts"],
    ["@/components/player/useTrackTransition", "src/components/player/useTrackTransition.ts"],
    ["@/components/player/TrackTransitionDeck", "src/components/player/TrackTransitionDeck.tsx"],
  ],
  "track-transition-ui",
);

const {
  TRANSITION_EXIT_MS,
  computeRemainingExitMs,
  formatTransitionRemaining,
  resolveTransitionDisplay,
  transitionBlendWeights,
  transitionKindLabel,
} = await import(stubs["@/components/player/transitionDisplay"]);
const { DesktopTransitionDeck, MobileTransitionSummary } = await import(
  stubs["@/components/player/TrackTransitionDeck"]
);
const { default: PlayerBar } = await import(
  await compileSource("src/components/player/PlayerBar.tsx", stubs, "PlayerBar")
);
const { default: Stage } = await import(
  await compileSource("src/components/now-playing/Stage.tsx", stubs, "Stage")
);
const { TrackHeading } = await import(
  await compileSource("src/components/now-playing/TrackMeta.tsx", stubs, "TrackMeta")
);

function sampleTransition(overrides = {}) {
  return {
    id: 7,
    kind: "crossfade",
    outgoing: outgoingTrack,
    incoming: incomingTrack,
    outgoingIndex: 0,
    incomingIndex: 1,
    startedAtMs: 1000,
    durationMs: 6000,
    progress: 0.45,
    ...overrides,
  };
}

test("resolveTransitionDisplay keeps both tracks active for the full transition, exits only on natural completion, and snaps on cancel or reduced motion", () => {
  // 1. Idle when nothing is transitioning.
  assert.deepEqual(
    resolveTransitionDisplay({
      currentTrack: outgoingTrack,
      transition: null,
      lastTransitionEnd: null,
      nowMs: 2000,
    }),
    { phase: "idle" },
  );

  // 2. Active transition prefers matching live clock and falls back to snapshot when clock is absent or stale.
  const activeSnapshot = resolveTransitionDisplay({
    currentTrack: outgoingTrack,
    transition: sampleTransition({ progress: 0.3 }),
    lastTransitionEnd: null,
    liveClock: null,
    nowMs: 2800,
  });
  assert.equal(activeSnapshot.phase, "active");
  assert.equal(activeSnapshot.progress, 0.3);
  assert.ok(Math.abs(activeSnapshot.remainingSec - 4.2) < 1e-6);

  const activeLive = resolveTransitionDisplay({
    currentTrack: outgoingTrack,
    transition: sampleTransition({ progress: 0.3 }),
    lastTransitionEnd: null,
    liveClock: { id: 7, progress: 0.65, remainingMs: 2100 },
    nowMs: 4900,
  });
  assert.equal(activeLive.phase, "active");
  assert.equal(activeLive.progress, 0.65);
  assert.equal(activeLive.remainingSec, 2.1);

  const staleClock = resolveTransitionDisplay({
    currentTrack: outgoingTrack,
    transition: sampleTransition({ progress: 0.3 }),
    lastTransitionEnd: null,
    liveClock: { id: 6, progress: 0.99, remainingMs: 50 },
    nowMs: 2800,
  });
  assert.equal(staleClock.phase, "active");
  assert.equal(staleClock.progress, 0.3);

  // 3. Natural completion enters brief exiting phase while within TRANSITION_EXIT_MS and on incoming track.
  const completedEnd = {
    id: 7,
    kind: "smart-crossfade",
    outcome: "completed",
    outgoing: outgoingTrack,
    incoming: incomingTrack,
    endedAtMs: 7000,
  };
  const exiting = resolveTransitionDisplay({
    currentTrack: incomingTrack,
    transition: null,
    lastTransitionEnd: completedEnd,
    nowMs: 7120,
  });
  assert.equal(exiting.phase, "exiting");
  assert.equal(exiting.outgoing.id, outgoingTrack.id);
  assert.equal(exiting.incoming.id, incomingTrack.id);
  assert.equal(exiting.remainingExitMs, TRANSITION_EXIT_MS - 120);

  // 4. Once exit window expires, settles cleanly to idle (no late replay).
  assert.deepEqual(
    resolveTransitionDisplay({
      currentTrack: incomingTrack,
      transition: null,
      lastTransitionEnd: completedEnd,
      nowMs: 7000 + TRANSITION_EXIT_MS,
    }),
    { phase: "idle" },
  );

  // 5. Cancelled transition (skip/seek/pause/error) snaps straight to idle even if currentTrack matches incoming.
  assert.deepEqual(
    resolveTransitionDisplay({
      currentTrack: incomingTrack,
      transition: null,
      lastTransitionEnd: { ...completedEnd, outcome: "cancelled" },
      nowMs: 7020,
    }),
    { phase: "idle" },
  );

  // 6. Reduced motion skips exiting animation and snaps immediately on completion, while still displaying active transitions.
  assert.deepEqual(
    resolveTransitionDisplay({
      currentTrack: incomingTrack,
      transition: null,
      lastTransitionEnd: completedEnd,
      nowMs: 7020,
      reducedMotion: true,
    }),
    { phase: "idle" },
  );
  const activeReduced = resolveTransitionDisplay({
    currentTrack: outgoingTrack,
    transition: sampleTransition({ progress: 0.5 }),
    lastTransitionEnd: null,
    nowMs: 4000,
    reducedMotion: true,
  });
  assert.equal(activeReduced.phase, "active");
  assert.equal(activeReduced.progress, 0.5);

  // 7. Moving to another track clears exit immediately.
  assert.deepEqual(
    resolveTransitionDisplay({
      currentTrack: { ...incomingTrack, id: "track-other" },
      transition: null,
      lastTransitionEnd: completedEnd,
      nowMs: 7020,
    }),
    { phase: "idle" },
  );
});

test("transitionDisplay helpers validate inputs loudly and keep both tracks visibly legible across [0, 1]", () => {
  assert.equal(transitionKindLabel("crossfade"), "Übergang");
  assert.equal(transitionKindLabel("smart-crossfade"), "Smart-Übergang");
  assert.equal(formatTransitionRemaining(4.2), "5 s");
  assert.equal(formatTransitionRemaining(0.4), "0,4 s");
  assert.equal(computeRemainingExitMs(1000, 1100, 320), 220);
  assert.equal(computeRemainingExitMs(1000, 1400, 320), 0);

  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const weights = transitionBlendWeights(p);
    assert.ok(weights.outgoingCoverOpacity >= 0.6, `outgoing cover must stay visible at p=${p}`);
    assert.ok(weights.outgoingTextOpacity >= 0.55, `outgoing title must stay legible at p=${p}`);
    assert.ok(weights.incomingCoverOpacity >= 0.65, `incoming cover must be visible at p=${p}`);
    assert.ok(weights.incomingTextOpacity >= 0.7, `incoming title must be legible at p=${p}`);
  }

  assert.throws(() => formatTransitionRemaining(-1), RangeError);
  assert.throws(() => formatTransitionRemaining(Number.NaN), RangeError);
  assert.throws(() => transitionBlendWeights(1.2), RangeError);
  assert.throws(() => transitionBlendWeights(Number.NaN), RangeError);
  assert.throws(
    () =>
      resolveTransitionDisplay({
        currentTrack: outgoingTrack,
        transition: sampleTransition({ durationMs: 0 }),
        lastTransitionEnd: null,
        nowMs: 1000,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      resolveTransitionDisplay({
        currentTrack: outgoingTrack,
        transition: null,
        lastTransitionEnd: null,
        nowMs: Number.NaN,
      }),
    RangeError,
  );
});

test("PlayerBar renders both outgoing and incoming covers & titles throughout an active transition on desktop and mobile, and normal single track when idle", () => {
  // Idle: single track, no transition chrome.
  fixture.track = outgoingTrack;
  fixture.transition = null;
  fixture.lastTransitionEnd = null;
  const idleHtml = renderToStaticMarkup(createElement(PlayerBar));
  assert.match(idleHtml, /Midnight Signal/);
  assert.doesNotMatch(idleHtml, /Solar Drift/);
  assert.doesNotMatch(idleHtml, /data-track-transition=/);

  // Active mid-transition: BOTH covers and BOTH titles rendered in DesktopBar and MiniPlayer.
  for (const progress of [0.05, 0.5, 0.95]) {
    fixture.transition = sampleTransition({ kind: "smart-crossfade", progress });
    const activeHtml = renderToStaticMarkup(createElement(PlayerBar));
    assert.match(activeHtml, /data-track-transition="active"/);
    assert.match(activeHtml, /data-transition-kind="smart-crossfade"/);
    assert.match(activeHtml, new RegExp(`--transition-p:${progress.toFixed(4)}`));
    assert.match(activeHtml, /Smart-Übergang/);
    assert.match(activeHtml, /cover-out\.jpg/);
    assert.match(activeHtml, /cover-in\.jpg/);
    assert.match(activeHtml, /Midnight Signal/);
    assert.match(activeHtml, /Solar Drift/);
    assert.match(activeHtml, /data-transition-cover="outgoing"/);
    assert.match(activeHtml, /data-transition-cover="incoming"/);
    assert.match(activeHtml, /data-transition-track="outgoing"/);
    assert.match(activeHtml, /data-transition-track="incoming"/);
  }
});

test("DesktopTransitionDeck and MobileTransitionSummary render exiting state cleanly once transition completes", () => {
  const exitingDisplay = {
    phase: "exiting",
    id: 7,
    kind: "crossfade",
    outgoing: outgoingTrack,
    incoming: incomingTrack,
    exitProgress: 0.25,
    remainingExitMs: 240,
  };

  const desktopHtml = renderToStaticMarkup(
    createElement(DesktopTransitionDeck, {
      display: exitingDisplay,
      playing: true,
      onOpenNowPlaying: () => {},
    }),
  );
  assert.match(desktopHtml, /data-track-transition="exiting"/);
  assert.match(desktopHtml, /--transition-p:1\.0000/);
  assert.match(desktopHtml, /Midnight Signal/);
  assert.match(desktopHtml, /Solar Drift/);

  const mobileHtml = renderToStaticMarkup(
    createElement(MobileTransitionSummary, {
      display: exitingDisplay,
      onOpenNowPlaying: () => {},
    }),
  );
  assert.match(mobileHtml, /data-track-transition="exiting"/);
  assert.match(mobileHtml, /Midnight Signal/);
  assert.match(mobileHtml, /Solar Drift/);
});

test("Fullscreen Stage and TrackHeading display both covers and titles during transition and revert to single track when idle", () => {
  const activeDisplay = {
    phase: "active",
    id: 9,
    kind: "crossfade",
    outgoing: outgoingTrack,
    incoming: incomingTrack,
    progress: 0.6,
    durationMs: 6000,
    remainingSec: 2.4,
  };

  const stageActive = renderToStaticMarkup(
    createElement(Stage, {
      track: outgoingTrack,
      albumRef: { current: null },
      preferences: { enabled: false, scene: "auto" },
      transitionDisplay: activeDisplay,
    }),
  );
  assert.match(stageActive, /data-stage-transition="active"/);
  assert.match(stageActive, /cover-out\.jpg/);
  assert.match(stageActive, /cover-in\.jpg/);
  assert.match(stageActive, /data-transition-cover="outgoing"/);
  assert.match(stageActive, /data-transition-cover="incoming"/);

  const stageIdle = renderToStaticMarkup(
    createElement(Stage, {
      track: incomingTrack,
      albumRef: { current: null },
      preferences: { enabled: false, scene: "auto" },
      transitionDisplay: { phase: "idle" },
    }),
  );
  assert.doesNotMatch(stageIdle, /data-stage-transition=/);
  assert.match(stageIdle, /cover-in\.jpg/);
  assert.doesNotMatch(stageIdle, /cover-out\.jpg/);

  const headingDisplay = renderToStaticMarkup(
    createElement(TrackHeading, {
      track: outgoingTrack,
      onNavigate: () => {},
      variant: "display",
      transitionDisplay: activeDisplay,
    }),
  );
  assert.match(headingDisplay, /data-heading-transition="active"/);
  assert.match(headingDisplay, /Midnight Signal/);
  assert.match(headingDisplay, /Solar Drift/);
  assert.match(headingDisplay, /Nora Vance/);
  assert.match(headingDisplay, /Kaito Waves/);
  assert.match(headingDisplay, /Übergang/);

  const headingRow = renderToStaticMarkup(
    createElement(TrackHeading, {
      track: outgoingTrack,
      onNavigate: () => {},
      variant: "row",
      thumbnail: true,
      transitionDisplay: activeDisplay,
    }),
  );
  assert.match(headingRow, /data-heading-transition="active"/);
  assert.match(headingRow, /cover-out\.jpg/);
  assert.match(headingRow, /cover-in\.jpg/);
  assert.match(headingRow, /Midnight Signal/);
  assert.match(headingRow, /Solar Drift/);
});

test("globals.css defines live transition progress & exit rules with prefers-reduced-motion support", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.track-transition-meter-fill\s*\{[^}]*scaleX\(var\(--transition-p,\s*0\)\)/);
  assert.match(css, /\[data-track-transition="exiting"\]\s+\.track-transition-outgoing-cover-slot/);
  assert.match(css, /\[data-track-transition="exiting"\]\s+\.stage-transition-outgoing-slot/);
  const reducedIdx = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedIdx >= 0, "globals.css must declare prefers-reduced-motion block");
  const reducedBlock = css.slice(reducedIdx);
  assert.match(reducedBlock, /\.track-transition-outgoing-cover/);
  assert.match(reducedBlock, /\.stage-transition-outgoing/);
});
