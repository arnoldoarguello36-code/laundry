'use strict';
// E-series: verifies the pricing/VAT breakdown section appended to
// exportVolumeExcel()'s Excel export. computeVolumeReport, sanitizeSheetName,
// fillVolumeSheet and exportVolumeExcel are extracted verbatim from
// index.html and run in an isolated vm context against a mock ExcelJS
// (records cell writes into plain objects instead of touching the real
// xlsx writer), a mock fetch/document/URL/Blob (the function's logo-fetch +
// anchor-click download flow), and a stubbed t() that echoes the i18n key
// so cell contents can be asserted without loading the full I18N table.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction } = require('./lib/extract-source');

function makeMockExcelJS(){
  function Row(){ this.cells = {}; }
  Row.prototype.getCell = function(c){
    if(!this.cells[c]) this.cells[c] = { value: undefined, font: undefined, fill: undefined, alignment: undefined, border: undefined, numFmt: undefined };
    return this.cells[c];
  };
  Row.prototype.eachCell = function(fn){ Object.values(this.cells).forEach(fn); };

  function Worksheet(){ this.rows = {}; this.cols = {}; this.merges = []; }
  Worksheet.prototype.getColumn = function(c){ if(!this.cols[c]) this.cols[c] = { width: 0 }; return this.cols[c]; };
  Worksheet.prototype.getRow = function(n){ if(!this.rows[n]) this.rows[n] = new Row(); return this.rows[n]; };
  Worksheet.prototype.mergeCells = function(...args){ this.merges.push(args); };
  Worksheet.prototype.addImage = function(){};
  Worksheet.prototype.getCell = function(rowNum, colNum){ return this.getRow(rowNum).getCell(colNum); };

  function Workbook(){
    this.worksheets = {};
    this.xlsx = { writeBuffer: async () => new Uint8Array() };
    MockExcelJS.lastWorkbook = this;
  }
  Workbook.prototype.addWorksheet = function(name){ const ws = new Worksheet(); this.worksheets[name] = ws; return ws; };
  Workbook.prototype.addImage = function(){ return 0; };

  const MockExcelJS = { Workbook };
  return MockExcelJS;
}

function loadExport(){
  const source = readAppSource();
  // extractFunction's regex matches on the bare `function name(` token, so
  // for `async function exportVolumeExcel(...)` it returns the slice
  // starting at `function`, dropping the `async` keyword — restore it here
  // rather than loosening the shared extractor for one caller.
  const code = [
    extractFunction(source, 'computeVolumeReport'),
    extractFunction(source, 'sanitizeSheetName'),
    extractFunction(source, 'fillVolumeSheet'),
    'async ' + extractFunction(source, 'exportVolumeExcel'),
  ].join('\n\n');
  const sandbox = {
    db: undefined,
    lang: 'en',
    t: (key) => key,
    toast: () => {},
    ExcelJS: makeMockExcelJS(),
    fetch: async () => { throw new Error('no network in test'); },
    document: {
      createElement: () => ({ click(){} }),
      body: { appendChild(){}, removeChild(){} },
    },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    Blob: function Blob(){},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const PRODUCTS = [
  { id:'sheet', key:'sheet', price:500, unit:'kg', sortOrder:1, en:'Sheet', is:'Sæng' },
  { id:'shirt', key:'shirt', price:300, unit:'piece', sortOrder:2, en:'Shirt', is:'Skyrta' },
  { id:'other', key:'other', price:null, unit:'piece', sortOrder:3, en:'Other', is:'Annað' },
];

const RANGE_START = '2026-07-01';
const RANGE_END = '2026-07-31';
const IN_RANGE = new Date('2026-07-15T12:00:00').getTime();

function order(id, items){
  return { id, userId:'u1', creado: IN_RANGE, items };
}

const CLIENT = { id:'u1', role:'client', name:'Client One' };

function pricingRows(ws){
  // The pricing section's header row is the first row (after the quantity
  // table + a blank spacer) whose first cell equals the stubbed t() key
  // for "Product".
  const rowNums = Object.keys(ws.rows).map(Number).sort((a,b)=>a-b);
  const headerRowNum = rowNums.find(n => ws.rows[n].cells[1] && ws.rows[n].cells[1].value === 'rep_volume_product');
  return { rowNums, headerRowNum };
}

test('pricing/VAT section: amount = price × qty, VAT is 24% on top of net subtotal', async () => {
  const sb = loadExport();
  sb.db = { orders: [ order('o1', [ {tipo:'sheet', cant:2}, {tipo:'shirt', cant:1} ]) ], products: PRODUCTS, users: [CLIENT] };
  sb.volumeStart = RANGE_START; sb.volumeEnd = RANGE_END; sb.volumeClientFilter = 'all';

  await sb.exportVolumeExcel();

  const ws = sb.ExcelJS.lastWorkbook.worksheets['Client One'];
  const { rowNums, headerRowNum } = pricingRows(ws);
  assert.ok(headerRowNum, 'expected a pricing section header row');

  // sheet: 500 * 2 = 1000, shirt: 300 * 1 = 300 -> subtotal 1300
  const dataRows = rowNums.filter(n => n > headerRowNum).map(n => ws.rows[n]);
  const sheetRow = dataRows.find(r => r.cells[3] && r.cells[3].value === 2);
  const shirtRow = dataRows.find(r => r.cells[3] && r.cells[3].value === 1);
  assert.equal(sheetRow.cells[2].value, 500, 'sheet unit price');
  assert.equal(sheetRow.cells[4].value, 1000, 'sheet amount = price * qty');
  assert.equal(shirtRow.cells[2].value, 300, 'shirt unit price');
  assert.equal(shirtRow.cells[4].value, 300, 'shirt amount = price * qty');

  const subtotalRow = rowNums.map(n=>ws.rows[n]).find(r => r.cells[1] && r.cells[1].value === 'rep_volume_subtotal');
  const vatRow = rowNums.map(n=>ws.rows[n]).find(r => r.cells[1] && r.cells[1].value === 'rep_volume_vat');
  const totalVatRow = rowNums.map(n=>ws.rows[n]).find(r => r.cells[1] && r.cells[1].value === 'rep_volume_total_vat');
  assert.equal(subtotalRow.cells[4].value, 1300);
  assert.equal(vatRow.cells[4].value, 1300 * 0.24);
  assert.equal(totalVatRow.cells[4].value, 1300 * 1.24);
});

test('unpriced products (price===null) are excluded from the pricing section and flagged via a note', async () => {
  const sb = loadExport();
  sb.db = { orders: [ order('o1', [ {tipo:'sheet', cant:1}, {tipo:'other', cant:5} ]) ], products: PRODUCTS, users: [CLIENT] };
  sb.volumeStart = RANGE_START; sb.volumeEnd = RANGE_END; sb.volumeClientFilter = 'all';

  await sb.exportVolumeExcel();

  const ws = sb.ExcelJS.lastWorkbook.worksheets['Client One'];
  const { rowNums, headerRowNum } = pricingRows(ws);
  const rows = rowNums.map(n => ws.rows[n]);
  const dataRows = rowNums.filter(n => n > headerRowNum).map(n => ws.rows[n]);

  // Only "sheet" (priced) should appear as a pricing-section data row.
  assert.ok(dataRows.some(r => r.cells[3] && r.cells[3].value === 1 && r.cells[2].value === 500));
  assert.ok(!dataRows.some(r => r.cells[3] && r.cells[3].value === 5), 'unpriced "other" product must not appear in pricing rows');

  const noteRow = rows.find(r => r.cells[1] && r.cells[1].value === 'billing_pending_note');
  assert.ok(noteRow, 'expected the pending-price note when an active product has no price');

  const subtotalRow = rows.find(r => r.cells[1] && r.cells[1].value === 'rep_volume_subtotal');
  assert.equal(subtotalRow.cells[4].value, 500, 'subtotal excludes the unpriced product');
});

test('all active products priced: no pending note is added', async () => {
  const sb = loadExport();
  sb.db = { orders: [ order('o1', [ {tipo:'sheet', cant:1}, {tipo:'shirt', cant:1} ]) ], products: PRODUCTS, users: [CLIENT] };
  sb.volumeStart = RANGE_START; sb.volumeEnd = RANGE_END; sb.volumeClientFilter = 'all';

  await sb.exportVolumeExcel();

  const ws = sb.ExcelJS.lastWorkbook.worksheets['Client One'];
  const rows = Object.values(ws.rows);
  const noteRow = rows.find(r => r.cells[1] && r.cells[1].value === 'billing_pending_note');
  assert.equal(noteRow, undefined);
});
