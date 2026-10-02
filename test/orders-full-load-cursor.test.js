'use strict';
// Value: protects=loadOrders()'s ordersLastSync cursor seeding from the full
// initial fetch; fails_when=cursor is set to the first/last row's updated_at
// instead of the true max, or left stale/null on an empty fetch; why_new=no
// test covers loadOrders()'s cursor-seeding branch, a new-code path on this
// branch; seam=none
// Covers loadOrders()'s db.ordersLastSync assignment (see index.html's
// loadOrders()/loadOrdersIncremental() pair): the one-full-load-per-login
// path fetches rows ordered by created_at (not updated_at), then must derive
// the cursor as the MAX updated_at across every fetched row via a reduce -
// not just data[0] (first by created_at) or data[last] - since those two
// orderings can disagree. Also covers the empty-result fallback to "now" so
// a brand-new/empty orders table still leaves a usable cursor for the first
// incremental poll instead of null.
//
// loadOrders() talks to a real Supabase client (`sb.from(...).select(...)
// .order(...)`) with no seam/injection point of its own, so this mocks `sb`
// as a plain chainable object directly in the vm sandbox, same technique
// test/orders-incremental.test.js uses, rather than hitting a live Supabase
// instance. mapOrder() is extracted verbatim alongside it since loadOrders
// calls it on each fetched row.
// Run with: node --test test/ (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction, extractSimpleConst } = require('./lib/extract-source');

function makeMockSb(response){
  const calls = { table: null, orderCol: null, orderOpts: null };
  return {
    calls,
    from(table){
      calls.table = table;
      return {
        select(){
          return {
            order(col, opts){
              calls.orderCol = col; calls.orderOpts = opts;
              return response;
            }
          };
        }
      };
    }
  };
}

function loadFullOrders({ sbResponse }){
  const source = readAppSource();
  const code = [
    extractSimpleConst(source, 'ORDER_SELECT'),
    extractFunction(source, 'mapOrder'),
    'async ' + extractFunction(source, 'loadOrders'), // extractFunction drops the `async` keyword (see orders-incremental.test.js)
  ].join('\n\n');
  const sandbox = {
    db: { orders: [], ordersLastSync: null },
    sb: makeMockSb(sbResponse),
    t: (key) => key,
    toast: () => {},
    console: { error: () => {} },
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

test('loadOrders(): on the full fetch, db.ordersLastSync advances to the MAX updated_at across all rows (not data[0]/data[last] by created_at order)', async () => {
  // data is ordered by created_at desc (loadOrders' real .order() call), so
  // the row with the largest updated_at is NOT necessarily first or last -
  // here it's first, while a "take the last element" bug would read the
  // smaller trailing value instead.
  const newest = row('o1', { updated_at: '2026-10-02T12:00:00Z' });
  const older = row('o2', { updated_at: '2026-10-02T08:00:00Z' });
  const sb = loadFullOrders({ sbResponse: { data: [newest, older], error: null } });

  await sb.loadOrders();

  assert.equal(sb.db.orders.length, 2);
  assert.equal(sb.db.ordersLastSync, '2026-10-02T12:00:00Z', 'cursor is the true max, not data[0] coincidentally nor the last array element');
  assert.equal(sb.sb.calls.orderCol, 'created_at');
});

test('loadOrders(): with zero rows returned, db.ordersLastSync falls back to "now" (a valid ISO string) instead of staying null', async () => {
  const before = Date.now();
  const sb = loadFullOrders({ sbResponse: { data: [], error: null } });

  await sb.loadOrders();
  const after = Date.now();

  assert.equal(sb.db.orders.length, 0);
  assert.equal(typeof sb.db.ordersLastSync, 'string');
  const cursorMs = new Date(sb.db.ordersLastSync).getTime();
  assert.ok(cursorMs >= before && cursorMs <= after, 'cursor is a fresh "now" timestamp, not null/undefined, so the first incremental poll has a usable starting point');
});
