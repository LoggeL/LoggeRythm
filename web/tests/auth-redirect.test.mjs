import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthHref, sanitizeNextPath } from "../src/lib/authRedirect.ts";

test("sanitizeNextPath allows safe relative in-app paths", () => {
  assert.equal(sanitizeNextPath("/library?tab=playlists"), "/library?tab=playlists");
  assert.equal(
    sanitizeNextPath("/playlist/12-roadtrip?tab=tracks#top"),
    "/playlist/12-roadtrip?tab=tracks#top",
  );
  assert.equal(sanitizeNextPath("/"), "/");
});

test("sanitizeNextPath rejects external URLs, protocol-relative paths, backslashes, control chars, and auth loops", () => {
  for (const unsafe of [
    null,
    undefined,
    "",
    "   ",
    "https://evil.example/playlist/12-roadtrip",
    "http://evil.example",
    "//evil.example/playlist/12-roadtrip",
    "/\\evil.example",
    "javascript:alert(1)",
    "playlist/12-roadtrip",
    "/playlist/12-roadtrip\r\nSet-Cookie: x=1",
    "/login",
    "/login?next=/foo",
    "/register",
    "/forgot-password",
    "/reset-password",
  ]) {
    assert.equal(sanitizeNextPath(unsafe), null, `Expected rejection for: ${String(unsafe)}`);
  }
});

test("buildAuthHref appends encoded next path only when safe and non-root", () => {
  assert.equal(buildAuthHref("/login", null), "/login");
  assert.equal(buildAuthHref("/login", "/"), "/login");
  assert.equal(buildAuthHref("/login", "//evil.example"), "/login");
  assert.equal(
    buildAuthHref("/login", "/playlist/12-roadtrip"),
    "/login?next=%2Fplaylist%2F12-roadtrip",
  );
  assert.equal(
    buildAuthHref("/register", "/library?tab=playlists"),
    "/register?next=%2Flibrary%3Ftab%3Dplaylists",
  );
});
