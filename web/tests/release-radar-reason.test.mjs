import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { decodeReleaseRadar } from "../src/lib/releaseRadar.ts";
import { QUERY_CACHE_BUSTER } from "../src/lib/queryPersistence.ts";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/searchDecoders") {
      return nextResolve(new URL("../src/lib/searchDecoders.ts", import.meta.url).href, context);
    }
    if (specifier === "@/lib/releaseRadar") {
      return nextResolve(new URL("../src/lib/releaseRadar.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { api, ApiError } = await import("../src/lib/api.ts");
resolver.deregister();

const reason = { kind: "played", artist_id: "7", artist_name: "Bekannte Künstlerin", play_count: 4 };
const track = {
  id: "3135556",
  title: "Neuer Song",
  artist: "Fremder",
  artist_id: "999",
  artists: [{ id: "999", name: "Fremder" }],
  album: "Neues Album",
  album_id: "12",
  cover: "",
  duration_sec: 180,
  preview_url: null,
  rank: 5,
  release_date: "2026-03-01",
  loudness_gain_db: null,
  loudness_lufs: null,
  loudness_peak: null,
  radar_reason: reason,
};

test("radar tracks keep every track field and the reason they are in the radar", () => {
  const payload = [track, { ...track, id: "2", radar_reason: { kind: "followed", artist_id: "8", artist_name: "", play_count: 0 } }];

  const radar = decodeReleaseRadar(payload);

  // The validated response is handed on unchanged: a radar track is a normal
  // Track that additionally carries `radar_reason`.
  assert.equal(radar, payload);
  assert.deepEqual(radar[0].radar_reason, reason);
  // The watched source artist may differ from the track's primary artist.
  assert.equal(radar[0].artist_id, "999");
  assert.equal(radar[0].radar_reason.artist_id, "7");
  // An unknown source artist name is reported as "" and never invented.
  assert.equal(radar[1].radar_reason.artist_name, "");
  assert.deepEqual(decodeReleaseRadar([]), []);
});

test("a radar response without reasons names the track and the cause", () => {
  const withoutReason = Object.fromEntries(
    Object.entries(track).filter(([field]) => field !== "radar_reason"),
  );
  assert.throws(
    () => decodeReleaseRadar([track, withoutReason]),
    /radar\[1\]\.radar_reason fehlt – der Server nennt nicht, warum dieser Song im Release Radar ist\./,
  );
});

test("malformed radar containers, tracks and reasons fail at their exact path", () => {
  for (const payload of [null, {}, { tracks: [] }, "", 3]) {
    assert.throws(() => decodeReleaseRadar(payload), /radar muss eine Liste sein/);
  }
  for (const entry of [null, [], "broken"]) {
    assert.throws(() => decodeReleaseRadar([entry]), /radar\[0\] muss ein Objekt sein/);
  }
  for (const id of [undefined, null, "", "  ", 42]) {
    assert.throws(() => decodeReleaseRadar([{ ...track, id }]), /radar\[0\]\.id muss eine nichtleere Track-ID sein/);
  }
  for (const radarReason of [null, [], "followed"]) {
    assert.throws(
      () => decodeReleaseRadar([{ ...track, radar_reason: radarReason }]),
      /radar\[0\]\.radar_reason muss ein Objekt sein/,
    );
  }
  const cases = [
    [{ kind: "liked" }, /radar\[0\]\.radar_reason\.kind muss "followed" oder "played" sein/],
    [{ kind: undefined }, /radar\[0\]\.radar_reason\.kind muss/],
    [{ artist_id: "" }, /radar\[0\]\.radar_reason\.artist_id muss eine numerische Künstler-ID als Text sein/],
    [{ artist_id: 7 }, /radar\[0\]\.radar_reason\.artist_id muss/],
    [{ artist_id: "abc" }, /radar\[0\]\.radar_reason\.artist_id muss/],
    [{ artist_name: undefined }, /radar\[0\]\.radar_reason\.artist_name muss Text sein/],
    [{ artist_name: null }, /radar\[0\]\.radar_reason\.artist_name muss Text sein/],
    [{ play_count: -1 }, /radar\[0\]\.radar_reason\.play_count muss eine nichtnegative ganze Zahl sein/],
    [{ play_count: 1.5 }, /radar\[0\]\.radar_reason\.play_count muss/],
    [{ play_count: "4" }, /radar\[0\]\.radar_reason\.play_count muss/],
    [{ play_count: undefined }, /radar\[0\]\.radar_reason\.play_count muss/],
  ];
  for (const [change, message] of cases) {
    assert.throws(
      () => decodeReleaseRadar([{ ...track, radar_reason: { ...reason, ...change } }]),
      message,
    );
  }
});

test("the radar endpoint returns reasoned tracks and keeps the refresh contract", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, { cache }) => {
    requests.push({ url, cache });
    return Response.json([track]);
  });

  assert.deepEqual(await api.releaseRadar(), [track]);
  assert.deepEqual((await api.releaseRadar(true))[0].radar_reason, reason);
  assert.deepEqual(requests, [
    { url: "/api/home/release-radar", cache: undefined },
    { url: "/api/home/release-radar?refresh=true", cache: "no-store" },
  ]);
});

test("the radar endpoint rejects a response without reasons as an API error", async (t) => {
  const withoutReason = Object.fromEntries(
    Object.entries(track).filter(([field]) => field !== "radar_reason"),
  );
  t.mock.method(globalThis, "fetch", async () => Response.json([withoutReason]));

  await assert.rejects(
    api.releaseRadar(),
    (error) =>
      error instanceof ApiError &&
      error.status === 200 &&
      error.message.startsWith("API /home/release-radar: Ungültige Release-Radar-Antwort: radar[0].radar_reason fehlt") &&
      error.cause instanceof Error,
  );
});

test("persisted caches from before radar reasons are discarded", () => {
  // Radar tracks cached by an older build have no `radar_reason`; a new cache
  // buster makes the persister drop them instead of restoring them.
  assert.notEqual(QUERY_CACHE_BUSTER, "loggerhythm-ui-v1");
  assert.equal(QUERY_CACHE_BUSTER, "loggerhythm-ui-v2");
});
