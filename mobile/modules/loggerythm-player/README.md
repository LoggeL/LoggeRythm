# LoggeRythm first-party Android player

This local React Native library owns the AndroidX Media3 playback service. The
app-facing TypeScript `PlayerPort` is the only public product API; this document
freezes the native JSON boundary used by that adapter.

## Bridge

The React Native module is `LoggeRythmPlayer`. All mutations are asynchronous:

- `setup(optionsJson, promise)`, where v1 options are exactly
  `{ "accountScope": "user:<positive numeric id>", "origin": "https://canonical-origin" }`.
- `command(name, payloadJson, promise)`.
- `setBrowseTree(treeJson, promise)`.
- `clearPersistedState(promise)` and `clearCache(promise)`.
- Standard `addListener` and `removeListeners` methods.

`setup` and every `command` resolve `{ snapshotJson: string }`. The
`LoggeRythmPlayerSnapshot` event carries the same shape. `snapshotJson` v1 is:

```json
{
  "schemaVersion": 1,
  "playbackState": "idle|buffering|ready|ended",
  "playWhenReady": false,
  "isPlaying": false,
  "positionMs": 0,
  "durationMs": null,
  "bufferedPositionMs": 0,
  "currentIndex": null,
  "currentItemId": null,
  "repeatMode": "off|one|all",
  "queuePersistence": {
    "contextShuffleEnabled": false,
    "contextShuffleRestoreOrder": []
  },
  "shuffleEnabled": false,
  "sleepTimer": null,
  "queue": [
    {
      "id": "stable-queue-entry-id",
      "title": null,
      "artist": null,
      "album": null,
      "artworkUrl": null,
      "durationMs": null,
      "extras": {}
    }
  ],
  "errorCode": null
}
```

The supported command names and payloads are:

- `setQueue`: `{ items, startIndex?: number, startPositionMs?: number }`.
- `play`, `pause`, `skipToNext`, `skipToPrevious`, `stop`, `clearQueue`, and
  `refreshSnapshot`: exactly `{}`.
- `seekTo`: `{ positionMs: number }`.
- `setRepeatMode`: `{ mode: "off" | "one" | "all" }`.
- `setQueuePersistenceState`:
  `{ contextShuffleEnabled: boolean, contextShuffleRestoreOrder: string[] }`.
- `setCommands`: `{ capabilities: ("seek" | "playPause" | "next" | "previous" |
  "stop" | "skipForward" | "skipBackward")[], handling?: "native" }`. Duplicate
  capabilities, JS/hybrid handling, per-command handling, and custom intervals fail closed.
- `setShuffleEnabled`: exactly `{ enabled: false }`. Media3 global shuffle is an invariant guard;
  product context shuffle physically reorders only eligible future queue entries and is persisted
  separately. Enabling Media3 global shuffle is rejected by both bridge layers.
- `sleepAfterTime`: `{ seconds: number, fadeOutSeconds?: number }`.
- `sleepAfterMediaItemAtIndex`: `{ index: number }`.
- `cancelSleepTimer`: exactly `{}`.

`sleepTimer` is either `null`,
`{ type: "time", remainingMs: number, fadeOutMs: number }`, or
`{ type: "mediaItem", index: number }`. These fields, `queuePersistence`, and
`shuffleEnabled` are required in every setup/command result and snapshot/progress event. They are
bounded and contain no source URL, cookie, header, account, or origin.

A queue item requires `id` and `url`; it may contain `title`, `artist`, `album`,
`artworkUrl`, `durationMs`, `headers`, and `extras`. Only an HTTPS URL or an
existing file below the app's internal files, no-backup, or cache directories is
accepted. `headers`, when present, may contain only `Cookie`. Cookies are held
in a process-only URI-keyed vault and never enter Media3 metadata, snapshots,
events, logs, or browse results.

`extras` is a same-app sidecar used for full queue reconciliation. It is never
published through Media3. It is recursively bounded (32 KiB, depth 6, 1,024
values) and rejects cookie/header/auth/token/secret/password/session-like keys.

The player event `LoggeRythmPlayerEvent` carries `{ eventJson }`. V1 emits only
sanitized `error` and `media-item-transition` events.

While playback is active (or waiting in `buffering` with `playWhenReady`), a
main-thread ticker emits the same sanitized snapshot approximately once per
second through both `LoggeRythmPlayerSnapshot` and
`LoggeRythmPlayerProgress`. The ticker exists only while at least one native
event listener is registered and stops on pause, listener removal, and module
invalidation.

The browse-tree setter accepts exactly `{ "root": Node }`. A node requires
`id` and `title`, and may contain `subtitle`, `artist`, `album`, `artworkUrl`,
`durationMs`, `playable`, `url`, `headers`, `extras`, and `children`. The root is a
non-playable container. Playable leaves require a URL and cannot have children;
containers cannot have a URL, headers, or `extras` (`browse-container-extras-invalid`).

A playable leaf's optional `extras` is the same private same-app sidecar as a
queue item's, validated by the identical queue extras policy (size, depth, and
secret-key rejection). JavaScript sends it already sanitized. It is copied into
the queue source when a car or browser selects the leaf, so snapshots and cold
restores of a car-created queue keep full Track metadata. It is stored only in
the encrypted browse state (counted in its size budget) and never enters Media3
metadata, browse/search results, external controllers, or logs. A leaf without
`extras` (older producers and pre-1.0.14 encrypted blobs) keeps `{}`, and empty
extras are omitted on encode.

## Cache and preload boundary

The service owns one process-wide Media3 `SimpleCache` in app no-backup storage
with a 500 MiB LRU ceiling. Playback falls back to the secure upstream data
source if cache creation, open, or reads fail. Cache entries use the canonical
HTTPS URI as their key; request cookies remain only in the process vault and
are never written as cache metadata.

At most the next resolved queue item is preloaded, and each preload is capped
at 8 MiB. A queue-generation ticket cancels stale work after queue replacement,
credential/account cleanup, cache clearing, or service destruction. This is a
byte cap, not a guaranteed amount of playable time: codecs and bitrates vary.
`clearCache` stops playback, cancels and drains preloading on the cache executor,
removes resources through the open `SimpleCache`, and verifies that no cached
bytes or keys remain before resolving. The logout-facing
`clearPersistedState` path clears the process credential vault and performs the
same verified cache clear so URI-keyed audio cannot cross account boundaries.

## Encrypted process-death state

`setup` is the account admission boundary. `accountScope` must be `user:` followed by a positive
base-10 integer without leading zeroes; `origin` must be a canonical HTTPS origin with no path,
query, fragment, user info, or redundant `:443`. No queue mutation or external media command is
admitted until that exact binding has loaded. A different binding stops playback and clears live
sources, credentials, encrypted state, its AndroidKeyStore key, and the verified media cache before
the new account receives an empty baseline.

The service restores the queue, active item, position, repeat mode, product context-shuffle state,
sleep timer, source sidecars, and Cookie vault from an AES-256-GCM blob in no-backup storage. Restore
always remains paused and never auto-plays. Cookie-bearing URLs must match the bound origin exactly;
cookies exist on disk only inside ciphertext and never enter Media3 metadata or public snapshots.

Queue/transition/seek/repeat/shuffle/sleep changes are saved through a short debounce on a dedicated
FIFO executor; pause/stop and sleep changes request an immediate checkpoint, and playing position is
checkpointed every 15 seconds. Monotonic lifecycle tickets prevent delayed work from writing after
an account or logout boundary. Malformed/tampered ciphertext, missing keys, binding mismatch, source
sidecar mismatch, or save failure fails closed by deleting durable state and clearing live sources
and cache. `clearPersistedState` resolves only after key, ciphertext, live queue/vault, and cache
cleanup have all completed.

Remote command configuration is service-owned and acknowledged before JavaScript reports the player
ready. The same-app controller retains the internal command surface. Notification and trusted
external controllers start read-only and receive only configured transport commands; global
shuffle, repeat, arbitrary queue changes, speed, and volume mutation are never advertised. A
trusted library controller additionally receives `SET_MEDIA_ITEM`/prepare only so its selected ID
or voice query can pass through the validated browse-tree resolver. The notification controller
advertises the same pair only to mirror Android Auto's required platform actions; `permits` still
denies it queue replacement. Cleanup resets the external command policy before player state is
removed, and `onPlayerCommandRequest` enforces the same policy again.

Pure JVM coverage freezes cache-key policy, clear admission state, preload
generation/cancellation, progress-ticker lifecycle, strict persisted-state validation, encryption
failure behavior, lifecycle ticket invalidation, bridge admission, and public sleep-state
projection. Device instrumentation is still required to prove eviction at the 500 MiB boundary,
real AndroidKeyStore/filesystem behavior, network interruption fallback, process death, and real
concurrent clear/preload behavior on supported Android API levels.

## Android Auto and legacy browsers

Android Auto, Automotive OS, and other hosts bind the exported service through the platform
`android.media.browse.MediaBrowserService` action. Media3 first asks `onGetSession` with an
identity-free placeholder (UID `-1`, legacy package, legacy version, untrusted) to obtain the
legacy binder, and Android caches that binder for every later legacy bind. The stable root returns
an already-completed future: legacy root lookup waits synchronously on the main thread, so it must
not wait for the encrypted restore callback on that same thread. Children await restoration. Only that exact
placeholder is classified as a framework bootstrap (`LoggeRythmSessionLookupPolicy`): it receives
the session binder, does not start a cold restore, and grants nothing. Every real browser is then
admitted in `onConnect` from `onGetRoot` with its platform-verified package, UID, and trust, and
every platform `MediaController` command is admitted through `onConnect` as well. Rejected
controllers are logged with their public package/UID and receive `onConnectionFailed`. Media3's
media-button fallback identity remains rejected.

Accepted car hosts (trusted browser profile) get, once `setCommands` has been acknowledged:

- Root, item, and paged children (`EXTRA_PAGE`/`EXTRA_PAGE_SIZE`; pages beyond the end are empty).
  Browse results never contain a source URI, cookie, or sidecar.
- Library search over public title/artist/album/subtitle, accent- and case-insensitive, ranked
  exact title, title prefix, title tokens, then any public field; at most 100 results, duplicates
  of the same public track collapsed. The root advertises `SEARCH_SUPPORTED`.
- Selection by media ID. A leaf queues its ordered playable siblings starting at the selection; a
  container queues its directly playable children from the first one.
- Voice (`PLAY_FROM_SEARCH`): an empty query continues the current queue, otherwise starts the first
  playable list; other queries resolve against the same search (playlist focus prefers lists).
- Required platform actions `PLAY`, `PAUSE`, `STOP`, `PLAY/PREPARE_FROM_MEDIA_ID`, and
  `PLAY/PREPARE_FROM_SEARCH`; `SKIP_TO_QUEUE_ITEM` follows the next/previous capability.

Caller-supplied URIs, metadata, start index, and position are never used for external or
legacy requests. Only the same-app Media3 controller may set fully resolved items directly.

Expected library/request failures return explicit Media3 errors. `LoggeRythmCarError` maps each case to
a `SessionError` code and a localized (`values`, `values-de`) message: signed out, discarded cold
restore, empty library, unavailable list or item, no voice match, nothing to play, controls not
configured yet, session not ready, cache clearing, queue commit active, and unsupported request.
Library results carry the error, and the same message is sent to the media-notification controller
so that it appears in the platform `PlaybackState` that cars render. Signed-out, restore, empty
library, nothing to play, and unconfigured controls add an "Open LoggeRythm" resolution action with
the session activity. Media3 replicates the authentication error to legacy hosts until a later
successful result. A failed service-only cold restore can be retried by a later admitted request
while the service is alive.

## Intentional next slices

- Optional JS/hybrid remote-command delivery and custom seek intervals.
- Hardware media-button wake-up through a `MediaButtonReceiver` when no host is connected.
  Connected car Play already uses `onPlaybackResumption` to restore or start a library queue.
- Car-safe artwork through a content provider; HTTPS artwork URIs are not loaded by every host.
- Localized playback (source/network) errors; they currently use Media3's player error message.
- Validation on a physical head unit or the Desktop Head Unit in addition to instrumentation.

Device regression coverage includes `LoggeRythmLegacyBrowserInstrumentedTest` (legacy
`MediaBrowserCompat` and platform `MediaController`: cold connect, paging, search, actual playback,
pause, seek, next/previous, stop/resume, play-from-ID sibling queue, voice, URI injection rejection,
and localized car errors) and the hostile-controller harness, which proves
that an untrusted legacy browser obtains a live binder yet is rejected in `onConnect`.
