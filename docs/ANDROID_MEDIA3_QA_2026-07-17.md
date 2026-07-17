# Android Media3 QA evidence — 2026-07-17

This is the canonical evidence and exception ledger for the published
first-party Media3 Android `1.0.3`/`10014` RC.1 and `1.0.3`/`10015` RC.2
milestones. Both are debug-signed QA artifacts, not production signing, Play
delivery, or full web-parity acceptance. The prior `1.0.2`/`10013` record
remains unchanged in
[`ANDROID_MEDIA3_QA_2026-07-16.md`](./ANDROID_MEDIA3_QA_2026-07-16.md).

## RC.1 source, workflow, and publication

- Source commit:
  `d979e9bc856dd07ae6dcc05c0dca72e0a46b660c`
- Source tree:
  `84f1e9f15cb495566a2f13904045984f57739b13`
- GitHub Actions:
  [`29559829540`](https://github.com/LoggeL/LoggeRythm/actions/runs/29559829540),
  run #14, `success`
- Run window: `2026-07-17T06:22:03Z`–`2026-07-17T06:47:21Z`
- QA job: `87819719304`
- Annotated tag and QA prerelease:
  [`android-media3-v1.0.3-rc.1`](https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.3-rc.1)
- Release policy: prerelease, intentionally not latest

The tag and release target the exact source commit above. Historical b10012
RNTP code and artifacts were not uploaded.

## ARM64 release APK identity

- File: `LoggeRythm-1.0.3-10014-arm64-Media3-QA-debug-signed.apk`
- Package: `top.logge.loggerythm`
- Version: `1.0.3` (`versionCode 10014`)
- Minimum/target SDK: 24 / 36
- Size: `27,659,704` bytes
- SHA-256:
  `92a3d4e81c2163a92139556ba2cb0e04e702eb48979c6a5c6f1e2bc27b3e62d5`
- ABI: `arm64-v8a` only
- Build: nondebuggable release variant, embedded Hermes, R8/minification and
  resource shrinking
- Alignment: `zipalign -c -P 16 4` passed
- Signing: APK Signature Scheme v2, one Android debug signer
- Signer certificate SHA-256:
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
- Embedded backend origin: `https://loggerythm.logge.top`
- Metro/runtime check: no Metro reverse or runtime dependency

The downloaded GitHub ARM64 artifact's embedded `SHA256SUMS` verified every
component before release staging. The Android debug certificate makes this APK
suitable only for sideloaded QA.

## Diagnostic identities

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| R8 mapping | 35,201,416 | `6c1c41268823e9bd73231e7278a5e394a75314df68e2a67fed5c6422b505510a` |
| R8 resources | 1,891,427 | `cd7ac33d9edafdc62fdaa617d4fefc7bb5d0c846e28b08649d616b7bdd731781` |
| ARM64 native debug symbols | 5,085,415 | `6fba283caa9e0f9191df60561962087ab79977e605cf0d0478abcef06dc2a0b5` |
| Hermes source map | 7,341,282 | `0294bf8f7188afcacc8806c026b7c329963c4c17f02bfd7a6892591201eb0d6c` |

## GitHub workflow artifacts

| Artifact | ID | Stored bytes | GitHub digest |
|---|---:|---:|---|
| `loggerythm-native-arm64-v8a-apk` | 8399245749 | 24,469,415 | `sha256:d986d63f0e01f6d5d23af55114c029634d85923991f14e6fdb0b58616716fe3b` |
| `loggerythm-native-x86_64-qa-apk-and-smoke` | 8399246306 | 13,743,908 | `sha256:2c003730cf3d6ea7303b33976e67f4c5c25fb1bc4d11f8df5b3ffaef194826d7` |
| `android-native-test-reports` | 8399246599 | 232,764 | `sha256:55bfa05f0610301eaf8e154bd1c4d43f7f05736eebe5000da2496e25ae62a96b` |

The workflow artifacts expire on `2026-10-15T06:22:05Z`. The QA prerelease
publishes the canonical ARM64 APK and durable diagnostics independently of that
retention window.

## Published release verification

GitHub release `355522934` was published at `2026-07-17T07:05:47Z` with
`draft=false` and `prerelease=true`. GitHub's latest-release endpoint still
resolves to production tag `v1.0.1`, so this QA milestone was not promoted to
latest. All seven assets report `state=uploaded`; their GitHub SHA-256 digests
match the staged files and the attached checksum manifest.

- QA evidence ZIP: 1,849,350 bytes, SHA-256
  `6bdabab421bd26b11b89a94b4b01bc1c51d569e23d304fde02f9cf37b22b91a3`
- Checksum manifest: 642 bytes, SHA-256
  `c5e59bb2219c022a0c5c550be189bd13f614e266c79886e81402110e5d4909e9`

## Automated evidence

- TypeScript, repository-wide ESLint, dependency audit, Expo Doctor, branding,
  clean prebuild, and the shared browser queue contract passed.
- Mobile Vitest: 152 files, 1,050 passing tests, one explicit todo.
- API: OpenAPI/current Android contract plus 50/50 full tests.
- Native release JVM: 115/115.
- API 36 connected instrumentation: 7/7 locally and in GitHub Actions,
  including encrypted persistence/cold restore and the hostile
  separate-package/separate-UID controller matrix.
- First-party artifact gate: 445 source/generated files and 1,095 APK entries,
  zero findings.
- ARM64 release lint, app tests, Hermes/R8/resource shrinking, manifest trust
  boundaries, private Headless service, WorkManager/reboot wiring, Android Auto
  metadata, APK signature, and 16 KiB alignment passed.
- GitHub x86_64 QA APK: `1.0.3`/`20014`, 28,104,794 bytes, SHA-256
  `27f6ef71346558c944801690b95a1419ed1e5047c706407ed46867b941e7527f`.
  It passed API 36 cold/warm standalone startup under PID `5742`, production
  origin, embedded UI, no Metro, and a clean app-scoped runtime-log audit.

## Downloaded-APK emulator evidence

The exact downloaded GitHub ARM64 APK was clean-installed on the Android Studio
API 36 ARM64 `emulator-5554`. Cold and warm standalone startup passed under PID
`17023` with the production origin, embedded Hermes UI, nondebuggable package,
no Metro dependency, and no app-scoped crash, ANR, fatal signal, native, or
ReactNativeJS failure. This was a startup-only signed-out run; the empty journal
did not provide authenticated playback-event delivery evidence.

Detailed dummy-input UI QA passed:

- portrait and short-landscape Login remained reachable and scrollable;
- Login/Register switching, Register fields, submit, and back switch remained
  reachable in both orientations;
- empty Login submit remained disabled and synthetic input enabled it;
- production purple LoggeRythm branding rendered;
- the compatibility gate stopped before authentication and displayed the
  server/v2 incompatibility state;
- auto-rotation was restored after the test;
- app-scoped logs contained no crash, ANR, fatal signal, or credential leak.

One narrow manual special case remains open: a separate Register
password-mismatch submit assertion was interrupted by landscape
Gboard/window-focus behavior.

## Production observations

Read-only probes on 2026-07-17 returned HTTP 404 from:

- `https://loggerythm.logge.top/api/version`
- `https://loggerythm.logge.top/.well-known/assetlinks.json`

The Android compatibility gate therefore stopped before authentication. No
production credential was entered or sent.

## Explicit exceptions and unclaimed coverage

- No authenticated v10014 playback, account switch, logout, mutation, or
  filesystem/queue/cache/notification/Auto cleanup is claimed.
- The real encrypted playback-event journal has not been device-proven through
  authenticated kill, lock, background, reboot, offline retry, 401, account
  replacement, or full-capacity conditions; PLAYER-16 remains open.
- QA-04 closes because exact-source local and GitHub-hosted API 36
  `connectedAndroidTest` both pass 7/7 with retained reports.
- QA-18 remains open because this release ledger explicitly lacks the
  authenticated playback/journal/lifecycle matrices above.
- No production-signing key, signed AAB, Play installation, upgrade,
  downgrade, or rollback was tested.
- Android Auto DHU/Assistant, cold service-only Auto restore, voice search,
  calls/audio focus, Bluetooth/headset, notification/media-button lifecycle,
  and locked real playback remain open.
- Full TalkBack/switch access, 200% font, tablet/foldable, high contrast,
  reduced motion, broader network faults, real radio recovery, and automatic
  bad-track skip remain open.
- App Links remain unverifiable while `assetlinks.json` returns 404.
- Credential rotation/history remediation remains an external security action.

These exceptions are authoritative: absence from a failure log is not evidence
that an unexecuted matrix passed.

## Published RC.2 — Stats, locale, auth, and custom server

This section records the newer Stats/Locale/Auth/Custom-Server parity milestone
without rewriting the published RC.1 evidence above.

- Source commit:
  `7692aa80b443abb3c18ced03a2654e9ce127f64d`
- Source tree:
  `7768d727c4fb24625a93871e21cabc1cd8b369a3`
- GitHub Actions:
  [`29573843730`](https://github.com/LoggeL/LoggeRythm/actions/runs/29573843730),
  `success` in 20m03s
- QA job: `87863676334`
- Annotated tag and QA prerelease:
  [`android-media3-v1.0.3-rc.2`](https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.3-rc.2)
- Release policy: non-draft prerelease, explicitly not latest
- Uploaded APK asset ID: `480278869`
- Uploaded APK digest:
  `sha256:5f3f06de497b046a8682fce0e35f40edd1f7c2188d17bd0b141d6f765c055c17`

The annotated remote tag peels to the source commit above. GitHub rebuilt the
exact source, repeated the contract/unit/lint/release gates, verified the ARM64
APK structure, and passed an API 36 x86_64 cold/warm emulator run before the
local exact-APK asset and checksum were published.

### APK identity

- Package/version: `top.logge.loggerythm`, `1.0.3` (`versionCode 10015`)
- File:
  `LoggeRythm-1.0.3-10015-arm64-CustomServer-RC2-debug-signed.apk`
- Size: `27,661,624` bytes
- SHA-256:
  `5f3f06de497b046a8682fce0e35f40edd1f7c2188d17bd0b141d6f765c055c17`
- Minimum/target SDK: 24 / 36
- ABI: `arm64-v8a` only
- Build: nondebuggable release variant, embedded Hermes, R8/minification and
  resource shrinking
- Alignment: `zipalign -c -P 16 4` passed
- Signing: APK Signature Scheme v2, one Android debug signer
- Signer certificate SHA-256:
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
- Embedded signed-out default: `https://loggerythm.logge.top`; Login/Register
  support an explicit canonical HTTPS-root origin
- First-party artifact gate: 454 source/generated files and 1,095 APK entries,
  zero findings

This APK was rebuilt after the final Search-history and Stats-contract P1
corrections. Earlier local b10015 hashes are obsolete and were not uploaded.

### Contract and regression evidence

- OpenAPI v2: 58 component schemas, 73 paths, 82 operations; FastAPI export and
  generated Android TypeScript artifact are drift-clean.
- Listening Stats has an explicit `UserStats` response, generated Android wire
  types, a repository-owned Android domain mapper, and one shared web/Android
  fixture covering empty history, numeric/text legacy IDs, missing media,
  empty legacy copy, malformed shapes, period invariants, and bounded credits.
- Legacy negative stored duration is normalized to zero and artist credits are
  bounded to 100 at the response boundary, preventing a historical row from
  turning the complete stats response into a validation failure.
- Locale-dependent providers stay behind persisted-locale hydration or a
  bounded two-second German fallback. Search history hydration is keyed by
  account plus locale, so a language switch cannot overwrite history while its
  reload is in flight.
- Mobile: TypeScript, repository-wide ESLint, dependency/branding gates, 155
  Vitest files / 1,090 passing tests plus one explicit todo (1,091 total).
- API: 58 passing tests.
- Web: 13 passing tests, TypeScript, ESLint, and a 15-page Next.js production
  build.
- Native debug and release JVM: 116/116 in each variant; release lint, app
  tests, Hermes/R8/resource shrinking, and ARM64 assembly passed with 589
  actionable Gradle tasks (446 executed, 143 up-to-date).

### Exact-APK emulator evidence

The exact APK above was clean-installed on Android Studio's API 36 ARM64
`emulator-5554` with fingerprint
`google/sdk_gphone64_arm64/emu64a:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys`.
The package was nondebuggable, rendered its embedded Hermes bundle without
Metro, and passed app-scoped crash/ANR/native/ReactNativeJS log audits.

#### Production-default startup

Cold and warm startup remained in PID `31441`. The Login server field exposed
the exact production default `https://loggerythm.logge.top`; the run remained
signed out and deliberately sent no credentials because anonymous
`GET /api/version` still returns HTTP 404. Evidence is retained under
`mobile/android/app/build/qa/rc2-final-exact/prod-startup`.

#### Disposable custom-server sign-in

The same APK selected the disposable HTTPS origin
`https://chan-resulted-towers-hawaii.trycloudflare.com` and passed cold/warm
startup plus login under PID `31723`. The harness verified:

- the selected origin remained visible and compatibility completed before the
  credential-bearing request;
- authentication mounted all five tabs and Profile;
- first-party Media3 setup reached commands/listeners ready; and
- the Android Auto browse library became ready.

The disposable account was isolated from production. Evidence is retained
under `mobile/android/app/build/qa/rc2-final-exact/custom-login`.

Manual continuation on the same exact installed APK then proved the persisted
origin lifecycle:

- force-stop/restart restored the custom session through
  `GET /api/auth/me` HTTP 200;
- Profile displayed the complete custom HTTPS origin;
- `POST /api/auth/logout` returned HTTP 200;
- Login reset to `https://loggerythm.logge.top`; and
- another restart remained on the production default.

#### Redirect-negative boundary

A disposable redirecting compatibility server produced the expected harness
failure and visible compatibility network error. Server-side observation found
only `GET /api/version` HTTP 302: the redirect target received no request and
the selected server received no login/register POST. This proves the exact APK
stopped before credentials at the tested redirect boundary.

#### Evidence identities

| Evidence | Summary SHA-256 | Screenshot SHA-256 | UI XML SHA-256 | Log SHA-256 |
|---|---|---|---|---|
| Production startup | `028f3b27bcc1f93edd12012cfa8bb441b959b35455078b159448164a12149966` | `4ed67538de9b0577f68ec0de8654355401ef74c82e020c1075d66142cc83c56e` | `e39028af9738308dcb65db9f19c68ebc7b891cf07081e8966a9aa49693bbb663` | `5c700c99a7634dbb9d269533f8c8f5bfd729812794d74837210e9a18ce14f15f` |
| Custom login | `10b834c220553c85517ac2b9a346c69dc4f2733fae48fccd8ccfcddd63625393` | `5418891a15bd7941099e80ed073871c0b1f3bf1395cbc1fb28e25f1f62a2b40a` | `44d0613fd8790b0442b2723919fd863ed7591c5e72070540663a9470cd189188` | `8820254586c8e3710b371eb3f996db5275382f972b6723dd40b11406bf9d481b` |

### RC.2 exceptions

- Production still returns anonymous HTTP 404 from `/api/version`; no real
  production credential was sent, and production-authenticated API/media
  behavior remains untested.
- Disposable custom-server login, force-stop `/me` restoration, full-origin
  Profile disclosure, logout reset, Media3 setup, and Android Auto browse-tree
  readiness are proven on the exact APK. Custom registration/invite,
  pending-approval UI, authoritative 401/403, Forget, account replacement, and
  production/app-link intent delivery remain open.
- No real track playback, playback-event journal delivery, full account-switch
  or filesystem/cache/notification cleanup, Android Auto DHU/Assistant, or full
  accessibility/device matrix is claimed.
- English restart/native Auto/notification-channel switching remains open.
- The APK is debug-certificate signed and is suitable only for a GitHub
  prerelease. It must not be marked latest or represented as production
  signing/AAB/Play delivery.

## Android MVP stabilization closeout

The immediate product scope was reduced on 2026-07-17 to the stable core
already represented by RC.2: custom-server compatibility and login, stored
session restore, logout/production reset, five tabs, Profile, Media3, and
Android Auto. The broader parity matrix remains a durable backlog rather than
an RC.2 acceptance claim.

Two credential-safe QA modules now make that core repeatable:

- `mobile/scripts/auth_qa_server.py` owns a disposable in-memory auth server.
  Its public listener exposes only ordinary version/auth/likes/playlists
  routes; approval, one-shot faults, invites, and seed data are direct
  in-process controls. The evidence ledger contains only sequence, method,
  path, and status.
- `mobile/scripts/android_auth_qa.py` exposes one fixed `run_auth_qa` seam for
  production-default, incompatible-preflight, invalid/valid custom login,
  five-tab/Profile, force-stop restore, logout/reset, and crash/privacy checks.
  Generated credentials reach Android only through `adb shell sh` standard
  input. Registration/pending, authoritative 401/403, and root cleanup
  forensics are explicitly reported as deferred instead of being silently
  counted as passed.

All 60 Python QA-tool tests pass, and `npm run check` now includes this suite.
One final exact-RC.2 attempt on `emulator-5554` was correctly classified as an
infrastructure failure before app interaction: two fresh Cloudflare quick
tunnels never forwarded `/api/version` to the local disposable server, so the
ledger remained empty and no credential-bearing request occurred. That failed
external tunnel attempt adds no Android acceptance claim and does not replace
the successful exact-APK custom-login/restore/Profile/logout evidence recorded
above. RC.2 therefore remains the stable MVP artifact; no byte-identical APK
was republished merely to attach host-side QA tooling.
