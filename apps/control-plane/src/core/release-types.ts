/**
 * Local durable-artifact types for the Control Plane: the Recovery Point,
 * Release record, and direct-action record. These are Demo Profile / Control
 * Plane shapes whose wire schemas are not yet in `@sih/contracts`; they are
 * sealed under local schema ids and recorded as a contracts gap.
 */
export interface RecoveryPoint {
  id: string
  incident_id: string
  run_id: string
  changed_surfaces: string[]
  prior_state: {
    compose_project_file_hash: string
    image_digest: string
    service_version: string
    environment_files: string[]
    flag_files: string[]
  }
  restore_command: string
  preconditions: string[]
  timeout_seconds: number
  retention_deadline: string
  validated: boolean
  validated_at: string | null
  sealed_at: string
}

export interface ReleaseRecord {
  incident_id: string
  run_id: string
  attempt: number
  candidate_hash: string
  remediation_ref: string
  verification_report_ref: string
  target: string
  expected_version: string
  authority_mode: string
  policy_version: string
  action_risk_class: string
  approvals: string[]
  release_gate_ref: string
  recovery_point_id: string
  rollout_plan_ref: string
  watch_plan_ref: string
  permit_id: string | null
  adapter_receipt_ids: string[]
  stage_history: { stage: string; status: string; at: string }[]
  sealed_at: string
}

export interface DirectActionRecord {
  incident_id: string
  run_id: string
  attempt: number
  candidate_hash: string
  action: {
    adapter: string
    action_class: string
    command: string
  }
  target: string
  expected_version: string
  authority_mode: string
  policy_version: string
  action_risk_class: string
  action_gate_ref: string
  recovery_point_id: string
  permit_id: string | null
  adapter_receipt_ids: string[]
  sealed_at: string
}

export const RELEASE_RECORD_SCHEMA_ID = "release-record"
export const RECOVERY_POINT_SCHEMA_ID = "recovery-point"
export const DIRECT_ACTION_RECORD_SCHEMA_ID = "direct-action-record"
