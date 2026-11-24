# AGENTS.md

Notes for AI coding assistants working on this repo. Humans: see CONTRIBUTING.md.

## What this project does

`datarecipe` is a TypeScript CLI. It reads a YAML recipe (sites + fields) and
writes a dataset to `output/`:

- **table mode**: Olostep Map picks one page per site (`find_page`), Olostep
  Scrape with `llm_extract` fills the fields. Output: CSV, JSONL, report.md.
- **text mode**: Olostep Batch reads every page as markdown. Output: `.pages.jsonl`, report.md.
- `parser:` (table mode) uses an Olostep parser through Batch instead of `llm_extract`.

## Structure

Diagrams: docs/ARCHITECTURE.md (keep them in sync when the flow changes).

```
src/index.ts             commander setup; registers commands
src/commands/run.ts      `datarecipe <recipe>`: load, plan, confirm, run, print summary
src/commands/init.ts     `datarecipe init`: writes recipes/my-first-recipe.yml
src/lib/recipe.ts        YAML + zod validation -> Recipe
src/lib/schema.ts        fields -> JSON Schema for llm_extract
src/lib/olostep.ts       the ONLY web access: SDK client, OlostepRunner, error mapping
src/lib/mock.ts          fake Olostep for tests/CI, hidden --mock flag (same shapes as the SDK)
test/fixtures/           recipes for the fake Olostep
src/lib/pipeline.ts      recipe -> pages -> rows -> files
src/lib/csv.ts           CSV writer; src/lib/report.ts: report.md
src/lib/log.ts           stderr output, UserError, fail(); src/lib/env.ts: .env loader
```

## Commands

```bash
npm install          # also builds dist/ (prepare script)
npm run typecheck
npm run lint         # ESLint, type-aware
npm run format       # Prettier (code only; Markdown is left as written)
npm run check        # everything CI checks except the demo
npm test             # vitest, fully offline
npm run build        # tsup -> dist/cli.js
npm run smoke        # build + both fixture recipes against the fake Olostep
```

## Rules

- **All web access goes through `src/lib/olostep.ts`**, using the official
  `olostep` SDK. Don't add other HTTP clients, scraping libraries or AI SDKs.
- **Tests must run offline.** Use the fake client (`src/lib/mock.ts`, `test/fixtures/`) or the local fake
  server in `src/lib/olostep.test.ts` (it sets `OLOSTEP_API_BASE_URL`). No real keys in tests or CI.
- Runtime dependencies are only `commander`, `zod`, `yaml`, `olostep`. Ask before adding one.
- Progress and errors go to **stderr**; results go to **files**. Errors are
  `Error: <what happened + how to fix>` and exit 1. Throw `UserError` for
  messages meant for users; stack traces only with `DEBUG=datarecipe`.
- One failed page never stops a run. Only fatal errors (bad key, no credits,
  rate limit) stop it, and finished rows are still saved.
- Keep the core small. New ideas go to ISSUES.md unless asked for.
- Comments explain _why_, not what. Tests live next to the code (`*.test.ts`).
- Don't name other web-data or scraping companies anywhere in the repo.

## SDK facts worth knowing (olostep 1.2.x)

- API errors arrive wrapped in `OlostepAPIConnectionError`; the real error and
  its HTTP status are in `err.details.cause.details.response`. `explainError()` handles this.
- An invalid key comes back as HTTP **402** with `{"invalid_api_key": true}` (checked against the live API).
- `batch.items()` waits with a 10-minute timeout by default; we call
  `waitTillDone({ timeoutSeconds: 3600 })` ourselves, then `items({ waitForCompletion: false })`.
- New accounts can put at most 100 items in one batch (`BATCH_LIMIT`).
