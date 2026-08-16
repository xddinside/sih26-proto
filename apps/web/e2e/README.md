# End-to-end checks for the saved-replay Incident Workspace (issue #22)

Browser harness: **Playwright** (`playwright@1.62.1`, Chromium headless shell
v1234), installed as a standalone package inside this directory so it never
enters the root workspace or the app bundle.

## What it verifies (acceptance items 1–6)

1. Both saved runs replay from the captured bundle with their exact fixed
   outcomes (Run 1 `verified-remediation → resolved → closed`; Run 2
   `verification-failed`, no Release record, no production Watch Report, open
   with 2 attempts remaining).
2. Saved controls cannot submit (all buttons disabled, read-only reason shown,
   zero enabled controls, no request leaves the replay server).
3. Each of the six corruption classes renders an explicit error state with the
   exact contract error code.
4. Keyboard-only use, 200% zoom, reduced motion, 1280 px presentation view,
   and 390 px reading view (browser assertions + code-level conventions).
5. The fixed 12-shot evidence kit (`docs/presentation/shots/`).
6. Two timed 2–3 minute click-path rehearsals (`docs/presentation/rehearsals/`).

## How it serves the bundle

The saved-run loaders resolve `demo/fixtures/runs` by walking up from the dev
server's working directory. The runner copies `demo/saved-runs/` (the captured
export) into a shadow root under the system temp dir and starts the real Vite /
TanStack Start dev server with that directory as its working directory —
symlinking `apps/web`'s code, config, and `node_modules`. Nothing in the repo
is modified, and the UI replays exactly the captured export. The server is
exposed through `portless` (`portless alias sih-replay-e2e <port>`), falling
back to `http://127.0.0.1:<port>`.

## Run

```sh
cd apps/web/e2e
bun install                 # once; pulls playwright + downloads Chromium
bun run run-e2e.ts          # every suite
bun run run-e2e.ts --suite outcomes
bun run run-e2e.ts --suite corruption
bun run run-e2e.ts --suite a11y
bun run run-e2e.ts --suite screenshots
bun run run-e2e.ts --suite rehearsals   # ~6 minutes (two paced runs)
```

Exit code 0 when every check passes (warnings are recorded findings). The
replay-check runner is separate: `bun demo/replay/replay-check.ts` from the
repo root.

## Notes and known findings

- The corruption suite retries each navigation because the shadow dev server
  occasionally aborts a request while a corrupt bundle re-verifies (font
  `/@fs` requests 403 under the shadow root).
- The 390 px detail view overflows 553 px: the attempts-panel stage chips are
  unwrappable flex items wider than the viewport. That belongs to
  `apps/web/src/features/incident-workspace/components/panels/attempts-panel.tsx`
  (outside this issue's owned paths) — reported, not fixed here.
- The watch panel's hardcoded "each below the 0.05 limit" summary line
  contradicts the captured stage-2 rows — reported, not fixed here.
- The `tsconfig.json` here is only for this package's own `bunx tsc` run; the
  app's typecheck already includes these files via `apps/web/tsconfig.json`,
  so `bun install` in this directory is required before the root `bun run
  typecheck` resolves the `playwright` import.
