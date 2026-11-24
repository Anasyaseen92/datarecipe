# Recipes

A recipe is a small YAML file that says **which sites** to visit and **what data**
you want back. Run any of them with:

```bash
npx datarecipe recipes/saas-pricing.yml
```

| Recipe | Mode | What you get |
| --- | --- | --- |
| [saas-pricing.yml](saas-pricing.yml) | table | Free plan, cheapest plan and price per company |
| [company-contact-pages.yml](company-contact-pages.yml) | table | Public email, phone and address |
| [careers-pages.yml](careers-pages.yml) | table | Open roles, remote policy, locations |
| [open-source-project-homepages.yml](open-source-project-homepages.yml) | text | Project homepages as markdown (JSONL) |
| [devtools-docs-homepages.yml](devtools-docs-homepages.yml) | text | Docs landing pages as markdown (JSONL) |

## Add a recipe in 5 minutes

1. **Copy a recipe** that is close to what you want:
   `cp recipes/saas-pricing.yml recipes/your-recipe.yml` (or run `npx datarecipe init`).
2. **Pick 3 to 5 real sites.** Small recipes are easy to review and cheap to run.
3. **Set `find_page`** to the word a site would use for the page (`pricing`,
   `contact`, `careers`), or delete it to use the homepage.
4. **Describe each field in plain English.** Be specific: "price of the cheapest
   paid plan per month, with currency" beats "price". Use snake_case names; they
   become CSV columns.
5. **Try it**: `npx datarecipe recipes/your-recipe.yml`, then open the CSV and the
   report. If a field is often empty, sharpen its description.
6. **Add a comment at the top** with what it collects and roughly how many
   Olostep calls it makes, then open a pull request using the "New recipe" template.

Good recipes use public pages, respect each site's terms, and don't collect
personal data about private individuals.
