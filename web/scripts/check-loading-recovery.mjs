import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let sessionFails = true;
  let searchFails = true;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body;
    let status = 200;
    if (url.pathname === "/api/auth/me") {
      status = sessionFails ? 503 : 200;
      body = sessionFails ? { detail: "Test: Sitzung nicht erreichbar" } : { id: "qa", email: "qa@example.test", display_name: "QA", is_approved: true, is_admin: false };
    } else if (url.pathname.startsWith("/api/search")) {
      status = searchFails ? 503 : 200;
      body = searchFails ? { detail: "Test: Suchdienst nicht erreichbar" } : url.pathname === "/api/search/artist" && url.searchParams.get("q") === "tab regression" ? [{ id: "123", name: "Test Artist", picture: null }] : [];
    } else if (url.pathname === "/api/me/settings") {
      body = { crossfade_enabled: false, crossfade_duration_sec: 0 };
    } else if (url.pathname === "/api/cached-tracks") {
      body = { ids: [] };
    } else if (["/api/genres", "/api/me/likes", "/api/playlists", "/api/home/release-radar"].includes(url.pathname)) {
      body = [];
    } else {
      throw new Error(`Missing QA fixture: ${url.pathname}`);
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(process.env.LR_QA_URL || "http://localhost:3107/search");
  await page.getByRole("heading", { name: "Sitzung konnte nicht geladen werden" }).waitFor();
  sessionFails = false;
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await page.getByRole("heading", { name: "Suche", exact: true }).waitFor();
  await page.getByPlaceholder("Titel, Künstler, Alben, Playlists…").fill("loading regression");
  await page.getByRole("alert").filter({ hasText: "Titel konnten nicht geladen werden" }).waitFor();
  assert.equal(await page.getByText("Keine Ergebnisse für", { exact: false }).count(), 0);
  searchFails = false;
  for (const label of ["Titel", "Alben", "Künstler", "Playlists"]) {
    await page.getByRole("alert").filter({ hasText: `${label} konnten nicht geladen werden` }).getByRole("button", { name: "Erneut versuchen" }).click();
  }
  await page.getByText("Keine Ergebnisse für", { exact: false }).waitFor();
  assert.equal(await page.getByRole("alert").filter({ hasText: "konnten nicht geladen werden" }).count(), 0);
  await page.getByPlaceholder("Titel, Künstler, Alben, Playlists…").fill("tab regression");
  await page.getByText("Test Artist", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Titel", exact: true }).click();
  await page.getByText("Keine Ergebnisse für „tab regression“.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/loggerythm-search-recovery.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: session recovery, search errors and retries, empty results, no browser exceptions");
} finally {
  await browser.close();
}
