'use strict';
// Regression tripwire for the "desktop .sheet centering was silently dead
// code" bug (fixed 2026-09-20 on fix/order-sheet-desktop-modal). The bug:
// the desktop-centering override lived in a bare `.sheet{...}` rule inside
// `@media(min-width:900px)`, but the mobile-default `.sheet{...}` rule
// further down the stylesheet has identical specificity (one class
// selector) and was declared AFTER it, so on a tie the later rule always
// won the cascade - the desktop override never actually applied.
//
// The fix rescopes the desktop rule to `body.is-desktop .sheet{...}`,
// which outranks the mobile rule on specificity regardless of source
// order. This is a pure-CSS cascade/specificity bug with no JS branch to
// unit test, so unlike layout.test.js/billing.test.js/security.test.js
// this does NOT extract and execute a JS function - it's a plain text/
// regex assertion against index.html's raw <style> block, following the
// "pull straight from index.html, no reimplementation" convention used by
// the other test/*.test.js files (see test/lib/extract-source.js).
//
// This will NOT catch every possible regression (e.g. someone could still
// reorder rules in a way that breaks the intended cascade without
// reintroducing a second bare `.sheet{`), but it does cheaply guard the
// specific failure mode that shipped: a second bare, equal-specificity
// `.sheet{` rule silently reappearing and winning the tie again. If this
// test ever needs updating because a legitimate new bare `.sheet{` rule is
// added, that's exactly the moment to re-verify the cascade by hand (or
// via the /browse skill, as was done for this fix) rather than just
// bumping the expected count.
//
// Run with: node --test test/  (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const { readAppSource } = require('./lib/extract-source');

test('desktop .sheet override is scoped under body.is-desktop (fix pattern present)', () => {
  const source = readAppSource();
  assert.match(
    source,
    /body\.is-desktop \.sheet\{/,
    'expected the desktop-centering .sheet rule to be scoped as `body.is-desktop .sheet{...}` ' +
    '(bare `.sheet{...}` loses the cascade tie to the later mobile-default rule)'
  );
});

test('there is exactly one bare (unscoped) `.sheet{` rule in the stylesheet', () => {
  const source = readAppSource();
  // Strip /* ... */ comments first - the fix's own explanatory comment
  // quotes both `.sheet{...}` and `body.is-desktop .sheet{...}` as literal
  // text, which would otherwise be double-counted as real declarations.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const allSheetRules = withoutComments.match(/\.sheet\{/g) || [];
  const scopedSheetRules = withoutComments.match(/is-desktop \.sheet\{/g) || [];
  const bareCount = allSheetRules.length - scopedSheetRules.length;
  // Exactly one is expected: the mobile-default `.sheet{...}` rule. A
  // second bare `.sheet{}` added later in the file (equal specificity)
  // would silently win any property it redeclares, regressing this bug -
  // that's the scenario this assertion exists to catch.
  assert.equal(
    bareCount, 1,
    `expected exactly 1 bare ".sheet{" rule, found ${bareCount}. A new bare ` +
    '`.sheet{}` rule has the same specificity as the existing mobile-default ' +
    'rule and can silently win a cascade tie, reintroducing the dead-desktop-' +
    'override bug this test guards against.'
  );
});
