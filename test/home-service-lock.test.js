'use strict';
// Covers clientForcesHomeService(): the client-side check that locks a
// manual/edit order's return-method + pickup controls to "home delivery" +
// "home pickup" for contract clients flagged via profiles.force_home_service
// (HSN, Hvammur — 2026-09-22). Extracted verbatim from index.html and
// evaluated in an isolated vm context (see product-scoping.test.js for the
// same pattern) - no DOM, just the function plus the db it reads.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readAppSource, extractFunction } = require('./lib/extract-source');

function loadHomeServiceLock(){
  const source = readAppSource();
  const code = extractFunction(source, 'clientForcesHomeService');
  const sandbox = { db: undefined };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const USERS = [
  { id:'hsn', name:'HSN Husavik', forceHomeService:true },
  { id:'hvammur', name:'Hvammur', forceHomeService:true },
  { id:'plain-client', name:'Jane Doe', forceHomeService:false },
];

test('clientForcesHomeService: true for a client flagged force_home_service', () => {
  const sb = loadHomeServiceLock();
  sb.db = { users: USERS };
  assert.equal(sb.clientForcesHomeService('hsn'), true);
  assert.equal(sb.clientForcesHomeService('hvammur'), true);
});

test('clientForcesHomeService: false for a client not flagged', () => {
  const sb = loadHomeServiceLock();
  sb.db = { users: USERS };
  assert.equal(sb.clientForcesHomeService('plain-client'), false);
});

test('clientForcesHomeService: false for an unknown/blank client id (walk-in orders, no client picked yet)', () => {
  const sb = loadHomeServiceLock();
  sb.db = { users: USERS };
  assert.equal(sb.clientForcesHomeService(''), false);
  assert.equal(sb.clientForcesHomeService(null), false);
  assert.equal(sb.clientForcesHomeService('does-not-exist'), false);
});
