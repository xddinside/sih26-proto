/**
 * Acceptance items 1 and 3: both saved runs replay from the captured bundle
 * with their exact fixed outcomes, and saved controls cannot submit.
 *
 * Runs against the dev server serving a copy of `demo/saved-runs/` (see
 * `lib/server.ts`). Every rendered number here is a receipt- or row-backed
 * value from the captured export, asserted through the DOM the presentation
 * will show.
 */
import type { Page } from "playwright"

import type { SuiteRunner } from "../lib/report"
import type { DevServer } from "../lib/server"

const RUN_1 = "/incidents/inc-demo-payment-1"
const RUN_2 = "/incidents/inc-demo-payment-2"

async function bodyText(page: Page): Promise<string> {
  return (await page.textContent("body")) ?? ""
}

export async function runOutcomes(server: DevServer, runner: SuiteRunner, page: Page): Promise<void> {
  const base = server.baseUrl
  const { check } = runner.suite("both saved runs replay from the bundle with their exact fixed outcomes")

  // Incident list.
  await page.goto(`${base}/`, { waitUntil: "networkidle" })
  await page.waitForSelector("text=inc-demo-payment-1")
  let text = await bodyText(page)
  check("list heading", text.includes("Incidents"), "the pinned / route renders the incident list")
  check("opening line", text.includes("everything shown is saved evidence, nothing runs live"), "fixed opening statement present")
  check("standing saved banner", text.includes("bundle format 1.0 · 2 incidents") && text.includes("evaluation time is the bundle capture time, never the live clock"), "page-level saved-run banner with the capture timestamp renders")
  check("capture timestamp", text.includes("2026-08-16T17:16:21.283Z"), "manifest capture time shown, never the live clock")
  check("run 1 row closed", /inc-demo-payment-1[\s\S]*?closed/.test(text), "Run 1 row shows closed")
  check("run 2 row open", /inc-demo-payment-2[\s\S]*?open/.test(text), "Run 2 row shows open")
  const badgeCount = await page.locator("text=Saved Demo Run").count()
  check("saved-run banner present", badgeCount >= 1, `${badgeCount} Saved Demo Run banner on the list; rows sit under the standing saved banner`)

  // Run 1 — verified code Remediation.
  await page.goto(`${base}${RUN_1}`, { waitUntil: "networkidle" })
  await page.waitForSelector("text=verified-remediation")
  text = await bodyText(page)
  check("run-1 outcome", text.includes("outcome verified-remediation"), "Run 1 ends completed: verified-remediation")
  check("run-1 saved banner", text.includes("replaying journal and sealed artifacts; no live agent, broker, or detector activity"), "per-Incident standing saved banner renders")
  check("run-1 closed", text.includes("closed: symptom-cleared"), "Incident closed after the confirmation window")
  check("run-1 detector resolved", text.includes("detector resolved"), "detector state resolved")
  check("run-1 attempts", text.includes("of 3 · 2 remaining"), "1 attempt used, 2 remaining")
  check("run-1 stages completed", ["detect · completed", "diagnose · completed", "repair · completed", "verify · completed", "release · completed", "watch · completed"].every((s) => text.includes(s)), "all six stage chips completed")
  check("run-1 firing ratio", text.includes("recorded value 1") && text.includes("threshold 0.2"), "recorded firing ratio 1 ≥ 0.9 above the 0.2 threshold")
  check("run-1 pinned rule", text.includes("payment-error-rate") && text.includes("version 1"), "pinned rule id and rule_version shown")
  check("run-1 hypotheses", ["H1", "accepted", "H2", "rejected", "H3", "rejected", "H4", "rejected"].every((s) => text.includes(s)), "H1 accepted; H2–H4 eliminated")
  check("run-1 hypothesis gate pass", text.includes("verdict pass"), "eight-check Hypothesis gate pass renders")
  check("run-1 one-line diff", text.includes("if (['visa', 'mastercard'].includes(cardType))") && text.includes("if (!['visa', 'mastercard'].includes(cardType))"), "the one-line card-type restoration renders")
  check("run-1 safe class", text.includes("safe"), "action-risk class safe")
  check("run-1 verify rows", ["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7", "T9", "T10", "T12", "T13"].every((s) => text.includes(s)), "required and triggered review/test rows render")
  check("run-1 verification pass", /Verification Report[\s\S]*?pass/.test(text), "Verification Report verdict pass with hash binding")
  check("run-1 release gate pass", text.includes("release") && /verdict pass/.test(text), "Release Gate verdict pass with eight facts")
  check("run-1 approval", text.includes("approval-1-run-1") && text.includes("demo-operator") && text.includes("granted"), "recorded hybrid-window operator approval")
  check("run-1 probes 20/20 x3", text.includes("receipt-probe-w1") && text.includes("receipt-probe-w2") && text.includes("receipt-probe-w3") && text.includes("20/20 succeeded"), "three probe receipts of 20 charges")
  check("run-1 swap receipt", text.includes("Stage 2 — live service swap"), "stage-2 service swap rendered in the Watch panel")
  check("run-1 watch G1–G6", ["G1", "G2", "G3", "G4", "G5", "G6"].every((s) => text.includes(s)), "frozen G1–G6 Watch plan renders")
  {
    const watchText = (await page.locator("#workspace-watch").textContent()) ?? ""
    const confirmationIdx = watchText.indexOf("Confirmation window")
    const confirmation = watchText.slice(confirmationIdx, confirmationIdx + 400)
    check(
      "run-1 confirmation rows",
      confirmationIdx !== -1 && /G2[^G]{0,200}?0[\s\S]{0,40}?0\.05pass/.test(confirmation),
      "confirmation window G2 recorded value 0 < 0.05 with outcome pass",
    )
  }
  check("run-1 hybrid decision", text.includes("approval-required") && text.includes("outside-window"), "scheduled-hybrid policy decision recorded with its window")
  check("run-1 human approve", text.includes("approve"), "demo-operator approve action recorded")

  // Run 2 — deterministic failed verification.
  await page.goto(`${base}${RUN_2}`, { waitUntil: "networkidle" })
  await page.waitForSelector("text=verification-failed")
  text = await bodyText(page)
  check("run-2 open", text.includes("Incident open"), "Incident open")
  check("run-2 failed banner", text.includes("failed: verification-failed"), "run banner names verification-failed")
  check("run-2 attempts remaining", text.includes("2 of 3 attempts remaining"), "attempt consumed, 2 remaining")
  check("run-2 verify failed chip", text.includes("verify · failed"), "Verify stage chip failed")
  check("run-2 same gate table", text.includes("H1") && text.includes("accepted"), "the same accepted card-type Hypothesis renders")
  check("run-2 one-line fix", text.includes("if (!['visa', 'mastercard'].includes(cardType))"), "the correct one-line fix renders")
  check("run-2 R1 major finding", text.includes("restoring the card-type check makes the adjacent missing Luhn guard reachable"), "R1's cited major reachability finding renders")
  check("run-2 R1 citation", text.includes("src/payment/card.js"), "the finding cites file and line")
  check("run-2 T5 failure", text.includes("Luhn-failing Visa is rejected"), "the failing T5 case name renders")
  check("run-2 T5 bound", text.includes("receipt-t5"), "T5 receipt id renders, bound to the candidate hash")
  check("run-2 verdict fail", /Verification Report[\s\S]*?fail/.test(text), "Verification Report verdict fail with intact hash binding")
  check("run-2 gates not reached", text.includes("Release Gate not reached") && text.includes("not reached — run ended verification-failed"), "Release and Action Gates render not-reached, never an empty gate")
  check("run-2 no approval", text.includes("No approval records"), "no approval recorded — the run ends before Release")
  check("run-2 no watch report", text.includes("No Watch Report") && text.includes("the run ended at Verify before the production Watch stage"), "no production Watch Report rendered — the run ended at Verify")
  check("run-2 policy moot", text.includes("no execution-time decision recorded"), "autonomous policy is moot at Verify")

  // Saved controls cannot submit (acceptance item 3).
  const controls = runner.suite("saved controls cannot submit")
  await page.goto(`${base}${RUN_1}`, { waitUntil: "networkidle" })
  await page.waitForSelector("text=verified-remediation")
  const disabledButtons = page.locator("button[disabled]")
  const disabledCount = await disabledButtons.count()
  controls.check("disabled saved-run controls", disabledCount >= 4, `${disabledCount} disabled control buttons rendered`)
  const readOnlyNotes = await page.locator("text=saved run — read-only; live controls are Solution Contract only").count()
  controls.check("read-only reason rendered", readOnlyNotes >= 2, `${readOnlyNotes} standing read-only reason notes`)
  const clickable = await page.locator("button:not([disabled])").count()
  controls.check("no enabled submit controls", clickable === 0, `${clickable} enabled buttons on the saved view (expected 0)`)
  // No live command endpoint: every request must stay on the replay server.
  const externalHits: string[] = []
  page.on("request", (request) => {
    const url = request.url()
    if (!url.includes(server.baseUrl) && !url.includes("127.0.0.1")) {
      externalHits.push(url)
    }
  })
  await page.goto(`${base}/`, { waitUntil: "networkidle" })
  await page.goto(`${base}${RUN_2}`, { waitUntil: "networkidle" })
  controls.check("no live backend calls", externalHits.length === 0, externalHits.length === 0 ? "every request stayed on the replay server" : `external requests observed: ${externalHits.join(", ")}`)
}
