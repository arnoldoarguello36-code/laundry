'use strict';
// E7: first automated tests in the repo, scoped to the new pure functions
// introduced by T7+E5 (billing summary panel) and E1 (see layout.test.js).
// Run with: node --test test/
//
// computeBillingSummary() and its direct dependencies (CATEGORIES,
// priceEntry, computeItemCost) are extracted verbatim from index.html and
// evaluated in an isolated vm context - no DOM, no Supabase client, no new
// build step/framework. `db` and `lang` are the only free globals these
// functions read, so the sandbox just needs to provide those two.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction, extractConst } = require('./lib/extract-source');

function loadBilling(){
  const source = readAppSource();
  const code = [
    extractConst(source, 'CATEGORIES'),
    extractFunction(source, 'priceEntry'),
    extractFunction(source, 'computeItemCost'),
    extractFunction(source, 'computeBillingSummary'),
  ].join('\n\n');
  const sandbox = { db: undefined, lang: 'en' };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const PRODUCTS = [
  { id:'sheet', key:'sheet', price:500, category:'bedding' },
  { id:'shirt', key:'shirt', price:300, category:'apparel' },
  { id:'towel', key:'towel', price:200, category:'general' },
  { id:'other', key:'other', price:null, category:'other' },
];

const RANGE_START = '2026-07-01';
const RANGE_END = '2026-07-31';
const IN_RANGE = new Date('2026-07-15T12:00:00').getTime();

function order(id, items, extra){
  return Object.assign({ id, userId:'u1', creado: IN_RANGE, items, returnMethod:'store', pickup:false }, extra||{});
}

function catValue(result, cat){
  return result.catRows.find(r=>r.cat===cat).value;
}

test('zero orders in range: all four categories present at 0, no pending, zero totals', () => {
  const sb = loadBilling();
  sb.db = { orders: [], settings: { deliveryFee:500, pickupFee:300 }, products: PRODUCTS };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'all');
  assert.equal(result.catRows.length, 4);
  assert.deepEqual(result.catRows.map(r=>r.cat).sort(), ['apparel','bedding','general','other']);
  for(const row of result.catRows) assert.equal(row.value, 0);
  assert.equal(result.transportes, 0);
  assert.equal(result.grandTotal, 0);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.orderCount, 0);
});

test('all-pending "other" items: excluded from every total, counted via pendingCount instead of zero', () => {
  const sb = loadBilling();
  sb.db = {
    orders: [ order('o1', [ {tipo:'other', cant:3} ]) ],
    settings: { deliveryFee:500, pickupFee:300 },
    products: PRODUCTS,
  };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'all');
  for(const row of result.catRows) assert.equal(row.value, 0);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.grandTotal, 0);
  assert.equal(result.transportes, 0);
});

test('mixed priced/unpriced items: priced item counted, unpriced "other" item excluded and flagged', () => {
  const sb = loadBilling();
  sb.db = {
    orders: [ order('o1', [ {tipo:'sheet', cant:2}, {tipo:'other', cant:1} ]) ],
    settings: { deliveryFee:0, pickupFee:0 },
    products: PRODUCTS,
  };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'all');
  assert.equal(catValue(result, 'bedding'), 1000);
  assert.equal(catValue(result, 'apparel'), 0);
  assert.equal(catValue(result, 'general'), 0);
  assert.equal(catValue(result, 'other'), 0);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.grandTotal, 1000);
});

test('single category: only the touched category accrues a subtotal', () => {
  const sb = loadBilling();
  sb.db = {
    orders: [ order('o1', [ {tipo:'sheet', cant:1}, {tipo:'sheet', cant:1} ]) ],
    settings: { deliveryFee:0, pickupFee:0 },
    products: PRODUCTS,
  };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'all');
  assert.equal(catValue(result, 'bedding'), 1000);
  assert.equal(catValue(result, 'apparel'), 0);
  assert.equal(catValue(result, 'general'), 0);
  assert.equal(result.grandTotal, 1000);
});

test('multiple categories: each accrues its own independent subtotal', () => {
  const sb = loadBilling();
  sb.db = {
    orders: [ order('o1', [ {tipo:'sheet', cant:1}, {tipo:'shirt', cant:1}, {tipo:'towel', cant:1} ]) ],
    settings: { deliveryFee:0, pickupFee:0 },
    products: PRODUCTS,
  };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'all');
  assert.equal(catValue(result, 'bedding'), 500);
  assert.equal(catValue(result, 'apparel'), 300);
  assert.equal(catValue(result, 'general'), 200);
  assert.equal(catValue(result, 'other'), 0);
  assert.equal(result.grandTotal, 1000);
});

test('Transportes combines delivery_fee + pickup_fee across orders in range', () => {
  const sb = loadBilling();
  sb.db = {
    orders: [
      order('o1', [ {tipo:'sheet', cant:1} ], { returnMethod:'delivery', pickup:true }),
      order('o2', [ {tipo:'shirt', cant:1} ], { returnMethod:'store', pickup:false }),
    ],
    settings: { deliveryFee:500, pickupFee:300 },
    products: PRODUCTS,
  };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'all');
  // o1 contributes both fees (delivery + pickup), o2 contributes neither.
  assert.equal(result.transportes, 800);
  assert.equal(catValue(result, 'bedding'), 500);
  assert.equal(catValue(result, 'apparel'), 300);
  assert.equal(result.grandTotal, 500 + 300 + 800);
});

test('clientId filter: only the matching client\'s orders are counted, others excluded', () => {
  const sb = loadBilling();
  sb.db = {
    orders: [
      order('o1', [ {tipo:'sheet', cant:1} ], { userId:'u1' }),
      order('o2', [ {tipo:'shirt', cant:1} ], { userId:'u2' }),
    ],
    settings: { deliveryFee:0, pickupFee:0 },
    products: PRODUCTS,
  };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'u2');
  assert.equal(result.orderCount, 1);
  assert.equal(catValue(result, 'bedding'), 0);
  assert.equal(catValue(result, 'apparel'), 300);
  assert.equal(result.grandTotal, 300);
});

test('date range boundaries: orders before start or on/after the day after end are excluded', () => {
  const sb = loadBilling();
  const beforeRange = new Date('2026-06-30T23:00:00').getTime();
  const onEndDay = new Date(RANGE_END+'T09:00:00').getTime();
  const afterRange = new Date('2026-08-01T00:00:00').getTime();
  sb.db = {
    orders: [
      order('o-before', [ {tipo:'sheet', cant:1} ], { creado: beforeRange }),
      order('o-on-end-day', [ {tipo:'shirt', cant:1} ], { creado: onEndDay }),
      order('o-after', [ {tipo:'towel', cant:1} ], { creado: afterRange }),
    ],
    settings: { deliveryFee:0, pickupFee:0 },
    products: PRODUCTS,
  };
  const result = sb.computeBillingSummary(RANGE_START, RANGE_END, 'all');
  // Only the order dated on the last inclusive day (RANGE_END) should count.
  assert.equal(result.orderCount, 1);
  assert.equal(catValue(result, 'apparel'), 300);
  assert.equal(catValue(result, 'bedding'), 0);
  assert.equal(catValue(result, 'general'), 0);
  assert.equal(result.grandTotal, 300);
});

test('i18n: every billing_* string key exists in both en and is locales', () => {
  const source = readAppSource();
  const i18nCode = extractConst(source, 'I18N').replace(/^const\s+/, 'var ');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(i18nCode, sandbox);
  const billingKeysEn = Object.keys(sandbox.I18N.en).filter(k=>k.startsWith('billing_'));
  const billingKeysIs = Object.keys(sandbox.I18N.is).filter(k=>k.startsWith('billing_'));
  assert.ok(billingKeysEn.length >= 5, 'expected at least 5 billing_* keys in en');
  assert.deepEqual(billingKeysEn.sort(), billingKeysIs.sort());
  for(const k of billingKeysEn){
    assert.ok(sandbox.I18N.en[k] && sandbox.I18N.en[k].length > 0, `en.${k} should be a non-empty string`);
    assert.ok(sandbox.I18N.is[k] && sandbox.I18N.is[k].length > 0, `is.${k} should be a non-empty string`);
  }
});
