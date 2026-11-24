// Recipe -> pages -> rows -> files. Each step maps to one Olostep feature:
// Map finds pages, Scrape + llm_extract fills fields, Batch reads many pages.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { toCsv } from "./csv.js";
import { displayPath, info, progress, UserError } from "./log.js";
import {
  BATCH_LIMIT,
  CONCURRENCY,
  explainError,
  mapLimit,
  type OlostepRunner,
  type Outcome,
  parseJsonContent,
  pickFields,
} from "./olostep.js";
import type { Recipe } from "./recipe.js";
import { buildReport, type FailedPage } from "./report.js";

export interface RunResult {
  ok: number;
  failed: number;
  /** The file people open first: the CSV (table) or pages JSONL (text). */
  mainFile: string;
  reportFile: string;
}

interface Page {
  site: string;
  url: string;
}

type Row = Record<string, string>;

/**
 * One outcome per input item, in input order. An item is `undefined` when the
 * run stopped (bad key, no credits) before it started; `stopped` says why.
 */
interface Step<T> {
  outcomes: (Outcome<T> | undefined)[];
  stopped?: string;
}

/** What a mode produced: the files to write and the numbers for the report. */
interface ModeOutput {
  mainFile: string;
  files: Map<string, string>;
  ok: number;
  /** Table mode: the successful rows, for the report's per-field check. */
  okRows: Row[];
  failed: FailedPage[];
  stopped?: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "3 Olostep Map calls + 3 Olostep extractions": what a run will spend. */
export function describePlan(recipe: Recipe): string {
  const n = recipe.sites.length;
  const parts: string[] = [];
  if (recipe.findPage) parts.push(plural(n, "Olostep Map call"));
  if (recipe.mode === "table" && !recipe.parser) {
    parts.push(plural(n, "Olostep extraction"));
  } else {
    const pages = recipe.parser ? `${plural(n, "page")}, parser ${recipe.parser}` : plural(n, "page");
    parts.push(`${plural(Math.ceil(n / BATCH_LIMIT), "Olostep Batch")} (${pages})`);
  }
  return parts.join(" + ");
}

export async function runRecipe(
  recipe: Recipe,
  runner: OlostepRunner,
  options: { outDir: string; mock: boolean },
): Promise<RunResult> {
  const found = await findPages(recipe, runner);
  // Nothing has been extracted yet, so there is nothing to save.
  if (found.stopped) throw new UserError(found.stopped);

  const base = join(options.outDir, recipe.slug);
  const output =
    recipe.mode === "table"
      ? await extractTable(recipe, runner, found.pages, base)
      : await readText(runner, found.pages, base);
  const failed = [...found.failed, ...output.failed];

  // Nothing finished (e.g. a bad key): keep any earlier output instead of
  // replacing a good dataset with an empty one.
  if (output.stopped && output.ok === 0) throw new UserError(output.stopped);

  const reportFile = `${base}.report.md`;
  output.files.set(
    reportFile,
    buildReport({
      recipe,
      mock: options.mock,
      pagesFound: found.pages.length,
      ok: output.ok,
      failed,
      okRows: output.okRows,
      calls: runner.calls,
      mainFile: displayPath(output.mainFile),
      stopped: output.stopped,
    }),
  );
  // Written together at the end, so a run never leaves a CSV without its report.
  mkdirSync(options.outDir, { recursive: true });
  for (const [file, text] of output.files) writeFileSync(file, text);

  if (output.stopped) {
    const unit = recipe.mode === "text" ? "page" : "row";
    const what = output.ok === 1 ? `1 finished ${unit} was` : `${output.ok} finished ${unit}s were`;
    throw new UserError(`${output.stopped} The ${what} already saved to ${displayPath(output.mainFile)}.`);
  }
  return { ok: output.ok, failed: failed.length, mainFile: output.mainFile, reportFile };
}

/** One page per site: the best Map match for find_page, or the site itself. */
async function findPages(
  recipe: Recipe,
  runner: OlostepRunner,
): Promise<{ pages: Page[]; failed: FailedPage[]; stopped?: string }> {
  const query = recipe.findPage;
  if (!query) return { pages: recipe.sites.map((site) => ({ site, url: site })), failed: [] };

  const step = await eachSafely(recipe.sites, "Finding pages", (site) => runner.findPage(site, query));
  const pages: Page[] = [];
  const failed: FailedPage[] = [];
  recipe.sites.forEach((site, i) => {
    const outcome = step.outcomes[i];
    if (outcome?.ok) pages.push({ site, url: outcome.value });
    else if (outcome) failed.push({ site, url: site, error: `Finding page: ${outcome.error}` });
  });
  return { pages, failed, stopped: step.stopped };
}

/** Table mode: fields per page with llm_extract, or with an Olostep parser via Batch. */
async function extractTable(recipe: Recipe, runner: OlostepRunner, pages: Page[], base: string): Promise<ModeOutput> {
  const names = Object.keys(recipe.fields);
  const step = recipe.parser
    ? await readWithBatch(runner, pages, {
        format: "json",
        parser: recipe.parser,
        parse: (content) => pickFields(parseJsonContent(content), names),
      })
    : await eachSafely(pages, "Extracting fields with Olostep", (page) =>
        runner.extractFields(page.url, recipe.fields),
      );

  const rows: Row[] = [];
  const okRows: Row[] = [];
  const failed: FailedPage[] = [];
  const blank = Object.fromEntries(names.map((name) => [name, ""]));
  // Rows follow the recipe's site order, not the order calls finished in.
  pages.forEach((page, i) => {
    const outcome = step.outcomes[i];
    if (!outcome) return;
    const where = { source_url: page.url, site: page.site };
    if (outcome.ok) {
      okRows.push(outcome.value);
      rows.push({ ...outcome.value, ...where, status: "ok" });
    } else {
      failed.push({ site: page.site, url: page.url, error: outcome.error });
      rows.push({ ...blank, ...where, status: "failed", error: outcome.error });
    }
  });

  const mainFile = `${base}.csv`;
  // The CSV is for people, so it holds only rows that worked; the JSONL keeps every row.
  const csv = toCsv(
    [...names, "source_url"],
    rows.filter((row) => row.status === "ok"),
  );
  return {
    mainFile,
    files: new Map([
      [mainFile, csv],
      [`${base}.jsonl`, toJsonl(rows)],
    ]),
    ok: okRows.length,
    okRows,
    failed,
    stopped: step.stopped,
  };
}

/** Text mode: every page's markdown through Olostep Batch, one JSON line each. */
async function readText(runner: OlostepRunner, pages: Page[], base: string): Promise<ModeOutput> {
  const step = await readWithBatch(runner, pages, {
    format: "markdown",
    parse: (content) => (typeof content === "string" ? content : JSON.stringify(content)),
  });

  const lines: { site: string; url: string; markdown: string }[] = [];
  const failed: FailedPage[] = [];
  pages.forEach((page, i) => {
    const outcome = step.outcomes[i];
    if (outcome?.ok) lines.push({ site: page.site, url: page.url, markdown: outcome.value });
    else if (outcome) failed.push({ site: page.site, url: page.url, error: outcome.error });
  });

  const mainFile = `${base}.pages.jsonl`;
  return {
    mainFile,
    files: new Map([[mainFile, toJsonl(lines)]]),
    ok: lines.length,
    okRows: [],
    failed,
    stopped: step.stopped,
  };
}

function toJsonl(rows: object[]): string {
  return rows.length ? rows.map((row) => JSON.stringify(row)).join("\n") + "\n" : "";
}

/**
 * Run `fn` for each item, CONCURRENCY at a time. A failure only marks that
 * item, except a fatal one (bad key, no credits), which stops new work.
 */
async function eachSafely<T, R>(items: T[], label: string, fn: (item: T) => Promise<R>): Promise<Step<R>> {
  const bar = progress(label, items.length);
  const outcomes = new Array<Outcome<R> | undefined>(items.length);
  let stopped: string | undefined;
  try {
    await mapLimit(items, CONCURRENCY, async (item, i) => {
      try {
        outcomes[i] = { ok: true, value: await fn(item) };
      } catch (err) {
        const { message, fatal } = explainError(err);
        if (fatal) throw new UserError(message);
        outcomes[i] = { ok: false, error: message };
      }
      bar.tick();
    });
  } catch (err) {
    stopped = err instanceof Error ? err.message : String(err);
  }
  bar.done();
  return { outcomes, stopped };
}

/** Read pages through Olostep Batch and turn each page's content into a value with `parse`. */
async function readWithBatch<T>(
  runner: OlostepRunner,
  pages: Page[],
  options: { format: "markdown" | "json"; parser?: string; parse: (content: unknown) => T },
): Promise<Step<T>> {
  if (pages.length === 0) return { outcomes: [] };
  const id = (i: number) => `page-${i}`;
  let bar: ReturnType<typeof progress> | undefined;
  try {
    const results = await runner.readBatch(
      pages.map((page, i) => ({ id: id(i), url: page.url })),
      {
        format: options.format,
        parser: options.parser,
        onStarted: () => {
          info(
            `Olostep Batch started for ${pages.length} pages. ` +
              "Waiting for it to finish (big batches can take up to 25 minutes)…",
          );
          bar = progress("Reading pages with Olostep Batch", pages.length);
        },
        onItem: () => bar?.tick(),
      },
    );
    bar?.done();
    const outcomes = pages.map((_, i): Outcome<T> => {
      const result = results.get(id(i)) ?? { ok: false, error: "Olostep Batch returned no result for this page" };
      if (!result.ok) return result;
      try {
        return { ok: true, value: options.parse(result.value) };
      } catch (err) {
        return { ok: false, error: explainError(err).message };
      }
    });
    return { outcomes };
  } catch (err) {
    bar?.done();
    const { message, fatal } = explainError(err);
    if (fatal) return { outcomes: [], stopped: message };
    return { outcomes: pages.map(() => ({ ok: false, error: `Olostep Batch failed: ${message}` })) };
  }
}
