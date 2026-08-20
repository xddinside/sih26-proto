import { commandCenter } from "./variant-command-center.js?rev=20260819-2"
import { operationalBrief } from "./variant-operational-brief.js?rev=20260819-2"
import { runLedger } from "./variant-run-ledger.js?rev=20260819-2"

const variants = [commandCenter, operationalBrief, runLedger]
const stage = document.getElementById("stage")
const picker = document.querySelector(".proto-picker")
const highlight = picker.querySelector(".proto-picker-highlight")
const items = [...picker.querySelectorAll(".proto-picker-item:not(.proto-picker-replay)")]
const replay = picker.querySelector(".proto-picker-replay")
let current = 0
let mountVersion = 0

function moveHighlight() {
  const el = items[current]
  highlight.style.width = el.offsetWidth + "px"
  highlight.style.transform = `translateX(${el.offsetLeft}px)`
}

function mount(i) {
  const version = ++mountVersion
  stage.innerHTML = ""
  let mounted = false
  const render = () => {
    if (mounted || version !== mountVersion) return
    mounted = true
    const run = new URLSearchParams(location.search).get("run") === "2" ? "blocked" : "verified"
    stage.innerHTML = variants[i].render(run)
    variants[i].bind(stage, run)
  }
  requestAnimationFrame(render)
  setTimeout(render, 32)
}

function setActive(i) {
  if (i < 0 || i >= variants.length) return
  current = i
  items.forEach((el, j) => {
    el.toggleAttribute("data-active", j === i)
    if (j === i) el.setAttribute("aria-current", "true")
    else el.removeAttribute("aria-current")
  })
  moveHighlight()
  const url = new URL(location)
  url.searchParams.set("v", i + 1)
  history.replaceState(null, "", url)
  mount(i)
}

items.forEach((el, i) => el.addEventListener("click", () => setActive(i)))
replay?.addEventListener("click", () => mount(current))
window.addEventListener("resize", moveHighlight)

document.addEventListener("keydown", (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const num = parseInt(e.key, 10)
  if (num >= 1 && num <= variants.length) setActive(num - 1)
  else if (e.key === "ArrowRight") setActive((current + 1) % variants.length)
  else if (e.key === "ArrowLeft") setActive((current - 1 + variants.length) % variants.length)
  else if (e.key === "r" || e.key === "R") mount(current)
})

setActive((parseInt(new URLSearchParams(location.search).get("v"), 10) || 1) - 1)
let pickerReady = false
const ready = () => {
  if (pickerReady) return
  pickerReady = true
  picker.setAttribute("data-ready", "")
}
requestAnimationFrame(() => requestAnimationFrame(ready))
setTimeout(ready, 64)
