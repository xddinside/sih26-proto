import { evidence, runs, statusLabel, tests } from "./data.js?rev=20260819-2"

export function badge(text, tone = "neutral") {
  return `<span class="badge ${tone}">${tone !== "neutral" ? '<span class="status-dot" aria-hidden="true"></span>' : ""}${text}</span>`
}

export function productMark() {
  return `<div class="product-mark"><span class="product-mark-badge" aria-hidden="true">IR</span><span>Incident Response</span></div>`
}

export function runSwitch(active) {
  return `<div class="run-switch" role="group" aria-label="Saved Demo Run">
    <button type="button" data-run-key="verified" aria-pressed="${active === "verified"}">Run 1</button>
    <button type="button" data-run-key="blocked" aria-pressed="${active === "blocked"}">Run 2</button>
  </div>`
}

export function stageStrip(run) {
  return `<div class="stage-strip" aria-label="Incident Run stages">${run.stages.map(([name, state]) => `<div class="stage ${state}"><strong>${name}</strong><span class="sr-only">: ${statusLabel(state)}</span></div>`).join("")}</div>`
}

export function errorChart(run, id) {
  const blocked = run === runs.blocked
  return `<div>
    <div class="chart" role="img" aria-label="${blocked ? "Error ratio remained at 1.00 because no change was released" : "Error ratio fell from 1.00 before release to 0.00 during Watch"}">
      <svg viewBox="0 0 420 112" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="fade-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#356fc0"/><stop offset="1" stop-color="#356fc0" stop-opacity="0"/></linearGradient></defs>
        ${blocked
          ? `<polyline class="chart-line" points="0,17 70,18 140,16 210,19 280,17 350,18 420,17"/>`
          : `<polygon class="chart-area" style="fill:url(#fade-${id})" points="0,17 70,18 140,16 185,19 205,92 280,94 350,93 420,94 420,112 0,112"/><polyline class="chart-line" points="0,17 70,18 140,16 185,19 205,92 280,94 350,93 420,94"/>`}
      </svg>
    </div>
    <div class="chart-labels"><span>Before ${run.errorBefore}</span><span>${blocked ? "Release blocked" : "Watch " + run.errorAfter}</span></div>
  </div>`
}

function testRows(run) {
  return tests.map(([id, name, kind, fixed]) => {
    const result = fixed === "dynamic" ? (run === runs.blocked && (id === "R1" || id === "T5") ? "fail" : "pass") : fixed
    return `<tr><td class="mono">${id}</td><td>${name}</td><td>${kind}</td><td>${badge(result === "pass" ? "Passed" : "Failed", result === "pass" ? "success" : "danger")}</td></tr>`
  }).join("")
}

export function drawerMarkup(kind, run) {
  const content = {
    run: `<div class="drawer-section"><h3>Saved Demo Run</h3><p class="body-sm muted">Captured 16 Aug 2026. Replaying journal and sealed artifacts. No live agent, broker, or detector activity.</p></div>
      <div class="drawer-section"><h3>Run outcome</h3><p class="body-sm">${run.summary}</p></div>
      <div class="drawer-section"><h3>Recorded identifiers</h3><p class="mono tiny muted">${run.id}<br>candidate sha256:${run === runs.blocked ? "bb8885230cf3..." : "aa2e6b171010..."}<br>policy ${run === runs.blocked ? "68781eabf78b..." : "ecaedc73d8f7..."}</p></div>`,
    evidence: `<div class="drawer-section"><h3>Evidence Set revision 1</h3><p class="body-sm muted">Four representative items behind the accepted Hypothesis.</p></div><div class="drawer-section"><table class="data-table"><thead><tr><th>Kind</th><th>Evidence</th><th>Source</th></tr></thead><tbody>${evidence.map(([kind, name, value, source]) => `<tr><td>${kind}</td><td><strong>${name}</strong><br><span class="muted">${value}</span></td><td>${source}</td></tr>`).join("")}</tbody></table></div><div class="drawer-section"><button class="btn primary" type="button" data-toast="Opening the saved Grafana snapshot">Open in Grafana</button></div>`,
    remediation: `<div class="drawer-section"><h3>Accepted Hypothesis</h3><p class="body-sm">${run.hypothesis}</p></div><div class="drawer-section"><h3>Proposed code remediation</h3><p class="body-sm muted">${run.remediation}</p><pre class="diff"><span class="minus">-  if (['visa', 'mastercard'].includes(cardType)) {</span>\n<span class="plus">+  if (!['visa', 'mastercard'].includes(cardType)) {</span></pre></div><div class="drawer-section"><h3>Blast radius</h3><p class="body-sm">payment service, demo environment</p></div>`,
    verify: `<div class="drawer-section"><h3>Verification verdict</h3><p class="body-sm">${run.verify}</p>${run.finding ? `<div class="finding">${run.finding}</div>` : ""}</div><div class="drawer-section"><table class="data-table"><thead><tr><th>Layer</th><th>Check</th><th>Type</th><th>Result</th></tr></thead><tbody>${testRows(run)}</tbody></table></div>`,
    rollback: `<div class="drawer-section"><h3>${run.recovery}</h3><p class="body-sm muted">${run.recoveryDetail}</p></div><div class="drawer-section"><h3>Action availability</h3><button type="button" class="btn" disabled aria-describedby="rollback-reason">Roll back release</button><p id="rollback-reason" class="tiny muted" style="margin-top:8px">Saved Demo Runs are read-only. This run did not trigger rollback.</p></div>`,
  }[kind]
  return `<button class="drawer-backdrop" type="button" data-close-drawer aria-label="Close details"></button><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-head"><div><p class="eyebrow">Incident Workspace</p><h2 id="drawer-title" class="title">${kind === "run" ? "Run details" : kind[0].toUpperCase() + kind.slice(1)}</h2></div><button class="btn icon-btn" type="button" data-close-drawer aria-label="Close details">×</button></div>${content}</aside>`
}

export function bindCommon(stage, variant, active) {
  stage.querySelectorAll("[data-context-nav]").forEach((button) => button.addEventListener("click", () => {
    let notice = document.querySelector(".prototype-notice")
    if (notice === null) {
      notice = document.createElement("div")
      notice.className = "prototype-notice"
      notice.setAttribute("role", "status")
      document.body.append(notice)
    }
    notice.textContent = "This exploration is scoped to the Incident detail workspace."
    clearTimeout(window.prototypeNoticeTimer)
    window.prototypeNoticeTimer = setTimeout(() => notice.remove(), 2400)
  }))

  stage.querySelectorAll("[data-run-key]").forEach((button) => button.addEventListener("click", () => {
    const next = button.dataset.runKey
    if (next === active) return
    const url = new URL(location)
    url.searchParams.set("run", next === "blocked" ? "2" : "1")
    history.replaceState(null, "", url)
    stage.innerHTML = variant.render(next)
    variant.bind(stage, next)
    const focusTarget = stage.querySelector(".ob-incident-nav > summary") ?? stage.querySelector(`[data-run-key="${next}"]`)
    focusTarget?.focus()
  }))

  stage.querySelectorAll("[data-drawer]").forEach((button) => button.addEventListener("click", () => {
    const trigger = button
    const holder = document.createElement("div")
    holder.dataset.drawerRoot = ""
    holder.innerHTML = drawerMarkup(button.dataset.drawer, runs[active])
    document.body.append(holder)
    stage.inert = true
    document.querySelector(".proto-picker").inert = true
    holder.querySelector(".drawer [data-close-drawer]")?.focus()
    const close = () => {
      document.removeEventListener("keydown", onKeyDown)
      holder.remove()
      stage.inert = false
      document.querySelector(".proto-picker").inert = false
      trigger.focus()
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") close()
      if (event.key !== "Tab") return
      const focusable = [...holder.querySelectorAll("button:not([disabled]), a[href]")]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener("keydown", onKeyDown)
    holder.querySelectorAll("[data-close-drawer]").forEach((node) => node.addEventListener("click", close))
    holder.querySelector("[data-toast]")?.addEventListener("click", (event) => {
      event.currentTarget.textContent = "Saved snapshot ready"
      event.currentTarget.disabled = true
    })
  }))

  stage.querySelectorAll("[data-disabled-reason]").forEach((button) => button.addEventListener("click", () => {
    stage.querySelector("[data-action-note]")?.removeAttribute("hidden")
  }))
}
