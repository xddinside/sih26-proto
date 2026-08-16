/**
 * Panel 16 — Telemetry deep links: backend link templates resolved with the
 * recorded parameters (Prometheus graph query, Jaeger trace, Grafana/OpenSearch
 * log view, Git blob/commit, flagd receipt). Links are navigation aids only —
 * read-only, no live calls, and a link is marked expired when backend
 * retention passed. The saved snapshot always stays the durable copy.
 */
import { Citation } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { BACKEND_LABELS } from "../../constants"
import { MonoCell, TableHead, TableRegion } from "../workspace-primitives"
import type { TelemetryLinkView } from "../../lib/workspace-projection"

export function TelemetryPanel({ links }: { links: TelemetryLinkView[] }) {
  return (
    <Section
      id="workspace-telemetry"
      title="Telemetry deep links"
      description="navigation aids to the company backends; the presentation never queries a live backend and never depends on one"
    >
      {links.length === 0 ? (
        <EmptyState title="No deep links" description="this saved run records no telemetry links" />
      ) : (
        <TableRegion label="Telemetry deep links" minWidth="min-w-[44rem]">
          <TableHead columns={["Owner", "Backend", "Kind", "Link", "State"]} />
          <tbody>
            {links.map((link, index) => (
              <tr key={`${link.owner}-${index}`} className="border-b border-border/60">
                <td className="px-2 py-2 text-xs">{link.owner}</td>
                <MonoCell>{BACKEND_LABELS[link.backend] ?? link.backend}</MonoCell>
                <MonoCell>{link.kind}</MonoCell>
                <td className="px-2 py-2">
                  <a
                    href={link.uri}
                    className="break-all font-mono text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {link.uri}
                  </a>
                  <span className="ml-2">
                    <Citation source={link.source} label="link source" />
                  </span>
                </td>
                <td className="px-2 py-2">
                  {link.expired ? <StatePill tone="warning">expired</StatePill> : <StatePill tone="info">saved snapshot</StatePill>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        the Workspace is not a monitoring dashboard: raw Signals stay in the company backends, and every link marks its saved
        snapshot state. An expired link is marked, never silently dropped.
      </p>
    </Section>
  )
}
