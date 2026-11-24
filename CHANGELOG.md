# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-24

### Added

- `datarecipe <recipe.yml>`: run a recipe and write a dataset to `output/`.
- Table mode: Olostep Map finds one page per site (`find_page`), Olostep Scrape
  with `llm_extract` fills the recipe's `fields`. Writes CSV, JSONL and a report.
- Text mode: Olostep Batch reads every page as markdown into `<name>.pages.jsonl`
  (loadable with Hugging Face `datasets`).
- `parser:` in table mode uses an Olostep parser through Batch instead of `llm_extract`.
- `datarecipe init`: a commented starter recipe.
- Offline test suite with a fake Olostep client and a local fake server; `npm run smoke`.
- `--yes`: skip the confirmation asked before runs of more than 20 pages.
- Report with totals, empty values per field, failed pages and Olostep calls by type.
- Five starter recipes in `recipes/`.
