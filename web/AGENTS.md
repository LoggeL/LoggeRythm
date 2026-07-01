<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# No silent fallbacks — fail loud and clear

Do not add fallbacks, default values, or catch-and-continue paths that hide a failure. Errors must crash loudly with a clear, specific message so the cause is obvious. No swallowed exceptions, no warn-and-continue, no placeholder/empty data on failure. See the repo-root `CLAUDE.md` for the full rule.
