# LoggeRythm — Android app

Native Android client for the LoggeRythm backend, built with Expo / React Native. Uses [`@rntp/player`](https://rntp.dev) (React Native Track Player
V5, New Architecture) for native audio so you get the real Android media
experience: **lock-screen / notification media controls, background playback,
Bluetooth & headset buttons, and Android Auto**.

> `@rntp/player` V5 is commercially licensed; free for personal/educational use,
> which is what LoggeRythm is. See <https://rntp.dev/pricing>.

## Requirements

- Node 20+, JDK 17, Android SDK (with an emulator or a physical device)
- A running LoggeRythm backend (the FastAPI `api/`) reachable from the device
- A **custom dev build** — this app cannot run in Expo Go (it has native modules
  and requires the New Architecture).

## Backend URL

Release builds talk directly to the canonical FastAPI origin:
`https://loggerythm.logge.top`. The login screen does not persist an alternate
server, so a debug install cannot poison a later production install.

For a local QA bundle, set `EXPO_PUBLIC_API_BASE` before the Gradle bundle task,
for example `EXPO_PUBLIC_API_BASE=http://10.0.2.2:8000`. Never set it when
building a release artifact intended for users.

## Build & run

```bash
cd mobile
npm install
npx expo prebuild --platform android   # generates android/, runs the Android Auto plugin
npm run android                         # build + install + launch on device/emulator
```

Or build the same standalone arm64 APK produced by CI (embedded JS/Hermes;
Metro is not needed at runtime):

```bash
cd android
NODE_ENV=production ALLOW_DEBUG_RELEASE_SIGNING=true ANDROID_VERSION_CODE=10001 \
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
For the required post-login/player/Android Auto check, provide an **approved**
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

## Architecture

```
src/
  api/            fetch client (captures the sf_session cookie), typed endpoints, Track types
  auth/           AuthContext — persisted login, bootstraps the user on launch
  player/
    setup.ts       setupPlayer() — media notification, native command handling, disk cache
    controller.ts  play / queue / next-prev / repeat-shuffle + endless-radio auto-extend
    browseTree.ts  setBrowseTree() — Android Auto library (Liked Songs + Playlists)
    mediaItem.ts   Track ⇄ MediaItem mapping (full Track carried in `extras`)
  screens/        Login, Search, Library, Playlist, NowPlaying
  components/     TrackRow, MiniPlayer (persistent bottom bar)
  navigation.tsx  auth gate → tabs (Search / Library) + NowPlaying modal
plugins/
  withAndroidAuto.js   Expo config plugin: writes automotive_app_desc.xml + manifest meta-data
```

### Auth

The backend issues auth only as an `HttpOnly` `sf_session` JWT cookie (no bearer
endpoint). The client captures that cookie value on login, binds it to the
server origin, persists it with Android Keystore-backed SecureStore, and
resends it as a `Cookie` header on API and native Range-stream requests.

### Playback / queue

RNTP owns the native queue. `controller.ts` maps `Track`s to `MediaItem`s and
drives it. "Play next" / "Add to queue" are available via long-press on any
track. When radio is active, the queue auto-extends with similar tracks as it
runs low (mirrors the web player's endless radio).

### Android Auto

`browseTree.ts` publishes a browsable tree (Liked Songs + one folder per
playlist) via `setBrowseTree()`. Selecting a track in the car is handled
natively — RNTP loads its siblings as the queue and plays, no JS needed.

## Not yet ported from the web player

Crossfade, synced lyrics, party mode, offline downloads, profiles/stats. The
media core (playback, queue, radio, media bar, Android Auto) is in place first.
