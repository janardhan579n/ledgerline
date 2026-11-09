import { strFromU8, unzipSync } from 'fflate';

/**
 * Minimal .xlsx reader: returns the cell values of one sheet as a grid.
 * Only values are read (no styles, comments or drawings), which makes it tolerant of files
 * saved by Excel, Numbers, Google Sheets, LibreOffice or scripts. Dates come back as Excel
 * serial numbers when the cell is a date-formatted number; callers convert them.
 */
export function readXlsx(data: Uint8Array, preferSheet = 'Transactions', maxRows = 5000): unknown[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  } catch {
    throw new Error("That file couldn't be opened as an Excel workbook. Save it again as .xlsx and retry.");
  }
  const xml = (path: string) => (files[path] ? parse(strFromU8(files[path])) : null);
  const wb = xml('xl/workbook.xml');
  if (!wb) throw new Error("That file couldn't be opened as an Excel workbook. Save it again as .xlsx and retry.");

  // Work out which sheet file to read.
  const rels = xml('xl/_rels/workbook.xml.rels');
  const target = new Map<string, string>();
  for (const r of byTag(rels, 'Relationship')) target.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
  const sheets = byTag(wb, 'sheet').map((s) => ({
    name: s.getAttribute('name') ?? '',
    hidden: !!s.getAttribute('state') && s.getAttribute('state') !== 'visible',
    rid: s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '',
  }));
  const pick = sheets.find((s) => s.name.toLowerCase() === preferSheet.toLowerCase()) ?? sheets.find((s) => !s.hidden && s.name !== 'Lists' && s.name !== 'Instructions') ?? sheets[0];
  if (!pick) throw new Error('That workbook has no sheets.');
  let path = target.get(pick.rid) ?? '';
  path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
  const sheet = xml(path);
  if (!sheet) throw new Error('That workbook has no readable sheet.');

  const shared = byTag(xml('xl/sharedStrings.xml'), 'si').map(textOf);
  const dateStyles = dateStyleIndexes(xml('xl/styles.xml'));

  const grid: unknown[][] = [];
  for (const row of byTag(sheet, 'row')) {
    const r = Number(row.getAttribute('r')) || grid.length + 1;
    if (r > maxRows) break;
    const cells: unknown[] = [];
    for (const c of Array.from(row.children).filter((x) => x.localName === 'c')) {
      const col = colIndex(c.getAttribute('r')) ?? cells.length;
      const t = c.getAttribute('t');
      const v = Array.from(c.children).find((x) => x.localName === 'v')?.textContent ?? '';
      let value: unknown = '';
      if (t === 's') value = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') value = textOf(Array.from(c.children).find((x) => x.localName === 'is') ?? c);
      else if (t === 'str' || t === 'e') value = t === 'e' ? '' : v;
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== '') {
        const n = Number(v);
        value = Number.isNaN(n) ? v : dateStyles.has(Number(c.getAttribute('s') ?? -1)) ? serialToDate(n) : n;
      }
      cells[col] = value;
    }
    grid[r - 1] = cells;
  }
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return grid;
}

const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (doc: Document | Element | null, tag: string): Element[] => (doc ? Array.from(doc.getElementsByTagNameNS('*', tag)) : []);
/** Text of a shared/inline string, skipping phonetic hints. */
const textOf = (el: Element) => byTag(el, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent ?? '').join('');

function colIndex(ref: string | null): number | null {
  const m = ref?.match(/^([A-Z]+)/);
  if (!m) return null;
  return [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** Style indexes (cellXfs) whose number format is a date. */
function dateStyleIndexes(styles: Document | null): Set<number> {
  const out = new Set<number>();
  if (!styles) return out;
  const custom = new Map<number, string>();
  for (const f of byTag(styles, 'numFmt')) custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '');
  const isDate = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /(^|[^"\\])[dmy]{1,4}/i.test((custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, ''));
  const xfs = byTag(styles, 'cellXfs')[0];
  Array.from(xfs?.children ?? []).filter((x) => x.localName === 'xf').forEach((xf, i) => {
    if (isDate(Number(xf.getAttribute('numFmtId') ?? 0))) out.add(i);
  });
  return out;
}

/** Excel serial (1900 date system) to a UTC midnight Date. */
function serialToDate(n: number): Date | number {
  if (n < 1 || n > 2958465) return n;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
}
