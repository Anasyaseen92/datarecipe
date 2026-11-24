// Runs the real Olostep SDK against a local fake server (no network, no key),
// so we test the actual request shapes the SDK sends.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient, explainError, OlostepRunner, parseJsonContent, pickBestPage } from "./olostep.js";
import { runRecipe } from "./pipeline.js";
import type { Recipe } from "./recipe.js";

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw JSON from the SDK
}

let server: Server;
let seen: Seen[] = [];
let batchInfoCalls = 0;
let batchItems: { custom_id: string; url: string }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw JSON from the SDK
async function readBody(req: IncomingMessage): Promise<any> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : undefined;
}

beforeAll(async () => {
  // void: node:http ignores the promise, and a rejection would fail the test anyway.
  server = createServer((req, res) => void handle(req, res));
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await readBody(req);
    seen.push({ method: req.method ?? "", path: url.pathname, query: url.searchParams, body });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // Olostep's real invalid-key answer (see olostep-js transport tests).
    if (req.headers.authorization === "Bearer bad-key")
      return send(401, { invalid_api_key: true, message: "Your API key is invalid." });

    if (req.method === "POST" && url.pathname === "/maps") {
      return send(200, { id: "map_1", urls: [`${body.url}/pricing`], urls_count: 1 });
    }
    if (req.method === "POST" && url.pathname === "/scrapes") {
      if (body.url_to_scrape.includes("broken")) return send(500, { message: "page could not be loaded" });
      if (body.url_to_scrape.includes("nocredit"))
        return send(402, { usage_limit_reached: true, message: "Usage limit reached." });
      // The API returns json_content as a JSON *string* inside `result`.
      return send(200, { id: "scrape_1", result: { json_content: JSON.stringify({ company: "Acme", price: "$10" }) } });
    }
    if (req.method === "POST" && url.pathname === "/batches") {
      batchItems = body.items;
      return send(200, { id: "batch_1", status: "in_progress", total_urls: body.items.length });
    }
    if (req.method === "GET" && url.pathname === "/batches/batch_1") {
      batchInfoCalls++;
      return send(200, { id: "batch_1", status: batchInfoCalls > 1 ? "completed" : "in_progress" });
    }
    if (req.method === "GET" && url.pathname === "/batches/batch_1/items") {
      return send(200, { items: batchItems.map((i) => ({ ...i, retrieve_id: `r-${i.custom_id}` })) });
    }
    if (req.method === "GET" && url.pathname === "/retrieve") {
      return send(200, {
        markdown_content: `# ${url.searchParams.get("retrieve_id")}`,
        json_content: '{"company":"Parsed Co"}',
      });
    }
    send(404, { title: "route not found" });
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OLOSTEP_API_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  delete process.env.OLOSTEP_API_BASE_URL;
});

beforeEach(() => {
  seen = [];
  batchInfoCalls = 0;
  process.env.OLOSTEP_API_KEY = "test-key";
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

// No retries, so failure tests don't wait on the SDK's backoff.
const runner = () => new OlostepRunner(createClient({ retries: 0 }), 0.01);

const recipe = (overrides: Partial<Recipe>): Recipe => ({
  file: "test.yml",
  name: "test",
  slug: "test",
  sites: ["https://acme.test"],
  fields: { company: "company name", price: "price" },
  mode: "table",
  ...overrides,
});

describe("Olostep wrapper", () => {
  it("finds a page with Map using search_query and top_n", async () => {
    const r = runner();
    expect(await r.findPage("https://acme.test", "pricing")).toBe("https://acme.test/pricing");
    expect(seen[0]?.body).toMatchObject({ url: "https://acme.test", search_query: "pricing", top_n: 10 });
    expect(r.calls.map).toBe(1);
  });

  it("scrapes with formats ['json'] + llm_extract and parses json_content", async () => {
    const row = await runner().extractFields("https://acme.test/pricing", {
      company: "company name",
      price: "price",
      plan: "plan name",
    });
    expect(row).toEqual({ company: "Acme", price: "$10", plan: "" });
    const body = seen[0]?.body;
    expect(body.url_to_scrape).toBe("https://acme.test/pricing");
    expect(body.formats).toEqual(["json"]);
    expect(body.llm_extract.schema.properties.company).toEqual({ type: "string", description: "company name" });
    expect(body.llm_extract.prompt).toMatch(/return an empty string/);
  });

  it("runs the batch flow: create, poll info, list items, retrieve markdown", async () => {
    const r = runner();
    const results = await r.readBatch(
      [
        { id: "a", url: "https://a.test" },
        { id: "b", url: "https://b.test" },
      ],
      { format: "markdown" },
    );
    expect(results.get("a")).toEqual({ ok: true, value: "# r-a" });
    expect(results.get("b")).toEqual({ ok: true, value: "# r-b" });
    expect(seen[0]?.body.items).toEqual([
      { url: "https://a.test", custom_id: "a" },
      { url: "https://b.test", custom_id: "b" },
    ]);
    expect(batchInfoCalls).toBe(2); // polled until "completed"
    const retrieve = seen.find((s) => s.path === "/retrieve")!;
    expect(retrieve.query.getAll("formats")).toEqual(["markdown"]);
    expect(r.calls).toEqual({ map: 0, scrape: 0, batch: 1, retrieve: 2 });
  });

  it("sends the parser id when a recipe uses a parser", async () => {
    await runner().readBatch([{ id: "a", url: "https://a.test" }], {
      format: "json",
      parser: "@olostep/extract-emails",
    });
    expect(seen[0]?.body.parser).toEqual({ id: "@olostep/extract-emails" });
  });

  it("turns a 401 into the friendly API key message and stops the run", async () => {
    process.env.OLOSTEP_API_KEY = "bad-key";
    const out = mkdtempSync(join(tmpdir(), "datarecipe-"));
    await expect(runRecipe(recipe({}), runner(), { outDir: out, mock: false })).rejects.toThrow(
      "Olostep rejected the API key (401). Check OLOSTEP_API_KEY in .env.",
    );
    // Nothing finished, so earlier output must not be replaced with empty files.
    expect(readdirSync(out)).toEqual([]);
  });

  it("stops when credits run out and keeps the rows that finished", async () => {
    const out = mkdtempSync(join(tmpdir(), "datarecipe-"));
    await expect(
      runRecipe(recipe({ sites: ["https://acme.test", "https://nocredit.test"] }), runner(), {
        outDir: out,
        mock: false,
      }),
    ).rejects.toThrow(/out of credits \(402\).*The 1 finished row was already saved to .*test\.csv/);
    const csv = readFileSync(join(out, "test.csv"), "utf8");
    expect(csv).toContain("Acme,$10,https://acme.test");
    expect(readFileSync(join(out, "test.report.md"), "utf8")).toContain("Stopped early");
  });

  it("keeps going when one page fails", async () => {
    const out = mkdtempSync(join(tmpdir(), "datarecipe-"));
    const result = await runRecipe(
      recipe({ sites: ["https://acme.test", "https://broken.test", "https://beta.test"] }),
      runner(),
      {
        outDir: out,
        mock: false,
      },
    );
    expect(result).toMatchObject({ ok: 2, failed: 1 });
    const rows = readFileSync(join(out, "test.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(rows.map((r) => r.status)).toEqual(["ok", "failed", "ok"]);
    expect(rows[1].error).toBe("Olostep returned HTTP 500: page could not be loaded");
    expect(readFileSync(join(out, "test.report.md"), "utf8")).toContain("| Rows failed | 1 |");
  });
});

describe("explainError", () => {
  it("reads the HTTP status from the SDK's wrapped error", () => {
    const body = { usage_limit_reached: true };
    const wrapped = {
      message: "Failed to reach Olostep API",
      details: { cause: { details: { response: { status: 402, body } } } },
    };
    expect(explainError(wrapped)).toMatchObject({
      fatal: true,
      message: expect.stringContaining("out of credits (402)"),
    });
  });

  it("recognizes the live API's invalid-key answer, which is a 402", () => {
    // Captured from api.olostep.com with a fake key.
    const body = { invalid_api_key: true, message: "Your API key is invalid." };
    expect(explainError({ details: { response: { status: 402, body } } })).toEqual({
      fatal: true,
      message: "Olostep rejected the API key (402). Check OLOSTEP_API_KEY in .env.",
    });
  });

  it("treats a 401 without the invalid-key flag as one blocked site", () => {
    const err = { details: { response: { status: 401, body: { message: "This domain is not allowed." } } } };
    expect(explainError(err)).toEqual({
      fatal: false,
      message: "Olostep cannot access this site (401): This domain is not allowed.",
    });
  });
});

describe("parseJsonContent", () => {
  it("accepts a JSON string or an object", () => {
    expect(parseJsonContent('{"a":"1"}')).toEqual({ a: "1" });
    expect(parseJsonContent({ a: "1" })).toEqual({ a: "1" });
  });
  it("rejects missing or broken JSON", () => {
    expect(() => parseJsonContent(undefined)).toThrow("no JSON");
    expect(() => parseJsonContent("{oops")).toThrow("could not be parsed");
  });
});

describe("pickBestPage", () => {
  // Shapes taken from a real 50-site run where Map's first hit was the wrong page.
  it("prefers the main /pricing page over blog, docs and translated copies", () => {
    expect(
      pickBestPage(["https://www.paddle.com/blog/10x-saas-pricing", "https://www.paddle.com/pricing"], "pricing"),
    ).toBe("https://www.paddle.com/pricing");
    expect(pickBestPage(["https://vercel.com/docs/pricing/taxes", "https://vercel.com/pricing"], "pricing")).toBe(
      "https://vercel.com/pricing",
    );
    expect(pickBestPage(["https://amplitude.com/ja-jp/pricing", "https://amplitude.com/pricing"], "pricing")).toBe(
      "https://amplitude.com/pricing",
    );
  });

  it("keeps Map's order when candidates look alike, and handles no results", () => {
    expect(pickBestPage(["https://a.test/pricing", "https://a.test/plans/pricing"], "pricing")).toBe(
      "https://a.test/pricing",
    );
    expect(pickBestPage(["https://stripe.com/cn/pricing"], "pricing")).toBe("https://stripe.com/cn/pricing");
    expect(pickBestPage([], "pricing")).toBeUndefined();
  });

  it("matches multi-word queries as a slug", () => {
    expect(pickBestPage(["https://a.test/about", "https://a.test/contact-us"], "contact us")).toBe(
      "https://a.test/contact-us",
    );
  });
});
