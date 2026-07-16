# Android session-token threat model

**Status:** Accepted target architecture for the React Native parity phase;
first-party implementation is in progress and the mandatory release conditions
below are not yet satisfied

**Reviewed:** 2026-07-16

**Applies to:** `top.logge.loggerythm`, the production origin
`https://loggerythm.logge.top`, React Native API calls, Media3 streaming,
background playback, process restoration, and Android Auto browsing

## 1. Decision

The Android client owns one manually managed `sf_session` cookie. JavaScript
captures it after login, stores an origin-bound representation in Android
SecureStore, and adds it to ordinary API requests. The player seam is now an
owned TypeScript `PlayerPort` plus a first-party Kotlin/Media3 module. The
strict adapter keeps credentials in private JavaScript/native source vaults and
publishes only sanitized immutable snapshots.

This design is accepted for the parity phase because it preserves one session
authority and supports background Media3 playback without a second native
login. Raw cookie material still crosses the React Native bridge when an
authenticated source is installed, so the bridge remains a sensitive accepted
risk. The native service accepts that source only under an exact account/origin
binding and injects its Cookie through a private DataSource at open time. The
binding and atomic account-cleanup lifecycle are still being integrated and
must not be treated as release-proven.

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
3. Every API, stream, and authenticated-source request first checks the
   server-contract version. Ordinary API calls then read the single in-memory
   session and construct a Cookie header with origin/scheme validation. React
   Native's native cookie jar is disabled through `credentials: 'omit'`.
4. The owned adapter separates a sanitized queue/browse item from its private
   `{ uri, Cookie }` source. The public snapshot, React hooks, logs, and Media3
   metadata never receive that private source object.
5. JavaScript binds an exact account scope plus canonical HTTPS origin before
   installing a source. Kotlin revalidates that binding and URI, retains the
   Cookie only in its private per-URI vault, and injects it through the strict
   Media3 DataSource when the URI is opened.
6. A bounded versioned persistence codec and Android Keystore AES-GCM/no-backup
   atomic store pass 19 focused tests, including corruption/key-loss handling.
   Queue/browse lifecycle integration and cold restoration are still in
   progress; isolated codec/store tests are not process-death evidence.
7. Logout/account switch must be one awaitable transaction that clears live
   Media3/notification state, queue, timer, encrypted queue/tree/session,
   private source vaults, cache, errors, SecureStore, and account-scoped JS
   state before a replacement authentication attempt. The cross-language
   transaction is under implementation and remains a release gate.

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
| Competing cookie jars resurrect an old login | API requests use one explicit session and `credentials: 'omit'`; 401 invalidation is revision-guarded; failed on-disk deletion retry cannot erase a newer login | A backend-issued stateless JWT remains valid server-side until expiry unless the backend adds revocation |
| Plaintext token in SharedPreferences/backups | Session uses SecureStore; the first-party bounded persistence codec/store uses Keystore AES-GCM, atomic no-backup storage, strict corruption/key-loss cleanup, and passes 19 focused tests; `allowBackup=false` and SecureStore backup rules remain configured | The first-party store is not yet lifecycle/device proven. Rooted devices, runtime instrumentation, or a compromised OS are outside the supported trust boundary |
| Header exposed through Media3 metadata, Android Auto, or Binder | The strict Native-v1 mapper and immutable snapshot omit sources; Cookie data stays in private JS/native source vaults and a strict DataSource injects it only at URI open | Full bind/rebind/logout lifecycle and hostile cross-UID instrumentation have not yet proven the shipped boundary end to end |
| Exported media service accepts arbitrary control or private browse access | Service connection policy rejects untrusted controllers; trusted external controllers receive standard commands only; privileged update/header commands require the app UID; pure policy tests pass | The service must remain exported for Media3/Auto discovery. Real separate-UID instrumentation is a production gate, not an accepted omission |
| Token leaks to logs, UI dumps, crash reports, intents, share payloads, or artifacts | Config errors redact supplied origins; runtime logs expose only a sanitized origin marker; smoke/session harnesses redact UI text and credentials; working-tree known-secret scans pass; no backup; no token-bearing intent/share code is intended | Comprehensive automated artifact/log/intent scanning is still incomplete. Crash-reporting SDKs must not be added without a data review |
| Old account survives logout or fast re-login | Existing JS cleanup remains serialized and fail-closed; the first-party service has binding, private-vault, persistence, and awaitable-cache-clear building blocks | The single JS/Kotlin cleanup transaction is still being integrated. Rebuilt release-APK account-switch plus filesystem/cache/notification/tree evidence is mandatory |
| Compatibility mismatch causes old client to mis-handle auth/media | Public `GET /api/version` is checked before session load and before API/authenticated-source access; malformed/missing/incompatible responses fail loudly without mutating the session | Production currently returns 404 because v2 exists only locally. Metadata and the v2 playlist contract require one atomic production deployment by an identified authority |
| Test credentials or signing material enter source/history | Screenshot tooling requires environment credentials and does not print the email; production keystore is not configured in source | A previously committed production test credential must be rotated/revoked and its Git-history disposition decided. Debug-signed QA APKs are not production releases |
| A bridge observer or future dependency reads the token in process | The player seam is first-party; the strict adapter exposes only sanitized snapshots and keeps source credentials in private vaults | Raw Cookie material still crosses the React Native bridge on source installation. Removing that crossing is future hardening; review any networking, logging, WebView, analytics, or native-bridge dependency change |

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

- Atomically deploy `GET /api/version` plus the complete v2 playlist contract,
  identify the deployment authority, and verify compatible v2 metadata from
  the exact production backend revision.
- Finish first-party session binding, persistence lifecycle, and the single
  awaitable JS/Kotlin cleanup boundary.
- Preserve the clean-prebuilt source/generated gate result: 421 files, zero
  RNTP findings, and only `:loggerythm_player-native` in the Gradle player
  graph. Then make the unpacked-APK gate pass with no RNTP classes, package
  strings, or derivative code.
- Verify first-party automatic-audio-cache deletion at a real logout/account
  boundary, including device-level filesystem evidence.
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

Removing the remaining Cookie bridge crossing is a planned hardening seam, not
a prerequisite if every condition above is green and the residual bridge risk
is explicitly accepted by the release owner. Sleep commands, headless event
delivery, Android Auto sibling/cold-tree behavior, and device instrumentation
remain functional release gates independently of this security acceptance.

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
  `mobile/src/player/playerPort.ts`, `mobile/src/player/nativePlayerPort.ts`,
  `mobile/src/player/setup.test.ts`, `mobile/src/player/browseTree.test.ts`
- Native encryption/header/controller controls:
  `mobile/modules/loggerythm-player/android/src/main/java/top/logge/loggerythm/player/LoggeRythmEncryptedPersistence.kt`,
  `LoggeRythmPersistedState.kt`, `LoggeRythmCookieVault.kt`,
  `LoggeRythmSecureDataSource.kt`, and `LoggeRythmMediaLibraryService.kt`
- Manifest/network/backup policy:
  `mobile/app.json`, `mobile/app.config.js`,
  `mobile/plugins/withNoBackup.js`,
  `mobile/plugins/withFirstPartyPlayer.js`
- First-party removal/artifact gate:
  `mobile/scripts/verify_first_party_player_gate.mjs`
- Emulator and release evidence:
  `docs/ANDROID_EMULATOR_QA_2026-07-15.md`,
  `mobile/scripts/android_smoke.py`,
  `mobile/scripts/android_session_qa.py`

Re-review this threat model whenever session format, backend authentication,
API origin selection, streaming/DataSource construction, player persistence,
Android Auto/controller policy, backup behavior, crash/analytics tooling, or
distribution signing changes.
