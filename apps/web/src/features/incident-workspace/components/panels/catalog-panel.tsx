/**
 * Pitch-only panel — Full R1–R9 / T1–T13 catalog: the complete review-role and
 * test-layer matrix from docs/research/review-verification.md as fixed
 * documentation. The demo builds only the subset the two saved runs exercise;
 * the panel marks which roles and layers the saved runs demonstrate.
 */
import { Section } from "../../../incidents/components/section"
import { StatePill } from "../../../incidents/components/badge"
import { REVIEW_CATALOG, TEST_CATALOG } from "../../constants"
import { MonoCell, TableHead, TableRegion } from "../workspace-primitives"

export function CatalogPanel() {
  return (
    <Section
      id="workspace-catalog"
      title="Full review and test catalog — Solution Contract"
      description="the complete nine-role / thirteen-layer matrix; the saved runs demonstrate only the subset marked 'in the saved runs'"
    >
      <StatePill tone="warning">proposed product scope</StatePill>
      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Review roles R1–R9</p>
        <TableRegion label="Review role catalog" minWidth="min-w-[44rem]">
          <TableHead columns={["Role", "Name", "Purpose", "Saved runs"]} />
          <tbody>
            {REVIEW_CATALOG.map((row) => (
              <tr key={row.code} className="border-b border-border/60">
                <MonoCell>{row.code}</MonoCell>
                <td className="px-2 py-2 text-xs font-medium">{row.role}</td>
                <td className="px-2 py-2 text-xs">{row.purpose}</td>
                <td className="px-2 py-2">
                  {row.demoBuilt ? (
                    <StatePill tone="positive">in the saved runs</StatePill>
                  ) : (
                    <StatePill tone="neutral">contract only</StatePill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      </div>
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Test layers T1–T13</p>
        <TableRegion label="Test layer catalog" minWidth="min-w-[44rem]">
          <TableHead columns={["Layer", "Name", "Purpose", "Saved runs"]} />
          <tbody>
            {TEST_CATALOG.map((row) => (
              <tr key={row.code} className="border-b border-border/60">
                <MonoCell>{row.code}</MonoCell>
                <td className="px-2 py-2 text-xs font-medium">{row.layer}</td>
                <td className="px-2 py-2 text-xs">{row.purpose}</td>
                <td className="px-2 py-2">
                  {row.demoBuilt ? (
                    <StatePill tone="positive">in the saved runs</StatePill>
                  ) : (
                    <StatePill tone="neutral">contract only</StatePill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        the demo runs exercise R1, R2, R3, R4, R8 and T1–T5, T7, T9, T10, T12, T13; the rest stay Solution Contract scope. Neither
        saved run demonstrates rollback — that path and the Emergency allow-list remain documented contract, not demo proof.
      </p>
    </Section>
  )
}
