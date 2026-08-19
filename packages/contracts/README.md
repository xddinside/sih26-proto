# @sih/contracts

Shared JSON Schema (Draft 2020-12) and TypeScript types for the SIH autonomous
incident remediation product. This package owns the wire contracts, the
deterministic hashing, the journal transition rules, and the saved-bundle
integrity verifier. It is a pure functional-core module: no filesystem,
network, database, clock, environment, process startup, or framework code in
exported behavior.

Scope: `packages/contracts/**` and `demo/fixtures/contracts/**`. This package
does not scaffold the root monorepo — issue #14 owns root workspace files.

## One-command check

```bash
bun run check
```

runs `bun run typecheck && bun run test`. Tests are `bun test` (Bun test runner
plus `fast-check`). All schema documents compile under Ajv 2020 strict mode,
all fixtures verify, and all named integrity failures are covered.

## Module interfaces

Subpaths are precise; there is no barrel `index.ts`.

| Subpath | Exports |
|---|---|
| `@sih/contracts/schemas` | `SCHEMA_REGISTRY`, `classifySchema`, `schemaKey`, `allSchemas`, `SchemaName`, `SchemaVersion`, `SchemaClassification` |
| `@sih/contracts/types` | All `FromSchema`-derived wire types (`JournalEvent`, `IncidentTrigger`, `ArtifactEnvelope`, `SavedBundleManifest`, …) |
| `@sih/contracts/parse` | `validate`, `parseIncidentTrigger`, `parseJournalEvent`, `parseSavedBundleManifest`, `parseArtifactEnvelope`, `parseBrokerReceipt`, `parseGateEvaluation`, `parseJournalLines` |
| `@sih/contracts/hashes` | `sha256Hex`, `sha256Bytes`, `isHashString`, `contentHash`, `candidateHash`, `evidenceItemId`, `incidentKey`, `deliveryKey` |
| `@sih/contracts/canonical` | `canonicalizeJsonValue`, `canonicalizeJsonText`, `parseJsonTextStrict` |
| `@sih/contracts/journal` | `initialJournalState`, `applyJournalEvent`, `applyJournalCommand`, `verifyJournalSequence`, `reduceJournalEvents`, `JournalState` |
| `@sih/contracts/transitions` | `isLegalIncidentTransition`, `isLegalRunTransition`, `checkStageRecords`, `STAGE_ORDER`, `isRunTerminal` |
| `@sih/contracts/redaction` | `verifyRedaction`, `resolvePointer`, `splitPointer`, `REDACTED` |
| `@sih/contracts/freshness` | `isFresh`, `checkFreshness` |
| `@sih/contracts/paths` | `normalizeSavedPath`, `validatePaths` |
| `@sih/contracts/saved-bundle` | `verifySavedBundle`, `SavedFiles`, `VerifyOptions`, `VerifiedBundle` |
| `@sih/contracts/errors` | `INTEGRITY_ERROR_CODES`, `IntegrityError`, `IntegrityErrorCode`, `integrityError` |

Expected failures are typed `Result` values, never thrown. Internal defects may
throw.

## Error vocabulary

Stable integrity codes, used verbatim by the saved-bundle verifier so the
Incident Workspace can render stable states: `MALFORMED_CONTRACT`,
`BAD_SEQUENCE`, `ILLEGAL_TRANSITION`, `DUPLICATE_TRANSITION`, `STALE_SCHEMA`,
`UNKNOWN_SCHEMA`, `STALE_DATA`, `REDACTION_FAILURE`, `MISSING_ARTIFACT`,
`CHANGED_CONTENT`, `INVALID_PATH`.

## Build handoff section 9 registry

Every interface from `docs/build-handoff.md` section 9 has a versioned schema
here or a canonical report link.

| Interface (section 9) | Contract | Status |
|---|---|---|
| Incident Trigger | `incident-trigger@1.0` | Implemented |
| Journal events | `journal-event@1.1` (14-kind discriminated union; 1.0 replay retained) | Implemented |
| Sealed artifact envelope | `artifact-envelope@1.0` | Implemented |
| Read APIs (demo scope) | live read endpoints — deferred | [incident-workspace](../../docs/research/incident-workspace.md) |
| Event stream and commands | deferred live scope | [incident-workspace](../../docs/research/incident-workspace.md) |
| Broker requests and receipts | `broker-receipt@1.0` (read/action/test/CI-shaped) | Implemented |
| Worker startup contract | deferred live scope | [pi-agent-catalog](../../docs/research/pi-agent-catalog.md) |
| Skill output schemas | `review-report@1.0`, `test-report@1.0`, `remediation-proposal@1.0`, `verification-report@1.0` | Implemented |
| Fusion participant / Judge / Synthesizer outputs | `fusion-participant-output@1.0`, `fusion-judge-output@1.0`, `fusion-synthesizer-output@1.0` | Implemented |
| Candidate and content hashes | `candidate-hash-input@1.0`, `evidence-hash-input@1.0`, `incident-key-input@1.0`, `delivery-key-input@1.0` + `hashes` module | Implemented |
| Release and action adapters | deferred provider contracts | [company-integration](../../docs/research/company-integration.md), [release-recovery](../../docs/research/release-recovery.md) |
| Saved export manifest | `saved-bundle-manifest@1.0` | Implemented |

Implemented schema names and versions: `incident-trigger`, `evidence-item`,
`evidence-set`, `hypothesis`, `incident`, `incident-run`, `stage-record`,
`journal-event`, `artifact-envelope`, `saved-bundle-manifest`,
`broker-receipt`, `gate-evaluation`, `incident-brief`, `diagnosis-report`,
`fusion-participant-output`, `fusion-judge-output`, `fusion-synthesizer-output`,
`remediation-proposal`, `review-report`, `test-report`,
`verification-report`, `rollout-watch-plan`, `watch-report`, `incident-report`,
`candidate-hash-input`, `evidence-hash-input`, `incident-key-input`,
`delivery-key-input` — all at version `1.0`.

The live API, SSE, command, Worker startup, and production adapter schemas are
deliberately not invented here. Deferred and provider contracts point to their
canonical research docs above.

## Hashing and versioning

- Canonical JSON follows RFC 8785 (JCS), sorting keys by UTF-16 code units,
  preserving array order and Unicode, emitting UTF-8 with no whitespace.
- SHA-256 strings are lowercase `sha256:<64 hex>`.
- Every derived hash wraps its input in a domain-separated structured object;
  content hash vs exact file-byte hash are distinct (file hashes bind exact
  bytes including JSONL newlines).
- The schema registry is explicit and versioned. Unknown schema name →
  `UNKNOWN_SCHEMA`; known schema with unsupported version → `STALE_SCHEMA`.
- See `docs/adr/0001-contract-canonicalization-and-versioning.md`.

## Saved-bundle verification

`verifySavedBundle` is a pure in-memory verifier over `POSIX path → exact
bytes`. It parses the manifest, journals, and artifact envelopes using the
registry, verifies exact byte hashes, content hashes, path/hash agreement,
sequence, legal transitions, redaction metadata, freshness (via an explicit
evaluation time), and artifact references. It never repairs, sorts into
legality, fills gaps, invents artifacts, or treats Pi JSONL/model transcripts
as evidence.

## Fixtures

`demo/fixtures/contracts/valid/` is the single byte-accurate saved bundle:
two Demo Runs (Run 1 `verified-remediation` then `closed`; Run 2
`failed: verification-failed` with no Release record and no production Watch
Report). These are contract fixtures, not captured real telemetry.

`demo/fixtures/contracts/invalid-cases.json` lists the deterministic mutation
cases and their expected error codes. Tests load the valid bundle, apply each
mutation in memory, and assert the named error. Regenerate with:

```bash
bun run fixtures
```

## Package-local lock

There is no package-local lockfile. This package installs as a workspace of
the root Bun monorepo; the root `bun install` resolves it and the single root
`bun.lock` pins every dependency. Run all installs and checks from the repo
root.

## Canonical reports

- [build-handoff](../../docs/build-handoff.md)
- [incident-intake](../../docs/research/incident-intake.md)
- [orchestrator-stages](../../docs/research/orchestrator-stages.md)
- [hypothesis-gate](../../docs/research/hypothesis-gate.md)
- [review-verification](../../docs/research/review-verification.md)
- [incident-workspace](../../docs/research/incident-workspace.md)
- [demo-runs](../../docs/research/demo-runs.md)
