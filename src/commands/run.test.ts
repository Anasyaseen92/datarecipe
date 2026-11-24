import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { NO_KEY_MESSAGE } from "../lib/olostep.js";
import { runCommand } from "./run.js";

let stderr: string;
let out: string;

beforeEach(() => {
  stderr = "";
  out = mkdtempSync(join(tmpdir(), "datarecipe-"));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

const read = (name: string) => readFileSync(join(out, name), "utf8");

describe("datarecipe <recipe> --mock", () => {
  it("table mode writes CSV, JSONL and a report with correct counts", async () => {
    const result = await runCommand("test/fixtures/mock-table.yml", { mock: true, yes: true, out });
    expect(result).toMatchObject({ ok: 3, failed: 0 });

    const csv = read("mock-table.csv")
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(csv[0]).toBe("company,free_plan,price,annual_discount,source_url");
    expect(csv).toHaveLength(4);
    expect(csv[1]).toBe("Acme Analytics,yes,$29/month,20%,https://acme-analytics.example/pricing");

    const rows = read("mock-table.jsonl")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ site: "https://acme-analytics.example", status: "ok" });

    const report = read("mock-table.report.md");
    expect(report).toContain("| Sites | 3 |");
    expect(report).toContain("| Pages found | 3 |");
    expect(report).toContain("| Rows ok | 3 |");
    expect(report).toContain("| Rows failed | 0 |");
    expect(report).toContain("| annual_discount | 1 | 2 |");
    expect(report).toContain("| Map (find pages) | 3 |");
    expect(report).toContain("| Scrape with llm_extract | 3 |");

    expect(stderr).toContain("Plan: 3 Olostep Map calls + 3 Olostep extractions.");
    expect(stderr).toContain("Done: 3 rows (0 failed).");
  });

  it("text mode writes one JSON line per page and a report", async () => {
    const result = await runCommand("test/fixtures/mock-text.yml", { mock: true, yes: true, out });
    expect(result).toMatchObject({ ok: 3, failed: 0 });

    const lines = read("mock-text.pages.jsonl")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(Object.keys(lines[0])).toEqual(["site", "url", "markdown"]);
    expect(lines[0].markdown).toContain("# Acme Analytics");

    const report = read("mock-text.report.md");
    expect(report).toContain("| Pages ok | 3 |");
    expect(report).toContain("| Batch | 1 |");
    expect(report).toContain("| Retrieve (batch results) | 3 |");
  });

  it("records an unknown site as a failed row and still saves the rest", async () => {
    const recipe = join(out, "mixed.yml");
    writeFileSync(
      recipe,
      "name: mixed\nsites: [https://acme-analytics.example, https://unknown.example]\nfind_page: pricing\nfields:\n  company: company name\n",
    );
    const result = await runCommand(recipe, { mock: true, yes: true, out });
    expect(result).toMatchObject({ ok: 1, failed: 1 });
    const report = read("mixed.report.md");
    expect(report).toContain("| Pages found | 1 |");
    expect(report).toContain("| Rows failed | 1 |");
    expect(report).toContain("https://unknown.example");
  });
});

describe("helpful errors", () => {
  it("explains a missing API key", async () => {
    const saved = process.env.OLOSTEP_API_KEY;
    delete process.env.OLOSTEP_API_KEY;
    await expect(runCommand("test/fixtures/mock-table.yml", { out })).rejects.toThrow(NO_KEY_MESSAGE);
    if (saved !== undefined) process.env.OLOSTEP_API_KEY = saved;
  });

  it("asks for --yes before a big run when there is no terminal", async () => {
    const recipe = join(out, "big.yml");
    const sites = Array.from({ length: 21 }, (_, i) => `  - https://site${i}.example`).join("\n");
    writeFileSync(recipe, `name: big\nmode: text\nsites:\n${sites}\n`);
    const isTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;
    await expect(runCommand(recipe, { mock: true, out })).rejects.toThrow(/re-run with --yes/);
    process.stdin.isTTY = isTTY;
  });
});
