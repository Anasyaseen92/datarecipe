import type { CallType } from "./olostep.js";
import type { Recipe } from "./recipe.js";

export interface FailedPage {
  site: string;
  url: string;
  error: string;
}

export interface ReportInput {
  recipe: Recipe;
  mock: boolean;
  pagesFound: number;
  ok: number;
  failed: FailedPage[];
  /** Table mode: the successful rows, used for the per-field quality check. */
  okRows: Record<string, string>[];
  calls: Record<CallType, number>;
  /** Main output file, e.g. output/x.csv */
  mainFile: string;
  /** Set when the run stopped before every page was processed. */
  stopped?: string;
}

const cell = (s: string | number) =>
  String(s)
    .replace(/\|/g, "\\|")
    .replace(/\s*\r?\n\s*/g, " ");

export function buildReport(r: ReportInput): string {
  const { recipe } = r;
  const out: string[] = [];
  out.push(`# datarecipe report: ${recipe.name}`, "");
  out.push(
    `Mode: **${recipe.mode}**${recipe.parser ? ` (parser \`${recipe.parser}\`)` : ""}${r.mock ? " · **mock mode** (test fixtures)" : ""}`,
    "",
  );

  if (r.stopped) {
    out.push(`> **Stopped early:** ${r.stopped}`, `> Pages finished before the stop are saved below.`, "");
  }

  const unit = recipe.mode === "text" ? "Pages" : "Rows";
  out.push("## Totals", "", "| | |", "|---|---:|");
  out.push(
    `| Sites | ${recipe.sites.length} |`,
    `| Pages found | ${r.pagesFound} |`,
    `| ${unit} ok | ${r.ok} |`,
    `| ${unit} failed | ${r.failed.length} |`,
    "",
  );

  if (recipe.mode === "table") {
    out.push(
      "## Quality",
      "",
      "Empty values per field, out of the rows that succeeded. Empty usually means the page does not say; check `source_url`.",
      "",
    );
    out.push("| Field | Empty | Filled |", "|---|---:|---:|");
    for (const field of Object.keys(recipe.fields)) {
      const empty = r.okRows.filter((row) => !row[field]).length;
      out.push(`| ${cell(field)} | ${empty} | ${r.okRows.length - empty} |`);
    }
    out.push("");
  }

  out.push("## Failed pages", "");
  if (r.failed.length === 0) {
    out.push("None.", "");
  } else {
    out.push("| Site | Page | Reason |", "|---|---|---|");
    for (const f of r.failed) out.push(`| ${cell(f.site)} | ${cell(f.url)} | ${cell(f.error)} |`);
    out.push("");
  }

  out.push("## Olostep calls", "", "| Type | Calls |", "|---|---:|");
  out.push(`| Map (find pages) | ${r.calls.map} |`);
  out.push(`| Scrape with llm_extract | ${r.calls.scrape} |`);
  out.push(`| Batch | ${r.calls.batch} |`);
  out.push(`| Retrieve (batch results) | ${r.calls.retrieve} |`, "");
  if (r.mock) out.push("Mock mode: these calls went to the test fake in src/lib/mock.ts.", "");

  out.push("## Next steps", "", nextStep(r), "");
  return out.join("\n");
}

function nextStep(r: ReportInput): string {
  if (r.recipe.mode === "text") {
    return `Load the pages in Python with \`load_dataset("json", data_files="${r.mainFile}")\` from Hugging Face \`datasets\`, or add more sites with \`sites_file\`.`;
  }
  return `Open \`${r.mainFile}\` and spot-check a few rows against \`source_url\`. If a field is often empty, make its description more specific.`;
}
