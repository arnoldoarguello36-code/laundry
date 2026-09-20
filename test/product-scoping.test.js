'use strict';
// Covers activeProducts()/activeProductsClientId(): the client-side filter
// that decides which products show up in an order sheet's item dropdown.
// Extracted verbatim from index.html and evaluated in an isolated vm
// context (see billing.test.js/layout.test.js for the same pattern) - no
// DOM, no Supabase client, just the two functions plus the handful of
// module-level vars they read (db, sheetMode, session, editingOrderId,
// orderDraftManualClientId).
//
// Business rule under test: a client with their own exclusive product
// catalog (owner_client_id) orders off THAT catalog exclusively - the
// dropdown shows only their exclusive items, not a merge of their items
// plus the shared catalog meant for everyone else. A client with no
// exclusive products of their own still sees the full shared catalog.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction } = require('./lib/extract-source');

function loadProducts(){
  const source = readAppSource();
  const code = [
    extractFunction(source, 'activeProductsClientId'),
    extractFunction(source, 'activeProducts'),
  ].join('\n\n');
  const sandbox = {
    db: undefined,
    sheetMode: 'client',
    session: { role:null, userId:null, actualRole:null },
    editingOrderId: null,
    orderDraftManualClientId: '',
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// Shared vs. exclusive catalog fixture: 3 shared products, 2 products
// exclusive to client 'norra', 1 exclusive to a different client 'other'.
const PRODUCTS = [
  { id:'shirt', key:'shirt', en:'Shirt', is:'Skyrta', active:true, staffOnly:false, sortOrder:1, ownerClientId:null },
  { id:'towel', key:'towel', en:'Towel', is:'Handklæði', active:true, staffOnly:false, sortOrder:2, ownerClientId:null },
  { id:'gull', key:'gull', en:'Yellow-tagged', is:'Gull', active:true, staffOnly:true, sortOrder:3, ownerClientId:null },
  { id:'buxur', key:'buxur', en:'Trousers', is:'Buxur', active:true, staffOnly:true, sortOrder:4, ownerClientId:'norra' },
  { id:'koddi', key:'koddi', en:'Pillow', is:'Koddi', active:true, staffOnly:true, sortOrder:5, ownerClientId:'norra' },
  { id:'other-excl', key:'other-excl', en:'Other-client item', is:'X', active:true, staffOnly:true, sortOrder:6, ownerClientId:'other' },
  { id:'inactive', key:'inactive', en:'Retired', is:'Y', active:false, staffOnly:false, sortOrder:7, ownerClientId:null },
];

test('client self-service (no exclusive catalog): sees shared, non-staff-only products only', () => {
  const sb = loadProducts();
  sb.db = { products: PRODUCTS };
  sb.sheetMode = 'client';
  sb.session = { role:'client', userId:'plain-client', actualRole:'client' };
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['shirt', 'towel']);
});

test('manual order, no client picked yet: shared catalog including staff-only items, no exclusives', () => {
  const sb = loadProducts();
  sb.db = { products: PRODUCTS };
  sb.sheetMode = 'manual';
  sb.orderDraftManualClientId = '';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['shirt', 'towel', 'gull']);
});

test('manual order for a client with an exclusive catalog: ONLY that catalog, shared items excluded', () => {
  const sb = loadProducts();
  sb.db = { products: PRODUCTS };
  sb.sheetMode = 'manual';
  sb.orderDraftManualClientId = 'norra';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['buxur', 'koddi']);
});

test('manual order for a client with an exclusive catalog never leaks another client\'s exclusive items', () => {
  const sb = loadProducts();
  sb.db = { products: PRODUCTS };
  sb.sheetMode = 'manual';
  sb.orderDraftManualClientId = 'norra';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.ok(!keys.includes('other-excl'));
});

test('manual order for a client with NO exclusive products: falls back to the shared catalog as before', () => {
  const sb = loadProducts();
  sb.db = { products: PRODUCTS };
  sb.sheetMode = 'manual';
  sb.orderDraftManualClientId = 'plain-client-with-no-exclusives';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['shirt', 'towel', 'gull']);
});

test('edit mode resolves the order\'s owning client and applies the same exclusive-catalog swap', () => {
  const sb = loadProducts();
  sb.db = {
    products: PRODUCTS,
    orders: [ { id:'o1', userId:'norra' } ],
  };
  sb.sheetMode = 'edit';
  sb.editingOrderId = 'o1';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['buxur', 'koddi']);
});

test('inactive products never appear, exclusive catalog or not', () => {
  const sb = loadProducts();
  sb.db = { products: PRODUCTS };
  sb.sheetMode = 'manual';
  sb.orderDraftManualClientId = '';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.ok(!keys.includes('inactive'));
});

// Edge case: hasExclusiveCatalog only counts a client's ACTIVE exclusive
// products. A client whose only exclusive product has been deactivated (and
// never replaced) is no longer treated as having an exclusive catalog, so
// they fall back to the shared catalog instead of staff seeing an empty,
// unexplained dropdown.
test('client whose only exclusive product is inactive falls back to the shared catalog, not an empty one', () => {
  const sb = loadProducts();
  sb.db = {
    products: [
      ...PRODUCTS,
      { id:'ghost', key:'ghost', en:'Deactivated exclusive', is:'Z', active:false, staffOnly:false, sortOrder:8, ownerClientId:'dormant-client' },
    ],
  };
  sb.sheetMode = 'manual';
  sb.orderDraftManualClientId = 'dormant-client';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['shirt', 'towel', 'gull']);
});

// Regression: hasExclusiveCatalog must count a client's exclusives using the
// SAME visibility gate (active + staffOnly-for-this-mode) as the returned
// list, not just active. Otherwise a client whose only active exclusive
// product is staffOnly-only still gets swapped onto "has an exclusive
// catalog" in client self-service mode - where staffOnly items are always
// filtered out - producing an empty activeProducts() list. Several call
// sites do activeProducts()[0].key to seed a fresh draft item, which throws
// on an empty array, crashing the "new order" flow for that client.
test('client whose only exclusive product is staffOnly-only falls back to shared catalog in client self-service mode', () => {
  const sb = loadProducts();
  sb.db = {
    products: [
      ...PRODUCTS,
      { id:'vip-only', key:'vip-only', en:'Staff-only exclusive', is:'Z', active:true, staffOnly:true, sortOrder:8, ownerClientId:'staffonly-client' },
    ],
  };
  sb.sheetMode = 'client';
  sb.session = { role:'client', userId:'staffonly-client', actualRole:'client' };
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['shirt', 'towel']);
});

// Same fixture, manual mode: staffOnly items ARE visible to staff, so the
// exclusive catalog swap should apply as normal there.
test('client whose only exclusive product is staffOnly-only still gets the exclusive swap in manual/staff mode', () => {
  const sb = loadProducts();
  sb.db = {
    products: [
      ...PRODUCTS,
      { id:'vip-only', key:'vip-only', en:'Staff-only exclusive', is:'Z', active:true, staffOnly:true, sortOrder:8, ownerClientId:'staffonly-client' },
    ],
  };
  sb.sheetMode = 'manual';
  sb.orderDraftManualClientId = 'staffonly-client';
  const keys = sb.activeProducts().map(p=>p.key);
  assert.deepEqual(keys, ['vip-only']);
});
