import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthHref,
  isPlaylistInvitePath,
  isValidPlaylistInviteToken,
  sanitizeNextPath,
} from "../src/lib/authRedirect.ts";

test("sanitizeNextPath allows safe relative in-app paths including playlist invites", () => {
  assert.equal(
    sanitizeNextPath("/playlist/join/abcdefghijklmnop"),
    "/playlist/join/abcdefghijklmnop",
  );
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
    "https://evil.example/playlist/join/abc",
    "http://evil.example",
    "//evil.example/playlist/join/abc",
    "/\\evil.example",
    "javascript:alert(1)",
    "playlist/join/abc",
    "/playlist/join/abc\r\nSet-Cookie: x=1",
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
    buildAuthHref("/login", "/playlist/join/demo-token-123456"),
    "/login?next=%2Fplaylist%2Fjoin%2Fdemo-token-123456",
  );
  assert.equal(
    buildAuthHref("/register", "/playlist/join/demo-token-123456"),
    "/register?next=%2Fplaylist%2Fjoin%2Fdemo-token-123456",
  );
});

test("playlist invite path and token validators enforce contract format", () => {
  assert.equal(isPlaylistInvitePath("/playlist/join/demo-token-123456"), true);
  assert.equal(isPlaylistInvitePath("/playlist/join/demo-token-123456/"), true);
  assert.equal(isPlaylistInvitePath("/playlist/42-roadtrip"), false);
  assert.equal(isPlaylistInvitePath("/playlist/join/a/b"), false);

  assert.equal(isValidPlaylistInviteToken("demo-token-123456"), true);
  assert.equal(isValidPlaylistInviteToken("AbC_1234567890-xyz"), true);
  assert.equal(isValidPlaylistInviteToken("short"), false);
  assert.equal(isValidPlaylistInviteToken("bad token with spaces 123456"), false);
  assert.equal(isValidPlaylistInviteToken("bad/token/slash/12345678"), false);
  assert.equal(isValidPlaylistInviteToken("a".repeat(129)), false);
});
