import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Read the version at build time so `datarecipe --version` always matches
// the published package.json instead of a hardcoded string that goes stale.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  entry: { cli: "src/index.ts" },
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __DATARECIPE_VERSION__: JSON.stringify(pkg.version),
  },
});
