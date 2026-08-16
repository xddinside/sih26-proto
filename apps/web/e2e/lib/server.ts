/**
 * Dev-server management for the e2e runner, issue #22.
 *
 * The saved-run loaders resolve `demo/fixtures/runs` by walking up from the
 * dev server's working directory (apps/web/src/features/.../load-store.ts).
 * This module builds a shadow root under the system temp directory whose
 * `demo/fixtures/runs` is a copy of the captured bundle
 * (`demo/saved-runs/`) — or any corrupted variant the suites write — and
 * starts the real Vite/TanStack Start dev server with that directory as its
 * working directory. The app code, config, and node_modules are symlinks to
 * `apps/web`, so nothing in the repo is modified and the bundle the UI
 * replays is exactly the captured export.
 *
 * The server is exposed through `portless` when the proxy is available
 * (`portless alias <name> <port>`), giving the stable
 * `https://<name>.localhost` URL the presentation uses; the harness falls
 * back to `http://127.0.0.1:<port>`.
 */
import { execFileSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, openSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const APPS_WEB = path.join(REPO_ROOT, "apps/web")
const CAPTURED_BUNDLE = path.join(REPO_ROOT, "demo", "saved-runs")
const VITE_BIN = path.join(APPS_WEB, "node_modules", ".bin", "vite")
export const APP_NAME = "sih-replay-e2e"
const DEFAULT_PORT = 4322

export interface DevServer {
  baseUrl: string
  port: number
  shadowRoot: string
  bundleDir: string
  viaPortless: boolean
  close: () => Promise<void>
}

function freePort(): number {
  return DEFAULT_PORT + Math.floor(Math.random() * 500)
}

function waitForHttp(url: string, timeoutMs: number, maxStatus = 499): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`dev server did not answer at ${url}`))
        return
      }
      try {
        const response = await fetch(url, { redirect: "manual" })
        if (response.status < maxStatus) {
          resolve()
          return
        }
      } catch {
        // not up yet
      }
      setTimeout(tick, 300)
    }
    tick()
  })
}

function portlessAvailable(): boolean {
  try {
    execFileSync("portless", ["doctor"], { stdio: "ignore", timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/** Reset the shadow bundle to the pristine captured export. */
export function restorePristineBundle(server: DevServer): void {
  rmSync(server.bundleDir, { recursive: true, force: true })
  cpSync(CAPTURED_BUNDLE, server.bundleDir, { recursive: true })
}

/**
 * Build the shadow root, start the dev server over the captured bundle, and
 * expose it through portless when available.
 */
export async function startDevServer(): Promise<DevServer> {
  const port = freePort()
  const shadowRoot = mkdtempSync(path.join(os.tmpdir(), "sih26-e2e-"))
  const bundleDir = path.join(shadowRoot, "demo", "fixtures", "runs")
  rmSync(bundleDir, { recursive: true, force: true })
  cpSync(CAPTURED_BUNDLE, bundleDir, { recursive: true })

  for (const name of ["index.html", "src", "vite.config.ts", "package.json", "tsconfig.json", "node_modules"]) {
    if (!existsSync(path.join(shadowRoot, name))) {
      symlinkSync(path.join(APPS_WEB, name), path.join(shadowRoot, name))
    }
  }

  const log = path.join(shadowRoot, "vite.log")
  const logFd = openSync(log, "w")
  const child = spawn(VITE_BIN, ["dev", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
    cwd: shadowRoot,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  })
  child.unref()

  const directUrl = `http://127.0.0.1:${port}`
  await waitForHttp(directUrl, 45_000)

  let baseUrl = directUrl
  let viaPortless = false
  if (portlessAvailable()) {
    try {
      execFileSync("portless", ["alias", APP_NAME, String(port)], { stdio: "ignore", timeout: 15_000 })
      await waitForHttp(`https://${APP_NAME}.localhost`, 15_000, 400)
      baseUrl = `https://${APP_NAME}.localhost`
      viaPortless = true
    } catch {
      // fall back to the direct URL
    }
  }

  return {
    baseUrl,
    port,
    shadowRoot,
    bundleDir,
    viaPortless,
    close: async () => {
      try {
        execFileSync("portless", ["alias", "--remove", APP_NAME], { stdio: "ignore", timeout: 10_000 })
      } catch {
        // no alias to remove
      }
      child.kill("SIGTERM")
      rmSync(shadowRoot, { recursive: true, force: true })
    },
  }
}
