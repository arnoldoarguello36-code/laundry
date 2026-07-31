'use strict';
// E7: first automated tests in the repo, scoped to the new pure functions
// introduced by E1 (isDesktop() breakpoint helper) and T7+E5 (see
// billing.test.js). Run with: node --test test/
//
// isDesktop() and its two supporting consts are extracted verbatim from
// index.html and evaluated in an isolated vm context with a stubbed
// `window.matchMedia` - no real DOM. This also guards against the JS
// breakpoint constant drifting from the CSS media query it's meant to
// mirror (see the DESKTOP_BREAKPOINT comment in index.html): if someone
// changes one without the other, this test's hardcoded 900 expectation
// should be the thing that has to change too, forcing a look at both.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction, extractSimpleConst } = require('./lib/extract-source');

// vm.runInContext quirk: top-level `const`/`let` declarations do NOT become
// properties of the context object (only `var`/`function` do), even though
// code in the same script can still close over them lexically - which is
// exactly why isDesktop() itself works untouched below. These two particular
// consts need to be readable/settable from the test itself (to assert
// DESKTOP_BREAKPOINT and to simulate a breakpoint crossing on desktopMql),
// so re-bind them as `var` here. This only affects how the test harness
// introspects the extracted source - the extracted declarations and
// isDesktop() itself are untouched, verbatim production code.
function asVar(constDecl){ return constDecl.replace(/^const\s+/, 'var '); }

function loadLayout(initialMatches){
  const source = readAppSource();
  const code = [
    asVar(extractSimpleConst(source, 'DESKTOP_BREAKPOINT')),
    asVar(extractSimpleConst(source, 'desktopMql')),
    extractFunction(source, 'isDesktop'),
  ].join('\n\n');
  const matchMediaCalls = [];
  const sandbox = {
    window: {
      matchMedia(query){
        matchMediaCalls.push(query);
        // A minimal stand-in for a real MediaQueryList: isDesktop() just
        // reads .matches live off this object, same as the real DOM API.
        return { matches: initialMatches, addEventListener(){}, removeEventListener(){} };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.__matchMediaCalls = matchMediaCalls;
  return sandbox;
}

test('isDesktop() reflects window.matchMedia(...).matches, queried at the 900px breakpoint', () => {
  const sb = loadLayout(false);
  assert.equal(sb.DESKTOP_BREAKPOINT, 900);
  assert.equal(sb.__matchMediaCalls.length, 1);
  assert.equal(sb.__matchMediaCalls[0], '(min-width:900px)');
  assert.equal(sb.isDesktop(), false);
});

test('isDesktop() returns true once the underlying media-query list matches', () => {
  const sb = loadLayout(true);
  assert.equal(sb.isDesktop(), true);
});

test('isDesktop() tracks the live .matches property, not a value snapshotted at construction', () => {
  const sb = loadLayout(true);
  assert.equal(sb.isDesktop(), true);
  // Simulate the breakpoint being crossed after the initial render, the way
  // a real MediaQueryList updates itself and fires its change listener.
  sb.desktopMql.matches = false;
  assert.equal(sb.isDesktop(), false);
});
