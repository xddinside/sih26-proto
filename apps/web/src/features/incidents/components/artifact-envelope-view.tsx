/**
 * Authorized, redacted artifact viewer: renders the sealed artifact envelope's
 * schema-version and integrity banner, provenance, redaction metadata, and the
 * redacted structured payload. It never exposes unfiltered object-store bytes.
 */
import { Link } from "@tanstack/react-router"

import type { ArtifactView } from "../lib/projections"
import { formatTimestamp } from "../lib/format"
import { StatePill } from "./badge"
import { Citation } from "./citation"
import { ProvenanceStrip } from "./provenance"
import { KeyValue, Section } from "./section"

export function ArtifactEnvelopeView({ view, incidentId }: { view: ArtifactView; incidentId: string }) {
  const payloadText = JSON.stringify(view.payload, null, 2)
  return (
    <main className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
          <Link to="/" className="hover:underline">Incidents</Link>
          <span aria-hidden="true"> / </span>
          <Link to="/incidents/$id" params={{ id: incidentId }} className="hover:underline">{incidentId}</Link>
          <span aria-hidden="true"> / </span>
          <span className="text-foreground">artifacts</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-xl font-semibold">{view.schemaId}</h1>
          <StatePill tone="info">schema v{view.schemaVersion}</StatePill>
        </div>
      </header>

      <Section id="integrity" title="Integrity banner" description="content hash and schema version bind this sealed artifact">
        <dl>
          <KeyValue label="Content hash">
            <span className="font-mono text-xs break-all">{view.contentHash}</span>{" "}
            <Citation source={{ kind: "artifact", ref: view.contentHash, schemaId: view.schemaId }} label="content hash" />
          </KeyValue>
          <KeyValue label="Schema">{view.schemaId} v{view.schemaVersion}</KeyValue>
          <KeyValue label="Sealed at">{formatTimestamp(view.sealedAt)}</KeyValue>
          <KeyValue label="Bundle path"><span className="font-mono text-xs break-all">{view.path}</span></KeyValue>
          {view.runId !== null ? <KeyValue label="Run">{view.runId}</KeyValue> : null}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          This viewer renders the authorized, redacted envelope. Unfiltered object-store bytes are
          never exposed.
        </p>
      </Section>

      <Section id="provenance" title="Provenance">
        <ProvenanceStrip
          facts={[
            { label: "skill", value: view.producer.skill },
            { label: "skill_version", value: view.producer.skillVersion },
            { label: "tool", value: view.producer.tool },
            { label: "tool_version", value: view.producer.toolVersion },
            { label: "tool_catalog", value: view.producer.toolCatalogVersion },
            { label: "resolver", value: view.producer.resolverVersion },
          ]}
        />
        {view.provenance.length > 0 ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">{view.provenance.join(" → ")}</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">no provenance chain recorded</p>
        )}
      </Section>

      <Section id="redaction" title="Redaction" description="masked fields are JSON Pointers that resolve to the literal redaction marker">
        {view.redaction === null ? (
          <p className="text-sm text-muted-foreground">no redaction metadata recorded</p>
        ) : (
          <div className="space-y-2">
            <KeyValue label="Profile">{view.redaction.profileId}</KeyValue>
            <KeyValue label="Masked fields">
              {view.redaction.maskedFields.length === 0 ? (
                <span className="text-muted-foreground">none</span>
              ) : (
                <ul className="space-y-0.5">
                  {view.redaction.maskedFields.map((field) => (
                    <li key={field} className="font-mono text-xs">{field}</li>
                  ))}
                </ul>
              )}
            </KeyValue>
          </div>
        )}
      </Section>

      <Section id="payload" title="Structured payload" description="the redacted, content-hashed structured payload">
        <pre className="overflow-x-auto bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre">
          <code>{payloadText}</code>
        </pre>
      </Section>
    </main>
  )
}
