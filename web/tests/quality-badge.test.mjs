import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";

const fixture = {
  preferredQuality: "high",
  track: {
    id: "t-1",
    title: "Take Me (To The Moon)",
    artist: "Ian Asher",
    album: "Single",
    cover: "",
    duration_sec: 195,
  },
};
globalThis.__qualityBadgeFixture = fixture;

const reactUrl = import.meta.resolve("react");
const noopComponent = moduleUrl("export default function Stub() { return null; }");
const playerState = {
  index: 0,
  queue: [fixture.track],
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
  toggle() {},
  next() {},
  prev() {},
  toggleShuffle() {},
  cycleRepeat() {},
  setVolume() {},
  toggleMute() {},
  toggleQueue() {},
  toggleLyrics() {},
};

const stubs = {
  react: reactUrl,
  "react-dom": import.meta.resolve("react-dom"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link({ href, children, ...props }) { return createElement("a", { ...props, href }, children); }`,
  ),
  "@tanstack/react-query": moduleUrl(
    "export function useQuery() { return { data: { preferred_quality: globalThis.__qualityBadgeFixture.preferredQuality } }; }",
  ),
  "@/lib/api": moduleUrl("export const api = { settings: async () => ({}) };"),
  "@/hooks/useAuth": moduleUrl(
    "export const useMe = () => ({ data: { id: 'u1', is_approved: true } });",
  ),
  "@/store/player": moduleUrl(
    `const s = ${JSON.stringify(playerState)}; export const currentTrack = () => globalThis.__qualityBadgeFixture.track; export const usePlayerStore = (sel) => sel(s);`,
  ),
  "@/store/connect": moduleUrl(
    "export const canControlActiveVolume = () => true; export const useConnectStore = (sel) => sel({ enabled: false, status: 'disabled', activeDeviceId: null, deviceId: 'd1', devices: [] });",
  ),
  "@/store/party": moduleUrl(
    "export const canControlPartyPlayback = () => true; export const usePartyStore = (sel) => sel({ active: false, detached: false, isHost: false, guestsCanControl: true, hostName: '' });",
  ),
  "@/store/uiModals": moduleUrl(
    "export const useUiModalsStore = { getState: () => ({ audioEffectsOpen: false, setAudioEffectsOpen() {} }) };",
  ),
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
  "@/components/player/SleepTimerControl": moduleUrl("export function SleepTimerTrigger() { return null; }"),
  "@/components/player/AudioEffectsControl": moduleUrl("export function AudioEffectsTrigger() { return null; }"),
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
  ],
  "quality-badge",
);

const { AudioQualityIcon } = await import(stubs["@/components/icons"]);
const { default: Tooltip } = await import(stubs["@/components/ui/Tooltip"]);
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
