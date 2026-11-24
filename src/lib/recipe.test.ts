import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadRecipe } from "./recipe.js";

function write(yaml: string, extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "datarecipe-"));
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(dir, name), text);
  const file = join(dir, "x.yml");
  writeFileSync(file, yaml);
  return file;
}

describe("loadRecipe", () => {
  it("loads a valid recipe with defaults", () => {
    const r = loadRecipe(
      write(
        "name: AI Tools Pricing\nsites:\n  - https://resend.com/\n  - supabase.com\nfind_page: pricing\nfields:\n  company: company name\n",
      ),
    );
    expect(r).toMatchObject({
      name: "AI Tools Pricing",
      slug: "ai-tools-pricing",
      sites: ["https://resend.com", "https://supabase.com"],
      findPage: "pricing",
      fields: { company: "company name" },
      mode: "table",
    });
  });

  it("reads sites_file next to the recipe, skipping comments and blanks", () => {
    const file = write("name: t\nsites_file: sites.txt\nmode: text\n", {
      "sites.txt": "# my list\nhttps://a.test\n\nhttps://b.test  # second\nhttps://a.test\n",
    });
    expect(loadRecipe(file).sites).toEqual(["https://a.test", "https://b.test"]);
  });

  it("names the file and field path when fields are missing", () => {
    const file = write("name: t\nsites: [https://a.test]\n");
    expect(() => loadRecipe(file)).toThrow(`${file.replace(/\\/g, "/")}: fields: add at least one field`);
  });

  it("asks for sites when there are none", () => {
    expect(() => loadRecipe(write("name: t\nfields:\n  a: b\n"))).toThrow(
      /: sites: add a list of sites or a sites_file/,
    );
  });

  it("explains unknown keys, bad modes and bad URLs", () => {
    expect(() => loadRecipe(write("name: t\nsite: [https://a.test]\nfields: {a: b}\n"))).toThrow(/site: unknown key/);
    expect(() => loadRecipe(write("name: t\nsites: [https://a.test]\nmode: csv\nfields: {a: b}\n"))).toThrow(
      /mode: use "table" or "text"/,
    );
    expect(() => loadRecipe(write("name: t\nsites: ['not a url']\nfields: {a: b}\n"))).toThrow(
      /sites\.0: "not a url" is not a valid URL/,
    );
    expect(() => loadRecipe(write("name: t\nsites: [https://a.test]\nfields:\n  price:\n"))).toThrow(
      /fields\.price: add a short plain-English description/,
    );
  });

  it("suggests init when the recipe does not exist", () => {
    expect(() => loadRecipe("recipes/nope.yml")).toThrow(
      "Recipe not found: recipes/nope.yml. Create one with: npx datarecipe init",
    );
  });
});
