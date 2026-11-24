import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { displayPath, UserError } from "./log.js";

// Columns we add to every row; a field with the same name would be overwritten.
const RESERVED_FIELDS = ["site", "source_url", "status", "error"];

const description = z
  .string({ error: "add a short plain-English description" })
  .trim()
  .min(1, "add a short plain-English description");

const RecipeFile = z
  .strictObject({
    name: z.string({ error: "add a name, e.g. name: my-dataset" }).trim().min(1, "add a name, e.g. name: my-dataset"),
    sites: z.array(z.string({ error: "each site must be a URL" })).optional(),
    sites_file: z.string().trim().min(1).optional(),
    find_page: z.string().trim().min(1, "remove find_page or give it a search query, e.g. pricing").optional(),
    fields: z.record(z.string(), description).optional(),
    mode: z.enum(["table", "text"], { error: 'use "table" or "text"' }).default("table"),
    parser: z.string().trim().min(1).optional(),
  })
  .superRefine((r, ctx) => {
    if (!r.sites?.length && !r.sites_file) {
      ctx.addIssue({ code: "custom", path: ["sites"], message: "add a list of sites or a sites_file" });
    }
    if (r.mode === "table" && Object.keys(r.fields ?? {}).length === 0) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: "add at least one field" });
    }
    if (r.parser && r.mode === "text") {
      ctx.addIssue({ code: "custom", path: ["parser"], message: "parser only works in table mode" });
    }
    for (const key of Object.keys(r.fields ?? {})) {
      if (RESERVED_FIELDS.includes(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", key],
          message: `"${key}" is added automatically; pick another name`,
        });
      }
    }
  });

export interface Recipe {
  file: string;
  name: string;
  /** Safe for file names: output/<slug>.csv */
  slug: string;
  sites: string[];
  findPage?: string;
  /** column -> plain-English description (empty in text mode) */
  fields: Record<string, string>;
  mode: "table" | "text";
  parser?: string;
}

export function loadRecipe(file: string): Recipe {
  const shown = displayPath(file);
  if (!existsSync(file)) {
    throw new UserError(`Recipe not found: ${shown}. Create one with: npx datarecipe init`);
  }

  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(file, "utf8"));
  } catch (err) {
    throw new UserError(`${shown}: invalid YAML: ${(err as Error).message}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new UserError(`${shown}: the recipe is empty. Run npx datarecipe init for an example.`);
  }

  const parsed = RecipeFile.safeParse(doc);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      if (issue.code === "unrecognized_keys") {
        return `${shown}: ${issue.keys.join(", ")}: unknown key (allowed: ${Object.keys(RecipeFile.shape).join(", ")})`;
      }
      const where = issue.path.length ? issue.path.join(".") : "recipe";
      return `${shown}: ${where}: ${issue.message}`;
    });
    throw new UserError(lines.join("\n"));
  }
  const r = parsed.data;

  const sites: string[] = [];
  (r.sites ?? []).forEach((raw, i) => sites.push(toUrl(raw, `${shown}: sites.${i}`)));
  if (r.sites_file) {
    const listPath = resolve(dirname(file), r.sites_file);
    if (!existsSync(listPath)) {
      throw new UserError(`${shown}: sites_file: cannot find ${displayPath(listPath)}`);
    }
    readFileSync(listPath, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const text = line.replace(/#.*$/, "").trim();
        if (text) sites.push(toUrl(text, `${shown}: sites_file: line ${i + 1}`));
      });
  }
  const unique = [...new Set(sites)];
  if (unique.length === 0) {
    throw new UserError(`${shown}: sites: no sites found; add at least one URL`);
  }

  const slug = r.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new UserError(`${shown}: name: use letters or numbers, e.g. name: my-dataset`);

  return {
    file,
    name: r.name,
    slug,
    sites: unique,
    findPage: r.find_page,
    fields: r.mode === "table" ? (r.fields ?? {}) : {},
    mode: r.mode,
    parser: r.parser,
  };
}

/** Accept "example.com" as well as full URLs, because that is how people paste lists. */
function toUrl(raw: string, where: string): string {
  const text = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href.replace(/\/$/, "");
  } catch {
    // fall through to the error below
  }
  throw new UserError(`${where}: "${raw}" is not a valid URL`);
}
