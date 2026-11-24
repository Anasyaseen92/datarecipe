// The ONLY place that talks to the web. Everything goes through the official
// Olostep SDK; mock mode swaps in a fake object with the same shape (mock.ts).
import Olostep, { type Format } from "olostep";

import { UserError } from "./log.js";
import { buildSchema, EXTRACT_PROMPT } from "./schema.js";

/** The slice of the Olostep SDK datarecipe uses. The real client and the mock both satisfy it. */
export interface OlostepApi {
  maps: {
    create(input: { url: string; searchQuery?: string; topN?: number }): Promise<{ urls(): AsyncGenerator<string> }>;
  };
  scrapes: {
    create(input: {
      url: string;
      formats: string[];
      llmExtract?: { schema?: Record<string, unknown>; prompt?: string };
    }): Promise<{ json_content?: unknown }>;
  };
  batches: {
    create(items: { url: string; customId: string }[], options?: { parser?: string }): Promise<BatchHandle>;
  };
}

export interface BatchHandle {
  id: string;
  waitTillDone(options?: { checkEveryNSecs?: number; timeoutSeconds?: number }): Promise<void>;
  items(options?: { waitForCompletion?: boolean }): AsyncGenerator<BatchItemHandle>;
}

export interface BatchItemHandle {
  url: string;
  custom_id?: string;
  retrieve(formats?: Format[]): Promise<unknown>;
}

export type CallType = "map" | "scrape" | "batch" | "retrieve";

/** What happened to one page: a value, or a message saying why it failed. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

export const NO_KEY_MESSAGE =
  "OLOSTEP_API_KEY is not set. Get a key at https://www.olostep.com/dashboard/api-keys " +
  "(the free plan includes 500 credits), then add it to .env as OLOSTEP_API_KEY=your-key";

/** Olostep calls in flight at once. Enough to be fast, low enough to stay clear of rate limits. */
export const CONCURRENCY = 5;

// New Olostep accounts are limited to 100 items per batch, so bigger lists are
// split. Batches run in parallel on Olostep's side, so this costs no extra time.
export const BATCH_LIMIT = 100;

// The SDK's own wait gives up after 10 minutes, but Olostep says a batch can
// take 20-25 minutes, so we wait explicitly with a longer timeout.
const BATCH_TIMEOUT_SECONDS = 3600;

// Map's #1 hit is often a blog post or a translated copy (/ja-jp/pricing), so
// we ask for a few candidates (still 1 credit) and choose with pickBestPage.
const MAP_CANDIDATES = 10;

export function createClient(options: { retries?: number } = {}): OlostepApi {
  const apiKey = process.env.OLOSTEP_API_KEY?.trim();
  if (!apiKey) throw new UserError(NO_KEY_MESSAGE);
  return new Olostep({
    apiKey,
    // Same variable as olostep-cli. Only tests point this at a local fake server.
    apiBaseUrl: process.env.OLOSTEP_API_BASE_URL?.trim() || undefined,
    ...(options.retries !== undefined ? { retry: { maxRetries: options.retries, initialDelayMs: 0 } } : {}),
  });
}

/** Wraps an Olostep client and counts calls so the report can show credit use. */
export class OlostepRunner {
  readonly calls: Record<CallType, number> = { map: 0, scrape: 0, batch: 0, retrieve: 0 };

  constructor(
    private readonly client: OlostepApi,
    private readonly pollSeconds = 5,
  ) {}

  /** Olostep Map ranks the site's URLs by the query; we pick the main page among the top ones. */
  async findPage(site: string, query: string): Promise<string> {
    this.calls.map++;
    const map = await this.client.maps.create({ url: site, searchQuery: query, topN: MAP_CANDIDATES });
    const urls: string[] = [];
    for await (const url of map.urls()) urls.push(url);
    // Small sites often have no separate page; the homepage is the best guess.
    return pickBestPage(urls, query) ?? site;
  }

  /** One Olostep scrape with llm_extract: page -> the recipe's fields. */
  async extractFields(url: string, fields: Record<string, string>): Promise<Record<string, string>> {
    this.calls.scrape++;
    const result = await this.client.scrapes.create({
      url,
      formats: ["json"],
      llmExtract: { schema: buildSchema(fields), prompt: EXTRACT_PROMPT },
    });
    return pickFields(parseJsonContent(result.json_content), Object.keys(fields));
  }

  /**
   * Olostep Batch: submit pages, wait, then retrieve each one in `format`.
   * Returns one outcome per page id. Throws only on a fatal error (bad key, no credits).
   */
  async readBatch(
    pages: { id: string; url: string }[],
    options: { format: "markdown" | "json"; parser?: string; onStarted?: () => void; onItem?: () => void },
  ): Promise<Map<string, Outcome<unknown>>> {
    const chunks: (typeof pages)[] = [];
    for (let i = 0; i < pages.length; i += BATCH_LIMIT) chunks.push(pages.slice(i, i + BATCH_LIMIT));

    const handles = await mapLimit(chunks, CONCURRENCY, (chunk) => {
      this.calls.batch++;
      return this.client.batches.create(
        chunk.map((p) => ({ url: p.url, customId: p.id })),
        options.parser ? { parser: options.parser } : undefined,
      );
    });
    options.onStarted?.();

    const items: BatchItemHandle[] = [];
    for (const batch of handles) {
      await batch.waitTillDone({ checkEveryNSecs: this.pollSeconds, timeoutSeconds: BATCH_TIMEOUT_SECONDS });
      for await (const item of batch.items({ waitForCompletion: false })) items.push(item);
    }

    const results = new Map<string, Outcome<unknown>>();
    await mapLimit(items, CONCURRENCY, async (item) => {
      results.set(item.custom_id ?? "", await this.retrieveItem(item, options.format));
      options.onItem?.();
    });

    for (const page of pages) {
      if (!results.has(page.id))
        results.set(page.id, { ok: false, error: "Olostep Batch returned no result for this page" });
    }
    return results;
  }

  private async retrieveItem(item: BatchItemHandle, format: "markdown" | "json"): Promise<Outcome<unknown>> {
    try {
      this.calls.retrieve++;
      const data = (await item.retrieve([format as Format])) as Record<string, unknown> | null | undefined;
      if (data?.size_exceeded) throw new Error("page is larger than 6MB; Olostep only returned a hosted link");
      const content = data?.[format === "json" ? "json_content" : "markdown_content"];
      if (content === undefined || content === null || content === "") {
        throw new Error(`Olostep returned no ${format} for this page`);
      }
      return { ok: true, value: content };
    } catch (err) {
      const { message, fatal } = explainError(err);
      if (fatal) throw new UserError(message);
      return { ok: false, error: message };
    }
  }
}

// Pages that mention the query but are rarely the page people mean.
const SIDE_SECTIONS =
  /^(blog|docs?|changelog|learning|learn|news|press|community|forum|apps|integrations|help|support|guides?|resources|articles?|compare)$/;
// First path segment like "ja-jp", "pt-br", "de", "cn": a translated copy.
const LOCALE = /^[a-z]{2}(-[a-z]{2,4})?$/;

// Weights for pickBestPage. Matching the query beats everything; Map's rank
// (-1 per position) only breaks ties between otherwise equal pages.
const SCORE = {
  pathEndsWithQuery: 100,
  pathContainsQuery: 40,
  translatedCopy: -60,
  sideSection: -50,
  perPathSegment: -5,
} as const;

/**
 * Choose the main page for `query` from Map's ranked URLs: prefer a path that
 * ends in the query (/pricing), then a short path, and avoid blog/docs pages
 * and translated copies. Returns undefined when there is no usable URL.
 */
export function pickBestPage(urls: string[], query: string): string | undefined {
  const slug = query.toLowerCase().trim().replace(/\s+/g, "-");
  let best: { url: string; score: number } | undefined;
  urls.forEach((url, rank) => {
    const pageScore = scorePage(url, slug);
    if (pageScore === undefined) return;
    const score = pageScore - rank;
    if (!best || score > best.score) best = { url, score };
  });
  return best?.url;
}

function scorePage(url: string, slug: string): number | undefined {
  let parts: string[];
  try {
    parts = new URL(url).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    return undefined;
  }
  let score = parts.length * SCORE.perPathSegment;
  if (parts.at(-1) === slug) score += SCORE.pathEndsWithQuery;
  else if (parts.some((p) => p.includes(slug))) score += SCORE.pathContainsQuery;
  const first = parts[0];
  if (first !== undefined && first !== slug && LOCALE.test(first)) score += SCORE.translatedCopy;
  if (parts.some((p) => SIDE_SECTIONS.test(p))) score += SCORE.sideSection;
  return score;
}

/** Olostep returns json_content as a JSON string (docs) or, sometimes, an object. */
export function parseJsonContent(value: unknown): Record<string, unknown> {
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch {
      throw new Error("Olostep returned JSON that could not be parsed");
    }
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Olostep returned no JSON for this page");
  }
  return data as Record<string, unknown>;
}

/** Keep only the recipe's fields, as trimmed strings, so every row has the same columns. */
export function pickFields(data: Record<string, unknown>, names: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const name of names) {
    const v = data[name];
    row[name] = v === undefined || v === null ? "" : typeof v === "string" ? v.trim() : JSON.stringify(v);
  }
  return row;
}

interface ApiErrorLike {
  message?: string;
  details?: { cause?: unknown; response?: { status?: number; body?: unknown } };
}

/**
 * Turn an SDK error into a message for the user, and say whether the whole run
 * must stop (bad key, no credits) or only this page failed.
 */
export function explainError(err: unknown): { message: string; fatal: boolean } {
  if (err instanceof UserError) return { message: err.message, fatal: true };
  // The SDK wraps API errors in OlostepAPIConnectionError; the real error is the cause.
  const outer = err as ApiErrorLike | null | undefined;
  const cause = (outer?.details?.cause ?? err) as ApiErrorLike | null | undefined;
  const status = cause?.details?.response?.status;
  const body = (cause?.details?.response?.body ?? {}) as Record<string, unknown>;
  const apiMessage = typeof body.message === "string" ? `: ${body.message}` : "";

  // Olostep flags a bad key in the body. Check that before the status: the live
  // API answers an invalid key with 402, not 401. Any other 401 = a blocked site.
  if (body.invalid_api_key === true || body.code === "invalid_api_key") {
    return { fatal: true, message: `Olostep rejected the API key (${status ?? 401}). Check OLOSTEP_API_KEY in .env.` };
  }
  if (status === 402 || body.usage_limit_reached === true) {
    return {
      fatal: true,
      message: "Olostep says this account is out of credits (402). Add credits at https://www.olostep.com",
    };
  }
  if (status === 429) {
    return {
      fatal: true,
      message: "Olostep rate or credit limit reached (429). Wait a bit or upgrade at https://www.olostep.com",
    };
  }
  if (status === 401) return { fatal: false, message: `Olostep cannot access this site (401)${apiMessage}` };
  if (status !== undefined) return { fatal: false, message: `Olostep returned HTTP ${status}${apiMessage}` };
  // SDK messages can include whole request bodies; the first line is enough for a report.
  const text = (cause?.message ?? String(err)).split("\n")[0] ?? "";
  return { fatal: false, message: text };
}

/**
 * Run `fn` over `items` with at most `limit` in flight, keeping order. After an
 * error no new work starts, but calls already in flight are awaited: their
 * results are paid for, so callers must still be able to save them.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i] as T, i);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure.error;
  return out;
}
