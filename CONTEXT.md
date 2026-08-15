# Autonomous Incident Remediation

This context defines the language for a system that uses live operational evidence to diagnose incidents, perform permitted recovery work, and verify the result.

## Language

**Signal**:
A trace, metric, log, security finding, or deployment event that describes part of a running system.
_Avoid_: Telemetry event, raw data, issue

**Incident**:
A harmful condition in a running system that an Incident Detector identifies from one or more Signals.
_Avoid_: Alert, error, bug, issue

**Incident Detector**:
The rule or connected monitoring system that turns Signals into an Incident.
_Avoid_: OpenTelemetry, diagnosis agent, AI monitor

**Evidence Set**:
The cited Signals, code locations, deployment changes, and test results used to explain an Incident or judge a Remediation.
_Avoid_: Context dump, logs

**Hypothesis**:
A possible root cause ranked by how well it explains the Evidence Set.
_Avoid_: Root cause, diagnosis, guess

**Fusion Diagnosis**:
A Diagnose-stage method adapted from the local Fusion Agent Harness. Two or more independent participants inspect the same Incident task and Evidence Set, a Judge compares their outputs, and a Synthesizer produces ranked Hypotheses, contradictions, and missing evidence for the Orchestrator to test.
_Avoid_: Majority vote, confidence vote, agent debate

**Remediation**:
A reversible action intended to restore service or remove an Incident. It can change operations, configuration, infrastructure, or code.
_Avoid_: Fix, patch, self-heal

**Remediation PR**:
A code Remediation that has passed the required review and verification gates and is ready for a merge decision.
_Avoid_: Patch candidate, fix PR

**Authority Mode**:
The user-selected limit on what the system may do for an Incident: Observe, Prepare, Repair, or Emergency.
_Avoid_: Autonomy level, safety level

**Automation Policy**:
The user-selected rule that decides when an Authority Mode needs human approval. It can require review at all times, allow autonomous work at all times, or change by a configured schedule.
_Avoid_: Automation type, operating mode

**Observe Mode**:
An Authority Mode that permits diagnosis and reporting but no Remediation.
_Avoid_: Read-only mode

**Prepare Mode**:
An Authority Mode that permits a Remediation PR but does not permit merge or deployment.
_Avoid_: PR mode

**Repair Mode**:
An Authority Mode that permits approved classes of Remediation to merge and deploy after all required gates pass.
_Avoid_: Autonomous mode, full access

**Emergency Mode**:
An Authority Mode limited to pre-approved recovery actions that reduce immediate harm, such as rollback, restart, scaling, rerouting, or feature disablement.
_Avoid_: Admin mode, unrestricted mode

**Attempt Limit**:
The user-set maximum number of evidence-led diagnosis and Remediation attempts allowed for one Incident.
_Avoid_: Retry count

**Incident Report**:
The concise final record produced when the system reaches its Attempt Limit without a verified Remediation. It records the Evidence Set, Hypotheses, actions, and results.
_Avoid_: Failure message, agent transcript

**Orchestrator**:
The agent that owns the Incident workflow, delegates bounded work, applies stage rules, and chooses the next permitted step.
_Avoid_: Main agent, supervisor, manager agent

**Control Plane**:
The long-running service that receives Incident Triggers, starts Incident Runs, enforces policy, records state, and serves the human control surface.
_Avoid_: Server, backend, main service

**Worker**:
The short-lived run environment that hosts one Orchestrator and its subagents for an Incident attempt.
_Avoid_: Orchestrator, subagent, container

**Incident Run**:
One Orchestrator-led execution of the Incident workflow, including its delegated analysis, repair, review, release, and Watch work.
_Avoid_: Worker, agent session, job

**Incident Workspace**:
The web view where a human inspects an Incident, its Evidence Set, Incident Runs, policy decisions, Remediation, Release Gate, Watch results, and Recovery Point.
_Avoid_: Monitoring dashboard, agent logs

**Solution Contract**:
The complete product proposed in the pitch, including its company deployment, integrations, controls, safety rules, and supported Incident work.
_Avoid_: Future scope, roadmap, demo scope

**Demo Profile**:
The local prototype configuration used to produce saved Incident Runs for the short presentation demo. It may remove time and cost limits while keeping the workflow and evidence real.
_Avoid_: Production mode, product scope, mock demo

**Demo Run**:
A completed Incident Run whose saved evidence and results appear in the presentation through the Incident Workspace.
_Avoid_: Live demo, scripted result, sample data

**Release Gate**:
The non-optional policy check that confirms all required evidence, reviews, tests, permissions, and recovery conditions before a Remediation can merge or deploy.
_Avoid_: Final review agent, confidence check

**Recovery Point**:
The recorded code, deployment, configuration, feature-flag, and infrastructure state needed to reverse a Remediation as fully as the connected systems permit.
_Avoid_: Git revert, backup
