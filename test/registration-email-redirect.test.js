'use strict';
// Value: protects=the self-registration signUp() call always passing
// emailRedirectTo; fails_when=that call regresses to relying on the
// Supabase dashboard's Site URL fallback, which 404s against GitHub Pages'
// project-subpath hosting (https://<user>.github.io/laundry/ rather than
// domain root) instead of opening the app; why_new=2026-10-15 bug report —
// a test registration's confirmation email linked to a GitHub "There isn't
// a GitHub Pages site here" error page; seam=bindEvents() is one large
// DOM-wiring function with no isolated signUp() helper to extract, so this
// asserts against the real extracted source text (same extraction helper
// as every other test here) rather than executing it, mirroring how the
// three sibling resetPasswordForEmail() call sites already set this option.
// Run with: node --test test/ (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const { readAppSource, extractFunction } = require('./lib/extract-source');

function loadBindEventsSource(){
  return extractFunction(readAppSource(), 'bindEvents');
}

test('self-registration signUp() passes emailRedirectTo (not left to the dashboard Site URL fallback)', () => {
  const src = loadBindEventsSource();
  const btnRegistroIdx = src.indexOf("document.getElementById('btn-registro')");
  assert.ok(btnRegistroIdx !== -1, 'expected to find the btn-registro handler in bindEvents()');

  const signUpIdx = src.indexOf('sb.auth.signUp(', btnRegistroIdx);
  assert.ok(signUpIdx !== -1, 'expected a sb.auth.signUp(...) call inside the btn-registro handler');

  // Grab the signUp(...) call's argument object up to the next statement
  // terminator so the assertion is scoped to this call, not the whole handler.
  const callSlice = src.slice(signUpIdx, src.indexOf(';', signUpIdx));
  assert.match(
    callSlice,
    /emailRedirectTo\s*:\s*window\.location\.origin\s*\+\s*window\.location\.pathname/,
    `expected signUp() to pass emailRedirectTo: window.location.origin + window.location.pathname, got: ${callSlice}`
  );
});

test('all three resetPasswordForEmail() call sites still pass the same redirectTo (sibling pattern unchanged)', () => {
  const src = readAppSource();
  // Requires a non-empty first argument (the email) so this only matches real
  // call sites, not the bare `resetPasswordForEmail()` mention inside the
  // explanatory comment above bindEvents() (line ~408).
  const matches = src.match(/resetPasswordForEmail\(\s*[\w.]+\s*,[^)]*\)/g) || [];
  assert.equal(matches.length, 3, `expected 3 resetPasswordForEmail call sites, found ${matches.length}`);
  for (const call of matches) {
    assert.match(
      call,
      /redirectTo:\s*window\.location\.origin\s*\+\s*window\.location\.pathname/,
      `expected redirectTo: window.location.origin + window.location.pathname, got: ${call}`
    );
  }
});
