import { runs } from "./data.js?rev=20260819-5"
import { appHeader, badge, bindCommon, icon, inspector, runMeta, statusIcon } from "./shared.js?rev=20260819-5"

function diffRows(file) {
  return file.diff.map((row) => `<div class="cr-code-line ${row.type}"><span>${row.line}</span><code>${row.text}</code></div>`).join("")
}

function summary(run) {
  return `<section id="cr-panel-summary" class="cr-pane" role="tabpanel" aria-labelledby="cr-tab-summary">
    <div class="cr-summary-grid">
      <article class="panel"><div class="panel-head"><h2>Change summary</h2>${badge(run.pr.state, run.pr.tone)}</div><div class="panel-body"><p class="cr-change-copy">${run.remediation}</p><dl class="vr-dl"><div><dt>Accepted Hypothesis</dt><dd><button type="button" data-inspect="hypothesis:H1" aria-pressed="false">H1 · Card-type branch inversion ${icon("chevron")}</button></dd></div><div><dt>Candidate</dt><dd class="vr-mono">${run.candidate.slice(-8)}</dd></div><div><dt>Changed files</dt><dd>${run.files.length} files · +${run.files.reduce((sum, file) => sum + file.additions, 0)} −${run.files.reduce((sum, file) => sum + file.deletions, 0)}</dd></div><div><dt>Blast radius</dt><dd>payment service · demo environment</dd></div><div><dt>Recovery</dt><dd><button type="button" data-inspect="recovery:point" aria-pressed="false">${run.recovery.id} · ${run.recovery.status} ${icon("chevron")}</button></dd></div></dl></div></article>
      <article class="panel"><div class="panel-head"><h2>Review state</h2></div><div class="vr-stat-row"><div>${statusIcon(run.key === "blocked" ? "failed" : "passed")}<span><strong>${run.pr.reviews}</strong><small>${run.key === "blocked" ? "R1 requested changes" : "Correctness and recovery approved"}</small></span></div><div>${statusIcon(run.key === "blocked" ? "failed" : "passed")}<span><strong>${run.pr.checks}</strong><small>${run.key === "blocked" ? "R1 and T5 block merge" : "All required checks complete"}</small></span></div><div>${statusIcon(run.key === "blocked" ? "not-run" : "passed")}<span><strong>Release Gate ${run.gate.verdict.toLowerCase()}</strong><small>${run.gate.approval}</small></span></div></div></article>
    </div>
    <article class="panel cr-files-preview"><div class="panel-head"><h2>Files changed</h2><button class="btn ghost" type="button" data-switch-tab="files">Review diff</button></div>${run.files.map((file) => `<button class="vr-row" type="button" data-inspect="file:${file.id}" aria-pressed="false">${icon("code")}<span><strong class="vr-row-title">${file.path}</strong></span><span class="vr-row-end vr-diff-count"><b>+${file.additions}</b><i>−${file.deletions}</i></span>${icon("chevron")}</button>`).join("")}</article>
  </section>`
}

function files(run) {
  const first = run.files[0]
  return `<section id="cr-panel-files" class="cr-pane" role="tabpanel" aria-labelledby="cr-tab-files" hidden>
    <div class="cr-diff-workspace">
      <aside class="cr-file-list" aria-label="Changed files"><div><p class="eyebrow">Changed files</p><strong>${run.files.length} files</strong></div>${run.files.map((file, index) => `<button class="${index === 0 ? "active" : ""}" type="button" data-file="${file.id}" data-inspect="file:${file.id}" aria-pressed="${index === 0}"><span>${icon("code")}<strong>${file.path}</strong></span><small><b>+${file.additions}</b> <i>−${file.deletions}</i></small></button>`).join("")}</aside>
      <article class="cr-diff" aria-labelledby="cr-diff-title"><div class="cr-diff-head"><h2 id="cr-diff-title" data-diff-title>${first.path}</h2><div><span class="vr-mono">${run.baseCommit.slice(-7)} → ${run.headCommit.slice(-7)}</span><button class="btn" type="button" data-copy="${run.headCommit}">${icon("copy")} Copy commit</button></div></div><div class="cr-code" data-diff-code>${diffRows(first)}</div><div class="cr-citation"><span>${icon("evidence")} Change-to-Hypothesis map</span><strong>H1 · E2 · E4 · ${first.id === "test" ? "T3/T5" : "prediction pred-h1-1"}</strong></div></article>
    </div>
  </section>`
}

function checks(run) {
  const failedCount = run.checks.filter((check) => check.result === "failed").length
  const reviewCount = run.checks.filter((check) => check.kind === "Review").length
  const testCount = run.checks.filter((check) => check.kind === "Test").length
  return `<section id="cr-panel-checks" class="cr-pane" role="tabpanel" aria-labelledby="cr-tab-checks" hidden>
    <article class="panel"><div class="panel-head"><h2>${failedCount ? "Merge blocked" : "All required checks passed"}</h2>${badge(failedCount ? `${failedCount} failed` : `${run.checks.length} passed`, failedCount ? "danger" : "success")}</div>
      <div class="cr-check-toolbar"><div class="vr-seg" role="radiogroup" aria-label="Filter checks"><button class="active" type="button" role="radio" data-check-filter="all" aria-checked="true" tabindex="0">All ${run.checks.length}</button><button type="button" role="radio" data-check-filter="Review" aria-checked="false" tabindex="-1">Reviews ${reviewCount}</button><button type="button" role="radio" data-check-filter="Test" aria-checked="false" tabindex="-1">Tests ${testCount}</button><button type="button" role="radio" data-check-filter="failed" aria-checked="false" tabindex="-1">Failed ${failedCount}</button></div><span class="vr-mono">${run.candidate.slice(-8)}</span></div>
      <div class="cr-check-list">${run.checks.map((check) => `<button class="vr-row" type="button" data-check-row data-kind="${check.kind}" data-result="${check.result}" data-inspect="check:${check.id}" aria-pressed="false">${statusIcon(check.result)}<span><strong class="vr-row-title">${check.id} · ${check.name}</strong><small class="vr-row-meta">${check.actor} · ${check.tool} · ${check.duration}</small></span>${icon("chevron")}</button>`).join("")}</div>
      <div class="cr-check-empty" role="status" hidden data-check-empty>No checks match this filter.</div>
    </article>
  </section>`
}

function release(run) {
  return `<section id="cr-panel-release" class="cr-pane" role="tabpanel" aria-labelledby="cr-tab-release" hidden>
    <div class="cr-release-grid">
      <article class="panel"><div class="panel-head"><h2>Release Gate</h2>${badge(run.gate.verdict, run.key === "verified" ? "success" : "neutral")}</div><div class="cr-gate-grid">${run.gate.facts.map((fact) => `<button class="vr-row" type="button" data-inspect="gate:${fact.id}" aria-pressed="false">${statusIcon(fact.result)}<span><strong class="vr-row-title">Fact ${fact.id}</strong><small class="vr-row-meta">${fact.label}</small></span>${icon("chevron")}</button>`).join("")}</div></article>
      <article class="panel"><div class="panel-head"><h2>Release and Watch</h2>${badge(run.watch.status, run.key === "verified" ? "success" : "neutral")}</div><div class="panel-body">${run.watch.stages.length ? `<div class="cr-watch-stages">${run.watch.stages.map((stage) => `<button type="button" data-inspect="watch:run" aria-pressed="false"><span><strong class="vr-row-title">${stage.name}</strong><small class="vr-row-meta">${stage.traffic}</small></span><span><strong class="vr-row-title">${stage.samples}</strong><small class="vr-row-meta">${stage.duration}</small></span>${statusIcon(stage.result)}</button>`).join("")}</div><div class="cr-watch-ratio"><span>Trigger <b>${run.watch.before}</b></span><i aria-hidden="true"></i><span>Watch <b>${run.watch.after}</b></span></div>` : `<div class="cr-not-reached"><strong>No production Watch</strong><p>The run ended at Verify. Production stayed on ${run.production}.</p><button class="btn" type="button" data-inspect="check:T5" aria-pressed="false">Inspect failed check</button></div>`}</div></article>
      <article class="panel cr-recovery"><div class="panel-head"><h2>Recovery Point</h2>${badge(run.recovery.status, run.key === "verified" ? "success" : "neutral")}</div><div class="panel-body"><dl class="vr-dl"><div><dt>ID</dt><dd class="vr-mono">${run.recovery.id}</dd></div><div><dt>Coverage</dt><dd>${run.recovery.coverage}</dd></div><div><dt>Drill</dt><dd>${run.recovery.drill}</dd></div><div><dt>Rollback</dt><dd>${run.recovery.rollback}</dd></div></dl><button class="btn" type="button" data-inspect="recovery:point" aria-pressed="false">Review rollback record</button></div></article>
    </div>
  </section>`
}

function render(active = "verified") {
  const run = runs[active]
  return `<div class="vr-shell change-review vr-enter">
    ${appHeader(run, "cr")}
    <main id="workspace-main" class="cr-page">
      <div class="vr-breadcrumb"><span>Incidents</span>${icon("chevron")}<span>${run.shortId}</span>${icon("chevron")}<strong>Remediation</strong></div>
      <section class="cr-pr-header">
        <div><div class="badges">${badge(run.pr.state, run.pr.tone)}${badge(run.severity, "danger")}<span class="cr-pr-number">${run.pr.number}</span></div><h1>${run.pr.title}</h1><p>${run.repository} · ${run.branch}</p></div>
        <div class="cr-pr-actions"><button class="btn" type="button" data-copy="${run.pr.url}">${icon("copy")} Copy PR link</button><button class="btn primary" type="button" data-inspect="pr:record" aria-pressed="false">Inspect source-host record</button></div>
      </section>
      ${runMeta(run)}
      <div class="cr-main-grid">
        <div class="cr-records">
          <div class="vr-tabs" role="tablist" aria-label="Change records" data-tabs>
            <button id="cr-tab-summary" class="active" role="tab" type="button" aria-selected="true" aria-controls="cr-panel-summary" tabindex="0">Summary</button>
            <button id="cr-tab-files" role="tab" type="button" aria-selected="false" aria-controls="cr-panel-files" tabindex="-1">Files changed <span>${run.files.length}</span></button>
            <button id="cr-tab-checks" role="tab" type="button" aria-selected="false" aria-controls="cr-panel-checks" tabindex="-1">Checks <span>${run.checks.length}</span></button>
            <button id="cr-tab-release" role="tab" type="button" aria-selected="false" aria-controls="cr-panel-release" tabindex="-1">Release</button>
          </div>
          ${summary(run)}${files(run)}${checks(run)}${release(run)}
        </div>
        ${inspector(run, "pr:record", "Change inspector")}
      </div>
    </main>
  </div>`
}

function bind(stage, active = "verified") {
  const run = runs[active]
  bindCommon(stage, changeReview, active)
  const tabs = [...stage.querySelectorAll(".vr-tabs [role=tab]")]
  stage.querySelector("[data-switch-tab=files]")?.addEventListener("click", () => {
    const tab = tabs.find((candidate) => candidate.id === "cr-tab-files")
    if (!tab) return
    tab.click()
    tab.focus()
  })

  const fileButtons = [...stage.querySelectorAll("[data-file]")]
  fileButtons.forEach((button) => button.addEventListener("click", () => {
    const file = run.files.find((entry) => entry.id === button.dataset.file)
    if (!file) return
    fileButtons.forEach((candidate) => {
      const selected = candidate === button
      candidate.classList.toggle("active", selected)
      candidate.setAttribute("aria-pressed", String(selected))
    })
    stage.querySelector("[data-diff-title]").textContent = file.path
    stage.querySelector("[data-diff-code]").innerHTML = diffRows(file)
  }))

  const filterButtons = [...stage.querySelectorAll("[data-check-filter]")]
  const rows = [...stage.querySelectorAll("[data-check-row]")]
  const empty = stage.querySelector("[data-check-empty]")
  const filterLabels = { all: "All", Review: "Reviews", Test: "Tests", failed: "Failed" }
  const applyFilter = (button) => {
    const filter = button.dataset.checkFilter
    filterButtons.forEach((candidate) => {
      const selected = candidate === button
      candidate.classList.toggle("active", selected)
      candidate.setAttribute("aria-checked", String(selected))
      candidate.tabIndex = selected ? 0 : -1
    })
    let visible = 0
    rows.forEach((row) => {
      const show = filter === "all" || row.dataset.kind === filter || row.dataset.result === filter
      row.hidden = !show
      if (show) visible += 1
    })
    empty.hidden = visible !== 0
    if (visible === 0) empty.textContent = `No checks match "${filterLabels[filter]}".`
  }
  filterButtons.forEach((button, index) => {
    button.addEventListener("click", () => applyFilter(button))
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      const next = event.key === "Home" ? 0 : event.key === "End" ? filterButtons.length - 1 : event.key === "ArrowRight" ? (index + 1) % filterButtons.length : (index - 1 + filterButtons.length) % filterButtons.length
      applyFilter(filterButtons[next])
      filterButtons[next].focus()
    })
  })
}

export const changeReview = { render, bind }
