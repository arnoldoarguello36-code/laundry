'use strict';
// Value: protects=the "Customize" client-edit form (ce-save) syncing
// auth.users.email (via the privileged admin-update-client-email Edge
// Function) whenever staff types a different email, before it writes
// profiles.email; fails_when=ce-save regresses to only updating the
// profiles table directly, which silently "succeeds" in the UI while
// leaving the client's real Auth account (and any no-email placeholder
// account created via admin-create-client) unable to log in or receive a
// password-reset link at the new address; why_new=2026-10-22 bug report —
// admin added a real email to a no-email client via Customize, got the
// "client_updated" toast, but the client still could not reset their
// password because auth.users.email was still the non-deliverable
// client+<uuid>@no-email.norduljos.is placeholder; seam=bindEvents() is
// one large DOM-wiring function with no isolated ce-save helper to
// extract, so this asserts against the real extracted source text (same
// extraction helper as every other test here) rather than executing it,
// mirroring registration-email-redirect.test.js's approach for the
// sibling signUp()/resetPasswordForEmail() call sites.
// Run with: node --test test/ (or `bun test`)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readAppSource, extractFunction } = require('./lib/extract-source');

function loadBindEventsSource(){
  return extractFunction(readAppSource(), 'bindEvents');
}

function ceSaveHandlerSlice(src){
  const declIdx = src.indexOf("const ceSave = document.getElementById('ce-save')");
  assert.ok(declIdx !== -1, 'expected to find the ce-save element lookup in bindEvents()');
  const onclickIdx = src.indexOf('ceSave.onclick = async', declIdx);
  assert.ok(onclickIdx !== -1, 'expected ce-save to have an async onclick handler');
  // Bound the handler by the next sibling handler declaration
  // (ce-reset-pass), so later assertions can't accidentally match unrelated
  // code further down in bindEvents().
  const nextHandlerIdx = src.indexOf("const ceResetPass = document.getElementById('ce-reset-pass')", onclickIdx);
  assert.ok(nextHandlerIdx !== -1, 'expected the ce-reset-pass handler to follow ce-save in bindEvents()');
  return src.slice(onclickIdx, nextHandlerIdx);
}

test('ce-save syncs auth.users.email via admin-update-client-email before updating profiles', () => {
  const handler = ceSaveHandlerSlice(loadBindEventsSource());

  const invokeIdx = handler.indexOf("sb.functions.invoke('admin-update-client-email'");
  assert.ok(invokeIdx !== -1, 'expected ce-save to call sb.functions.invoke(\'admin-update-client-email\', ...)');

  const profilesUpdateIdx = handler.indexOf("sb.from('profiles').update(");
  assert.ok(profilesUpdateIdx !== -1, 'expected ce-save to still update the profiles table');
  assert.ok(invokeIdx < profilesUpdateIdx,
    'expected the admin-update-client-email call to run BEFORE the profiles table update, so a failed auth sync blocks the profile write');

  // The invoke call must carry the client id and the new email as a JSON body.
  const invokeCallSlice = handler.slice(invokeIdx, handler.indexOf(';', invokeIdx) + 1);
  assert.match(invokeCallSlice, /client_id\s*:\s*u\.id/, `expected client_id: u.id in the invoke body, got: ${invokeCallSlice}`);
  // `{ email }` shorthand or `email: email` both count — either way the
  // new typed value (not the stale u.email) must be what's sent.
  assert.match(invokeCallSlice, /(?:\bemail\s*:\s*email\b|\{\s*client_id\s*:\s*u\.id\s*,\s*email\s*\})/,
    `expected the new typed email to be sent in the invoke body, got: ${invokeCallSlice}`);

  // Must only fire when the typed email actually differs from what's on
  // file — comparing against u.email (not just a truthy email) is what
  // prevents a privileged call firing on every unrelated-field edit.
  const guardSlice = handler.slice(0, invokeIdx);
  assert.match(guardSlice, /if\s*\(\s*email\s*!==\s*currentEmail\s*\)/,
    `expected a guard comparing the typed email against the client's current email before invoking, got tail: ${guardSlice.slice(-200)}`);

  // A failed sync (network/invoke error, or a structured {error} response
  // from the function) must stop ce-save before it reaches the profiles
  // update — otherwise the UI would show "client_updated" while the auth
  // account's email was never actually changed.
  assert.match(handler.slice(invokeIdx, profilesUpdateIdx), /emailError/,
    'expected the invoke() error to be checked before falling through to the profiles update');
  assert.match(handler.slice(invokeIdx, profilesUpdateIdx), /emailData\s*&&\s*emailData\.error/,
    'expected a structured {error} response from admin-update-client-email to also be checked');
});

test('admin-update-client-email Edge Function exists and syncs auth.users.email via the Admin API', () => {
  const fnPath = path.join(__dirname, '..', 'supabase', 'functions', 'admin-update-client-email', 'index.ts');
  assert.ok(fs.existsSync(fnPath), `expected ${fnPath} to exist`);
  const src = fs.readFileSync(fnPath, 'utf8');

  assert.match(src, /admin\.auth\.admin\.updateUserById\(/,
    'expected the function to call admin.auth.admin.updateUserById(...) to sync the real Auth account email');

  // Must re-verify the caller's role server-side (service-role read), same
  // security pattern as admin-create-client — never trust a client-supplied
  // role or the front end's UI-only gating.
  assert.match(src, /callerProfile\.role\s*!==\s*["']staff["']\s*&&\s*callerProfile\.role\s*!==\s*["']admin["']/,
    'expected a server-side staff/admin role check before allowing the email sync');

  // Must only ever target a client account, never another staff/admin row.
  assert.match(src, /targetProfile\.role\s*!==\s*["']client["']/,
    'expected a check that the target row is a client account before changing its email');
});
