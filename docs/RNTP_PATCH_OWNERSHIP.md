# Historical RNTP licensing and patch-provenance record

**Status:** superseded for the active source tree by
[`FIRST_PARTY_MEDIA3_MIGRATION.md`](./FIRST_PARTY_MEDIA3_MIGRATION.md). This file
is retained to preserve the provenance, license decision, test record, and safe
handling rules for the local b10012 checkpoint. It is not an active dependency
upgrade or release path, and RNTP must not be reintroduced to publish an APK.

**Historical dependency:** `@rntp/player@5.6.0`

**Historical patch:** `mobile/patches/@rntp+player+5.6.0.patch`

**Owner:** the `LoggeL/LoggeRythm` repository/release owner is accountable for
licensing and release approval; the Android maintainer owns patch rebases,
native tests, and rollback execution. These roles may be delegated, but a
release cannot proceed with either role unassigned.

**Reviewed:** 2026-07-16

## 1. Historical distribution decision

The package's installed `license.txt` says:

- Personal or qualified educational non-commercial use is free.
- Other use requires a paid commercial license.
- The commercial terms prohibit sharing, distribution, or sublicensing to
  third parties without explicit written permission.

The repository has no recorded paid license, written redistribution permission,
or counsel-approved interpretation covering a public APK/AAB or the large
derivative patch. Therefore:

- Local development and private QA for the repository owner's personal use are
  the only distribution scope accepted by this playbook.
- A public GitHub Release, public APK link, Play distribution, organization use,
  or third-party beta is blocked until the release owner records written
  permission/license terms that explicitly cover the intended channel and the
  patched/derivative native code.
- The chosen exit is replacement with a first-party Media3 service before
  public distribution.
- Do not publish the patch as a standalone artifact or mirror the upstream
  package.

This is an engineering release gate, not legal advice. The release owner must
retain the actual agreement/permission outside the repository if it contains
confidential commercial terms, and record only its scope, owner, expiry, and
permitted channels here.

The installed license can be fingerprinted without copying its terms:

```bash
shasum -a 256 node_modules/@rntp/player/license.txt
```

For the reviewed 5.6.0 install the fingerprint is
`d662a67651c9ed6224aba9e229f150d757431d7e4533e1bb5b6dca12b7414cbd`.
Any change requires a new license review before dependency installation or
release.

Reviewed historical patch provenance:

- 3,870 lines;
- SHA-256
  `d0a6bd799aef1711a4f8555f9d8941ed745750c6c9ed1ade21623d511f92ece3`;
- a fresh clean `npm ci --offline` applied the current patch from pristine
  locked dependencies on 2026-07-16; repository status was unchanged;
- the complete current-hash native release JVM run passed 250/250 tests across
  19 suites with zero failures, errors, or skips, including 34 sleep-timer
  integration tests and three timer-state tests;
- inspection found no Gradle build products, absolute paths, binaries, or
  license files embedded in the patch.

This technical provenance does not change the distribution decision above.

## 2. Why the historical patch was a first-class subsystem

The patch is not cosmetic. It changes:

- TurboModule/JavaScript audio APIs and generated type surfaces.
- MediaController connection readiness and custom commands.
- authenticated per-URI Media3 DataSource headers.
- Android Auto browse-tree publication and encrypted restoration.
- Android Keystore encrypted queue/product-metadata persistence.
- queue shuffle metadata, sleep timer, preload/cache, and cleanup.
- controller trust policy and service behavior.
- Kotlin unit/instrumentation tests.

A dependency bump and its patch are one atomic source change. Never update the
version, lockfile, package contents, or patch independently.

## 3. Historical patch-provenance requirements

The following requirements remain the review standard for any retained local
RNTP checkpoint. They do not authorize restoring the dependency to the active
application.

For every patch revision, the change description or release evidence must
record:

| Field | Required value |
|---|---|
| Upstream package | exact package version and lockfile integrity |
| Installed license | SHA-256 and reviewed distribution scope |
| Patch | SHA-256 after a clean regeneration |
| Base | pristine package produced by `npm ci` from the committed lockfile |
| Intent | affected subsystem and linked parity/security requirement |
| Native formats | queue/browse persistence version impact and migration decision |
| Verification | JS, Kotlin, instrumentation, lint, release assembly, emulator evidence |
| Reviewer | Android maintainer plus release owner for license/security changes |

Do not hand-edit hunk offsets after native-source changes. Regenerate the patch
from a pristine dependency install and review the resulting complete diff.

## 4. Historical rebase/upgrade procedure

This procedure is preserved for forensic review or an explicitly authorized
private checkpoint only. It is superseded for product development; active work
must continue on the first-party Media3 migration.

Use a dedicated branch/worktree with no unrelated dependency changes.

1. Record the old package, lockfile, license hash, patch hash, native persistence
   versions, and last known-good APK/source revision.
2. Verify the intended distribution remains licensed before downloading or
   adopting the new package.
3. Run a pristine install of the committed old version and prove
   `patch-package` applies the committed patch without offset/fuzz failure.
4. Save the LoggeRythm-modified native/JS files as review input, not as a package
   to distribute.
5. Update only the RNTP version and lockfile. Install the new pristine version
   without applying the old patch.
6. Reapply each owned behavior by subsystem, resolving against upstream rather
   than blindly transplanting old hunks:
   - bridge/types;
   - controller readiness/commands;
   - authenticated DataSource headers;
   - encrypted browse tree;
   - encrypted player/queue persistence;
   - cache/preload/timer cleanup;
   - controller authorization;
   - tests.
7. Explicitly version or migrate any persisted schema change. Unsupported or
   corrupt ciphertext must fail closed and delete only the affected old
   snapshot; never deserialize it permissively or fall back to plaintext.
8. Generate the new patch with `patch-package`; inspect for accidental build
   products, credentials, absolute paths, upstream unrelated code, and license
   files.
9. Delete `node_modules`, run a second clean `npm ci` (offline is acceptable
   only when the exact cache is already trusted), and prove the generated patch
   applies from scratch.
10. Run the complete regression gates in section 5. An upgrade is not complete
    when TypeScript alone passes.
11. Build an upgrade-test APK with a monotonic version code and the same
    authorized signing identity. Verify migration from the last distributed
    artifact before considering a release.
12. Record the hashes, results, known deferrals, and license approval scope in
    the release evidence.

## 5. Historical mandatory regression matrix

Every patch change runs:

### JavaScript/contract

- `npm run check`
- Android QA harness unit tests
- queue golden fixtures shared with web
- logout/account-switch serialization and failure tests
- authenticated stream/header and compatibility-gate tests

### Native JVM

- all RNTP release unit tests, including:
  - header injection and metadata non-disclosure;
  - browse-tree validation/encryption/header replacement;
  - player-state encryption/restore/corruption;
  - controller trust policy;
  - cache/preload cleanup;
  - sleep timer and queue persistence;
  - numeric-string/native bridge regression.

### Device instrumentation

- Android Keystore browse-tree and player-state round trips;
- key loss/corruption cleanup;
- cold service restoration;
- logout deletion with filesystem/notification observation;
- trusted system controller behavior;
- hostile separate-UID controller rejection.

### Release/runtime

- clean `npm ci` patch application;
- Expo prebuild;
- release lint;
- optimized standalone ARM64 and emulator ABI assembly;
- signature, alignment, embedded Hermes, API-origin, manifest, and secret scans;
- clean install, cold/warm launch without Metro, crash/ANR/native/JS audit;
- authenticated playback, queue, process/background/reboot, notification,
  Android Auto/DHU, and account-boundary evidence as required by the parity TODO.

Remote CI must run on the exact commit intended for release. Local green tests
cannot substitute for that provenance.

## 6. Historical rollback procedure

Rollback means restoring a previously verified dependency+patch pair, not
removing individual hunks until compilation succeeds.

1. Stop release publication and preserve the failing APK, mapping/symbols, logs,
   device image, dependency/patch hashes, and reproduction.
2. Identify the last known-good commit containing a matched package version,
   lockfile, patch, generated native project policy, and persistence formats.
3. Determine data compatibility before building:
   - If the failed build never shipped, restore the known-good pair directly.
   - If it shipped and wrote a newer encrypted schema, add an intentional
     forward migration or clear only that account-scoped snapshot with explicit
     user impact. Never ship a silent downgrade that crashes or exposes data.
4. Build with a version code greater than every distributed build. Android
   normally rejects a lower version code even when source is older.
5. Use the same authorized production signing identity; never switch to the QA
   debug signer as a rollback.
6. Run the full mandatory matrix, including upgrade from the affected release
   and preservation/intentional clearing of session, queue, Auto, and downloads.
7. Publish rollback notes identifying the reverted subsystem, data behavior,
   and evidence. Do not overwrite an existing tag or asset.

For an emergency security rollback, disabling authenticated background
playback or clearing encrypted player state is preferable to retaining another
account's headers/metadata. Account isolation wins over playback continuity.

## 7. First-party exit outcome

The source-owned application has now crossed the dependency boundary:

- `@rntp/player`, its lock entries, the derivative patch, `patch-package`
  postinstall, the old Android Auto plugin, direct imports/mocks, and RNTP CI
  markers are removed;
- `@loggerythm/player-native` resolves to the local
  `mobile/modules/loggerythm-player` package;
- all 28 production/test consumers use the owned player facade;
- the TypeScript `PlayerPort`, immutable snapshot hooks, and strict Native-v1
  mapper are in place;
- the first-party `MediaLibraryService`, controller policy, strict Cookie
  vault/DataSource, 500 MiB LRU, maximum-8-MiB one-next preload, and 1-second
  progress ticker exist;
- the versioned encrypted codec/store passes 19 focused tests, but lifecycle
  integration is still in progress and is not device proof.

A clean Expo prebuild has removed the stale generated-Android references. The
gate scans 421 source/generated files with zero findings, and Gradle exposes
only `:loggerythm_player-native` as a player project. The newly assembled APK
must still pass the unpacked class/string scan; source cleanliness alone is not
artifact evidence.

The local b10012 checkpoint and any commit/tag/archive containing its derivative
patch remain non-publishable under this repository's recorded permission. A
clean first-party artifact does not inherit the package redistribution blocker,
but it still requires history-aware release provenance and every independent
security, backend, signing, CI, and parity gate.

Still open in the first-party subsystem:

- complete session binding and one atomic JS/Kotlin account cleanup boundary;
- integrate encrypted persistence into live service restoration;
- implement sleep and remaining remote commands;
- implement first-party headless delivery and Android Auto sibling/cold-tree
  behavior;
- run Keystore, process-death, separate-UID, notification, audio/lifecycle,
  DHU, emulator, and release instrumentation.

React Native screens remain the chosen UI. A Flutter rewrite does not remove
this native work and is not the recommended exit.

## 8. Current exit/release checklist

- [x] Historical RNTP version, license hash, patch hash, and local-only
  distribution decision are retained in this record.
- [x] Dependency, derivative patch, postinstall, old plugin, 28 direct
  consumers, and RNTP workflow markers are removed from source-owned files.
- [x] A clean prebuild removes the stale generated-Android findings; the gate
  scans 421 files with zero findings and Gradle lists only the first-party
  player project.
- [ ] Hermes, DEX/native, and unpacked-APK gates pass on a newly assembled
  artifact.
- [ ] Session binding, persistence lifecycle, sleep, headless, Auto, and atomic
  cleanup are complete.
- [ ] Full JS/JVM/instrumentation/emulator/release evidence passes on the exact
  clean commit.
- [ ] Production v2 metadata and playlist contract deploy atomically under an
  identified authority; production currently returns 404 at `/api/version`.
- [ ] The previously exposed credential is rotated/revoked and the history
  remediation decision is recorded.
- [ ] Production signing, exact-commit CI, parity gates, and release-owner
  approval pass.

Any unchecked item blocks a public release.
