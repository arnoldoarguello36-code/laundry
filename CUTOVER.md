# Cutover checklist

T9: a staging environment plus a written cutover plan and rollback note, so
going live is a checklist execution instead of an improvisation. This is a
live revenue business (Norðurljós Laundry) — an untested cutover risks lost
orders and lost trust on day one.

## 0. Staging environment (one-time setup, do this first)

Stand up a **second, free-tier Supabase project** as staging, separate from
production:

1. Create the staging project in the Supabase dashboard.
2. Run every migration in `supabase/migrations/` against it, in order
   (`supabase db push` from a machine with the Supabase CLI, or paste each
   file into the SQL editor in order if the CLI isn't available).
3. Deploy `supabase/functions/send-order-email` to the staging project and
   set its secrets (`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`) to a
   **sandboxed/test** Resend sender, not the production sending domain —
   staging emails should never reach real customers.
4. Point a local or preview copy of `index.html`'s `supabase-config.js` at
   the staging project's URL/anon key (keep this out of the production
   deploy — it's for testing only).
5. Create one seed row per role directly in the staging project (an admin,
   a staff account, a couple of client accounts, a few products) — either
   by hand through the app's own signup/admin flows, or via SQL insert.

**This has not been done yet in this environment** (no Supabase CLI/API
access here) — it's the first thing to actually execute before anything
below.

## 1. Pre-cutover: full E2E smoke test against staging

Run the whole order lifecycle against staging before touching production:

- [ ] Client signup (with a preferred-language choice) → confirm the
      welcome/confirmation flow works, profile row appears with the right
      `preferred_lang`.
- [ ] Client places an order → order + order_items rows appear correctly,
      `order_created` email arrives (to the sandboxed Resend sender) in the
      right language.
- [ ] Staff logs a manual/walk-in order (`log_manual_order`) → same checks.
- [ ] Staff advances an order through every status
      (en-cola → aceptado → en-proceso → listo → entregado) → each
      transition fires exactly one `status_changed` email, `delivered_at`
      gets set on the final transition.
- [ ] Staff flags a problem, then resolves it → both fire correctly, order
      card reflects the problem state in between.
- [ ] Admin assigns a price to a pending "other" item → `price_assigned`
      email fires once per order (not once per item) when the last pending
      item on that order is priced.
- [ ] Admin edits a client profile and resets a client's password → the
      client receives a working reset-password email, can set a new
      password, can log back in.
- [ ] Force a Resend failure (temporarily set an invalid API key) →
      the triggering write still succeeds, `email_log` shows the row with
      `status='failed'`, and it shows up in the T8 admin "Failed emails"
      panel.
- [ ] Staff/admin Today and Orders views reflect changes made from a second
      browser/session within 20s without a manual refresh (polling check).
- [ ] Role-boundary check: a client account cannot reach the staff/admin
      panel; a staff account cannot reach admin-only actions (pricing,
      product CRUD, client edit) — both via the UI and by confirming the
      RLS/RPC role checks actually reject it server-side, not just that the
      button is hidden client-side.

Do not proceed past this point until every box above is checked clean on
staging.

## 2. Final data check (production project, immediately before cutover)

- [ ] Confirm the production Supabase project's migrations are fully
      applied and match what was tested on staging (same migration files,
      same order).
- [ ] Confirm `settings` singleton row exists with real pricing (not
      staging/test values).
- [ ] Confirm `products` table has the real product catalog, correct
      active/sort_order, no leftover staging test products.
- [ ] Confirm `RESEND_API_KEY`/`RESEND_FROM_ADDRESS` secrets on the
      **production** project point to the real, domain-verified sending
      address — not the staging sandbox values.
- [ ] Run the T10 backup workflow once manually against production
      (`workflow_dispatch`) and confirm a dump lands in the backup bucket,
      *before* real customer data starts accumulating.

## 3. DNS / domain switch

- [ ] Confirm `supabase-config.js` in the production deploy points at the
      production project's URL/anon key (not staging).
- [ ] Point the production domain (whatever `norduljos.is` or subdomain
      serves `index.html`) at the deploy target.
- [ ] Confirm TLS/HTTPS is live on the domain before announcing anything.
- [ ] Confirm the domain used in `RESEND_FROM_ADDRESS` matches the
      domain verified in Resend (mismatched domains silently fail sends).

## 4. First-real-order smoke test (on production, with real staff)

- [ ] Have an actual staff member log a real (or clearly-marked test)
      order through the production system, end to end, before opening it
      up to real customers — same checklist as step 1's E2E test, but on
      production with the real Resend sending domain.
- [ ] Confirm the real email arrives, in the right language, without
      landing in spam (check SPF/DKIM/DMARC on the sending domain if it
      does).
- [ ] Only after this passes clean: announce/open the system to real
      customer signups.

## Rollback note

If cutover fails partway through (bad migration, broken Edge Function,
DNS misconfiguration, etc.), the fallback is **temporary reversion to
phone/paper order-taking** — this is a laundry shop, not a system with no
manual fallback:

1. Take the production domain/link down or replace it with a simple "we're
   back to phone orders for now, call us at ___" holding page — do **not**
   leave a half-broken order form live where a customer's order might
   silently fail to save or email.
2. Staff reverts to writing down walk-in/phone orders on paper (or
   whatever the pre-launch process was) until the issue is fixed.
3. Fix forward on staging, re-run the full step-1 E2E smoke test there,
   then re-attempt cutover from step 2.
4. Any orders taken on paper during the rollback window get manually
   entered into the system (via the staff "log manual order" flow) once
   it's back up, so order history stays complete.

Keep this rollback note current — if the manual/paper process changes,
update this section too, it's the actual safety net for a live business.
