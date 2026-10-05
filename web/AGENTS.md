<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# No silent fallbacks — fail loud and clear

Do not add fallbacks, default values, or catch-and-continue paths that hide a failure. Errors must crash loudly with a clear, specific message so the cause is obvious. No swallowed exceptions, no warn-and-continue, no placeholder/empty data on failure. See the repo-root `CLAUDE.md` for the full rule.
