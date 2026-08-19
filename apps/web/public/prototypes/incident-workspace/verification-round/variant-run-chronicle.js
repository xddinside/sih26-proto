import { runs } from "./data.js?rev=20260819-3"
import { appHeader, badge, bindCommon, icon, inspector, runMeta } from "./shared.js?rev=20260819-3"

const stages = ["Detect", "Diagnose", "Repair", "Verify", "Release", "Watch"]

function stageState(run, stage) {
  if (run.key === "blocked" && ["Release", "Watch"].includes(stage)) return "skipped"
  if (run.key === "blocked" && stage === "Verify") return "failed"
  return "complete"
}

function eventIcon(kind) {
  if (kind === "agent") return "agent"
  if (kind === "tool") return "tool"
  if (kind === "gate") return "gate"
  if (kind === "release") return "git"
  return "activity"
}

function render(active = "verified") {
  const run = runs[active]
  return `<div class="vr-shell run-chronicle vr-enter">
    ${appHeader(run, "rc")}
    <main id="workspace-main" class="rc-page">
      <section class="rc-titlebar">
        <div><div class="vr-breadcrumb"><span>Incidents</span>${icon("chevron")}<strong>${run.shortId}</strong></div><div class="badges">${badge(run.state, run.stateTone)}${badge(run.severity, "danger")}${badge("Captured timeline", "info")}</div><h1>${run.title}</h1><p>${run.lead}</p></div>
        <div class="rc-outcome"><span>${run.key === "blocked" ? "Stopped at" : "Completed"}</span><strong>${run.key === "blocked" ? "Verify" : "Watch"}</strong><small>${run.duration} total</small></div>
      </section>
      ${runMeta(run)}
      <div class="rc-workspace">
        <aside class="rc-stage-rail" aria-label="Run stages">
          <div class="rc-stage-head"><p class="eyebrow">Incident Run</p><strong>Attempt ${run.attempt}</strong></div>
          <button class="rc-stage active" type="button" data-stage="all" aria-pressed="true"><span class="rc-stage-mark complete"></span><span><strong>All activity</strong><small>${run.events.length} events</small></span></button>
          ${stages.map((stage) => {
            const state = stageState(run, stage)
            const count = run.events.filter((event) => event.stage === stage).length
            return `<button class="rc-stage" type="button" data-stage="${stage}" aria-pressed="false"><span class="rc-stage-mark ${state}" aria-hidden="true"></span><span><strong>${stage}</strong><small>${state === "skipped" ? "Not reached" : state === "failed" ? `Failed · ${count} events` : `${count} events`}</small></span></button>`
          }).join("")}
          <div class="rc-stage-footer"><span>Started</span><strong>${run.started.split(", ").at(-1)}</strong><span>Captured</span><strong>${run.captured.split(", ").at(-1)}</strong></div>
        </aside>

        <section class="rc-stream" aria-labelledby="activity-title">
          <div class="rc-stream-head"><div><p class="eyebrow">Journal, agents, tools, and gates</p><h2 id="activity-title">Run activity</h2></div><span class="tiny muted" data-event-count>${run.events.length} events</span></div>
          <div class="rc-controls">
            <label class="rc-search">${icon("search")}<span class="sr-only">Search run activity</span><input type="search" placeholder="Search activity" data-activity-search autocomplete="off"></label>
            <div class="rc-filters" aria-label="Filter activity">
              <button class="active" type="button" data-kind="all" aria-pressed="true">All</button>
              <button type="button" data-kind="agent" aria-pressed="false">Agents</button>
              <button type="button" data-kind="tool" aria-pressed="false">Tools</button>
              <button type="button" data-kind="gate" aria-pressed="false">Gates</button>
              <button type="button" data-kind="release" aria-pressed="false">Release</button>
            </div>
          </div>
          <ol class="rc-events">
            ${run.events.map((event, index) => `<li data-event-row data-stage-value="${event.stage}" data-kind-value="${event.kind}" data-search-value="${event.time} ${event.stage} ${event.actor} ${event.title} ${event.summary}">
              <span class="rc-event-time">${event.time}</span>
              <span class="rc-event-line" aria-hidden="true"><i class="${event.status}">${icon(eventIcon(event.kind))}</i>${index < run.events.length - 1 ? "<b></b>" : ""}</span>
              <button class="rc-event" type="button" data-inspect="event:${event.id}" aria-pressed="false">
                <span class="rc-event-top"><span><b>${event.stage}</b><small>${event.actor}</small></span>${badge(event.status === "failed" ? "Failed" : "Recorded", event.status === "failed" ? "danger" : "neutral")}</span>
                <strong>${event.title}</strong><p>${event.summary}</p><span class="rc-event-ref">${event.ref}${icon("chevron")}</span>
              </button>
            </li>`).join("")}
          </ol>
          <div class="rc-empty" role="status" hidden data-activity-empty><strong>No matching activity</strong><span>Clear the search or choose another stage.</span></div>
        </section>

        <div class="rc-detail-column">
          ${inspector(run, "run", "Activity detail")}
          <section class="rc-agent-summary" aria-labelledby="agents-title"><div class="rc-mini-head"><h2 id="agents-title">Agent calls</h2><span>4</span></div>${run.fusion.calls.map((call) => `<button type="button" data-inspect="call:${call.id}" aria-pressed="false"><span>${icon("agent")}<strong>${call.role}</strong></span><small>${call.duration} · ${call.tokens} tokens</small></button>`).join("")}</section>
        </div>
      </div>
    </main>
  </div>`
}

function bind(stage, active = "verified") {
  bindCommon(stage, runChronicle, active)
  const stageButtons = [...stage.querySelectorAll("[data-stage]")]
  const kindButtons = [...stage.querySelectorAll("[data-kind]")]
  const rows = [...stage.querySelectorAll("[data-event-row]")]
  const search = stage.querySelector("[data-activity-search]")
  const count = stage.querySelector("[data-event-count]")
  const empty = stage.querySelector("[data-activity-empty]")
  let selectedStage = "all"
  let selectedKind = "all"

  const filter = () => {
    const query = search.value.trim().toLowerCase()
    let visible = 0
    rows.forEach((row) => {
      const matchesStage = selectedStage === "all" || row.dataset.stageValue === selectedStage
      const matchesKind = selectedKind === "all" || row.dataset.kindValue === selectedKind
      const matchesSearch = !query || row.dataset.searchValue.toLowerCase().includes(query)
      row.hidden = !(matchesStage && matchesKind && matchesSearch)
      if (!row.hidden) visible += 1
    })
    count.textContent = `${visible} event${visible === 1 ? "" : "s"}`
    empty.hidden = visible !== 0
  }

  stageButtons.forEach((button) => button.addEventListener("click", () => {
    selectedStage = button.dataset.stage
    stageButtons.forEach((candidate) => {
      const selected = candidate === button
      candidate.classList.toggle("active", selected)
      candidate.setAttribute("aria-pressed", String(selected))
    })
    filter()
  }))
  kindButtons.forEach((button) => button.addEventListener("click", () => {
    selectedKind = button.dataset.kind
    kindButtons.forEach((candidate) => {
      const selected = candidate === button
      candidate.classList.toggle("active", selected)
      candidate.setAttribute("aria-pressed", String(selected))
    })
    filter()
  }))
  search.addEventListener("input", filter)
}

export const runChronicle = { render, bind }
