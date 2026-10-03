'use strict';
// Value: protects=loadOrdersIncremental's merge-by-id logic and error
// handling; fails_when=a merge duplicates or mis-replaces rows, the cursor
// advances incorrectly, or a Supabase error silently corrupts db.orders;
// why_new=no existing test covers the new incremental-sync fetch-and-merge
// path; seam=none
// Covers loadOrdersIncremental()'s merge-by-id logic and error handling (see
// index.html's loadOrders()/loadOrdersIncremental() pair, added so polling
// and post-mutation refreshes don't re-pull the whole orders table every
// time — only rows with updated_at past the db.ordersLastSync cursor).
//
// loadOrdersIncremental() talks to a real Supabase client (`sb.from(...)
// .select(...).gt(...).order(...)`) with no seam/injection point of its
// own, so this mocks `sb` as a plain chainable object directly in the vm
// sandbox (same technique volume-export.test.js uses for ExcelJS/fetch/
// document) rather than hitting a live Supabase instance. mapOrder() is
// extracted verbatim alongside it since loadOrdersIncremental calls it
// directly on each fetched row.
// Run with: node --test test/ (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction, extractSimpleConst } = require('./lib/extract-source');

// Records the .gt()/.order() args it was called with so tests can assert the
// query shape, then resolves to `response` ({data, error}) - plain objects
// (not Promises) resolve fine under `await` since await only special-cases
// thenables.
function makeMockSb(response){
  const calls = { table: null, gtCol: null, gtVal: null, orderCol: null, orderOpts: null };
  return {
    calls,
    from(table){
      calls.table = table;
      return {
        select(){
          return {
            gt(col, val){
              calls.gtCol = col; calls.gtVal = val;
              return {
                order(col2, opts){
                  calls.orderCol = col2; calls.orderOpts = opts;
                  return response;
                }
              };
            }
          };
        }
      };
    }
  };
}

function loadIncremental({ sbResponse, ordersLastSync, orders }){
  const source = readAppSource();
  const code = [
    extractSimpleConst(source, 'ORDER_SELECT'),
    extractSimpleConst(source, 'SYNC_CURSOR_SAFETY_MARGIN_MS'),
    extractFunction(source, 'mapOrder'),
    'async ' + extractFunction(source, 'loadOrdersIncremental'), // extractFunction drops the `async` keyword (see volume-export.test.js)
  ].join('\n\n');
  const toastCalls = [];
  const errorCalls = [];
  const sandbox = {
    db: { orders: orders || [], ordersLastSync: ordersLastSync },
    sb: makeMockSb(sbResponse),
    t: (key) => key,
    toast: (msg) => toastCalls.push(msg),
    loadOrders: async () => { throw new Error('loadOrders() fallback should not run in these tests'); },
    console: { error: (...args) => errorCalls.push(args) },
    toastCalls, errorCalls,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

function row(id, overrides){
  return Object.assign({
    id, client_id:'u1', client_name:null, fecha:'2026-10-02', comentarios:null,
    order_items:[], estado:'en-cola', urgent:false, return_method:'store', pickup:false,
    pickup_address:null, problem:false, source:'client', notas:[],
    created_at:'2026-10-01T10:00:00Z', delivered_at:null, updated_at:'2026-10-02T10:00:00Z',
  }, overrides||{});
}

test('loadOrdersIncremental: merges fetched rows by id - existing order updated in place, new order added to front, cursor advances to the last row', async () => {
  const existing = { id:'o1', estado:'en-cola', foo:'stale' };
  const updatedRow = row('o1', { estado:'listo', updated_at:'2026-10-02T11:00:00Z' });
  const newRow = row('o2', { updated_at:'2026-10-02T12:00:00Z' });
  const sb = loadIncremental({
    sbResponse: { data: [updatedRow, newRow], error: null },
    ordersLastSync: '2026-10-02T09:00:00Z',
    orders: [existing],
  });

  await sb.loadOrdersIncremental();

  assert.equal(sb.db.orders.length, 2, 'no duplicate rows - o1 updated in place, o2 added');
  // o1 updated in place (same index it started at, not re-pushed/duplicated)
  const o1 = sb.db.orders.find(o=>o.id==='o1');
  assert.equal(o1.estado, 'listo');
  assert.equal(o1.foo, undefined, 'stale fields from the pre-merge object are gone - replaced wholesale by the freshly mapped row');
  // o2 is new - unshifted to the front, not appended
  assert.equal(sb.db.orders[0].id, 'o2');
  // cursor advances to the *last* row in the (ascending-ordered) response
  assert.equal(sb.db.ordersLastSync, '2026-10-02T12:00:00Z');
  assert.equal(sb.sb.calls.gtCol, 'updated_at');
  // Queried floor is the cursor minus SYNC_CURSOR_SAFETY_MARGIN_MS (2000ms),
  // not the raw cursor - see the safety-margin comment above
  // SYNC_CURSOR_SAFETY_MARGIN_MS in index.html for why. The *stored* cursor
  // (asserted above as the unmodified last-row updated_at) still always
  // advances to the true max seen; only this query's lower bound is widened.
  assert.equal(sb.sb.calls.gtVal, '2026-10-02T08:59:58.000Z');
  // Cursor-advance-to-last-row only gives the true max updated_at if the
  // query actually asked Supabase to sort ascending - this asserts the real
  // query shape instead of just trusting the mock's hand-ordered data array,
  // so a regression that drops/flips {ascending:true} fails here instead of
  // passing silently.
  assert.equal(sb.sb.calls.orderCol, 'updated_at');
  assert.deepEqual(sb.sb.calls.orderOpts, { ascending: true });
});

test('loadOrdersIncremental: on a Supabase error, reports it and leaves db.orders/cursor untouched (no partial/corrupt merge)', async () => {
  const sb = loadIncremental({
    sbResponse: { data: null, error: { message: 'network blip' } },
    ordersLastSync: '2026-10-02T09:00:00Z',
    orders: [{ id:'o1', estado:'en-cola' }],
  });

  await sb.loadOrdersIncremental();

  assert.equal(sb.db.orders.length, 1);
  assert.equal(sb.db.orders[0].estado, 'en-cola', 'untouched on error');
  assert.equal(sb.db.ordersLastSync, '2026-10-02T09:00:00Z', 'cursor not advanced on error');
  assert.equal(sb.toastCalls.length, 1);
  assert.equal(sb.toastCalls[0], 'err_generic');
  assert.equal(sb.errorCalls.length, 1);
});

// Value: protects=loadOrdersIncremental()'s no-cursor fallback to
// loadOrders() instead of a nonsensical .gt(updated_at, null) query;
// fails_when=a missing/changed cursor check lets a null-cursor poll query
// Supabase directly instead of falling back; why_new=new branch on this
// branch; no test exercises the null/undefined-cursor fallback path;
// seam=none
test('loadOrdersIncremental: with no cursor yet (ordersLastSync null/undefined), falls back to loadOrders() without ever querying Supabase', async () => {
  const source = readAppSource();
  const code = [
    extractFunction(source, 'mapOrder'),
    'async ' + extractFunction(source, 'loadOrdersIncremental'),
  ].join('\n\n');

  for(const missingCursor of [null, undefined]){
    const loadOrdersCalls = [];
    const sandbox = {
      db: { orders: [], ordersLastSync: missingCursor },
      // sb.from() throws if ever called - proves loadOrdersIncremental takes
      // the fallback branch instead of issuing `.gt('updated_at', null)`.
      sb: { from(){ throw new Error('sb.from() should not be called when there is no cursor yet'); } },
      t: (key) => key,
      toast: () => {},
      loadOrders: async () => { loadOrdersCalls.push(true); },
      console: { error: () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    await sandbox.loadOrdersIncremental();

    assert.equal(loadOrdersCalls.length, 1, `loadOrders() fallback called exactly once for ordersLastSync=${missingCursor}`);
  }
});

// Value: protects=loadOrdersIncremental()'s empty-data no-op - leaves
// db.orders and db.ordersLastSync untouched; fails_when=an empty data:[]
// response still advances/corrupts the cursor (e.g. to undefined) or
// mutates db.orders; why_new=new branch on this branch; no test exercises
// the empty-array early-return path; seam=none
test('loadOrdersIncremental: an empty data:[] response (nothing changed since the cursor) is a safe no-op - orders and cursor stay exactly as they were', async () => {
  const sb = loadIncremental({
    sbResponse: { data: [], error: null },
    ordersLastSync: '2026-10-02T09:00:00Z',
    orders: [{ id:'o1', estado:'en-cola' }],
  });

  await sb.loadOrdersIncremental();

  assert.equal(sb.db.orders.length, 1);
  assert.equal(sb.db.orders[0].estado, 'en-cola', 'db.orders untouched');
  assert.equal(sb.db.ordersLastSync, '2026-10-02T09:00:00Z', 'cursor not corrupted to undefined via data[data.length-1] indexing into an empty array');
  assert.equal(sb.toastCalls.length, 0, 'no error toast on a legitimate empty result');
});
