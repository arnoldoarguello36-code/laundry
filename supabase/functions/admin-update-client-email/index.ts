// Fixes the client-email bug: the front-end "Customize" form's ce-save
// handler (index.html) only ever wrote profiles.email — a denormalized
// display column. Clients registered through admin-create-client's
// no-email path have a real Auth account keyed to a non-deliverable
// placeholder (client+<uuid>@no-email.norduljos.is); once staff type a real
// address into Customize and hit Save, the plain `sb.from('profiles')
// .update({ email, ... })` call left auth.users.email untouched. The
// client could never log in or receive a password-reset link at the new
// address — resetPasswordForEmail() silently "succeeds" either way (GoTrue
// never reveals whether an email matches an account, to prevent
// enumeration), so the failure was invisible from the UI.
//
// This function is the privileged counterpart admin-create-client already
// established a pattern for: sync auth.users.email first via the Admin
// API, and only once that succeeds does the front end proceed to its
// existing profiles-table update. It does NOT touch profiles itself —
// ce-save's existing `sb.from('profiles').update(...)` call (name, phone,
// address, kennitala, notifications_enabled, is_contract) still owns that
// write, immediately after this call succeeds, so this function's only job
// is the one thing the client-role caller cannot do under RLS: changing
// another user's row in auth.users.
//
// Privileged (uses SUPABASE_SERVICE_ROLE_KEY — auto-injected, never set
// manually): must NOT be reachable by an unauthenticated or client-role
// caller. Authorization is re-checked here server-side (role read via the
// service-role client, bypassing RLS) rather than trusted from the caller,
// matching admin-create-client's pattern exactly.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// (first two auto-injected; SUPABASE_ANON_KEY is the same value already set
// for admin-create-client — needed to build a caller-scoped client for the
// auth.getUser() identity check below).
//
// Deploy: supabase functions deploy admin-update-client-email

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Payload = {
  client_id: string;
  email: string;
};

// Front end calls this function directly from the browser (sb.functions.invoke),
// so it needs CORS headers on every response, including the preflight OPTIONS
// request the browser sends before the real POST.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "missing Authorization header" }, 401);
  }

  // Caller-scoped client (anon key + the caller's own JWT) — used only to
  // resolve *who* is calling. Role authorization itself is decided below via
  // the service-role client, not via RLS on this client, so a compromised or
  // missing RLS policy on profiles can't accidentally widen access here.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerData?.user) {
    return jsonResponse({ error: "invalid session" }, 401);
  }

  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", callerData.user.id)
    .single<{ role: string }>();
  if (profileErr || !callerProfile) {
    return jsonResponse({ error: "caller profile not found" }, 403);
  }
  if (callerProfile.role !== "staff" && callerProfile.role !== "admin") {
    return jsonResponse({ error: "not authorized" }, 403);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const clientId = (payload.client_id ?? "").trim();
  const email = (payload.email ?? "").trim().toLowerCase();

  if (!clientId || !email) {
    return jsonResponse({ error: "client_id and email are required" }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ error: "invalid email" }, 400);
  }

  // Confirm the target row is actually a client, not e.g. another staff/admin
  // account — this endpoint exists to fix client records, not to let a staff
  // caller repoint an arbitrary account's login email.
  const { data: targetProfile, error: targetErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", clientId)
    .single<{ role: string }>();
  if (targetErr || !targetProfile) {
    return jsonResponse({ error: "client not found" }, 404);
  }
  if (targetProfile.role !== "client") {
    return jsonResponse({ error: "target is not a client account" }, 403);
  }

  // email_confirm:true keeps this consistent with admin-create-client: the
  // address is marked pre-confirmed so GoTrue doesn't send its own
  // confirmation email — staff can still send a password-reset link
  // afterward via the existing ce-reset-pass button, which will now
  // actually resolve against this address.
  const { error: updateErr } = await admin.auth.admin.updateUserById(clientId, {
    email,
    email_confirm: true,
  });
  if (updateErr) {
    const msg = updateErr.message ?? "email update failed";
    const status = /already|exists|registered/i.test(msg) ? 409 : 500;
    return jsonResponse({ error: msg }, status);
  }

  return jsonResponse({ id: clientId, email }, 200);
});
