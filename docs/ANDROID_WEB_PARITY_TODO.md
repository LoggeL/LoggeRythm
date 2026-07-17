# Android ↔ Web Parity TODO

**Status:** Active parity sprint — substantial working-tree progress; P0/P1 release gates remain open

**Acceptance snapshot:** 35/62 P0 and 76/124 P1 work items are closed at this evidence revision; 27 P0 and 48 P1 items remain open. That is 111/186 closed (60% rounded). PLAYER-13 and the durable playback-event boundary PLAYER-16 remain open until their authenticated/background device matrices pass.

**Baseline:** 2026-07-15; evidence updated through 2026-07-17

**Source revision:** Android `1.0.3`/`10014` source commit `d979e9bc856dd07ae6dcc05c0dca72e0a46b660c` (tree `84f1e9f15cb495566a2f13904045984f57739b13`); exact GitHub workflow [`29559829540`](https://github.com/LoggeL/LoggeRythm/actions/runs/29559829540) / #14 succeeded, and QA prerelease [`android-media3-v1.0.3-rc.1`](https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.3-rc.1) targets that source.

**Production reference:** `https://loggerythm.logge.top`

**Android reference:** production-connected `1.0.1` (`versionCode 10005`) remains the last APK with authenticated production playback evidence. The ARM64 `1.0.1`/`10012` RNTP APK remains a historical local-only checkpoint and must not be published. The current first-party Media3 `1.0.3`/`10014` QA prerelease passes exact-commit remote CI plus downloaded-APK clean-install cold/warm startup on API 36, but is debug-certificate signed and not a production artifact. Production's HTTP 404 at `/api/version` correctly blocks authentication/API/media access, so account-switch/filesystem/notification/Android Auto cleanup and the broader authenticated device matrices remain release gates. The prior `1.0.2`/`10013` evidence remains frozen in [`ANDROID_MEDIA3_QA_2026-07-16.md`](./ANDROID_MEDIA3_QA_2026-07-16.md).

**Goal:** Align the Android product with the production web product without regressing Android-native playback, security, background behavior, or Android Auto.

**Player replacement checkpoint:** all 28 production/test consumers now use the
owned facade; `PlayerPort`, immutable hooks, and the strict Native-v1 mapper are
implemented. Offline `npm ci`, TypeScript, ESLint, and 152 Vitest files / 1,050
tests plus one explicit todo pass at the current checkpoint. The first-party
service, trusted-controller policy, strict Cookie vault/DataSource, 500 MiB
cache, maximum-8-MiB one-next
preload, and 1-second ticker exist. Encrypted codec/store coverage passes 19
focused tests; the complete first-party JVM suite passes 115/115 and API 36
Keystore/persistence/controller-trust instrumentation passes 7/7. Session binding, atomic
cleanup, sleep/remaining commands, warm Android Auto sibling behavior, release
assembly, and first-party APK/startup gates are implemented and locally proven.
The encrypted playback-event journal, empty-payload Headless bridge, and
reboot-persistent WorkManager wake are source/JVM complete; authenticated
kill/lock/reboot delivery, cold service-only Auto restore, and production
signing remain open. The current gate scans 445 source/generated files and
1,095 APK entries with zero findings,
and Gradle lists only `:loggerythm_player-native` as the player component. This
migration checkpoint is tracked separately from the overall parity percentage.

This is the source-of-truth parity backlog. It compares meaningful product behavior, content, information architecture, visual identity, accessibility, resilience, security, testing, and release readiness. Incidental pixel spacing and browser-only mechanics are not treated as Android defects; they are either adapted to a native equivalent or explicitly excluded.

## 1. Decision and priority legend

| Marker | Meaning |
|---|---|
| **Port** | Android should provide the same user outcome and data. |
| **Adapt** | Android should provide a native equivalent, not copy the browser interaction literally. |
| **Preserve** | Android already has a platform advantage that must not regress. |
| **Exclude** | Browser-only behavior with no useful Android equivalent. |
| **P0** | Foundation or core-behavior blocker; complete before broad feature work/release. |
| **P1** | Primary product parity; required for the Android app to be called aligned. |
| **P2** | Advanced, social, role-specific, or second-wave parity. |
| **P3** | Polish after functional parity. |

Checkboxes are intentionally unchecked until implementation and the stated acceptance checks both pass. “Code exists” is not completion. Where an item is explicitly closed at the source/test boundary, the separate emulator, lifecycle, accessibility, and release gates remain authoritative and unchecked until their own evidence exists.

## 2. Architecture decision

### Decision: keep React Native/Expo for this parity goal

Do **not** rewrite the app in Flutter. The expensive Android work already exists in the current stack: authenticated Media3 streaming, a background media service, MediaSession/notification controls, encrypted session persistence, a native cache, and Android Auto. Flutter would replace the comparatively small UI layer while still requiring custom native code for those capabilities.

The current architecture is acceptable for the parity sprint, with these corrections:

- Keep one first-party Media3 service as the single playback authority. The TypeScript `PlayerPort` may cache only an immutable event snapshot; it must not become a second playback engine.
- Model product queue metadata (`manual` versus `context`) beside native Media3 queue items.
- Generate shared wire contracts from FastAPI/OpenAPI; retire divergent hand-maintained web/mobile response shapes.
- Use the already-installed TanStack Query for Android server state, cancellation, invalidation, stale-data UX, and account-scoped cache eviction.
- Organize mobile code by feature and navigation stack: Home, Search, Discover/Radio, Library, Profile, plus reusable catalog and player screens.
- Share brand tokens and semantic design values, not web CSS components.
- Treat native playback, downloads, authenticated networking, background tasks, and Android Auto as explicit platform adapters with instrumentation tests.

### Architecture risk to resolve

The previous largest technical seam was the 3,870-line derivative patch to commercially licensed `@rntp/player`. The current source-owned tree removes the package, patch, postinstall, old plugin, direct imports/mocks, and CI markers and points to the local first-party module. The final gate scans 445 source/generated files and 1,095 APK entries with zero findings across dependencies, manifest, Hermes, DEX, and native payload; Gradle exposes only `:loggerythm_player-native`. The live risk has shifted from dependency ownership and assembly to authenticated lifecycle proof: real kill/lock/reboot playback-event delivery, cold service-only Auto restore, account-switch cleanup, production v2, and production signing. The exact migration status and gates are durable in [`FIRST_PARTY_MEDIA3_MIGRATION.md`](./FIRST_PARTY_MEDIA3_MIGRATION.md). [`RNTP_PATCH_OWNERSHIP.md`](./RNTP_PATCH_OWNERSHIP.md) is historical provenance for the non-publishable b10012 checkpoint, not an active release strategy.

- If iOS is a real near-term target, keep the React Native product/controller contract and add an owned iOS player adapter; do not reintroduce the superseded RNTP dependency.
- If the product remains Android-only, the better long-term target is an **incremental** Kotlin/Jetpack Compose migration, starting with a first-party Media3 service and leaving screens in React Native until the native seam is stable.
- A full rewrite is not a prerequisite for web parity.

## 3. Current alignment snapshot

The base revision was a two-tab playback MVP. The current working tree is materially different and is the state measured by this document. Counts describe source surfaces, not proof that every outcome is complete.

| Dimension | Production web | Android working tree verified through 2026-07-17 | Remaining gap |
|---|---|---|---|
| User-visible routes/screens | 17 Next.js page routes | 16 screen components/gates, including Home, Discover, Radio, Mix, Radar, Album, Artist, Genre, Playlist, Profile, Now Playing with synchronized Lyrics and Similar, Queue, and explicit-download management embedded in Playlist/Library | Party, public profile, and admin/status UI remain absent. The new offline surfaces still need rebuilt-APK and airplane-mode acceptance. |
| Primary mobile navigation | Start, Search, Discover, Radio, Library | Five typed tabs in the same order, avatar/Profile access, global mini-player, nested catalog stacks, predictive-Back configuration, safe account-scoped stack restoration, and validated cold-link Back topology | Rebuilt-device predictive gesture/process-death proof, responsive window classes, verified App Links, and the complete link/share matrix remain open. |
| API client surface | 73 facade methods | 73 strict runtime endpoint wrappers plus query keys/options, repositories, mutation helpers, and a generated v2 artifact covering 54 wire schemas, 73 paths, and 82 HTTP operations. Album Search now traverses a human-owned generated-operation adapter that binds the generated method/path/media/status descriptor and exact success status before repository wire→domain mapping | Most runtime feature wrappers remain hand-maintained, eight success families are underspecified upstream, and web does not consume the generated artifact. Explicit wire/domain separation still has only one complete Album Search seam; cross-client production fixtures remain open. Production cannot serve the Android v2 client until `/api/version` is deployed. |
| Language | Predominantly German | German is the active default; typed German/English catalogs include recovery, bookkeeping, queue, Android Auto roots, and notification-channel copy; Profile exposes a persisted device-level selector | Full authenticated English traversal, process restart, Android Auto, notification-channel, and rare platform/native fallback surfaces remain unverified. |
| Brand accent | Violet `#7c5cff`, gradients, cover-derived ambience | Production violet tokens, lockup/logo, dark surfaces, a static blurred cover backdrop, framed high-resolution player artwork, adaptive icon, and a consistent Material Design Icons font for transport/navigation/action controls | Complete contrast/TalkBack/device-state evidence, dynamic cover-palette theming, and the light/dark/adaptive-mask device matrix remain open. Current release lint no longer reports the earlier launcher encoding/full-square defects. |
| Playback | Browser player, two-level product queue, retry/skip recovery | The product controller/queue behavior and 28 consumers use an owned facade over the first-party Media3 service. Strict native mapping, trusted-controller policy, cache/preload, progress/sleep engines, encrypted state plus playback-event journal, private Headless drain, and reboot-persistent WorkManager wake are source/JVM complete | Authenticated kill/lock/reboot delivery, notification/Android Auto lifecycle, real recovery/auto-skip, crossfade, and the play-count metric matrix remain open. Historical RNTP evidence is regression input only. |
| Offline | Explicit playlist downloads plus cache indicators | Source-complete explicit playlist Download/Remove, aggregate progress, complete/partial inventory, encrypted account-scoped manifest v2, deduplicated controlled local audio, strict local-only playback, shared downloaded-row state, cold Playlist/Library reconstruction, and an Android Auto Downloads root; the separate 500 MiB rolling cache remains an optimization | Force-stop/cold airplane-mode playback, seek/transport, quota/full-disk, removal/account-switch, TalkBack, and car-device matrices remain unverified on a rebuilt APK. This source is not release-ready. |
| Release evidence | Web behavior in production | Source `d979e9b` passes TypeScript, ESLint, 152 mobile Vitest files / 1,050 tests plus one todo, 115/115 first-party JVM tests, local and remote 7/7 API 36 instrumentation tests, release lint/assembly, the 445-source/1,095-APK zero-finding gate, GitHub x86_64 cold/warm smoke, and downloaded-ARM64 clean-install cold/warm emulator startup for `1.0.3`/`10014`. Historical b10012 and v10005 evidence remains regression input only | Exact-commit remote CI and the debug-signed QA prerelease are complete. Authenticated cleanup, production v2, credential remediation, production signing/AAB, and the full lifecycle/network/accessibility matrix remain open. |

## 4. Master difference matrix

| Area | Web baseline | Current Android working tree | Decision | Priority | Work IDs |
|---|---|---|---|---|---|
| Architecture/contracts | Broad typed facade, persisted Query cache | 73 runtime wrappers, strict decoders, repositories, Query keys/options/mutations, versioned OpenAPI v2, a complete generated compile-time wire/operation artifact, a descriptor-driven human-owned request adapter, and the first repository-owned AlbumCard domain seam | Adapt | P0 | ARCH-01…06 |
| Localization | German product copy | German default and typed English catalog with a persisted device-level Profile selector, including recovery/queue/Auto/channel copy | Port | P0 | SHELL-01 |
| Brand system | Violet brand, gradients, polished iconography | Violet semantic tokens, production lockup/artwork, adaptive assets, and consistent accessible Material Design Icons with a bundled APK font | Port | P0 | SHELL-02…04 |
| Navigation/shell | Five tabs, avatar/account, global player and queue | Five typed tabs, Profile avatar, global mini-player, catalog stacks and safe-area handling | Adapt | P0 | SHELL-05…09 |
| Authentication | Separate login/register, required name, invite URL | Required name/validation, invite parsing, confirmation, unified approval gate, and deterministic first-admin/invite/pending/recheck/restart/Retry/Forget/401/403 lifecycle coverage | Adapt | P0 | AUTH-01…06 |
| Home | Personalized shelves and direct starts | Home-first greeting, seven-item Recently Heard shelf with full duplicate-preserving history playback and catalog links, moods, stable personal-mix and Release Radar details with account-scoped unseen state/dates, because-listened, charts, releases, genres, and public/community playlists; every query shelf has loading/empty/stale/offline/retry behavior | Port | P1 | HOME-01…09 |
| Search | Tracks, albums, artists, playlists, filters, sorts, history, URL import | Race-safe multi-entity tabs, duration/title sorts, origin/account-scoped history with clear/remove, genre browse, evidence-backed track/play/cache metadata, exact-query last-good recovery, and strict Spotify paste/ACTION_SEND import with results/playback/bulk save | Port/Adapt | P1 | SEARCH-01…09 |
| Discover | Charts, genres, releases, community playlists | Shared catalog sections/cards for charts, genres, releases and public playlists | Port | P1 | DISC-01…05 |
| Genre details | Tracks, artists, albums, play all | Native detail with play-all, tracks, albums and artists | Port | P1 | CATALOG-01 |
| Album details | Metadata, duration, artist link, full context playback | Native detail, artist link, year, production-equivalent rounded aggregate duration, ordered tracks and full-context playback | Port | P1 | CATALOG-02 |
| Artist details | Follow, top tracks, search, releases, related, biography | Native hero/fan/play/follow, first-ten Popular with batched play counts, within-artist search, discography, related artists, and biography | Port | P1 | CATALOG-03…05 |
| Radar/mixes/moods | Dedicated routes and unseen/personal context | Native stable personal-mix and Radar details, Radar dates/account-scoped cumulative seen rules, and mood starts | Port | P1 | HOME-04…07 |
| Radio hub | Personal, mood, and genre stations | Personal/mood/genre surface plus race-safe endless extension; production timeout observed | Port | P1 | RADIO-01…04 |
| Library | Playlists, Likes, Recent, Downloads, Following | One bounded `SectionList` owns all five ordered sections and pull-refresh while preserving loading/empty/hard-error/cached-error/stale/offline/retry states; Downloads now lists complete and partial account-scoped local playlist snapshots with occurrence counts and opens the cold-capable Playlist route | Port | P1 | LIB-01…06 |
| Playlist management | Full CRUD, cover, visibility, order, export, offline | Global add/create, create/edit/delete/visibility, owner/public permissions, ordered playback, exact rollback for optimistic edit/visibility/add/remove/reorder, and explicit Download/Retry/Remove with aggregate progress and cold local fallback are implemented; backend entry IDs, cover upload, and ZIP export remain open | Port/Adapt | P1 | PLAYLIST-01…11 |
| Track rows/actions | Rich metadata and full contextual menu | Search and Queue show duration plus evidence-backed play/popularity/server-cache/device-cache metadata; the shared presentation provider now also publishes hydrated explicit-download tri-state and the shared indicator renders localized Downloaded state. Shared rows/cards/player expose optimistic like/unlike, visible actions, and a complete global accessible action sheet. Exhaustive TalkBack, consistent transition proof on every row, and rebuilt-device large-list performance evidence remain incomplete | Port/Adapt | P1 | TRACK-01…07 |
| Public profiles/follows | User profiles, public playlists, followed artists | Artist follow and following library exist; public user profiles remain absent | Port | P2 | SOCIAL-01…04 |
| Account/profile | Edit identity/password, avatar, delete, stats | Identity/role/approval, backend-aligned edit/session refresh, visible server host, stats, safe deletion flow and logout; upload absent | Port | P1 | ACCOUNT-01…06 |
| Playback settings | Crossfade and sleep timer UI | Native-service-owned 15/30/45/60 and corrected natural end-of-track timer, with remaining/cancel state; no crossfade UI/engine | Port/Adapt | P1/P2 | PLAYER-13…15 |
| Now Playing | Lyrics, similar, dynamic ambience, visualizer, volume | Four native Playing/Lyrics/Similar/Queue surfaces default to Lyrics. Similar keeps the complete ordered result, finite queue context, full row actions, and complete query states; Queue embeds the same state/mutation implementation as its standalone route. The album-linked title and every credited artist use validated native routes; a static bounded blurred cover backdrop and framed 1000 px artwork mirror production's base treatment. Android omits the desktop volume slider, configures music/exclusive audio, and binds visible-app hardware keys to the media stream. Dynamic palette extraction, visualizer, system-volume device proof, edge-Back dismissal proof, rebuilt visual evidence, and performance profiling remain open | Port/Adapt | P1/P3 | PLAYER-01…08 |
| Queue semantics | Manual queue before context, grouping, clear/reorder | Stable semantic manual/context queue items, insertion, idle start, move/remove, Previous, context-only shuffle/restore, clear-upcoming, encrypted paused process restoration, radio race handling, labeled history/current/manual/context sections, and shared cross-engine golden cases are implemented. QUEUE-09 lifecycle combinations, party integration, and rebuilt emulator evidence remain open | Port | P0/P1 | QUEUE-01…10, QUEUE-UI-01…05 |
| Playback resilience | Retry/backoff/re-probe/auto-skip | Connected readiness, classified retry/backoff, fresh headers, restore and safe stop/skip | Port | P0 | PLAYER-09…12 |
| Party mode | Shared queue, roles, SSE, drift correction, share link | Typed API/repository support only; no party UI/SSE integration | Port | P2 | PARTY-01…08 |
| Offline | Explicit downloads, progress, removal, markers | Account-scoped manifest v2, AES-GCM/Keystore encrypted atomic manifest persistence, verified no-backup audio storage, serialized download/remove/cleanup transactions, exact duplicate occurrence snapshots, shared-file refcounts, Playlist/Library controls, strict local-only queues, shared row markers, and Android Auto Downloads are source-tested; rolling cache remains separate | Port/Adapt | P1 | OFFLINE-01…09 |
| Deep links/share | Route URLs, invites, parties, content links | Production/custom routing for auth/search/account/catalog/library plus a compiled text-only Android Share target whose payload persists through auth/pending/account gates and is delivered exactly once to the owning Search scope; verified association, broader LoggeRythm-content Share intake, and outbound sharing remain absent | Adapt | P1 | LINK-01…07 |
| Query/error UX | Persisted stale data, skeletons, toasts | One shared remote-state contract covers all 46 `useQuery` calls and both `useQueries` groups, preserves populated and known-empty last-good outcomes, separates non-fatal playback bookkeeping, and maps auth/mutation/player failures to localized non-diagnostic copy; account-cleanup device proof and a shell-wide connectivity/snackbar policy remain incomplete | Port/Adapt | P0 | DATA-01…07 |
| Responsive layout | Mobile and desktop web layouts | Basic phone layout; rotation works but is unverified broadly | Adapt | P1 | A11Y-06…08 |
| Accessibility | Browser semantics/keyboard/reduced motion | Visible labeled 48 dp actions on shared/catalog/library/playlist/Home rows and enlarged player/queue targets | Adapt | P0/P1 | A11Y-01…09 |
| Admin/status | Users, approval, storage, invites, diagnostics | Typed endpoints only; no role-gated Android UI | Port | P2 | ADMIN-01…06 |
| PWA/browser mechanics | Service worker, install prompt, command palette, history buttons, hover | Not applicable | Adapt/Exclude | — | NATIVE-01…05 |
| Android background media | Browser media behavior | Native service, notification, lock screen, Bluetooth/noisy | Preserve | P0 | NATIVE-06…10 |
| Android Auto | Not a web surface | Likes/playlists plus a verified local Downloads root, native transport, last-good same-account persistence, and a local-only post-commit Downloads refresh that makes no auth/repository request; false voice-search claim removed | Preserve/Extend | P1 | AUTO-01…08 |
| Security/session | HttpOnly same-origin cookie | Origin-bound SecureStore token/cookie, native stream headers, pre-auth account-switch teardown, local-first account cleanup including scoped/all-scopes explicit-download invalidation, canonical production-origin guard, and real Keystore round-trip evidence | Preserve/Harden | P0 | SEC-01…09 |
| Test/release | Production web plus web tests | Broad local unit/native/instrumentation/lint/release checks and passing API 36 session/queue QA; debug-signed ARM64 artifact | Adapt | P0 | QA-01…18, REL-01…09 |

### 4.1 Working-tree verification ledger

This ledger distinguishes implementation/configuration from executed evidence. It does not close the backlog items whose full acceptance matrices are still open.

| Gate | Result | Evidence |
|---|---|---|
| TypeScript, lint, unit/model/data tests | **Passed for source `d979e9b`** | TypeScript, repository-wide ESLint, and 152 Vitest files / 1,050 tests plus one explicit todo pass. The API contract/full suite passes 50/50; the browser queue contract passes; Expo Doctor passes 20/20. |
| Credential-safe Android harness tests | **Passed** | 34 Python harness tests, including overlay-aware installed-session traversal and standalone release-APK assertions. |
| Native player unit tests | **Passed for source `d979e9b`** | The first-party Media3 protocol/controller/cache/persistence/sleep/browse/policy/journal/WorkManager suite passes 115/115 release JVM tests. Complete authenticated kill/lock/reboot product effects and cold Auto remain open. |
| Generated Android native extensions | **Two deterministic clean regenerations and artifact proof passed** | Two clean Expo prebuilds produced identical hashes for settings, manifest, Gradle properties/build, MainApplication, and MainActivity. The executable gate scans 445 source/generated files and 1,095 APK entries with zero findings, including the kept journal Worker, private Headless service, WorkManager/boot markers, and no old player project. |
| Native device instrumentation | **7/7 first-party tests passed locally and remotely on API 36** | Keystore/encrypted-persistence round trips and the real separate-package/separate-UID hostile-controller matrix pass on the local ARM64 emulator and GitHub-hosted x86_64 emulator in run #14. Process death/reboot, notification/media buttons, authenticated account cleanup, and key invalidation remain open. |
| Android lint | **Passed on the first-party release candidate** | Release lint passes after the config plugin writes the fully qualified MediaLibraryService and both Media3/platform browser actions. `ExportedService` is explicitly suppressed because a media-browser host must bind cross-package; that narrowly documented suppression is accepted only with runtime trust filtering and the separately tracked hostile-controller device test. |
| Release assembly | **Passed locally and in exact remote run #14 for ARM64 Media3 `1.0.3`/`10014`** | Native release JVM tests, app release tests, app/native/hostile-controller lint, R8/minification, resource shrinking, and assembly pass with Hermes. The unpacked gate, v2 signature, 16 KiB alignment, nondebuggable mode, production-origin/no-Metro scan, WorkManager/Headless manifest, Android Auto, and branding checks pass. The QA APK is debug-certificate signed; production signing/AAB remain open. |
| Standalone clean-install startup | **Passed for the downloaded remote Media3 v10014 APK** | On the Android Studio API 36 ARM64 emulator, the harness clean-installed the exact GitHub ARM64 APK and verified cold and warm embedded-Hermes starts under PID `17023`, branded German Login, exact production origin, no Metro reverse/runtime dependency, and no app-scoped crash/ANR/native/ReactNativeJS failure. GitHub's x86_64 v20014 APK independently passed cold/warm API 36 smoke. Authentication was deliberately not attempted because `/api/version` returned 404 before credential submission. |
| Installed-session emulator traversal | **Historical v10005 traversal passed; v10012 passes signed-out auth-layout smoke** | API 36 ARM64 v10005 credential-blind cold traversal passed secure-session restore, all five tabs, Profile, catalog/library navigation, links, stable PID, and crash audit. Installed v10009 had exposed a fail-closed explicit-store cleanup failure, fixed in v10011. On v10012, clean signed-out startup reached German Login; portrait Login/Register passed visual/accessibility inspection, and both modes scroll safely at 2400×1080 with their submit and auth-mode toggle fully above the gesture bar at the lower bound. Login's IME-focused field remains visible. No credential was entered or sent because `/api/version` failed before auth. Account-switch and full filesystem/queue/cache/notification/Auto cleanup evidence remain open. |
| Real production playback and queue | **Partially passed** | Playlist playback reached native `PLAYING`; position/buffer advanced; media-key pause and in-app Next worked. On-device queue QA verified manual priority, accessible reorder, clear-upcoming, context-only shuffle and exact restoration. A 40-item Metallica search queue restored after force-stop/cold launch with title/order/count preserved and paused UI (`Wiedergabe starten`): v10005 was observed at `51200 ms` pre-stop and restored at `59881 ms`. A Focus radio station separately exhausted three stream-resolution timeouts and stopped safely; repeat/radio/background/Auto/reboot coverage remains open. |
| Reversible profile behavior | **Passed for tested path** | All-time/30-day stats rendered; a 15-minute sleep timer was started and cancelled. Account deletion/logout/edit mutations were intentionally not executed against production. |
| Reversible like behavior | **Passed for tested path** | Like changed Library Liked Tracks 34→35 immediately; cleanup unliked it 35→34, and a cold traversal confirmed it remained unliked. |
| Link routing | **Partially passed** | Valid catalog/account/search routes and slug parsing mounted intended screens; malformed playlist input produced `invalid-content-link` without a crash. Verified HTTPS App Links remain blocked by missing server association. |
| Visual phone QA | **Portrait and short-landscape auth layouts passed; broader matrix open** | Historical 1080×2400 captures confirm production violet branding, German shell/content, account avatar, tabs, artwork, queue grouping, and 48 dp controls. v10012 portrait captures confirm the production dark/violet Login/Register surface is readable, branded, toggleable, and exposes labeled form controls. At 2400×1080, a centered `520 dp` maximum-width card lets Login and Register scroll to fully visible submit and auth-mode controls above the gesture bar; focused Login input remains visible with the IME. This closes v10011's specific auth clipping defect, not the authenticated, tablet/foldable, 200%-font, TalkBack, contrast, or mask matrices. |
| Candidate APK | **Exact remote first-party Media3 QA candidate passed release gates** | `LoggeRythm-1.0.3-10014-arm64-Media3-QA-debug-signed.apk` is 27,659,704 bytes with SHA-256 `92a3d4e81c2163a92139556ba2cb0e04e702eb48979c6a5c6f1e2bc27b3e62d5`. It is nondebuggable, ARM64-only, Hermes/R8 built, 16 KiB aligned and v2-signed by the Android debug certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; it is strictly a QA/prerelease artifact. |
| Candidate diagnostics | **Exact remote set verified and published** | R8 mapping is 35,201,416 bytes (`6c1c41268823e9bd73231e7278a5e394a75314df68e2a67fed5c6422b505510a`), resources mapping 1,891,427 bytes (`cd7ac33d9edafdc62fdaa617d4fefc7bb5d0c846e28b08649d616b7bdd731781`), ARM64 native-debug-symbol ZIP 5,085,415 bytes (`6fba283caa9e0f9191df60561962087ab79977e605cf0d0478abcef06dc2a0b5`), and Hermes source map 7,341,282 bytes (`0294bf8f7188afcacc8806c026b7c329963c4c17f02bfd7a6892591201eb0d6c`). |
| Remote release evidence | **Exact run and QA prerelease published** | GitHub workflow [`29559829540`](https://github.com/LoggeL/LoggeRythm/actions/runs/29559829540) / #14 succeeded on source `d979e9b` from `2026-07-17T06:22:03Z` to `06:47:21Z`; QA job `87819719304` uploaded digest-bearing ARM64, x86_64, and report artifacts. GitHub release `355522934` published [`android-media3-v1.0.3-rc.1`](https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.3-rc.1) at `2026-07-17T07:05:47Z` with seven uploaded assets whose remote digests match the staged files; it is debug-signed, prerelease-only, and intentionally not latest. |

### 4.2 Highest-risk open gates

- **Architecture:** finish the first-party player lifecycle; migrate the remaining hand-written runtime wrappers and feature caches through the generated-operation adapter into explicit domain models; type the eight underspecified backend success families; add cross-client production fixtures; and atomically deploy the already-implemented v2 compatibility/playlist contract under an identified authority. Clean prebuild plus assembled-APK gates and the Album Search/duplicate-safe playlist-entry seams pass, but production currently returns 404 from `/api/version`.
- **Queue:** repeat/radio/background/Android Auto/reboot lifecycle coverage and rebuilt emulator verification of the new history/current/manual/context sections. The versioned web/Android golden contract, semantic caller contexts, labels, and announcements pass locally; encrypted paused restoration evidence is historical RNTP input only until the first-party persistence lifecycle passes.
- **Auth/security:** deterministic source tests cover first-admin/invite/pending/recheck/restart/Retry/Forget/401/403 behavior, CAS session revisions, serialized storage cleanup, and a fail-closed cleanup barrier. v10009 exposed a false `storage-scope-invalid` result when an explicit-store child did not yet exist; v10011 rebased children on the validated canonical `no_backup` boundary and combined lexical containment with double-`lstat` missing-child validation. v10012 retains successful signed-out cleanup to Login and logs only allowlisted boundary/code identifiers, while current local and remote 7/7 instrumentation rejects the hostile separate-UID controller. Successful account-switch plus filesystem/queue/cache/notification/Auto evidence, secret-leak evidence, and credential rotation/history remediation remain open.
- **Accessibility/layout:** comprehensive roles/state, TalkBack/focus, 200% text, broader landscape/tablet/foldable, high contrast, and reduced motion remain open. The 23 used Material Design icon names and bundled font pass source/APK checks, high-frequency row/player/queue actions are 48 dp, and queue/repeat mutations have exact announcements. v10012 closes the specific v10011 2400×1080 auth clipping defect with centered bounded-width, vertically scrollable Login/Register cards and verified IME focus retention.
- **Product parity:** consistent metadata/state and device-proven large-list behavior across every track row; rebuilt-device explicit-download lifecycle acceptance; public profiles; party/admin UI. Personal Mix/Radar details, public/community Home content, Spotify import, synchronized Lyrics, the complete shared action set, bounded vertical list ownership, and the explicit-download source stack now pass focused source tests.
- **Platform/release:** authenticated headless journal delivery and Auto cold-tree completion; verified App Links; real lifecycle/network-fault automation; production signing/AAB; upgrade/rollback; credential rotation/history decision; and the broader device/accessibility matrix. Clean prebuild, assembled/unpacked APK, exact-source remote CI, hostile-client coverage, native-symbol publication, version/tag/checksum, release publication, and zero-finding source/generated gates pass for the QA candidate.

### 4.3 High-risk acceptance and evidence ledger

“Implemented” below never means “closed.” A checkbox closes only after the final column is satisfied and linked from the exact candidate revision.

| Work ID | Current source boundary | Evidence required to close |
|---|---|---|
| **PLAYER-12** | Retry classification, bounded backoff, source re-probe, position restore, and safe exhausted recovery are implemented. | Authenticated locked/background device run covering transient recovery and permanent-item auto-skip without a stalled or corrupted queue. |
| **PLAYER-13** | First-party native sleep engine and deterministic JVM cases are implemented. | Current Media3 APK with real audio: every preset, end-of-track, remaining/cancel, repeat, manual skip, final item, lock screen, background, and process/service lifecycle. |
| **PLAYER-16** | Encrypted bounded journal, atomic PLAY/RADIO transition, two-phase drain, session authority, empty-payload Headless bridge, persistent OS-wake work, and final source/JVM/TypeScript/CI gates pass for `d979e9b`. | Complete authenticated kill/lock/background/reboot/network/401/account-switch/full-capacity device matrix and a no-secret forensic inspection. |
| **PLAY-COUNT-01…03** | Per-event UUID idempotency prevents retry duplication; no product threshold has been approved. | One shared web/Android metric definition and backend fixtures for threshold, rapid skip, repeated queue occurrences, repeat-one, replay, seek, foreground/headless handoff, process recreation, and final aggregate counts. |
| **AUTH-05 / DATA-03 / SEC-05** | Cleanup is serialized and fail-closed; stale 401 invalidation is bound to the exact session generation. | Two authenticated accounts on the final APK; inspect query/storage/download/player/notification/Auto/journal state before and after logout, account switch, deletion, cleanup failure, and retry. |
| **AUTO-07** | Trusted-controller policy and encrypted browse/player storage have source/JVM/device slices. | Cold service-only restore, post-reboot browse/play, logout clearing, and trusted Android Auto behavior while the hostile separate-UID client remains rejected. |
| **QA-04** | **Closed:** local ARM64 and GitHub-hosted x86_64 API 36 instrumentation both pass 7/7 Keystore/persistence/controller-trust cases for source `d979e9b`; run #14, job, reports, APK relationship, and device/API are recorded. | Keep the remote job/report evidence retained with the release; new instrumentation cases must remain required by CI. |
| **QA-18** | Current source/tag/workflow/APK/diagnostic/device/signed-out UI evidence and explicit exceptions are frozen in [`ANDROID_MEDIA3_QA_2026-07-17.md`](./ANDROID_MEDIA3_QA_2026-07-17.md). | Append authenticated kill/lock/reboot/offline journal delivery, account cleanup, real playback, Auto, and remaining lifecycle evidence before closing this umbrella. |

## 5. Ordered implementation backlog

### Phase 0 — Contracts, player invariants, and release foundations

These tasks unblock safe parallel feature development.

#### Architecture and data

- [ ] **ARCH-01 (P0)** Export a versioned FastAPI OpenAPI document and generate Android wire types/client stubs.
  - Acceptance: CI fails when a backend schema or route changes without regenerated artifacts; current production fixtures decode on both web and Android.
- [ ] **ARCH-02 (P0)** Define domain models separately from generated wire models, preserving nullable fields such as playlist `description` while canonicalizing transport-only IDs, names, URLs, dates, and sentinel values.
  - Acceptance: domain mapping has fixtures for nullable fields, legacy IDs, missing optional media, and malformed payload errors.
- [x] **ARCH-03 (P0)** Add an API compatibility/version check with a user-readable unsupported-server error.
  - Acceptance: older/incompatible test responses fail once, loudly, without corrupting cached state or silently substituting data.
- [x] **ARCH-04 (P0)** Introduce feature repositories and TanStack Query keys for auth, home, search, catalog, library, playlists, follows, stats, party, and admin.
  - Acceptance: cancellation, invalidation, stale fallback, empty/error states, and account-scoped cache eviction are covered by tests.
- [x] **ARCH-05 (P1)** Decide whether self-hosted Android users need a runtime server selector; production remains the safe default.
  - Acceptance: the selected origin is HTTPS, visibly identified, origin-bound to its session, and cannot silently reuse credentials from another host.
- [x] **ARCH-06 (P0)** Document and own the RNTP licensing/patch strategy.
  - Acceptance: permitted distribution is recorded; patch/fork upgrades have an owner, rebase procedure, native regression suite, and rollback plan.

Progress: the canonical versioned OpenAPI v2 document covers 54 component schemas, 73 paths, and 82 HTTP operations. A deterministic standard-library generator emits every `*Wire` component, typed path/query/header/cookie/body request, full response-status map, successful response alias, auth/media/status descriptor, OpenAPI fingerprint, and compile-time `GeneratedApiClient`. A human-owned `requestGeneratedOperation` adapter now consumes those descriptors at runtime, owns path/query/body validation, forbids caller-supplied cookies, forwards cancellation, and makes `apiRequest` accept only the operation's exact generated success statuses. Album Search is the first endpoint routed through this seam. Exact run #14 verifies live FastAPI → versioned JSON → generated TypeScript drift and regression-tests complete API/generated path triggers. Strict runtime decoders remain human-owned. ARCH-01 remains open because most runtime feature wrappers are still hand-maintained, web does not consume the generated artifact, eight backend success families remain `unknown`/generic due missing response models, an API-only change has not yet independently proven the path trigger, and current production fixtures have not decoded on both clients.

ARCH-02 now has one proven vertical seam: Track-shaped Album Search wire rows traverse the generated operation adapter, then map in the repository to a human-owned `AlbumCard`, normalize legacy numeric/empty IDs and optional artwork, reject malformed path-specific identities/titles, and enter TanStack Query/UI without transport-only fields. Every other major feature remains mixed across wire/domain/UI models, so the umbrella stays open. ARCH-04 is closed at the source/test boundary: the compatibility `MusicRepository` is composed from 11 feature-sized capabilities, auth has a separate injectable five-operation repository, and only those two production adapters import endpoint implementations at runtime. AuthProvider remains the sole session/identity/cleanup authority; Query is not a second auth store and personalized Query data remains intentionally memory-only rather than plaintext-persisted. All 37 read factories and 21 mutation factories are executable table contracts that fail when a new factory lacks exact normalized key/payload coverage; every read forwards TanStack cancellation. Real QueryClient tests prove failed refetch retains last-good data, cancellation rejects a late non-cooperative replacement, identical resources remain account-isolated, and completed query plus mutation state is synchronously evicted. Player recovery/radio/history and Android Auto browse publication use the same repository seam while preserving timeout and cancellation semantics. Source `d979e9b` passes `npm ci`, TypeScript, ESLint, and 152 files / 1,050 mobile tests plus one todo locally and in exact run #14. ARCH-05 is closed by [`ANDROID_SERVER_ORIGIN_POLICY.md`](./ANDROID_SERVER_ORIGIN_POLICY.md): the release has no runtime selector, uses only the canonical HTTPS production origin, identifies its effective host in Profile, scopes session/query/storage state by origin, and permits cleartext only for an explicit debug build. ARCH-06 is satisfied by the historical provenance in [`RNTP_PATCH_OWNERSHIP.md`](./RNTP_PATCH_OWNERSHIP.md) plus the active exit plan in [`FIRST_PARTY_MEDIA3_MIGRATION.md`](./FIRST_PARTY_MEDIA3_MIGRATION.md). The source-owned dependency/patch removal, clean-prebuilt gate, assembled APK scan, and QA prerelease are complete; REL-02 remains open specifically for approved production signing/distribution and any required AAB.

ARCH-03 is locally implemented and unit-tested. The unauthenticated, no-store `GET /api/version` response advertises the current and compatible contract versions. Android checks it before every normal API request, native stream-source request, and authenticated media-header request. Definitive missing, malformed, or incompatible responses fail once per origin/process with user-readable German/English errors; network, timeout, 429, and 5xx failures remain retryable. Boundary tests prove rejection occurs before session reads, migration, deletion, invalidation, or the requested network operation.

**Production rollout blocker:** the 2026-07-17 read-only check found that `https://loggerythm.logge.top/api/version` still returns HTTP 404 with `{"detail":"Not Found"}`. The Android v2 compatibility gate intentionally treats that response as definitively unsupported and caches the failure for the process before authenticated/API/media access. Backend v2 source exists in repository history at `c724ff6`, but that is not deployment evidence. Historical v10012 and the current downloaded v10014 APK both preserve the fail-closed signed-out behavior. No production deployment was performed and no credential was entered or sent. Required order: deploy the backend endpoint and v2 playlist contract atomically, verify a public HTTP 200 response advertising compatibility with `v2`, record the exact deployed backend revision, then rerun Android/emulator evidence. Do not weaken HTTP 404 into silent compatibility.

The repository has no production deployment workflow. Its Dokploy-oriented image bundles FastAPI and Next.js in one container, while the tracked branch, auto-deploy trigger, environment, `/data` mount, and rollback target live outside this repository. Backend v2 exists only in the local working tree and the base `e2ecf76` does not contain it; the local backend also includes broader auth/contract changes. Do not push only `/api/version` or weaken the client as a hotfix: metadata and duplicate-safe playlist-entry behavior must deploy atomically. Before any push, identify the deployment authority and Dokploy tracking behavior, preserve the exact production environment and persistent volume, prepare and test a clean reviewed candidate SHA, record the last-known-good image/SHA and database backup, then obtain explicit production-change approval for the combined API/web restart. Roll back by redeploying that recorded image with the same environment and `/data`; a restored 404 intentionally leaves current Android fail-closed.

#### Queue contract

- [x] **QUEUE-01 (P0)** Specify one product queue contract shared by web and Android: current item, ordered manual items, then remaining context items.
- [x] **QUEUE-02 (P0)** Store `manual|context`, context ID/type, original context order, and stable item IDs in/alongside native queue items.
- [x] **QUEUE-03 (P0)** Make **Play next** insert immediately after current; make **Add to queue** append after existing manual items but before context.
- [x] **QUEUE-04 (P0)** On an idle queue, both manual actions must create a visible queue and start playback, matching web behavior.
- [x] **QUEUE-05 (P0)** Match agreed removal and reordering rules, including safe current-item behavior and serialized native mutations.
- [x] **QUEUE-06 (P0)** Shuffle only context, preserve manual priority, and restore original context order when shuffle is disabled.
- [x] **QUEUE-07 (P0)** Add clear-upcoming without losing the active track; define behavior for manual-only/context-only queues.
- [x] **QUEUE-08 (P0)** Match Previous: restart current after three seconds; otherwise move to the previous item.
- [ ] **QUEUE-09 (P0)** Preserve queue invariants through repeat modes, radio extension, background transitions, process recreation/reboot, and Android Auto commands.
- [x] **QUEUE-10 (P0)** Create golden queue fixtures and run the same cases against web and Android engines.
  - Acceptance for QUEUE-01…10: from `current, context-A, context-B`, adding `manual-A` then `manual-B` yields `current, manual-A, manual-B, context-A, context-B`; shuffle may reorder only context; disabling shuffle restores it; no operation duplicates or loses current.

Evidence for checked items: [`contracts/product-queue.v1.json`](../contracts/product-queue.v1.json) is the normative `history → current → manual → context` contract. Its three cases, 14 successful mutations, and three rejected unsafe mutations are consumed unchanged by the production browser queue policy and Android controller tests. They cover Add, Play next, context-only shuffle/canonical restore, same-section move, remove, clear-upcoming, retained history/current, and active/boundary rejection; CI path filters and a focused browser consumer make contract changes trigger Android QA. Stable-ID unit/contract coverage passes; every `playTracks` caller supplies a semantic `QueueContext` with a human label, and native items persist source/manual status, context ID/type/label, original order, and stable metadata. The API 36 emulator verified two manual items remain ahead of context, a manual reorder succeeds, clear-upcoming preserves the playing item/history, context-only shuffle changes only context, and disabling shuffle restores the exact original context order. Encrypted process persistence restored a 40-item Metallica search queue with the same active title/order/count and a paused `Wiedergabe starten` UI. The original v10004 state saved `24950 ms` but exposed a numeric-string cold-start crash; v10005 fixes that representation with an exact regression and restored a fresh run from an observed `51200 ms` pre-stop to `59881 ms`. QUEUE-09 remains partial/open because repeat, radio extension, background, Android Auto, and reboot combinations are not complete. Retained history now has a separate working-tree UI section under QUEUE-UI-04, but that newer presentation awaits rebuilt emulator evidence.

#### Playback foundation

- [x] **PLAYER-09 (P0)** Expose a real native MediaController connected/failed promise or event; do not mark the player ready before it resolves.
- [x] **PLAYER-10 (P0)** Add bounded stream retry with backoff and position restoration.
- [x] **PLAYER-11 (P0)** Re-probe failed sources and distinguish offline, session expiry, authorization, backend materialization, codec, and generic network errors.
- [ ] **PLAYER-12 (P0)** Auto-skip only after retries fail, with an accessible explanation; work identically while locked/backgrounded.
  - Device acceptance for PLAYER-12 and QA-07/09/10: authenticated real audio reaches Ready/Playing, seeks, backgrounds, resumes through the notification, survives transient 500/timeout/loss, and skips permanently bad media without stalling the queue.
- [ ] **PLAYER-16 (P0)** Make PLAY and RADIO product side effects durable when React is suspended, killed, or restarted, without allowing the bookkeeping path to control audio.
  - Acceptance: store only a strict non-secret event schema in account-and-origin-bound encrypted state; cap bytes, count, age, attempts, claim size, and lease duration; give every PLAY occurrence a stable UUID; persist a PLAY plus its matching RADIO transition atomically; persist RADIO before publishing its queue mutation; make stale radio completion a no-op; and preserve queue/Android Auto changes across every encrypted-state commit.
  - Delivery acceptance: use two-phase claim/commit/abort recovery, a persisted OS wake containing no event or credential payload, bounded retry without a tight loop, and an authoritative session-generation guard before every authenticated request. Logout, account switch, deletion, and destructive cache clear must remove events, leases, and scheduled wakeups.
  - Device acceptance: prove enqueue/drain across foreground→background, locked screen, React teardown, process death, force-stop/relaunch, reboot, denied Headless start, network loss/recovery, 401, account switch, duplicate/repeated media IDs, and a full journal. Inspect encrypted files, WorkManager state, logs, requests, and final server counts; no URL, cookie, token, email, response body, or raw error may appear.

Evidence for PLAYER-09/10/11: the patched native controller completes only after Media3 `buildAsync().get()`, listener attachment, and controller installation, and emits an explicit failure otherwise. JavaScript subscribes before native setup, exposes a retryable Promise, and marks commands/listeners ready only after that Promise resolves; an installed-emulator log recorded this order. Recovery has category-specific finite schedules, a six-attempt global cap and wall-clock budget, re-probes the server, rebuilds the active item with fresh authenticated headers, restores the captured position, and resumes. Classification distinguishes network/offline/timeout, session 401, authorization 403, source 404/416, backend 5xx/materialization, renderer/codec, and unknown failures. Three focused suites pass 35 tests for pending/failure/retry readiness, exact backoff/caps/reclassification, fresh-source replacement, and position restoration. Production playback reached `PLAYING`, and a Focus station exercised the exhausted three-timeout path without crashing or losing the queue. PLAYER-12 remains open because permanent-bad-item auto-skip has not been proven identically while locked/backgrounded; that device/network matrix remains under QA-07/09/10.

#### Data/error state

- [x] **DATA-01 (P0)** Replace screen-local request effects with the repository/Query layer.
- [x] **DATA-02 (P0)** Define loading, refresh, empty, stale-success, blocking-error, and non-blocking-error UI for every collection/detail screen.
- [ ] **DATA-03 (P0)** Scope persisted query/cache data by account and server origin; clear it on logout/account switch.
- [x] **DATA-04 (P1)** Keep last-good data visible during refresh errors and mark it as stale.
- [x] **DATA-05 (P1)** Fix search so old results cannot appear actionable under a new query.
- [x] **DATA-06 (P1)** Separate audio failures from non-fatal play-history/radio bookkeeping failures.
- [x] **DATA-07 (P0)** Map auth and mutation failures to localized, action-specific, non-diagnostic copy; preserve actionable local validation, announce outcomes, and keep raw details only in redacted diagnostics.

Progress: all feature reads use centralized Query options/repositories; a source audit found no direct endpoint or `fetch()` calls in screens/components, and cancellation/scoping plus complete repository endpoint wiring pass tests, closing DATA-01. DATA-02 and DATA-04 are closed at the source/test boundary. One shared resolver distinguishes never-loaded loading/offline/hard-error bodies from successful empty/content bodies, with mutually exclusive cached-offline, cached-refresh-error, refreshing, and stale notices. Last-good populated and known-empty outcomes remain mounted during refresh and transport failures. Multi-query refreshes settle independently, retries expose busy/disabled state, and query-owned failures use localized non-diagnostic copy. The audit accounts for all 46 literal `useQuery` calls and both `useQueries` groups; the only state escape found—a missing personal-mix key returning before collection notices—was fixed and regression-tested. The final mobile gate passes 152 files / 1,050 tests plus one todo with TypeScript and ESLint clean. The downloaded first-party APK now has signed-out branding/rotation/startup evidence; authenticated surface and TalkBack verification remain under QA-11/15 because production blocks the v2 client before login.

Cache scopes bind server origin plus account; CAS session revisions prevent stale restore commits; logout/account replacement serialize query/mutation, recent-search, identity, explicit-download, queue/player, and session cleanup behind a fail-closed barrier. The patched native automatic-cache purge is awaitable, stops writers, removes every resource, verifies deletion, and rejects fail-closed; a later credential request cannot pass an incomplete cleanup. The v10009 **Forget session and sign in** failure was traced to absent explicit-store children being canonicalized before they existed and falsely rejected as `storage-scope-invalid`. v10011 validates the canonical `no_backup` boundary first, rebases the requested child on that boundary, and applies lexical containment plus double-`lstat` validation for a missing child. Signed-out cold bootstrap now completes cleanup and reaches Login without a cleanup warning; structured logging exposes only allowlisted boundary/code identifiers. DATA-03 remains open until cache/notification/queue/download/Auto state is inspected across authenticated logout and account switch, and a shell-wide connectivity/snackbar policy also remains product work.

DATA-07 is closed at the source/test boundary. Typed feedback mappers now cover auth/bootstrap/logout/player startup, Profile save/delete/timer, catalog playback/follow/local storage, Library and playlist actions, global track actions, Spotify import, and the shared player error banner. Arbitrary URLs, response bodies, emails, tokens, storage keys, native codec details, and cleanup diagnostics collapse to localized action copy. Deliberately authored server-compatibility recovery, local registration/profile validation, sleep-timer outcomes, and player-recovery explanations remain specific through explicit typed markers. The player banner no longer writes raw native/transport detail to Logcat. Six pure mapper suites pass 12 privacy tests, the affected component/lifecycle suites assert alert/live behavior, and the complete 152-file / 1,050-test mobile gate is green. Rebuilt-APK TalkBack and log inspection remain under QA-15/18 and SEC-04 rather than reopening the satisfied presentation boundary.

#### Remote-state coverage ledger

| Surface | Remote reads and outcome owner | Covered source behavior | Evidence |
|---|---|---|---|
| Shared contract | `resolveRemoteVisualState` plus feature adapters | Never-loaded loading/offline/hard error; successful empty/content; cached offline/refresh error; refreshing; stale; deterministic notice precedence | `remoteState`, adapter, and presenter tests |
| Home | Stats/recent, mixes, Radar, because-listened, chart collections, charts, releases, community playlists, genres, and selected mood | Ten independently retryable shelves; partial failure never hides successful siblings; pull refresh uses `allSettled` | `HorizontalShelf.test.ts`, Home model/playback suites |
| Discover and catalog details | Four Discover sections; Album; Artist primary/follow/play counts/search/about; Genre; Mix; Radar | Page gates, embedded boundaries, section states, post-data notices, successful empty details, and missing-Mix-key refresh/offline/stale preservation | `CatalogStates.test.tsx`, `MixScreen.test.tsx`, catalog/model suites |
| Radio | Stats plus personal track hydration, four mood query groups, and genres | Aggregate personal state, per-mood state, genre state, cached playable stations, independent retry, and safe action/query separation | `radioModel.test.ts`, `RadioCards.test.tsx` |
| Library | Playlists, Likes, Recent/stats, and Following use remote state; Downloads is owned by the encrypted local manifest | Four remote sections distinguish never-loaded from successful empty and retain populated/empty last-good outcomes; Downloads distinguishes hydration, unavailable storage, empty inventory, complete snapshots, and partial snapshots without a remote dependency | `librarySectionState.test.ts`, `LibrarySection.test.tsx`, `LibraryScreen.test.tsx`, `offlineScreenModel.test.ts` |
| Search and import | Track/album/artist/playlist aggregate, play/cache metadata, genre browse, Spotify resolve, and playlist destinations | Exact-query ownership, partial results, auxiliary-metadata failure, offline last-good, known empty, and separate action errors | `searchRemoteState.test.ts`, `SearchRemoteStates.test.tsx` |
| Playlist and action destinations | Playlist/Liked detail and global add-to-playlist destinations | Blocking gate, empty/content body, cached notices, busy retry, and retained actionable data | `PlaylistRemoteStates.test.tsx`, `TrackActionsPlaylistPicker.test.tsx` |
| Profile and player controls | Listening stats, lyrics, and per-track like state | Stats and lyrics use full shared-state UI; like state keeps a cached toggle actionable and conveys refresh failure without replacing it with Retry | Profile stats, Lyrics, and TrackLike tests |
| Queue and player readiness | Native queue snapshot, remote queue metadata, and local native-player readiness | Equivalent loading/empty/content/error/refresh last-good state for non-Query sources; metadata never blocks the playable native queue | Queue snapshot/metadata and Now Playing model tests |

Contract note: `hasData` is the authoritative never-loaded discriminator. The shared input retains the Query `pending` field for adapter parity, but a disabled idle query with no successful response would otherwise look never-loaded; every current conditional query either hides its boundary or synthesizes a settled state while disabled. New conditional-query call sites must preserve that invariant and add a regression.

DATA-06 is closed at the separation boundary, while durability remains explicitly open under PLAYER-16. The working tree replaces the former best-effort `Promise.allSettled` bookkeeping path with an encrypted native event journal. PLAY and RADIO use strict allowlisted payloads, bounded retention, two-phase leases, stable event UUIDs, atomic transition persistence, durable-before-publish radio extension, an empty-payload OS wake, and an authoritative account/session request guard. A bookkeeping failure cannot pause, skip, reject, or otherwise control audio; successful PLAY persistence alone invalidates account stats. Malformed metadata and failures remain in the separate localized non-fatal notice channel, and Android Auto refresh failure never exposes raw diagnostics. Source/JVM/TypeScript coverage is required for every boundary, but locked/background/process/reboot acceptance belongs to PLAYER-16 and QA-07/08/10/18.

### Phase 1 — Production shell, brand, language, auth, and accessibility

#### Language and brand

- [ ] **SHELL-01 (P0)** Add a string resource/i18n layer; ship German as the production-default language and make English a complete selectable locale, including Android Auto roots, notification-channel copy, and native/recovery errors.
- [x] **SHELL-02 (P0)** Replace the green accent with production violet `#7c5cff` and shared semantic tokens for background, surface, text, border, success, warning, and danger.
- [ ] **SHELL-03 (P1)** Reuse the production logo/wordmark and cover treatment; verify light/dark icon assets and adaptive icon masks.
- [ ] **SHELL-04 (P1)** Replace Unicode transport/action glyphs with a consistent accessible vector icon set; add cover-derived ambience only where performance permits.
  - Acceptance: screenshots of auth, Home, Search, Library, Now Playing, and Queue are recognizably the same brand as production; contrast passes in every state.

Progress: the production violet `#7c5cff` and typed background/surface/text/border/success/warning/danger tokens are shared from one native theme, mirrored in Expo configuration, regression-tested, and visible in installed-device evidence, closing SHELL-02. The production lockup, artwork, dark surfaces, and adaptive icon are present. A Profile language selector now switches German/English at runtime, persists one device-level locale with fail-safe German fallback, and updates React render boundaries plus imperative/background catalogs; focused persistence/selector tests cover both values, busy state, corrupt storage, and failed writes. SHELL-01 remains open until a rebuilt authenticated emulator pass verifies the complete English shell plus Android Auto, notification-channel, native/recovery, and process-restart behavior.

Unicode transport/action glyphs have been replaced across navigation, player transport, queue, rows/cards, search/library/playlist/radio/profile actions, and create controls by one accessible `AppIcon` backed by `@react-native-vector-icons/material-design-icons`. All 23 referenced icon names resolve in the glyph map, decorative glyph nodes disable font scaling, Expo prebuild autolinks the package, and both historical v10012 and current v10014 package the `1,307,660`-byte `MaterialDesignIcons.ttf`. Release lint no longer reports the earlier launcher encoding/full-square defects. SHELL-03/04 remain open only for authenticated visual/contrast/TalkBack evidence, light/dark/adaptive-mask device verification, and the deliberate performance/product decision around dynamic cover-derived ambience; source and APK font presence no longer constitute an icon implementation gap.

#### Native information architecture

- [x] **SHELL-05 (P0)** Add primary navigation for Home, Search, Discover, Radio, and Library, with native Back behavior and preserved stack state.
- [x] **SHELL-06 (P1)** Add avatar/Profile access and a stable global mini-player on approved-user screens.
- [ ] **SHELL-07 (P1)** Define compact phone, landscape/short-window, tablet, and foldable layouts using window-size classes.
- [ ] **SHELL-08 (P1)** Add a native offline/connectivity banner and consistent toast/snackbar policy.
- [x] **SHELL-09 (P1)** Configure Android Back ownership and modal topology, construct safe deep-link stacks, and persist bounded account-scoped navigation state.

Evidence for SHELL-06: every approved root/detail header exposes Profile access, the same global mini-player wraps the five tabs and Profile, and the API 36 installed-session traversal verified Profile plus mini-player-safe navigation without a process failure. Responsive window classes and connectivity UI remain separate open items.

Evidence for SHELL-09: Expo and the generated manifest opt into predictive Back, and shared native-stack modal topology covers Now Playing and the standalone Queue route. Android dismissal is explicitly owned by system Back plus the visible close action; `gestureEnabled` was removed from the shared policy because native-stack documents and forces that option as iOS-only on Android. A versioned, 16 KiB-bounded navigation snapshot stores only sanitized Tabs and nested feature stacks under the exact server-origin/account scope; route keys, history, paths, unknown params, Profile, Now Playing, and Queue are discarded. Writes serialize, logout/account deletion waits for them and removes their registered key, malformed/wrong-version/oversized snapshots fail closed, and a cold initial URL always wins over restoration. Valid album/artist/genre/playlist links build a Discover Back stack; malformed IDs are rejected; Profile/Now Playing/Queue cold links synthesize `[Tabs(Home), transient]` so Back has a durable destination. Five focused files pass 28 cases. This closes the source/configuration and restoration contract, not an interactive-animation claim: React Native's root Back callback may still suppress predictive preview, so edge-gesture cancel/commit and process-death verification for the rebuilt APK remain under PLAYER-06 and QA-11/12/15.

#### Authentication differences

- [x] **AUTH-01 (P0)** Align field rules and copy with backend/web: valid email, display name requirement, password length, invitation behavior, and pending approval.
- [x] **AUTH-02 (P0)** Preserve Android password confirmation and the pending user’s **Check again** action; these are useful native improvements.
- [x] **AUTH-03 (P1)** Support registration invite app links and prefill the invite code without losing it through sign-in/register switching.
- [x] **AUTH-04 (P0)** Make the approval gate identical for admins and non-admins unless backend policy explicitly says otherwise.
- [ ] **AUTH-05 (P0)** Define logout semantics, call server logout for consistency, then clear player, notification, query cache, account-scoped recent searches, downloads policy, session, and Android Auto tree locally.
- [x] **AUTH-06 (P0)** Test first-user admin, invited auto-approval, ordinary pending user, pending→approved recheck, stored-session restart, transient bootstrap Retry/Forget, 401 invalidation, and 403 without accidental session loss.

Progress: production/custom registration routes parse trusted invite links, prefill registration, and preserve the invite through sign-in/register mode changes; exact parser and mode-switch tests close AUTH-03. Verified HTTPS association remains correctly open under LINK-01 because production `assetlinks.json` is absent. Logout is local-first and clears persisted queue state before player setup, then invalidates the JavaScript explicit-download registry, cancels stale download work, clears the exact native scope (or every native scope when the departing account is unknown), pauses/clears live Media3 and notification state, clears errors/timer/rolling cache, Android Auto, local session, Query/mutation caches, and enumerated account-scoped keys before a bounded best-effort server consistency call. Authenticated→authenticated replacement performs the same teardown before creating new credentials; unexpected `/me` identity drift signs out, and fast re-login cannot race cleanup. The explicit-download runtime uses epochs plus serialized cleanup barriers so queued or late native results cannot republish old-account file URIs. AUTH-05 remains open until a rebuilt release APK and filesystem inspection prove every boundary together across logout and defensive account switch; account switching remains defensive infrastructure rather than a visible picker.

AUTH-06 is closed at its source-test boundary. Real in-memory SQLite policy tests prove first-user approved admin, ordinary pending, and invited approved/consumed outcomes. An injected lifecycle used by `AuthProvider` proves stored-session bootstrap/restart, transient failure followed by Retry, pending→approved recheck, authoritative 401 cleanup/notification, and 403 credential preservation/reuse. The explicit Forget path uses local-first logout even when the consistency-only server call is offline, and component tests bind Retry/Forget to distinct callbacks. Installed v10009 exercised that callback and exposed a fail-closed native path-validation defect; v10011 fixed it, and v10012 retains successful signed-out cleanup to German Login without warnings or fatal errors. Authenticated logout/account-switch proof remains separately open under QA-06/DATA-03/SEC-05 rather than reopening the source-tested lifecycle contract.

#### Accessibility baseline

- [ ] **A11Y-01 (P0)** Give every actionable element a role, name, state, and ≥48 dp non-overlapping target.
- [ ] **A11Y-02 (P0)** Announce startup/loading/error/success state changes; mark errors as alerts.
- [x] **A11Y-03 (P0)** Expose long-press track actions as visible/accessibility actions, not gesture-only functionality.
- [ ] **A11Y-04 (P1)** Announce repeat as Off/All/One and all queue mutations with exact outcomes.
- [ ] **A11Y-05 (P1)** Verify logical TalkBack focus order and focus restoration after modals/navigation.
- [ ] **A11Y-06 (P1)** Pass 200% font and display size without clipped auth, pending, player, or queue controls.
- [ ] **A11Y-07 (P1)** Pass portrait, short landscape, smallest supported phone, tablet, and foldable layouts.
- [ ] **A11Y-08 (P1)** Honor reduced-motion and high-contrast/system color needs; never rely on color alone.
- [ ] **A11Y-09 (P2)** Verify keyboard, switch access, hardware media keys, and car rotary/focus interactions.

Progress: shared track, catalog, library, playlist, Home, mini-player, Now Playing, and Queue actions expose visible labeled 48 dp controls; queue controls were visually verified non-overlapping at 1080×2400. Home's labeled action target measured 126 px, equal to 48 dp at the API 36 emulator density, so A11Y-03 is complete. Query loading bodies use labeled progress semantics, blocking errors are assertive alerts, refresh/stale/empty states are polite live regions, retry controls expose busy/disabled state, and auth sign-in/register/pending-recheck plus playlist/import outcomes now announce progress or success. Exact success announcements also cover Play next, Add to queue, radio start, queue shuffle/restore/clear/skip/move/remove, and repeat Off/All/One. DATA-07 closes raw auth/mutation/player presentation at the source boundary. A11Y-02 remains open because shell-wide startup/action success coverage and rebuilt-APK TalkBack behavior are not exhaustive. A11Y-04 remains open until TalkBack verifies its exact outcomes. A11Y-01, QA-03, QA-11, and QA-15 retain the exhaustive role/name/state, primary-route component, production-smoke, focus, font-scale, contrast, motion, landscape/tablet/foldable matrices.

### Phase 2 — Home, discovery, search, catalog, and radio

#### Home

- [x] **HOME-01 (P1)** Make Home the first approved-user destination with a localized greeting.
- [x] **HOME-02 (P1)** Add Recently Heard with direct playback and recent-history navigation.
- [x] **HOME-03 (P1)** Add Top, Chill, Focus, Workout, and Party mood starts.
- [x] **HOME-04 (P1)** Add personal mix shelves and stable `/mix/{key}`-equivalent detail screens.
- [x] **HOME-05 (P1)** Add Release Radar, dates, per-user unseen badge, seen-state rules, and play all.
- [x] **HOME-06 (P1)** Add Because You Listened shelves with source context.
- [x] **HOME-07 (P1)** Add charts/collections and full-list playback.
- [x] **HOME-08 (P1)** Add new releases, genres, and public/community playlists.
- [x] **HOME-09 (P1)** Give every shelf loading, empty, stale, retry, and offline behavior; cards must open the correct detail or playback context.

Evidence for checked Home items: Home is the first approved destination and renders a localized time/name greeting. Recently Heard queries the account-scoped stats repository, matches the web shelf limit of seven events, and hydrates the complete ordered history before playback so repeated IDs remain distinct in the semantic `recent` queue context. Album and artist controls are separate 48 dp targets; blank legacy identities are omitted rather than misrouted. Successful play recording invalidates only private stats so the active shelf refreshes immediately. Deterministic tests cover seven-versus-full context, duplicate order/stable queue identity, atomic hydration failure, fallback catalog IDs, loading/empty/stale/cached-error/retry states, and controls. The exact Top/Chill/Focus/Workout/Party set starts semantic mood queues; Because You Listened preserves `because:<key>` source context; charts/collections start the complete ordered returned arrays with human labels. Personal mix cards now open a typed native Mix route through a path-safe key; the account-scoped detail resolves the requested mix, presents loading/cached-refresh/error/not-found states, and plays the complete ordered result from Play all or the selected row in a semantic `mix:<key>` context. Home also renders new releases, genres, and public/community playlists with shared catalog cards and native detail navigation. Release Radar now has one native Home hero card with accessible unique-track unseen count and a typed `/radar` destination; only entering that detail cumulatively marks its visible IDs seen, matching the production web contract. Its full list shows relative dates and supports Play all/from-row in the stable `home/release-radar` context. Seen writes serialize, reads wait for them, keys include origin plus account, and logout/deletion waits before removing registered Radar/search storage. A shared contract gives all ten query-backed shelves explicit cold loading, empty, paused/offline, hard-error, cached-refresh-error, stale, refresh, and localized retry outcomes; cached content stays visible on transport failure, and every card route/play context is centralized and tested. Personalized query shelves remain memory-only across process death; encrypted persisted offline cache is tracked under DATA-03 rather than storing them in plaintext. Production-connected v10005 rendered personalized Home data, but Recently Heard, stable Mix/Radar details, Home community content, and the complete state contract remain source/test verified until a compatible rebuild.

#### Search and import

- [x] **SEARCH-01 (P1)** Support All, Tracks, Albums, Artists, and Playlists result tabs.
- [x] **SEARCH-02 (P1)** Add title/duration sorting and preserve the user’s selection.
- [x] **SEARCH-03 (P1)** Persist recent searches per account with clear/remove controls.
- [x] **SEARCH-04 (P1)** Use genres/browse as the zero-query landing state.
- [x] **SEARCH-05 (P1)** Show relevant duration, album/artist, popularity/play-count, and cache metadata.
- [x] **SEARCH-06 (P1)** Support Spotify track/album/playlist URLs through paste and Android Share intents.
- [x] **SEARCH-07 (P1)** Show import resolution, matched/unmatched counts, playback, and bulk save to a new/existing playlist.
- [x] **SEARCH-08 (P1)** Highlight the playing row; tapping it toggles/resumes rather than replacing and restarting the same queue accidentally.
- [x] **SEARCH-09 (P1)** Keep debounce, abort, and out-of-order response protection; test rapid query replacement and offline recovery.

Evidence for checked Search items: typed models partition All/Tracks/Albums/Artists/Playlists and preserve title/duration sort selection; zero query renders origin/account-scoped recent searches plus genre browse. History is cleared in memory before any new scope loads, load failure is fail-closed, clear-all removes only the scoped key, and every entry has a separate localized 48 dp remove control that persists the remainder. Track results show artist/album, duration, Last.fm plays/listeners when available or bounded Deezer-rank popularity otherwise, positive server-cache membership, and active-track rolling device-cache seconds. Zero/unknown data is omitted and neither cache is called a download/offline item; the native API cannot enumerate rolling device cache for inactive rows. Metadata is included in TalkBack labels and auxiliary-query failures join partial-error/retry behavior. Input changes immediately withdraw the published query and cancel the complete Search query root; the canonical 280 ms debounce republishes only the current identity. AbortSignal reaches all four search endpoints, and Query-core tests prove a late non-cooperative old response cannot enter the replacement observer/cache. Offline refresh retains last-good data only for the exact query key, a different failed query receives none, and explicit retry recovers. Spotify import accepts exactly one bounded canonical track/album/playlist URL from paste or text-only Android `ACTION_SEND`; query trackers are removed, ambiguous/untrusted text is rejected, and it never changes the server origin. The generated owned bridge preserves cold/warm payloads until JavaScript is listening and compiles with the app. Import UI exposes resolving/error, type, processed/source, matched/unmatched, Play all/from-row, full track actions, and bulk save to a named new or owned existing playlist. Existing saves use optimistic unique append/exact rollback; new saves compensate a failed bulk add; both invalidate the account scope and refresh Auto non-fatally. The resolver has a bounded 120-second budget for the server's 200-track matching path while caller cancellation still wins. Historical installed-session QA exercised browse/history/query, all tabs, and sorts; the new history/metadata/concurrency/import/share behavior remains source evidence pending a first-party rebuild. Current source derives the active MediaItem snapshot, marks a matching row selected, and `playTrackRow` pauses/resumes it without fetching headers or replacing the queue; a different row starts its semantic search context. Exact model/component/storage/controller/plugin tests cover these contracts.

#### Discover and catalog

- [x] **DISC-01 (P1)** Add Discover with charts, genres, releases, and community playlists.
- [x] **DISC-02 (P1)** Ensure all cards use shared catalog components and native navigation, not duplicated screen-specific models.
- [ ] **DISC-03 (P1)** Add pagination/virtualization and image loading suitable for large collections.
- [x] **DISC-04 (P1)** Preserve playback context when entering a detail screen or selecting any row.
- [ ] **DISC-05 (P1)** Cache public discovery data for useful stale/offline browsing without leaking account-private data.
- [x] **CATALOG-01 (P1)** Genre detail: top tracks/play all, artists, albums, and onward navigation.
- [x] **CATALOG-02 (P1)** Album detail: cover, artist link, year, duration, ordered track list, play all/from row.
- [x] **CATALOG-03 (P1)** Artist detail: hero/fan count, play, follow/unfollow, popular tracks, and play counts.
- [x] **CATALOG-04 (P1)** Artist detail: within-artist search, discography, and related artists.
- [x] **CATALOG-05 (P1)** Artist detail: biography, tags, listener totals, correct empty/error attribution; do not port inert web controls.

Evidence for checked Discover/catalog items: Discover queries and renders charts, genres, releases, and public playlists using shared catalog cards and native routes. Discover, Genre, Album, Artist, and Playlist callers preserve ordered semantic playback contexts. Genre exposes play-all/tracks/albums/artists and onward navigation. Album exposes cover, artist link, year, ordered rows, play-all/from-row, and the same rounded aggregate-minute calculation as web; exact duration/invalid-data tests pass. Artist exposes the production hero/fan/Play/follow outcomes; hero Play retains the complete returned context while Popular rows use the displayed first ten. One batched Last.fm query supplies positive-only play/listener metadata rather than an N+1 request. Follow/unfollow updates the exact contains key and invalidates account-scoped Following and personalized Home data. A 300 ms advanced within-artist search filters primary/credited/legacy-name matches, preserves response order and duplicate rows, exposes loading/empty/error/retry/actions, and plays the complete filtered context. Discography and related artists use typed native catalog routes. Artist About independently attributes loading/stale/empty/error and renders biography/listeners/play count/tags without porting inert web controls. API 36 production QA traversed Discover, Genre, Album, and Artist details; the album runtime and new Artist behavior are source/test verified and await the next rebuilt visual pass under QA-15.

#### Radio

- [x] **RADIO-01 (P1)** Add a Radio surface with personal radios seeded from recent tracks.
- [x] **RADIO-02 (P1)** Add mood and genre stations.
- [x] **RADIO-03 (P1)** Preserve endless song-radio extension, deduplicate against the **current** queue after async responses, and prevent race duplicates.
- [ ] **RADIO-04 (P1)** Survive background playback, transient fetch failure, and empty station responses without exhausting or corrupting the queue.

Evidence for checked Radio items: personal seeds are recent-first and deduplicated; mood/genre stations are Query-backed and start semantic radio queues. The installed-session harness proved all three surfaces present. Endless extension re-reads the post-request native queue, generation-checks the request, and deduplicates against live state; tests cover post-request duplicates, Android Auto replacement races, and starting a new radio during an old response. Background retry/empty-response exhaustion remains RADIO-04.

### Phase 3 — Library, playlists, track actions, and social

#### Library

- [x] **LIB-01 (P1)** Match the five web sections: Playlists, Liked Tracks, Recently Heard, Downloads, Following.
- [x] **LIB-02 (P1)** Add pull-to-refresh, last-good cache, empty/error/offline states to every section.
- [x] **LIB-03 (P1)** Link recently heard rows to full track/catalog context.
- [x] **LIB-04 (P1)** Show deterministic downloaded inventory and removal/storage status.
- [x] **LIB-05 (P1)** Link followed artists to artist details and reflect follow changes immediately.
- [x] **LIB-06 (P1)** Refresh Android Auto data after relevant library changes, not only launch/like toggles.

Evidence for LIB-01…06: Android renders all five web sections. One discriminated remote-section contract distinguishes never-loaded from successful-empty data and renders loading, hard error, empty/content, refreshing, stale, paused/status-zero offline, cached offline, and cached refresh-error with retry; pull-to-refresh independently settles Playlists, Likes, Recent, and Following so one failure does not suppress another attempt. Downloads is no longer a static unsupported card: after exact-scope manifest hydration it lists complete and partial local playlist snapshots, reports downloaded/total and failed occurrence counts, distinguishes loading/empty/storage-unavailable states accessibly, and opens the existing Playlist route for removal, retry, or cold local playback. Its inventory is derived from the encrypted manifest and verified native file registry rather than the rolling LRU cache. The registry records total stored bytes and native available-disk evidence, but user-facing quota/full-disk recovery and device proof remain OFFLINE-08/QA-13 rather than a LIB-04 release claim. `LibraryScreen.test.tsx`, `offlineScreenModel.test.ts`, and the offline model/runtime suites cover the source boundary.

A Recently Heard row atomically hydrates the complete ordered stats history before playback, preserves duplicate IDs, and starts an account-scoped semantic `recent` context at the selected index. Separate non-overlapping play, album, and artist controls meet the 48 dp target; safe catalog fallbacks are used and blank legacy IDs remain non-interactive. Following rows navigate to Artist detail. After a confirmed follow/unfollow, the centralized account-scoped mutation cancels stale reads and immediately updates every loaded Following and contains cache without seeding an incomplete list, preserves other accounts, serializes repeated changes for the same artist, permits functional updates for different artists, invalidates personalized Home data, and leaves caches unchanged on failure. One shared non-fatal helper republishes Android Auto after every reachable successful remote Library mutation. Explicit-download transactions use a separate local-only post-commit refresh described under PLAYLIST-10/AUTO-03 so they do not re-enter auth or the network. Production v10005 still showed the old Downloads-unavailable surface; all explicit-download Library evidence is current-source only and must be exercised under QA-13/15.

#### Playlists

- [x] **PLAYLIST-01 (P1)** Create a playlist with name and description.
- [x] **PLAYLIST-02 (P1)** Edit name/description with optimistic update and rollback.
- [x] **PLAYLIST-03 (P1)** Delete with destructive confirmation and complete local/cache/Auto invalidation.
- [x] **PLAYLIST-04 (P1)** Add a track to an existing or newly created playlist from every track menu.
- [x] **PLAYLIST-05 (P1)** Remove and reorder tracks with stable IDs, optimistic rollback, and correct active-queue behavior.
- [ ] **PLAYLIST-06 (P1)** Upload/crop a cover through the Android photo picker with permission-safe handling.
- [x] **PLAYLIST-07 (P1)** Set public/private visibility and show owner versus public-viewer permissions.
- [x] **PLAYLIST-08 (P1)** Open public/community playlists and prevent non-owner mutation.
- [x] **PLAYLIST-09 (P1)** Preserve ordered play-all and play-from-row context.
- [x] **PLAYLIST-10 (P1)** Add explicit Download/Remove using the offline subsystem.
- [ ] **PLAYLIST-11 (P2, Adapt)** Save/share ordered MP3 ZIP export through the Android system picker, or record an explicit product decision that export remains web-only.

Evidence for checked playlist items: a global track-actions host makes Add to playlist available from every shared track menu, supports an existing destination or transactional create-then-add, and compensates by deleting the new playlist if the add fails. Edit, visibility, add, remove, and reorder cancel relevant reads, update account-scoped list/detail caches optimistically, and roll back the exact prior state on failure. Create and confirmed delete use server results plus targeted invalidation; delete evicts the detail cache. Description clearing sends the backend's effective empty-string value. Native owner/public-viewer controls prevent unauthorized mutation; public/community cards open native detail; ordered Play all and play-from-row preserve the complete playlist context. Focused mutation/action tests cover these contracts. Every reachable successful create/edit/delete/visibility/add/remove/reorder/import path republishes Android Auto through the shared non-fatal remote helper, including standalone Library creation.

PLAYLIST-05 is closed at the contract/source/test boundary. The existing database `PlaylistTrack.id` is now exposed as required positive `playlist_entry_id` on each playlist occurrence. Duplicate-safe v2 mutations delete `/api/playlists/{playlist_id}/tracks/entries/{entry_id}` and atomically patch `/api/playlists/{playlist_id}/tracks/entries/order` with the complete ordered `entry_ids` snapshot; duplicate, missing, foreign, or stale entry snapshots reject without partial position changes. Legacy Deezer-ID routes remain unchanged for v1 clients. Android decoders, repository mutations, optimistic caches, row ownership, and offline snapshots use entry identity while preserving the currently playing native queue snapshot, so removing one duplicate occurrence does not remove its siblings or rewrite an already-playing context. The final API suite passes 50/50, and the Android contract/mobile gate passes at OpenAPI v2 and 152 files / 1,050 tests plus one todo. Production device mutation evidence remains impossible until `/api/version` advertises v2, but that deployment gate is tracked under ARCH-03/QA rather than reopening the satisfied duplicate-safe product contract.

PLAYLIST-10 is closed at the source/test boundary. Playlist detail owns one localized explicit-download control with unavailable, idle, downloading, partial, downloaded, removing, and error states; it exposes aggregate accessible progress and failure-specific Retry/Remove actions. A successful download/remove transaction commits the encrypted manifest first and then invokes `refreshOfflineBrowseTree`, which republishes verified Downloads while retaining same-account last-good remote roots and performs no API-origin, auth, or repository call. If the remote playlist is unavailable, exact-scope manifest v2 reconstructs its metadata and ordered source occurrences (including duplicate IDs); only verified downloaded occurrences are selectable. Cold fallback passes `requireExplicitDownloads: true`, so controller validation occurs synchronously before API compatibility/auth/network access and rejects a stale or missing local file without mutating the existing queue. `OfflinePlaylistControl.test.tsx`, `offlineScreenModel.test.ts`, `offlineScreenActions.test.ts`, `controller.contract.test.ts`, and `browseTree.test.ts` cover these source contracts. Production v10005 predates them; force-stop/airplane-mode, real progress/removal, TalkBack, and filesystem evidence remain open under QA-13/15 and OFFLINE-04/08.

Cover upload and export remain separately open under PLAYLIST-06/11.

#### Track presentation/actions

- [ ] **TRACK-01 (P1)** Show active/buffering/download/cache state consistently in every track row.
- [ ] **TRACK-02 (P1)** Add navigable album and artist metadata, duration, and relevant popularity/play-count data.
- [x] **TRACK-03 (P1)** Replace the three-button native Alert with an accessible bottom sheet/action sheet.
- [x] **TRACK-04 (P1)** Include Play next, Add to queue, Start radio, Add to playlist, Open album, Open artist, and contextual Remove where authorized.
- [x] **TRACK-05 (P1)** Make actions available through TalkBack without long press.
- [ ] **TRACK-06 (P1)** Ensure rows are virtualized and remain responsive for thousands of items.
- [x] **TRACK-07 (P1)** Match web like/unlike access on shared track rows/cards and the player, with optimistic rollback plus immediate Library likes and Android Auto invalidation/refresh.

Evidence: shared rows/cards, Search, Library, Playlist, MiniPlayer, and Now Playing expose accessible optimistic like/unlike with targeted rollback, account-scoped Library invalidation, and Android Auto browse refresh. The app-level track-actions host replaces the platform Alert with one ordered accessible surface for Play next, Add to queue, Start radio, Add to playlist, Open album, Open artist, and contextual Remove. Album/artist routes accept only safe positive Deezer IDs; Remove is rendered only when an owner caller grants an exact account-scoped handler. A stale request, replacement sheet, or account change cannot replay or announce an old removal callback. The scrollable sheet retains localized exact queue/removal outcomes, playlist destinations, rollback, cache invalidation, and non-fatal Auto refresh. A reversible production check changed Liked Tracks 34→35 immediately, cleanup returned it 35→34, and a final cold traversal confirmed the track remained unliked. Android Auto refresh failure is a bounded, generic non-fatal bookkeeping notice and does not undo the server mutation or replace an audio error.

TRACK-05 is closed at the product/source boundary independently of the exhaustive QA-15 TalkBack pass. A source-wide audit found seven track renderers with `onLongPress`; every one also renders a sibling focusable, localized overflow `Pressable` sized with the 48 dp `metrics.minimumTouchTarget`. Queue and Recent surfaces expose separate labeled actions and have no gesture-only menu. This is the same proven contract already closed under A11Y-03; Home's responder test and API 36 measurement verify that long press is not the sole path. QA-15 still owns spoken outcomes, full focus order, focus restoration, switch access, and the rebuilt-APK route matrix.

The row audit now distinguishes implemented source behavior from the remaining acceptance evidence:

| Surface family | Current TRACK-01 state contract | Current TRACK-02 metadata contract | Remaining acceptance / TRACK-06 |
|---|---|---|---|
| Shared rows / Similar | Exact occurrence-aware inactive, buffering, playing, paused, and active phases plus server-cache and hydrated explicit-download state; Similar uses its exact finite `similar:<seed>` context | Safe album and every ordered artist link; Similar intentionally omits duration/popularity to match the production treatment | Downloaded marker is source-complete; rebuilt TalkBack transition proof remains. Similar owns one tuned `FlatList` |
| Album, Genre, Mix, Artist, Radar | Exact semantic context and original order drive phase/cache/download state; duplicate track IDs do not make every occurrence active | Duration, album, and all artist credits are available. Artist Popular shows only positive play counts; Artist Search shows no popularity. Radar keeps its release date | Rebuilt transition/TalkBack proof remains. Album/Genre/Mix/Radar use a tuned `FlatList`; Artist uses one `SectionList` |
| Home / Discover cards | Phase, server-cache, and explicit-download state use the shared provider | Album and every safe artist credit are separate links; duration/popularity stay omitted on compact cards to match the web baseline | Rebuilt target/focus/download-marker proof remains; horizontal rails use `FlatList` |
| Home Recent | Exact `recent:<account>` occurrence phase plus server-cache/download state; hydration busy is not misreported as native buffering | Safe album and all artist credits are navigable; compact-card duration/popularity stay omitted by policy | Rebuilt target/focus proof remains; horizontal `FlatList` |
| Library Likes / Recent | Exact account/context order, phase, server-cache, and explicit-download state | Likes and Recent expose duration, album, and all safe artist credits; no unsupported popularity claim | Rebuilt TalkBack proof remains; one bounded five-section `SectionList` |
| Playlist | Exact playlist context/order, phase, server-cache, and explicit-download state; owner mutation indices remain authoritative | Duration, album, and all artist credits are exposed without changing owner controls | Rebuilt duplicate/mutation/download transition proof remains; tuned `FlatList` |
| Search / Spotify import | Exact query/collection occurrence phase, server-cache, and explicit-download state; the active row can show rolling native-cache evidence without a global progress ticker | Search shows duration and positive plays, otherwise rank; import shows duration and no popularity. Album/all-artist links are separate from Play | Rebuilt interaction/TalkBack proof remains; each mode has one persistent tuned `FlatList` |
| Queue | Native queue index overrides legacy ID-only fallback, so duplicate/manual/history occurrences stay authoritative; exact phase, buffering, explicit download, server cache, and active rolling-cache evidence are shown | Duration plus safe album and all artist links; no unsupported popularity claim | Rebuilt queue/TalkBack proof remains; tuned `SectionList` |

TRACK-01 remains open only for its cross-surface rebuilt-device acceptance, not because explicit downloads are absent. A single authenticated `TrackPresentationProvider` owns shared active-item, playing, playback-state, server-cache, and one hydrated explicit-download registry subscription. `resolveTrackPresentation` keeps download knowledge tri-state (`downloaded`, `not-downloaded`, `unknown`) so pre-hydration is never misreported as absence; `TrackStateIndicator` renders the localized Downloaded fact separately from server cache and active rolling-LRU seconds. Deterministic provider/presentation/copy tests cover hydration and all three states. QA-15 must still prove phase/cache/download transitions, spoken output, and focus behavior on every audited row family in a rebuilt APK. TRACK-02 is source-complete for the audited row families but remains unchecked until rebuilt-emulator evidence covers link-versus-play targets, secondary artists, malformed legacy IDs, durations, and the surface-specific popularity policy. Rows do not issue metadata/player queries or subscribe independently; Search and Queue retain screen-owned active-progress sampling only, avoiding global progress-driven rerenders.

No known source-level vertical track-map counterexample remains. Library builds one discriminated, fixed-order five-section model under a tuned `SectionList`; Album, Genre, Mix, and Radar share one tuned `FlatList` contract; Artist owns Popular and Search under one tuned `SectionList`; and ordinary Search and Spotify import each own a separate tuned `FlatList`. Import mode keeps one persistent owner across idle/edit/loading/resolved states and places Search chrome plus the import form in its header, so short landscape and keyboard-shrunk windows can scroll every control without same-axis nesting or focus loss. The conversions preserve pull-to-refresh, remote-state bodies/notices, playback contexts and source indices, actions/navigation, horizontal rails, and duplicate occurrences through section/id/index keys. Remaining `.map()` uses in those surfaces are bounded eight-entry history chips, artist tags, horizontal controls, or non-render request shaping rather than long vertical rows. The last integrated mobile gate predates the new offline suites; focused offline presentation tests are recorded separately and no inflated full-suite count is claimed here. TRACK-06 stays unchecked until QA-16 proves bounded frame time, memory, bridge traffic, refresh/filter behavior, and navigation restoration with production-shaped thousands-of-tracks/hundreds-of-playlists fixtures on the target device classes.

#### Social/public profiles

- [ ] **SOCIAL-01 (P2)** Finish artist-follow consistency outside Artist detail: batch/contains state on shared cards, optimistic rollback, Library invalidation, and Android Auto refresh. Artist detail already supports contains plus follow/unfollow.
- [ ] **SOCIAL-02 (P2)** Add public user profile with avatar/name/counts.
- [ ] **SOCIAL-03 (P2)** Show only the user’s public playlists and followed artists.
- [ ] **SOCIAL-04 (P2)** Link owner attribution from public playlists and shared content.

### Phase 4 — Player, Now Playing, queue UI, settings, and play accounting

#### Now Playing

- [x] **PLAYER-01 (P1)** Add tabs/surfaces for Playing, Lyrics, Similar, and Queue.
- [x] **PLAYER-02 (P1)** Add synced lyrics, loading/source/error state, auto-follow, and line-tap seek.
- [x] **PLAYER-03 (P1)** Add Similar tracks with full track actions and correct queue context.
- [ ] **PLAYER-04 (P1)** Make title/artist/album navigable and use production cover treatment.
- [ ] **PLAYER-05 (P1, Adapt)** Use Android system volume and mute conventions rather than copying a desktop slider literally.
- [ ] **PLAYER-06 (P1)** Add native swipe/back dismissal without breaking seek/queue gestures.
- [ ] **PLAYER-07 (P2)** Add cover-derived ambient palette with bounded CPU/memory cost.
- [ ] **PLAYER-08 (P3)** Add a battery-aware, reduced-motion-compatible visualizer/equalizer treatment.

Evidence for PLAYER-01/02: fullscreen playback exposes four native Playing/Lyrics/Similar/Queue tabs in production order, defaults to Lyrics, and horizontally scrolls non-shrinking 112 × 48 dp pills rather than clipping narrow phones. Queue embeds the exact standalone queue implementation—snapshot/metadata states, history/current/manual/context sections, shuffle/clear, jump/reorder/remove, announcements, and mutation serialization remain single-sourced—while removing only duplicate safe-area, close, and global-feedback chrome. The lyrics query exists only while its tab owns the active track, keys artist/title/Deezer ID, forwards cancellation, keeps results fresh for one hour, and disables invisible retries because server resolution may materialize or transcribe audio. Loading, generic hard error with explicit Retry, empty, content, refreshing, cached-refresh-error, synchronized, AI-generated, cached, and bounded provider-source states are localized and accessible without exposing raw backend diagnostics. The active line matches web's last-timestamp-at-or-before-position-plus-150-ms rule; replacement tracks remount the panel, initial centering is non-animated, later lines follow smoothly, and a failed unmeasured index uses a bounded offset fallback. Every line is a 48 dp selected/labeled button that seeks once to its exact server timestamp. The focused tab/queue contract passes five files / 21 tests, and the final 152-file / 1,050-test-plus-one-todo mobile gate passes with TypeScript and ESLint clean. The downloaded v10014 first-party candidate proves clean startup but production cannot reach authenticated lyrics/queue surfaces while `/api/version` is 404; visual, TalkBack, real-server lyrics, and embedded-queue behavior therefore remain under QA-11/15.

Evidence for PLAYER-03: the third native tab matches production's Similar surface without turning it into endless radio. Its canonical, seed-specific Query key forwards cancellation, keeps results fresh for exactly 15 minutes, remounts local ownership when the active track changes, and suppresses old placeholder rows. Cold loading/offline/hard-error, successful empty/content, cached-offline/refresh-error, refreshing, stale, and busy Retry states use the shared presenter and localized non-diagnostic copy. Selecting any result preserves the complete ordered list and selected index with `radio: false` plus semantic `radio / similar:<seed>` context. Virtualized rows retain Like and the full accessible action sheet, including album/artist navigation. Dedicated Similar/model tests pass 15 cases and the integrated seven-file slice passes 39 cases. No production radio request was made.

PLAYER-04 is implementation-complete but deliberately remains unchecked until authenticated visual evidence satisfies its recorded acceptance boundary. The title opens only a validated album route; every credited artist is rendered in server order as its own validated ≥48 dp native link, while malformed legacy references remain readable and inert. The selected credit—not merely the primary artist—is forwarded to navigation. The production web cover helper is mirrored exactly for Deezer size segments; Playing uses viewport-bounded, vertically scrollable framed 1000 px artwork or a branded equalizer placeholder, and every tab sits over a separately bounded 480 px static, pointer-free, accessibility-hidden blurred-cover backdrop. Embedded Queue is transparent only in this owner so the ambient layer remains visible without forking queue behavior. Dedicated cover/metadata/layout/navigation suites pass five files / 18 cases; the integrated artwork/metadata/layout/navigation/queue slice passes six files / 23 cases; and the final mobile gate passes 152 files / 1,050 tests plus one todo with TypeScript and ESLint clean. Dynamic palette extraction and the visualizer remain separately open under PLAYER-07/08. The downloaded v10014 first-party candidate proves production branding and responsive signed-out startup, but production's compatibility 404 prevents authenticated Now Playing evidence, so PLAYER-04 remains under QA-11/15.

PLAYER-05 is also implementation-complete but remains unchecked for its device acceptance. Android intentionally exposes no application volume/mute slider and never persists per-account volume. Player setup declares music content, exclusive mixing, audio focus, and becoming-noisy handling. A deterministic Expo config plugin adds `MainActivity.onResume()` media-stream binding, so visible-app hardware keys target `AudioManager.STREAM_MUSIC` rather than the ringer; generated Kotlin and the plugin's idempotent/fail-loud transform are source-tested. Focused configuration/setup tests pass. The remaining acceptance is rebuilt-device evidence while Playing and paused: hardware keys and the system volume-panel mute must change the active media route, Bluetooth/car controls must follow the system route, and no in-app state may override it. Programmatic stream mute/set-volume is intentionally excluded.

PLAYER-06 remains open as an explicit Android Adapt. The chevron, hardware Back, and system edge-Back commit route through the native stack; no full-screen swipe-down recognizer competes with the seek slider, horizontal tabs, lyrics/similar/queue scrolling, or queue actions. Native-stack's `gestureEnabled` option is iOS-only and is no longer presented as Android evidence. Close only after rebuilt API 36 gesture-navigation tests prove slow edge-swipe cancel is non-mutating, commit returns to the exact prior stack from all four tabs and standalone Queue, hardware Back matches, both edges work, and slider/queue gestures do not dismiss or mutate. Interactive predictive preview is not claimed from the manifest flag alone.

#### Queue UI

- [x] **QUEUE-UI-01 (P1)** Show current, manual, and context sections with context label.
- [x] **QUEUE-UI-02 (P1)** Show duration and download/server-cache state where meaningful.
- [x] **QUEUE-UI-03 (P1)** Support jump, remove, accessible reorder, and clear upcoming.
- [x] **QUEUE-UI-04 (P1)** Do not present already-played history as upcoming; if history is retained, label it separately.
- [ ] **QUEUE-UI-05 (P1)** Surface party creation/join state when PARTY work is enabled.

Evidence: every new semantic queue context requires and persists a human-readable label, while queues restored from a pre-label APK use a localized type fallback. A pure presentation contract partitions canonical native indices into separately headed history, current, manual-upcoming, and labeled context-upcoming sections. The header and clear outcome count only upcoming items; mutation calls and stable test IDs continue to use native queue indices/identities. The UI supports jump, stable-ID remove, labeled move-up/down reorder, and clear-upcoming with exact accessibility outcomes; controller tests cover active/no-op/bounds/current protection, repeated IDs, stale rendered queues, and clear semantics. Every queue row includes duration, hydrated explicit-download state, and positive server-cache membership; only the active row may show positive rolling device-cache seconds. Downloaded, server cache, and rolling LRU are separate facts, and unknown manifest state is not rendered as “not downloaded.” Production v10005 verified accessible reorder and clear-upcoming but predates the download marker. Deterministic metadata/presentation tests cover retained history, idle queues, unknown/corrupt duration/cache values, explicit-download tri-state, legacy/null metadata, conflicting contexts, and context labels. First-party rebuilt emulator visual/TalkBack evidence remains tracked under QA-15 rather than reopening the satisfied UI contracts.

#### Playback settings and accounting

- [ ] **PLAYER-13 (P1)** Add sleep timer presets 15/30/45/60 minutes and end-of-track; expose remaining/cancel state and preserve native background behavior.
- [ ] **PLAYER-14 (P1)** Implement real 0–12 second crossfade in the native Media3 seam, with gapless/background/queue tests; do not expose a non-functional setting. This is strict web parity unless a later product decision explicitly records an Android Adapt/Exclude.
- [ ] **PLAYER-15 (P1)** Persist repeat/shuffle preferences only if this matches the agreed product policy; restore them without violating queue invariants.
- [ ] **PLAY-COUNT-01 (P1)** Define a meaningful-play threshold instead of recording immediately on every transition.
- [ ] **PLAY-COUNT-02 (P1)** Make play recording idempotent per playback instance across seek, replay, repeat-one, foreground/headless handoff, and process recreation.
- [ ] **PLAY-COUNT-03 (P1)** Update web and Android together once the metric definition is agreed; verify stats do not inflate on rapid skip.

PLAYER-13 is source/JVM complete in the first-party service: native commands own 15/30/45/60-minute and corrected natural end-of-track timers, expose remaining/cancel state, and cover repeat, manual skip, and final-item behavior. Historical v10005 proved only starting/cancelling 15 minutes, so the item remains open until the current Media3 build is proven with authenticated audio while locked/backgrounded and across process/service lifecycle boundaries under QA-10.

### Phase 5 — Account, stats, admin, and status

#### Account/profile

- [x] **ACCOUNT-01 (P1)** Add Profile tab/screen with identity, role/approval state, and avatar.
- [x] **ACCOUNT-02 (P1)** Edit display name, email, and password with backend-aligned validation and re-auth/session behavior.
- [ ] **ACCOUNT-03 (P1)** Upload/remove avatar through the Android picker with progress and failure recovery.
- [x] **ACCOUNT-04 (P1)** Delete account with explicit confirmation, server completion, and complete local-data removal.
- [x] **ACCOUNT-05 (P1)** Show Listening DNA/stats for all-time and 30-day ranges with empty/error states.
- [ ] **ACCOUNT-06 (P1)** Host sleep timer and crossfade settings here or in a coherent Playback Settings destination.

Evidence for checked account items: Profile composes identity/avatar/role/approval and stats for all-time/30-day with loading, stale, empty, and error states. Editing sends only changed display-name/email/password fields, matches the backend's name and password bounds, confirms the new password, and treats backend validation as authoritative after a coarse email precheck. The PATCH response and refreshed `/me` identity must both retain the same user ID before the public-profile cache is invalidated; identity drift fails closed. The backend session JWT contains only that user ID and `/api/me` neither rotates nor clears it, so refresh on the existing session is the backend-aligned re-auth behavior. Account deletion uses a separate explicit confirmation, cannot be cancelled or submitted twice while pending, retains an actionable modal on server rejection, and performs no local deletion unless the server succeeds. After success it attempts player/notification/Auto/cache teardown, every registered account-scoped store, SecureStore session removal, and Query/mutation clearing in strict order while aggregating incomplete boundaries. A real SQLite foreign-key suite proves playlist/track, like, follow, play, hosted/joined party, invite, asset and cookie cleanup; it also proves last-admin rejection is non-destructive and admin deletion works when another admin survives. Focused mobile tests pass and the full API suite passes 50/50. Production v10005 rendered identity/role/approval and both stats ranges, but no production profile or account-deletion mutation was executed. Disposable-account release-APK/forensic deletion evidence remains under QA-11 and SEC-05 rather than reopening the satisfied product contract. Avatar upload and crossfade remain open under their own items.

#### Admin/status

- [ ] **ADMIN-01 (P2)** Role-gate admin navigation and deny non-admin access in UI and backend.
- [ ] **ADMIN-02 (P2)** List users; approve pending users; delete users with confirmation.
- [ ] **ADMIN-03 (P2)** Show storage usage/retention and run cleanup with progress/result.
- [ ] **ADMIN-04 (P2)** List/create/copy invite codes.
- [ ] **ADMIN-05 (P2)** Show Deezer auth/quality, integration, cookie/JWT, user, content, and cache diagnostics.
- [ ] **ADMIN-06 (P2)** Support manual refresh and clearly separate sensitive admin diagnostics from public troubleshooting copy.

### Phase 6 — Offline, party, links/share, and platform mapping

#### Explicit offline

- [x] **OFFLINE-01 (P1)** Define offline as explicit, user-managed downloads—not only opportunistic replay cache.
- [x] **OFFLINE-02 (P1)** Add playlist Download/Remove with item and aggregate progress.
- [x] **OFFLINE-03 (P1)** Persist account-scoped download inventory, state, size, source version, and failures.
- [ ] **OFFLINE-04 (P1)** Support cold relaunch, browse, play, seek, next/previous, and queue while airplane mode is enabled.
- [x] **OFFLINE-05 (P1)** Handle partial failures visibly; never mark a playlist complete unless every required item is playable.
- [x] **OFFLINE-06 (P1)** Deduplicate shared audio referenced by multiple downloaded playlists and delete only when no owner remains.
- [x] **OFFLINE-07 (P1)** Show local/server-cache markers and unavailable items clearly.
- [ ] **OFFLINE-08 (P1)** Add storage usage, quota/full-disk handling, removal, and safe cleanup on account switch.
- [x] **OFFLINE-09 (P1)** Keep the 500 MiB rolling cache as a separate best-effort optimization; do not confuse it with downloads.

Source/test boundary for OFFLINE-01/02/03/05/06/07:

- [`mobile/src/offline/model.ts`](../mobile/src/offline/model.ts) owns strict manifest version 2. Each playlist stores full metadata plus authoritative `sourceTrackIds` and occurrence-aligned `sourceTracks`; order and repeated IDs are preserved exactly rather than reconstructed from the deduplicated file table. Track entries record canonical filename, verified byte size, download timestamp, and unique playlist-owner refcounts. Partial playlists retain structured code/retryable/time failure evidence and cannot carry a completion timestamp; strict decoding rejects wrong scope/version, unsafe filenames, contradictory owners/failures, corrupt metadata, and a “complete” playlist missing verified audio. Model and browse tests prove cold reconstruction and repeated occurrences.
- The generated native adapter under [`mobile/plugins/offline-downloads-native`](../mobile/plugins/offline-downloads-native) stores the manifest with Android Keystore AES-GCM, exact-scope AAD, and `AtomicFile` under `noBackupFilesDir`; audio remains a separate app-private, no-backup MP3 store and is not falsely described as encrypted. Native hydration accepts only controlled-scope regular files whose name, size, and MP3 signature match manifest evidence, removes interrupted `.part` files, and reports invalid/interrupted IDs for reconciliation. Downloads are serialized, origin-bound, Cookie-only, staged to a partial file, fsynced/validated, and atomically renamed. Scoped and all-scopes clear paths cancel active work, advance global/per-scope generations before deletion, join concurrent clears, fail closed while cleanup is active, and verify erasure. Plugin source tests cover encryption, atomicity, validation, generation admission, global clear, and path-boundary behavior; this is not yet release-device filesystem evidence.
- [`mobile/src/offline/runtime.ts`](../mobile/src/offline/runtime.ts) is the JavaScript transaction owner. It serializes hydration/download/remove, reconciles encrypted native evidence before publishing any `file://` URI, downloads each unique ID once, reuses verified shared files without another auth/download, persists playlist refcounts, retains partial failures, retries unpublished orphan deletion, and invalidates the registry immediately on account cleanup. Runtime epochs prevent queued or late native results from resurrecting data after scope/global clear; a cross-scope mismatch drops all published URIs and fails closed. Corrupt/obsolete manifests are scoped-cleared before a fresh hydrate. Runtime/model/native tests cover duplicate source occurrences, shared-file ownership, partial settlement, corrupt recovery, cleanup races, mismatched concurrent clear promotion, and global clear.
- Playlist and Library now expose the source-backed UI described under LIB-04/PLAYLIST-10. Shared track presentation subscribes once to hydrated inventory and distinguishes Downloaded, server cache, and active rolling-LRU evidence. Cold local Playlist selection retains verified duplicate occurrences, rejects an unavailable occurrence with localized copy, and passes strict explicit-only playback so a missing file cannot fall back to auth/network. Android Auto publishes only verified local children under Downloads; partial/unavailable children are omitted rather than advertised as playable. These contracts are covered by the focused offline screen, control, track-presentation, controller, and browse-tree suites.

OFFLINE-04 deliberately remains unchecked. Source selectors can reconstruct the exact playlist after process hydration, the controller can create a wholly local duplicate-preserving queue without compatibility/auth/network access, and known-offline Android Auto publication avoids remote calls, but no rebuilt APK has yet proved force-stop then cold airplane-mode browse/play/seek/Next/Previous/queue behavior. That full acceptance belongs to QA-13.

OFFLINE-08 also remains unchecked. Source records used/available bytes, reports retryable native full-disk/storage failures, supports explicit removal, retries orphan deletion, and gates login/account replacement on scoped or global cleanup. It still needs a user-facing quota/full-disk recovery policy plus rebuilt-device low-storage, concurrent removal, logout, unknown-account global clear, and post-cleanup filesystem inspection. The native 500 MiB rolling cache and one-track preload remain separately asserted under OFFLINE-09 and are never labeled as downloads.

#### Party mode

- [ ] **PARTY-01 (P2)** Create a party from Queue and display/copy/share its code/link.
- [ ] **PARTY-02 (P2)** Join from code, link, or Android Share/deep link.
- [ ] **PARTY-03 (P2)** Show members and host/guest role.
- [ ] **PARTY-04 (P2)** Let participants search/add tracks; enforce host-only current/reorder/remove/playback controls.
- [ ] **PARTY-05 (P2)** Connect authenticated SSE with reconnect/backoff and no leaked session data.
- [ ] **PARTY-06 (P2)** Broadcast host track/play/pause/position and correct guest drift without seek thrashing.
- [ ] **PARTY-07 (P2)** Reconcile shared party queue with local native queue atomically.
- [ ] **PARTY-08 (P2)** Leave/host-end cleanup must restore ordinary playback without destroying unrelated session/library state.

#### Deep links and share

- [ ] **LINK-01 (P1)** Configure verified Android App Links for the production origin and a development scheme.
  - Acceptance: production serves `/.well-known/assetlinks.json` for the production signing fingerprint, the manifest uses `autoVerify`, and `pm get-app-links`/device routing proves verified ownership. Current production returns 404, so this remains externally blocked.
- [ ] **LINK-02 (P1)** Route invite, party, album, artist, playlist, and public-profile links through auth/pending gates to the intended destination.
- [ ] **LINK-03 (P1)** Handle cold, warm, and already-open app states without duplicate screens/actions.
- [ ] **LINK-04 (P1)** Accept supported LoggeRythm content through Android Share; Spotify intake is implemented under SEARCH-06.
- [ ] **LINK-05 (P1)** Share party/content links through the native share sheet.
- [ ] **LINK-06 (P1)** Verify untrusted/malformed links cannot change server origin, expose credentials, or bypass authorization.
- [x] **LINK-07 (P1)** Preserve an inbound Share payload through logged-out/pending gates, account changes, and process recreation, then consume it exactly once only after the intended route owns it.

Evidence for LINK-07: shared-text intake now mounts inside the authentication provider but above loading/login/pending gates. A serialized injected coordinator hydrates and stages one bounded payload in AsyncStorage, deduplicates cold native redelivery, requests Search at most once per pending-ID/account-scope pair, rejects stale/wrong-account owners, deletes the durable record before publication, and restores it if navigation/account ownership changes during consumption. Navigation registers only after `NavigationContainer` reports ready; Search registers ownership only while focused. The resulting Spotify import request carries the exact account scope, so another account cannot display it. Two focused files pass 17 tests for pre-gate staging, no early navigation/delivery, focused ownership, one route request, wrong/stale account rejection, account replacement, process recreation, native duplicate intake, and already-focused Search. TypeScript and touched-file ESLint are clean. The product contract is closed from source evidence; real cold/warm/logged-out/pending/account-switch Share-sheet behavior remains under QA-12 until a compatible APK can be rebuilt.

#### Browser-to-native mapping

- [ ] **NATIVE-01 (Adapt)** Replace browser back/forward buttons with Android Back, stack history, and predictive Back.
- [ ] **NATIVE-02 (Adapt)** Replace `⌘K` command palette with persistent Search plus optional hardware-key/search shortcut.
- [ ] **NATIVE-03 (Exclude)** Do not port PWA install banners; APK installation is the native equivalent.
- [ ] **NATIVE-04 (Adapt)** Replace service-worker shell behavior with native query metadata and download/cache stores.
- [ ] **NATIVE-05 (Exclude/Adapt)** Do not copy hover and desktop volume UI; ensure touch, keyboard, TalkBack, system-volume, and car equivalents.
- [ ] **NATIVE-06 (Preserve)** Keep authenticated Media3 streaming and Range requests.
- [ ] **NATIVE-07 (Preserve)** Keep background playback, MediaSession, notification/lock-screen, audio focus, Bluetooth/headset, and becoming-noisy behavior.
- [ ] **NATIVE-08 (Preserve)** Keep origin-bound encrypted session storage, disabled backup/device transfer, and release HTTPS-only policy.
- [ ] **NATIVE-09 (Preserve)** Keep native rolling cache and preloading as performance features.
- [ ] **NATIVE-10 (Preserve)** Keep Android Auto browse/playback while expanding and hardening it below.

### Phase 7 — Android Auto, security, quality gates, and release

#### Android Auto

- [x] **AUTO-01 (P1)** Keep Liked Songs and playlists browsable after all architecture changes.
- [ ] **AUTO-02 (P1)** Add paginated/bounded browsing for large likes/playlists; do not materialize unbounded trees across the bridge.
- [ ] **AUTO-03 (P1)** Make refresh partial-failure tolerant and retain the last-good same-account tree.
- [ ] **AUTO-04 (P1)** Refresh on relevant library mutations, app lifecycle/network recovery, logout, and account switch.
- [ ] **AUTO-05 (P2)** Extend browse roots to useful Home/Recent/Radio destinations after core tree stability.
- [x] **AUTO-06 (P1)** Implement or remove the advertised `MEDIA_PLAY_FROM_SEARCH`/voice-search capability; never claim unsupported behavior.
- [ ] **AUTO-07 (P0)** Instrument trusted/untrusted controller handling, encrypted persistence, cold service start, and logout clearing.
- [ ] **AUTO-08 (P1)** Validate with Media Controller Test and Desktop Head Unit: browsing, artwork, siblings queue, transport, seek, refresh, partial failure, large library, voice query.

Progress: unsupported voice-search advertising is removed. The browse tree retains encrypted last-good same-account likes/playlists, and every reachable successful remote Library mutation requests a non-fatal full-tree republish. The explicit-download registry adds a same-account Downloads root built synchronously from manifest v2 plus verified native `file://` evidence: duplicate source occurrences retain distinct media IDs, partial playlists expose only playable children, and known-offline startup does not request API base, auth, likes, or playlists. After a committed Download/Remove action, `refreshOfflineBrowseTree()` republishes only the local root while retaining the last complete same-account remote categories; focused tests prove it does not repeat auth or repository reads. A failed remote refresh can still publish verified local Downloads and retain same-account remote last-good data, but playlist loading remains coarse/all-or-nothing and unpaginated, so AUTO-03 stays unchecked. AUTO-04 also stays unchecked until lifecycle/network recovery and every logout/account-switch path are device-proven. API 36 instrumentation now proves encrypted browse/queue persistence plus hostile external-controller rejection locally and remotely, but not the new Downloads root. Cold service/logout evidence, trusted Media Controller Test, and DHU remain open under AUTO-07/08 and QA-17.

#### Security/session

- [x] **SEC-01 (P0)** Threat-model the Android session token crossing JavaScript/native boundaries and document accepted risk.
- [ ] **SEC-02 (P1)** Prefer moving cookie ownership and authenticated DataSource construction fully into the native service when that seam is revised.
- [x] **SEC-03 (P0)** Keep HTTPS enforcement and origin binding; reject downgrade, cross-origin session reuse, and malformed origins.
- [ ] **SEC-04 (P0)** Prove sessions never appear in logs, crash reports, UI dumps, backups, intents, share payloads, or release artifacts.
- [ ] **SEC-05 (P0)** On logout/account switch, clear token, queue, notification, player errors, account-scoped query/download state, and Auto tree.
- [x] **SEC-06 (P0)** Run the existing Keystore instrumentation coverage in CI rather than merely compiling it.
- [x] **SEC-07 (P0)** Verify untrusted external media controllers are rejected and receive no privileged commands/metadata.
- [ ] **SEC-08 (P1)** Define cache/download retention across logout and account deletion so one user never sees another user’s private library metadata.
- [ ] **SEC-09 (P0)** Rotate/revoke the production test credential that was previously committed in `web/scripts/capture-screenshots.mjs`, decide whether Git-history rewriting is required, and enforce repository/history secret scanning.

Progress: [`ANDROID_SESSION_THREAT_MODEL.md`](./ANDROID_SESSION_THREAT_MODEL.md) documents assets, trust boundaries, token flow, controls, residual risk, invariants, and mandatory production conditions, closing SEC-01. Production builds hard-fail a non-canonical origin, source/config output is redacted, and known-secret working-tree scans pass. Existing JavaScript account cleanup remains serialized and fail-closed; explicit downloads use generation-guarded scoped/all-scope erasure and an AES-GCM/Keystore manifest, while audio files remain app-private/no-backup rather than encrypted.

The first-party player now keeps credentials out of its Native-v1 snapshots and public Media3 metadata, enforces strict Cookie-vault/DataSource boundaries, and has a versioned encrypted codec/store. SEC-06 was originally closed by successful remote run [`29528436134`](https://github.com/LoggeL/LoggeRythm/actions/runs/29528436134), whose API 36 x86_64 job executed all then-current 5/5 Keystore tests rather than merely compiling them. Current run [`29559829540`](https://github.com/LoggeL/LoggeRythm/actions/runs/29559829540) extends that proof to 7/7 Keystore/persistence/controller-trust tests on the exact `d979e9b` candidate. SEC-07 is closed by a real separate-package/separate-UID helper APK on local and GitHub-hosted API 36 emulators. It has no `MEDIA_CONTENT_CONTROL`, is untrusted, receives an explicit Media3 session rejection, and obtains no root, token, private item, metadata, queue, command set, or mutation surface. The advertised platform-browser path is also exercised through a raw service bind plus a strict explicit-rejection-or-complete-10-second-silent branch; synchronized target observation proves the request stayed disallowed while a same-Component trusted Media3 browser actively reads the private item before and after, and the privileged player state remains byte-for-byte equivalent at the tested boundary. The current tree passes 115/115 release JVM tests, 7/7 API 36 device tests, plugin 15 passed/1 todo, all three lint gates, and a 445-file first-party scan with zero findings. Media3 1.10.1 anonymizes generic platform clients on API 36, so the legacy action remains fail-closed/trusted-only; positive Android Auto/DHU compatibility remains explicitly open under AUTO-08. SEC-05 still requires authenticated cleanup evidence; SEC-09 still requires external credential rotation/revocation plus an explicit history decision.

#### Automated and emulator quality gates

- [ ] **QA-01 (P0)** Make relevant API auth/schema/router changes trigger Android contract/build tests, not only a small backend file allowlist.
- [ ] **QA-02 (P0)** Add unit coverage for generated mapping, repositories, query invalidation, queue golden cases, radio race deduplication, and play-count idempotency.
- [ ] **QA-03 (P0)** Add component tests for auth, every primary route, loading/error/empty/stale states, menus, and accessibility semantics.
- [x] **QA-04 (P0)** Run `connectedAndroidTest`, including Keystore and controller-trust tests, on CI emulator hardware.
- [x] **QA-05 (P0)** Add a standalone release-APK emulator flow: clean install, cold/warm start, no Metro, no crash/ANR/ReactNativeJS errors, and a runtime assertion that the effective API origin—not merely a bundled fallback constant—is production.
- [ ] **QA-06 (P0)** Automate auth: invalid/valid login, registration/invite, pending→approved, stored restart, bootstrap Retry/Forget, 401/403, logout cleanup.
- [ ] **QA-07 (P0)** Automate a real authenticated full-track stream: Ready/Playing, several minutes, seek, transport boundaries, repeat, shuffle, like, radio extension.
- [ ] **QA-08 (P0)** Assert complete queue semantics, including idle actions, manual priority, clear, reorder/remove, concurrent mutations, shuffle restoration, process/background state.
- [ ] **QA-09 (P0)** Test Wi-Fi→offline→online, DNS failure, timeout, 401/403/404/416/500, malformed/partial audio, expired session, retry and auto-skip.
- [ ] **QA-10 (P0)** Test Home/screen lock/recents/reopen/process recreation/audio focus/call/headset unplug/Bluetooth/notification controls and dismissal.
- [ ] **QA-11 (P1)** Test every Home/Search/Discover/Radio/Library/Profile route and every catalog/detail mutation against deterministic fixtures plus a read-only production smoke; any approved production mutation test must define cleanup and prove it left no test data behind.
- [ ] **QA-12 (P1)** Test app links and Android Share in cold, warm, logged-out, pending, approved, and unauthorized states.
- [ ] **QA-13 (P1)** Test explicit downloads after force-stop and cold airplane-mode relaunch, including shared files, quota, partial failure, removal, and account switch.
- [ ] **QA-14 (P1)** Test party host/guest on two clients, SSE reconnect, permission enforcement, drift, reorder, and leave cleanup.
- [ ] **QA-15 (P1)** Complete TalkBack/switch access, 200% font, display scaling, high contrast, portrait/landscape/tablet/foldable, and reduced-motion passes.
- [ ] **QA-16 (P1)** Test thousands of likes/tracks and hundreds of playlists for bounded time, bridge size, memory, storage, and car pagination.
- [ ] **QA-17 (P1)** Run Media Controller Test and DHU for trusted connection, empty/small/large libraries, voice query, playback, artwork, refresh, failure, and logout.
- [ ] **QA-18 (P0)** Store screenshots, logs, test reports, exact APK hash/version, backend revision/origin, device image, and manual exceptions as release evidence.

QA-01 is configured and regression-guarded, and exact run #14 remotely proves the OpenAPI/generated Android drift gate on the candidate: push and pull-request filters include `api/**`; the Android workflow checks drift before mobile/build gates, and a dedicated API-contract workflow checks both artifacts for any API or generated-contract change. Static tests assert those triggers and commands. Close it only after an API-only commit/PR independently triggers and passes those jobs. QA-02 remains partial: complete v2 generated wire/operation coverage, exact-status request-adapter coverage, the Album Search wire→domain seam, duplicate-safe playlist entry mutations, repository wiring, likes-query invalidation, queue golden cases, and radio deduplication/stale races have coverage, but full feature-domain mapping and an explicit play-count transition-idempotency test are absent.

QA-05 local acceptance passed on isolated API 36 ARM64 `emulator-5556`: clean uninstall/install of non-debuggable v10005, cold/warm embedded-bundle launch without Metro, stable PID `4383`, clean app-scoped crash/ANR/process-death/native/ReactNativeJS audits, and runtime-confirmed `https://loggerythm.logge.top`. Authentication/navigation were intentionally outside `--startup-only`; the separate credential-blind installed-session harness covers the authenticated shell on v10005.

Current first-party evidence for source `d979e9b` includes `npm ci`, TypeScript, ESLint, 152 Vitest files / 1,050 tests plus one todo, 115/115 JVM tests, local and remote 7/7 API 36 instrumentation tests, clean Expo prebuild, release lint/assembly/R8, a 445-source/1,095-APK zero-finding gate, GitHub x86_64 cold/warm smoke, downloaded-ARM64 fresh-install cold/warm startup, and the digest-bearing QA prerelease `android-media3-v1.0.3-rc.1`. Historical v10005 production playback/queue/like evidence and b10012 auth-layout evidence remain regression references only; b10012 contains RNTP/derivative code and must not be published. QA-04 is closed by run #14 and its retained reports. QA-06 remains open for authenticated atomic logout/account-switch cleanup. QA-07/08 remain partial because production's compatibility 404 prevents current-source authenticated playback and lifecycle/repeat/radio/background/Auto/reboot matrices are incomplete. QA-18 remains partial because [`ANDROID_MEDIA3_QA_2026-07-17.md`](./ANDROID_MEDIA3_QA_2026-07-17.md) explicitly records the missing authenticated journal/lifecycle evidence.

#### Release engineering

- [ ] **REL-01 (P0)** Replace debug signing with protected production signing and documented key ownership/recovery.
- [ ] **REL-02 (P0)** Produce a signed APK for private distribution and an AAB if Play distribution is intended; confirm the repository’s private/demo licensing permits the channel.
- [x] **REL-03 (P0)** Define ABI policy. Keep optimized ARM64 production output and produce x86_64/universal QA output when emulator support is a release requirement.
- [x] **REL-04 (P0)** Retain and actually upload R8 mapping/resources/native-debug-symbol artifacts, and associate them with the exact release tag/version.
- [x] **REL-05 (P0)** Use monotonic `versionCode`, semantic version name, reproducible dependency lock, and provenance/checksum.
- [ ] **REL-06 (P0)** Test upgrade from the currently released build with session, queue policy, downloads, and encrypted data preserved or intentionally migrated.
- [ ] **REL-07 (P0)** Test rollback/reinstall behavior and document whether downgrades/data migrations are supported.
- [x] **REL-09 (P0)** Review and either remediate or formally waive the 11 moderate Expo/vector-icons/Xcode build-time npm advisory paths without applying the unsafe `npm audit fix --force` Expo downgrade.

Current release state: v10005 remains the last artifact with authenticated production playback evidence, while b10012 remains a historical local-only RNTP checkpoint. First-party Media3 v10014 has exact source commit/tree, successful run #14, an emulator-accepted 27,659,704-byte ARM64 APK with SHA-256 `92a3d4e81c2163a92139556ba2cb0e04e702eb48979c6a5c6f1e2bc27b3e62d5`, retained R8 mappings/resources/native symbols/Hermes map, explicit exceptions, and the QA prerelease [`android-media3-v1.0.3-rc.1`](https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.3-rc.1). [`ANDROID_ABI_POLICY.md`](./ANDROID_ABI_POLICY.md) fixes ARM64 as the private-phone output and x86_64 as emulator-only QA. Run #14 built and uploaded ARM64 `10014` and x86_64 `20014`; the latter passed API 36 cold/warm standalone smoke with the production origin and no Metro/runtime failure. Production still returns HTTP 404 from `/api/version`; backend v2 exists only locally and requires an atomic metadata/playlist-contract deployment under an identified authority. No production keystore or AAB exists, authenticated cleanup and real playback-event journal lifecycle remain unproven, and the previously exposed production test credential must still be rotated/revoked with its history disposition decided. These gaps forbid production/latest promotion, but do not invalidate clearly labeled debug-signed milestone prereleases. Prior b10013 evidence remains historical in [`ANDROID_MEDIA3_QA_2026-07-16.md`](./ANDROID_MEDIA3_QA_2026-07-16.md).

Smallest safe production-promotion sequence from the accepted QA baseline: finish authenticated journal/headless/Auto behavior and atomic cleanup proof; atomically deploy `GET /api/version` plus the v2 playlist contract and verify a public compatible-v2 HTTP 200 tied to an exact backend revision; rotate/revoke the exposed credential and decide history remediation; complete the lifecycle/accessibility matrices; choose protected production signing and recovery ownership; test upgrade/rollback; retain R8/native/Hermes symbols; produce any approved APK/AAB; then promote only after all required P0/P1 gates pass. Never replace the existing `v1.0.1` asset or upload b10012.

## 6. API coverage appendix

The backend already supports almost all product areas; parity is primarily Android client work.

### Android API surface: 73 exports, 72 hand-maintained execution paths

[`mobile/src/api/endpoints.ts`](../mobile/src/api/endpoints.ts) now has 73 exported endpoint functions. Coverage includes:

- **Auth/session:** login, registration, bootstrap, logout, update/delete account.
- **Discovery/home/catalog:** search by entity, charts, mixes, because-listened, radar, moods, genres, releases, track, album, artist and artist-about.
- **Library/social:** owned/public playlists, complete playlist mutation surface, likes/contains, following/contains/follow/unfollow, stats and public profile.
- **Import/media/settings:** external resolve, Deezer playlist detail, lyrics, server-cache/preload, play counts, record-play, and playback settings. Avatar and playlist-cover upload endpoints/helpers are not present in Android and remain explicit UI/API work under ACCOUNT-03 and PLAYLIST-06.
- **Party/admin:** party create/join/state/mutations/leave plus users, approval/deletion, status, storage/cleanup and invites.

Strict decoders and tests exist for the broadened wire surface, and repository/query/mutation layers expose most of it to feature code. This is **API coverage**, not screen parity: party/admin/public-profile UI remains missing. Explicit offline UI now exists through Playlist and Library, but its rebuilt-APK airplane-mode/device acceptance remains open, as do end-to-end checks for Lyrics, import, and several mutation surfaces.

### Contract work still required

- Migrate the remaining 72 hand-maintained runtime execution paths and the web consumer to generated versioned operations instead of maintaining parallel runtime request/response shapes. Album Search is the first complete generated-descriptor seam.
- Separate wire and product-domain models, preserving nullable/legacy fields and keeping UI-only state out of transport types.
- Deploy and verify the implemented compatibility endpoint, then add shared production fixtures that decode on web and Android.
- Keep the route/schema regeneration and drift workflows mandatory after run #14's exact-candidate proof, independently prove the API-only path trigger, and model the eight backend success families that remain underspecified upstream.

Backend routers already exist for browse/home, follows, full playlist management/export, profile/settings/avatar, lyrics, stats, cache/preload/streaming, admin, and party REST/SSE. Do not block mobile UI work on a backend rewrite unless a contract test demonstrates an actual server gap.

## 7. Confirmed Android-only strengths to preserve

These are not web parity gaps; they are release invariants:

- Origin-bound SecureStore session and refusal to send credentials to an invalid/downgraded origin.
- Authenticated Range stream headers.
- HTTPS-only release network policy and disabled backup/device transfer.
- Native Media3 music session, background playback, notification/lock-screen transport, audio focus, wake lock, Bluetooth/headset and noisy-audio handling.
- Native 500 MiB rolling cache and one-track preload.
- Account-scoped explicit-download manifest with Keystore AES-GCM/AtomicFile persistence, controlled no-backup audio files, strict verified-file publication, refcounted shared audio, and fail-closed scoped/all-scopes cleanup.
- Android Auto Liked Songs/playlist browse tree plus verified local Downloads, encrypted persisted remote data, trusted-controller restrictions, and a local-only post-commit refresh path.
- Pending users’ manual approval recheck.
- Decoder strictness that fails malformed data loudly; preserve the principle while moving to generated contracts.

## 8. Known confirmed defects, not merely missing features

### Resolved in the working tree

- [x] Idle **Play next/Add to queue** creates playback state; deterministic controller tests cover the formerly invisible idle path.
- [x] Manual **Play next/Add to queue** insertion now precedes context items; stable identities, removal/reorder, context-only shuffle/restore, and clear-upcoming are covered by unit tests and on-device queue QA.
- [x] Bounded retry/re-probe/position-restore/safe-stop logic exists and the emulator exercised the three-attempt timeout path without a crash or lost queue.
- [x] Player readiness waits for native MediaController connection; emulator logs showed connected before commands/listeners ready.
- [x] New search queries no longer leave old result actions live during debounce/failure.
- [x] Radio extension deduplicates against the live post-request queue; concurrent manual/Auto race tests pass.
- [x] Unsupported `MEDIA_PLAY_FROM_SEARCH` advertising was removed; current release lint has zero errors and 28 warnings.
- [x] Previous follows the three-second restart rule in deterministic controller tests.
- [x] Native-audio preparation is no longer presented as an error state.
- [x] Admin and non-admin approval gating now uses the same policy.
- [x] Cold process restoration no longer loses the active queue: v10005 restores encrypted title/order/count/position and remains paused. The v10004 numeric-string cold-start crash found during this test is fixed with an exact persisted-state regression.
- [x] Home track menus are no longer long-press-only; the visible labeled action measured 48 dp on-device.
- [x] Like/unlike is shared across rows/cards/player with optimistic rollback and immediate Library/Auto invalidation; reversible production cleanup returned 35→34 and remained unliked after cold traversal.
- [x] Retained queue history is no longer counted or presented as upcoming in current source; history/current/manual/context are separately headed and context headings use persisted human labels with localized legacy fallback.
- [x] Audio recovery and non-fatal playback bookkeeping use separate stores/banners; bookkeeping is bounded, deduplicated, localized, cannot mask a fatal error, and never exposes raw backend/native diagnostics.
- [x] Tapping the active Search row now toggles native playback without replacing/restarting its queue; another row starts a new semantic context, with exact controller tests.
- [x] Home Recently Heard now matches the seven-card web shelf while hydrating and playing the complete duplicate-preserving account history with album/artist navigation.
- [x] Recent searches are origin/account-scoped with fail-closed loading plus accessible per-item remove and clear-all; Search exposes evidence-backed duration, credit, play/popularity, and cache facts.
- [x] Queue rows expose duration plus distinct explicit-download, server-cache, and active rolling-device-cache facts; unknown download hydration is not misreported as absence.
- [x] Album detail now renders the production-equivalent rounded aggregate runtime and rejects corrupt durations in deterministic model tests.
- [x] Web and Android consume the same versioned product-queue fixture; both engines pass every success/rejection case and CI is wired to run the browser consumer before Android gates.
- [x] Automatic audio-cache cleanup is awaitable and verified natively; failed cleanup remains mandatory and blocks a later credential request until retry succeeds.
- [x] Search now has deterministic 280 ms debounce, abort propagation, late-response isolation, exact-key last-good offline retention, and retry recovery.
- [x] Library Recently Heard now hydrates and plays the complete ordered duplicate-preserving context with separate safe album/artist destinations.
- [x] Artist detail now matches hero/fan/play/follow, first-ten Popular with one batched play-count request, within-artist search, discography, and related navigation.
- [x] Profile editing validates changed identity/password fields, refreshes the same-ID session fail-closed, and identifies the effective server host.
- [x] Home personal mixes now open a stable, path-safe native detail with complete ordered playback; new releases, genres, and public/community playlists use shared native catalog cards.
- [x] Artist follow/unfollow now updates every loaded same-account Following/contains cache immediately after server confirmation without leaking or seeding another scope.
- [x] Playlist create/edit/delete/visibility/add and ordered playback now use account-scoped optimistic cache updates, exact rollback, owner/public permissions, Android Auto refresh, and global create-or-add actions. Duplicate-safe removal/reorder remains blocked by the backend's missing playlist-entry ID.
- [x] The platform Alert was replaced by an app-level accessible track action sheet that is safe across account/scope changes.
- [x] The native end-of-track sleep timer no longer fires on manual skips or misses repeat-one/final natural completion; the service-owned behavior passes focused JS/native tests.
- [x] Every query-backed Home shelf now distinguishes loading, empty, stale/refreshing, cached failure, and paused/offline state with localized retry while keeping last-good in-memory content visible.
- [x] All reachable successful remote playlist, like, and follow mutations republish Android Auto through one non-fatal helper; explicit Download/Remove uses a separate local-only post-commit refresh. Publication failure never reverses the committed mutation.
- [x] The shared track sheet now includes safe album/artist navigation and account-authorized contextual Remove with stale-request protection and exact outcomes.
- [x] Release Radar now has a typed native detail, web-equivalent cumulative unique-ID seen rules, origin/account-scoped serialized storage, relative dates, and full-context playback.
- [x] Spotify track/album/playlist paste and text-only Android Share intake now resolve into matched/unmatched playback plus new/existing playlist bulk save; the owned cold/warm bridge compiles natively.
- [x] Every Library section now shares pull-refresh and deterministic never-loaded/successful-empty/last-good/error/offline/retry presentation without persisting personalized query data in plaintext.
- [x] All 46 current `useQuery` calls and both `useQueries` groups now route through one remote-state contract or an equivalent aggregate presenter; populated and known-empty last-good outcomes survive offline/refresh failure, including the formerly escaping missing-Mix-key branch.
- [x] Auth, Profile, catalog, Library/playlist, global track-action, import, and player failures now cross typed localized presentation boundaries; raw transport/storage/native diagnostics are neither rendered nor written by the shared player banner, while explicit local validation/compatibility/recovery copy remains actionable.
- [x] The versioned OpenAPI v2 document deterministically generates all 54 Android wire schemas and 82 operation stubs/descriptors across 73 paths; drift and workflow triggers fail loudly while runtime decoders remain strict. A human-owned adapter now executes the Album Search descriptor with exact success-status enforcement before repository wire→domain mapping.
- [x] Album Search now proves the intended generated-wire → repository mapper → domain/query/UI architecture without leaking Track transport fields into its product card.
- [x] Auth lifecycle tests now cover first-admin, invited approval/consumption, ordinary pending, approval recheck, stored restart, Retry/Forget, 401 invalidation, and non-destructive 403 behavior.
- [x] Fullscreen playback now has a track-scoped synchronized Lyrics tab with production-equivalent active-line timing, auto-follow, exact line seek, provenance, and complete query states.
- [x] Shared Android text survives loading/login/pending/process gates in bounded account-scoped storage and is consumed exactly once only by the focused Search owner; runtime Share-sheet evidence remains a QA item.
- [x] Account deletion now has non-cancellable pending confirmation, server-first semantics, ordered local cleanup, and real SQLite cascade/last-admin coverage; disposable-account device forensics remain a QA/security item.
- [x] Explicit-download manifest v2 preserves the full ordered duplicate occurrence snapshot, structured partial failures, bytes/timestamps, and bidirectional shared-file ownership under an exact account scope; strict decoding and cold reconstruction tests reject corrupt or cross-account state.
- [x] The native explicit store encrypts the atomic manifest with Keystore AES-GCM, validates controlled no-backup MP3 evidence before publication, and exposes generation-guarded scoped/all-scopes cleanup; the serialized runtime prevents queued/late operations from crossing cleanup and retries orphan deletion.
- [x] Library and Playlist now expose complete/partial inventory, Download/Retry/Remove, accessible aggregate progress, cold local fallback, and strict explicit-only playback. Shared rows show Downloaded separately from server/rolling cache, and Android Auto adds a verified local Downloads root with a no-auth/no-network post-commit refresh.
- [x] The semantic theme is regression-tested around production violet, player readiness/retry/error classification contracts are closed, Android Auto browse roots expose exact playable children, and the rolling cache remains explicitly distinct from Downloads.

### Partially resolved

- [ ] Android Auto refreshes after every reachable remote Library mutation, retains last-good same-account data, and refreshes verified local Downloads after committed offline actions without auth/network reads. Remote refresh is still coarse/all-or-nothing, unpaginated, and incomplete across lifecycle/network recovery.
- [ ] Cold local browse/queue behavior is source-complete, but force-stop plus airplane-mode play/seek/Next/Previous, low-storage/partial/removal/account-switch cleanup, TalkBack, Media Controller Test, and DHU evidence has not run on a rebuilt APK.
- [x] Exact run #14 executes native instrumentation, x86_64 emulator QA, R8 and checksum steps; the ARM64 APK, x86_64 smoke package, test reports, mappings, native symbols, and Hermes map have verified upload identities.
- [ ] Queue metadata, shared golden contract, labeled semantic caller contexts, mutations, shuffle/restore/clear/manual priority, separate history/current/manual/context presentation, and one encrypted force-stop/cold restoration pass exist. Repeat/radio/background/Android Auto/reboot combinations remain incomplete, and the newest UI needs rebuilt emulator verification.

### Still open and reproduced/current

- [ ] The complete track action sheet still needs exhaustive TalkBack focus/order/outcome verification in a rebuilt APK.
- [ ] A production Focus radio start exhausted three 5-second stream-resolution POST timeouts, ended in native `ERROR`, and required a manual Next attempt; the recovery was safe but station playback did not succeed.
- [ ] Production currently returns HTTP 404 from `/api/version`; read-only probes on 2026-07-17 confirm that public v1 routes still answer while playlist detail omits v2's unique `playlist_entry_id`. Deploy metadata plus the v2 playlist contract before authenticated current-source testing or production promotion; do not weaken the client gate into an ambiguous duplicate-track fallback.
- [ ] Production `/.well-known/assetlinks.json` returns 404; HTTPS intent filters exist but App Links cannot be verified and `autoVerify` is intentionally absent.
- [x] The exported playback service intentionally suppresses lint's `ExportedService` warning because Android media-browser hosts must bind cross-package. Runtime trust filtering plus local and remote 7/7 hostile separate-UID service/controller instrumentation prove the suppression's current safety boundary; trusted Android Auto/DHU compatibility remains separately open.
- [ ] Current release lint no longer reports launcher encoding/full-square defects; light/dark/adaptive-mask rendering still needs the physical-device/emulator matrix.
- [ ] A production test credential existed in the repository’s base/history. The current script requires environment variables and no longer logs the email, and the working tree is clean of known fragments; the credential must still be rotated/revoked and history remediation decided.
- [x] The 11 moderate Expo/vector-icons/Xcode audit paths were traced to build-time `xcode@3.0.1 → uuid@7.0.3`; the unsafe Expo-46 force fix was rejected. A lockfile override to reviewed CommonJS-compatible `uuid@11.1.1`, an executable xcode-resolution/v4 compatibility guard, and a CI `npm audit --omit=dev --audit-level=moderate` gate now produce zero vulnerabilities locally.
- [ ] Historical b10012 is ARM64/debug-signed, locally verified, and installed for a fail-closed compatibility plus cleanup/auth-layout smoke, but contains RNTP/derivative code and is not built from the current tree. First-party Media3 v10014 is published separately as an exact-source, digest-verified QA prerelease; b10013 remains prior regression evidence. Production v2 metadata, authenticated account-switch/journal cleanup, credential remediation, production signing/AAB, and remaining parity gates still forbid production/latest promotion.
- [ ] Installed v10012 retains the explicit-store cleanup fix and completes signed-out cleanup to German Login without cleanup warnings or fatal errors. It also closes v10011's specific short-landscape auth clipping defect. Repeat the full queue/cache/download/notification/Auto filesystem matrix for authenticated logout/account switch and retain the broader responsive/device matrix.

## 9. Items requiring explicit product validation

These are not safe to infer solely from source:

- [ ] Confirm whether the public goal is strict route parity or a documented Android subset. This backlog assumes all P0/P1 items are required.
- [ ] Define meaningful-play accounting threshold and update both clients together.
- [x] The current production parity goal does not expose a self-hosted runtime server selector; reconsider only under [`ANDROID_SERVER_ORIGIN_POLICY.md`](./ANDROID_SERVER_ORIGIN_POLICY.md).
- [ ] Decide whether ZIP export is a native requirement or intentionally web-only.
- [ ] Decide whether crossfade is required for the first parity release; if yes, it must be native and real.
- [ ] Confirm the retention policy: current source deletes explicit downloads and the rolling cache on logout/account replacement to preserve isolation; retaining encrypted downloads would require a separate approved design.
- [ ] Confirm Android Auto voice-search behavior with DHU/Assistant rather than trusting manifest claims.
- [ ] Baseline production web cold-offline authentication before claiming Android must exceed it; Android explicit-only playback is source-complete, but rebuilt-device airplane-mode evidence remains required either way.

## 10. Definition of aligned

Android is aligned with the web app only when:

1. Every **P0** and **P1** item above is implemented or has a written, approved `Adapt/Exclude` decision.
2. Every required web route/outcome has an Android screen or native equivalent with loading, stale, empty, error, offline, and unauthorized behavior.
3. Queue/playback golden fixtures pass on both clients and native lifecycle tests pass on the emulator/device.
4. Production branding and German copy are consistent across auth, shell, catalog, library, and player.
5. Android-native security, background media, notification, Bluetooth/headset, cache, and Android Auto behavior has not regressed.
6. Clean-install and upgrade release APKs pass the full emulator matrix without Metro, crashes, ANRs, secret leakage, or manual state repair.
7. The artifact is production-signed, versioned, checksummed, reproducible enough to audit, and accompanied by retained obfuscation/symbol evidence.
8. Any remaining P2/P3 work is visible in release notes and this document—not silently omitted.

## 11. Evidence index

### Production and global shell

- Web routes: [`web/src/app`](../web/src/app)
- Five-tab mobile web nav: [`web/src/components/MobileNav.tsx`](../web/src/components/MobileNav.tsx)
- Global shell/player/queue: [`web/src/components/AppShell.tsx`](../web/src/components/AppShell.tsx)
- Production colors/tokens: [`web/src/app/globals.css`](../web/src/app/globals.css)
- Android five-tab navigation/deep-link stacks: [`mobile/src/navigation.tsx`](../mobile/src/navigation.tsx), [`mobile/src/navigationLinks.ts`](../mobile/src/navigationLinks.ts)
- Android violet theme/lockup: [`mobile/src/theme.ts`](../mobile/src/theme.ts), [`mobile/src/components/BrandLockup.tsx`](../mobile/src/components/BrandLockup.tsx)

### Feature surfaces

- Home: [`web/src/app/page.tsx`](../web/src/app/page.tsx)
- Search/import: [`web/src/app/search/page.tsx`](../web/src/app/search/page.tsx), [`web/src/components/ImportPanel.tsx`](../web/src/components/ImportPanel.tsx)
- Discover/genre: [`web/src/app/genre/page.tsx`](../web/src/app/genre/page.tsx), [`web/src/app/genre/[id]/page.tsx`](../web/src/app/genre/[id]/page.tsx)
- Album/artist: [`web/src/app/album/[id]/page.tsx`](../web/src/app/album/[id]/page.tsx), [`web/src/app/artist/[id]/page.tsx`](../web/src/app/artist/[id]/page.tsx)
- Radio/radar/mix: [`web/src/app/radio/page.tsx`](../web/src/app/radio/page.tsx), [`web/src/app/radar/page.tsx`](../web/src/app/radar/page.tsx), [`web/src/app/mix/[key]/page.tsx`](../web/src/app/mix/[key]/page.tsx)
- Library/playlist: [`web/src/app/library/page.tsx`](../web/src/app/library/page.tsx), [`web/src/app/playlist/[id]/page.tsx`](../web/src/app/playlist/[id]/page.tsx)
- Party/account/profile/status: [`web/src/app/party/[code]/page.tsx`](../web/src/app/party/[code]/page.tsx), [`web/src/app/account/page.tsx`](../web/src/app/account/page.tsx), [`web/src/app/users/[id]/page.tsx`](../web/src/app/users/[id]/page.tsx), [`web/src/app/status/page.tsx`](../web/src/app/status/page.tsx)

### Android implementation

- API/types/decoders: [`mobile/src/api/endpoints.ts`](../mobile/src/api/endpoints.ts), [`mobile/src/api/types.ts`](../mobile/src/api/types.ts), [`mobile/src/api/decoders.ts`](../mobile/src/api/decoders.ts)
- Generated OpenAPI wire/operation contract: [`api/app/android_contract.py`](../api/app/android_contract.py), [`api/openapi/v2.json`](../api/openapi/v2.json), [`mobile/src/api/generated/contract.ts`](../mobile/src/api/generated/contract.ts)
- Query/repository layer: [`mobile/src/data`](../mobile/src/data)
- Shared remote-state contract and catalog presenter: [`mobile/src/data/remoteState.ts`](../mobile/src/data/remoteState.ts), [`mobile/src/components/catalog/CatalogStates.tsx`](../mobile/src/components/catalog/CatalogStates.tsx)
- Search/playlist/radio state presenters: [`mobile/src/components/search/SearchRemoteStates.tsx`](../mobile/src/components/search/SearchRemoteStates.tsx), [`mobile/src/components/library/PlaylistRemoteStates.tsx`](../mobile/src/components/library/PlaylistRemoteStates.tsx), [`mobile/src/components/radio/RadioCards.tsx`](../mobile/src/components/radio/RadioCards.tsx)
- First wire/domain seam: [`mobile/src/data/mappers/albumSearch.ts`](../mobile/src/data/mappers/albumSearch.ts), [`mobile/src/domain/catalog.ts`](../mobile/src/domain/catalog.ts)
- Auth/session: [`mobile/src/auth/AuthContext.tsx`](../mobile/src/auth/AuthContext.tsx), [`mobile/src/api/client.ts`](../mobile/src/api/client.ts), [`mobile/src/api/session.ts`](../mobile/src/api/session.ts)
- Localized non-diagnostic feedback boundaries: [`mobile/src/auth/presentationError.ts`](../mobile/src/auth/presentationError.ts), [`mobile/src/components/trackActionFeedback.ts`](../mobile/src/components/trackActionFeedback.ts), [`mobile/src/screens/profileFeedback.ts`](../mobile/src/screens/profileFeedback.ts), [`mobile/src/screens/catalogFeedback.ts`](../mobile/src/screens/catalogFeedback.ts), [`mobile/src/screens/playlistFeedback.ts`](../mobile/src/screens/playlistFeedback.ts), [`mobile/src/player/errors.ts`](../mobile/src/player/errors.ts)
- Auth lifecycle matrix: [`mobile/src/auth/lifecycle.ts`](../mobile/src/auth/lifecycle.ts), [`mobile/src/components/SessionRestoreError.tsx`](../mobile/src/components/SessionRestoreError.tsx), [`api/tests/test_auth_registration_policy.py`](../api/tests/test_auth_registration_policy.py)
- Current 16 screen components and feature models: [`mobile/src/screens`](../mobile/src/screens)
- Home, stable Mix, and Release Radar: [`mobile/src/screens/HomeScreen.tsx`](../mobile/src/screens/HomeScreen.tsx), [`mobile/src/screens/MixScreen.tsx`](../mobile/src/screens/MixScreen.tsx), [`mobile/src/screens/RadarScreen.tsx`](../mobile/src/screens/RadarScreen.tsx), [`mobile/src/screens/homeModel.ts`](../mobile/src/screens/homeModel.ts), [`mobile/src/data/releaseRadar.ts`](../mobile/src/data/releaseRadar.ts)
- Spotify import and Android shared-text intake: [`mobile/src/components/search/SpotifyImportPanel.tsx`](../mobile/src/components/search/SpotifyImportPanel.tsx), [`mobile/src/share/spotifyImport.ts`](../mobile/src/share/spotifyImport.ts), [`mobile/src/share/sharedTextIntent.ts`](../mobile/src/share/sharedTextIntent.ts), [`mobile/src/share/sharedTextCoordinator.ts`](../mobile/src/share/sharedTextCoordinator.ts), [`mobile/src/share/sharedTextRuntime.ts`](../mobile/src/share/sharedTextRuntime.ts), [`mobile/plugins/withSharedTextIntent.js`](../mobile/plugins/withSharedTextIntent.js)
- Artist-follow and non-fatal Android Auto refresh orchestration: [`mobile/src/data/artistFollows.ts`](../mobile/src/data/artistFollows.ts), [`mobile/src/data/autoBrowseRefresh.ts`](../mobile/src/data/autoBrowseRefresh.ts)
- Playlist cache/actions and virtualized Library state: [`mobile/src/data/playlistCache.ts`](../mobile/src/data/playlistCache.ts), [`mobile/src/components/trackActions.ts`](../mobile/src/components/trackActions.ts), [`mobile/src/components/TrackActionsHost.tsx`](../mobile/src/components/TrackActionsHost.tsx), [`mobile/src/components/library/LibraryVirtualizedList.tsx`](../mobile/src/components/library/LibraryVirtualizedList.tsx), [`mobile/src/components/library/LibrarySection.tsx`](../mobile/src/components/library/LibrarySection.tsx), [`mobile/src/components/library/librarySectionState.ts`](../mobile/src/components/library/librarySectionState.ts)
- Player/queue/recovery/radio and durable side effects: [`mobile/src/player/controller.ts`](../mobile/src/player/controller.ts), [`mobile/src/player/queueContract.ts`](../mobile/src/player/queueContract.ts), [`mobile/src/player/recoveryPolicy.ts`](../mobile/src/player/recoveryPolicy.ts), [`mobile/src/player/setup.ts`](../mobile/src/player/setup.ts), [`mobile/src/player/playbackEventJournal.ts`](../mobile/src/player/playbackEventJournal.ts), [`mobile/modules/loggerythm-player/android/src/main/java/top/logge/loggerythm/player/LoggeRythmPlaybackEventJournal.kt`](../mobile/modules/loggerythm-player/android/src/main/java/top/logge/loggerythm/player/LoggeRythmPlaybackEventJournal.kt), [`mobile/modules/loggerythm-player/android/src/main/java/top/logge/loggerythm/player/LoggeRythmPlaybackJournalWork.kt`](../mobile/modules/loggerythm-player/android/src/main/java/top/logge/loggerythm/player/LoggeRythmPlaybackJournalWork.kt), [`mobile/modules/loggerythm-player/android/src/main/java/top/logge/loggerythm/player/LoggeRythmPlaybackEventHeadlessService.kt`](../mobile/modules/loggerythm-player/android/src/main/java/top/logge/loggerythm/player/LoggeRythmPlaybackEventHeadlessService.kt)
- Queue/player visual-state models: [`mobile/src/screens/queueSnapshotState.ts`](../mobile/src/screens/queueSnapshotState.ts), [`mobile/src/screens/queueMetadata.ts`](../mobile/src/screens/queueMetadata.ts), [`mobile/src/screens/nowPlayingModel.ts`](../mobile/src/screens/nowPlayingModel.ts)
- Now Playing tabs, lyrics, Similar, responsive cover treatment, and metadata links: [`mobile/src/screens/NowPlayingScreen.tsx`](../mobile/src/screens/NowPlayingScreen.tsx), [`mobile/src/screens/nowPlayingLayout.ts`](../mobile/src/screens/nowPlayingLayout.ts), [`mobile/src/components/player/NowPlayingTabs.tsx`](../mobile/src/components/player/NowPlayingTabs.tsx), [`mobile/src/components/player/LyricsPanel.tsx`](../mobile/src/components/player/LyricsPanel.tsx), [`mobile/src/components/player/SimilarPanel.tsx`](../mobile/src/components/player/SimilarPanel.tsx), [`mobile/src/components/player/NowPlayingArtwork.tsx`](../mobile/src/components/player/NowPlayingArtwork.tsx), [`mobile/src/components/player/coverUrl.ts`](../mobile/src/components/player/coverUrl.ts), [`mobile/src/components/player/NowPlayingMetadata.tsx`](../mobile/src/components/player/NowPlayingMetadata.tsx), [`mobile/src/screens/lyricsModel.ts`](../mobile/src/screens/lyricsModel.ts)
- Account deletion: [`mobile/src/screens/ProfileScreen.tsx`](../mobile/src/screens/ProfileScreen.tsx), [`mobile/src/auth/deleteAccount.ts`](../mobile/src/auth/deleteAccount.ts), [`api/tests/test_account_deletion.py`](../api/tests/test_account_deletion.py)
- Semantic theme contract: [`mobile/src/theme.ts`](../mobile/src/theme.ts), [`mobile/src/theme.test.ts`](../mobile/src/theme.test.ts)
- First-party player and Android Auto foundation: [`mobile/src/player/playerPort.ts`](../mobile/src/player/playerPort.ts), [`mobile/src/player/nativePlayerPort.ts`](../mobile/src/player/nativePlayerPort.ts), [`mobile/src/player/browseTree.ts`](../mobile/src/player/browseTree.ts), [`mobile/modules/loggerythm-player`](../mobile/modules/loggerythm-player), [`mobile/plugins/withFirstPartyPlayer.js`](../mobile/plugins/withFirstPartyPlayer.js)
- Shared queue contract: [`contracts/product-queue.v1.json`](../contracts/product-queue.v1.json), [`web/src/store/queuePolicy.ts`](../web/src/store/queuePolicy.ts), [`mobile/src/player/productQueueGolden.test.ts`](../mobile/src/player/productQueueGolden.test.ts)
- Session threat model: [`docs/ANDROID_SESSION_THREAT_MODEL.md`](./ANDROID_SESSION_THREAT_MODEL.md)
- Server-origin decision and invariants: [`docs/ANDROID_SERVER_ORIGIN_POLICY.md`](./ANDROID_SERVER_ORIGIN_POLICY.md)
- First-party migration and artifact gate: [`docs/FIRST_PARTY_MEDIA3_MIGRATION.md`](./FIRST_PARTY_MEDIA3_MIGRATION.md), [`mobile/scripts/verify_first_party_player_gate.mjs`](../mobile/scripts/verify_first_party_player_gate.mjs)
- Historical RNTP provenance (superseded): [`docs/RNTP_PATCH_OWNERSHIP.md`](./RNTP_PATCH_OWNERSHIP.md)
- App/network/package/native volume policy: [`mobile/app.json`](../mobile/app.json), [`mobile/plugins/withMusicVolumeControl.js`](../mobile/plugins/withMusicVolumeControl.js), [`mobile/src/player/setup.ts`](../mobile/src/player/setup.ts)
- CI: [`.github/workflows/mobile-android.yml`](../.github/workflows/mobile-android.yml)
- ABI policy: [`docs/ANDROID_ABI_POLICY.md`](./ANDROID_ABI_POLICY.md)
- Current Media3 QA ledger, exact run #14, and QA prerelease: [`docs/ANDROID_MEDIA3_QA_2026-07-17.md`](./ANDROID_MEDIA3_QA_2026-07-17.md), [workflow `29559829540`](https://github.com/LoggeL/LoggeRythm/actions/runs/29559829540), [`android-media3-v1.0.3-rc.1`](https://github.com/LoggeL/LoggeRythm/releases/tag/android-media3-v1.0.3-rc.1)
- Prior Media3 QA ledger (historical): [`docs/ANDROID_MEDIA3_QA_2026-07-16.md`](./ANDROID_MEDIA3_QA_2026-07-16.md)
- Standalone/startup and installed-session emulator QA: [`mobile/scripts/android_smoke.py`](../mobile/scripts/android_smoke.py), [`mobile/scripts/android_session_qa.py`](../mobile/scripts/android_session_qa.py)
- Detailed API 36 production-connected QA record: [`docs/ANDROID_EMULATOR_QA_2026-07-15.md`](./ANDROID_EMULATOR_QA_2026-07-15.md)

### API/backend capability

- Web API facade: [`web/src/lib/api.ts`](../web/src/lib/api.ts)
- FastAPI routers: [`api/app/routers`](../api/app/routers)

---

**Maintenance rule:** Any feature, route, API contract, queue rule, auth rule, or release behavior added to web or Android must update this matrix in the same change. New web-only behavior requires an explicit `Port`, `Adapt`, or `Exclude` decision.
