# SIH 2026 prototype — monorepo

Autonomous incident remediation system prototype. This repository is one Bun
workspace: a TanStack Start and shadcn/ui frontend shell, the shared UI
package, the shared contract package, and the saved-run fixtures.

## Stack

TanStack Start, shadcn/ui (Sera style, Mist theme, DM Sans body, Raleway
headings, Tabler icons, Base UI parts), Bun, Turbo, and Vite. Every dependency
is pinned to its exact resolved version in `bun.lock`; `workspace:*` links the
local packages. Install with Bun 1.3.x:

```bash
bun install --frozen-lockfile
```

## Checks

All commands run from the repo root:

```bash
bun run typecheck   # tsc --noEmit in every package
bun run lint        # one root ESLint flat config, Turbo task per package
bun run build       # Turbo build; Vite outputs dist/ in apps/web
bun run test        # bun test: contracts suite and replay adapter suite
```

A fresh clone must pass all four before any change is merged.

## Development

The web app dev server runs through `portless` (repo rule from `AGENTS.md`),
never a bare Vite command:

```bash
bun run dev
```

## Layout

- `apps/web/` — the TanStack Start app shell.
  - `apps/web/src/lib/replay/` — the pure static saved-bundle replay adapter.
    `loadReplayStore` verifies a saved bundle in memory (manifest file hashes,
    UTF-8 sizes, journal sequence and transitions, schema name and version,
    redaction, freshness at an explicit evaluation time, and every artifact
    and receipt reference) and projects it into a read-only store. Typed
    list, detail, and authorized-artifact reads are ready for the Workspace
    routes; the adapter has no write path, so saved controls cannot submit.
    `load-saved-bundle-fs.ts` is the server-only filesystem loader; everything
    else is pure and tested with in-memory inputs. It consumes the settled
    `manifest.json`, `incidents/<id>/journal.jsonl`, and
    `artifacts/sha256/<hash>.json` layout through `@sih/contracts` and
    surfaces named integrity errors without ever repairing data.
- `packages/ui/` — shared shadcn/ui components, theme, and styles.
- `packages/contracts/` — JSON Schema and TypeScript wire contracts, hashing,
  journal rules, and the saved-bundle verifier.
- `demo/fixtures/contracts/` — the byte-accurate saved-bundle fixture the
  contract and replay tests verify against.

The Workspace routes (`/`, `/incidents/:id`,
`/incidents/:id/artifacts/:hash`) are a later issue; this scaffold does not
build them yet.

## One lockfile

The single root `bun.lock` covers every workspace. There is no nested
lockfile; regenerate it only with `bun install` at the root, and never commit
`node_modules`, caches, or build output.
