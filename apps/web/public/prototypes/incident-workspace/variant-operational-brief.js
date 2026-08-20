import { evidence, runs } from "./data.js?rev=20260819-2"
import { badge, bindCommon, errorChart, productMark, stageStrip } from "./shared.js?rev=20260819-2"

function incidentNavigator(active) {
  const items = Object.entries(runs).map(([key, incident]) => `
    <button class="ob-incident-option" type="button" ${key === active ? 'aria-current="page"' : ""} data-run-key="${key}" data-incident-search-value="${incident.shortId} ${incident.title} ${incident.state}">
      <span class="ob-incident-option-head"><strong>${incident.shortId}</strong>${badge(incident.state, incident.stateTone)}</span>
      <span>${incident.title}</span>
      <small>${incident.lead}</small>
    </button>`).join("")
  const current = runs[active]
  return `<details class="ob-incident-nav">
    <summary aria-label="Browse incidents"><span><small>Incident</small><strong>${current.shortId}</strong></span><span aria-hidden="true">⌄</span></summary>
    <div class="ob-incident-menu">
      <div class="ob-incident-menu-head"><div><p class="eyebrow">Workspace</p><h2 class="subhead">Incidents</h2></div><span class="badge neutral">2 saved</span></div>
      <label class="sr-only" for="ob-incident-search">Search incidents</label>
      <input id="ob-incident-search" class="search" type="search" placeholder="Search incidents" autocomplete="off" data-incident-search>
      <div class="ob-incident-options" aria-label="Saved incidents">${items}</div>
      <p class="ob-incident-empty" role="status" hidden>No incidents match this search.</p>
    </div>
  </details>`
}

function summaryPane(run, active) {
  const blocked = active === "blocked"
  return `<div class="ob-layout" data-tab-pane="summary">
    <div class="ob-main-stack">
      <section class="panel ob-decision-panel" aria-labelledby="decision-title">
        <div class="panel-head"><h2 id="decision-title">What the run decided</h2>${badge(run.outcome, run.outcomeTone)}</div>
        <div class="panel-body ob-decision-list">
          <div class="ob-decision-row"><span>Accepted cause</span><div><strong>${run.cause}</strong><button class="ob-text-link" type="button" data-open-tab="diagnosis">Review diagnosis</button></div></div>
          <div class="ob-decision-row"><span>Response</span><div><strong>${run.remediation}</strong><small>${blocked ? "Verification stopped it before Release." : "The change was released after approval."}</small></div></div>
        </div>
      </section>
      <section class="panel ob-proof" aria-labelledby="proof-title">
        <div class="panel-head"><h2 id="proof-title">${blocked ? "Why Release stopped" : "Recovery proof"}</h2><span class="tiny muted">${blocked ? "production unchanged" : "Watch complete"}</span></div>
        <div class="panel-body">
          ${blocked ? `<div class="ob-failure"><strong>${run.verificationTitle}</strong><p>${run.finding}</p></div>` : errorChart(run, "ob-summary")}
          <div class="ob-proof-stats">
            <div><span>Reviews</span><strong>${run.reviewPassed}/${run.reviewPassed + run.reviewFailed} passed</strong></div>
            <div><span>Tests</span><strong>${run.testPassed}/${run.testPassed + run.testFailed} passed</strong></div>
            <div><span>${blocked ? "Release" : "Error ratio"}</span><strong>${blocked ? "Not started" : `${run.errorBefore} → ${run.errorAfter}`}</strong></div>
          </div>
        </div>
      </section>
    </div>
    <aside class="ob-aside">
      <div class="ob-callout"><p class="eyebrow">Gate</p><h3>${run.gate}</h3><p>${run.gateDetail}</p><button class="btn" type="button" data-open-tab="verification">Review verification</button></div>
      <div class="ob-callout"><p class="eyebrow">Recovery</p><h3>${run.recovery}</h3><p>Recovery Point recorded. T12 restore drill passed.</p><button class="btn" type="button" data-drawer="rollback">Inspect rollback path</button></div>
    </aside>
  </div>`
}

function diagnosisPane(run) {
  return `<div class="ob-layout" data-tab-pane="diagnosis" hidden><section class="panel"><div class="panel-head"><h2>Accepted diagnosis</h2>${badge("H1 accepted", "success")}</div><div class="panel-body"><p class="ob-diagnosis-lead">${run.cause}</p><div class="ob-judge-grid"><div><span>Agreement</span><p>${run.fusionAgreement}</p></div><div><span>Ruled out</span><p>${run.fusionRuledOut}</p></div><div><span>Open evidence</span><p>${run.fusionGap}</p></div></div><div class="ob-evidence-head"><h3>Evidence Set</h3><span class="tiny muted">4 cited items</span></div><div class="ob-table-wrap"><table class="data-table"><thead><tr><th>Kind</th><th>Item</th><th>Observation</th><th>Backend</th></tr></thead><tbody>${evidence.map(([kind,name,value,backend]) => `<tr><td>${kind}</td><td><strong>${name}</strong></td><td>${value}</td><td>${backend}</td></tr>`).join("")}</tbody></table></div></div></section><aside class="ob-aside"><div class="ob-callout"><p class="eyebrow">Fusion</p><h3>Judge and synthesis complete</h3><dl class="ob-mini-facts"><div><dt>Participants</dt><dd>2 independent</dd></div><div><dt>Judge</dt><dd>Compared outputs</dd></div><div><dt>Synthesis</dt><dd>Ranked H1 first</dd></div></dl></div><button class="btn primary" type="button" data-drawer="evidence">Inspect Evidence Set</button></aside></div>`
}

function remediationPane(run) {
  const released = run === runs.verified
  return `<div class="ob-layout" data-tab-pane="remediation" hidden>
    <section class="panel">
      <div class="panel-head"><h2>Remediation decision</h2>${badge(released ? "Released" : "Not released", released ? "success" : "danger")}</div>
      <div class="panel-body"><dl class="fact-list">
        <div class="fact"><dt>Recorded action</dt><dd>${run.remediation}</dd></div>
        <div class="fact"><dt>Why this action</dt><dd>${run.cause}</dd></div>
        <div class="fact"><dt>Scope</dt><dd>Payment service in the demo environment</dd></div>
        <div class="fact"><dt>Result</dt><dd>${released ? "Released after all required checks passed." : "Stopped at Verify. Production was not changed."}</dd></div>
        <div class="fact"><dt>Recovery</dt><dd>Recovery Point recorded. T12 restore drill passed.</dd></div>
      </dl></div>
    </section>
    <aside class="ob-aside">
      <div class="ob-callout ${run.finding ? "danger" : ""}"><p class="eyebrow">Verification</p><h3>${run.verificationTitle}</h3><p>${run.verify}</p></div>
      <div class="ob-callout"><p class="eyebrow">Gate</p><h3>${run.gate}</h3><p>${run.gateDetail}</p></div>
      <button class="btn" type="button" data-open-tab="verification">Review verification</button>
    </aside>
  </div>`
}

function verificationPane(run, active) {
  const blocked = active === "blocked"
  return `<div class="ob-layout" data-tab-pane="verification" hidden><section class="panel"><div class="panel-head"><h2>Verification outcome</h2>${badge(blocked ? "Failed" : "Passed", blocked ? "danger" : "success")}</div><div class="panel-body"><div class="ob-verification-lead"><p class="eyebrow">${blocked ? "Release blocked" : "Release verified"}</p><h3>${run.verificationTitle}</h3><p>${run.verify}</p></div>${run.finding ? `<div class="finding"><strong>Blocking evidence</strong><br>${run.finding}</div>` : ""}<div class="ob-proof-stats"><div><span>Reviews</span><strong>${run.reviewPassed} passed${run.reviewFailed ? `, ${run.reviewFailed} failed` : ""}</strong></div><div><span>Tests</span><strong>${run.testPassed} passed${run.testFailed ? `, ${run.testFailed} failed` : ""}</strong></div><div><span>Release Gate</span><strong>${blocked ? "Not reached" : "Passed"}</strong></div></div>${blocked ? `<div class="ob-no-watch"><strong>No production Watch</strong><span>The run ended at Verify. No candidate entered production.</span></div>` : `<div class="ob-watch-head"><h3>Watch evidence</h3><button class="btn ghost" type="button" data-drawer="evidence">Open in Grafana</button></div>${errorChart(run, "ob-verify")}`}</div></section><aside class="ob-aside"><div class="ob-callout"><p class="eyebrow">Production</p><h3>${run.production}</h3><p>${run.release}</p></div><div class="ob-callout"><p class="eyebrow">Recovery</p><h3>${run.recovery}</h3><p>Recovery Point recorded. T12 restore drill passed.</p></div><button class="btn primary" type="button" data-drawer="verify">See all checks</button></aside></div>`
}

function render(active = "verified") {
  const run = runs[active]
  return `<div class="shell ob" data-run="${active}">
    <a class="skip-link" href="#ob-main">Skip to incident</a>
    <header class="ob-header"><div class="ob-header-start">${productMark()}<nav aria-label="Primary"><button type="button" data-context-nav>Incidents</button><button type="button" data-context-nav>Policies</button><button type="button" data-context-nav>Audit</button></nav></div>${incidentNavigator(active)}</header>
    <main id="ob-main" class="ob-wrap">
      <p class="ob-breadcrumb">${run.shortId} / payment / demo</p>
      <section class="ob-hero enter">
        <div><div class="badges">${badge(run.state, run.stateTone)}${badge("Severity " + run.severity, "danger")}${badge("Saved Demo Run")}</div><h1 class="title">${run.title}</h1><p class="ob-lead">${run.lead}</p></div>
        <aside class="ob-next ${active === "blocked" ? "danger" : ""}"><p class="eyebrow">Next step</p><h2>${run.nextStep}</h2><p>${run.nextDetail}</p><button class="ob-text-link" type="button" data-open-tab="verification">${active === "blocked" ? "Review failed check" : "Review verification"}</button></aside>
      </section>
      <section class="ob-facts enter delay-1" aria-label="Incident summary"><div><span>Impact</span><strong>${run.impact}</strong></div><div><span>Accepted cause</span><strong>Card-type branch inversion</strong></div><div><span>Production</span><strong>${run.production}</strong></div></section>
      <section class="ob-stage enter delay-1"><div class="ob-stage-head"><div><h2 class="subhead">Run progress</h2><span class="tiny muted">Attempt 1 of 3</span></div><button class="btn ghost" type="button" data-drawer="run">Run details</button></div>${stageStrip(run)}</section>
      <div class="ob-tabs" role="tablist" aria-label="Incident detail"><button id="tab-summary" class="ob-tab active" role="tab" aria-selected="true" aria-controls="panel-summary" tabindex="0" type="button" data-tab="summary">Summary</button><button id="tab-diagnosis" class="ob-tab" role="tab" aria-selected="false" aria-controls="panel-diagnosis" tabindex="-1" type="button" data-tab="diagnosis">Diagnosis</button><button id="tab-remediation" class="ob-tab" role="tab" aria-selected="false" aria-controls="panel-remediation" tabindex="-1" type="button" data-tab="remediation">Remediation</button><button id="tab-verification" class="ob-tab" role="tab" aria-selected="false" aria-controls="panel-verification" tabindex="-1" type="button" data-tab="verification">Verification</button></div>
      <div class="enter delay-2">${summaryPane(run, active)}${diagnosisPane(run)}${remediationPane(run)}${verificationPane(run, active)}</div>
    </main>
  </div>`
}

function bind(stage, active = "verified") {
  bindCommon(stage, operationalBrief, active)
  const incidentNav = stage.querySelector(".ob-incident-nav")
  const incidentSearch = stage.querySelector("[data-incident-search]")
  const incidentOptions = [...stage.querySelectorAll("[data-incident-search-value]")]
  const incidentEmpty = stage.querySelector(".ob-incident-empty")
  incidentSearch?.addEventListener("input", () => {
    const query = incidentSearch.value.trim().toLowerCase()
    let visible = 0
    incidentOptions.forEach((option) => {
      const matches = option.dataset.incidentSearchValue.toLowerCase().includes(query)
      option.hidden = !matches
      if (matches) visible += 1
    })
    incidentEmpty.hidden = visible !== 0
  })
  incidentNav?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !incidentNav.open) return
    event.preventDefault()
    incidentNav.open = false
    incidentNav.querySelector("summary")?.focus()
  })
  const tabs = [...stage.querySelectorAll("[data-tab]")]
  const panes = [...stage.querySelectorAll("[data-tab-pane]")]
  panes.forEach((pane) => {
    pane.id = `panel-${pane.dataset.tabPane}`
    pane.setAttribute("role", "tabpanel")
    pane.setAttribute("aria-labelledby", `tab-${pane.dataset.tabPane}`)
  })
  const activate = (button) => {
    tabs.forEach((tab) => {
      const selected = tab === button
      tab.classList.toggle("active", selected)
      tab.setAttribute("aria-selected", String(selected))
      tab.tabIndex = selected ? 0 : -1
    })
    stage.querySelectorAll("[data-tab-pane]").forEach((pane) => { pane.hidden = pane.dataset.tabPane !== button.dataset.tab })
  }
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => activate(button))
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length
      activate(tabs[next])
      tabs[next].focus()
    })
  })
  stage.querySelectorAll("[data-open-tab]").forEach((button) => button.addEventListener("click", () => {
    const tab = tabs.find((candidate) => candidate.dataset.tab === button.dataset.openTab)
    if (!tab) return
    activate(tab)
    tab.focus()
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    tab.scrollIntoView({ behavior, block: "nearest" })
  }))
}

export const operationalBrief = { render, bind }
