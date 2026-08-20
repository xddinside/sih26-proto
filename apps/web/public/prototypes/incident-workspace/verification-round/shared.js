import { runs, toneFor } from "./data.js?rev=20260819-5"

const icons = {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  agent: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M9 13v2M15 13v2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
  copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  evidence: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  gate: '<path d="M12 3 4 7v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7z"/><path d="m9 12 2 2 4-4"/>',
  git: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h3a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3M6 8v10"/><circle cx="6" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5-5L7 4l3 3 2.7-2.7a4 4 0 0 0 2 5L7 17l-3 3 3 3 3-3 7.3-7.7a4 4 0 0 0 5-5L20 10l-3-3z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
}

export function icon(name, className = "") {
  return `<svg class="vr-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.activity}</svg>`
}

export function badge(text, tone = "neutral") {
  return `<span class="badge ${tone}">${tone !== "neutral" ? '<span class="status-dot" aria-hidden="true"></span>' : ""}${text}</span>`
}

export function appHeader(run, section) {
  const options = Object.entries(runs).map(([key, incident]) => `
    <button class="ob-incident-option" type="button" ${key === run.key ? 'aria-current="page"' : ""} data-run-key="${key}" data-incident-search-value="${incident.shortId} ${incident.title} ${incident.state}">
      <span class="ob-incident-option-head"><strong>${incident.shortId}</strong>${badge(incident.state, incident.stateTone)}</span>
      <span>${incident.title}</span>
      <small>${incident.lead}</small>
    </button>`).join("")
  return `<header class="vr-header">
    <a class="skip-link" href="#workspace-main">Skip to incident</a>
    <div class="vr-header-brand"><span class="product-mark-badge" aria-hidden="true">IR</span><span>Incident Response</span></div>
    <nav class="vr-primary-nav" aria-label="Primary"><button type="button" aria-current="page" data-toast="Incident list is represented by the saved Incident selector.">Incidents</button><button type="button" data-toast="Policy policy:ecaedc73d8f7 governed this run.">Policies</button><button type="button" data-toast="Open Activity or a raw record to inspect the audit trail.">Audit</button></nav>
    <div class="vr-header-actions">
      ${badge("Captured run", "info")}
      <details class="ob-incident-nav">
        <summary aria-label="Browse incidents"><span><small>Incident</small><strong>${run.shortId}</strong></span><span aria-hidden="true">⌄</span></summary>
        <div class="ob-incident-menu">
          <div class="ob-incident-menu-head"><div><p class="eyebrow">Workspace</p><h2 class="subhead">Incidents</h2></div><span class="badge neutral">2 saved</span></div>
          <label class="sr-only" for="incident-search-${section}">Search incidents</label>
          <input id="incident-search-${section}" class="search" type="search" placeholder="Search incidents" autocomplete="off" data-incident-search>
          <div class="ob-incident-options" aria-label="Saved incidents">${options}</div>
          <p class="ob-incident-empty" role="status" hidden>No incidents match this search.</p>
        </div>
      </details>
      <button class="btn icon-btn" type="button" data-download aria-label="Export Incident Run as JSON">${icon("download")}</button>
    </div>
  </header>`
}

export function runMeta(run) {
  return `<div class="vr-run-meta" aria-label="Run context">
    <span><strong>${run.environment}</strong> environment</span>
    <span>${run.service}</span>
    <span>Attempt ${run.attempt}</span>
    <span>${run.duration}</span>
  </div>`
}

export function statusIcon(result) {
  if (["failed", "danger"].includes(result)) return `<span class="vr-status"><span class="vr-result-icon danger" aria-hidden="true">×</span><span class="sr-only">Result: failed</span></span>`
  if (["not-run", "skipped"].includes(result)) return `<span class="vr-status"><span class="vr-result-icon neutral" aria-hidden="true">–</span><span class="sr-only">Result: not run</span></span>`
  return `<span class="vr-status"><span class="vr-result-icon success" aria-hidden="true">✓</span><span class="sr-only">Result: passed</span></span>`
}

function factRows(rows) {
  return `<dl class="vr-dl">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`
}

function selectedRecord(run, key) {
  if (!key || key === "run") {
    return {
      kicker: "Run record",
      title: `${run.shortId} · ${run.state}`,
      tone: run.stateTone,
      summary: run.lead,
      facts: [["Run", run.runId], ["Started", run.started], ["Policy", run.policy], ["Candidate", run.candidate]],
    }
  }
  const [kind, id] = key.split(":")
  if (kind === "event") {
    const event = run.events.find((item) => item.id === id)
    if (!event) return selectedRecord(run, "run")
    return { kicker: `${event.stage} event`, title: event.title, tone: toneFor(event.status), summary: event.summary, facts: [["Recorded", event.time], ["Actor", event.actor], ["Kind", event.kind], ["Source", event.ref]] }
  }
  if (kind === "evidence") {
    const item = run.evidence.find((entry) => entry.id === id)
    if (!item) return selectedRecord(run, "run")
    return { kicker: `${item.kind} evidence`, title: item.title, tone: "info", summary: item.observation, facts: [["Evidence ID", item.id], ["Backend", item.source], ["Observed", item.observedAt], ["Trust", item.trust]], code: item.query }
  }
  if (kind === "call") {
    const call = run.fusion.calls.find((entry) => entry.id === id)
    if (!call) return selectedRecord(run, "run")
    return { kicker: `Fusion ${call.role}`, title: call.title, tone: "success", summary: call.output, facts: [["Model", call.model], ["Status", call.status], ["Duration", call.duration], ["Tokens", call.tokens], ["Tool calls", call.tools]] }
  }
  if (kind === "check") {
    const check = run.checks.find((entry) => entry.id === id)
    if (!check) return selectedRecord(run, "run")
    return { kicker: `${check.kind} ${check.id}`, title: check.name, tone: toneFor(check.result), summary: check.detail, facts: [["Result", check.result], ["Agent", check.actor], ["Tool", check.tool], ["Receipt", check.receipt]] }
  }
  if (kind === "gate") {
    const fact = run.gate.facts.find((entry) => entry.id === id)
    if (!fact) return selectedRecord(run, "run")
    return { kicker: `Release Gate fact ${fact.id}`, title: fact.label, tone: toneFor(fact.result), summary: fact.result === "passed" ? "The fact passed against recorded evidence." : "The gate never ran because Verification failed.", facts: [["Result", fact.result], ["Evidence", fact.evidence], ["Policy", run.policy], ["Approval", run.gate.approval]] }
  }
  if (kind === "file") {
    const file = run.files.find((entry) => entry.id === id)
    if (!file) return selectedRecord(run, "run")
    return { kicker: "Changed file", title: file.path, tone: "info", summary: `${file.additions} additions and ${file.deletions} deletions in ${run.pr.number}.`, facts: [["Base", run.baseCommit], ["Head", run.headCommit], ["Branch", run.branch]] }
  }
  if (kind === "pr") {
    return { kicker: "Source-host record", title: `${run.pr.number} ${run.pr.title}`, tone: run.pr.tone, summary: `${run.pr.state}. ${run.pr.checks}; ${run.pr.reviews}.`, facts: [["Repository", run.repository], ["Branch", run.branch], ["Head", run.headCommit], ["Merge", run.pr.mergedAt], ["Link", run.pr.url]] }
  }
  if (kind === "watch") {
    return { kicker: "Release and Watch", title: run.watch.status, tone: toneFor(run.watch.status === "Passed" ? "passed" : "not-run"), summary: run.key === "verified" ? `Payment error ratio moved from ${run.watch.before} to ${run.watch.after}.` : "The run stopped at Verify. No candidate entered production.", facts: [["Production", run.production], ["Stages", String(run.watch.stages.length)], ["Stop rules", run.watch.stopRules.join(" · ")], ["Recovery", run.recovery.id]] }
  }
  if (kind === "recovery") {
    return { kicker: "Recovery Point", title: run.recovery.status, tone: toneFor(run.recovery.status), summary: run.recovery.rollback, facts: [["Recovery Point", run.recovery.id], ["Coverage", run.recovery.coverage], ["Drill", run.recovery.drill], ["Production", run.production]] }
  }
  if (kind === "hypothesis") {
    return { kicker: "Accepted Hypothesis", title: "H1 · Card-type branch inversion", tone: "success", summary: run.cause, facts: [["Supporting evidence", "E2, E3, E4"], ["Opposing evidence", "none unresolved"], ["Prediction", "valid Visa unit case fails before Remediation"], ["Gate", "8/8 acceptance checks passed"]] }
  }
  return selectedRecord(run, "run")
}

export function inspectorContent(run, key = "run") {
  const record = selectedRecord(run, key)
  const rawRecord = JSON.stringify({ type: record.kicker, title: record.title, summary: record.summary, facts: Object.fromEntries(record.facts) }, null, 2)
  return `<div class="vr-inspector-record" data-inspector-record>
    <div class="vr-inspector-heading"><div><p class="eyebrow">${record.kicker}</p><h2 tabindex="-1" data-inspector-title>${record.title}</h2></div>${badge(record.tone === "danger" ? "Needs attention" : record.tone === "success" ? "Verified" : "Recorded", record.tone)}</div>
    <p class="vr-inspector-summary">${record.summary}</p>
    ${factRows(record.facts)}
    ${record.code ? `<pre class="vr-detail-code"><code>${record.code}</code></pre>` : ""}
    <div class="vr-inspector-actions"><button class="btn" type="button" data-copy="${record.title}">${icon("copy")} Copy reference</button><button class="btn ghost" type="button" data-toggle-raw aria-expanded="false">${icon("code")} Show raw record</button></div>
    <pre class="vr-detail-code" data-raw-record hidden><code>${rawRecord}</code></pre>
  </div>`
}

export function inspector(run, key = "run", label = "Inspector") {
  return `<aside class="vr-inspector" aria-label="${label}" data-inspector><div class="vr-inspector-content" data-inspector-content>${inspectorContent(run, key)}</div></aside>`
}

function toast(message) {
  let notice = document.querySelector(".prototype-notice")
  if (!notice) {
    notice = document.createElement("div")
    notice.className = "prototype-notice"
    notice.setAttribute("role", "status")
    document.body.append(notice)
  }
  notice.textContent = message
  clearTimeout(window.verificationPrototypeNotice)
  window.verificationPrototypeNotice = setTimeout(() => notice.remove(), 2400)
}

function bindTabs(stage) {
  stage.querySelectorAll("[data-tabs]").forEach((tabRoot) => {
    const tabs = [...tabRoot.querySelectorAll("[role=tab]")]
    const scope = tabRoot.parentElement
    const panes = [...scope.querySelectorAll("[role=tabpanel]")]
    const activate = (tab, focus = false) => {
      tabs.forEach((candidate) => {
        const selected = candidate === tab
        candidate.setAttribute("aria-selected", String(selected))
        candidate.tabIndex = selected ? 0 : -1
        candidate.classList.toggle("active", selected)
      })
      panes.forEach((pane) => { pane.hidden = pane.id !== tab.getAttribute("aria-controls") })
      if (focus) tab.focus()
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab))
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length
        activate(tabs[next], true)
      })
    })
  })
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast("Reference copied")
  } catch {
    toast("Clipboard unavailable in this preview")
  }
}

export function bindCommon(stage, variant, active) {
  const run = runs[active]
  stage.verificationPrototypeController?.abort()
  const controller = new AbortController()
  stage.verificationPrototypeController = controller
  const { signal } = controller
  bindTabs(stage)

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
  }, { signal })

  stage.querySelectorAll("[data-run-key]").forEach((button) => button.addEventListener("click", () => {
    const next = button.dataset.runKey
    if (next === active) return
    const url = new URL(location)
    url.searchParams.set("run", next === "blocked" ? "2" : "1")
    history.replaceState(null, "", url)
    stage.innerHTML = variant.render(next)
    variant.bind(stage, next)
    stage.querySelector(".ob-incident-nav summary")?.focus()
  }, { signal }))

  incidentNav?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !incidentNav.open) return
    event.preventDefault()
    incidentNav.open = false
    incidentNav.querySelector("summary")?.focus()
  }, { signal })

  stage.addEventListener("click", (event) => {
    const inspectButton = event.target.closest("[data-inspect]")
    if (inspectButton) {
      const target = stage.querySelector("[data-inspector-content]")
      if (target) {
        target.innerHTML = inspectorContent(run, inspectButton.dataset.inspect)
        stage.querySelectorAll("[data-inspect]").forEach((button) => button.setAttribute("aria-pressed", String(button === inspectButton)))
        target.querySelector("[data-inspector-title]")?.focus({ preventScroll: true })
        if (matchMedia("(max-width: 760px)").matches) target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
      }
      return
    }
    const copyButton = event.target.closest("[data-copy]")
    if (copyButton) {
      copyText(copyButton.dataset.copy)
      return
    }
    const toastButton = event.target.closest("[data-toast]")
    if (toastButton) {
      toast(toastButton.dataset.toast)
      return
    }
    const rawButton = event.target.closest("[data-toggle-raw]")
    if (rawButton) {
      const raw = rawButton.closest("[data-inspector-record]")?.querySelector("[data-raw-record]")
      if (!raw) return
      const expanded = rawButton.getAttribute("aria-expanded") === "true"
      rawButton.setAttribute("aria-expanded", String(!expanded))
      rawButton.lastChild.textContent = expanded ? " Show raw record" : " Hide raw record"
      raw.hidden = expanded
    }
  }, { signal })

  stage.querySelector("[data-download]")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `${run.shortId.toLowerCase()}-${run.runId}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    toast("Incident Run export prepared")
  }, { signal })
}
