'use strict';
// Covers the pure helpers added for the "group orders by day" feature in the
// staff Orders list (see renderStaffOrders() in index.html, which calls
// groupOrdersByDay(ordenes) then labels each group with dayLabel(g.sample)).
// Both functions are deliberately side-effect-free so they can be extracted
// verbatim from index.html and unit tested the same way as
// computeBillingSummary()/isDesktop() (see billing.test.js/layout.test.js).
// Run with: node --test test/  (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction, extractConst, extractSimpleConst } = require('./lib/extract-source');

// `let lang = 'en';` isn't handled by any extract-source.js helper (those
// cover `function`, `const {...}`, and one-line `const X = expr;` only).
// Unlike Node's vm (see layout.test.js, which mutates a contextified var's
// object property post-load), Bun's vm implementation does NOT live-link a
// contextified global object's properties back to a script's top-level
// `var` bindings - assigning `sandbox.lang = 'is'` after running the script
// silently does not change what a closure (like t()/dayLabel()) sees on its
// next call. So instead of extracting-then-mutating, this asserts the
// verbatim source still declares `let lang = ...;` (a guard against the
// declaration disappearing/renaming) and bakes the desired value into a
// fresh `var lang = <value>;` statement per sandbox load - dayLabel()/t()
// themselves are still extracted untouched, verbatim production code.
function assertLangLetExists(source){
  if(!/let\s+lang\s*=.*?;/.test(source)) throw new Error('assertLangLetExists: "lang" not found in index.html');
}

function loadGrouping(lang){
  lang = lang || 'en';
  const source = readAppSource();
  assertLangLetExists(source);
  const code = [
    extractConst(source, 'I18N'),
    extractSimpleConst(source, 'DAY_MS'),
    `var lang = ${JSON.stringify(lang)};`,
    extractFunction(source, 't'),
    extractFunction(source, 'dayLabel'),
    extractFunction(source, 'groupOrdersByDay'),
  ].join('\n\n');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// Builds an "N days ago at <hour>:00" timestamp anchored to a captured
// `now`, so tests don't race real wall-clock midnight boundaries mid-run.
function daysAgoAt(now, n, hour){ return new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, hour, 0, 0).getTime(); }

test('dayLabel(): today (en) returns the localized "Today" label', () => {
  const sb = loadGrouping('en');
  const now = new Date();
  assert.equal(sb.dayLabel(daysAgoAt(now, 0, 12)), 'Today');
});

test('dayLabel(): yesterday (en) returns the localized "Yesterday" label', () => {
  const sb = loadGrouping('en');
  const now = new Date();
  assert.equal(sb.dayLabel(daysAgoAt(now, 1, 12)), 'Yesterday');
});

test('dayLabel(): today (is) returns the localized "Í dag" label', () => {
  const sb = loadGrouping('is');
  const now = new Date();
  assert.equal(sb.dayLabel(daysAgoAt(now, 0, 12)), 'Í dag');
});

test('dayLabel(): yesterday (is) returns the localized "Í gær" label', () => {
  const sb = loadGrouping('is');
  const now = new Date();
  assert.equal(sb.dayLabel(daysAgoAt(now, 1, 12)), 'Í gær');
});

test('dayLabel(): further in the past (en) falls back to a weekday+date string, not Today/Yesterday', () => {
  const sb = loadGrouping('en');
  const now = new Date();
  const ts = daysAgoAt(now, 10, 12);
  const result = sb.dayLabel(ts);
  const expected = new Date(ts).toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'long' });
  assert.equal(result, expected);
  assert.notEqual(result, 'Today');
  assert.notEqual(result, 'Yesterday');
});

test('dayLabel(): further in the past (is) falls back to a weekday+date string in the is-IS locale', () => {
  const sb = loadGrouping('is');
  const now = new Date();
  const ts = daysAgoAt(now, 10, 12);
  const result = sb.dayLabel(ts);
  const expected = new Date(ts).toLocaleDateString('is-IS', { weekday:'long', day:'2-digit', month:'long' });
  assert.equal(result, expected);
  assert.notEqual(result, 'Í dag');
  assert.notEqual(result, 'Í gær');
});

test('dayLabel(): boundary is calendar-day based, not a rolling 24h window (23h ago today vs 1h ago yesterday)', () => {
  const sb = loadGrouping('en');
  const now = new Date();
  // 1am today is "Today" even if less than 24h before an 11pm-yesterday
  // timestamp would suggest otherwise - startOf() compares calendar dates.
  const earlyToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0).getTime();
  const lateYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 0, 0).getTime();
  assert.equal(sb.dayLabel(earlyToday), 'Today');
  assert.equal(sb.dayLabel(lateYesterday), 'Yesterday');
});

test('groupOrdersByDay(): empty array returns no groups', () => {
  const sb = loadGrouping();
  assert.deepEqual(sb.groupOrdersByDay([]), []);
});

test('groupOrdersByDay(): a single order forms a single group of one item', () => {
  const sb = loadGrouping();
  const now = Date.now();
  const groups = sb.groupOrdersByDay([{ id:'o1', creado: now }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].id, 'o1');
  assert.equal(groups[0].sample, now);
});

test('groupOrdersByDay(): multiple orders on the same calendar day collapse into one group', () => {
  const sb = loadGrouping();
  const now = new Date();
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8).getTime();
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
  const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20).getTime();
  const groups = sb.groupOrdersByDay([
    { id:'o1', creado: evening },
    { id:'o2', creado: noon },
    { id:'o3', creado: morning },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 3);
  // preserves input order within the bucket
  assert.deepEqual(groups[0].items.map(o=>o.id), ['o1','o2','o3']);
  // sample is the first item's timestamp seen for that group (used by dayLabel)
  assert.equal(groups[0].sample, evening);
});

test('groupOrdersByDay(): orders across multiple distinct days (desc-sorted input) form one group per day, in boundary order', () => {
  const sb = loadGrouping();
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10).getTime();
  const day1 = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1, 10).getTime();
  const day5 = new Date(now.getFullYear(), now.getMonth(), now.getDate()-5, 10).getTime();
  // Callers (renderStaffOrders) always pass db.orders sorted desc by creado.
  const groups = sb.groupOrdersByDay([
    { id:'a', creado: day0 },
    { id:'b', creado: day1 },
    { id:'c', creado: day1 },
    { id:'d', creado: day5 },
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(g=>g.items.length), [1, 2, 1]);
  assert.deepEqual(groups.map(g=>g.items.map(o=>o.id)), [['a'], ['b','c'], ['d']]);
});

test('groupOrdersByDay(): grouping is order-independent - unsorted/interleaved input still merges same-day orders into one group', () => {
  const sb = loadGrouping();
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9).getTime();
  const day1 = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1, 9).getTime();
  // Interleaved (NOT sorted by day): day0, day1, day0 again.
  // groupOrdersByDay() buckets by a Map keyed on calendar day (not by
  // comparing each order to the immediately preceding group), so the second
  // day0 order merges back into the first day0 group instead of starting a
  // new one - grouping is correct regardless of the caller's sort order.
  // Callers (renderStaffOrders) still pass creado-sorted input in practice,
  // but this is no longer a documented precondition/limitation.
  const groups = sb.groupOrdersByDay([
    { id:'a', creado: day0 },
    { id:'b', creado: day1 },
    { id:'c', creado: day0 },
  ]);
  assert.equal(groups.length, 2);
  // Group order follows first-seen order: day0 (from 'a') then day1 (from 'b').
  assert.deepEqual(groups.map(g=>g.items.map(o=>o.id)), [['a','c'], ['b']]);
});

test('i18n: group_* keys exist and are non-empty in both en and is locales', () => {
  const source = readAppSource();
  const i18nCode = extractConst(source, 'I18N').replace(/^const\s+/, 'var ');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(i18nCode, sandbox);
  for(const key of ['group_today', 'group_yesterday', 'group_orders_count']){
    assert.ok(sandbox.I18N.en[key] && sandbox.I18N.en[key].length > 0, `en.${key} should be a non-empty string`);
    assert.ok(sandbox.I18N.is[key] && sandbox.I18N.is[key].length > 0, `is.${key} should be a non-empty string`);
  }
});
