# Android server-origin policy

**Status:** Accepted for the current parity/release goal on 2026-07-16

## Decision

The Android release has no runtime server selector. Its canonical and visibly
identified server is `https://loggerythm.logge.top`. Debug/QA bundles may use an
explicit build-time origin, but a production bundle rejects every non-canonical
origin while it is being built.

This is intentional, not an accidental limitation. A server picker would make
the selected host part of the product's security boundary: sessions, native
authenticated stream headers, query/download metadata, queue restoration,
Android Auto browse data, compatibility negotiation, App Links, and logout
cleanup would all have to migrate atomically. Parity work should not add that
state machine without an explicit self-hosted product requirement.

## Invariants

- Production resolves exactly to `https://loggerythm.logge.top`; build-time
  overrides fail a production build.
- The selected origin is normalized to a credential-free root origin. Paths,
  query strings, fragments, embedded credentials, and malformed values fail.
- The Profile account card shows the effective server host. A debug/QA build
  therefore cannot silently point at another host.
- Session storage and Query cache scope include the origin. Logout, deletion,
  and defensive account replacement clear native playback/cache/Auto data and
  account-scoped storage before another credential can be created.
- External links may select a route or invite, never a server origin.
- Every origin must pass the API compatibility gate before session/API/media
  access. A missing or incompatible endpoint fails closed.

## Reconsideration criteria

Add a runtime selector only after the product explicitly supports self-hosted
Android users. That work must include HTTPS-only enrollment (except an explicit
debug policy), visible origin confirmation, per-origin encrypted credentials,
atomic account/cache/player/Auto teardown, verified link rules, migration and
rollback behavior, hostile-link tests, and release-APK emulator evidence. It is
not a prerequisite for matching the current production web app.

## Evidence

- `mobile/src/config.ts` and `mobile/src/config.test.ts` enforce canonical
  production configuration and reject unsafe origin shapes.
- `mobile/src/api/client.ts`, `mobile/src/auth/AuthContext.tsx`, and the account
  cleanup tests bind/clear origin-scoped state.
- `mobile/src/screens/ProfileScreen.tsx` exposes the effective host in the
  account card; `profileServerHost` has deterministic formatting tests.
- The release-APK harness asserts the exact embedded/effective production
  origin and rejects emulator/Metro origins.
