# Fork changes

`main` started as a clean copy of upstream Pages CMS. Fork-specific work is
kept in new files where practical so upstream merges have a small conflict
surface.

## Workshop changes

- `lib/templates.ts` uses `ChrisO72/astro-template` as the only starter.
- `next.config.mjs` permits the `127.0.0.1` development origin used by the
  GitHub callback flow.
- `scripts/setup-github-app.mjs` follows the current GitHub App manifest flow
  and requests repository contents and Actions write permissions.

## AI assistant

The repository-scoped AI page lives at
`app/(main)/[owner]/[repo]/[branch]/ai`. The only upstream-facing UI injection
is the `AI Assistant` item in `components/repo/repo-sidebar.tsx`. It is visible
to every authenticated user who can access that repository, including email
collaborators.

The initial functional implementation is intentionally self-contained:

- `components/ai/ai-page.tsx` and `components/ai/run-activity.tsx` provide
  private conversation history, chat, routing information, stop/retry controls,
  production approval, elapsed time, and a live Codex-style activity timeline.
  The timeline preserves readable reasoning summaries, commentary, commands and
  their output, file changes, web searches, MCP calls, deploys, and failures.
- Ask Otto messages support up to four PNG, JPEG, WebP, or UTF-8 text/code
  attachments totaling 4 MiB per message and 40 MiB of unique files per
  conversation. Files are stored privately in PostgreSQL, can be downloaded or
  attached again without duplicating bytes, and remain scoped to the
  conversation creator. During a run, only the current message's attachments
  are written below `.git/pagescms-ai-attachments` in the disposable checkout,
  keeping them out of commits; raster images are also passed to Codex as native
  `localImage` inputs.
- `app/api/[owner]/[repo]/[branch]/ai` contains repository-scoped conversation,
  message, SSE event, cancellation, and approval endpoints.
- `lib/ai/router.ts` sends every message through `gpt-5.6-luna` using strict
  structured output. It selects `gpt-5.6-luna`, `gpt-5.6-terra`, or
  `gpt-5.6-sol`; a router failure falls back to Terra at medium effort.
- `lib/ai/runtime.ts` creates a shallow disposable checkout and runs the
  official Codex App Server over stdio. The selected model and reasoning effort
  are supplied per turn. Each disposable App Server is authenticated through
  its `account/login/start` API-key flow, conversation history is injected,
  filesystem access is limited to the checkout, and live web search plus
  outbound workspace network access are enabled for current external content.
  Spawned shell commands inherit only `PATH`, not application secrets. The MCP
  child is launched with the application's absolute Node executable and the
  `tsx` loader, so it does not depend on `PATH`; startup failures are captured
  in a per-run diagnostic and surfaced in the activity timeline.
- `lib/ai/mcp-server.ts` is a local stdio MCP server exposing repository
  context/refresh/publish and deployment preview/production/list/status/logs/
  cancel tools. Each process receives a signed, expiring capability fixed to a
  run and workspace; GitHub credentials stay server-side.
- `lib/ai/repository-config.ts` reads deployment actions directly from the
  selected branch's `.pages.yml`, keeping the standalone MCP process out of the
  browser-oriented field registry. `lib/package.json` marks server library
  modules as ESM for the Node-hosted MCP entry point.
- The Pages CMS MCP is marked `required`, launched from the application working
  directory with an explicit server-only environment allowlist, and verified
  through `mcpServerStatus/list` before a turn can begin. A failed tool server
  now fails the run visibly instead of allowing Codex to continue without its
  publish/deployment capabilities.
- `lib/ai/repository.ts` clones and publishes through the user's existing
  GitHub or installation-token authorization. Pushes are non-force and rejected
  when the remote branch moved. A successful commit automatically dispatches
  the configured `deploy-preview` root action.
- `lib/ai/deployments.ts` resolves the existing `.pages.yml` root actions by
  the exact names `deploy-preview` and `deploy`; no configuration schema was
  added. Production deploys require an explicit, creator-only approval pinned
  to the branch SHA, and are invalidated if that SHA changes.
- `db/schema.ts` and migrations `0013_worried_marrow.sql` and
  `0014_parched_impossible_man.sql` add private conversations, messages,
  attachments, runs, streamed events, and approval records.
- `types/ai.ts` contains the fork's shared AI API types.

The AI runtime assumes a long-lived Node process. In-process run handles are
used for cancellation while durable messages, status, events, and approvals
remain in PostgreSQL. This is not designed for request-isolated serverless
workers.

## Configuration

Install dependencies from `package-lock.json` and set:

```dotenv
OPENAI_API_KEY=your-openai-api-key
# Optional; defaults to BETTER_AUTH_SECRET when omitted.
AI_MCP_SECRET=another-random-string-of-characters
```

The fork adds the official `openai` and `@openai/codex` packages, the MCP SDK,
and `tsx` for launching the TypeScript stdio MCP process. Apply database
migrations before using the assistant. Runtime verification is intentionally
left to the deployment environment; repository validation for this change is
limited to lint and production build.
