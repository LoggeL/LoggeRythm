# Android ABI policy

**Status:** accepted for QA and private ARM64 distribution; production signing
and Play-channel approval remain separate release decisions.

## Outputs

| Channel | ABI | Purpose | Release status |
|---|---|---|---|
| Private/QA phone APK | `arm64-v8a` only | Primary optimized phone artifact and physical-device QA | Required |
| Emulator QA APK | `x86_64` only | GitHub Actions/Android Studio cold-warm and instrumentation coverage | Required, never promoted as production |
| Play | App Bundle ABI splits | Only if Play distribution is approved | Not yet configured |
| Universal APK | Multiple ABIs | Exceptional compatibility/debug request only | Not a default release artifact |

`armeabi-v7a` and x86 are intentionally excluded. The app's supported release
hardware is 64-bit, and carrying unused 32-bit native libraries would increase
download size and multiply an untested native surface.

## Enforced gates

- The ARM64 build passes
  `-PreactNativeArchitectures=arm64-v8a`; the unpacked-APK gate requires at
  least one `lib/arm64-v8a/` entry and fails on armeabi-v7a, x86, or x86_64.
- The x86_64 build passes
  `-PreactNativeArchitectures=x86_64` and is installed only by the API 36
  emulator job for `connectedDebugAndroidTest` plus standalone cold/warm smoke.
- Artifact names include ABI and QA intent. An x86_64 artifact cannot replace or
  be attached as the production phone APK.
- Every release record includes package, `versionName`, monotonic
  `versionCode`, ABI, certificate identity, size, and SHA-256.
- If Play is approved, an AAB must be tested through generated device-specific
  splits; the existing ARM64 APK remains a separate private-distribution
  artifact rather than proof that the AAB path works.

## Current evidence

Media3 QA `1.0.3`/`10014` is a 27,659,704-byte ARM64-only published APK with
SHA-256
`92a3d4e81c2163a92139556ba2cb0e04e702eb48979c6a5c6f1e2bc27b3e62d5`.
Static inspection verified the single `arm64-v8a` ABI, nondebuggable Hermes/R8
runtime, v2 debug signature, 16 KiB alignment, production origin, Android Auto,
private Headless service, and WorkManager/reboot trust boundaries. The exact
downloaded GitHub APK passed clean-install cold/warm startup on the local API 36
ARM64 emulator under PID `17023`, with no Metro or app-scoped runtime failure.

GitHub Actions run
[`29559829540`](https://github.com/LoggeL/LoggeRythm/actions/runs/29559829540)
/ #14 succeeded on source
`d979e9bc856dd07ae6dcc05c0dca72e0a46b660c`. It executed 115/115 release JVM
tests and 7/7 connected API 36 tests, then built and installed the separate
x86_64 `20014` QA APK: 28,104,794 bytes, SHA-256
`27f6ef71346558c944801690b95a1419ed1e5047c706407ed46867b941e7527f`.
The x86_64 emulator passed cold and warm nondebuggable standalone starts with
the production origin, embedded UI, no Metro dependency, and a clean app-scoped
runtime-log audit.

The ARM64 workflow package is artifact `8399245749`, 24,469,415 stored bytes,
digest
`sha256:d986d63f0e01f6d5d23af55114c029634d85923991f14e6fdb0b58616716fe3b`.
The x86_64 package is artifact `8399246306`, 13,743,908 stored bytes, digest
`sha256:2c003730cf3d6ea7303b33976e67f4c5c25fb1bc4d11f8df5b3ffaef194826d7`.
The report package is artifact `8399246599`, 232,764 stored bytes, digest
`sha256:55bfa05f0610301eaf8e154bd1c4d43f7f05736eebe5000da2496e25ae62a96b`.
All three expire on `2026-10-15T06:22:05Z`; the
[`android-media3-v1.0.3-rc.1`](https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.3-rc.1)
QA prerelease republishes the canonical ARM64 APK and durable diagnostics.

## Prior accepted evidence

The `1.0.2`/`10013` ARM64 and `20013` x86_64 evidence remains frozen in
[`ANDROID_MEDIA3_QA_2026-07-16.md`](./ANDROID_MEDIA3_QA_2026-07-16.md). It is
historical regression evidence, not the current release identity.
