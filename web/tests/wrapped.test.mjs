import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith("./") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const wrapped = await import("../src/lib/wrapped.ts");
const canvasLib = await import("../src/lib/wrappedCanvas.ts");
resolver.deregister();

const {
  WRAPPED_TEMPLATES,
  WRAPPED_THEMES,
  WrappedContractError,
  buildCoverThemePalette,
  canWebShareFiles,
  contrastRatioRgb,
  copyPngBlobToClipboard,
  decodeWrappedReport,
  downloadBlob,
  exportCanvasToPngBlob,
  formatWrappedListeningDuration,
  formatWrappedSummaryText,
  getWrappedTemplateById,
  getWrappedThemeById,
  parseHexRgb,
  sharePngBlob,
  wrappedArtworkProxyUrl,
} = wrapped;

const {
  computeSafeCardMetrics,
  formatMmSs,
  formatWrappedDurationHours,
  getInitials,
  getWrappedCanvasDimensions,
  loadWrappedAssets,
  renderWrappedCard,
  resolveCardPalette,
  truncateTextWithEllipsis,
  wrapTextLines,
} = canvasLib;

function makeRichReport(overrides = {}) {
  return {
    range: "30d",
    generated_at: "2026-11-27T15:00:00Z",
    period_start: "2026-10-28T00:00:00Z",
    period_end: "2026-11-27T15:00:00Z",
    user: {
      display_name: "Logge Studio",
      avatar_url: "/api/uploads/avatars/logge.png",
    },
    totals: {
      play_count: 148,
      listening_sec: 31200,
      unique_tracks: 64,
      unique_artists: 24,
      unique_albums: 19,
      new_artists_count: 9,
      active_days: 22,
      total_days: 30,
      avg_daily_sec: 1418,
      current_streak_days: 5,
      longest_streak_days: 11,
    },
    persona: {
      id: "night_owl",
      title: "Nachtschwärmer",
      subtitle: "Frequenz-Jäger nach Mitternacht",
      tagline: "Wenn der Rest der Stadt schläft, drehst du deine Lieblingssongs erst richtig auf.",
      emblem: "moon_wave",
      traits: ["Peak um 23:00 Uhr", "68% nach 20 Uhr", "11 Tage Serie"],
    },
    aura: {
      id: "midnight_neon",
      title: "Mitternachts-Frequenz",
      description: "Tiefe Bässe und fokussierte Nachtschichten prägen deine Klangfarbe.",
      colors: ["#5b4bff", "#d6ff4b", "#ff5ec4"],
      mood_tags: ["Hypnotisch", "Spätschicht", "Fokussiert"],
    },
    rhythm: {
      chronotype: "night_owl",
      chronotype_label: "Nacht-Eule",
      peak_hour: 23,
      peak_weekday: 4,
      weekend_share_pct: 42,
      discovery_score_pct: 38,
      repeat_score_pct: 62,
      hourly_distribution: Array.from({ length: 24 }, (_, h) => (h === 23 ? 28 : (h % 5) + 1)),
      weekday_distribution: [18, 16, 20, 22, 34, 21, 17],
    },
    obsession: {
      track_key: "track-1",
      title: "Midnight Telemetry (Extended Club Mix)",
      artist: "Neon Kollektiv",
      album: "Analog Horizons",
      cover: "https://cdn.example.com/cover-1.jpg",
      play_count: 27,
      listening_sec: 6480,
      share_pct: 21,
      peak_day_date: "2026-11-14",
      peak_day_plays: 9,
    },
    peak_day: {
      date: "2026-11-14",
      weekday: 5,
      play_count: 24,
      listening_sec: 5400,
      top_track_title: "Midnight Telemetry (Extended Club Mix)",
      top_track_artist: "Neon Kollektiv",
      top_track_cover: "https://cdn.example.com/cover-1.jpg",
    },
    tempo: {
      avg_bpm: 124,
      min_bpm: 92,
      max_bpm: 142,
      analyzed_plays: 112,
      vibe_label: "Club-Puls",
    },
    equivalents: [
      { icon: "vinyl", value: "11", label: "Vinyl-LPs" },
      { icon: "concert", value: "6", label: "Konzerte" },
      { icon: "movie", value: "4", label: "Spielfilme" },
    ],
    top_tracks: Array.from({ length: 10 }, (_, idx) => ({
      rank: idx + 1,
      key: `t-${idx + 1}`,
      label: `Track Nummer ${idx + 1} mit langem Titel`,
      sublabel: `Artist ${idx + 1}`,
      cover: idx === 0 ? "https://cdn.example.com/cover-1.jpg" : "",
      count: 27 - idx * 2,
      listening_sec: (27 - idx * 2) * 210,
      share_pct: Math.max(2, 21 - idx * 2),
    })),
    top_artists: Array.from({ length: 10 }, (_, idx) => ({
      rank: idx + 1,
      key: `a-${idx + 1}`,
      label: idx === 0 ? "Neon Kollektiv" : `Künstler ${idx + 1}`,
      sublabel: "Electronic",
      cover: "",
      count: 35 - idx * 3,
      listening_sec: (35 - idx * 3) * 220,
      share_pct: Math.max(3, 24 - idx * 2),
    })),
    top_albums: [
      {
        rank: 1,
        key: "alb-1",
        label: "Analog Horizons",
        sublabel: "Neon Kollektiv",
        cover: "https://cdn.example.com/cover-1.jpg",
        count: 31,
        listening_sec: 7200,
        share_pct: 23,
      },
      {
        rank: 2,
        key: "alb-2",
        label: "Studio Paper Sessions",
        sublabel: "Künstler 2",
        cover: "",
        count: 18,
        listening_sec: 4100,
        share_pct: 13,
      },
    ],
    ...overrides,
  };
}

function makeEmptyReport() {
  return {
    range: "7d",
    generated_at: "2026-11-27T15:00:00Z",
    period_start: "2026-11-20T00:00:00Z",
    period_end: "2026-11-27T15:00:00Z",
    user: { display_name: "Neuling", avatar_url: "" },
    totals: {
      play_count: 0,
      listening_sec: 0,
      unique_tracks: 0,
      unique_artists: 0,
      unique_albums: 0,
      new_artists_count: 0,
      active_days: 0,
      total_days: 7,
      avg_daily_sec: 0,
      current_streak_days: 0,
      longest_streak_days: 0,
    },
    persona: null,
    aura: null,
    rhythm: {
      chronotype: "day_cruiser",
      chronotype_label: "Tages-Hörer",
      peak_hour: 0,
      peak_weekday: 0,
      weekend_share_pct: 0,
      discovery_score_pct: 0,
      repeat_score_pct: 0,
      hourly_distribution: Array.from({ length: 24 }, () => 0),
      weekday_distribution: Array.from({ length: 7 }, () => 0),
    },
    obsession: null,
    peak_day: null,
    tempo: null,
    equivalents: [],
    top_tracks: [],
    top_artists: [],
    top_albums: [],
  };
}

test("decodeWrappedReport decodes valid rich and empty reports", () => {
  const rich = decodeWrappedReport(makeRichReport());
  assert.equal(rich.range, "30d");
  assert.equal(rich.persona?.emblem, "moon_wave");
  assert.equal(rich.top_tracks.length, 10);
  assert.equal(rich.aura?.colors[1], "#d6ff4b");

  const empty = decodeWrappedReport(makeEmptyReport());
  assert.equal(empty.totals.play_count, 0);
  assert.equal(empty.persona, null);
  assert.equal(empty.top_tracks.length, 0);
});

test("decodeWrappedReport fails loudly with WrappedContractError and exact field path", () => {
  assert.throws(
    () => decodeWrappedReport(null),
    (err) => err instanceof WrappedContractError && err.path === "root",
  );

  assert.throws(
    () => decodeWrappedReport(makeRichReport({ range: "24h" })),
    (err) => err instanceof WrappedContractError && err.path === "range",
  );

  assert.throws(
    () => decodeWrappedReport(makeRichReport({ generated_at: "not-a-date" })),
    (err) => err instanceof WrappedContractError && err.path === "generated_at",
  );

  const badTotals = makeRichReport();
  badTotals.totals.current_streak_days = 15;
  badTotals.totals.longest_streak_days = 11;
  assert.throws(
    () => decodeWrappedReport(badTotals),
    (err) => err instanceof WrappedContractError && err.path === "totals.current_streak_days",
  );

  const badEmblem = makeRichReport();
  badEmblem.persona.emblem = "laser_cat";
  assert.throws(
    () => decodeWrappedReport(badEmblem),
    (err) => err instanceof WrappedContractError && err.path === "persona.emblem",
  );

  const badAura = makeRichReport();
  badAura.aura.colors = ["#112233", "rgb(1,2,3)", "#ffffff"];
  assert.throws(
    () => decodeWrappedReport(badAura),
    (err) => err instanceof WrappedContractError && err.path === "aura.colors[1]",
  );

  const badHist = makeRichReport();
  badHist.rhythm.hourly_distribution = [1, 2, 3];
  assert.throws(
    () => decodeWrappedReport(badHist),
    (err) => err instanceof WrappedContractError && err.path === "rhythm.hourly_distribution",
  );

  const badTempo = makeRichReport();
  badTempo.tempo.min_bpm = 150;
  badTempo.tempo.max_bpm = 120;
  assert.throws(
    () => decodeWrappedReport(badTempo),
    (err) => err instanceof WrappedContractError && err.path === "tempo.min_bpm",
  );

  const badTracks = makeRichReport();
  badTracks.top_tracks[2].count = 0;
  assert.throws(
    () => decodeWrappedReport(badTracks),
    (err) => err instanceof WrappedContractError && err.path === "top_tracks[2].count",
  );

  const contradictoryEmpty = makeEmptyReport();
  contradictoryEmpty.top_tracks = [makeRichReport().top_tracks[0]];
  assert.throws(
    () => decodeWrappedReport(contradictoryEmpty),
    (err) => err instanceof WrappedContractError && err.path === "totals.play_count",
  );
});

test("templates and themes registries are complete and contrast-safe", () => {
  assert.deepEqual(
    WRAPPED_TEMPLATES.map((t) => t.id),
    ["summary", "persona", "receipt", "festival", "obsession", "aura", "peak"],
  );
  for (const tpl of WRAPPED_TEMPLATES) {
    assert.ok(tpl.label.length > 0 && tpl.shortLabel.length > 0 && tpl.badge.length > 0);
    assert.equal(getWrappedTemplateById(tpl.id).id, tpl.id);
  }

  assert.deepEqual(
    WRAPPED_THEMES.map((t) => t.id),
    ["signal", "cover", "vinyl", "neon", "paper"],
  );
  assert.equal(getWrappedThemeById("paper").palette.isLight, true);
  assert.equal(getWrappedThemeById("signal").palette.isLight, false);

  assert.throws(() => getWrappedThemeById("unknown"), /Unbekanntes Wrapped-Farbthema/);
  assert.throws(() => getWrappedTemplateById("unknown"), /Unbekannte Wrapped-Vorlage/);

  for (const theme of WRAPPED_THEMES) {
    const surface = parseHexRgb(theme.palette.surface);
    const text = parseHexRgb(theme.palette.text);
    const accent = parseHexRgb(theme.palette.accent);
    assert.ok(contrastRatioRgb(text, surface) >= 7, `${theme.id} text contrast`);
    assert.ok(contrastRatioRgb(accent, surface) >= 4.5, `${theme.id} accent contrast`);
  }

  const vibrantCover = buildCoverThemePalette([210, 42, 95]);
  assert.ok(contrastRatioRgb(parseHexRgb(vibrantCover.text), parseHexRgb(vibrantCover.surface)) >= 7);
  assert.ok(contrastRatioRgb(parseHexRgb(vibrantCover.accent), parseHexRgb(vibrantCover.surface)) >= 4.5);
  assert.ok(contrastRatioRgb(parseHexRgb(vibrantCover.accentAlt), parseHexRgb(vibrantCover.surface)) >= 4.5);

  const grayCover = buildCoverThemePalette([128, 128, 128]);
  assert.ok(contrastRatioRgb(parseHexRgb(grayCover.accent), parseHexRgb(grayCover.surface)) >= 4.5);

  assert.throws(() => buildCoverThemePalette([256, 0, 0]), RangeError);

  const resolvedFromCover = resolveCardPalette("cover", vibrantCover, makeRichReport().aura);
  assert.equal(resolvedFromCover, vibrantCover);

  const resolvedFromAura = resolveCardPalette("cover", null, makeRichReport().aura);
  assert.equal(resolvedFromAura.isLight, false);
  assert.ok(contrastRatioRgb(parseHexRgb(resolvedFromAura.accent), parseHexRgb(resolvedFromAura.surface)) >= 4.5);
});

test("wrappedArtworkProxyUrl and text summary helpers validate and format accurately", () => {
  assert.equal(
    wrappedArtworkProxyUrl("https://cdn.example.com/a b.jpg?size=500"),
    "/api/me/stats/wrapped/artwork?url=https%3A%2F%2Fcdn.example.com%2Fa%20b.jpg%3Fsize%3D500",
  );
  assert.throws(() => wrappedArtworkProxyUrl(""), /darf nicht leer sein/);
  assert.throws(() => wrappedArtworkProxyUrl("   "), /darf nicht leer sein/);

  assert.equal(formatWrappedListeningDuration(45), "45 Sek.");
  assert.equal(formatWrappedListeningDuration(900), "15 Min.");
  assert.match(formatWrappedListeningDuration(31200), /8,7 Std\./);
  assert.throws(() => formatWrappedListeningDuration(-1), /Ungültige Hörzeit/);

  const summary = formatWrappedSummaryText(makeRichReport());
  assert.match(summary, /LoggeRythm Wrapped \(30 Tage\) – Logge Studio/);
  assert.match(summary, /Nachtschwärmer/);
  assert.match(summary, /Midnight Telemetry/);
  assert.match(summary, /11 Tage Rekord/);

  const emptySummary = formatWrappedSummaryText(makeEmptyReport());
  assert.match(emptySummary, /Noch keine Wiedergaben in diesem Zeitraum/);
});

test("layout, wrapping, truncation, and dimension invariants hold cleanly", () => {
  assert.deepEqual(getWrappedCanvasDimensions("story"), { width: 1080, height: 1920 });
  assert.deepEqual(getWrappedCanvasDimensions("square"), { width: 1080, height: 1080 });
  assert.throws(() => getWrappedCanvasDimensions("poster"), /Unbekanntes Kartenformat/);

  for (const fmt of ["story", "square"]) {
    const m = computeSafeCardMetrics(fmt);
    assert.ok(m.headerTop + m.headerHeight <= m.bodyTop);
    assert.ok(m.bodyTop < m.bodyBottom);
    assert.ok(m.bodyBottom < m.footerTop);
    assert.ok(m.footerTop < m.height);
    assert.equal(m.innerWidth, m.width - m.padX * 2);
  }

  const monoMeasure = (str) => str.length * 10;
  const trunc = truncateTextWithEllipsis("Ein sehr langer Tracktitel für Tests", 120, monoMeasure);
  assert.ok(monoMeasure(trunc) <= 120);
  assert.ok(trunc.endsWith("…"));
  assert.equal(truncateTextWithEllipsis("Anything", 0, monoMeasure), "");

  const lines = wrapTextLines(
    "Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft und mehr",
    140,
    2,
    monoMeasure,
  );
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(monoMeasure(line) <= 140, `Line exceeded maxWidth: ${line}`);
  }
  assert.ok(lines[1].endsWith("…"));

  assert.equal(getInitials("Daft Punk"), "DP");
  assert.equal(getInitials("Adele"), "AD");
  assert.equal(getInitials("  "), "LR");
  assert.deepEqual(formatWrappedDurationHours(51480), { value: "14,3", unit: "Std." });
  assert.equal(formatMmSs(222), "3:42");
});

test("export and share helpers fail loudly on invalid environment/inputs and handle AbortError", async () => {
  assert.equal(canWebShareFiles(), false);
  await assert.rejects(() => exportCanvasToPngBlob(null), /Canvas-Element ist ungültig/);
  await assert.rejects(
    () =>
      exportCanvasToPngBlob({
        toBlob(cb) {
          cb(null);
        },
      }),
    /keine gültigen Bilddaten/,
  );

  const blob = new Blob(["pngbytes"], { type: "image/png" });
  const exported = await exportCanvasToPngBlob({
    toBlob(cb) {
      cb(blob);
    },
  });
  assert.equal(exported.size, 8);

  assert.throws(() => downloadBlob(new Blob([]), "x.png"), /leer oder ungültig/);
  assert.throws(() => downloadBlob(blob, ""), /Dateiname darf nicht leer sein/);
  assert.throws(() => downloadBlob(blob, "card.png"), /Laufzeitumgebung nicht unterstützt/);
  await assert.rejects(() => copyPngBlobToClipboard(blob), /Bild-Zwischenablage wird in diesem Browser nicht unterstützt/);
  await assert.rejects(() => sharePngBlob(blob, "Title", "Body"), /Direktes Teilen von Bilddateien/);

  // Simulate navigator.share AbortError
  const prevNav = globalThis.navigator;
  const prevFile = globalThis.File;
  class FakeFile {
    constructor(parts, name, opts) {
      this.parts = parts;
      this.name = name;
      this.type = opts?.type ?? "";
    }
  }
  try {
    Object.defineProperty(globalThis, "File", { value: FakeFile, configurable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        canShare: () => true,
        share: async () => {
          const err = new Error("User dismissed share sheet");
          err.name = "AbortError";
          throw err;
        },
      },
      configurable: true,
    });
    assert.equal(canWebShareFiles(), true);
    const res = await sharePngBlob(blob, "Wrapped", "Text");
    assert.deepEqual(res, { shared: false, cancelled: true });

    Object.defineProperty(globalThis, "navigator", {
      value: {
        canShare: () => true,
        share: async () => {
          throw new Error("Permission denied");
        },
      },
      configurable: true,
    });
    await assert.rejects(() => sharePngBlob(blob, "Wrapped", "Text"), /Permission denied/);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: prevNav, configurable: true });
    Object.defineProperty(globalThis, "File", { value: prevFile, configurable: true });
  }
});

function createRecordingCanvasContext() {
  const ops = { fillText: [], fillRect: 0, stroke: 0, arc: 0 };
  const gradientStub = { addColorStop() {} };
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "16px sans-serif",
    textAlign: "left",
    textBaseline: "top",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    setTransform() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    bezierCurveTo() {},
    clip() {},
    setLineDash() {},
    arc() {
      ops.arc += 1;
    },
    fill() {},
    stroke() {
      ops.stroke += 1;
    },
    fillRect() {
      ops.fillRect += 1;
    },
    fillText(text) {
      ops.fillText.push(String(text));
    },
    drawImage() {},
    createLinearGradient() {
      return gradientStub;
    },
    createRadialGradient() {
      return gradientStub;
    },
    createPattern() {
      return null;
    },
    measureText(str) {
      const sizeMatch = /(\d+)px/.exec(ctx.font);
      const px = sizeMatch ? Number(sizeMatch[1]) : 16;
      return { width: String(str).length * px * 0.56 };
    },
  };
  return { ctx, ops };
}

test("renderWrappedCard renders all 7 templates across both formats and themes without errors", async () => {
  const report = decodeWrappedReport(makeRichReport());
  const emptyReport = decodeWrappedReport(makeEmptyReport());
  const assets = { images: new Map(), failedUrls: [], coverPalette: null };

  for (const tpl of WRAPPED_TEMPLATES) {
    for (const format of ["story", "square"]) {
      for (const theme of ["signal", "paper"]) {
        const { ctx, ops } = createRecordingCanvasContext();
        const fakeCanvas = {
          width: 0,
          height: 0,
          getContext(type) {
            return type === "2d" ? ctx : null;
          },
        };
        await renderWrappedCard(
          fakeCanvas,
          report,
          { template: tpl.id, theme, format, showUser: true, showCounts: true },
          assets,
        );
        const dims = getWrappedCanvasDimensions(format);
        assert.equal(fakeCanvas.width, dims.width);
        assert.equal(fakeCanvas.height, dims.height);
        assert.ok(ops.fillText.length >= 6, `${tpl.id}/${format}/${theme} drew text`);
        assert.ok(ops.fillRect >= 1);
      }
    }
  }

  // Test all 8 persona emblems & showCounts=false + empty report
  const emblems = [
    "moon_wave",
    "infinite_vinyl",
    "compass_radar",
    "tonearm_disc",
    "strobe_bars",
    "sunrise_pulse",
    "flame_metro",
    "prism_beat",
  ];
  for (const emblem of emblems) {
    const r = makeRichReport();
    r.persona.emblem = emblem;
    const { ctx, ops } = createRecordingCanvasContext();
    const fakeCanvas = { width: 0, height: 0, getContext: () => ctx };
    await renderWrappedCard(
      fakeCanvas,
      decodeWrappedReport(r),
      { template: "persona", theme: "neon", format: "story", showUser: false, showCounts: false },
      assets,
    );
    assert.ok(ops.fillText.some((t) => t.includes("Nachtschwärmer")));
  }

  const { ctx: emptyCtx, ops: emptyOps } = createRecordingCanvasContext();
  const emptyCanvas = { width: 0, height: 0, getContext: () => emptyCtx };
  await renderWrappedCard(
    emptyCanvas,
    emptyReport,
    { template: "summary", theme: "vinyl", format: "square", showUser: true, showCounts: true },
    assets,
  );
  assert.ok(emptyOps.fillText.some((t) => t.includes("Noch keine Wiedergaben")));
});

test("loadWrappedAssets deduplicates URLs, tracks failedUrls loudly, and extracts coverPalette", async () => {
  await assert.rejects(() => loadWrappedAssets(makeRichReport()), /Browser-Umgebung/);

  const prevImage = globalThis.Image;
  const prevDoc = globalThis.document;
  const requestedSrcs = [];

  class MockImage {
    constructor() {
      this.crossOrigin = "";
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.onload = null;
      this.onerror = null;
    }
    set src(value) {
      requestedSrcs.push({ value, crossOrigin: this.crossOrigin });
      queueMicrotask(() => {
        if (value.includes("cover-broken.jpg")) {
          this.onerror?.();
        } else {
          this.naturalWidth = 300;
          this.naturalHeight = 300;
          this.onload?.();
        }
      });
    }
  }

  const fakePixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < fakePixels.length; i += 4) {
    fakePixels[i] = 224;
    fakePixels[i + 1] = 52;
    fakePixels[i + 2] = 110;
    fakePixels[i + 3] = 255;
  }

  try {
    Object.defineProperty(globalThis, "Image", { value: MockImage, configurable: true });
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {},
            getImageData: () => ({ data: fakePixels }),
          }),
        }),
      },
      configurable: true,
    });

    const report = makeRichReport();
    report.top_tracks[1].cover = "https://cdn.example.com/cover-broken.jpg";
    const assets = await loadWrappedAssets(decodeWrappedReport(report));

    assert.equal(requestedSrcs.every((r) => r.crossOrigin === "anonymous"), true);
    assert.ok(assets.images.has("https://cdn.example.com/cover-1.jpg"));
    assert.ok(assets.images.has("/api/uploads/avatars/logge.png"));
    assert.deepEqual(assets.failedUrls, ["https://cdn.example.com/cover-broken.jpg"]);
    assert.ok(assets.coverPalette !== null);
    assert.equal(assets.coverPalette.isLight, false);

    // Verify deduplication: cover-1.jpg appears in obsession, peak_day, top_tracks[0], top_albums[0]
    const cover1Requests = requestedSrcs.filter((r) => r.value.includes("cover-1.jpg"));
    assert.equal(cover1Requests.length, 1);

    // Verify tainted canvas getImageData error removes image & adds to failedUrls loudly
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {},
            getImageData: () => {
              throw new Error("Tainted canvas");
            },
          }),
        }),
      },
      configurable: true,
    });
    const taintedAssets = await loadWrappedAssets(decodeWrappedReport(report));
    assert.equal(taintedAssets.coverPalette, null);
    assert.equal(taintedAssets.images.has("https://cdn.example.com/cover-1.jpg"), false);
    assert.ok(taintedAssets.failedUrls.includes("https://cdn.example.com/cover-1.jpg"));
    assert.ok(taintedAssets.failedUrls.includes("https://cdn.example.com/cover-broken.jpg"));
  } finally {
    Object.defineProperty(globalThis, "Image", { value: prevImage, configurable: true });
    Object.defineProperty(globalThis, "document", { value: prevDoc, configurable: true });
  }
});
