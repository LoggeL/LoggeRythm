# Android Media3 QA evidence — 2026-07-16

This manifest records the exact evidence and deliberate exceptions for the
first public, source-owned Media3 Android candidate. It is QA evidence, not a
production-signing or full web-parity acceptance claim.

## Source and publication

- Integration checkpoint: `ce78af49397e66031e9e6ac13a510c1a6e186ebc`
- Public clean-root candidate commit: `3d134b318b54d6c1c0a205ffbb0b9d854a4660f6`
- Candidate Git tree: `9793c25f0da00e2a1ef48fdf23705565baad2d8e`
- Annotated tag: `android-media3-v1.0.2-rc.1`
- Release branch documentation head: `ed2e17ddcff1cf9b94ca39cea24b39a8cae9da0b`
- GitHub prerelease:
  <https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.2-rc.1>
- Accepted remote QA workflow:
  <https://github.com/LoggeL/LoggeRythm/actions/runs/29528436134>
  (`success`, head `c94f80f`, 2026-07-16T19:33:01Z–19:55:20Z). This later
  workflow/security head retains the b10013 player source and replaces the
  earlier failed shell/line-splitting attempts; it is not represented as an
  exact rebuild of the older published tag.

The public candidate is a clean root rather than a descendant of the local
RNTP checkpoint. Historical b10012 and its derivative patch were not uploaded.

## APK identity

- File: `LoggeRythm-1.0.2-10013-arm64-Media3-QA-debug-signed.apk`
- Package: `top.logge.loggerythm`
- Version: `1.0.2` (`versionCode 10013`)
- Size: `27,363,030` bytes
- SHA-256:
  `2bd490e96b0e0f58c42f8d300f662ad48ae2838002c5c623975638f6315d9378`
- GitHub asset digest:
  `sha256:2bd490e96b0e0f58c42f8d300f662ad48ae2838002c5c623975638f6315d9378`
- ABI: ARM64 only (`arm64-v8a`); 18 native libraries and no x86/x86_64 or
  armeabi-v7a payload
- Runtime: embedded Hermes bytecode; no Metro `:8081` or `10.0.2.2` marker
- Build: nondebuggable release variant with R8/minification and resource
  shrinking
- Signing: APK Signature Scheme v2, one Android debug-certificate signer
- Alignment: `zipalign -c -P 16 4` passed
- Backend origin embedded in the candidate:
  `https://loggerythm.logge.top`

The debug certificate makes this artifact suitable only for sideloaded QA. It
is not eligible for production or Play distribution.

## Device image

- Android Studio AVD: `LoggeRythm_API_36` (`emulator-5554`)
- Model/device: `sdk_gphone64_arm64` / `emu64a`
- Android: 16, API 36
- ABI: `arm64-v8a`
- Fingerprint:
  `google/sdk_gphone64_arm64/emu64a:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys`

## Executed evidence

- Mobile gate: TypeScript and ESLint passed; 149 Vitest files produced 1,003
  passing tests and one explicit todo.
- Native JVM gate: 59/59 first-party Media3 tests passed.
- Native device gate: 5/5 Keystore/encrypted-persistence instrumentation tests
  passed on the API 36 ARM64 AVD after the empty-timeline serializer fix.
- Remote native gate: the API 36 x86_64 job independently executed the same
  5/5 instrumentation tests and 59/59 release JVM tests, then uploaded the
  digest-bearing HTML/XML reports.
- Android release gate: native/app JVM tests, release lint, R8, resource
  shrinking, and `assembleRelease` passed.
- First-party artifact gate: 426 source/generated files and 1,090 APK entries
  scanned with zero RNTP/forbidden findings.
- Static artifact inspection verified package/version, nondebuggable mode,
  ARM64-only ABI policy, Hermes, production origin, signature, alignment,
  MediaLibraryService actions, Android Auto metadata, launcher, and branding.
- Standalone smoke uninstalled and freshly installed b10013, then passed cold
  and warm embedded-bundle startup with no Metro dependency or app-scoped
  crash/ANR/native/ReactNativeJS failure.
- Android Studio visual inspection reached the branded German Login surface in
  portrait, exercised short landscape without clipping the form controls, and
  restored portrait.
- R8 `mapping.txt` (`33,070,116` bytes), `resources.txt` (`1,876,754` bytes),
  ARM64 native-debug-symbol ZIP (`5,085,458` bytes; SHA-256
  `e1b1900dd61fdea32b2f85ca8d6adce6da9d5c90ad62d05e2b882997829d10a9`),
  Hermes source map (`7,269,930` bytes; SHA-256
  `6bc717669402fdf6569fe8de513d61e8c9883a4b814a35e8a7e5e52d99b72b1b`),
  individual checksums, smoke JSON, screenshot, parity TODO, and Media3
  migration record are attached to the GitHub prerelease with matching remote
  asset digests.
- Remote ABI evidence includes an ARM64 `10013` APK (27,363,022 bytes; SHA-256
  `476bf23ae92f8526a0cbfc7d54dbea4fd27524f8f67823a252dfea0def0d0650`) and a
  deliberately emulator-only x86_64 `20013` APK (27,808,112 bytes; SHA-256
  `1833549a387dcce6189a4a8d8716a566e915fdd9d0fb886f3cf7424458ed85ee`). The
  x86_64 artifact passed cold/warm nondebuggable standalone startup with the
  exact production origin, embedded UI, no Metro, and a clean runtime audit.
  Workflow artifacts are retained until 2026-10-14 with GitHub digests
  `cac35bf…` (ARM64 package), `55d960ce…` (x86_64/smoke package), and
  `db3306c7…` (test reports).

## Backend observations

Read-only probes on 2026-07-16 returned HTTP 404 for both:

- `https://loggerythm.logge.top/api/version`
- `https://loggerythm.logge.top/.well-known/assetlinks.json`

The app therefore stopped at its compatibility boundary before authentication.
No production credential was submitted during the final b10013 traversal.

## Manual exceptions and unclaimed coverage

- No authenticated b10013 playback, account switch, logout, mutation, or
  filesystem/queue/cache/notification/Auto cleanup was claimed because the
  production compatibility endpoint is absent.
- No production-signing key, signed AAB, upgrade, downgrade, rollback, or Play
  installation was tested.
- The first-party instrumentation set covers Keystore/persistence round trips;
  it does not yet cover a hostile separate-UID controller, reboot, media
  buttons, calls/audio focus, Bluetooth, or locked playback.
- Media Controller Test, Desktop Head Unit, Assistant, cold service-only Auto
  restore, and voice-query acceptance remain open.
- Full TalkBack/switch access, 200% font, tablet/foldable, high-contrast, and
  reduced-motion matrices remain open.
- Real multi-minute stream, radio recovery, malformed/partial audio, network
  transitions, repeat/background combinations, and automatic bad-track skip
  remain open on the first-party candidate.
- Production currently cannot verify App Links while `assetlinks.json` is 404.
- Credential rotation/history remediation is an external security action and
  was not performed by this QA run.

These exceptions are authoritative: absence from the failure log must not be
used to claim that an unexecuted matrix passed.
