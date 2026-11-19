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

## In-app updates and the GitHub release contract

Installed release builds update themselves from the latest GitHub release of
`LoggeL/LoggeRythm` (`src/update/`, native side in
`modules/loggerythm-updater/`). Every Android release must follow this
contract, or the app refuses to offer it:

- The tag is a stable version (`vX.Y.Z`) equal to the APK's `versionName`.
- The release has exactly one `.apk` asset, and GitHub reports its
  `sha256:` digest.
- The release text contains **exactly one** line

  ```text
  Android-Versioncode: 10079
  ```

  whose number equals the APK's `versionCode`. CI builds it as
  `11000 + GITHUB_RUN_NUMBER` and checks it with `aapt dump badging` in the
  *Native Android QA* run, so take the number from the run that produced the
  uploaded APK. A missing, duplicated or malformed line is an error the app
  shows; it never guesses.

**Check before download.** The app reads the installed `versionName` and
`versionCode` from Android and compares them with the tag and the declared
`Android-Versioncode` before downloading anything. A release whose version
name is newer but whose versionCode is not higher than the installed one (for
example on a local or QA build) is shown as "installed build is newer"
instead of being downloaded, because Android would refuse to install it. A
release that declares exactly the installed versionCode is called "same build
number" instead, with a hint that its `Android-Versioncode` line is probably
wrong (not the development-build hint).
The GitHub request and reading its body share a 20 s deadline
(`GITHUB_CHECK_TIMEOUT_MS`; React Native's OkHttp client has no timeouts of
its own): when it passes, the request is aborted and the check fails with
`network` ("GitHub did not answer within 20 s"), so a stalled request never
blocks later checks or the startup report.

**Native gates after download.** `downloadAndInstall(url, digest,
versionName, versionCode)` rejects an invalid versionCode before it starts
(`updater-version-code-invalid`), then checks the downloaded APK: SHA-256
digest, package name, version name, versionCode equal to the declared one
(`updater-apk-version-code-mismatch`), versionCode higher than the installed
app (`updater-apk-not-newer`, the authoritative final gate) and the same
signing certificate. Only then does Android's installer ask for confirmation.
The install outcome is shown through the installer dialog, a notification,
or a Toast when notifications are blocked; these texts are Android string
resources in `modules/loggerythm-updater/android/src/main/res/` (English and
German). They follow the language chosen in the app, not the system
language: JS hands every activated locale (`activateLocale`, via
`onLocaleActivated`) to the native `setAppLocale('de' | 'en')`, which stores
it in SharedPreferences (`commit()`, rejecting `updater-locale-invalid` or
`updater-locale-unsaved`); the receiver reads its strings through a context
configured with that locale. The update store does this first in `start()`
and on every later activation; a failure is reported in the startup report
(phase `app-locale`) or, later, as a card note. Until JS has stored a language
(an installer status before the app ran once after the update), the receiver
uses the app's default `de` and logs that. A failed install toasts "installation failed" with Android's status
message; a cancelled one (`STATUS_FAILURE_ABORTED`, the user's own choice)
only toasts "LoggeRythm update cancelled." (the stored outcome and the log
keep Android's message).

**Installer sessions.** The updater first creates a new PackageInstaller
session and writes the verified APK into it; if that fails, the earlier
session stays open and current. Only then does no earlier session count as
current any more: the updater cancels the updater notification (a stale
"update ready" of the earlier session), abandons the app's own earlier
sessions (never the new one), clears the stored outcome and persists the new
session id (`commit()`, before `session.commit`). If abandoning or the commit
fails, an earlier session Android still has becomes current again. Each
session's status
`PendingIntent` uses the session id as request code and carries it as an
extra, so sessions never share extras. The install receiver drops (and logs
with `Log.w`) every non-success status of a session that is not the current
one; a success always offers the relaunch. `downloadAndInstall` resolves
`{ status: 'awaiting-user-confirmation', versionName, versionCode,
sessionId }`. When the confirmation cannot be shown (app in the background,
notifications blocked) the receiver stops treating the session as current,
abandons it (so Android's follow-up abort is dropped), toasts "LoggeRythm
update not confirmed. Start it again in the app." (the "update ready" texts
belong to the notification only) and reports
`updater-install-confirmation-blocked`. Every non-success end of the current
session also cancels the updater notification, so no notification opens a
dead confirmation.

**Installer outcome back to the app.** A Toast from the background is lost
when notifications are off, so the install receiver also stores every
non-success end of the current session (SharedPreferences) with its
`sessionId` and the release it installed: `updater-install-aborted` (the user
cancelled the system dialog), `updater-install-incompatible`,
`updater-install-blocked` and `updater-install-conflict` (Android's
`STATUS_FAILURE_INCOMPATIBLE`/`_BLOCKED`/`_CONFLICT`; final),
`updater-install-failed` (`STATUS_FAILURE`, `STATUS_FAILURE_STORAGE` and any
other failure, with Android's status message and status code; retryable) and
`updater-install-confirmation-blocked`. If Android cannot persist it, the
receiver fails with `updater-install-outcome-unsaved`. A success or a new
session clears it. A running app hears about it through the
`LoggeRythmUpdaterInstallOutcome` event; JS reads and clears the stored copy
with `consumeInstallOutcome()` at startup, on that event and on every return
to the foreground. JS applies an outcome only when its `sessionId` is the
session this process submitted last (before any submission, e.g. at startup,
the stored one is applied). Reading clears the native copy, so an outcome
whose application fails (e.g. the installed build cannot be read) is still
shown, with that failure appended (a final code keeps leading and is kept);
only a failed read itself is shown as a channel failure. Outcomes read while an install runs wait for it:
the attempt's own failure keeps its code and the outcome is appended to it
(unless the outcome is final and the attempt's failure is not: then the final
one leads, so the card offers no retry that cannot succeed), and an outcome of the session the attempt replaced is dropped.
The same holds for an outcome an install overtakes while it is being applied:
it is held for that attempt instead of touching its marker or its card. An attempt
that fails before reaching the installer keeps the marker of the earlier,
still-open session. The card then leaves "waiting for confirmation" and
offers the update again; at startup the toast says "last update not
installed", and an outcome of a superseded session is still reported there.
A failure that arrives while no release is offered waits for the next check
only when it names the build its session installed; several for that build
are chained. One that names no build (a malformed or unreadable outcome, an
outcome without versionCode) is never attached to a later offer: during
startup it goes into the startup report (`install-outcome-unavailable` for the
channel, `install-outcome` for an outcome), afterwards the card shows it at
once as a muted line with phase, cause and raw detail
(`android-update-orphaned-failure`, chained, cleared by a manual re-check).
An outcome for a versionCode that is installed after all is ignored. Startup
toasts name only the phase (`check`, `pending-install`, `install-outcome`,
`install-outcome-unavailable` for an outcome channel that could not be
subscribed to or read, `app-locale` for the language hand-over above) and
point to the profile, e.g. "Letztes Update nicht installiert – Details im
Profil". Android 12+ cuts a text toast after two lines, so every phase toast
stays at most 70 characters in both languages and neither the localized
cause nor the raw code and message are in it. The profile card shows every
startup failure with its cause and raw detail, each once: an outcome that
reached the install card there, and everything else as a muted startup note
(`startupNotes` in the store, `android-update-startup-note`; also a start
that failed in its own setup). A failed startup check is a note too, which
the card hides while the check state still shows that very failure (the
check ErrorState, `visibleAndroidUpdateStartupNotes`): the check that
opening the profile or returning to the app runs replaces the failed check
state, and while it runs the toast's pointer must still lead to the cause.
Once a later check finishes, every check-phase note leaves: a successful
check shows the current truth (the toast already reported the failure), and
a failed one shows its own failure instead, so an old check note never sits
under "Du hast die neueste Version" or under a new check ErrorState. Other
notes leave when a later check puts their outcome on the install card; a
manual re-check clears the notes.

**Accessibility.** The download bar is one TalkBack stop with the static
label "Update-Download" and the progress only as its value
(`accessibilityValue.text`, plus the range for a known size); the visible
progress text is hidden from TalkBack. When a check the open profile
watched goes from checking to done, TalkBack hears its outcome once
(`announceAndroidUpdateCheckOutcomes`: no new version, update available,
not installable, or installed newer); a result already there when the
profile opened is not announced, and a failed check is announced by its
ErrorState. A release with the installed build's own number is announced as
not installable ("Release 1.0.16 hat dieselbe Build-Nummer und kann nicht
installiert werden."), from the same decision the card shows
(`androidInstalledNewerCase`). A failed check folded next to a failed install
has no ErrorState of its own; its muted line (`android-update-check-failure`)
is a polite live region, so TalkBack still hears it.

**Retries and re-checks.** Waiting for the installer confirmation never
blocks a check or a new install attempt; only preparing and downloading do,
and a second `install()` while one runs throws. Failures that a retry of the
same release cannot fix (`ANDROID_UPDATE_FINAL_INSTALL_CODES` in
`src/update/updateErrors.ts`, e.g. `updater-signature-mismatch` or
`updater-install-incompatible`) show no retry, a hint and the release link.
The hint follows the cause: release data and APK codes point to the release
page, device-side codes (`ANDROID_UPDATE_DEVICE_FINAL_CODES`: installer
incompatible/blocked/conflict, `updater-apk-not-newer`) to the detail on the
card. A final failure that happens in this process keeps the header dot (its
label then says "update failed" instead of "update available") and counts as
waiting for the user until they acknowledge it: a manual re-check, or leaving
the profile (its card unmounts); the next visit shows it at the bottom without
a dot. One restored at startup (kept in storage, or an installer outcome of the
previous process) never waits. Such a failure is kept in AsyncStorage
(`loggerythm.androidUpdate.finalFailure.v1`) for exactly that release
(versionCode, APK digest and URL): after a restart the card shows it again
instead of an install button, a re-check of the same release keeps it, and a
check that offers a different release (or none) clears it. A failure of the
same release arriving next to it is appended; a kept final failure always
keeps the lead over a retryable one. Every final code
and every code the install receiver stores has a localized cause in
`src/update/updatePresentation.ts` (a test reads the Kotlin sources to
enforce it); any other code shows "unknown error" with the raw detail (in the
error block "details below"; in toasts and one-line notes, where nothing is
below, just "Unknown error.").
Only a finished check counts as fresh for the profile/foreground throttle; a
failed check is retried on the next trigger, except a GitHub rate limit,
which keeps the throttle. A malformed download-progress event is reported
once the native download has settled, never while it runs: added to a native
failure, or, when the APK still reached Android's installer, shown as a
warning next to "waiting for confirmation" (the install is not retried).

**One card, one slot per visit.** The profile shows exactly one update card.
Its slot is latched when the profile mounts (`useAndroidUpdatePlacement`):
directly below the header while something waits for the user (an installable
update, an install in progress or retryable, or an unacknowledged final failure
of this process), otherwise above the danger zone. It keeps that slot until the
profile unmounts, whatever the state turns into meanwhile, with no exception: a
card that moved under the user's finger (a re-check that finds nothing, an
update found while the profile is open) would unmount and lose TalkBack focus.
Only the header dot follows the live state; the next visit picks the slot
again. While a re-check runs, the card keeps the last result and its "last
checked" time, which is always the time of the last *finished* check: a failed
check produces no result, so a re-check after it still dates the result by the
check that produced it (`previousCheckedAt`, carried through the failed state).
The card's buttons are single-line and get about 26 characters on a 360dp phone
(`src/localization/updateButtonLabels.test.ts`); a question such as "no dialog?"
goes into the caption next to the button, not into its label.

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
    browseTree.ts  acknowledged Android Auto library (Liked Songs, Playlists, Downloads)
    mediaItem.ts   Track ⇄ MediaItem mapping (full Track carried in `extras`)
  screens/        16 auth, Home/Search/Discover/Radio/Library/Profile/catalog/player screens
  components/     shared brand, home, search, catalog, radio, profile, track and mini-player UI
  navigation.tsx  auth/approval gate → five typed tab stacks + player/queue overlays + links
plugins/
  withFirstPartyPlayer.js     Auto service/metadata plus production/custom link intent filters
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

`browseTree.ts` publishes Liked Songs, Playlists and verified offline Downloads
and awaits the native acknowledgement. A failed playlist request is reported
without discarding healthy sections. Native commits and offline refreshes are
serialized so a pending acknowledgement cannot overwrite a newer library.

The Media3 service supports platform/legacy browser connections, encrypted cold
restore, subscriptions, paged children, playlist sibling queues and transport
without a live JavaScript UI. Search and car voice requests resolve titles,
artists, albums and playlists from the published library. They do not search
the entire remote catalog. Sign-in/setup errors are localized and actionable.
Car voice requests use MediaSession callbacks; the phone Activity does not
advertise a standalone search Intent it cannot consume.

The first account sign-in and library synchronization happen on the phone.
See [`docs/ANDROID_AUTO_RELEASE_1.0.14.md`](../docs/ANDROID_AUTO_RELEASE_1.0.14.md)
for the version's automated evidence and the remaining physical head-unit/DHU
acceptance boundary.

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
