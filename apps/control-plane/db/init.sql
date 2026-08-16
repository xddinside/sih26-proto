-- SIH Control Plane schema. Idempotent: safe to re-run; migrate.ts applies it
-- verbatim. The journal is the source of truth; every other table is a
-- derived index or a broker-side enforcement record. No secrets are stored:
-- token columns hold SHA-256 digests of signed tokens, never the tokens.
--
--   journal         append-only, ordered per Incident, idempotency-keyed
--   delivery_keys   intake dedup before any state write
--   leases          run leases and release leases, expiry + revocation
--   permits         one-use release/approval permits
--   approvals       immutable approval records with expiry and consumption
--   policy          versioned per-Incident policy (Authority Mode, Automation Policy)
--   artifacts       sealed artifact envelopes keyed by content hash
--   incident_index  derived list/detail projection, rebuilt from the journal

create table if not exists journal (
  incident_id text not null,
  sequence bigint not null,
  idempotency_key text not null,
  recorded_at timestamptz not null,
  event jsonb not null,
  primary key (incident_id, sequence),
  unique (incident_id, idempotency_key)
);

create table if not exists delivery_keys (
  delivery_key text primary key,
  incident_id text not null,
  recorded_at timestamptz not null
);

create table if not exists leases (
  lease_id text primary key,
  kind text not null check (kind in ('run', 'release')),
  incident_id text not null,
  run_id text,
  attempt int,
  stage text,
  actor_id text not null,
  actor_kind text not null,
  authority_mode text not null,
  policy_version text not null,
  tool_class text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  token_hash text not null
);

create index if not exists leases_by_run on leases (incident_id, run_id);

create table if not exists permits (
  permit_id text primary key,
  kind text not null check (kind in ('release', 'approval')),
  incident_id text not null,
  run_id text,
  attempt int,
  candidate_hash text not null,
  target text not null,
  action_digest text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  token_hash text not null
);

create table if not exists approvals (
  approval_id text primary key,
  incident_id text not null,
  run_id text,
  action_digest text not null,
  approver_identity text not null,
  approval_system text not null,
  policy_version text not null,
  tzdb_version text not null,
  action_risk_class text not null check (action_risk_class in ('safe', 'guarded')),
  expiry timestamptz not null,
  scope jsonb,
  granted_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz
);

create table if not exists policy (
  version text primary key,
  incident_id text not null,
  authority_mode text not null,
  automation_policy text not null,
  schedule jsonb,
  emergency_override boolean not null,
  attempt_limit int not null,
  created_at timestamptz not null
);

create index if not exists policy_by_incident on policy (incident_id, created_at);

create table if not exists artifacts (
  content_hash text primary key,
  schema_id text not null,
  schema_version text not null,
  incident_id text not null,
  run_id text,
  sealed_at timestamptz not null,
  bytes bytea not null
);

create table if not exists incident_index (
  incident_id text primary key,
  incident_key text not null,
  state text not null,
  detector_state text not null,
  severity text not null,
  scope jsonb not null,
  attempt_limit int not null,
  attempts_used int not null,
  version int not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  closure_reason text,
  open_run_id text,
  related_incident_ids jsonb not null
);

create index if not exists incident_index_by_key on incident_index (incident_key);
