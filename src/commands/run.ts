import { createInterface } from "node:readline/promises";

import { type Command, Option } from "commander";

import { displayPath, info, UserError } from "../lib/log.js";
import { createMockClient } from "../lib/mock.js";
import { createClient, OlostepRunner } from "../lib/olostep.js";
import { describePlan, type RunResult, runRecipe } from "../lib/pipeline.js";
import { loadRecipe } from "../lib/recipe.js";

// Small runs start right away so the first try is fast; bigger ones spend
// real credits, so we ask first.
const CONFIRM_ABOVE_PAGES = 20;

export interface RunOptions {
  yes?: boolean;
  mock?: boolean;
  out: string;
}

export function registerRun(program: Command): void {
  program
    .argument("[recipe]", "recipe file, e.g. recipes/saas-pricing.yml")
    .option("-y, --yes", "skip the confirmation question (for CI and scripts)")
    // Internal: lets tests and CI run the real pipeline against src/lib/mock.ts.
    .addOption(new Option("--mock").hideHelp())
    .option("--out <dir>", "folder for output files", "output")
    .action(async (recipe: string | undefined, opts: RunOptions) => {
      if (!recipe) program.help();
      await runCommand(recipe, opts);
    });
}

/** Returns undefined when the user cancels at the question. */
export async function runCommand(recipePath: string, opts: RunOptions): Promise<RunResult | undefined> {
  const recipe = loadRecipe(recipePath);
  const sites = `${recipe.sites.length} site${recipe.sites.length === 1 ? "" : "s"}`;
  info(`Recipe: ${recipe.name} (${opts.mock ? `${sites}, mock mode` : sites})`);

  // Check the key before asking anything, so a missing key fails in one step.
  const client = opts.mock ? createMockClient() : createClient();

  const plan = `Plan: ${describePlan(recipe)}.`;
  if (recipe.sites.length > CONFIRM_ABOVE_PAGES && !opts.yes) {
    if (!process.stdin.isTTY) {
      throw new UserError(`${plan} This run has more than ${CONFIRM_ABOVE_PAGES} pages; re-run with --yes to confirm.`);
    }
    if (!(await confirm(`${plan} Continue? (y/N) `))) {
      info("Cancelled. Nothing was sent to Olostep.");
      return undefined;
    }
  } else {
    info(plan);
  }

  const result = await runRecipe(recipe, new OlostepRunner(client), { outDir: opts.out, mock: Boolean(opts.mock) });
  const unit = recipe.mode === "text" ? "pages" : "rows";
  info(`Done: ${result.ok} ${unit} (${result.failed} failed). Saved to ${displayPath(result.mainFile)}`);
  info(`Report: ${displayPath(result.reportFile)}`);
  return result;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}
