# Android Auto repair, version 1.0.14

## Scope and evidence

This release repairs LoggeRythm's native Media3 Android Auto integration. Source
and automated Android evidence are recorded here separately from a physical
head-unit acceptance test. The starting source is `73bdf5a`; the preceding
published APK is version 1.0.13, versionCode 10058.

The native implementation is reviewed with Claude Code, model
`claude-opus-5-5`. Android Auto uses the platform/legacy media-browser bridge as
well as Media3 controllers, so allowing the framework to create that bridge and
authorizing the actual connecting controller are separate decisions. The root
also returns an already-completed future: Media3's legacy root lookup waits on
the main thread, so waiting there for encrypted-state restoration deadlocks the
restore callback. Child loading waits for restoration after the connection is
established.

The native service supports paged browsing, title/artist/album/playlist search,
voice selection, play-from-ID, standard Play with an empty queue, pause, seek,
next/previous, stop and resume. Requests resolve only to account-bound native
sources. Expected request failures carry German/English messages and, where
applicable, an action to open LoggeRythm on the phone.

Car-created queues preserve private Track metadata for the phone UI and encrypted
restoration. Those sidecars never enter external Media3 metadata or browse/search
results. Old encrypted browse records without private extras remain readable. Selecting
such a legacy list explicitly asks the user to open the phone app once to refresh
it; it cannot create a new queue lacking the Track required by the phone UI.

The JavaScript publisher now waits for the native library acknowledgement.
A failed playlist refresh reports a specific error while retaining usable
same-account content and publishing healthy sections. Deleted playlists are
removed when the current playlist index confirms deletion. Offline downloads
remain restricted to verified files. The native remote command configuration
includes Stop alongside Play/Pause, Next, Previous and Seek.

## Dependency review, 2026-10-22

`shell-quote` and `source-map-js` are updated to patched versions in the lockfile.
The production-path audit has two narrowly identified exceptions under its
existing policy for advisories that have no patched release:

| Advisory | Installed path | Exposure and decision |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Expo CLI / Metro file map / micromatch / braces 3.0.3 | Build-time file globs for this trusted checkout. No native playback or Android network parsing uses braces. Upstream `first_patched_version` is null. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo CLI and Expo code-signing-certificates / node-forge 1.4.0 | Expo development/certificate tooling. This APK uses native HTTPS and Android APK signature validation; it does not use Expo Updates or node-forge for runtime trust. Upstream `first_patched_version` is null. |

These are residual build-tool advisories, not claims that the packages are fixed.
Do not accept untrusted build globs/projects or remote certificate/update inputs
through the affected tooling. The gate still rejects other moderate-or-higher
advisories, a package mismatch, and stale exceptions. Remove each exception when
a fixed version is available. Regression coverage checks those boundaries.

## Verification status

Verified locally on 2026-10-22:

- TypeScript, ESLint, 1,240 mobile tests and 86 QA-tool tests pass (one existing TODO).
- 259 API tests and generated API/Android contract checks pass; the shared web
  queue contract, web typecheck and scoped lint pass.
- 149 native JVM tests, release lint, hostile-controller lint and optimized
  ARM64 release build pass. Expo Doctor passes all 21 checks.
- All 9 native device tests pass on an Android 16 / API 36 ARM64 emulator. The
  legacy-browser scenario decodes private WAV files with the real ExoPlayer,
  exercises browse/search/voice/transport/error paths and restores a car-created
  queue after a service restart, including its private Track metadata.
- A separate-UID untrusted controller obtains the framework binder but is denied
  the session and cannot read data or mutate playback.
- The source/APK gate scans 505 source files and 1,095 APK entries with no findings.
- The local candidate uses the existing release signer, SHA-256
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

The release notes record final APK digest, CI, startup and update-installation
results, including the CI-assigned versionCode. This repository report describes the tested implementation; the release
asset is the installation artifact.

A physical car/phone projection session and the Google Desktop Head Unit remain
unverified. No physical Android phone is attached; the emulator only contains the
Android Auto stub, not a working projection host. Instrumentation does not prove
vehicle-specific discovery, microphone/assistant routing, USB/Bluetooth behavior,
or live authenticated production streaming. Search covers the published library,
not an unrestricted remote catalog. Existing bounded bridge/state limits remain
in force (5,000 browse nodes, 1,000 children per container, 2 MB serialized input).

## References

- [MediaLibraryService](https://developer.android.com/media/media3/session/serve-content)
- [Voice actions](https://developer.android.com/training/cars/media/voice-actions)
- [Actionable car errors](https://developer.android.com/training/cars/media/errors)
- [Desktop Head Unit testing](https://developer.android.com/training/cars/testing/dhu)
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
