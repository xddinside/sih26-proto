import { runs } from "./data.js?rev=20260819-2"
import { badge, bindCommon, productMark, runSwitch } from "./shared.js?rev=20260819-2"

function card(title, text, drawer, style = "") {
  return `<article class="rl-card ${style}"><h3>${title}</h3><p>${text}</p>${drawer ? `<button type="button" class="btn ghost" data-drawer="${drawer}">Inspect</button>` : ""}</article>`
}

function render(active = "verified") {
  const run = runs[active]
  const blocked = active === "blocked"
  const columns = [
    ["Detect", "Completed", "success", card("Trigger", "Payment error ratio 1.00 exceeded the 0.20 threshold.", "evidence") + card("Intake snapshot", "Prometheus, trace, deployment, and flag state were pinned.", "evidence")],
    ["Diagnose", "Completed", "success", card("H1 accepted", "The validateCard card-type clause dropped its negation.", "evidence") + card("Judge comparison", "Agreements, contradictions, blind spots, and citation audit recorded.", "evidence") + card("Synthesizer", "Ranked four Hypotheses and proposed a discriminating test.", "evidence")],
    ["Repair", "Completed", "success", card("Code remediation", "Restore one negation in src/payment/card.js.", "remediation") + card("Recovery Point", "Code and compose service state recorded before mutation.", "rollback")],
    ["Verify", blocked ? "Failed" : "Completed", blocked ? "danger" : "success", card("Reviews", blocked ? "R1 failed. Four other required reviews passed." : "Five required reviews passed.", "verify", blocked ? "fail" : "") + card("Tests", blocked ? "T5 failed. Nine other applicable tests passed." : "Ten applicable tests passed.", "verify", blocked ? "fail" : "") + (blocked ? card("Major finding", "Missing Luhn guard became reachable. Candidate stayed sealed.", "verify", "fail") : card("Verdict", "Hash binding matched and the verdict was pass.", "verify"))],
    ["Release", blocked ? "Not reached" : "Completed", blocked ? "neutral" : "success", blocked ? card("No change released", "Run ended verification-failed before a release request existed.", null, "skip") : card("Release Gate", "Passed after the recorded operator approval.", "run") + card("Service swap", "Candidate image became the live payment service.", "run")],
    ["Watch", blocked ? "Not reached" : "Completed", blocked ? "neutral" : "success", blocked ? card("No production Watch", "T13 rehearsed the plan in isolation. Production Watch never ran.", null, "skip") : card("Stage 1", "Candidate error ratio 0.00. Probe ring passed.", "evidence") + card("Stage 2", "Three consecutive windows passed at full traffic.", "evidence") + card("Confirmation", "Error ratio 0.00. Incident closed.", "evidence")],
  ]
  return `<div class="shell rl" data-run="${active}">
    <a class="skip-link" href="#rl-main">Skip to incident</a>
    <header class="rl-header"><div>${productMark()}</div><div class="rl-header-center"><strong class="small">${run.shortId}</strong><span class="small muted"> · ${run.title}</span></div>${runSwitch(active)}</header>
    <main id="rl-main" class="rl-board">
      <section class="rl-overview enter" aria-label="Incident summary"><div class="lead"><div style="display:flex;gap:6px;flex-wrap:wrap">${badge(run.state, run.stateTone)}${badge(run.outcome, run.outcomeTone)}</div><h1 class="subhead" style="margin-top:8px">${run.title}</h1><p>${run.summary}</p></div><div class="metric"><span>Severity</span><strong>${run.severity}</strong><span>payment · demo</span></div><div class="metric"><span>Accepted</span><strong>H1</strong><span>card-type clause</span></div><div class="metric"><span>Checks</span><strong>${run.testPassed + run.reviewPassed}/${run.testPassed + run.testFailed + run.reviewPassed + run.reviewFailed}</strong><span>passed</span></div><div class="metric"><span>Human action</span><strong style="font-size:14px">${run.human}</strong><span>attempt 1 of 3</span></div></section>
      <section class="rl-columns enter delay-1" aria-label="Incident Run ledger">${columns.map(([name,status,tone,cards]) => `<section class="rl-column"><header class="rl-column-head"><div class="row"><h2 class="subhead">${name}</h2>${badge(status,tone)}</div><p>${name === "Verify" && blocked ? "Stopped safely" : "Saved stage records"}</p></header>${cards}</section>`).join("")}</section>
    </main>
    <div class="evidence-peek"><span><strong>Evidence drawer</strong><br><span class="muted">4 cited items · revision 1</span></span><button type="button" class="btn" data-drawer="evidence">Open</button><button type="button" class="btn" data-drawer="rollback">Rollback path</button></div>
  </div>`
}

function bind(stage, active = "verified") {
  bindCommon(stage, runLedger, active)
}

export const runLedger = { render, bind }
