# Spotifrei — working agreements

## No silent fallbacks — fail loud and clear

Do **not** add fallbacks, default values, or catch-and-continue paths that hide a failure. When something goes wrong, it must crash loudly with a clear, specific error message so the cause is obvious.

- Don't swallow exceptions (`except Exception: pass`, `... return None/False/[]`, returning placeholder/empty data when a lookup fails).
- Don't warn-and-continue. If a required input (env var, credential, upstream response) is missing or invalid, raise immediately with a message that names the cause.
- Guard `None`/unexpected shapes and `raise` with context instead of letting a cryptic `AttributeError` bubble — but never downgrade a real error into a quiet success.
- In loops/backfills, collect failures and report them loudly; never skip silently.

Rationale: silent fallbacks cost hours of debugging. Example that motivated this rule: a `.env` UTF-8 BOM made `DEEZER_ARL` load as empty, and a `get_deezer_arl()` warning-and-fallback let the app limp on with no auth instead of surfacing the real cause.
