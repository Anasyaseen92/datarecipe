import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Command } from "commander";

import { info, UserError } from "../lib/log.js";

export const FIRST_RECIPE_PATH = "recipes/my-first-recipe.yml";

// Real sites, few of them: the first real run should finish in under a minute
// and cost only a few credits.
export const FIRST_RECIPE = `# My first datarecipe. Run it with:
#   npx datarecipe ${FIRST_RECIPE_PATH}

# name: used for the output files, e.g. output/my-first-recipe.csv
name: my-first-recipe

# sites: one website per line. For long lists, use a text file instead:
#   sites_file: sites.txt     (one URL per line, # starts a comment)
sites:
  - https://resend.com
  - https://supabase.com
  - https://www.olostep.com

# find_page: Olostep Map searches each site for this and picks ONE page.
# Delete this line to use the site URL itself.
find_page: pricing

# fields: the columns you want, each with a plain-English description.
# Olostep reads the page and fills them in. Say the exact format you want
# ("a number only, e.g. 25") so every row looks the same.
fields:
  company: company or product name only, e.g. Supabase
  free_plan: "yes or no: is there a free plan?"
  cheapest_paid_plan: name of the cheapest paid plan only, e.g. Pro
  price: monthly price of the cheapest paid plan as a number only, e.g. 25
  currency: currency code of that price, e.g. USD

# mode: "table" (default) = one row per site with the fields above -> CSV
#       "text"            = each page as markdown -> JSONL, for AI datasets
#                           (text mode ignores fields)
mode: table
`;

export function registerInit(program: Command): void {
  program
    .command("init")
    .description(`create ${FIRST_RECIPE_PATH}, a commented example recipe`)
    .action(() => {
      if (existsSync(FIRST_RECIPE_PATH)) {
        throw new UserError(`${FIRST_RECIPE_PATH} already exists. Edit it, or delete it to start over.`);
      }
      mkdirSync(dirname(FIRST_RECIPE_PATH), { recursive: true });
      writeFileSync(FIRST_RECIPE_PATH, FIRST_RECIPE);
      info(`Created ${FIRST_RECIPE_PATH}`);
      info(`Next: npx datarecipe ${FIRST_RECIPE_PATH}`);
    });
}
