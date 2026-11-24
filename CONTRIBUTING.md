# Contributing to datarecipe

Thanks for helping! The test suite runs offline against a fake Olostep, so CI
never needs a real key; use your own key in `.env` to try changes on real sites.

Good places to start: issues labeled
[`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
(also listed in [ISSUES.md](ISSUES.md)), or a new recipe (see below).

## Setup

Requires Node.js 18 or newer.

```bash
git clone https://github.com/Anasyaseen92/datarecipe.git
cd datarecipe
npm install                 # installs and builds dist/
npm run smoke               # built CLI end to end against the fake Olostep
```

Run your working copy without building:

```bash
npm start -- recipes/my-first-recipe.yml
```

This needs a `.env` file with `OLOSTEP_API_KEY=your-key` (get a key at
https://www.olostep.com/dashboard/api-keys).

## Tests

```bash
npm test          # all tests, offline
npm run test:watch
npm run typecheck
npm run lint      # ESLint (typescript-eslint, type-aware)
npm run format    # Prettier; CI runs format:check
npm run check     # typecheck + lint + format:check + tests, same as CI
```

Tests live next to the code they test (`src/lib/csv.ts` and `src/lib/csv.test.ts`).
Two ways to test without the network:

- **Fake client**: `src/lib/mock.ts` is a fake Olostep with three made-up companies,
  selected with the hidden `--mock` flag. `src/commands/run.test.ts` runs the
  recipes in `test/fixtures/` this way.
- **Local fake server**: `src/lib/olostep.test.ts` starts a `node:http` server and
  points the real SDK at it with `OLOSTEP_API_BASE_URL`. Use it to check the exact
  requests sent to Olostep.

## Project structure

For diagrams of the run flow, error handling and module map, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
src/
  index.ts              CLI entry (commander)
  commands/             one command per file, each exports registerX(program)
    run.ts              datarecipe <recipe.yml>
    init.ts             datarecipe init
  lib/                  shared code
    recipe.ts           load + validate recipes (zod)
    schema.ts           fields -> JSON Schema
    olostep.ts          all Olostep calls (the only web access)
    mock.ts             fake Olostep for tests (--mock)
    pipeline.ts         recipe -> pages -> rows -> files
    csv.ts, report.ts   output writers
    log.ts, env.ts      stderr helpers, .env loader
recipes/                starter recipes
test/fixtures/          recipes for the fake Olostep (tests, npm run smoke)
```

## Conventions

- TypeScript strict, ESM, Node 18+. Built with tsup into `dist/cli.js`.
- **All web access goes through `src/lib/olostep.ts`** with the official `olostep` SDK.
- Runtime dependencies are only `commander`, `zod`, `yaml` and `olostep`. Open an
  issue before adding one.
- Progress and errors go to stderr, results go to files.
- Errors say what happened and how to fix it: `Error: <message>`, exit code 1.
  Throw `UserError` for those. Stack traces only with `DEBUG=datarecipe`.
- Short comments that explain _why_.
- Keep the core small. A big idea is welcome as an issue first.

## Add a recipe

A recipe is a small YAML file in `recipes/`. Adding one takes about 5 minutes:

1. **Copy a recipe** that is close to what you want:
   `cp recipes/careers-pages.yml recipes/your-recipe.yml` (or run `npx datarecipe init`).
2. **Pick 3 to 5 real sites.** Small recipes are easy to review and cheap to run.
3. **Set `find_page`** to the word a site would use for the page (`pricing`,
   `contact`, `careers`), or delete it to use the homepage.
4. **Describe each field in plain English**, with the exact format you want:
   "monthly price of the cheapest paid plan as a number only, e.g. 25" beats "price".
   Use snake_case names; they become CSV columns.
5. **Try it**: `npx datarecipe recipes/your-recipe.yml`, then open the CSV and the
   report. If a field is often empty, sharpen its description.
6. **Add a comment at the top** with what it collects and roughly how many
   Olostep calls it makes, then open a pull request using the "New recipe" template.

Good recipes use public pages, respect each site's terms, and don't collect
personal data about private individuals.

## Add an output format

1. Write a function that turns rows into file content, in its own file:
   `src/lib/<format>.ts` with a test next to it (see `src/lib/csv.ts`).
2. In `src/lib/pipeline.ts`, add the file to the `files` map in the table branch
   (or the text branch), next to the CSV and JSONL.
3. If the format is optional, add a `--format` flag in `src/commands/run.ts` and pass it through.
4. Add a check to `src/commands/run.test.ts` and document the format in the README.

## Pull request checklist

- [ ] `npm run check` and `npm run smoke` pass
- [ ] New behavior has an offline test
- [ ] Web access only through `src/lib/olostep.ts`
- [ ] No new runtime dependency (or discussed in an issue)
- [ ] README and CHANGELOG updated if users will notice

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Contributions are released under the [MIT License](LICENSE).
