import { existsSync, readFileSync } from "node:fs";

/**
 * Load KEY=value lines from .env.local and .env in the current folder.
 * Real environment variables always win. Hand-rolled because Node 18 has no
 * built-in loader and we keep runtime dependencies to the essentials.
 */
export function loadEnvFiles(files = [".env.local", ".env"]): void {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key = "", raw = ""] = match;
      const quoted = raw.trim().match(/^(['"])(.*)\1$/);
      const value = quoted ? (quoted[2] ?? "") : raw.replace(/\s+#.*$/, "").trim();
      if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
    }
  }
}
