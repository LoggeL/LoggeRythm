import assert from "node:assert/strict";
import test from "node:test";
import { compileInto } from "./support/compile.mjs";

const stubs = {};
await compileInto(
  stubs,
  [
    ["./authRedirect", "src/lib/authRedirect.ts"],
    ["googleAuth", "src/lib/googleAuth.ts"],
  ],
  "googleAuth",
);

const { buildGoogleAuthStartHref, googleOAuthErrorMessage } = await import(stubs.googleAuth);

test("buildGoogleAuthStartHref builds relative start URLs with safe next paths and invites", () => {
  assert.equal(
    buildGoogleAuthStartHref({ origin: "/login" }),
    "/api/auth/google/start?origin=%2Flogin",
  );
  assert.equal(
    buildGoogleAuthStartHref({ origin: "/login", nextPath: "/" }),
    "/api/auth/google/start?origin=%2Flogin",
  );
  assert.equal(
    buildGoogleAuthStartHref({
      origin: "/register",
      nextPath: "/library?tab=playlists",
      invite: " ABC12345 ",
    }),
    "/api/auth/google/start?origin=%2Fregister&next=%2Flibrary%3Ftab%3Dplaylists&invite=ABC12345",
  );
});

test("buildGoogleAuthStartHref strips unsafe next paths", () => {
  for (const unsafe of [
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ]) {
    assert.equal(
      buildGoogleAuthStartHref({ origin: "/login", nextPath: unsafe }),
      "/api/auth/google/start?origin=%2Flogin",
    );
  }
});

test("googleOAuthErrorMessage maps known errors and surfaces unknown codes loudly", () => {
  assert.equal(googleOAuthErrorMessage(null), null);
  assert.equal(googleOAuthErrorMessage(undefined), null);
  assert.equal(googleOAuthErrorMessage("   "), null);

  for (const code of [
    "access_denied",
    "invalid_state",
    "invalid_invite",
    "google_email_unverified",
    "google_account_conflict",
    "google_exchange_failed",
    "google_invalid_token",
    "google_auth_failed",
    "not_configured",
  ]) {
    const message = googleOAuthErrorMessage(code);
    assert.ok(message && message.length > 0, `Missing message for ${code}`);
  }

  const unknown = googleOAuthErrorMessage("unexpected_upstream_code");
  assert.ok(unknown && unknown.includes("unexpected_upstream_code"));
});
