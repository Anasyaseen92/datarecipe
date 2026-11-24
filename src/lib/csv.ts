// CSV that opens cleanly in Excel, Google Sheets and pandas (RFC 4180).

/** Quote a cell when it contains a comma, quote or line break; double inner quotes. */
export function csvCell(value: string): string {
  let text = value;
  // Scraped text is untrusted. A cell starting with = + - @ can run as a
  // spreadsheet formula, so prefix it with ' (plain numbers like -5 are safe).
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a CSV document. The BOM makes Excel read UTF-8 (accents, €, ä) correctly. */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const lines = [columns, ...rows.map((row) => columns.map((c) => row[c] ?? ""))].map((cells) =>
    cells.map(csvCell).join(","),
  );
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
