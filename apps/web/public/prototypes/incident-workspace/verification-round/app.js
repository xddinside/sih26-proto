import { runFromQuery } from "./data.js?rev=20260819-5"
import { traceableBrief } from "./variant-traceable-brief.js?rev=20260819-5"
import { runChronicle } from "./variant-run-chronicle.js?rev=20260819-5"
import { changeReview } from "./variant-change-review.js?rev=20260819-5"

const variantModules = [traceableBrief, runChronicle, changeReview]
const variants = variantModules.map((variant) => () => variant.render(runFromQuery()))
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
    stage.innerHTML = variants[i]()
    variantModules[i].bind(stage, runFromQuery())
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
requestAnimationFrame(() => requestAnimationFrame(() => picker.setAttribute("data-ready", "")))
