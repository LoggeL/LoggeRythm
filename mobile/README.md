# LoggeRythm — Android app

Android client for the LoggeRythm backend, built with Expo / React Native and a
first-party Kotlin/AndroidX Media3 playback service. It provides native
lock-screen and notification controls, background playback, Bluetooth/headset
transport, and an Android Auto media library without placing playback authority
inside the JavaScript UI.

## Requirements

- Node 22.13+, JDK 17+, Android SDK (with an emulator or a physical device)
- A running LoggeRythm backend (the FastAPI `api/`) reachable from the device
- A backend `GET /api/version` response advertising compatibility with contract
  `v2`; missing/malformed/incompatible metadata fails closed before auth/media
- A **custom dev build** — this app cannot run in Expo Go (it has native modules
  and requires the New Architecture).

## Backend URL

Release builds talk directly to the canonical FastAPI origin:
`https://loggerythm.logge.top`. The login screen does not persist an alternate
server, so a debug install cannot poison a later production install.

For a local **development/debug** bundle, set `EXPO_PUBLIC_API_BASE`, for
example `EXPO_PUBLIC_API_BASE=http://10.0.2.2:8000`. A production
`NODE_ENV=production` bundle rejects any non-canonical origin at runtime; use a
debug/dev build for local-server QA rather than weakening a release artifact.

## Build & run

```bash
cd mobile
npm ci
npx expo prebuild --platform android   # generates Android Auto, Share, and media-volume native seams
npm run android                         # build + install + launch on device/emulator
```

Or build the same standalone arm64 APK produced by CI (embedded JS/Hermes;
Metro is not needed at runtime):

```bash
cd android
NODE_ENV=production ALLOW_DEBUG_RELEASE_SIGNING=true ANDROID_VERSION_CODE=10018 \
  ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  -PhermesEnabled=true \
  -Pandroid.enableMinifyInReleaseBuilds=true \
  -Pandroid.enableShrinkResourcesInReleaseBuilds=true
# → android/app/build/outputs/apk/release/app-release.apk
```

Production releases should supply a real keystore through
`ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and
`ANDROID_KEY_PASSWORD`, plus a monotonic `ANDROID_VERSION_CODE`. Debug signing
of a release-optimized test APK is only allowed with the explicit
`ALLOW_DEBUG_RELEASE_SIGNING=true` opt-in.

## Standalone Android smoke test

The APK is not considered tested until it has been installed and launched on
Android. With exactly one emulator/device online:

```bash
ANDROID_SDK_ROOT="$HOME/Android/Sdk" npm run smoke:android -- \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --startup-only
```

That clean-installs the APK, launches it without Metro, verifies the login UI
with UIAutomator, checks the process/logcat, and writes private evidence under
`/tmp` (directory mode `0700`, files `0600`). `--startup-only` always reports a
limited result and never claims that login was tested, even if credential
environment variables happen to be set.
For the post-login native-player and browse-tree initialization check, provide an **approved**
test account through the environment (never command-line arguments):

```bash
LOGGERYTHM_TEST_EMAIL='qa@example.test' \
LOGGERYTHM_TEST_PASSWORD='...' \
ANDROID_SDK_ROOT="$HOME/Android/Sdk" \
npm run smoke:android -- --apk android/app/build/outputs/apk/release/app-release.apk
```

Without those credentials the full command exits loudly after startup with the
exact credential blocker; `--startup-only` is the explicit limited check. The
harness removes credential variables from the child-process environment and
streams shell-quoted, character-at-a-time input to adb, so complete credentials
never appear in adb process arguments. It persists only the pre-login UI and
screenshot; post-entry UI dumps and screenshots are deliberately not written.

That harness validates startup, authentication, native-player connection, and
browse-tree publication; it does not start an audio stream or emulate an
Android Auto host. Exercise playback, queue mutation, background controls, and
the media notification on a device/emulator separately. Validate the car UI
with Google's [Desktop Head Unit](https://developer.android.com/training/cars/testing/dhu)
or [Media Controller Test app](https://developer.android.com/media/optimize/mct).

## Installed-session parity QA

After an approved account is already signed in, the credential-blind harness
reuses the installed app without reading credentials, installing an APK, or
clearing app data:

```bash
npm run qa:android-session -- \
  --serial emulator-5554 \
  --adb "$ANDROID_SDK_ROOT/platform-tools/adb" \
  --cold-start
```

It verifies secure-session restoration, all five tab roots, Profile, safe
Home/Search/Discover/Radio/Library traversal, read-only detail routes, safe
deep links, PID stability, and app-scoped crash logs. It strips all UI text and
password metadata in memory and refuses logout, deletion, create/edit,
visibility, playback, and history-clear controls. Omit `--cold-start` to leave
an existing foreground process uninterrupted.

## Architecture

```
src/
  api/            origin-bound fetch client, 71 typed endpoints, strict wire decoders/models
  auth/           persisted login, registration/invite policy, approval gate, logout/delete cleanup
  data/           TanStack Query keys/options, repositories, mutations, account/server scoping
  localization/   typed German/English catalog (German is currently active)
  player/
    setup.ts       connected native-player readiness, notification, commands, disk cache
    controller.ts  play / queue / next-prev / repeat-shuffle + race-safe radio extension/recovery
    queueContract.ts and recoveryPolicy.ts — product ordering and classified retry rules
    browseTree.ts  setBrowseTree() — Android Auto library (Liked Songs + Playlists)
    mediaItem.ts   Track ⇄ MediaItem mapping (full Track carried in `extras`)
  screens/        16 auth, Home/Search/Discover/Radio/Library/Profile/catalog/player screens
  components/     shared brand, home, search, catalog, radio, profile, track and mini-player UI
  navigation.tsx  auth/approval gate → five typed tab stacks + player/queue overlays + links
plugins/
  withAndroidAuto.js          Auto service/metadata plus production/custom link intent filters
  withSharedTextIntent.js     owned text/plain ACTION_SEND bridge
  withMusicVolumeControl.js   visible-app hardware keys target STREAM_MUSIC
  withAndroidLauncherAssets.js  format-safe production-brand launcher resources
```

### Auth

The backend issues auth only as an `HttpOnly` `sf_session` JWT cookie (no bearer
endpoint). The client captures that cookie value on login, binds it to the
server origin, persists it with Android Keystore-backed SecureStore, and
resends it as a `Cookie` header on API and native Range-stream requests.

### Playback / queue

The first-party Media3 service owns the native queue. `controller.ts` maps
`Track`s to validated `MediaItem`s through the app-owned `PlayerPort`. "Play
next" inserts after current and "Add to queue" appends after
existing manual items but before remaining context. Idle actions start
playback, Previous uses the three-second restart rule, and radio extension
deduplicates against the live queue. Stable context/manual metadata,
context-only shuffle/restore, clear-upcoming, encrypted paused process
restoration, and the same versioned golden queue cases as web are implemented
and tested. Repeat/radio/background/Android Auto/reboot combinations and rebuilt
on-device evidence for the newest queue UI remain release work; see
`docs/ANDROID_WEB_PARITY_TODO.md`.

Android deliberately does not copy the web player's desktop volume slider.
Player setup declares music/exclusive audio and becoming-noisy handling; the
generated activity binds visible-app hardware keys to the system media stream.
The system volume panel, Bluetooth route, and car own mute/volume. Rebuilt-device
playing/paused route evidence remains a release gate.

### Android Auto

`browseTree.ts` publishes a browsable tree (Liked Songs + one folder per
playlist) via `setBrowseTree()`. Transport is handled natively without a live
JavaScript command loop. The unsupported voice-search capability is not
advertised. Sibling-queue selection, encrypted cold browse-tree restore,
partial-failure refresh, mutation refresh, DHU, and large-library evidence
remain explicit release work.

### Architecture decision

Keep the Expo/React Native UI for the current MVP. The difficult platform work
is the Media3 service/session, authenticated stream headers, background
playback, and Android Auto; a Flutter rewrite would still need a native plugin
boundary for those pieces while replacing working UI code.

If this client is permanently Android-only, a later incremental migration to
Kotlin + Jetpack Compose can still be evaluated screen by screen. Rewriting the
UI is not required for a sound playback architecture: the app-owned PlayerPort
already isolates React Native from the Media3 service. Clean dependency/APK
gates plus lifecycle, Keystore, controller-trust, and Android Auto device tests
remain mandatory before publication.

## Remaining web-parity work

The current source includes Home, multi-entity race-safe Search and Spotify
Share import, Discover, genre/album/artist details, Radio, a single-owner
virtualized five-section Library, bounded single-owner virtualization for every
known long vertical track collection, playlist management, Profile/stats,
native sleep timer, complete track actions, and four-surface Now Playing with
synced Lyrics, Similar, Queue, and production-style cover treatment. Major
remaining work includes the queue/recovery lifecycle matrix, consistent rich
metadata/state across every track row, rebuilt-device large-list performance,
explicit offline downloads, public profiles, party/admin UI, crossfade,
verified App Links, accessibility/responsive matrices, Android Auto
pagination/partial-refresh tests, production backend compatibility rollout,
dependency redistribution permission, signing, and exact-commit remote release
evidence.

The authoritative prioritized acceptance backlog is
[`docs/ANDROID_WEB_PARITY_TODO.md`](../docs/ANDROID_WEB_PARITY_TODO.md).
