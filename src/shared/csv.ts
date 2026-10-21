/** Lecture de CSV simples (imports d'effectifs, de signatures) : séparateur , ou ;, guillemets gérés. */

export interface ParsedCsv {
  header: string[];
  /** Lignes non vides, indexées par nom de colonne (en minuscules), valeurs nettoyées. */
  rows: Record<string, string>[];
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): ParsedCsv {
  const lines = stripBom(text)
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return { header: [], rows: [] };
  const first = lines[0];
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = splitCsvLine(first, sep).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, sep).map((c) => c.trim());
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
  return { header, rows };
}
