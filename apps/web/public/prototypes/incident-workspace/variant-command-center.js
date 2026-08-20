import { runs } from "./data.js?rev=20260819-2"
import { badge, bindCommon, errorChart, productMark, runSwitch, stageStrip } from "./shared.js?rev=20260819-2"

function render(active = "verified") {
  const run = runs[active]
  return `<div class="shell cc" data-run="${active}">
    <a class="skip-link" href="#cc-main">Skip to incident</a>
    <aside class="cc-global">
      ${productMark()}
      <nav class="cc-nav" aria-label="Primary">
        <button class="active" type="button" data-context-nav><span>Incidents</span><span class="cc-count">2</span></button>
        <button type="button" data-context-nav><span>Services</span><span class="cc-count">12</span></button>
        <button type="button" data-context-nav><span>Policies</span><span class="cc-count">3</span></button>
        <button type="button" data-context-nav><span>Audit</span><span class="cc-count">91</span></button>
      </nav>
    </aside>
    <aside class="cc-list">
      <div class="cc-list-head"><div><p class="eyebrow">Workspace</p><p class="subhead">Incidents</p></div><label class="sr-only" for="incident-search">Search incidents</label><input id="incident-search" class="search" type="search" placeholder="Search incidents"></div>
      <button type="button" class="incident-row ${active === "verified" ? "active" : ""}" data-run-key="verified">
        <div class="incident-row-top"><strong class="small">${runs.verified.shortId}</strong>${badge(runs.verified.state, "success")}</div><strong class="body-sm">${runs.verified.title}</strong><p>payment · verified remediation</p>
      </button>
      <button type="button" class="incident-row ${active === "blocked" ? "active" : ""}" data-run-key="blocked">
        <div class="incident-row-top"><strong class="small">${runs.blocked.shortId}</strong>${badge(runs.blocked.state, "warning")}</div><strong class="body-sm">${runs.blocked.title}</strong><p>payment · blocked safely</p>
      </button>
      <p class="search-empty" role="status" hidden>No incidents match this search.</p>
    </aside>
    <main id="cc-main" class="cc-main">
      <header class="cc-topbar"><p class="small muted">Incidents / ${run.shortId}</p>${runSwitch(active)}</header>
      <div class="cc-content">
        <div class="cc-hero enter">
          <div><div class="badges">${badge(run.state, run.stateTone)}${badge("Severity " + run.severity, "danger")}${badge("Saved Demo Run")}</div><h1 class="title">${run.title}</h1><p class="body-sm muted" style="margin-top:9px">payment service · demo environment · attempt 1 of 3</p></div>
          <div class="hero-actions"><button class="btn" type="button" data-drawer="run">View run details</button><button class="btn" type="button" data-drawer="rollback">View rollback path</button></div>
        </div>
        <section class="summary-band enter delay-1" aria-label="Incident summary">
          <div><p class="eyebrow">Current outcome</p><div style="margin:7px 0">${badge(run.outcome, run.outcomeTone)}</div><p>${run.summary}</p></div>
          <div class="metric"><span>Accepted</span><strong>H1</strong><span>card-type clause</span></div>
          <div class="metric"><span>Verification</span><strong>${run.testPassed + run.reviewPassed}/${run.testPassed + run.testFailed + run.reviewPassed + run.reviewFailed}</strong><span>checks passed</span></div>
          <div class="metric"><span>Operator</span><strong style="font-size:14px">${run.human}</strong><span>${active === "verified" ? "Incident closed" : "2 attempts remain"}</span></div>
        </section>
        <section class="panel enter delay-2" style="margin-top:18px"><div class="panel-head"><h2 class="subhead">Incident Run</h2><span class="tiny muted">attempt 1</span></div><div class="panel-body">${stageStrip(run)}</div></section>
        <div class="cc-grid">
          <section class="panel"><div class="panel-head"><h2 class="subhead">Service recovery</h2><button class="btn ghost" type="button" data-drawer="evidence">View Evidence Set</button></div><div class="panel-body">${errorChart(run, "cc")} ${run.finding ? `<div class="finding"><strong>Verification stopped Release</strong><br>${run.finding}</div>` : ""}</div></section>
          <section class="panel"><div class="panel-head"><h2 class="subhead">Decision record</h2></div><div class="panel-body"><dl class="fact-list"><div class="fact"><dt>What happened</dt><dd>${run.happened}</dd></div><div class="fact"><dt>Accepted Hypothesis</dt><dd>${run.hypothesis}</dd></div><div class="fact"><dt>Remediation</dt><dd>${run.remediation}</dd></div><div class="fact"><dt>Release</dt><dd>${run.release}</dd></div></dl><div style="display:flex;gap:8px;margin-top:12px"><button class="btn" type="button" data-drawer="remediation">View change</button><button class="btn" type="button" data-drawer="verify">View verification</button></div></div></section>
        </div>
      </div>
    </main>
  </div>`
}

function bind(stage, active = "verified") {
  bindCommon(stage, commandCenter, active)
  const search = stage.querySelector(".search")
  search?.addEventListener("input", () => {
    const query = search.value.toLowerCase()
    let matches = 0
    stage.querySelectorAll(".incident-row").forEach((row) => {
      const match = row.textContent.toLowerCase().includes(query)
      row.hidden = !match
      row.classList.toggle("search-match", match && query.length > 0)
      if (match) matches += 1
    })
    stage.querySelector(".search-empty").hidden = matches !== 0
  })
}

export const commandCenter = { render, bind }
