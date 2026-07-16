# RNTP licensing, patch ownership, upgrade, and rollback playbook

**Dependency:** `@rntp/player@5.6.0`

**Patch:** `mobile/patches/@rntp+player+5.6.0.patch`

**Owner:** the `LoggeL/LoggeRythm` repository/release owner is accountable for
licensing and release approval; the Android maintainer owns patch rebases,
native tests, and rollback execution. These roles may be delegated, but a
release cannot proceed with either role unassigned.

**Reviewed:** 2026-07-16

## 1. Distribution decision

The package's installed `license.txt` says:

- Personal or qualified educational non-commercial use is free.
- Other use requires a paid commercial license.
- The commercial terms prohibit sharing, distribution, or sublicensing to
  third parties without explicit written permission.

The repository currently has no recorded paid license, written redistribution
permission, or counsel-approved interpretation covering a public APK/AAB or
the large derivative patch. Therefore:

- Local development and private QA for the repository owner's personal use are
  the only distribution scope accepted by this playbook.
- A public GitHub Release, public APK link, Play distribution, organization use,
  or third-party beta is blocked until the release owner records written
  permission/license terms that explicitly cover the intended channel and the
  patched/derivative native code.
- If permission cannot be obtained, replace RNTP with a first-party Media3
  service before public distribution.
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

Current reviewed patch provenance:

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

## 2. Why the patch is a first-class subsystem

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

## 3. Required patch provenance

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

## 4. Rebase/upgrade procedure

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

## 5. Mandatory regression matrix

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

## 6. Rollback procedure

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

## 7. Fork and first-party exit strategy

### Short term

Keep the pinned package+patch only while:

- the intended use/distribution is licensed;
- clean application and the regression matrix stay green;
- the patch remains reviewable as one owned subsystem.

If license terms permit a private fork, mirror the exact upstream commit into a
private repository, preserve upstream history/notices, apply LoggeRythm commits
by subsystem, and pin the app to an immutable commit/integrity value. A private
fork improves rebase review but does not expand redistribution rights.

### Android-only long term

Replace the patch incrementally with a first-party Kotlin Media3 module:

1. authenticated native session/DataSource ownership;
2. MediaLibraryService/notification/controller authorization;
3. encrypted queue and browse persistence;
4. cache/download/timer policy;
5. a narrow typed React Native command/event adapter;
6. Compose screens only where they provide a measured benefit.

Keep RN screens while the service seam moves. A Flutter rewrite does not remove
this native work and is not the recommended exit.

## 8. Change/release checklist

- [ ] Intended channel is covered by recorded written license/permission.
- [ ] RNTP version, lock integrity, license hash, and patch hash are recorded.
- [ ] Clean install applies the patch without drift.
- [ ] Persistence schema/migration decision is explicit.
- [ ] JS and all native JVM tests pass.
- [ ] Required device instrumentation passes.
- [ ] Release lint/assembly/runtime/secret evidence passes.
- [ ] Upgrade and rollback behavior from the last distributed version passes.
- [ ] Android maintainer approves technical changes.
- [ ] Repository/release owner approves licensing and distribution.

Any unchecked item blocks a public release.
