# How datarecipe works

Six diagrams, from the big picture down to the details. GitHub renders them
directly; in VS Code, use a Markdown preview with Mermaid support.

1. [The big picture](#1-the-big-picture)
2. [What happens when you run a recipe](#2-what-happens-when-you-run-a-recipe)
3. [Three ways to read pages](#3-three-ways-to-read-pages)
4. [How the right page is picked](#4-how-the-right-page-is-picked)
5. [What happens when something fails](#5-what-happens-when-something-fails)
6. [Where the code lives](#6-where-the-code-lives)

## 1. The big picture

You write a recipe: which sites, which page, which columns. datarecipe turns it
into Olostep calls and writes the results to files.

```mermaid
flowchart LR
    R["Recipe file (YAML)<br/>sites + find_page + fields"] --> D["datarecipe CLI"]
    D <-->|"Map, Scrape, Batch"| O["Olostep API"]
    O <--> W[("Websites")]
    D --> CSV["output/name.csv<br/>one row per site"]
    D --> JSONL["output/name.jsonl<br/>every row, with errors"]
    D --> REP["output/name.report.md<br/>quality + credits used"]
```

All web access and all AI go through Olostep, using the official `olostep` SDK.
datarecipe itself never fetches a page or calls an AI model directly.

## 2. What happens when you run a recipe

`npx datarecipe recipes/x.yml`, step by step (table mode):

```mermaid
flowchart TD
    A["npx datarecipe recipe.yml"] --> B["Load .env"]
    B --> C["Read and validate the recipe<br/>(recipe.ts, zod)"]
    C -->|"invalid"| X1["Error: file + field + how to fix"]
    C --> K{"OLOSTEP_API_KEY set?"}
    K -->|"no"| X2["Error: where to get a key"]
    K -->|"yes"| P["Print the plan<br/>e.g. 50 Map calls + 50 extractions"]
    P --> Q{"More than 20 sites<br/>and no --yes?"}
    Q -->|"yes"| ASK["Ask: Continue? (y/N)"]
    ASK -->|"no"| STOP["Cancelled, nothing sent"]
    ASK -->|"yes"| F
    Q -->|"no"| F["Find one page per site<br/>Olostep Map, 5 at a time"]
    F --> E["Extract the fields from each page<br/>Olostep Scrape + llm_extract, 5 at a time"]
    E --> S["Put rows back in recipe order"]
    S --> OUT["Write CSV + JSONL + report"]
    OUT --> DONE["Done: 48 rows (2 failed)"]
```

The plan and the question come **before** any Olostep call, so a big run never
spends credits by surprise.

## 3. Three ways to read pages

The recipe's `mode` and `parser` keys pick the Olostep feature that reads the pages.

```mermaid
flowchart TD
    START["Pages to read<br/>(after find_page)"] --> M{"mode?"}
    M -->|"table"| PZ{"parser set?"}
    PZ -->|"no (default)"| T1["Olostep Scrape + llm_extract<br/>AI fills your fields"]
    PZ -->|"yes"| T2["Olostep Batch + parser<br/>fields taken from the parser's JSON"]
    M -->|"text"| T3["Olostep Batch<br/>each page as markdown"]
    T1 --> O1["CSV + JSONL + report"]
    T2 --> O1
    T3 --> O2["pages.jsonl + report<br/>(for AI datasets, RAG, search)"]
```

| | Best for | Credits per site |
|---|---|---|
| Scrape + llm_extract | Tens to hundreds of sites, any fields | about 10 (+1 for Map) |
| Batch + parser | Known page types, e.g. emails | 1 to 5 (+1 for Map) |
| Batch (text) | Thousands of pages | 1 (+1 for Map) |

Batches hold at most 100 pages each, so bigger lists are split into several
batches that run in parallel.

## 4. How the right page is picked

`find_page: pricing` should give `example.com/pricing`, not a blog post about
pricing or the Japanese copy of the page. Olostep Map ranks the URLs, and
`pickBestPage` in `olostep.ts` chooses among the top 10:

```mermaid
flowchart TD
    A["Olostep Map<br/>site + search query, top 10 URLs<br/>(1 credit)"] --> B["Score each URL"]
    B --> C1["+100 path ends with the query<br/>/pricing"]
    B --> C2["+40 path contains the query<br/>/pricing-plans"]
    B --> C3["-60 translated copy<br/>/ja-jp/pricing"]
    B --> C4["-50 side section<br/>/blog/..., /docs/..."]
    B --> C5["-5 per path segment<br/>shorter is better"]
    B --> C6["-1 per Map rank<br/>tie-breaker"]
    C1 & C2 & C3 & C4 & C5 & C6 --> D{"Any URL?"}
    D -->|"yes"| E["Highest score wins"]
    D -->|"no"| F["Use the homepage"]
```

## 5. What happens when something fails

One bad page never stops a run. Only errors that would make **every** next call
fail stop it, and the rows that finished are kept.

```mermaid
flowchart TD
    A["An Olostep call fails"] --> B["explainError()<br/>reads the HTTP status inside the SDK error"]
    B --> C{"Fatal?"}
    C -->|"No: page blocked, timeout, HTTP 500, bad JSON"| D["Mark this page failed<br/>(reason goes to JSONL + report)"]
    D --> E["Carry on with the other pages"]
    C -->|"Yes: bad key, out of credits (402), rate limit (429)"| F["Start no new calls<br/>wait for calls in flight"]
    F --> G{"Any rows finished?"}
    G -->|"yes"| H["Save them, then exit 1<br/>'48 finished rows were already saved'"]
    G -->|"no"| I["Exit 1 without writing,<br/>so a good older CSV is not overwritten"]
```

Every error the user sees reads `Error: what happened + how to fix it`. Stack
traces are shown only with `DEBUG=datarecipe`.

## 6. Where the code lives

```mermaid
flowchart TD
    IDX["index.ts<br/>CLI setup (commander)"] --> RUN["commands/run.ts<br/>plan, confirm, summary"]
    IDX --> INIT["commands/init.ts<br/>writes a starter recipe"]
    IDX --> ENV["lib/env.ts<br/>.env loader"]
    RUN --> REC["lib/recipe.ts<br/>YAML + validation"]
    RUN --> PIPE["lib/pipeline.ts<br/>recipe to pages to rows to files"]
    PIPE --> OLO["lib/olostep.ts<br/>the ONLY web access"]
    PIPE --> CSVM["lib/csv.ts<br/>Excel-safe CSV"]
    PIPE --> REPM["lib/report.ts<br/>report.md"]
    OLO --> SCH["lib/schema.ts<br/>fields to JSON Schema"]
    OLO --> SDK[["olostep SDK"]]
    MOCK["lib/mock.ts<br/>fake Olostep for tests"] -.->|"same interface"| OLO
```

| Rule | Why |
|---|---|
| Only `olostep.ts` talks to the web | One place to change, one place to test |
| Progress goes to stderr, data to files | Output can be piped; CI logs show what users see |
| Tests run offline | `mock.ts` replaces the SDK; `olostep.test.ts` runs the real SDK against a local fake server. CI never needs a real key |
| Runtime dependencies: commander, zod, yaml, olostep | Small install, small attack surface |

### How the tests cover it

```mermaid
flowchart LR
    T1["run.test.ts<br/>whole runs"] --> MK["mock.ts<br/>fake client"]
    T2["olostep.test.ts<br/>SDK requests + errors"] --> FS["Local HTTP server<br/>(OLOSTEP_API_BASE_URL)"]
    FS --> REAL["Real olostep SDK"]
    T3["recipe, csv, schema, env tests<br/>pure functions"]
    MK & REAL & T3 --> CI["GitHub Actions<br/>3 OS x 3 Node versions, no secrets"]
```

New here? Start with [CONTRIBUTING.md](../CONTRIBUTING.md), then pick an issue from
[ISSUES.md](../ISSUES.md).
