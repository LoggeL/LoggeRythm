# First-party Media3 player migration

**Status:** source cutover complete; first-party Media3 QA candidate
`1.0.2`/`10013` passes the source, JVM, instrumentation, release-assembly,
artifact, and standalone-startup gates. Production signing and the remaining
authenticated/background/Android Auto acceptance matrix are still open.

**Decision:** keep the React Native/Expo product UI and replace
`@rntp/player` with a first-party Kotlin/AndroidX Media3 subsystem. A Flutter
rewrite would discard working UI while leaving the difficult Android playback,
service, authentication, persistence, notification, and Android Auto work.

**Public-release rule:** the b10012 RNTP checkpoint is historical, proprietary,
and local only. No commit, tag, source archive, draft release, or APK containing
that dependency or its derivative patch may be uploaded. A public artifact must
come from a clean first-party tree and pass both the source and unpacked-APK
gate described below.

## 1. Migration baseline and current checkpoint

The migration baseline depended on 38 player methods, four React hooks, four
direct event kinds, four enums/constants, and seven imported types across 14
production and 14 test files. All 28 direct production/test consumers now
import the owned player facade instead of RNTP.

| Area | Required behavior |
|---|---|
| Bootstrap | background handler, idempotent setup, native command policy |
| Transport | play, pause, playing state, seek, next, previous, index skip |
| Queue writes | replace, append, insert, item replace, range remove, move, clear |
| Queue reads | queue, active item/index, position/duration/buffer/cache progress |
| Product state | context-shuffle state and restore order |
| Repeat/cache | repeat off/all/one, rolling-cache cleanup |
| Sleep | read, time timer, end-of-item timer, cancel |
| Car | publish and clear the Android Auto browse tree |
| Events | transition, progress, playback error, queue/snapshot change |
| Hooks | active item, playing, playback state, progress |

The controller fan-out reaches every playback entry point, Mini Player, Now
Playing, Queue, Search, track actions, radio extension, auth cleanup, Profile,
and Android Auto refreshes. Migration must therefore preserve the product
controller and queue contract rather than rewrite the UI.

Current source checkpoint:

- the owned `PlayerPort`, immutable snapshot store, React hooks, and strict
  Native-v1 mapper are implemented;
- offline `npm ci`, TypeScript, ESLint, and 149 Vitest files / 1,003 tests plus one
  explicit todo pass at the latest source checkpoint;
- the local package dependency points to
  `mobile/modules/loggerythm-player`, and the RNTP package, patch, postinstall,
  old plugin, direct imports/mocks, and CI markers are removed from source-owned
  files;
- a clean Expo prebuild replaced the ignored generated Android tree; the final
  gate scans 426 source/generated files and 1,090 APK entries with zero
  findings, and Gradle exposes only `:loggerythm_player-native` as the player
  component;
- 59/59 first-party JVM tests and 5/5 Keystore/persistence instrumentation
  tests pass on the API 36 ARM64 emulator; release lint, R8/minification,
  resource shrinking, assembly, APK Signature Scheme v2, and 16 KiB page
  alignment pass;
- a fresh uninstall/install followed by cold and warm standalone startup
  reaches the branded German Login surface from the embedded Hermes bundle,
  with the production origin, nondebuggable mode, stable runtime, and no Metro
  dependency or app-scoped startup failure verified.

The resulting ARM64 QA APK is 27,363,030 bytes with SHA-256
`2bd490e96b0e0f58c42f8d300f662ad48ae2838002c5c623975638f6315d9378`.
It is debug-certificate signed and therefore is not a production/Play artifact.

## 2. Target ownership

```text
React UI/hooks
    -> PlayerPort + immutable JS snapshot
        -> async typed native commands/events
            -> first-party MediaController
                -> first-party MediaLibraryService
                    -> ExoPlayer / Media3 session / cache / persistence
```

- Kotlin/Media3 is the only playback authority.
- JavaScript getters read the latest immutable event snapshot; they never make
  blocking synchronous native calls.
- Queue mutations carry an expected revision and return an acknowledged
  snapshot so a stale UI cannot silently overwrite a newer native queue.
- Remote queue items identify a production track; the native account binding
  owns the origin and cookie. Secrets never enter metadata, emitted snapshots,
  logs, browse results, or UI.
- Logout/account switch is one awaitable native transaction that clears live
  playback, encrypted state, browse data, headers, timer, and rolling cache.

## 3. Narrow PlayerPort

The human-owned TypeScript port must expose:

- `connect()` and `refreshSnapshot()`;
- `bindSession()` with account scope, canonical origin, and cookie;
- a discriminated `execute(command)` API for transport, queue, repeat, product
  shuffle, and sleep operations;
- `publishBrowseTree()`;
- transactional `clearAccountState()`;
- `getSnapshot()`, `subscribe()`, and typed event subscription;
- a duplicate-safe background handler for transition, progress, and error
  events.

The snapshot contains revisions, playback/playing state, sanitized queue,
active index, progress, repeat, product queue state, and sleep-timer state. It
never contains request headers or session credentials.

The port, hooks, strict Native-v1 decoder/mapper, private JavaScript source
vault, all 28 consumer migrations, native session binding, and the single
atomic account-cleanup boundary are implemented. Signed-out clean-install
startup proves the empty-session boundary, but authenticated account switching
and full filesystem/queue/cache/notification/Auto cleanup remain unaccepted
while production returns 404 for `/api/version`.

## 4. Native responsibilities

| Component | Verified source checkpoint | Still required for acceptance |
|---|---|---|
| Playback service | First-party `MediaLibraryService`, ExoPlayer/Media3 session, audio focus/noisy handling, service-owned playback authority, release assembly, and clean-start emulator proof exist | Authenticated foreground/background playback, notification, process-death, and locked-device proof |
| Controller bridge | Async native module, validated Native-v1 JSON, immutable event snapshot, transition/error events, command surface, and a 1-second progress ticker pass JVM/release/startup gates | Authenticated reconnect, lifecycle, and hostile-controller device matrices |
| Data source | Strict canonical HTTPS/app-private-file validation plus a private per-URI Cookie vault/DataSource exist | Prove end-to-end session binding, rebind, logout, and artifact/log non-disclosure |
| Queue | Revisioned full-set reconciliation and transport/repeat operations exist | Finish command coverage and exercise race/recovery/device matrices |
| Cache | 500 MiB LRU, secure upstream, at most one next-item preload capped at 8 MiB, and awaitable verified clear exist | Device filesystem, Range/seek, failure, and account-boundary proof |
| Persistence | Versioned bounded codec and Android Keystore AES-GCM/no-backup atomic store pass focused JVM coverage and 5/5 API 36 instrumentation tests | Authenticated paused cold restore, key-loss/corruption, process-death, and reboot evidence |
| Sleep timer | Service-owned time/end-of-item commands, remaining/cancel state, and corrected natural-end semantics are implemented and unit-tested | Authenticated repeat/manual-skip/background device matrix |
| Background | Native transport does not require a synchronous JS getter | First-party headless event delivery, event IDs, duplicate suppression, and locked/background proof |
| Android Auto | Trusted-controller policy, validated warm browse tree, sibling-queue selection, and notification/service wiring exist | Cold service-only browse restore, DHU/Assistant, and external-controller proof |
| Security | Ordinary untrusted controllers are rejected; privileged custom operations are same-UID-only | Separate-UID instrumentation and completed account/session lifecycle proof |
| Cleanup | One awaitable JS/Kotlin transaction clears live playback, timer, encrypted state/tree/session, headers, notification/error state, and rolling cache; signed-out startup passes | Authenticated logout/account-switch filesystem and Android Auto inspection |

Voice search remains deliberately unadvertised until it has a complete
driver-safe implementation.

## 5. Migration sequence

1. [x] Inventory every production call, hook, event, type, and coupled test.
2. [x] Add owned player types, PlayerPort, fake port, native adapter, command and
   event decoders.
3. [x] Move hooks to `useSyncExternalStore` over the JS snapshot and migrate all
   14 RNTP-coupled tests.
4. [x] Add the first-party Media3 module/service without enabling a second
   exported playback service.
5. [ ] Implement authenticated source ownership, cache/preload, encrypted
   persistence, sleep timer, atomic cleanup, and headless delivery. All listed
   service-owned pieces except complete dead-React headless product-effect
   delivery are implemented and unit-tested; authenticated lifecycle proof
   remains blocked by the production compatibility endpoint.
6. [ ] Implement Auto browse/playback and controller authorization.
   Controller policy exists; cold-tree, sibling-queue, command, and device
   acceptance remain open.
7. [x] Cut the application to the first-party service and regenerate Android
   from a clean prebuild.
8. [x] Remove RNTP, its patch, `patch-package`, direct imports/mocks, old service
   references, CI tasks, and RNTP-specific comments/compatibility code. The
   source-owned and clean-generated Android trees are both clean.
9. [x] Prove source, dependency graph, manifest, Hermes bundle, DEX, and APK are
   free of `@rntp/player`, `com.doublesymmetry.trackplayer`, and the derivative
   patch.
10. [ ] Run the complete JS/JVM/instrumentation/emulator/release matrix and build
    the public artifact from a clean history that never contains the b10012
    derivative patch.

## 6. Removal checklist

- [x] `mobile/patches/@rntp+player+5.6.0.patch`
- [x] `@rntp/player` dependency and lock entries
- [x] `patch-package`, its postinstall hook, and unused transitive entries
- [x] All 28 direct import/mock couplings
- [x] RNTP service/autolinking/generated Gradle and manifest output
- [x] RNTP-specific `__rntp_array_length` compatibility and active-dependency wording in source-owned code
- [x] RNTP-native workflow tasks and paths

A one-time, narrow purge of obsolete encrypted legacy player state may remain;
no proprietary source or class may remain.

## 7. Mandatory gates

- Existing mobile/API/web gates must remain green. The final checkpoint passed
  offline `npm ci`, TypeScript, ESLint, and 149 Vitest files / 1,003 tests plus
  one explicit todo.
- New JS tests cover every command/event decoder, malformed native payload,
  secret redaction, stale queue revision, rejection reconciliation, and
  duplicate background event.
- JVM tests cover connection/order, auth non-disclosure, queue/repeat, cache,
  encryption/corruption/key loss, paused restore, sleep matrix, browse
  validation/pagination, and authorization.
- Instrumentation covers Keystore round trips, process death/reboot,
  notification/lock-screen/media buttons, focus/noisy routing, Range seek,
  locked/background playback, Auto selection, and transactional logout.
- A separate-UID hostile controller proves it cannot browse account data or
  mutate playback/session state.
- Release QA covers clean prebuild, lint/R8, signature/alignment, dependency and
  secret scans, cold/warm standalone start, lifecycle/audio, and emulator logs.

`mobile/scripts/verify_first_party_player_gate.mjs` is the executable source/APK
gate for step 9. Its historical negative-control run scanned 416 source files
and 1,754 unpacked b10012 APK entries and correctly rejected the old dependency
in the package/lock, plugin/service, Hermes bundle, DEX, and native library. The
final clean-prebuilt tree scans 426 source/generated files and 1,090 APK
entries with zero findings, including the Hermes bundle, DEX/native payload,
manifest, and dependency sources. Gradle lists only
`:loggerythm_player-native` as a player project, so step 9 is accepted.

Removing RNTP clears the new artifact's dependency-redistribution blocker; it
does not sanitize historical commits or the b10012 APK. It also does not deploy
the locally implemented backend v2 contract. Production still returns 404 for
`/api/version`, so an atomic v2 metadata/playlist-contract deployment with an
identified deployment authority is mandatory. Permanent signing, exact-commit
CI, credential rotation/revocation plus the history decision, and the remaining
parity/release checklist are independent blockers.
