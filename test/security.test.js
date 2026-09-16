'use strict';
// Guards the esc() HTML-escaping helper added to close the stored-XSS gap
// tracked in TODOS.md ("HTML-escape user-controlled order/client text before
// innerHTML render"). esc() is extracted verbatim from index.html (same
// pattern as layout.test.js/billing.test.js) so this test exercises the
// exact shipped implementation, not a reimplementation that could drift.
// Run with: node --test test/  (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction } = require('./lib/extract-source');

function loadEsc(){
  const source = readAppSource();
  const code = extractFunction(source, 'esc');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.esc = esc;', sandbox);
  return sandbox.esc;
}

test('esc() neutralizes the five HTML/attribute metacharacters', () => {
  const esc = loadEsc();
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
});

test('esc() breaks a script-tag injection payload (text-node context)', () => {
  const esc = loadEsc();
  const payload = '</div><script>alert(1)</script>';
  const out = esc(payload);
  assert.ok(!out.includes('<script>'), `expected no raw <script> tag, got: ${out}`);
  assert.equal(out, '&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('esc() breaks an attribute-breakout payload (value="..." context)', () => {
  const esc = loadEsc();
  // Mirrors the exact reported gap: clientEditFormHtml()'s ce-address input
  // renders value="${u.address}" - a stored address containing a `"` used to
  // be able to close the attribute and inject a new one.
  const payload = '" onmouseover="alert(1)';
  const out = esc(payload);
  assert.ok(!out.includes('"'), `expected all double-quotes escaped, got: ${out}`);
  assert.equal(out, '&quot; onmouseover=&quot;alert(1)');
});

test('esc() is null/undefined-safe (mirrors the ||\'\' fallback pattern used at call sites)', () => {
  const esc = loadEsc();
  assert.equal(esc(undefined), '');
  assert.equal(esc(null), '');
  assert.equal(esc(''), '');
});

test('esc() passes through ordinary text untouched', () => {
  const esc = loadEsc();
  assert.equal(esc('Jón Jónsson'), 'Jón Jónsson');
  assert.equal(esc('Bring 3 duvet covers'), 'Bring 3 duvet covers');
});
