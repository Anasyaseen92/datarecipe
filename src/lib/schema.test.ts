import { describe, expect, it } from "vitest";

import { buildSchema } from "./schema.js";

describe("buildSchema", () => {
  it("turns fields into a JSON Schema object of strings with descriptions", () => {
    expect(buildSchema({ company: "company name", free_plan: "is there a free plan (yes/no)" })).toEqual({
      type: "object",
      properties: {
        company: { type: "string", description: "company name" },
        free_plan: { type: "string", description: "is there a free plan (yes/no)" },
      },
      required: ["company", "free_plan"],
    });
  });
});
