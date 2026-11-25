import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSrc = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

test("fullscreen.module.css provides frosted dark-ink scrims for header, panels, and mobile/desktop console", () => {
  const css = readSrc("components/now-playing/fullscreen.module.css");

  assert.match(css, /\.header\s*\{[\s\S]*?border-bottom:[\s\S]*?backdrop-filter:\s*blur\(/, ".header needs crisp frosted bar with hairline border");
  assert.match(css, /\.panelSurface\s*\{[\s\S]*?backdrop-filter:\s*blur\(/, ".panelSurface needs frosted blur scrim");
  assert.match(css, /\.console\s*\{[\s\S]*?backdrop-filter:\s*blur\(/, ".console needs frosted blur scrim");
  assert.doesNotMatch(
    css,
    /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.console\s*\{[^}]*background:\s*none/i,
    "mobile console must keep a frosted dark-ink backdrop over active visualizers",
  );
  assert.match(css, /\.scope\s*\{[\s\S]*?--muted:/, ".scope lifts --muted contrast for fullscreen readability");
});

test("NowPlaying, TrackMeta, Controls, WaveformScrubber, LyricsPanel, and KaraokeLine keep text legible over visualizers", () => {
  const nowPlaying = readSrc("components/now-playing/NowPlaying.tsx");
  const trackMeta = readSrc("components/now-playing/TrackMeta.tsx");
  const controls = readSrc("components/now-playing/Controls.tsx");
  const waveform = readSrc("components/player/WaveformScrubber.tsx");
  const lyricsPanel = readSrc("components/now-playing/LyricsPanel.tsx");
  const karaokeLine = readSrc("components/KaraokeLine.tsx");

  // NowPlaying mounts frosted top chrome, frosted panel surface, and preserves Cinema idle auto-hide.
  assert.match(nowPlaying, /styles\.header[\s\S]*chromeFadeClass/);
  assert.match(nowPlaying, /styles\.panelSurface/);
  assert.match(nowPlaying, /CINEMA_IDLE_MS/);

  // TrackMeta display heading uses frosted dark-ink plinth + text-shadow.
  assert.match(trackMeta, /bg-\[#0f0e11\]\/\d+[\s\S]*backdrop-blur/);
  assert.match(trackMeta, /text-shadow/);

  // Controls keep hover highlight on shuffle/repeat buttons.
  assert.match(controls, /toggleShuffle[\s\S]*?hover:text-foreground/);
  assert.match(controls, /cycleRepeat[\s\S]*?hover:text-foreground/);

  // WaveformScrubber timestamps and BPM badge sit on legible ink surfaces.
  assert.match(waveform, /bg-\[#0f0e11\]\/\d+[\s\S]*BPM/);

  // LyricsPanel active/inactive lines have crisp text-shadow, raised contrast, and no horizontal pill clipping.
  assert.match(lyricsPanel, /overflow-y-auto overflow-x-hidden/);
  assert.doesNotMatch(lyricsPanel, /ring-1 ring-white\/\[0\.09\][^"]*scale-\[/, "active bordered pill must not scale past scroll container");
  assert.match(lyricsPanel, /text-shadow/);
  assert.doesNotMatch(lyricsPanel, /text-foreground\/30\b/, "inactive lyrics must not drop to 30% opacity over visualizers");

  // KaraokeLine clears inherited text-shadow on bg-clip-text gradient words so fill never muddies,
  // and keeps the word separator outside the inline-block wrapper so spaces never collapse.
  assert.match(karaokeLine, /bg-clip-text text-transparent \[text-shadow:none\]/);
  assert.match(karaokeLine, /<\/span>\s*\{sep\}/);
});

test("PartyScreenKiosk wraps top bar, track meta, karaoke lyrics, reactions, and footer in frosted dark-ink scrims", () => {
  const kiosk = readSrc("components/party/PartyScreenKiosk.tsx");

  assert.match(kiosk, /<header[^>]*backdrop-blur-xl/);
  assert.match(kiosk, /bg-\[#0f0e11\]\/\d+[\s\S]*Hinzugefügt von/);
  assert.match(kiosk, /bg-\[#0f0e11\]\/\d+[\s\S]*backdrop-blur-xl[\s\S]*KaraokeLine/);
  assert.match(kiosk, /<footer[^>]*bg-\[#0f0e11\]\/\d+[\s\S]*backdrop-blur-xl/);
  assert.doesNotMatch(kiosk, /text-foreground\/30\b/, "kiosk lyrics must not drop to 30% opacity over visualizers");
});
