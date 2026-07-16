# Android API 36 Emulator QA — updated through 2026-07-16

## 2026-07-16 addendum — v10012 local QA milestone

This addendum supersedes the older “current-source v10007” and v10011 wording
below while preserving its historical evidence. v10012 is an optimized ARM64
local QA milestone, not a production release and not a GitHub-uploaded build.

| Item | v10012 evidence |
|---|---|
| Artifact | `LoggeRythm-1.0.1-10012-arm64-QA-debug-signed.apk`; `29,099,551` bytes; SHA-256 `2176e4a2450c3f0ca1696135156e5534ee5a89509f60204f3d049f46ca544141` |
| Build/gates | Expo Doctor 20/20; mobile TypeScript/ESLint plus 146 files / 934 tests; optimized/minified/shrunk 538-task release assembly in `1m02s` |
| Package | `top.logge.loggerythm`, `1.0.1`/`10012`, ARM64, min API 24 / target API 36, Hermes, 16 KiB aligned, v2 QA/debug-signed with certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| Startup | API 36 ARM64 clean install and embedded-bundle cold start passed in `150 ms` on a stable PID without an app fatal exception |
| Cleanup fix | v10009 had falsely rejected an absent explicit-store child as `storage-scope-invalid`; v10011 corrected the canonical `no_backup` child validation. v10012 retains successful signed-out cleanup to German Login, and diagnostics expose only allowlisted cleanup boundary/code identifiers. |
| Portrait UI | German Login and Register toggling, required fields, password visibility, labels, roles, and touch targets passed visual/accessibility inspection. |
| Landscape UI | At 2400×1080, a centered `520 dp` maximum-width card lets Login and Register scroll safely. At the lower bound, submit and auth-mode toggle remain fully above the gesture bar; Login's IME-focused field remains visible. This closes v10011's specific auth clipping defect, not the broader responsive/device matrix. |
| Production | `/api/version` still returns HTTP 404. The v2 gate therefore stops before authentication/API/media access; no credential was entered or sent. Authenticated logout/account-switch, filesystem/cache/download/notification/Android Auto, playback, and the full accessibility/responsive matrices remain unverified on this build. |
| Publication | Not published or tagged on GitHub. The working tree has no exact-source remote CI run, the APK is debug-signed, and repository records still do not establish written permission for public redistribution of the patched RNTP dependency. Public GitHub/Play/beta upload remains blocked independently of the UI/backend gates. |

Matching local R8 mapping/resources, native symbols, Hermes source map, lint
HTML/XML, APK checksum sidecar, startup logs, screenshots, and UI hierarchies
are retained under `/Users/logge/Documents/Codex/2026-07-15/c/outputs`.
The current auth-layout captures are the `loggerythm-b10012-login`, `register`,
`login-landscape`, `login-landscape-bottom`, `login-landscape-keyboard`,
`register-landscape-initial`, and `register-landscape-bottom` PNG/XML pairs.

## Historical verdict through v10007

The last installed v10005 APK is a credible optimized **QA build**, not a
production release. The current source is newer and has now been assembled as
an optimized ARM64 v10007 QA/debug-signed APK, but it has not been installed
because production still lacks the new compatibility endpoint. Source
verification now also covers Home and Library Recently Heard,
all generated Android wire/operation contracts plus the first Album Search
wire→domain repository seam, the complete source auth lifecycle matrix,
stable personal-Mix details plus Home community content and complete in-session
shelf state/retry handling, native Release Radar with account-scoped seen state
and relative dates, complete per-section Library refresh/state handling under
one bounded five-section virtualized owner, bounded single-owner virtualization
for every known long catalog/Artist/Search/import track collection, scoped
Search history/metadata plus rapid-query/offline recovery, strict Spotify URL
import and a compile-tested text-only Android Share target, synchronized Now
Playing lyrics with timed auto-follow/line seek, seed-owned Similar tracks with
finite ordered queue context and complete remote states, validated current-track
album/every-credit artist links plus production-style static cover ambience and
framed high-resolution artwork, immediate account-scoped
artist-follow cache updates, Artist parity, complete non-fatal Android Auto
refresh after reachable Library mutations, global playlist actions and
optimistic mutation rollback, a complete accessible track action sheet, Profile
update/session orchestration and visible server host, queue duration/cache
metadata, corrected native end-of-track sleep behavior, a shared state contract
covering every current remote collection/detail read, typed localized feedback
boundaries for auth/mutation/player failures, and a separate non-fatal
playback-bookkeeping notice channel. The latest source also unifies every audited
track-row family behind occurrence-aware native playback phases, shared
server-cache state, safe album/all-artist links, duration and surface-specific
popularity policies without per-row player/metadata queries. In v10005, the
authenticated five-tab app, catalog navigation, Profile, native playback,
manual/context queue semantics, bounded recovery, encrypted process-state
restoration, and Android Keystore round trips run on the API 36 ARM64 emulator
without a Metro dependency or an app crash in the final traversal. Full web
parity, production signing, verified App Links, exported-service hostile-client
coverage, and the remaining release/lifecycle/accessibility matrices remain open in
[`ANDROID_WEB_PARITY_TODO.md`](./ANDROID_WEB_PARITY_TODO.md).

No credentials are recorded in this report or its supporting harness output.

## Installed v10005 build and device

| Item | Value |
|---|---|
| Package | `top.logge.loggerythm` |
| APK | `mobile/android/app/build/outputs/apk/release/app-release.apk` |
| Version | `1.0.1` (`versionCode 10005`) |
| ABI | ARM64 |
| Android | API 36, `sdk_gphone64_arm64`, emulator `emulator-5554` |
| Min/target API | 24 / 36 |
| Size | `28,160,258` bytes (26.9 MiB) |
| Build | Hermes, R8 code shrinking, resource shrinking, 16 KiB zip alignment |
| Signature | Valid v2 signature using the QA/debug signer (`fac61745…91033b9c`); not production signing |
| SHA-256 | `8519a562222af2eee382868777422acb552bc6509d887d05b5ad2db6440f0dcf` |
| Backend | `https://loggerythm.logge.top` |
| Current-source blocker | `GET /api/version` returned HTTP 404 at 2026-07-16 12:11:44 UTC; deploy compatible v1 metadata before installing current source |
| Symbol evidence | R8 mapping/resources, native symbols, and final Hermes source map retained locally; they have not been published or tied to a remote release |

## Current-source v10007 candidate — built, not installed

| Item | Value |
|---|---|
| Package | `top.logge.loggerythm` |
| APK | `/Users/logge/Documents/Codex/2026-07-15/c/outputs/LoggeRythm-1.0.1-10007-arm64-QA-debug-signed.apk` |
| Version | `1.0.1` (`versionCode 10007`) |
| ABI / SDK | ARM64 only; min API 24; target/compile API 36 |
| Size | `28,429,802` bytes (27.1 MiB) |
| Build | Hermes bytecode, R8 code shrinking, resource shrinking, 16 KiB zip alignment; 464 actionable Gradle tasks (`34` executed, `430` up-to-date) completed successfully in 1m |
| Tests/lint | 250/250 RNTP release JVM tests; app release unit task; release lint with 0 errors / 54 warnings; full mobile TypeScript/ESLint plus 125 files / 789 tests |
| Bundle/manifest | Canonical production origin and `/api/version` contract strings present; the app bundle contains no functional emulator/Metro/localhost origin, while generic native React Native binaries retain dormant development constants; ARM64-only; launcher, Share, Media3 service and Android Auto surfaces present |
| Signature | Valid APK Signature Scheme v2 using QA/debug certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; not production signing |
| SHA-256 | `2a6d924b55074bbe0a8b2f34e3a5f5001c6ccd1a21735ff7c0902d7c0a96508d`; matching `.sha256` sidecar retained beside the APK |
| Diagnostics | Version-qualified R8 mapping (`37,159,134` bytes), R8 resources (`2,121,339` bytes), native debug symbols (`5,093,452` bytes), and final Hermes source map (`6,870,532` bytes) plus one complete SHA-256 manifest are mirrored in `outputs`; not published or tied to a commit/tag |
| Installation | Intentionally not installed: production compatibility preflight still returns definitive HTTP 404, so the app would fail closed before authenticated/API/media access |
| Publication | Not published: production compatibility, RNTP redistribution authorization, production signing, non-colliding semantic version/tag, exact-source remote CI, and remaining release gates are unresolved |

## Automated evidence

- A fresh clean `npm ci --offline` rebuilt ignored dependencies from the lock
  and `patch-package` applied the normalized 3,870-line RNTP patch without
  drift. Repository status remained byte-for-byte unchanged. Its SHA-256 is
  `d0a6bd799aef1711a4f8555f9d8941ed745750c6c9ed1ade21623d511f92ece3`;
  inspection found no build products, absolute paths, binaries, or license
  files in the patch.
- Mobile `npm run check`: TypeScript, ESLint, 125 Vitest files / 789 tests
  passed.
- The focused remote-state matrix passes 20 files / 116 tests. A static audit
  accounts for all 46 `useQuery` calls and both `useQueries` groups across Home,
  Discover/catalog, Radio, Library, Search/import, playlists/action pickers,
  Profile, Lyrics/Similar/like state, Queue metadata/native snapshot, and Now
  Playing readiness. Populated and known-empty last-good outcomes remain mounted through
  refresh/offline failures; the audit-found missing-Mix-key escape is fixed and
  regression-tested.
- The latest track-presentation slice gives Catalog, Home/Discover, Similar,
  Search/import, Library, Playlist, Recent, and Queue one occurrence-aware
  inactive/buffering/playing/paused/active contract with shared server-cache
  evidence. Native queue index remains authoritative for duplicate Queue rows;
  semantic context plus original order distinguishes duplicate IDs elsewhere.
  Safe album and every ordered artist credit are separate from Play, and
  duration/popularity follow the production policy for each surface. One
  provider owns shared player/cache inputs, rows issue no player/metadata
  queries, and only Search/Queue sample active rolling-cache progress. Focused
  evidence covers shared state 3 files / 21 tests, metadata/identity 2 / 20,
  Catalog/Home 4 / 22, Search/import/Similar 7 / 39, Library/Playlist 4 / 16,
  and Queue 2 / 10. Explicit user-managed download remains unsupported, and
  rebuilt TalkBack/link/phase evidence is not claimed.
- The source-only Similar slice passes 15 dedicated panel/model cases and 39
  integrated data/tab/metadata cases. Its seed-specific Query key forwards
  cancellation with 15-minute freshness, stale rows cannot act after a track
  change, rows are virtualized with Like and the full action sheet, and selecting
  any row keeps the complete finite ordered result with semantic context. The
  installed v10005 APK predates this surface; no emulator or production-radio
  behavior is claimed for it.
- Now Playing has four source-complete Playing/Lyrics/Similar/Queue surfaces.
  The Queue tab embeds the same queue hooks, presenters, list, and mutation
  serialization as the standalone route, suppressing only duplicate safe-area,
  close, and global-feedback chrome. The focused tab/queue contract passes five
  files / 21 tests. The installed APK predates the embedded surface, so this is
  not visual or TalkBack device evidence.
- The source-only PLAYER-04 treatment mirrors production's Deezer cover-size
  rewrite, renders framed 1000 px art or a branded equalizer placeholder, keeps
  a separately bounded 480 px static blurred-cover layer behind all four tabs,
  uses a viewport-bounded square plus vertical Playing scroll for short windows,
  and makes the album-linked title and
  every valid credited artist an independent ≥48 dp native link. Malformed
  legacy IDs remain inert and readable, and the exact selected credit reaches
  navigation. Dedicated cover/metadata/layout/navigation tests pass 5 files /
  18 cases; the integrated artwork/metadata/layout/navigation/embedded-queue
  slice passes 6 files / 23 cases.
  This is source evidence only: PLAYER-04 remains open until the rebuilt APK has
  a screenshot/layout pass.
- PLAYER-05 source policy now deliberately omits the web volume slider, declares
  music content with exclusive mixing and becoming-noisy handling, and uses an
  idempotent Expo plugin to bind visible-app hardware keys to
  `AudioManager.STREAM_MUSIC` in `MainActivity.onResume()`. It remains open until
  the rebuilt emulator proves media—not ringer—volume/mute while playing and
  paused and confirms Bluetooth/car routing follows the system.
- SHELL-09 passes five files / 28 source/config cases: the predictive-Back
  manifest opt-in is present, player/queue routes use transient modal topology,
  Android dismissal is owned by system Back rather than the iOS-only
  `gestureEnabled` option, valid cold links get
  safe Back stacks, malformed detail IDs fail closed, and versioned bounded
  navigation restoration stores only sanitized account/origin-scoped tab
  stacks after proving no initial URL exists. Profile/player/queue transient
  roots never persist. This does not prove interactive predictive preview;
  rebuilt-device edge-gesture cancel/commit and process-death behavior remain
  under PLAYER-06 and QA-11/12/15.
- The ARCH-04 source boundary is complete: one auth repository and 11 composed
  music capability interfaces isolate endpoint implementations from UI,
  AuthProvider, player recovery/history/radio, and Android Auto browse
  publication. Executable meta-matrices cover all 37 reads and 21 mutations;
  every read forwards cancellation. Real QueryClient tests retain last-good
  data after failed refresh, reject cancelled late replacement, isolate
  accounts, and clear completed query plus mutation state together. Query data
  remains intentionally memory-only; this does not claim rebuilt-device
  account-cleanup evidence for DATA-03.
- Every known long vertical track collection now has one bounded virtualized
  owner. Library uses one five-section `SectionList`; Album, Genre, Mix, and
  Radar share one `FlatList` contract; Artist uses one Popular/Search
  `SectionList`; ordinary Search and resolved Spotify import each use a separate
  `FlatList` and never nest same-axis owners. Import keeps that owner mounted
  across idle/edit/loading/resolved states and places Search chrome plus its
  form in the list header, making controls scrollable in short landscape and
  keyboard-shrunk windows without first-keystroke focus loss. The presentations
  retain pull-to-refresh, remote bodies/notices, exact actions/navigation/playback,
  horizontal rails, source indices, and occurrence-aware duplicate keys.
  Focused evidence is 4 Library files / 19 tests, 9 catalog/home files / 41
  tests, 2 Artist files / 5 tests, and 10 Search/import files / 37 tests. This is
  source evidence only; TRACK-06 remains open until QA-16 measures production-
  shaped thousands-of-tracks/hundreds-of-playlists fixtures on rebuilt target
  devices.
- Six focused feedback-mapper files pass 12 privacy tests. Auth/shell, Profile,
  catalog, Library/playlist, global track actions, Spotify import, and the shared
  player banner now collapse arbitrary backend/storage/native failures to
  localized action copy. Typed local validation, compatibility recovery, and
  localized player-recovery explanations remain intentionally specific; raw
  player diagnostics are no longer placed in the shared UI store or Logcat.
- Python Android QA harness tests: 34 passed.
- Web tests: 10 passed; web TypeScript, ESLint, and optimized Next.js production
  build passed. API tests: 33 passed. OpenAPI and generated Android contract
  drift checks passed.
- The versioned OpenAPI v1 document deterministically generates 52 Android
  `*Wire` schemas and typed requests, complete response maps, success aliases,
  auth/media descriptors, and client signatures for 80 HTTP operations across
  71 paths. Generator tests reject missing references, duplicate operation IDs,
  unsupported shapes, route-template mismatches, and stale output. Runtime
  endpoint decoders remain explicit; production fixtures, web consumption,
  underspecified response models, and remote CI are still open.
- Album Search is the first explicit wire/domain vertical seam: its Track-shaped
  generated response maps in the repository to a four-field `AlbumCard`,
  canonicalizes legacy/empty IDs and artwork, reports malformed paths exactly,
  preserves cancellation, and enters Query/UI without Track transport fields.
  Other feature models remain mixed, so this is architecture evidence rather
  than complete ARCH-02 acceptance.
- Real SQLite registration tests prove first-user approved-admin, ordinary
  pending, and invited approved/consumed policy. The AuthProvider lifecycle seam
  and client/component tests cover stored restart, transient Retry, explicit
  local-first Forget, pending→approved recheck, 401 invalidation, and 403 session
  preservation/reuse. The installed APK predates these tests and UI changes.
- The complete current-hash native release JVM run passed 250 tests across 19
  suites with zero failures, errors, or skips. It includes controller-trust,
  persistence, account-boundary, automatic-cache eviction, 34 sleep-timer
  integration, and three timer-state tests. This is JVM evidence, not a new
  instrumentation/device run.
- Web and Android consume the same versioned product-queue JSON. Both engines
  pass three cases containing 14 successful mutations and three rejected unsafe
  mutations; CI path filters and a focused browser consumer are configured.
- Current-source tests prove that the Home shelf displays the same first seven
  recent events as web while hydrating/queueing the complete ordered history,
  including duplicate IDs and atomic failure. Successful play recording
  invalidates only private stats, so an active Home shelf can refresh.
- Home personal mixes now route through a path-safe native Mix detail with
  account-scoped loading/cached-refresh/error/not-found states and complete
  ordered `mix:<key>` playback. New releases, genres, and public/community
  playlists use shared catalog cards and native navigation. Focused Home and
  route tests cover malformed key rejection and callback/playback contracts.
- All ten query-backed Home shelves now distinguish loading, empty, stale,
  refreshing, cached refresh failure, and paused/offline state with localized
  retry while retaining in-memory last-good content. Tests also centralize every
  card route/play context. Personalized shelves are not persisted in plaintext,
  so cold process-death offline restoration is not claimed.
- Release Radar now has a typed native detail, an accessible unique-track unseen
  badge, web-equivalent cumulative seen rules, relative dates, and Play all/from
  row in a stable semantic context. Origin/account-scoped reads and writes are
  serialized, and logout/deletion waits before clearing registered storage.
  The same Radar contract passes eight focused web tests. This is source/unit
  evidence; the Radar surface has not been exercised in the installed APK.
- Search history persistence is origin/account-scoped and fail-closed across
  scope changes. Clear-all and localized per-item removal are covered, as are
  duration, artist/album, Last.fm play/listener or rank fallback, server-cache,
  and active-device-cache metadata. Queue rows reuse the evidence-backed
  duration/cache rules. No cache marker claims an explicit download.
- Search input replacement immediately hides old rows/actions, cancels the
  Search query root, and republishes only the canonical identity after 280 ms.
  Query-core tests prove AbortSignal propagation, rejection of a deliberately
  late old response, exact-key last-good retention during offline refresh,
  cross-query isolation, and retry recovery.
- Spotify import accepts one strictly normalized track, album, or playlist URL
  from paste or text-only Android `ACTION_SEND`; tracking parameters,
  ambiguous text, and untrusted hosts are rejected without changing the server
  origin. Import state exposes resolving/error/type/source/processed and
  matched/unmatched counts, complete-context playback, full track actions, and
  bulk save to a named new or owned existing playlist. Failed new-playlist
  population is compensated, existing-playlist optimistic changes roll back
  exactly, and successful paths invalidate only the account scope and refresh
  Android Auto non-fatally. These paths are unit/component-tested; no production
  import or playlist mutation was performed.
- Shared-text intake now mounts above loading/login/pending gates while remaining
  inside the authentication provider. A serialized coordinator persists one
  bounded payload, deduplicates native redelivery, requests Search once per
  pending-ID/account pair, and lets only a focused matching-account owner consume
  it. Focused tests cover process recreation, account replacement, wrong/stale
  ownership, already-focused Search, and delivery rollback; this is source
  evidence, not a Share-sheet runtime pass.
- Library Recently Heard atomically hydrates and plays the complete ordered
  duplicate-preserving history, with separate safe album/artist destinations
  and no fabricated Track fields for legacy history rows. Artist source now
  covers hero/fan/play/follow, first-ten Popular playback, one batched play-count
  request, within-artist search, Discography, and related navigation.
- Every Library query section now shares a discriminated never-loaded,
  loading, successful-empty, content, refreshing, stale, offline, cached-error,
  and hard-error presentation with retry. Pull-to-refresh settles Playlists,
  Likes, Recent, and Following independently, and last-good personalized rows
  remain memory-only rather than being persisted in plaintext. Downloads keeps
  its explicit unsupported policy and remains a separate inventory gap.
- Now Playing now mounts a track-scoped Lyrics query only while the Lyrics tab
  owns the view and defaults to that tab like production web. The active line
  uses the same position-plus-150-ms rule, replacement tracks cannot retain old
  actions, initial positioning is non-animated, later lines auto-follow, and a
  line press seeks once to its exact server timestamp. Localized loading,
  generic error/Retry, empty, refreshing, last-good refresh error, synchronized,
  AI, cache, and bounded provider-source states are component/model tested. No
  production lyrics request was made because resolution can trigger server-side
  audio materialization/transcription, and the current APK predates this UI.
- Centralized artist follow/unfollow cancels stale reads and immediately updates
  every loaded same-account Following/contains cache after server confirmation,
  without seeding partial lists or changing another account. Same-artist
  mutations serialize, different artists update functionally, failures preserve
  cache, and personalized Home is invalidated.
- One shared non-fatal helper now republishes Android Auto after every reachable
  successful playlist, like, and follow mutation. Publication/notice failure
  cannot reverse the server result; logout/account switch still clear the tree
  before credential replacement. Lifecycle/network recovery, partial refresh,
  and pagination remain separate Auto gaps.
- The app-level track action sheet replaces the platform Alert and is dismissed
  safely on account/scope changes. Its complete ordered set exposes exact queue/
  radio outcomes, Add to an existing playlist or compensating create-then-add,
  strictly validated Open album/Open artist routes, and Remove only when an owner
  caller grants the exact account scope. Stale/replaced requests cannot replay or
  announce an old callback. Playlist edit,
  visibility, add, remove, and reorder have exact optimistic rollback; create,
  delete, owner/public permissions, ordered playback, cache eviction/invalidation,
  and non-fatal Android Auto refresh paths have focused coverage. The backend's
  missing playlist-entry ID still blocks duplicate-safe remove/reorder parity.
- Profile source validates changed display name/email/password fields, requires
  same-user identity after both PATCH and `/me` refresh, invalidates the public
  profile only after success, and visibly identifies the effective server host.
  No production profile or follow mutation was performed for this evidence.
- Account deletion source uses explicit confirmation, locks dismissal and repeat
  submission while pending, leaves local state untouched after server failure,
  and strictly orders successful player/Auto/cache, scoped-storage, session, and
  Query cleanup while aggregating failures. A real in-memory SQLite foreign-key
  suite covers playlists/tracks, likes, follows, plays, hosted/joined parties,
  invites, assets, session-cookie cleanup, last-admin rejection, and permitted
  admin deletion. No production or disposable-device deletion was performed.
- Play-history, radio-extension, malformed transition metadata, and Android
  Auto browse-refresh failures use an eight-second deduplicated non-fatal
  notice channel. Deterministic tests prove those failures do not pause, skip,
  reject the listener, mutate the queue, expose raw diagnostics, or mask a real
  audio error.
- The native service-owned sleep timer now remains armed across manual
  Next/Previous and index shifts, fires on natural auto/repeat completion
  (including repeat-one) and final `STATE_ENDED`, and does not mistake a manual
  skip for end-of-track. Twenty-one JavaScript tests and 37 sleep-specific JVM
  tests pass within the current 250-test native suite; rebuilt locked/background
  device behavior is not claimed.
- Native `clearCache()` is now a real Promise. Account cleanup waits until the
  service has stopped/cleared playback, cancelled preloads, removed every cache
  resource, and verified deletion. A rejection retains a cleanup barrier and
  prevents any later login/register credential request until cleanup succeeds.
- `git diff --check` is clean.
- `:rntp_player:connectedDebugAndroidTest`: 2/2 instrumentation tests passed on
  the API 36 emulator. `BrowseTreeStorageInstrumentedTest` performs a real
  Android Keystore AES-GCM browse-tree/auth-header round trip;
  `PlayerStateStorageInstrumentedTest` protects and restores the authenticated
  native queue plus product queue metadata without plaintext token or stable-ID
  values in SharedPreferences. After the later logout-cleanup patch,
  `BrowseTreeStorageInstrumentedTest` was rerun alone and passed 1/1; the full
  two-test package has not been rerun on that final patch.
- `:app:lintRelease`: zero errors and 54 warnings. Material warnings remain for
  the exported playback service, unverified App Link/intent-filter structure,
  and launcher asset encoding/masking; a lint pass is not a security waiver.
- The current-source v10007 candidate passed the complete 250-test RNTP release
  JVM suite, `:app:testReleaseUnitTest`, `:app:lintRelease`, R8/resource
  shrinking, Hermes bundling, and `:app:assembleRelease` in 464 actionable tasks
  (`34` executed, `430` up-to-date; `BUILD SUCCESSFUL` in 1m). APK
  inspection proved Hermes bytecode, ARM64-only native code, the canonical
  production origin plus compatibility contract strings, v2 QA/debug signing,
  16 KiB alignment, and the expected launcher, Share, Media3, and Android Auto
  manifest surfaces. The app bundle contains no functional emulator, Metro, or
  localhost origin; generic React Native native binaries retain dormant
  development constants. It was not installed.
- Expo plugins own the text-only Android Share bridge (manifest filter,
  cold/warm `MainActivity` hooks, inbox/module/package) and the visible-app
  `STREAM_MUSIC` binding. Current `:app:compileDebugKotlin --offline` completed
  183 tasks successfully with Android Studio's bundled JBR, and current release
  Kotlin also compiled inside v10007. This proves compilation/assembly, not an
  install, Share-sheet interaction, system-volume device test, or cold/warm
  runtime test.
- `npx expo-doctor`: 20/20 checks passed.
- Canonical production-origin assertions passed: the runtime marker reports
  exactly `https://loggerythm.logge.top`, that is the only configured API
  origin, and production config rejects non-canonical build overrides. A
  dormant `localhost` string belongs to React Native's Metro help text, not API
  configuration. The accepted current-source policy has no runtime server
  picker; debug origins are build-time only and Profile exposes the effective
  host.
- Standalone v10005 release-APK acceptance passed on isolated API 36 ARM64
  `emulator-5556`: clean uninstall/install, non-debuggable package metadata,
  cold and warm embedded-bundle starts on stable PID `4383`, no Metro reverse
  or runtime dependency, clean app-scoped crash/ANR/process-death/native/
  ReactNativeJS audits, and the exact effective production origin. The
  `--startup-only` run deliberately did not authenticate.
- Credential-blind installed-session run with `--cold-start`: passed secure
  session restore, all five tabs, Profile, safe
  Home/Search/Discover/Library detail routes, all Radio/Library sections,
  search/account deep links, stable PID, and app-scoped crash inspection. The
  overlay-aware harness now dismisses/avoids the mini-player when selecting a
  Home detail; a regression test covers that formerly obscured target.

The installed-session harness reads only resource IDs, clickability, enabled
state, and bounds. It strips UI text/descriptions/password metadata and refuses
account, library, playback, and history mutations.

The instrumentation tests run in the RNTP test package, not inside the shipped
`top.logge.loggerythm` release process. They do **not** prove exported-service
authorization, a hostile cross-UID controller, real network playback, external
logout-deletion evidence, reboot restoration, key invalidation, or backup
extraction. Four release unit tests cover the pure controller trust policy, but
the cross-process security gate remains open.

## Manual production-connected v10005 checks

### Passed

- In-place upgrade to 10005 succeeded with the same QA/debug signer and
  preserved the approved SecureStore account session.
- Cold and warm launch restored the approved account without a login prompt.
- Home rendered personalized shelves and production data.
- Search rendered genre browse, retained history, accepted a query, and exposed
  All/Tracks/Albums/Artists/Playlists plus title/duration sorts.
- Discover rendered charts, genres, and releases.
- Album, Artist, and Genre details loaded production data; artist follow state
  rendered without being mutated.
- Library rendered owned playlists, Liked Tracks, Recently Heard, explicit
  “Downloads unavailable,” and Following; stale data remained visible.
- An owned playlist rendered track order and owner controls without mutating
  edit/delete/visibility/reorder state.
- A playlist track reached native `PLAYING`; position and buffer advanced.
- Android media-key Pause changed the native session to `PAUSED`.
- In-app Next changed the active media item and metadata.
- Now Playing exposed close, queue, like, seek, shuffle, previous, play/pause,
  next, and repeat controls. Queue rendered without a crash.
- A 20-item Recent context queue played in native `PLAYING`. Enabling shuffle
  reordered only the upcoming context; disabling it restored the exact original
  context order.
- **Clear upcoming** reduced that queue while preserving the active playing
  track and already-played history.
- From a fresh context, visible Discover chart actions inserted a **Play next**
  item immediately after current and an **Add to queue** item after existing
  manual items but before context. Both manual items stayed pinned while
  context was shuffled, and an accessible manual move-down action succeeded.
- Natural playback advanced from the context track into the highest-priority
  manual item, confirming native queue order rather than merely visual order.
- The queue screenshot showed German/violet styling, an explicit “manually
  queued” label, artwork, and non-overlapping 48 dp controls at 1080×2400.
- Encrypted process persistence restored a 40-item Metallica search queue with
  the same active title, order, and count after force-stop and cold launch. The
  original v10004 diagnostic state saved `24950 ms` but exposed a cold-start
  numeric-string parser crash; v10005 contains an exact regression test for
  that representation. In a fresh v10005 run, playback was observed at
  `51200 ms` before stop and restored at `59881 ms`; the UI showed
  `Wiedergabe starten`, proving restoration did not auto-play.
- In v10005, every `playTracks` caller supplied a semantic queue context with
  stable type/ID metadata rather than a generic generated collection. Current
  source additionally requires a persisted human-readable context label.
- Home shelf tracks expose a visible, labeled actions control. Its 126 px
  target at the emulator's density equals 48 dp and no longer requires a long
  press.
- A reversible production like/unlike check changed Library Liked Tracks from
  34 to 35 immediately, then cleanup returned it from 35 to 34. A subsequent
  cold traversal confirmed the track remained unliked.
- Profile rendered identity, role/approval, edit inputs, all-time/30-day stats,
  sleep timer, logout, and deletion controls. A 15-minute timer was started and
  cancelled; destructive actions were not used.
- Valid content/account/search links mounted intended routes. A malformed
  playlist link showed `invalid-content-link` instead of crashing.
- Direct 1080×2400 emulator capture showed the production violet lockup, German
  Search UI, account avatar, five tabs, search history, and genre artwork with
  no obvious portrait clipping.

### Failed or incomplete

- A Focus mood radio start hit three 5-second stream-resolution POST timeouts.
  Native recovery stopped safely and preserved the queue, but the station did
  not play; a manual Next attempt also reached a source error.
- The installed v10005 recovery banner was English in a German session.
  Current source replaces it with localized, user-safe recovery/bookkeeping
  copy and has regression coverage, but the rebuilt APK still needs visual
  confirmation.
- The installed v10005 Queue screen retained played history above current
  without a separate heading and counted the entire queue. Current source now
  presents explicit history/current/manual/labeled-context sections and counts
  only upcoming items; rebuilt emulator/TalkBack confirmation remains pending.
- The installed APK predates the active Search-row toggle, album aggregate
  runtime, generated feature contracts/AlbumCard mapping, source auth lifecycle
  and distinct Retry/Forget UI, Home/Library Recently Heard full-context/catalog controls,
  per-item Search-history removal, Search race/offline recovery, Search/Queue
  metadata, Artist Popular/search/follow parity, stable Mix detail, Home
  community playlists, Release Radar detail/badge/date behavior, complete Home
  shelf state/retry behavior, complete Library section state/pull refresh,
  immediate Following-cache updates and Library-mutation Auto refresh, Spotify
  paste/Android Share import and bulk save, auth-gated account-scoped Share
  coordination, synchronized Lyrics tab/auto-follow/
  exact line seek, playlist create/edit/delete/
  visibility/add/ordered-playback and rollback behavior, the complete global
  track action sheet, Profile update/session/visible-host and account-deletion
  behavior, corrected
  end-of-track sleep behavior, and the separate non-fatal notice channel.
  Current source has exact controller/model/component/storage/native tests and
  the generated Share bridge compiles, but these surfaces still need a rebuilt
  visual/device/TalkBack pass. In particular, no Android Share-sheet cold/warm
  delivery, gated account handoff, or import interaction has run on the emulator;
  no disposable-account deletion/forensic cleanup pass has run either.
- The installed APK also predates the static blurred Now Playing backdrop,
  framed high-resolution artwork/placeholder, transparent embedded Queue owner,
  and per-credit artist links. Their component contracts are green, but no
  claim is made about Android image blur, memory, landscape fit, or rendered
  visual parity until the current source is rebuilt.
- Production `GET /api/version` returned HTTP 404 with
  `{"detail":"Not Found"}`. The current Android gate correctly rejects this
  before session/API/media access, so the backend endpoint must deploy and
  return compatible v1 metadata before a new APK is installed. The latest
  read-only confirmation was 2026-07-16 12:11:44 UTC.
- A slugged playlist link parsed correctly but the chosen production ID
  returned the controlled playlist error screen; a known existing playlist
  was verified through Library instead.
- Production `/.well-known/assetlinks.json` returned 404, so HTTPS links are
  unverified intent routes rather than verified Android App Links.
- Release lint still reports the exported playback service without a manifest
  permission. Runtime trust filtering and four policy unit tests mitigate it,
  but no hostile external application has attempted a real Binder/Media3
  connection.
- Release lint found 20 PNG-encoded launcher assets named `.webp` and five
  launcher icons that fill the square; production icon packaging/masking is
  not release-ready even though in-app branding is recognizable.
- The pre-existing repository history contains a production test credential
  formerly embedded in the web screenshot script. The working tree removes the
  defaults and scans clean for the known fragments, but external rotation and
  a Git-history remediation decision are still required.
- The installed RNTP terms and repository records do not establish permission
  to redistribute this patched dependency in a public APK/AAB. Public GitHub,
  Play, or beta distribution remains blocked until written channel coverage is
  recorded or RNTP is replaced.

## Explicitly not claimed

- No production account deletion, logout, profile edit, playlist mutation,
  follow toggle, or search-history clear was executed. The only like mutation
  was the reversible check above, and its cleanup was verified after a cold
  traversal.
- The current compatibility-enabled source, localized recovery/non-fatal copy,
  fail-closed awaitable account/cache cleanup, shared queue contract, Home and
  Library Recently Heard, personal Mix detail/Home community content, Release
  Radar, Home shelf and complete Library-section state/retry contracts, scoped
  Search history/metadata/concurrency/offline recovery, Spotify paste/Android
  Share import and auth-gated exactly-once coordination, synchronized Now Playing
  Lyrics, generated feature contracts/Album Search domain mapping, source auth
  lifecycle/Retry/Forget, account deletion, active Search row
  behavior, album runtime, Artist Popular/search/follow parity and immediate
  Following-cache updates plus Library-mutation Auto refresh, the implemented
  playlist/complete-action-sheet slice, the shared loading/offline/error/empty/
  cached-refresh/stale state contract, Profile edit/session/visible-host
  behavior, corrected native end-of-track timing, current Now Playing cover/
  metadata treatment, and new queue-section/metadata
  UI have unit/static/native or compile evidence but have not been
  exercised together in a newly rebuilt APK. The production compatibility
  endpoint is the deliberate blocker.
- No several-minute/full-track playback, lock-screen/background/network-loss,
  Bluetooth/headset/call, repeat-mode boundary, radio/background/Android Auto
  restoration, sleep-timer manual-skip/repeat-one/final-item device behavior,
  reboot restoration, airplane-mode download, TalkBack, 200%
  text, landscape/tablet/foldable, DHU, or Media Controller Test matrix has
  passed yet. The single force-stop/cold process-restoration path above is not
  evidence for that full lifecycle matrix.
- Query and action failures use localized non-diagnostic copy in current source,
  but the installed APK predates those boundaries. Rebuilt-APK TalkBack, UI-dump,
  and Logcat evidence remains required before claiming device-level sanitization.
- The Mac was locked during the last visual check, so the Android Studio chrome
  could not be controlled. The same running emulator was inspected directly by
  ADB/UIAutomator, native media-session state, logcat, and a device screenshot.
- The current-source v10007 APK is ARM64-only and not production-signed; it has
  not passed GitHub Actions or device installation. GitHub CLI authentication is healthy for `LoggeL`,
  `v1.0.1` is already occupied, no AAB exists, and the workflow does not
  durably retain the local native/Hermes symbols or upload a checksum sidecar.
  The npm tree also has 10 moderate Expo build-time advisory paths awaiting
  safe disposition, and public RNTP redistribution permission is not recorded.
  It must not be published as a production release.
