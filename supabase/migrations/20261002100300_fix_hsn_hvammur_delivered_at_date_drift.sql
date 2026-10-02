-- One-time data fix (2026-10-02 request): HSN and Hvammur had a backlog of
-- real orders that staff caught up on all at once today by clicking each one
-- through advance_order_status() in quick succession. That RPC sets
-- delivered_at = now() on reaching 'entregado' (correct for real-time use -
-- see 20260711140400's header), so every one of those backlog orders ended
-- up with delivered_at stamped "today" regardless of its actual fecha
-- (requested delivery date), e.g. ORD-1081: fecha=2026-09-01 but
-- delivered_at=2026-10-02.
--
-- This updates delivered_at to match fecha for exactly the rows where they
-- disagree, scoped to HSN/Hvammur only so a genuinely late delivery for any
-- other client is never touched. Matches this project's pattern of keeping
-- one-time data-fix scripts in supabase/migrations as a historical record
-- (see 20260920160000, 20260922100100).
--
-- Does NOT touch notas - its {kind:'status', ...} entries still show the
-- real wall-clock time each status change happened, which is the honest
-- audit trail; only the user-facing delivered_at (used for turnaround-time
-- stats, see index.html's avgTurnaroundHrs) is corrected here.
--
-- Idempotent: the delivered_at::date <> fecha filter makes this a no-op once
-- applied, so re-running it is harmless. Does not touch the 2026-09-01
-- .. 2026-09-21 historical backfill rows from 20261002100100/20261002100200
-- - those already have delivered_at = fecha from the migration itself.
--
-- Bounded to today's catch-up (created_at::date = 2026-10-02, the day staff
-- clicked this backlog through advance_order_status() - ship-time adversarial
-- review, 2026-10-02 follow-up): without this bound, re-running the script
-- later would also "fix" any future genuinely-late HSN/Hvammur delivery by
-- silently overwriting its real delivered_at to match fecha, destroying the
-- honest turnaround-time data point. Scoping to the actual catch-up date
-- makes that impossible while still covering every row this migration was
-- written to fix.
update public.orders
set delivered_at = fecha::timestamptz
where estado = 'entregado'
  and client_id in (select id from public.profiles where name ilike '%HSN%' or name ilike '%Hvammur%')
  and delivered_at::date <> fecha
  and created_at::date = '2026-10-02';
