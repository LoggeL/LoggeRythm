# Android session-token threat model

**Status:** Accepted architecture for the React Native parity phase, with
mandatory release conditions below

**Reviewed:** 2026-07-16

**Applies to:** `top.logge.loggerythm`, the production origin
`https://loggerythm.logge.top`, React Native API calls, Media3 streaming,
background playback, process restoration, and Android Auto browsing

## 1. Decision

The Android client currently owns one manually managed `sf_session` cookie.
JavaScript captures it after login, stores an origin-bound representation in
Android SecureStore, adds it to ordinary API requests, and passes a Cookie
header to the native player only for authenticated media URLs and Android Auto
browse items.

This design is accepted for the parity phase because it preserves one session
authority and supports background Media3 playback without introducing a second
native login. It is not the desired final security boundary. When the patched
player seam becomes first-party, cookie storage and authenticated DataSource
construction should move fully into the native service so raw session material
no longer crosses the React Native bridge.

The current architecture is not approved for a production release merely
because this document exists. The release conditions in section 6 remain
mandatory.

## 2. Assets and security objectives

| Asset | Required property |
|---|---|
| Session token/cookie | Confidential; sent only to its exact HTTPS origin; one account owns it at a time |
| Authenticated stream headers | Available to Media3 while needed; absent from public metadata, logs, intents, and plaintext preferences |
| Queue and Android Auto tree | Account-scoped; encrypted at rest because they can contain private library metadata and authenticated URLs |
| Query/search/library state | Bound to server origin and account; deleted before another account can authenticate |
| MediaSession | Usable by legitimate system/trusted media controllers without granting privileged mutation or private metadata to arbitrary apps |
| Release artifact/evidence | Contains no credentials, test passwords, plaintext session snapshots, or production signing secrets |

Availability of playback is important, but it must not win over account
isolation. If cleanup cannot prove that the departing account's state is gone,
an account switch fails closed before the replacement login.

## 3. Trust boundaries and data flow

1. `POST /api/auth/login` runs without an existing session. JavaScript parses
   the response's `Set-Cookie` only after the response body passes its decoder.
2. The client stores a versioned object containing the token, exact origin, and
   Secure-cookie state under `lr.session.v1` in Expo SecureStore. The former
   AsyncStorage token is migrated once and deleted.
3. Every API, stream, and authenticated-header request first checks the
   server-contract version. Ordinary API calls then read the single in-memory
   session and construct a Cookie header with origin/scheme validation.
   React Native's native cookie jar is disabled through `credentials: 'omit'`.
4. For audio, JavaScript passes `{ uri, headers }` on the selected MediaItem.
   The RNTP bridge necessarily sees that header. Native code removes request
   headers from public Media3 metadata/extras and keeps them in an internal
   URI-to-header store used by the authenticated DataSource.
5. Queue process restoration serializes the header-bearing media descriptor
   only into an Android Keystore AES-GCM protected player snapshot. Android Auto
   browse data and its headers use a separate encrypted browse-tree snapshot.
6. Logout/account switch deletes the persisted queue before connecting to any
   surviving service, clears the encrypted Auto tree/headers, connects and
   pauses/clears live Media3/notification state, clears timers/cache/errors,
   deletes persistence again, clears SecureStore and account-scoped JS data,
   and only then permits a new authentication attempt.

Trust boundaries:

- The production FastAPI service is trusted to issue and validate the cookie.
- Android Keystore and the app UID sandbox are trusted on a non-rooted device.
- React Native JavaScript and the first-party native module are in the same
  application trust domain, but their bridge is treated as a sensitive-data
  boundary because debugging, crash tooling, and third-party modules can observe
  values in either runtime.
- Android Auto/system media controllers are outside the app UID. Trusted
  controllers may receive the minimal standard Media3 surface; only the app UID
  receives privileged custom commands.
- Other installed apps, arbitrary links/share payloads, logs, backups, CI, and
  Git history are untrusted.

## 4. Threats, controls, and residual risk

| Threat | Implemented control and evidence | Residual risk / decision |
|---|---|---|
| Token sent to another host or downgraded HTTP origin | URL normalization rejects credentials, query/fragment/path misuse, cross-origin session reuse, and non-HTTPS production origins; production builds hard-fail any non-canonical override; session-cookie construction rechecks the destination | No certificate pinning. Standard Android TLS trust is accepted for now; revisit only with an operational pin-rotation design |
| Competing cookie jars resurrect an old login | Native requests use one explicit session and `credentials: 'omit'`; 401 invalidation is revision-guarded; failed on-disk deletion retry cannot erase a newer login | A backend-issued stateless JWT remains valid server-side until expiry unless the backend adds revocation |
| Plaintext token in SharedPreferences/backups | Session uses SecureStore; native queue/Auto snapshots use Keystore AES-GCM; `allowBackup=false`, Expo SecureStore backup is disabled, and no-backup/data-extraction rules are generated | Rooted devices, runtime instrumentation, or a compromised OS are outside the supported trust boundary |
| Header exposed through Media3 metadata, Android Auto, or Binder | Request headers are kept out of MediaItem request metadata/extras and injected by an internal DataSource map; encrypted persistence tests assert no plaintext cookie/stable ID in preferences | A hostile cross-UID controller test has not yet proven the shipped service boundary end to end |
| Exported media service accepts arbitrary control or private browse access | Service connection policy rejects untrusted controllers; trusted external controllers receive standard commands only; privileged update/header commands require the app UID; pure policy tests pass | The service must remain exported for Media3/Auto discovery. Real separate-UID instrumentation is a production gate, not an accepted omission |
| Token leaks to logs, UI dumps, crash reports, intents, share payloads, or artifacts | Config errors redact supplied origins; runtime logs expose only a sanitized origin marker; smoke/session harnesses redact UI text and credentials; working-tree known-secret scans pass; no backup; no token-bearing intent/share code is intended | Comprehensive automated artifact/log/intent scanning is still incomplete. Crash-reporting SDKs must not be added without a data review |
| Old account survives logout or fast re-login | Cleanup is serialized; account switch tears down before new credentials; unexpected `/me` identity drift signs out; queue and Auto persistence are deleted even before normal player setup; query/mutation/search scopes are cleared; native cache eviction is awaited and filesystem-verified; a failed boundary remains mandatory before another login/register request | Rebuilt release-APK logout/account-switch and device-level cache/notification evidence is still required |
| Compatibility mismatch causes old client to mis-handle auth/media | Public `GET /api/version` is checked before session load and before API/media-header access; malformed/missing/incompatible responses fail loudly without mutating the session | Production currently returns 404. The backend endpoint must deploy before current Android source is installed |
| Test credentials or signing material enter source/history | Screenshot tooling requires environment credentials and does not print the email; production keystore is not configured in source | A previously committed production test credential must be rotated/revoked and its Git-history disposition decided. Debug-signed QA APKs are not production releases |
| A third-party React Native/native dependency reads the token in process | Dependencies are locked and the token is only passed to the API client/RNTP bridge | This is the principal accepted parity-phase risk. Reduce it by owning the native media/auth seam; review dependency changes that touch networking, logging, WebView, analytics, or native bridges |

## 5. Invariants

The implementation and tests must preserve all of these:

1. Compatibility negotiation happens before SecureStore/session access.
2. A session is valid only for the exact normalized origin recorded with it.
3. Production never permits cleartext traffic or an API-origin override.
4. The Cookie header is never placed in public Media3 metadata, UI text,
   accessibility output, intents, or share payloads.
5. Persisted queue/Auto state containing headers is encrypted with a
   non-exportable Android Keystore key and fails closed on corruption/key loss.
6. Browse-header cleanup cannot remove or repopulate a newer account's headers.
7. No replacement login starts until every mandatory local cleanup operation
   succeeds.
8. External controllers cannot invoke privileged custom session commands.
9. A release artifact is rejected if secret scanning or standalone log/runtime
   audits find session material.

## 6. Production release conditions

Before this architecture may ship as production:

- Deploy `GET /api/version` and verify compatible `v1` metadata from the
  exact production backend revision.
- Verify the now-awaitable native automatic-audio-cache deletion at a real
  logout/account boundary, including device-level filesystem evidence.
- Exercise logout and defensive account switch in a rebuilt release APK,
  proving that notification, queue, player errors, searches, query state,
  Android Auto tree, cache, and session do not survive.
- Run a hostile separate-UID Media3 controller test against the exported
  service and prove no privileged commands/private metadata are available.
- Scan source, Git history, APK/AAB, logs, UI evidence, intents/share payloads,
  and crash-reporting configuration for session material.
- Rotate/revoke the previously committed production test credential and decide
  whether repository history must be rewritten.
- Use a permanent protected production signing key and run the exact remote
  release workflow on the tagged commit.

Moving cookie ownership fully native is a planned hardening seam, not a
prerequisite if every condition above is green and the residual bridge risk is
explicitly accepted by the release owner.

## 7. Evidence map

- Session lifecycle and origin binding:
  `mobile/src/api/client.ts`, `mobile/src/api/session.ts`,
  `mobile/src/api/client.cleanup.test.ts`,
  `mobile/src/api/client.compatibility.test.ts`
- Auth/account boundary:
  `mobile/src/auth/AuthContext.tsx`, `mobile/src/auth/logout.ts`,
  `mobile/src/auth/accountSwitch.ts`, `mobile/src/auth/cleanupBarrier.ts` and
  their tests
- Player/Auto cleanup:
  `mobile/src/player/setup.ts`, `mobile/src/player/browseTree.ts`,
  `mobile/src/player/setup.test.ts`, `mobile/src/player/browseTree.test.ts`
- Native encryption/header/controller controls:
  `mobile/patches/@rntp+player+5.6.0.patch`
- Manifest/network/backup policy:
  `mobile/app.json`, `mobile/app.config.js`,
  `mobile/plugins/withNoBackup.js`,
  `mobile/plugins/withAndroidAuto.js`
- Emulator and release evidence:
  `docs/ANDROID_EMULATOR_QA_2026-07-15.md`,
  `mobile/scripts/android_smoke.py`,
  `mobile/scripts/android_session_qa.py`

Re-review this threat model whenever session format, backend authentication,
API origin selection, streaming/DataSource construction, player persistence,
Android Auto/controller policy, backup behavior, crash/analytics tooling, or
distribution signing changes.
