// Registers a client without triggering any Auth email — neither the
// "confirm your signup" email nor the "set your password" email that the
// normal front-end add-client flow (cfSave, index.html) sends via
// sbAnon.auth.signUp() + sbAnon.auth.resetPasswordForEmail(). Exists for two
// cases the normal flow can't cover:
//   1. Clients who genuinely have no email on file (email is optional here;
//      the normal flow hard-requires it).
//   2. Clients staff explicitly doesn't want to email at all, even if an
//      address is on file (e.g. a business account that's managed entirely
//      by phone/in-person) — notifications_enabled is forced to false so
//      the T6 send-order-email function (which already checks that flag)
//      never fires for them either.
//
// Auth email suppression works via admin.auth.admin.createUser's
// email_confirm:true flag (marks the address pre-confirmed, so GoTrue skips
// the confirmation send) combined with simply never calling
// resetPasswordForEmail. There is no user-facing "set your password" step
// for accounts created this way — that's intentional; staff manage these
// clients' orders directly. A staff/admin can still send one later via the
// existing "Reset password" button on the edit-client form (ce-reset-pass),
// once/if the client is given a real, working email address.
//
// Privileged (uses SUPABASE_SERVICE_ROLE_KEY — auto-injected, never set
// manually): must NOT be reachable by an unauthenticated or client-role
// caller. Authorization is re-checked here server-side (role read via the
// service-role client, bypassing RLS) rather than trusted from the caller,
// since the front-end's role gating (session.role checks) is
// UI-only and not a security boundary on its own.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// (first two auto-injected; SUPABASE_ANON_KEY must be set manually via
// `supabase secrets set SUPABASE_ANON_KEY=...` — needed to build a
// caller-scoped client for the auth.getUser() identity check below).
//
// Deploy: supabase functions deploy admin-create-client

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Payload = {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  is_contract?: boolean;
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

  const name = (payload.name ?? "").trim();
  const phone = (payload.phone ?? "").trim();
  const address = (payload.address ?? "").trim();
  const suppliedEmail = (payload.email ?? "").trim().toLowerCase();
  // is_contract is admin-only, same as the front-end gating in
  // clientAddFormHtml — re-checked here since a staff-role caller could
  // otherwise send is_contract:true directly to this endpoint.
  const isContract = callerProfile.role === "admin" && !!payload.is_contract;

  if (!name || !phone) {
    return jsonResponse({ error: "name and phone are required" }, 400);
  }

  // No email on file: Supabase Auth still requires a syntactically valid,
  // unique email per user, so we mint a non-deliverable placeholder on the
  // business's own domain (never sent to, and never shown to staff — wiped
  // back to null on the profiles row right after creation).
  const isPlaceholder = !suppliedEmail;
  const email = isPlaceholder
    ? `client+${crypto.randomUUID()}@no-email.norduljos.is`
    : suppliedEmail;
  const randomPass = crypto.randomUUID() + "Aa1!";

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: randomPass,
    email_confirm: true, // pre-confirmed → GoTrue does not send a confirmation email
    user_metadata: { name, phone, address: address || undefined },
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "user creation failed";
    const status = /already|exists|registered/i.test(msg) ? 409 : 500;
    return jsonResponse({ error: msg }, status);
  }

  // notifications_enabled=false always for placeholder-email clients (there's
  // nowhere to send order emails); is_contract set here too since it needs
  // the service-role client to bypass profiles_update RLS for a staff caller
  // (which the front end's own direct-update path — cfSave's is_contract
  // update — deliberately doesn't attempt for non-admin callers either).
  const { error: updateErr } = await admin
    .from("profiles")
    .update({
      notifications_enabled: !isPlaceholder,
      is_contract: isContract,
      email: isPlaceholder ? null : suppliedEmail,
    })
    .eq("id", created.user.id);
  if (updateErr) {
    console.error("post-create profile update failed:", updateErr.message);
    // The account exists and is usable; surface this as a partial-success
    // note rather than failing the whole request.
    return jsonResponse(
      { id: created.user.id, email: isPlaceholder ? null : suppliedEmail, warning: updateErr.message },
      200,
    );
  }

  return jsonResponse({ id: created.user.id, email: isPlaceholder ? null : suppliedEmail }, 200);
});
