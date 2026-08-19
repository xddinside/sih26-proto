import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Recursively load a saved bundle directory into a path -> bytes map. */
export function loadBundle(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.set(full.slice(dir.length + 1).replaceAll("\\", "/"), readFileSync(full, "utf8"));
      }
    }
  };
  walk(dir);
  return files;
}
