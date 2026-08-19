import { runs } from "./data.js?rev=20260819-3"
import { appHeader, badge, bindCommon, icon, inspector, runMeta, statusIcon } from "./shared.js?rev=20260819-3"

function proofStep(number, title, detail, inspect, tone = "success") {
  return `<button class="tb-proof-step" type="button" data-inspect="${inspect}" aria-pressed="false"><span class="tb-proof-index ${tone}">${number}</span><span><strong>${title}</strong><small>${detail}</small></span>${icon("chevron")}</button>`
}

function overview(run) {
  const blocked = run.key === "blocked"
  return `<section id="tb-panel-overview" class="tb-pane" role="tabpanel" aria-labelledby="tb-tab-overview">
    <div class="tb-decision-grid">
      <article class="panel tb-decision">
        <div class="panel-head"><h2>What happened</h2>${badge(blocked ? "Release blocked" : "Resolved", blocked ? "danger" : "success")}</div>
        <div class="panel-body">
          <dl class="tb-outcome-list">
            <div><dt>Impact</dt><dd>${run.impact}</dd></div>
            <div><dt>Accepted cause</dt><dd>${run.cause} <button class="vr-inline-link" type="button" data-inspect="hypothesis:H1" aria-pressed="false">Inspect H1</button></dd></div>
            <div><dt>Remediation</dt><dd>${run.remediation} <button class="vr-inline-link" type="button" data-inspect="pr:record" aria-pressed="false">Inspect change</button></dd></div>
            <div><dt>Production</dt><dd>${run.production} <button class="vr-inline-link" type="button" data-inspect="watch:run" aria-pressed="false">Inspect Release</button></dd></div>
          </dl>
        </div>
      </article>
      <article class="panel tb-next ${blocked ? "danger" : ""}">
        <div class="panel-body"><p class="eyebrow">Next step</p><h2>${run.nextStep}</h2><p>${blocked ? "Use the R1 finding and T5 counterexample as Evidence Set revision 2." : "The saved run is ready for review and export."}</p><button class="btn primary" type="button" data-inspect="${blocked ? "check:T5" : "watch:run"}" aria-pressed="false">${blocked ? "Inspect blocker" : "Review recovery proof"}</button></div>
      </article>
    </div>
    <article class="panel tb-proof-chain">
      <div class="panel-head"><div><h2>Proof chain</h2><p>Each conclusion opens the record that supports it.</p></div><span class="tiny muted">${run.events.length} journaled events</span></div>
      <div class="tb-proof-steps">
        ${proofStep("1", "Evidence joined", `${run.evidence.length} cited items`, "evidence:E2")}
        ${proofStep("2", "H1 accepted", "Prediction reproduced", "hypothesis:H1")}
        ${proofStep("3", blocked ? "Change blocked" : "Change reviewed", `${run.pr.number} · ${run.pr.checks}`, "pr:record", blocked ? "danger" : "success")}
        ${proofStep("4", blocked ? "Production unchanged" : "Recovery confirmed", blocked ? "No production Watch" : "Error ratio 1.00 → 0.00", "watch:run", blocked ? "neutral" : "success")}
      </div>
    </article>
    <div class="tb-summary-row">
      <button class="tb-summary-card" type="button" data-inspect="call:synthesizer" aria-pressed="false"><span>Fusion</span><strong>2 participants · Judge · Synthesizer</strong><small>Open Diagnose record</small></button>
      <button class="tb-summary-card" type="button" data-inspect="check:${blocked ? "T5" : "T13"}" aria-pressed="false"><span>Verification</span><strong>${blocked ? "19 passed · 2 failed" : "21 required checks passed"}</strong><small>Open check receipt</small></button>
      <button class="tb-summary-card" type="button" data-inspect="recovery:point" aria-pressed="false"><span>Recovery</span><strong>${run.recovery.status}</strong><small>${run.recovery.rollback}</small></button>
    </div>
  </section>`
}

function diagnosis(run) {
  return `<section id="tb-panel-diagnosis" class="tb-pane" role="tabpanel" aria-labelledby="tb-tab-diagnosis" hidden>
    <article class="panel">
      <div class="panel-head"><div><p class="eyebrow">Durable Diagnose output</p><h2>Synthesized Response</h2></div>${badge("H1 accepted", "success")}</div>
      <div class="panel-body"><p class="tb-synthesis">${run.fusion.calls.at(-1).output}</p><div class="tb-judge-grid"><div><span>Agreement</span><p>${run.fusion.agreement}</p></div><div><span>Ruled out</span><p>${run.fusion.ruledOut}</p></div><div><span>Open evidence</span><p>${run.fusion.openEvidence}</p></div></div></div>
    </article>
    <article class="panel">
      <div class="panel-head"><h2>Fusion calls</h2><span class="tiny muted">inspection only</span></div>
      <div class="tb-call-list">${run.fusion.calls.map((call) => `<button type="button" data-inspect="call:${call.id}" aria-pressed="false"><span>${icon(call.role === "Participant" ? "agent" : "activity")}<strong>${call.title}</strong><small>${call.role}</small></span><span class="vr-mono">${call.duration}</span>${icon("chevron")}</button>`).join("")}</div>
    </article>
    <article class="panel">
      <div class="panel-head"><h2>Evidence Set</h2><span class="tiny muted">revision ${run.key === "blocked" ? "2" : "1"}</span></div>
      <div class="vr-table-scroll"><table class="vr-table"><thead><tr><th>Item</th><th>Observation</th><th>Source</th><th></th></tr></thead><tbody>${run.evidence.map((item) => `<tr><td><span class="vr-kind">${item.kind}</span><strong>${item.title}</strong></td><td>${item.observation}</td><td>${item.source}<small>${item.observedAt}</small></td><td><button class="btn ghost" type="button" data-inspect="evidence:${item.id}" aria-pressed="false">Inspect</button></td></tr>`).join("")}</tbody></table></div>
    </article>
  </section>`
}

function remediation(run) {
  return `<section id="tb-panel-remediation" class="tb-pane" role="tabpanel" aria-labelledby="tb-tab-remediation" hidden>
    <article class="panel">
      <div class="panel-head"><div><p class="eyebrow">${run.repository}</p><h2>${run.pr.number} ${run.pr.title}</h2></div>${badge(run.pr.state, run.pr.tone)}</div>
      <div class="panel-body">
        <div class="tb-pr-meta"><span>${icon("git")} ${run.branch}</span><span>${run.headCommit}</span><span>${run.pr.reviews}</span><span>${run.pr.checks}</span></div>
        <p class="tb-synthesis">${run.remediation}</p>
        <div class="tb-files">${run.files.map((file) => `<button type="button" data-inspect="file:${file.id}" aria-pressed="false"><span>${icon("code")}<strong>${file.path}</strong></span><span class="vr-diff-count"><b>+${file.additions}</b> <i>−${file.deletions}</i></span>${icon("chevron")}</button>`).join("")}</div>
        <div class="tb-pr-actions"><button class="btn primary" type="button" data-inspect="pr:record" aria-pressed="false">Inspect source-host record</button><button class="btn" type="button" data-copy="${run.pr.url}">${icon("copy")} Copy PR link</button></div>
      </div>
    </article>
    <article class="panel">
      <div class="panel-head"><h2>Change-to-Hypothesis map</h2><span class="tiny muted">candidate-bound</span></div>
      <div class="panel-body"><div class="tb-citation-map"><div><strong>Known-card condition</strong><span>H1 · E2 · E4</span></div><div><strong>Valid-card regression</strong><span>H1 prediction · T3</span></div><div><strong>Invalid-card regression</strong><span>${run.key === "blocked" ? "R1 finding · T5 failure" : "H1 open evidence · T5"}</span></div></div></div>
    </article>
  </section>`
}

function verification(run) {
  const failed = run.checks.filter((check) => check.result === "failed")
  return `<section id="tb-panel-verification" class="tb-pane" role="tabpanel" aria-labelledby="tb-tab-verification" hidden>
    <article class="panel">
      <div class="panel-head"><div><p class="eyebrow">Candidate ${run.candidate.slice(-8)}</p><h2>${failed.length ? "Verification blocked Release" : "Verification passed"}</h2></div>${badge(failed.length ? `${failed.length} failed` : "21 passed", failed.length ? "danger" : "success")}</div>
      <div class="tb-check-groups">
        ${["Review", "Test"].map((kind) => `<section><h3>${kind}s</h3><div>${run.checks.filter((check) => check.kind === kind).map((check) => `<button type="button" data-inspect="check:${check.id}" aria-pressed="false">${statusIcon(check.result)}<span><strong>${check.id} · ${check.name}</strong><small>${check.tool} · ${check.duration}</small></span>${icon("chevron")}</button>`).join("")}</div></section>`).join("")}
      </div>
    </article>
    <article class="panel">
      <div class="panel-head"><h2>Release Gate</h2>${badge(run.gate.verdict, run.key === "verified" ? "success" : "neutral")}</div>
      <div class="tb-gate-facts">${run.gate.facts.map((fact) => `<button type="button" data-inspect="gate:${fact.id}" aria-pressed="false">${statusIcon(fact.result)}<span><strong>Fact ${fact.id}</strong><small>${fact.label}</small></span></button>`).join("")}</div>
    </article>
  </section>`
}

function render(active = "verified") {
  const run = runs[active]
  return `<div class="vr-shell traceable-brief vr-enter">
    ${appHeader(run, "tb")}
    <main id="workspace-main" class="vr-page">
      <div class="vr-breadcrumb"><span>Incidents</span>${icon("chevron")}<strong>${run.shortId}</strong></div>
      <section class="vr-hero compact">
        <div><div class="badges">${badge(run.state, run.stateTone)}${badge(run.severity, "danger")}${badge("Replay")}</div><h1>${run.title}</h1><p>${run.lead}</p></div>
        <div class="vr-hero-action"><span>Next step</span><strong>${run.nextStep}</strong><button class="vr-inline-link" type="button" data-inspect="${run.key === "blocked" ? "check:T5" : "watch:run"}" aria-pressed="false">Inspect record</button></div>
      </section>
      ${runMeta(run)}
      <div class="vr-tabs" role="tablist" aria-label="Incident records" data-tabs>
        <button id="tb-tab-overview" class="active" role="tab" type="button" aria-selected="true" aria-controls="tb-panel-overview" tabindex="0">Overview</button>
        <button id="tb-tab-diagnosis" role="tab" type="button" aria-selected="false" aria-controls="tb-panel-diagnosis" tabindex="-1">Diagnosis</button>
        <button id="tb-tab-remediation" role="tab" type="button" aria-selected="false" aria-controls="tb-panel-remediation" tabindex="-1">Remediation</button>
        <button id="tb-tab-verification" role="tab" type="button" aria-selected="false" aria-controls="tb-panel-verification" tabindex="-1">Verification</button>
      </div>
      <div class="tb-workspace"><div class="tb-panes">${overview(run)}${diagnosis(run)}${remediation(run)}${verification(run)}</div>${inspector(run, "run", "Evidence inspector")}</div>
    </main>
  </div>`
}

function bind(stage, active = "verified") {
  bindCommon(stage, traceableBrief, active)
}

export const traceableBrief = { render, bind }
