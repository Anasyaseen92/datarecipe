# datarecipe

[![CI](https://github.com/Anasyaseen92/datarecipe/actions/workflows/ci.yml/badge.svg)](https://github.com/Anasyaseen92/datarecipe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Turn hundreds of websites into a clean dataset with one recipe file. Powered by [Olostep](https://www.olostep.com).

```yaml
# recipes/saas-pricing.yml
name: saas-pricing
sites:
  - https://resend.com
  - https://supabase.com
find_page: pricing # Olostep Map finds the pricing page on each site
fields: # Olostep AI extraction fills one column per field
  company: company name
  free_plan: is there a free plan (yes/no)
  price_per_month: price of the cheapest paid plan per month
```

```bash
npx datarecipe recipes/saas-pricing.yml   # -> output/saas-pricing.csv
```

## Quick start

Needs [Node.js 18+](https://nodejs.org) and an Olostep API key.

1. **Get your API key** at https://www.olostep.com/dashboard/api-keys (the free plan includes 500 credits).
2. **Install:**
   ```bash
   git clone https://github.com/Anasyaseen92/datarecipe.git
   cd datarecipe
   npm install
   ```
3. **Add the key to `.env`:**
   ```bash
   cp .env.example .env        # Windows: copy .env.example .env
   ```
   then edit `.env` so it reads `OLOSTEP_API_KEY=your-key`.
4. **Create a recipe:**
   ```bash
   npx datarecipe init
   ```
   This writes `recipes/my-first-recipe.yml`, with a comment on every field.
5. **Edit the recipe**: your sites, the page to look for, the columns you want.
6. **Run it:**
   ```bash
   npx datarecipe recipes/my-first-recipe.yml
   ```

The starter recipe has 3 sites, so it makes 3 Map calls and 3 extractions (about 33 credits)
and usually finishes in well under a minute:

```text
Recipe: my-first-recipe (3 sites)
Plan: 3 Olostep Map calls + 3 Olostep extractions.
Finding pages… 3/3
Extracting fields with Olostep… 3/3
Done: 3 rows (0 failed). Saved to output/my-first-recipe.csv
Report: output/my-first-recipe.report.md
```

## What you get

- **`output/<name>.csv`**: one row per site, one column per field, plus `source_url` so
  every value can be checked. Opens cleanly in Excel, Google Sheets and pandas.
- **`output/<name>.jsonl`**: every row, including failed ones with the reason.
- **`output/<name>.report.md`**: totals, empty values per field, failed pages, and the
  Olostep calls the run made.

`npm start -- recipes/my-first-recipe.yml` does the same as `npx datarecipe …`, straight from the TypeScript source.

## Recipe reference

| Key | Required | What it does |
| --- | --- | --- |
| `name` | yes | Dataset name. Output files are `output/<name>.*` (made file-safe, e.g. `My Data` → `my-data`). |
| `sites` | `sites` or `sites_file` | List of websites. `example.com` and `https://example.com` both work. |
| `sites_file` | `sites` or `sites_file` | Text file with one URL per line, `#` for comments. Path is relative to the recipe. |
| `find_page` | no | Search query for Olostep Map, e.g. `pricing`. It picks the **one** best page per site, preferring the main page (`/pricing`) over blog posts, docs and translated copies. Omit it to use the site URL itself. |
| `fields` | in table mode | `column: plain-English description`. Each becomes a CSV column. Specific descriptions give better results. |
| `mode` | no | `table` (default) or `text`. |
| `parser` | no | Table mode only: an [Olostep parser](https://docs.olostep.com/features/structured-content/parsers) id (e.g. `@olostep/extract-emails`). Uses Batch + the parser instead of AI extraction; columns are taken from the parser's JSON by field name. |

Mistakes are reported with the file and the field, e.g.
`Error: recipes/x.yml: fields: add at least one field`.

### Command options

| Option | What it does |
| --- | --- |
| `-y, --yes` | Don't ask before running. Runs of more than 20 pages ask first; use this in CI. |
| `--out <dir>` | Output folder (default `output`). |

Set `DEBUG=datarecipe` to print stack traces with errors.

## Table mode vs text mode

|  | Table mode (default) | Text mode (`mode: text`) |
| --- | --- | --- |
| You get | One row per site with your `fields` | Each page's full content as markdown |
| Files | `<name>.csv`, `<name>.jsonl`, `<name>.report.md` | `<name>.pages.jsonl`, `<name>.report.md` |
| Olostep | Map + Scrape with `llm_extract` | Map (optional) + Batch |
| Good for | Spreadsheets, comparisons, lead lists | AI-ready text datasets, RAG, search indexes |
| Scale | Tens to hundreds of sites | Thousands of pages |

`<name>.jsonl` has every row including failures (`status: "ok"` or `"failed"` with
`error`); the CSV has only the rows that worked. Each `pages.jsonl` line is
`{"site", "url", "markdown"}` and loads with Hugging Face `datasets`:

```python
from datasets import load_dataset
ds = load_dataset("json", data_files="output/open-source-project-homepages.pages.jsonl")
```

## How it works

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for flow diagrams: the run step by step,
how pages are picked, how errors are handled, and where the code lives.

## How Olostep is used

All web access and all AI go through [Olostep](https://www.olostep.com) with the
official [`olostep` Node SDK](https://www.npmjs.com/package/olostep). One key, `OLOSTEP_API_KEY`.

| Step | Olostep feature | SDK call |
| --- | --- | --- |
| Find the right page on each site | [Map](https://docs.olostep.com/features/maps) with a search query | `client.maps.create({ url, searchQuery, topN: 10 })`, then the main page is picked (e.g. `/pricing`, not a blog post or translated copy) |
| Extract fields from a page | [Scrape](https://docs.olostep.com/features/scrapes) + [LLM extraction](https://docs.olostep.com/features/structured-content/llm-extraction) | `client.scrapes.create({ url, formats: ["json"], llmExtract: { schema, prompt } })` |
| Read thousands of pages | [Batch](https://docs.olostep.com/features/batches) | `client.batches.create(items)` → `waitTillDone()` → `items()` → `item.retrieve(["markdown"])` |
| Extract with a parser | [Parsers](https://docs.olostep.com/features/structured-content/parsers) via Batch | `client.batches.create(items, { parser })` → `item.retrieve(["json"])` |

Map and extraction calls run 5 at a time. Batches hold up to 100 pages each (the
limit for new Olostep accounts), so bigger lists are split into several batches.

## Olostep calls per run

The plan line tells you the calls before anything runs, and the report counts
them after. With `N` sites:

| Recipe | Calls | Credits (Olostep docs) |
| --- | --- | --- |
| table mode with `find_page` | N Map + N extractions | 1 per Map + 10 per extraction = **11 × N** |
| table mode, no `find_page` | N extractions | **10 × N** |
| table mode with `parser` | N Map (if `find_page`) + 1 Batch per 100 pages | 1 per Map + 1 to 5 per page, depending on the parser |
| text mode | N Map (if `find_page`) + 1 Batch per 100 pages | 1 per Map + **1 per page** |

So `recipes/saas-pricing.yml` (4 sites) costs about 44 credits, and 1,000 pages in
text mode cost about 1,000. Batch results are fetched with Olostep's Retrieve
endpoint, one call per page. Credit prices come from
[docs.olostep.com](https://docs.olostep.com) and can change; check there for current pricing.

## Recipes

Starter recipes are in [recipes/](recipes/): SaaS pricing, company contact pages,
careers pages, open-source project homepages (text mode), and developer docs
homepages (text mode).

Made a useful one? [Add a recipe in 5 minutes](recipes/README.md#add-a-recipe-in-5-minutes)
and open a pull request, so the next person can start from it.

## Honest limits

- **AI extraction can be wrong.** It can misread a page or miss a field. Every row
  has `source_url`, so you can check it; the report shows how many values are empty per field.
- **One page per site.** `find_page` picks the best match; if a site has no
  separate page, the homepage is used. Check `source_url`.
- **Respect websites.** Follow each site's terms of service and robots rules, and
  don't collect personal data you have no reason to hold.
- **Training data needs rights.** Don't use scraped content to train AI models
  unless you have the right to do so.
- **Errors stop the run only when they must.** A failed page becomes a `failed` row
  and the run goes on. A bad key, no credits or a rate limit stop it; rows that
  finished are saved.

## Development

```bash
npm install          # also builds dist/
npm run typecheck
npm test             # offline: a fake Olostep client and a local fake server
npm run build        # dist/cli.js
npm run check        # typecheck + lint + format check + tests
npm run smoke        # built CLI end to end against the fake Olostep
```

Project structure and conventions are in [CONTRIBUTING.md](CONTRIBUTING.md);
notes for AI coding assistants are in [AGENTS.md](AGENTS.md).

## Contributing

Contributions are welcome.
[ISSUES.md](ISSUES.md) lists ready-to-pick issues, from `good first issue`
(new recipes, `--limit`, Parquet and Excel export) to `help wanted` (Olostep
Search discovery, crawl mode, resuming runs). Read [CONTRIBUTING.md](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Shaheer Amjad

---

Built on [Olostep](https://www.olostep.com), the web data API for AI. Docs: [docs.olostep.com](https://docs.olostep.com).
