// A fake Olostep for tests and CI (--mock): three made-up companies, no network.
// It returns the same shapes as the real SDK (json_content as a JSON string,
// markdown_content from batch retrieve) so the real code paths run unchanged.
/* eslint-disable @typescript-eslint/require-await -- the fake has nothing to await, but must match the SDK's async API */
import type { BatchHandle, OlostepApi } from "./olostep.js";

interface FakePage {
  markdown: string;
  /** What a perfect extraction would find on this page. */
  facts: Record<string, string>;
}

const PAGES: Record<string, FakePage> = {
  "https://acme-analytics.example": {
    markdown:
      "# Acme Analytics\n\nProduct analytics for small teams. See funnels, retention and live events in one dashboard.\n\n[Pricing](/pricing) · [Docs](/docs)",
    facts: { company: "Acme Analytics" },
  },
  "https://acme-analytics.example/pricing": {
    markdown:
      "# Pricing\n\n## Free\n$0 forever, up to 10k events.\n\n## Team\n$29 per month. Save 20% when you pay yearly.",
    facts: { company: "Acme Analytics", free_plan: "yes", price: "$29/month", annual_discount: "20%" },
  },
  "https://nimbus-mail.example": {
    markdown:
      "# Nimbus Mail\n\nTransactional email with a simple API. Send your first email in five minutes.\n\n[Pricing](/pricing)",
    facts: { company: "Nimbus Mail" },
  },
  "https://nimbus-mail.example/pricing": {
    markdown: "# Plans\n\n- **Hobby**: free, 3,000 emails per month\n- **Pro**: $15 per month, 50,000 emails",
    facts: { company: "Nimbus Mail", free_plan: "yes", price: "$15/month" },
  },
  "https://pixelforge.example": {
    markdown:
      "# Pixelforge\n\nDesign handoff for product teams. Comment, inspect and export, all in the browser.\n\n[Pricing](/pricing)",
    facts: { company: "Pixelforge" },
  },
  "https://pixelforge.example/pricing": {
    markdown:
      "# Pricing\n\nStudio: $49 per month, billed monthly. Pay yearly and get 2 months free.\n\nNo free plan, but a 14-day trial.",
    facts: { company: "Pixelforge", free_plan: "no", price: "$49/month", annual_discount: "2 months free" },
  },
};

export const MOCK_SITES = Object.keys(PAGES).filter((url) => !url.endsWith("/pricing"));

function page(url: string): FakePage {
  const found = PAGES[url.replace(/\/$/, "")];
  if (!found) throw new Error(`mock mode only knows the test fixture sites (${MOCK_SITES.join(", ")})`);
  return found;
}

export function createMockClient(): OlostepApi {
  return {
    maps: {
      async create({ url, searchQuery }) {
        page(url);
        const candidate = `${url.replace(/\/$/, "")}/${(searchQuery ?? "").toLowerCase().trim()}`;
        const urls = searchQuery && PAGES[candidate] ? [candidate] : [];
        return {
          async *urls() {
            yield* urls;
          },
        };
      },
    },
    scrapes: {
      async create({ url, llmExtract }) {
        const { facts } = page(url);
        const props = Object.keys((llmExtract?.schema?.properties as Record<string, unknown> | undefined) ?? {});
        const extracted = Object.fromEntries(props.map((name) => [name, facts[name] ?? ""]));
        return { json_content: JSON.stringify(extracted) };
      },
    },
    batches: {
      async create(items): Promise<BatchHandle> {
        return {
          id: "batch_mock",
          async waitTillDone() {},
          async *items() {
            for (const item of items) {
              yield {
                url: item.url,
                custom_id: item.customId,
                async retrieve() {
                  const p = page(item.url);
                  return { markdown_content: p.markdown, json_content: JSON.stringify(p.facts) };
                },
              };
            }
          },
        };
      },
    },
  };
}
