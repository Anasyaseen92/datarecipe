/** A JSON Schema object for Olostep's llm_extract, built from recipe `fields`. */
// A type alias, not an interface, so it is assignable to the SDK's Record<string, unknown>.
export type JsonSchema = {
  type: "object";
  properties: Record<string, { type: "string"; description: string }>;
  required: string[];
};

// Every field is a string for now: CSV cells are text anyway, and it keeps the
// model's job simple. Typed fields (number, boolean, list) are a tracked issue.
export function buildSchema(fields: Record<string, string>): JsonSchema {
  const properties: JsonSchema["properties"] = {};
  for (const [name, description] of Object.entries(fields)) {
    properties[name] = { type: "string", description };
  }
  return { type: "object", properties, required: Object.keys(fields) };
}

// Values land in spreadsheet cells, so ask for short, uniform answers.
export const EXTRACT_PROMPT =
  "Extract these fields from the page. Use only information on the page; if a field is not on the page, return an empty string. " +
  "Keep each value short (a few words, no full sentences unless the field asks for a note). " +
  "Follow the format and allowed values given in each field's description. Write values in English.";
