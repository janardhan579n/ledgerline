import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readXlsx } from './xlsx-read';
import { rowsFromTable } from './batch';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function book(sheetXml: string) {
  return zipSync({
    'xl/workbook.xml': strToU8(`<workbook ${NS}><sheets><sheet name="Instructions" sheetId="1" r:id="rId1"/><sheet name="Transactions" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`),
    'xl/sharedStrings.xml': strToU8(`<sst ${NS}><si><t>Date</t></si><si><t>Type</t></si><si><t>Amount</t></si><si><t>Account</t></si><si><r><t>Ex</t></r><r><t>pense</t></r></si><si><t>Salary &amp; bills</t></si></sst>`),
    'xl/styles.xml': strToU8(`<styleSheet ${NS}><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData></worksheet>`),
    'xl/worksheets/sheet2.xml': strToU8(`<worksheet ${NS}><sheetData>${sheetXml}</sheetData></worksheet>`),
    'xl/comments1.xml': strToU8('<comments/>'),
  });
}

describe('readXlsx', () => {
  it('reads the Transactions sheet with shared, rich and inline strings, dates and gaps', () => {
    const grid = readXlsx(book(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2" s="1"><v>46331</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" s="2"><v>1250.5</v></c><c r="D2" t="inlineStr"><is><t>Cash</t></is></c></row>' +
      '<row r="4"><c r="B4" t="str"><v>Income</v></c><c r="C4" t="e"><v>#N/A</v></c></row>',
    ));
    expect(grid[0]).toEqual(['Date', 'Type', 'Amount', 'Account']);
    expect(grid[1][0]).toEqual(new Date(Date.UTC(2026, 10, 5)));
    expect(grid[1].slice(1)).toEqual(['Expense', 1250.5, 'Cash']);
    expect(grid[2]).toEqual([]);
    expect(grid[3][1]).toBe('Income');
    const t = rowsFromTable(grid, 'MYR');
    expect(t.rows[0]).toMatchObject({ date: '2026-11-05', type: 'Expense', amount: '1250.5', account: 'Cash' });
    expect(t.lines).toEqual([2, 4]);
  });
  it('rejects files that are not workbooks', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/Excel workbook/);
  });
});
