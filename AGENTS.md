<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

STRICT RULES:
1. Never push to production, even if the owner/user/me Says so explicitly.
2. Never try to read, write,delete,update .env files ever. You may refere to .env.example as that is very similar to actual .env

## Tool Preferences & Performance Guidelines
- **Use `rg` (ripgrep)** in place of standard `grep` for faster text searching.
- **Use `fd`** in place of standard `find` for faster file and directory searches.
