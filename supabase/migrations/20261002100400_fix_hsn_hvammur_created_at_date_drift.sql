-- One-time data fix (2026-10-02 request), follow-up to 20261002100300:
-- fixing delivered_at wasn't enough - computeVolumeReport() and
-- computeBillingSummary() (index.html) both filter/group by o.creado, which
-- is created_at (see index.html's db.orders loader: "creado: new
-- Date(o.created_at).getTime()"), not fecha or delivered_at. Every backdated
-- HSN/Hvammur order - both the 2026-09-01..21 historical backfill
-- (20261002100100/20261002100200) and the separately-entered backlog
-- catch-up orders fixed by 20261002100300 - was inserted today, so
-- created_at defaulted to now() regardless of its historical fecha. Result:
-- none of these show up in a September volume/billing report, and all of
-- them show up under today's date instead.
--
-- created_at::date > fecha is NOT a safe signal on its own (ship-time
-- adversarial review, 2026-10-02 follow-up): the client self-service date
-- picker does floor new orders at today, but the staff "Log order" and admin
-- "Edit order" flows both intentionally allow ANY past fecha (that's the
-- entire point of the companion 20261002100600 auto-deliver migration - staff
-- logging an order after the fact). A real, non-backfill HSN/Hvammur order
-- entered a day late would satisfy created_at::date > fecha too, and this
-- migration is a plain script sitting in supabase/migrations with no
-- automated apply step - a human could re-run it later "just in case" and
-- silently overwrite that real order's created_at.
--
-- Bounded to the actual one-time import window (2026-09-01..21, the
-- pre-launch paper-tracking period covered by 20261002100100/100200/100300/
-- 100500) so re-running this after go-live can never touch a real, live
-- backdated order for these clients, no matter how late it's logged.
--
-- Matches this project's pattern of keeping one-time data-fix scripts in
-- supabase/migrations as a historical record (see 20260920160000,
-- 20260922100100, 20261002100300). Idempotent: the created_at::date > fecha
-- filter makes this a no-op once applied.
update public.orders
set created_at = fecha::timestamptz
where client_id in (select id from public.profiles where name ilike '%HSN%' or name ilike '%Hvammur%')
  and created_at::date > fecha
  and fecha between '2026-09-01' and '2026-09-21';
