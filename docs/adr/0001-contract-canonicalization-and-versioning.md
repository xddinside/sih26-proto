# ADR-0001: Contract canonicalization and versioning

Status: accepted

Date: 2026-08-16

## Context

Issue #16 builds the shared wire contracts for the SIH product. Several
settled reports — [incident-intake](../research/incident-intake.md),
[orchestrator-stages](../research/orchestrator-stages.md),
[hypothesis-gate](../research/hypothesis-gate.md),
[review-verification](../research/review-verification.md), and
[incident-workspace](../research/incident-workspace.md) — fix hash, version,
journal, and redaction behavior. This ADR records the lasting seams that every
later service must reproduce without re-reading a report.

## Decisions

### 1. RFC 8785 JCS plus lowercase prefixed SHA-256

All derived hashes are computed over RFC 8785 JSON Canonicalization Scheme
serialization. Keys sort by UTF-16 code unit order, array order is preserved,
Unicode is preserved exactly (no normalization), and output is UTF-8 with no
whitespace. Hash strings are lowercase `sha256:<64 hex>`.

Non-I-JSON inputs are rejected before canonicalization: `undefined`, sparse
arrays, non-finite numbers, `BigInt`, symbols, cycles, class instances, and
duplicate object keys at the raw-text parse seam.

### 2. Content hash versus exact file-byte hash

`contentHash(payload)` hashes the canonical redacted stored payload. An
artifact envelope's `content_hash` binds its payload. Manifest file hashes bind
exact file bytes, including JSONL newlines. There is no newline normalization
and the two hash spaces are never mixed.

### 3. Schema registry name/version compatibility rule

The schema registry is explicit and versioned. Current version is `1.0`. An
unknown schema name classifies `UNKNOWN_SCHEMA`; a known name with an
unsupported version classifies `STALE_SCHEMA`. Adding a schema is a code
change, never a runtime extension.

### 4. Journal sequence origin and path rules

Journal sequence starts at 1 per Incident export and must be contiguous
through the manifest's expected final sequence. Wall-clock order never decides
replay order: sequence does. Saved bundle paths are POSIX relative paths;
absolute paths, `..`, backslashes, empty segments, duplicate normalized paths,
unlisted required files, and missing listed files are rejected.

### 5. Structural redaction check limits

Redaction integrity is structural, not secret scanning. Every `masked_fields`
JSON Pointer must resolve to the literal `[REDACTED]`; missing or bad pointers
resolve to `REDACTION_FAILURE`. This deliberately does not detect undeclared
secrets.

### 6. Domain-separated hash inputs

Candidate and evidence hashes, and incident/delivery keys, each wrap their
input in a structured, domain-separated canonical object rather than
concatenating fields with delimiters. The candidate hash binds the full change
set (base snapshot/ref, diff or typed action plan, proposal fields that define
the action, declared changed surfaces, action-risk class, gate path, target
identity, and Recovery Point). The evidence item id binds canonical content,
kind, and join identity. Incident/delivery keys bind the exact settled inputs,
with `deployment_environment_name` normalized as the `environment` field.

### 7. Package-local lock is temporary

`packages/contracts/bun.lock` is committed package-local so the package can be
checked standalone. Issue #14 merges it into the root Bun workspace lock when
it scaffolds the monorepo; until then no root workspace file is created.

## Consequences

- Integrators must use this package's hash functions rather than re-deriving
  preimages, or their digests will not match.
- Any schema change bumps the version and reclassifies old data `STALE_SCHEMA`,
  so replay surfaces can render the gap rather than mis-parse.
