/**
 * Panel 8 — Verify: the applicability resolution table (required, triggered
 * conditional with recorded trigger evaluations, not-applicable), the R1–R9
 * Review Reports with cited findings, the T1–T13 Test Reports with pinned
 * tools and receipt refs, and the Verification Report with the candidate
 * hash-binding match, verdict, and reason. Every row is bound to the
 * candidate hash.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { FieldRow, MonoCell, OutcomePill, TableHead, TableRegion } from "../workspace-primitives"
import type { VerifyPanelView } from "../../lib/workspace-projection"

function findingTone(severity: string): "neutral" | "positive" | "negative" | "warning" | "info" {
  if (severity === "blocker" || severity === "major") return "negative"
  if (severity === "minor") return "warning"
  return "info"
}

export function VerifyPanel({ panel }: { panel: VerifyPanelView | null }) {
  return (
    <Section
      id="workspace-verify"
      title="Verify"
      description="applicability resolution, review reports, test reports, and the Verification Report; every result binds to the candidate hash"
    >
      {panel === null ? (
        <EmptyState title="Not reached" description="this saved run sealed no verification report" />
      ) : (
        <>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Applicability resolution</p>
          <dl className="mt-1">
            <FieldRow label="Resolver">
              <span className="font-mono text-xs">{panel.applicability.resolverVersion}</span>
              <span className="ml-2 text-xs text-muted-foreground">policy {panel.applicability.policyVersion}</span>
            </FieldRow>
            <FieldRow label="Required">
              <span className="font-mono text-xs">{panel.applicability.required.join(", ")}</span>
            </FieldRow>
            <FieldRow label="Not applicable (recorded)">
              <span className="font-mono text-xs">{panel.applicability.notApplicable.join(", ")}</span>
            </FieldRow>
          </dl>
          <div className="mt-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Triggered conditionals with their recorded trigger evaluation</p>
            <ul className="mt-1 space-y-0.5">
              {panel.applicability.triggered.map((entry) => (
                <li key={entry.key} className="text-sm">
                  <span className="font-mono text-xs">{entry.key}</span>
                  <span aria-hidden="true"> — </span>
                  {entry.value}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Review Reports</p>
            <TableRegion label="Review reports" minWidth="min-w-[44rem]">
              <TableHead columns={["Role", "Reviewer", "Rev", "Status", "Findings", "Citations"]} />
              <tbody>
                {panel.reviews.map((review) => (
                  <tr key={review.role} className="border-b border-border/60">
                    <MonoCell>{review.role}</MonoCell>
                    <MonoCell>{review.reviewer}</MonoCell>
                    <MonoCell>{review.revision}</MonoCell>
                    <td className="px-2 py-2">
                      <OutcomePill outcome={review.status} />
                    </td>
                    <td className="px-2 py-2">
                      <ul className="space-y-1">
                        {review.findings.map((finding) => (
                          <li key={finding.id}>
                            <StatePill tone={findingTone(finding.severity)}>{finding.severity}</StatePill>
                            <p className="mt-0.5 text-xs">{finding.claim}</p>
                            {finding.uncited === true ? (
                              <span className="text-xs text-destructive">uncited — cannot support a check</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-2 py-2">
                      <ul className="space-y-0.5">
                        {review.findings.flatMap((finding) =>
                          finding.citations.map((citation, index) => (
                            <li key={`${finding.id}-${index}`} className="font-mono text-xs text-muted-foreground">
                              {citation.kind}
                              {citation.file !== null ? ` ${citation.file}` : ""}
                              {citation.line !== null ? `:${citation.line}` : ""}
                              {citation.ref !== null ? ` ref ${citation.ref.slice(0, 14)}` : ""}
                            </li>
                          )),
                        )}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableRegion>
            {panel.reviews.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                every report bound to candidate{" "}
                <Citation source={panel.reviews[0]?.source ?? { kind: "artifact", ref: "review-report", schemaId: "review-report" }} label="review report artifact" />
              </p>
            ) : null}
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Test Reports</p>
            <TableRegion label="Test reports" minWidth="min-w-[48rem]" summary="pinned tools and receipt refs; deterministic receipts own pass and fail">
              <TableHead columns={["Layer", "Tool", "Target", "Receipt", "Runs", "Outcome", "Flaky"]} />
              <tbody>
                {panel.tests.map((test) => (
                  <tr key={test.layer} className="border-b border-border/60">
                    <MonoCell>{test.layer}</MonoCell>
                    <MonoCell>
                      {test.tool} {test.toolVersion}
                    </MonoCell>
                    <MonoCell>{test.target}</MonoCell>
                    <MonoCell>{test.receiptRef}</MonoCell>
                    <td className="px-2 py-2">
                      <ul className="space-y-0.5">
                        {test.runs.map((run, index) => (
                          <li key={index} className="text-xs">
                            <OutcomePill outcome={run.result} />
                            {run.detail !== null ? <span className="ml-1.5 font-mono text-xs">“{run.detail}”</span> : null}
                            <span className="ml-1.5 text-muted-foreground">{run.at}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-2 py-2">
                      <OutcomePill outcome={test.outcome} />
                    </td>
                    <MonoCell>{test.flaky ? "flaky" : "no"}</MonoCell>
                  </tr>
                ))}
              </tbody>
            </TableRegion>
          </div>

          {panel.verification !== null ? (
            <div className="mt-4 border border-border px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Verification Report</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <OutcomePill outcome={panel.verification.verdict} />
                <span className="font-mono text-xs text-muted-foreground">
                  candidate {panel.verification.candidateHash.slice(0, 16)}… · sealed {panel.verification.sealedAt} · policy{" "}
                  {panel.verification.policyVersion}
                </span>
                <Citation source={panel.verification.source} label="verification report artifact" />
              </div>
              <p className="mt-1 text-sm">{panel.verification.verdictReason}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                hash-binding match:{" "}
                <CitedValue
                  value={String(panel.verification.hashBinding.match)}
                  source={panel.verification.source}
                  label="hash-binding match"
                />
                <span className="ml-2 font-mono text-[11px]">
                  sealed {panel.verification.hashBinding.sealedCandidate.slice(0, 16)}… = checked{" "}
                  {panel.verification.hashBinding.checkedCandidate.slice(0, 16)}…
                </span>
              </p>
            </div>
          ) : null}
        </>
      )}
    </Section>
  )
}
