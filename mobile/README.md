# LoggeRythm — Android app

Native Android client for the LoggeRythm (SpotiFrei) backend, built with Expo /
React Native. Uses [`@rntp/player`](https://rntp.dev) (React Native Track Player
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

## Configure the backend URL

The app talks to the FastAPI backend directly (not through the Next.js proxy).

- **Emulator:** default is `http://10.0.2.2:8000` (the host machine's localhost).
- **Physical device:** open the **Server** field on the login screen and enter
  your PC's LAN or Tailscale address, e.g. `http://192.168.178.20:8000` or your
  Tailscale IP. The value is remembered.

Cleartext (`http://`) traffic is enabled in the Android build so a local backend
works without TLS.

## Build & run

```bash
cd mobile
npm install
npx expo prebuild --platform android   # generates android/, runs the Android Auto plugin
npm run android                         # build + install + launch on device/emulator
```

Or build just the APK:

```bash
cd android
./gradlew assembleDebug                 # → android/app/build/outputs/apk/debug/app-debug.apk
```

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
endpoint). The client captures that cookie value on login, persists it in
AsyncStorage, and resends it as a `Cookie` header on every request.

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
