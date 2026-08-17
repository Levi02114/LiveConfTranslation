type Terms = Record<string, string>;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeGlossaryCsv(languageCodes: readonly string[], rows: readonly Terms[]): string {
  return [
    languageCodes.map(csvCell).join(","),
    ...rows.map((terms) => languageCodes.map((code) => csvCell(terms[code] ?? "")).join(",")),
  ].join("\r\n");
}

function parseCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error("invalid CSV");
    }
    if (character === '"') {
      if (field) throw new Error("invalid CSV");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("invalid CSV");
  if (afterQuote || field || row.length > 0 || text.endsWith(",")) rows.push([...row, field]);
  return rows;
}

export function parseGlossaryCsv(text: string, languageCodes: readonly string[]): Terms[] {
  const [rawHeaders, ...rawRows] = parseCells(text.replace(/^\uFEFF/, ""));
  if (!rawHeaders) throw new Error("missing CSV header");

  const headers = rawHeaders.map((header) => header.trim());
  const expected = new Set(languageCodes);
  if (
    headers.length !== expected.size ||
    new Set(headers).size !== headers.length ||
    headers.some((header) => !expected.has(header))
  ) {
    throw new Error("language headers do not match");
  }

  const rows: Terms[] = [];
  const seen = Object.fromEntries(languageCodes.map((code) => [code, new Set<string>()]));
  for (const cells of rawRows) {
    if (cells.every((cell) => !cell.trim())) continue;
    if (cells.length !== headers.length) throw new Error("column count does not match");

    const terms = Object.fromEntries(headers.map((header, index) => [header, cells[index].trim()]));
    for (const code of languageCodes) {
      const term = terms[code];
      const normalized = term?.normalize().toLocaleLowerCase();
      if (!term || term.length > 500 || /[\t\r\n]/.test(term) || seen[code].has(normalized)) {
        throw new Error("invalid glossary term");
      }
      seen[code].add(normalized);
    }
    rows.push(terms);
    if (rows.length > 500) throw new Error("too many glossary entries");
  }

  return rows;
}
