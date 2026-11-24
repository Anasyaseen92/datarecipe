# Contributor issues

Ten starter issues for datarecipe. `scripts/create-issues.sh` turns each
`## N. Title` section below into a GitHub issue, so edit this file, not the script.

Every issue follows the project rules: all web access goes through
`src/lib/olostep.ts`, tests run offline, and the core stays small.

## 1. Recipe packs: e-commerce, universities, events

**Labels:** `good first issue`, `recipe`

Add three small recipes so people can start from a dataset close to theirs:

- `recipes/ecommerce-product-pages.yml`: a few public product pages (name, price, currency, in stock).
- `recipes/university-tuition.yml`: tuition pages of a few universities (university, tuition, currency, academic year).
- `recipes/tech-events.yml`: a few conference homepages (event name, dates, city, ticket price).

**Acceptance criteria**

- Each recipe has 3 to 5 real, public sites and a top comment with what it collects and its Olostep calls.
- Each recipe loads without errors (run it for real with a small site list).
- The README's Recipes section mentions the new recipes.

**Files to touch:** `recipes/*.yml`, `README.md`

## 2. Parquet export

**Labels:** `good first issue`, `output`

Data teams load Parquet faster than CSV. Add `--format parquet` to also write
`output/<name>.parquet` in table mode (and `<name>.pages.parquet` in text mode).

**Acceptance criteria**

- `npx datarecipe recipes/my-first-recipe.yml --format parquet` writes a Parquet file with the same columns as the CSV.
- A test reads the file back and checks the rows.
- If this needs a new dependency, explain the choice in the PR (small, pure JS, maintained).
- README "Output" section mentions the flag.

**Files to touch:** `src/lib/parquet.ts` (new), `src/lib/pipeline.ts`, `src/commands/run.ts`, `src/lib/parquet.test.ts`, `README.md`

## 3. `--limit N` flag

**Labels:** `good first issue`

Let people try a big recipe on a few sites first, to check fields and cost:
`npx datarecipe recipes/big.yml --limit 5` runs only the first 5 sites.

**Acceptance criteria**

- `--limit 5` uses the first 5 sites; the plan line and report show 5 sites.
- `--limit 0`, negative or non-numbers give `Error: --limit must be a positive whole number`.
- A test in `src/commands/run.test.ts` covers it with `--mock`.

**Files to touch:** `src/commands/run.ts`, `src/commands/run.test.ts`, `README.md`

## 4. Excel (.xlsx) export

**Labels:** `good first issue`, `output`

Many people open results in Excel. Add `--format xlsx` to write `output/<name>.xlsx`
in table mode, with a bold header row and the report totals in a second sheet.

**Acceptance criteria**

- The file opens in Excel, LibreOffice and Google Sheets with the same columns as the CSV.
- Cells keep the CSV's formula protection (values starting with `=`, `+`, `-`, `@`).
- A test reads the workbook back.
- Any new dependency is justified in the PR.

**Files to touch:** `src/lib/xlsx.ts` (new), `src/lib/pipeline.ts`, `src/commands/run.ts`, `src/lib/xlsx.test.ts`, `README.md`

## 5. Field types: number, boolean, list

**Labels:** `good first issue`

Today every field is a string. Let a recipe ask for a type, so `price` can be a
number and `features` a list:

```yaml
fields:
  company: company name
  price: { description: cheapest paid plan per month in USD, type: number }
  free_plan: { description: is there a free plan, type: boolean }
  features: { description: main features, type: list }
```

**Acceptance criteria**

- The short form (`name: description`) keeps working.
- `buildSchema` sends `number`, `boolean` or `array` of strings in the JSON Schema.
- JSONL keeps real types; CSV writes lists joined with `; `.
- Invalid types give `recipes/x.yml: fields.price.type: use string, number, boolean or list`.
- Tests for the recipe parser, schema builder and row output.

**Files to touch:** `src/lib/recipe.ts`, `src/lib/schema.ts`, `src/lib/olostep.ts` (`pickFields`), `src/lib/csv.ts`, tests next to each

## 6. Find sites with Olostep Search (no site list needed)

**Labels:** `help wanted`, `olostep`

Let a recipe start from a question instead of a list:

```yaml
name: email-api-pricing
search: transactional email API providers
max_sites: 10
find_page: pricing
fields: ...
```

Use Olostep Search (`client.searches.create` in the SDK, see https://docs.olostep.com)
to get candidate sites, keep one URL per domain, then continue as usual.

**Acceptance criteria**

- `search` works instead of `sites` / `sites_file`; using both gives a clear recipe error.
- The plan line includes the Search call; the report counts it under "Olostep calls".
- The mock client returns fake search results; tests run offline.
- README recipe reference documents `search` and `max_sites`.

**Files to touch:** `src/lib/recipe.ts`, `src/lib/olostep.ts`, `src/lib/pipeline.ts`, `src/lib/mock.ts`, `src/lib/report.ts`, tests, `README.md`

## 7. Upload text datasets to Hugging Face (`--hf <repo>`)

**Labels:** `help wanted`, `output`

Text mode already writes `<name>.pages.jsonl` in a format `datasets` can load.
Add `--hf user/dataset` to upload it (plus the report as the dataset card) to the
Hugging Face Hub, using `HF_TOKEN` from the environment.

**Acceptance criteria**

- Uploads `pages.jsonl` and a `README.md` dataset card (built from the report, with a note about content rights).
- Missing `HF_TOKEN` gives a helpful error, like the Olostep key error.
- Tests use a local fake server; no network in CI.
- This is the only non-Olostep network call, so keep it in its own file and document why in `AGENTS.md`.

**Files to touch:** `src/lib/huggingface.ts` (new), `src/commands/run.ts`, tests, `README.md`, `AGENTS.md`

## 8. Resume a stopped run

**Labels:** `help wanted`

When a run stops (out of credits, Ctrl+C), the finished rows are saved, but
running again pays for them again. Add `--resume`: read `output/<name>.jsonl`,
skip sites that already have a row with `status: "ok"`, and append the rest.

**Acceptance criteria**

- `--resume` after a partial run only calls Olostep for missing or failed sites; the plan line shows the smaller number.
- The final CSV, JSONL and report cover all sites, as if the run had never stopped.
- Text mode resumes from `<name>.pages.jsonl`.
- Tests simulate a stopped run with the local fake server (see `src/lib/olostep.test.ts`).

**Files to touch:** `src/commands/run.ts`, `src/lib/pipeline.ts`, tests, `README.md`

## 9. Scheduled refresh with Olostep Monitors

**Labels:** `help wanted`, `olostep`

Datasets go stale: prices change. Explore keeping a recipe fresh on a schedule
with Olostep Monitors (`client.monitors` in the SDK). Check the docs first
(https://docs.olostep.com); if the Schedules API fits recipes better, say so in the issue
before building.

**Acceptance criteria**

- A short design comment on this issue first: which Olostep feature, what a recipe or command looks like (e.g. `datarecipe schedule recipes/x.yml --every week`), and the credits it uses.
- The implementation goes through `src/lib/olostep.ts` and has offline tests with a fake server.
- README explains how to list and stop scheduled refreshes.

**Files to touch:** `src/commands/schedule.ts` (new), `src/lib/olostep.ts`, `src/index.ts`, tests, `README.md`

## 10. Crawl mode: many pages per site with Olostep Crawl

**Labels:** `help wanted`, `olostep`

Text mode reads one page per site. For AI datasets people often want a whole
docs site. Add `crawl: { max_pages: 50 }` to text-mode recipes, using Olostep
Crawl (`client.crawls.create` in the SDK) to collect many pages per site.

**Acceptance criteria**

- Each crawled page becomes one line in `<name>.pages.jsonl` (`site`, `url`, `markdown`).
- The plan line shows the crawl and its page limit, so people can predict credits.
- The mock client supports crawls; tests run offline.
- README explains when to use crawl vs. `sites_file`.

**Files to touch:** `src/lib/recipe.ts`, `src/lib/olostep.ts`, `src/lib/pipeline.ts`, `src/lib/mock.ts`, tests, `README.md`
