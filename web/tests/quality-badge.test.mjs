import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";

const defaultAudioEffects = {
  eqEnabled: false,
  preset: "flat",
  bands: [0, 0, 0, 0, 0],
  compressorEnabled: false,
  playbackRate: 1,
};

const sampleTrack = {
  id: "t-1",
  title: "Take Me (To The Moon)",
  artist: "Ian Asher",
  album: "Single",
  cover: "",
  duration_sec: 195,
};

const fixture = {
  preferredQuality: "high",
  track: sampleTrack,
  audioEffects: { ...defaultAudioEffects },
  audioEffectsOpen: false,
  sleepAt: null,
  sleepAfterTrack: false,
};
globalThis.__qualityBadgeFixture = fixture;

beforeEach(() => {
  fixture.preferredQuality = "high";
  fixture.track = sampleTrack;
  fixture.audioEffects = { ...defaultAudioEffects };
  fixture.audioEffectsOpen = false;
  fixture.sleepAt = null;
  fixture.sleepAfterTrack = false;
});

const reactUrl = import.meta.resolve("react");
const noopComponent = moduleUrl("export default function Stub() { return null; }");
const playerState = {
  index: 0,
  queue: [sampleTrack],
  isPlaying: false,
  isBuffering: false,
  shuffle: false,
  repeat: "off",
  currentTime: 0,
  duration: 195,
  volume: 1,
  muted: false,
  queueOpen: false,
  lyricsOpen: false,
  nowPlayingOpen: false,
  error: null,
  preloadError: null,
  transition: null,
  lastTransitionEnd: null,
  sleepAt: null,
  sleepAfterTrack: false,
  toggle() {},
  next() {},
  prev() {},
  toggleShuffle() {},
  cycleRepeat() {},
  setVolume() {},
  toggleMute() {},
  toggleQueue() {},
  toggleLyrics() {},
  setSleepTimer() {},
  setSleepAfterTrack() {},
};

const stubs = {
  react: reactUrl,
  "react-dom": moduleUrl("export function createPortal(node) { return node; }"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link({ href, children, ...props }) { return createElement("a", { ...props, href }, children); }`,
  ),
  "@tanstack/react-query": moduleUrl(`
    export function useQuery() {
      const q = globalThis.__qualityBadgeFixture.preferredQuality;
      return { data: q ? { preferred_quality: q } : undefined };
    }
    export function useMutation() {
      return { isPending: false, mutate() {} };
    }
    export function useQueryClient() {
      return { setQueryData() {} };
    }
  `),
  "@/lib/api": moduleUrl("export const api = { settings: async () => ({}), updateSettings: async () => ({}) };"),
  "@/hooks/useAuth": moduleUrl(
    "export const useMe = () => ({ data: { id: 'u1', is_approved: true } });",
  ),
  "@/hooks/useDialogFocus": moduleUrl("export function useDialogFocus() {}"),
  "@/store/toast": moduleUrl("export const toast = { info() {}, success() {}, error() {} };"),
  "@/store/player": moduleUrl(`
    const base = ${JSON.stringify(playerState)};
    const state = () => ({
      ...base,
      sleepAt: globalThis.__qualityBadgeFixture.sleepAt,
      sleepAfterTrack: globalThis.__qualityBadgeFixture.sleepAfterTrack,
    });
    export const currentTrack = () => globalThis.__qualityBadgeFixture.track;
    export const usePlayerStore = (sel) => sel(state());
  `),
  "@/store/connect": moduleUrl(
    "export const canControlActiveVolume = () => true; export const useConnectStore = (sel) => sel({ enabled: false, status: 'disabled', activeDeviceId: null, deviceId: 'd1', devices: [] });",
  ),
  "@/store/party": moduleUrl(
    "export const canControlPartyPlayback = () => true; export const usePartyStore = (sel) => sel({ active: false, detached: false, isHost: false, guestsCanControl: true, hostName: '' });",
  ),
  "@/store/uiModals": moduleUrl(`
    const state = () => ({
      audioEffectsOpen: globalThis.__qualityBadgeFixture.audioEffectsOpen,
      audioEffectsAnchor: null,
      sleepTimerOpen: false,
      sleepTimerAnchor: null,
      setAudioEffectsOpen() {},
      setSleepTimerOpen() {},
    });
    export const useUiModalsStore = Object.assign((sel) => sel(state()), { getState: state });
  `),
  "@/store/audioEffects": moduleUrl(`
    const state = () => ({
      ...globalThis.__qualityBadgeFixture.audioEffects,
      setEqEnabled() {},
      applyPreset() {},
      setBandGain() {},
      setCompressorEnabled() {},
      setPlaybackRate() {},
      reset() {},
    });
    export const useAudioEffectsStore = (sel) => sel(state());
  `),
  "@/components/LikeButton": noopComponent,
  "@/components/EqualizerBars": noopComponent,
  "@/components/now-playing/NowPlaying": noopComponent,
  "@/components/TrackContext": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function TrackContext({ children, className }) { return createElement("div", { className }, children); }`,
  ),
  "@/components/CacheMarker": noopComponent,
  "@/components/ArtistLinks": noopComponent,
  "@/components/CoverPlaceholder": noopComponent,
  "@/components/player/Scrubber": moduleUrl(
    "export default function Scrubber() { return null; } export function ProgressLine() { return null; } export const rangeFill = () => '';",
  ),
  "@/components/player/DeviceSelector": moduleUrl("export function DeviceSelectorTrigger() { return null; }"),
  "@/components/player/PictureInPictureButton": noopComponent,
  "@/components/player/ActiveOutputBanner": noopComponent,
  "@/components/player/TrackTransitionDeck": moduleUrl(
    "export function DesktopTransitionDeck() { return null; } export function MobileTransitionSummary() { return null; }",
  ),
  "@/components/player/useTrackTransition": moduleUrl(
    "export const useTrackTransition = () => ({ phase: 'idle' }); export const useLiveTransitionProgress = () => {};",
  ),
  "@/lib/format": moduleUrl("export const formatTime = () => '0:00';"),
  "@/lib/morph": moduleUrl("export const NAV_FORWARD = [];"),
  "@/components/player/usePlayerSideEffects": moduleUrl("export const setNowPlayingOpen = () => {};"),
};

await compileInto(
  stubs,
  [
    ["@/lib/audioEffects", "src/lib/audioEffects.ts"],
    ["@/lib/audioIntelligence", "src/lib/audioIntelligence.ts"],
    ["@/lib/trackSwap", "src/lib/trackSwap.ts"],
    ["@/components/icons", "src/components/icons.tsx"],
    ["@/components/ui/Tooltip", "src/components/ui/Tooltip.tsx"],
    ["@/components/player/TrackSwap", "src/components/player/TrackSwap.tsx"],
    ["@/components/player/SleepTimerControl", "src/components/player/SleepTimerControl.tsx"],
    ["@/components/player/AudioEffectsControl", "src/components/player/AudioEffectsControl.tsx"],
  ],
  "quality-badge",
);

const { AudioQualityIcon } = await import(stubs["@/components/icons"]);
const { default: Tooltip } = await import(stubs["@/components/ui/Tooltip"]);
const { AudioEffectsHost, computeAudioPopoverPosition } = await import(
  stubs["@/components/player/AudioEffectsControl"]
);
const { default: PlayerBar } = await import(
  await compileSource("src/components/player/PlayerBar.tsx", stubs, "PlayerBar")
);

test("AudioQualityIcon renders distinct compact 14x14 SVG glyphs for every tier", () => {
  const lossless = renderToStaticMarkup(createElement(AudioQualityIcon, { quality: "lossless" }));
  const high = renderToStaticMarkup(createElement(AudioQualityIcon, { quality: "high" }));
  const saver = renderToStaticMarkup(createElement(AudioQualityIcon, { quality: "saver" }));

  for (const svg of [lossless, high, saver]) {
    assert.match(svg, /^<svg\b[^>]*width="14"[^>]*height="14"/);
  }
  assert.notEqual(lossless, high);
  assert.notEqual(high, saver);
  assert.notEqual(lossless, saver);
});

test("Tooltip renders data-tooltip during SSR without leaking a native title attribute", () => {
  const html = renderToStaticMarkup(
    createElement(
      Tooltip,
      { label: "Audioqualität: Hoch (320 kbps)", detail: "Ausgewogene MP3-Qualität" },
      createElement("button", { type: "button" }, "icon"),
    ),
  );
  assert.match(html, /data-tooltip="Audioqualität: Hoch \(320 kbps\)"/);
  assert.doesNotMatch(html, /\stitle=/);
  assert.doesNotMatch(html, /role="tooltip"/);
});

test("PlayerBar QualityBadge renders a small icon with Tooltip and no raw numeric pill or title", () => {
  const expected = [
    ["high", "Audioqualität: Hoch (320 kbps)", "text-muted", "320"],
    ["lossless", "Audioqualität: Verlustfrei (FLAC)", "text-accent", "FLAC"],
    ["saver", "Audioqualität: Datensparmodus (128 kbps)", "text-subtle", "128"],
  ];

  for (const [tier, label, toneClass, oldPill] of expected) {
    fixture.preferredQuality = tier;
    const html = renderToStaticMarkup(createElement(PlayerBar));
    assert.match(html, new RegExp(`data-quality-tier="${tier}"`));
    assert.match(html, new RegExp(`data-tooltip="${label.replace(/[()]/g, "\\$&")}"`));
    assert.match(html, new RegExp(`aria-label="${label.replace(/[()]/g, "\\$&")}"`));
    assert.match(html, new RegExp(toneClass));
    assert.doesNotMatch(html, new RegExp(`>${oldPill}<`));
    assert.doesNotMatch(html, new RegExp(`title="Audioqualität:`));
  }
});

test("PlayerBar removes standalone Equalizer and Sleep-Timer buttons while keeping Lyrics, Queue, Volume, and Expand", () => {
  const html = renderToStaticMarkup(createElement(PlayerBar));
  assert.doesNotMatch(html, /aria-label="Equalizer &amp; Wiedergabegeschwindigkeit"/);
  assert.doesNotMatch(html, /aria-label="Sleep-Timer"/);
  assert.match(html, /aria-label="Songtext"/);
  assert.match(html, /aria-label="Warteschlange"/);
  assert.match(html, /aria-label="Lautstärke"/);
  assert.match(html, /aria-label="Jetzt läuft öffnen"/);
});

test("QualityBadge exposes dialog semantics, offline mode access, and active speed/sleep indicators", () => {
  fixture.preferredQuality = "high";
  const idleHtml = renderToStaticMarkup(createElement(PlayerBar));
  assert.match(idleHtml, /data-audio-effects-trigger=""/);
  assert.match(idleHtml, /aria-haspopup="dialog"/);
  assert.doesNotMatch(idleHtml, /data-sleep-indicator/);

  fixture.audioEffects = { ...defaultAudioEffects, eqEnabled: true, preset: "bass", playbackRate: 1.25 };
  fixture.sleepAfterTrack = true;
  const activeHtml = renderToStaticMarkup(createElement(PlayerBar));
  assert.match(activeHtml, /text-accent/);
  assert.match(activeHtml, />1\.25×</);
  assert.match(activeHtml, /data-sleep-indicator=""/);
  assert.match(activeHtml, /1×/);
  assert.match(activeHtml, /EQ: Bass Boost/);
  assert.match(activeHtml, /Sleep-Timer \(Titelende\)/);

  fixture.sleepAfterTrack = false;
  fixture.sleepAt = Date.now() + 900_000;
  const timedHtml = renderToStaticMarkup(createElement(PlayerBar));
  assert.match(timedHtml, /data-sleep-indicator=""/);
  assert.match(timedHtml, /0:00/);

  fixture.audioEffects = { ...defaultAudioEffects };
  fixture.sleepAt = null;
  const offlineHtml = renderToStaticMarkup(createElement(PlayerBar, { offlineOnly: true }));
  assert.match(offlineHtml, /data-quality-tier="offline"/);
  assert.match(offlineHtml, /data-audio-effects-trigger=""/);
  assert.match(offlineHtml, /aria-label="Klang, Tempo &amp; Sleep-Timer"/);
});

test("AudioEffectsHost consolidates Sleep-Timer controls inside the headphone popover", () => {
  fixture.audioEffectsOpen = true;
  const hadDocument = "document" in globalThis;
  const prevDocument = globalThis.document;
  globalThis.document = { body: {} };
  try {
    const idlePopover = renderToStaticMarkup(createElement(AudioEffectsHost));
    assert.match(idlePopover, /aria-label="Klang, Tempo &amp; Sleep-Timer"/);
    assert.match(idlePopover, /data-sleep-timer-section=""/);
    assert.match(idlePopover, /15 min/);
    assert.match(idlePopover, /30 min/);
    assert.match(idlePopover, /45 min/);
    assert.match(idlePopover, /60 min/);
    assert.match(idlePopover, /Ende des aktuellen Titels/);
    assert.doesNotMatch(idlePopover, />Stoppen</);

    fixture.sleepAfterTrack = true;
    const armedPopover = renderToStaticMarkup(createElement(AudioEffectsHost));
    assert.match(armedPopover, /Pause nach dem aktuellen Titel/);
    assert.match(armedPopover, />Stoppen</);
  } finally {
    if (hadDocument) globalThis.document = prevDocument;
    else delete globalThis.document;
  }
});

test("computeAudioPopoverPosition left-aligns for left-side QualityBadge, right-aligns for right-side triggers, and clamps within viewport", () => {
  const leftSide = computeAudioPopoverPosition({
    viewportWidth: 1440,
    viewportHeight: 900,
    popoverWidth: 368,
    popoverHeight: 520,
    anchorRect: { left: 210, right: 224, top: 840, bottom: 854, width: 14, height: 14 },
  });
  assert.equal(leftSide.left, 210);
  assert.equal(leftSide.top, 310);

  const rightSide = computeAudioPopoverPosition({
    viewportWidth: 1440,
    viewportHeight: 900,
    popoverWidth: 368,
    popoverHeight: 520,
    anchorRect: { left: 1120, right: 1156, top: 820, bottom: 856, width: 36, height: 36 },
  });
  assert.equal(rightSide.left, 1156 - 368);
  assert.equal(rightSide.top, 820 - 520 - 10);

  const smallViewport = computeAudioPopoverPosition({
    viewportWidth: 700,
    viewportHeight: 600,
    popoverWidth: 368,
    popoverHeight: 520,
    anchorRect: { left: 660, right: 690, top: 40, bottom: 60, width: 30, height: 20 },
  });
  assert.equal(smallViewport.left, 700 - 368 - 12);
  assert.equal(smallViewport.top, 600 - 520 - 12);
});
