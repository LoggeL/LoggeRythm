// Regenerate the README screenshots against a running LoggeRythm instance.
//
//   npm run screenshots            # from web/
//   node scripts/capture-screenshots.mjs
//
// Env (all optional, sensible prod defaults):
//   LR_BASE      base URL           (default https://spotifrei.logge.top)
//   LR_EMAIL     login email
//   LR_PASSWORD  login password
//   LR_HEADLESS  "1" to run headless (default: headed, so audio decodes and
//                the frequency visualizer shows real bars)
//
// Fail-loud policy (see repo CLAUDE.md): every required step throws with a
// specific message rather than silently producing a blank/wrong screenshot.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// web/scripts/ -> repo/docs/screenshots
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
const BASE = (process.env.LR_BASE || "https://spotifrei.logge.top").replace(/\/$/, "");
const EMAIL = process.env.LR_EMAIL || "hyper.xjo@gmail.com";
const PASSWORD = process.env.LR_PASSWORD || "404noswagfound";
const HEADLESS = process.env.LR_HEADLESS === "1";

// Originals are 2880×1800 — a 1440×900 viewport at DPR 2 reproduces that exactly.
const VIEWPORT = { width: 1440, height: 900 };
const DPR = 2;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  // ---- Login -------------------------------------------------------------
  console.log(`→ login at ${BASE}/login as ${EMAIL}`);
  // The submit is a hydrated React onSubmit — clicking before hydration does a
  // native GET that never authenticates. Retry the whole attempt a couple of
  // times to ride out hydration / transient network hiccups.
  let loggedIn = false;
  for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('input[type="email"]');
    await wait(2500); // let React hydrate so the onSubmit handler is attached
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
      loggedIn = true;
    } catch {
      const msg = await page.locator("p.text-red-400").first().textContent().catch(() => null);
      if (msg) throw new Error(`Login rejected: ${msg}`); // real credential error — don't retry
      console.warn(`! login attempt ${attempt} did not leave /login; retrying`);
    }
  }
  if (!loggedIn) throw new Error("Login never left /login after 3 attempts.");
  console.log("✓ logged in");

  // ---- Open a playlist and start playback --------------------------------
  const firstPlaylist = page.locator('aside a[href^="/playlist/"]').first();
  await firstPlaylist
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {
      throw new Error("No playlist link found in the sidebar — cannot build the queue view.");
    });
  const playlistHref = await firstPlaylist.getAttribute("href");
  console.log(`→ opening playlist ${playlistHref}`);
  await firstPlaylist.click();
  await page.waitForURL(`**${playlistHref}`);

  const playAll = page.getByRole("button", { name: "Alle abspielen" });
  await playAll.waitFor({ state: "visible" });
  await playAll.click();

  // Wait for the stream to actually decode — the frequency visualizer is flat
  // until real audio flows. Deezer's first buffer can take a few seconds.
  console.log("→ waiting for audio to actually play (currentTime > 0)");
  await page
    .waitForFunction(
      () => {
        const a = document.querySelector("audio");
        return a && !a.paused && a.currentTime > 0.4;
      },
      { timeout: 30_000 },
    )
    .catch(() => {
      throw new Error("Audio never started playing — visualizer would be flat. Aborting.");
    });
  await wait(2500); // let the spectrum build and any queue toast fade out

  // Make sure the queue sidebar is open (it drives the right-hand column).
  const queueToggle = page.getByRole("button", { name: "Warteschlange" }).first();
  if ((await queueToggle.count()) > 0) {
    const open = await page.locator('[data-queue-open="true"]').count();
    if (!open) await queueToggle.click().catch(() => {});
    await wait(600);
  }

  // "Alle abspielen" pops a "Zur Warteschlange hinzugefügt" toast — let it clear
  // so it doesn't overlap the track list.
  await page
    .locator("text=Zur Warteschlange hinzugefügt")
    .waitFor({ state: "detached", timeout: 6000 })
    .catch(() => {});
  await shoot(page, "01-queue.png");

  // ---- Fullscreen now-playing --------------------------------------------
  console.log("→ opening fullscreen now-playing");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("spotifrei:open-now-playing")),
  );
  await wait(800);
  // Land on the "Jetzt läuft" tab — that's the one with the radial visualizer.
  const nowTab = page.getByRole("button", { name: "Jetzt läuft" });
  if ((await nowTab.count()) > 0) await nowTab.click().catch(() => {});
  await wait(2500); // radial visualizer needs a moment of live audio
  await shoot(page, "02-now-playing.png");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("spotifrei:close-now-playing")),
  );
  await wait(600);

  // ---- Offline markers ---------------------------------------------------
  // A per-row marker only checks whether the track's stream URL has a key in the
  // "sf-audio" Cache — the cached *bytes* are irrelevant to the marker. Actually
  // downloading a whole playlist means dozens of server-side Deezer decrypts,
  // which prod rate-limits and which can drop the session (it logs the browser
  // out mid-run). So instead seed the cache with lightweight placeholder entries
  // for the smallest playlist, flag it downloaded, and reload so markers render.
  console.log("→ seeding offline cache for the markers view");
  const small = await pickSmallestPlaylist(page);
  const seeded = await page.evaluate(async (pl) => {
    const res = await fetch(`/api/playlists/${pl.id}`, { credentials: "include" });
    if (!res.ok) throw new Error(`playlist fetch failed: ${res.status}`);
    const data = await res.json();
    const tracks = data.tracks || [];
    const cache = await caches.open("sf-audio");
    for (const t of tracks) {
      // Same key useDownloads writes: <origin>/api/tracks/<id>/stream
      await cache.put(
        `/api/tracks/${encodeURIComponent(t.id)}/stream`,
        new Response(new Blob([""])),
      );
    }
    // Mark the playlist itself downloaded so the header shows "✓ Offline".
    localStorage.setItem(
      "sf_downloads",
      JSON.stringify({ [pl.id]: { name: data.name, total: tracks.length } }),
    );
    return { name: data.name, count: tracks.length };
  }, small);
  console.log(`→ seeded ${seeded.count} tracks of "${seeded.name}"`);

  await page.goto(`${BASE}${small.href}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page
    .waitForFunction(
      () => document.querySelectorAll('[aria-label="Offline verfügbar"]').length >= 3,
      { timeout: 15_000 },
    )
    .catch(() => console.warn("! offline markers did not render; capturing current state"));
  await wait(1200);
  await shoot(page, "03-downloads.png");

  await browser.close();
  console.log("✓ done — screenshots written to docs/screenshots/");
}

// Read every sidebar playlist link and return the one with the fewest (>0)
// tracks, parsed from its "N Titel" label. Keeps the offline download quick.
async function pickSmallestPlaylist(page) {
  const items = await page.$$eval('aside a[href^="/playlist/"]', (links) =>
    links.map((a) => {
      const href = a.getAttribute("href") || "";
      const m = a.textContent?.match(/(\d+)\s*Titel/);
      // "/playlist/1-logges-kulturtipp" -> id "1" (see lib/slugs.playlistIdFromParam)
      const id = href.replace("/playlist/", "").split("-")[0];
      return { href, id, count: m ? Number(m[1]) : 0 };
    }),
  );
  const withTracks = items.filter((i) => i.href && i.count > 0);
  if (withTracks.length === 0) {
    throw new Error("No non-empty playlist found in the sidebar.");
  }
  return withTracks.sort((a, b) => a.count - b.count)[0];
}

async function shoot(page, name) {
  const path = join(OUT_DIR, name);
  await page.screenshot({ path });
  console.log(`  ✓ ${name}`);
}

main().catch((err) => {
  console.error("✗ capture failed:", err.message);
  process.exit(1);
});
