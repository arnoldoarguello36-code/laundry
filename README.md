# Norðurljós Laundry

Production order-management app for a real, operating laundry shop — client ordering/tracking, staff order pipeline, admin products/pricing/reports. Bilingual (EN/IS).

Ported from a working HTML/JS prototype (`localStorage` as fake DB, simulated email) onto real infrastructure: Supabase (Postgres + Auth + RLS + Edge Functions) and Resend for transactional email.

## Status

Design and engineering plan approved — see `docs/`. Implementation in progress (T1-T10, see engineering plan).

## Stack

- Static HTML/CSS/JS (`index.html`) — existing prototype UI/business logic, ported to call the Supabase client instead of `localStorage`.
- Supabase — Postgres, Auth, Row Level Security, Edge Functions.
- Resend — transactional bilingual email (order confirmation, status-change, price-assigned).
- Hosting — static host (Vercel/Cloudflare Pages/Netlify), TBD via `/setup-deploy`.

## Setup (not yet automated)

1. Create a Supabase project (production) and a second one (staging) — see engineering plan T9.
2. Run migrations in `supabase/migrations/` against both.
3. Create a Resend account, verify a sending domain, set the API key as an Edge Function secret.
4. Set `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `index.html` (or a config step before deploy).
5. Seed the first admin account directly via SQL/dashboard (not the app's signup form).

## Docs

- [`docs/design.md`](docs/design.md) — approved design doc (problem, approach, success criteria).
- [`docs/engineering-plan.md`](docs/engineering-plan.md) — locked schema, RLS, RPCs, triggers, implementation tasks (T1-T10), GSTACK REVIEW REPORT.
- [`docs/test-plan.md`](docs/test-plan.md) — test plan artifact (affected routes, key interactions, edge cases, critical paths).
- [`docs/implementation-tasks.jsonl`](docs/implementation-tasks.jsonl) — machine-readable task list for `/autoplan`.
