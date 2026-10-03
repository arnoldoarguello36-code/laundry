'use strict';
// Value: protects=toDatetimeLocalValue/fromDatetimeLocalValue round-trip and
// null/epoch-0/invalid-string edge cases; fails_when=zero-padding breaks,
// epoch 0 is swallowed as "empty", or an unparseable string throws or
// returns "Invalid Date" instead of null; why_new=no existing test covers
// these new datetime-local converters added for the admin delivered_at
// field; seam=none
// Covers toDatetimeLocalValue()/fromDatetimeLocalValue(), the two pure
// converters added alongside the admin delivered_at edit field (see
// orderDraftDeliveredAt in index.html's bindEvents()). They're the only
// seam between the epoch-ms the rest of the app uses for timestamps and the
// local "YYYY-MM-DDTHH:mm" string a <input type="datetime-local"> wants.
// Both are side-effect-free so they're extracted verbatim and run in an
// isolated vm context, same pattern as billing.test.js/order-grouping.test.js.
// Run with: node --test test/ (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction } = require('./lib/extract-source');

function loadHelpers(){
  const source = readAppSource();
  const code = [
    extractFunction(source, 'toDatetimeLocalValue'),
    extractFunction(source, 'fromDatetimeLocalValue'),
  ].join('\n\n');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

function pad(n){ return String(n).padStart(2, '0'); }

test('toDatetimeLocalValue/fromDatetimeLocalValue round-trip a zero-second timestamp exactly, with zero-padded fields', () => {
  const sb = loadHelpers();
  // Deliberately picks single-digit month/day/hour/minute so a missing pad()
  // would be caught (e.g. "2026-3-5T9:5" instead of "2026-03-05T09:05").
  const d = new Date(2026, 2, 5, 9, 5, 0, 0); // local: 2026-03-05 09:05:00
  const ms = d.getTime();

  const str = sb.toDatetimeLocalValue(ms);
  assert.equal(str, `2026-03-05T09:05`);

  const iso = sb.fromDatetimeLocalValue(str);
  assert.equal(typeof iso, 'string');
  // Round-trips back to the same wall-clock instant (seconds/ms are dropped
  // by the datetime-local format, but this timestamp has none to lose).
  assert.equal(new Date(iso).getTime(), ms);
});

test('toDatetimeLocalValue: null/undefined map to empty string, but epoch 0 (a valid timestamp) does not', () => {
  const sb = loadHelpers();
  assert.equal(sb.toDatetimeLocalValue(null), '');
  assert.equal(sb.toDatetimeLocalValue(undefined), '');
  // ms==null is a loose-equality check matching only null/undefined - 0 is a
  // real, valid epoch timestamp (1970-01-01) and must format normally, not
  // be swallowed into the "no value" empty string the admin sheet uses to
  // mean "leave delivered_at blank".
  const epochZeroLocal = new Date(0);
  const expected = `${epochZeroLocal.getFullYear()}-${pad(epochZeroLocal.getMonth()+1)}-${pad(epochZeroLocal.getDate())}T${pad(epochZeroLocal.getHours())}:${pad(epochZeroLocal.getMinutes())}`;
  const result = sb.toDatetimeLocalValue(0);
  assert.notEqual(result, '');
  assert.equal(result, expected);
});

test('fromDatetimeLocalValue: empty/null/undefined and unparseable strings all map to null, not a crash or "Invalid Date" string', () => {
  const sb = loadHelpers();
  assert.equal(sb.fromDatetimeLocalValue(''), null);
  assert.equal(sb.fromDatetimeLocalValue(null), null);
  assert.equal(sb.fromDatetimeLocalValue(undefined), null);
  // Not a real date string at all - new Date(v) is Invalid Date, guarded by
  // the isNaN(d.getTime()) check rather than being passed through as the
  // literal string "Invalid Date" (which would then fail the delivered_at
  // column's timestamp type on save).
  assert.equal(sb.fromDatetimeLocalValue('not-a-date'), null);
});
