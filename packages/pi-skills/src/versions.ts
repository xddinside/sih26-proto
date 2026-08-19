import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

/** Resolve dependency metadata from this package's own dependency graph.
 * Rehearsals must not depend on Bun hoisting a transitive package into the
 * repository root node_modules directory. */
export function installedVersion(packageName: "pi-agent-core" | "pi-ai"): string {
  const manifestPath = require.resolve(`@earendil-works/${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string }
  return manifest.version ?? "unknown"
}
