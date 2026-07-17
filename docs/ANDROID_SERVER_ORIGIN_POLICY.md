# Android server-origin policy

**Status:** Accepted, source-tested, and device-accepted for custom-server
sign-in on the exact RC.2 APK on 2026-07-17. Registration, pending approval,
authoritative `401`/`403`, and the complete hostile-link matrix remain broader
QA work.

## Decision

The Android sign-in and registration forms expose one visible **Server URL**
field. `https://loggerythm.logge.top` remains the embedded signed-out default,
but a user may select another trusted LoggeRythm-compatible server. A
user-selected destination must be a canonical HTTPS root origin: no HTTP
downgrade, path, query, fragment, embedded credential, malformed authority, or
port `0` is accepted.

The form value remains local to the authentication attempt. Before either
login or registration can send an email, password, display name, or invite
code, the client performs an unauthenticated, no-store compatibility preflight
against the exact selected origin. Only a compatible response permits the
credential-bearing request. Validation, preflight, or authentication failure
does not persist or activate the draft origin.

After authentication succeeds, the captured cookie and its exact origin are
stored together as `StoredSession`. `StoredSession.origin` is the sole
persistent server authority; there is no independent saved server preference
that could disagree with the credential. Session hydration activates that
origin before API, Query, media/player, offline-download, background Headless,
or Android Auto work can use it.

## Invariants

- A release build embeds `https://loggerythm.logge.top` as its default and
  rejects a non-production build-time override. Runtime enrollment is a
  separate, explicit user action and remains HTTPS-only.
- A stored session is accepted only when its origin is already an exact
  canonical HTTPS root. A legacy token with no trustworthy origin migrates only
  to the production origin.
- Compatibility preflight is credential-free and happens before login,
  registration, ordinary API calls, authenticated media headers, or stream
  requests. Missing, malformed, redirected, or incompatible metadata fails
  closed.
- Cookie attachment is exact-origin only. Runtime API/media URL resolution and
  Query, recent-search, queue, cache, download, and Android Auto scopes use the
  session origin.
- Logout captures the departing origin, clears local session and account/player
  state first, resets the runtime to the production default, and only then
  performs its bounded, no-auth consistency call to the departing server.
  Authoritative `401`, **Forget session**, account deletion, and defensive
  account replacement also remove the session authority; logout, `401`, and
  Forget return the signed-out runtime to the production default.
- Profile and pending-approval UI disclose the complete effective origin,
  including scheme and non-default port, rather than only a hostname.
- An originless `loggerythm://register` invite is relative to the Server URL
  visibly selected on the form. A trusted production HTTPS registration link
  selects production; if it replaces a custom draft, the app clears every
  credential/invite field first and announces the switch.
- External navigation links can select content or an invite, never an arbitrary
  server. During a custom authenticated session, production HTTPS and
  originless app-scheme navigation links are rejected so their content IDs
  cannot be silently rebound to the custom account.
- JavaScript API traffic, Media3 streaming, and explicit offline downloads
  reject HTTP redirects instead of allowing credentials or account identifiers
  to cross an origin boundary.

## Evidence

- `mobile/src/config.ts`, `mobile/src/config.test.ts`,
  `mobile/src/api/session.ts`, and `mobile/src/api/session.test.ts` enforce
  canonical enrollment and stored-session origins.
- `mobile/src/api/compatibility.ts`, `mobile/src/api/client.ts`, their auth and
  cleanup tests, and `mobile/src/auth/AuthContext.tsx` enforce compatibility
  preflight before credentials, exact-origin cookies, session-owned activation,
  and local-first reset/cleanup.
- `mobile/src/screens/LoginScreen.tsx`, `mobile/src/auth/inviteLink.ts`, and
  their tests cover the visible selector, relative app-scheme invite behavior,
  and credential-clearing production-link switch.
- `mobile/src/navigationLinking.ts` and its tests block external-link rebinding
  while a custom session is active.
- `mobile/src/screens/ProfileScreen.tsx`,
  `mobile/src/screens/PendingApprovalScreen.tsx`, and their component tests
  expose the full effective origin.
- `mobile/plugins/withNoHttpRedirects.js`, the native secure DataSource tests,
  and offline-client tests enforce no-redirect transport boundaries.

## Exact release-APK acceptance

The exact nondebuggable ARM64 `1.0.3`/`10015` APK (27,661,624 bytes, SHA-256
`5f3f06de497b046a8682fce0e35f40edd1f7c2188d17bd0b141d6f765c055c17`)
passed the disposable-compatible-server flow on API 36:

- cold and warm custom-origin startup stayed in PID `31723`;
- credential-free compatibility completed before login, then login mounted all
  five tabs, Profile, Media3, and the Android Auto browse tree;
- a force-stop/restart restored the exact custom session through
  `GET /api/auth/me` HTTP 200, and Profile displayed the complete HTTPS origin;
- logout sent the bounded no-auth `POST /api/auth/logout` to the departing
  origin, received HTTP 200, reset the form to production, and remained on the
  production default after another restart; and
- the redirect-negative server observed only `GET /api/version` HTTP 302. No
  redirect target and no authentication POST were reached, while the app showed
  the compatibility network failure.

Durable harness evidence is under
`mobile/android/app/build/qa/rc2-final-exact/prod-startup` and
`mobile/android/app/build/qa/rc2-final-exact/custom-login`. Production still
returns anonymous HTTP 404 from `/api/version`, so no real production
credential was sent.

This closes custom-server sign-in enrollment and persisted-origin/reset proof
for the exact APK. Custom registration/invite submission, pending-origin UI,
authoritative `401`/`403`, account replacement, production/app-link intent
delivery, and the full media/filesystem/lifecycle matrix remain tracked by the
broader parity QA gates.
