import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "./csv.js";

describe("CSV writer", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
  });

  it("neutralizes spreadsheet formulas but keeps plain numbers", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-5")).toBe("-5");
  });

  it("writes a BOM, a header and CRLF rows in column order", () => {
    const csv = toCsv(["company", "price"], [{ price: "$10, monthly", company: "Acme" }, { company: "Beta" }]);
    expect(csv).toBe('\uFEFFcompany,price\r\nAcme,"$10, monthly"\r\nBeta,\r\n');
  });
});
