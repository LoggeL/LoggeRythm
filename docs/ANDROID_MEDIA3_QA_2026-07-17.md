# Android Media3 QA evidence — 2026-07-17

This is the canonical evidence and exception ledger for the first-party Media3
Android `1.0.3`/`10014` milestone. It records a debug-signed QA prerelease, not
production signing, Play delivery, or full web-parity acceptance. The prior
`1.0.2`/`10013` record remains unchanged in
[`ANDROID_MEDIA3_QA_2026-07-16.md`](./ANDROID_MEDIA3_QA_2026-07-16.md).

## Source, workflow, and publication

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
