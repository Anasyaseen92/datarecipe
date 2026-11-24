import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEnvFiles } from "./env.js";

const KEYS = ["DR_PLAIN", "DR_QUOTED", "DR_COMMENT", "DR_EXPORTED", "DR_SET", "DR_FIRST"];

function envFile(text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "datarecipe-env-")), ".env");
  writeFileSync(file, text);
  return file;
}

afterEach(() => {
  for (const key of KEYS) Reflect.deleteProperty(process.env, key);
});

describe("loadEnvFiles", () => {
  it("reads plain, quoted, commented and exported values", () => {
    loadEnvFiles([
      envFile(
        [
          "# a comment line",
          "DR_PLAIN=abc",
          'DR_QUOTED="has # hash and spaces "',
          "DR_COMMENT=value   # trailing comment",
          "export DR_EXPORTED=yes",
          "not a valid line",
        ].join("\r\n"),
      ),
    ]);
    expect(process.env.DR_PLAIN).toBe("abc");
    expect(process.env.DR_QUOTED).toBe("has # hash and spaces ");
    expect(process.env.DR_COMMENT).toBe("value");
    expect(process.env.DR_EXPORTED).toBe("yes");
  });

  it("never overrides a variable that is already set", () => {
    process.env.DR_SET = "from-shell";
    loadEnvFiles([envFile("DR_SET=from-file")]);
    expect(process.env.DR_SET).toBe("from-shell");
  });

  it("lets earlier files win, so .env.local overrides .env", () => {
    loadEnvFiles([envFile("DR_FIRST=local"), envFile("DR_FIRST=shared")]);
    expect(process.env.DR_FIRST).toBe("local");
  });

  it("skips files that do not exist", () => {
    expect(() => loadEnvFiles([join(tmpdir(), "datarecipe-missing", ".env")])).not.toThrow();
  });
});
