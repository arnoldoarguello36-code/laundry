-- One-time historical backfill (2026-10-02 request): imports HSN's
-- paper-tracked laundry log for 01/09/2026-21/09/2026 (the window before the
-- app went live) as already-delivered orders, one order per day. Sibling
-- migration to 20261002100100 (same import, same source batch, Hvammur's
-- client). Matches this project's pattern of keeping one-time data-fix
-- scripts in supabase/migrations as a historical record (see 20260920160000,
-- 20260922100100).
--
-- Source: "HSN — Lavandería septiembre 2026" transcribed paper sheet
-- (2026-10-02). Dates not listed below (05,06,12,13,19,20) are Saturdays/
-- Sundays - the service doesn't operate those days.
--
-- PRODUCT IDS: Pillow/Duvet were created by hand via the admin "Edit
-- product" UI (not via a migration - the id='hsn_pillows'-style seed
-- migration originally drafted for this was deleted once that happened, to
-- avoid inserting a duplicate second Pillow/Duvet row under a different id).
-- The UI auto-assigns ids, so unlike hsn_general_laundry/hsn_yellow_tagged
-- (fixed ids from 20260920160000), HSN's Pillow is 'p_1790856106452' and
-- Duvets is 'p_1790856134125' - confirmed via:
--   select id, name_en, owner_client_id from public.products
--   where owner_client_id = (select id from public.profiles where name ilike '%HSN%');
--
-- SCOPE, per the 2026-10-02 clarification:
--   * One order per calendar day, source='staff', estado='entregado'
--     straight away (bypasses the advance_order_status pipeline on purpose,
--     same as 20260922100100's precedent for bulk-marking historical orders
--     delivered).
--   * Product columns imported: General laundry (kg) -> hsn_general_laundry,
--     Gull/Yellow-tagged (kg) -> hsn_yellow_tagged, Koddi (pillows, pc)
--     -> p_1790856106452 (Pillow), Sæng (duvets, pc) -> p_1790856134125
--     (Duvets). A day with no value for a column gets no order_item row for
--     that product.
--   * General (kg) uses the sheet's own already-summed daily total, not the
--     individual scale weighings behind it ("use one reading per kind").
--   * Skítur (soiled laundry) is explicitly OUT OF SCOPE for this import
--     ("leave out the Skitur for now") - the sheet has Skítur(kg) values on
--     09/09 (3,3, also a verificar row - see below) and 16/09 (2,0), neither
--     imported as any product.
--   * 09/09/2026 and 18/09/2026 are EXCLUDED entirely - HSN's sheet flags
--     these two rows yellow/"verificar" (unverified), same instruction
--     ("Ignore yellow") that applies to this sheet.
--   * 21/09/2026 (the last business day before go-live, a Monday) was
--     cropped out of the source screenshot and is NOT YET filled in below -
--     see the placeholder note at the bottom of the v_days table.
--
-- HOME SERVICE: 20260922100000 forced force_home_service=true for both HSN
-- and Hvammur (pickup=true, return_method='delivery', pickup_address from
-- the client's profile) retroactively on every existing order. These
-- backfilled orders follow the same invariant so they're consistent with
-- every other HSN order on file and won't trip the admin "Edit order" flow's
-- required-pickup-address check if one is ever reopened.
--
-- EMAIL SUPPRESSION: a plain INSERT into orders fires
-- notify_order_created_trigger (T4). Both notify triggers are disabled for
-- the duration of this transaction and re-enabled immediately after, so the
-- real HSN contact doesn't get ~12 "your order was placed" emails for
-- months-old laundry.
--
-- order id: left for assign_order_id_trigger (ORD-####) - not hand-assigned.
--
-- notas: tagged with a {kind:'note', ...} entry marking these as a
-- historical import, so they're visually distinguishable from real-time
-- orders in the admin order-detail activity feed.

do $$
declare
  hsn_id uuid;
  hsn_address text;
  v_match_count int;
  v_day record;
  v_order_id text;
begin
  -- Guard against profiles.name ILIKE matching zero OR more than one row
  -- (profiles.name has no unique constraint) - a silent multi-match would
  -- otherwise have `select ... into` keep one arbitrary row and backfill
  -- these historical orders onto the wrong client.
  select count(*) into v_match_count from public.profiles where name ilike '%HSN%';
  if v_match_count = 0 then
    raise exception 'HSN client profile not found via profiles.name ILIKE %%HSN%% — update the name filter in this migration to match the real profiles.name value, then re-run.';
  elsif v_match_count > 1 then
    raise exception 'profiles.name ILIKE %%HSN%% matched % rows, expected exactly 1 — update the name filter in this migration to uniquely identify the HSN client, then re-run.', v_match_count;
  end if;

  select id, address into hsn_id, hsn_address
  from public.profiles where name ilike '%HSN%';

  alter table public.orders disable trigger notify_order_created_trigger;
  alter table public.orders disable trigger notify_status_changed_trigger;

  -- fecha | general_kg | gull_kg | koddi | saeng
  -- 09/09 and 18/09 intentionally omitted (unverified "verificar" rows).
  for v_day in
    select * from (values
      ('2026-09-01'::date, 66.6::numeric,  11.1::numeric, 1::int,    null::int),
      ('2026-09-02'::date, 48.2::numeric,  null::numeric, null::int, null::int),
      ('2026-09-03'::date, 70.1::numeric,  null::numeric, null::int, null::int),
      ('2026-09-04'::date, 64.7::numeric,  null::numeric, null::int, null::int),
      ('2026-09-07'::date, 123.0::numeric, null::numeric, 6::int,    1::int),
      ('2026-09-08'::date, 105.7::numeric, null::numeric, 4::int,    3::int),
      -- 2026-09-09 excluded: verificar row
      ('2026-09-10'::date, 64.4::numeric,  null::numeric, null::int, null::int),
      ('2026-09-11'::date, 71.1::numeric,  null::numeric, null::int, null::int),
      ('2026-09-14'::date, 151.2::numeric, null::numeric, null::int, 2::int),
      ('2026-09-15'::date, 76.0::numeric,  null::numeric, null::int, null::int),
      ('2026-09-16'::date, 66.3::numeric,  null::numeric, null::int, null::int),
      ('2026-09-17'::date, 66.0::numeric,  null::numeric, null::int, null::int)
      -- 2026-09-18 excluded: verificar row
      -- TODO: 2026-09-21 (Monday, last business day before go-live) was
      -- cropped out of the source screenshot - add its row here, e.g.:
      -- ('2026-09-21'::date, <general_kg>, <gull_kg or null>, <koddi or null>, <saeng or null>),
      -- then delete this comment block, before running this migration.
    ) as t(fecha, general_kg, gull_kg, koddi, saeng)
  loop
    -- Guard against double-applying this one-time backfill (no automated
    -- migration-apply step in this repo, so a human could re-run this file
    -- by mistake) - mirrors 20261002100500's own per-date guard.
    if exists (select 1 from public.orders where client_id = hsn_id and fecha = v_day.fecha) then
      raise notice 'HSN order for % already exists, skipping', v_day.fecha;
      continue;
    end if;

    insert into public.orders
      (client_id, client_name, fecha, estado, urgent, return_method, pickup, pickup_address, source, delivered_at, notas)
    values
      (hsn_id, 'HSN', v_day.fecha, 'entregado', false, 'delivery', true, hsn_address, 'staff',
       v_day.fecha::timestamptz,
       jsonb_build_array(jsonb_build_object('kind', 'note', 'text', 'Historical backfill from paper tracking sheet', 'at', now())))
    returning id into v_order_id;

    if v_day.general_kg is not null and v_day.general_kg > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'hsn_general_laundry', v_day.general_kg);
    end if;

    if v_day.gull_kg is not null and v_day.gull_kg > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'hsn_yellow_tagged', v_day.gull_kg);
    end if;

    if v_day.koddi is not null and v_day.koddi > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'p_1790856106452', v_day.koddi);
    end if;

    if v_day.saeng is not null and v_day.saeng > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'p_1790856134125', v_day.saeng);
    end if;
  end loop;

  alter table public.orders enable trigger notify_order_created_trigger;
  alter table public.orders enable trigger notify_status_changed_trigger;
end $$;
