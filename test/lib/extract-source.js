'use strict';
// Shared helper for test/*.test.js. Pulls specific top-level declarations
// straight out of the real index.html source (no build step, no bundler)
// so tests exercise the exact shipped implementation instead of a
// reimplementation that could drift from it. Intentionally naive
// (brace-counting, no string/comment awareness) - safe for the specific
// declarations these tests extract, none of which contain braces inside
// string literals.
//
// NOTE: this file's basename ("extract-source.js") deliberately does not
// match node's default test-file patterns (*.test.js, test-*.js, test.js),
// so `node --test` does not try to run it as a test file on its own.

const fs = require('fs');
const path = require('path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');

function readAppSource(){
  return fs.readFileSync(INDEX_HTML, 'utf8');
}

function balancedSlice(source, braceStart){
  let depth = 0, i = braceStart;
  for(; i < source.length; i++){
    if(source[i] === '{') depth++;
    else if(source[i] === '}'){ depth--; if(depth === 0){ i++; break; } }
  }
  return i;
}

// Extracts a single top-level `function name(...) { ... }` declaration.
function extractFunction(source, name){
  const startRe = new RegExp(`function\\s+${name}\\s*\\(`);
  const startMatch = startRe.exec(source);
  if(!startMatch) throw new Error(`extractFunction: "${name}" not found in index.html`);
  const braceStart = source.indexOf('{', startMatch.index);
  const end = balancedSlice(source, braceStart);
  return source.slice(startMatch.index, end);
}

// Extracts a single top-level `const NAME = { ... };` object declaration.
function extractConst(source, name){
  const startRe = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const startMatch = startRe.exec(source);
  if(!startMatch) throw new Error(`extractConst: "${name}" not found in index.html`);
  const braceStart = source.indexOf('{', startMatch.index);
  const end = balancedSlice(source, braceStart);
  return source.slice(startMatch.index, end) + ';';
}

// Extracts a single top-level, one-line `const NAME = <expr>;` declaration,
// e.g. `const DESKTOP_BREAKPOINT = 900;`.
function extractSimpleConst(source, name){
  const re = new RegExp(`const\\s+${name}\\s*=.*?;`);
  const m = re.exec(source);
  if(!m) throw new Error(`extractSimpleConst: "${name}" not found in index.html`);
  return m[0];
}

module.exports = { readAppSource, extractFunction, extractConst, extractSimpleConst };
