/**
 * Panel 4 — Evidence Set and receipts: items grouped by revision, with
 * provenance, trust class, joins, redaction marks, freshness, and outcome.
 * Worker-derived restatements never appear here.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { BACKEND_LABELS } from "../../constants"
import { FieldRow, GapNote, MonoCell, RedactionMark, TableHead, TableRegion } from "../workspace-primitives"
import type { EvidenceItemView, EvidencePanelView } from "../../lib/workspace-projection"

function ItemSnapshot({ item }: { item: EvidenceItemView }) {
  const snapshot = item.snapshot
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return <span className="font-mono text-xs">{JSON.stringify(snapshot)}</span>
  }
  return (
    <dl>
      {Object.entries(snapshot as Record<string, unknown>).map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-1.5 text-xs">
          <dt className="shrink-0 font-mono text-muted-foreground">{key}</dt>
          <dd className="min-w-0 break-all font-mono">
            {value === "[REDACTED]" ? (
              <>
                [REDACTED] <RedactionMark profileId={item.redactionProfileId} />
              </>
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function EvidenceItemRow({ item, incidentId }: { item: EvidenceItemView; incidentId: string }) {
  const outcomeTone = item.outcome === "ok" ? "positive" : item.outcome === "quarantined" ? "negative" : "warning"
  return (
    <li className="border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold" title={item.id}>
          {item.id.slice(0, 16)}…
        </span>
        <StatePill tone="info">{item.kind}</StatePill>
        <StatePill tone="neutral">{BACKEND_LABELS[item.backend] ?? item.backend}</StatePill>
        <StatePill tone="neutral">trust {item.trust}</StatePill>
        <StatePill tone={outcomeTone}>{item.outcome}</StatePill>
        <Citation source={{ kind: "artifact", ref: item.id, schemaId: "evidence-item" }} label="evidence item hash" />
      </div>
      <dl className="mt-2">
        {item.query !== null ? (
          <FieldRow label="Query">
            <span className="font-mono text-xs">{item.query}</span>
          </FieldRow>
        ) : null}
        <FieldRow label="Snapshot">
          <ItemSnapshot item={item} />
        </FieldRow>
        <FieldRow label="Joins">
          {item.joins.length === 0 ? (
            <GapNote>no recorded joins</GapNote>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {item.joins.map((join) => `${join.key}=${join.value}`).join(" · ")}
            </span>
          )}
        </FieldRow>
        <FieldRow label="Freshness">
          <span className="text-xs text-muted-foreground">
            observed {item.observedAt} · fresh until {item.freshUntil ?? "unrecorded"}
          </span>
          {item.freshUntil === null ? <GapNote>no freshness bound recorded</GapNote> : null}
        </FieldRow>
        <FieldRow label="Provenance">
          <span className="font-mono text-xs text-muted-foreground">{item.provenance.join(" -> ")}</span>
        </FieldRow>
      </dl>
      <ul className="mt-2">
        {item.links.map((link, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2 py-0.5 text-sm">
            <a href={link.uri} className="text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {link.uri}
            </a>
            {link.expired ? <StatePill tone="warning">link expired</StatePill> : null}
          </li>
        ))}
      </ul>
      {item.supersedes.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">supersedes {item.supersedes.map((id) => id.slice(0, 12)).join(", ")}</p>
      ) : null}
      {item.contradicts.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">contradicts {item.contradicts.map((id) => id.slice(0, 12)).join(", ")}</p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        saved snapshot is the durable copy for {incidentId}; links are navigation aids
      </p>
    </li>
  )
}

export function EvidencePanel({
  evidence,
  incidentId,
}: {
  evidence: EvidencePanelView | null
  incidentId: string
}) {
  return (
    <Section
      id="workspace-evidence"
      title="Evidence Set and receipts"
      description="append-only, revision-hashed items with provenance chains and trust classes; worker-derived restatements are never items"
    >
      {evidence === null || evidence.revision === null ? (
        <EmptyState title="No Evidence Set" description="this saved run sealed no evidence-set artifact" />
      ) : (
        <>
          <div className="mb-3">
            <p className="text-sm">
              revision{" "}
              <CitedValue
                value={String(evidence.revision.revisionNumber)}
                source={evidence.revision.source}
                label="evidence revision"
              />
              <span className="ml-2 font-mono text-xs text-muted-foreground">{evidence.revision.revisionId}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                pinned {evidence.revision.pinnedAt} · {evidence.revision.itemCount} items
              </span>
            </p>
            {evidence.revisions.length > 1 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                revisions:{" "}
                {evidence.revisions
                  .map((revision) => `r${revision.revisionNumber} (${revision.itemCount} items)`)
                  .join(" → ")}
              </p>
            ) : null}
          </div>
          <TableRegion
            label="Evidence Set revision history"
            minWidth="min-w-[36rem]"
            summary="revision history of the sealed Evidence Set"
          >
            <TableHead columns={["Revision", "Revision id", "Pinned at", "Items"]} />
            <tbody>
              {evidence.revisions.map((revision) => (
                <tr key={revision.contentHash} className="border-b border-border/60">
                  <MonoCell>r{revision.revisionNumber}</MonoCell>
                  <MonoCell>{revision.revisionId}</MonoCell>
                  <MonoCell>{revision.pinnedAt}</MonoCell>
                  <MonoCell>{revision.itemCount}</MonoCell>
                </tr>
              ))}
            </tbody>
          </TableRegion>
          <ul className="mt-4 space-y-3">
            {evidence.items.map((item) => (
              <EvidenceItemRow key={item.id} item={item} incidentId={incidentId} />
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}
