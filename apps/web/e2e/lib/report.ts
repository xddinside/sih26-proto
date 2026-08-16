/**
 * Minimal check reporter for the e2e runner. Mirrors the shape of the
 * replay-check report so both artifacts read the same way.
 */
export interface E2eCheck {
  name: string
  status: "pass" | "fail" | "warn"
  detail: string
}

export interface E2eSuite {
  name: string
  checks: E2eCheck[]
}

export class SuiteRunner {
  readonly suites: E2eSuite[] = []

  suite(name: string): { check: (name: string, ok: boolean, detail: string) => void; warn: (name: string, detail: string) => void } {
    const checks: E2eCheck[] = []
    this.suites.push({ name, checks })
    return {
      check: (checkName, ok, detail) => {
        checks.push({ name: checkName, status: ok ? "pass" : "fail", detail })
      },
      warn: (checkName, detail) => {
        checks.push({ name: checkName, status: "warn", detail })
      },
    }
  }

  render(): { failed: number; warned: number; total: number } {
    let failed = 0
    let warned = 0
    let total = 0
    for (const suite of this.suites) {
      const suiteFailed = suite.checks.some((c) => c.status === "fail")
      const suiteWarned = suite.checks.some((c) => c.status === "warn")
      console.log(`\n[${suiteFailed ? "FAIL" : suiteWarned ? "WARN" : "PASS"}] ${suite.name}`)
      for (const check of suite.checks) {
        console.log(`  ${check.status === "pass" ? "ok " : check.status === "warn" ? "warn" : "FAIL"}  ${check.name} — ${check.detail}`)
        total += 1
        if (check.status === "fail") failed += 1
        if (check.status === "warn") warned += 1
      }
    }
    return { failed, warned, total }
  }
}
