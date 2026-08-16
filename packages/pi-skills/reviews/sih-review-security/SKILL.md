---
name: sih-review-security
description: R4 Security/threat review: threat modeling on the changed surface — injection, authentication, authorization, secret handling, exposure widening, injection through the new code path. Manual review complements scanners; scanners alone never satisfy R4.
metadata:
  sih.stage: verify
  sih.tool-group: review-read-only
  sih.access: Read: pinned read snapshot (read, grep, find, ls), pinned read-only analyzers, and the allow-listed docs proxy (context only, never evidence). No project writes, no shell; no direct production access, credentials, or actions.
  sih.independence: One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.
  sih.scope: demo
  sih.version: 1.0
  sih.role-code: R4
---

# sih-review-security

R4 Security/threat review: threat modeling on the changed surface — injection, authentication, authorization, secret handling, exposure widening, injection through the new code path. Manual review complements scanners; scanners alone never satisfy R4.

## Role contract

- A secret in the diff is a blocker and triggers the credential-exposure path: human decision, no autonomous remediation.
- Suppression changes for the candidate's own findings are blockers and go through human review.

## Tool group

`review-read-only` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
