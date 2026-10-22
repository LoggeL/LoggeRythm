# Android Auto hotfix 1.0.15

## Reproduced failure

The Android app 1.0.14 displayed "Android-Auto-Mediathek konnte nicht geladen
werden" on startup with the current account library. Read-only requests to the
production API returned eight playlists (222 track occurrences) and 82 likes.
Two uploaded playlist covers were relative `/api/playlists/:id/cover` paths.
The car-library publisher passed them unchanged to the native player boundary,
which requires absolute HTTPS or verified local file URLs. One relative cover
therefore rejected the entire library before native publication.

## Change

The publisher resolves server artwork with the existing server URL resolver
before native validation. Online covers use the active API origin. Downloaded
playlist and track covers use the origin in their persisted account scope,
without requiring authentication or a network request. The native URL and file
allowlists remain enforced; invalid media URLs still fail explicitly.

Pull-to-refresh in Library also retries car-library publication. The refresh
indicator waits for the native acknowledgement, and a successful refresh clears
only the corresponding car-library failure notice. German and English notices
now tell the user how to retry.

## Validation

- Reproduced the relative-artwork rejection using current production API data.
- Passed the complete retrieved library through the production JavaScript
  publisher and native wire mapper after the fix.
- Parsed that exact generated tree with the actual Kotlin player protocol:
  eight playlists and 82 liked entries accepted.
- Added synthetic regressions for uploaded playlist and track covers, offline
  origin binding, failed/successful retries, unrelated notices, and waiting for
  car publication even when a different Library section fails.
- Raw account fixtures were temporary and removed after verification. They are
  not committed or packaged in the app. No authentication cookie was written
  into test fixtures.

The native controller and playback implementation is unchanged from 1.0.14.
The first CI run exposed a test cleanup race: a service fixture deleted the
shared encryption key/file before admitted service writes had completed. Device
tests now await the coordinator clear before releasing the service, verify that
late persistence callbacks preserve a different fixture account, and report the exact
encrypted-load outcome. No assertion is skipped and no retry hides the failure.
This verification does not establish acceptance in a physical vehicle or Google
Android Auto projection host. Private playlist artwork still obeys the server's
existing access rules; this patch does not expose private covers publicly or
put credentials into artwork URLs.

## Installation

Install 1.0.15 over the existing app and open it once. If a previous notice is
still visible, pull down in Library to repeat publication before reconnecting
Android Auto. Clearing app data or signing out is not required.
