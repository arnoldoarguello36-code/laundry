-- One-time historical backfill (2026-10-02 request): imports Hvammur's
-- paper-tracked laundry log for 01/09/2026-21/09/2026 (the window before the
-- app went live) as already-delivered orders, one order per day. Matches
-- this project's pattern of keeping one-time data-fix scripts in
-- supabase/migrations as a historical record (see 20260920160000,
-- 20260922100100).
--
-- Source: "Hvammur — Lavandería septiembre 2026" transcribed paper sheet
-- (2026-10-02). Dates not listed below (05,06,12,13,19,20) are Saturdays/
-- Sundays — the service doesn't operate those days, confirmed by both the
-- Hvammur and HSN sheets independently skipping the same dates.
--
-- PRODUCT IDS: Pillow/Duvet were created by hand via the admin "Edit
-- product" UI (not via a migration - the id='hsn_pillows'-style seed
-- migration originally drafted for this was deleted once that happened, to
-- avoid inserting a duplicate second Pillow/Duvet row under a different id).
-- The UI auto-assigns ids, so unlike hvammur_general_laundry/
-- hvammur_yellow_tagged (fixed ids from 20260920160000), Hvammur's Pillow is
-- 'p_1790856319955' and Duvets is 'p_1790856349266' - confirmed via:
--   select id, name_en, owner_client_id from public.products
--   where owner_client_id = (select id from public.profiles where name ilike '%Hvammur%');
--
-- SCOPE, per the 2026-10-02 clarification:
--   * One order per calendar day, source='staff', estado='entregado'
--     straight away (bypasses the advance_order_status pipeline on purpose,
--     same as 20260922100100's precedent for bulk-marking historical orders
--     delivered).
--   * Product columns imported: General laundry (kg) -> hvammur_general_laundry,
--     Gull/Yellow-tagged (kg) -> hvammur_yellow_tagged, Koddi (pillows, pc)
--     -> p_1790856319955 (Pillow), Sæng (duvets, pc) -> p_1790856349266
--     (Duvets). A day with no value for a column gets no order_item row for
--     that product.
--   * General (kg) uses the sheet's own already-summed daily total, not the
--     individual scale weighings behind it ("use one reading per kind").
--   * Skítur (soiled laundry) is explicitly OUT OF SCOPE for this import
--     ("leave out the Skitur for now") - the sheet has a Skítur(kg) value on
--     16/09 (1,5) but it is intentionally NOT imported as any product.
--   * Unlike HSN's sheet, none of Hvammur's rows in this range are flagged
--     yellow/"verificar" - every date below (including 09/09 and 18/09,
--     which ARE excluded on the HSN sheet) is a normal, usable row here.
--   * 21/09/2026 (the last business day before go-live, a Monday) was
--     cropped out of the source screenshot and is NOT YET filled in below -
--     see the placeholder note at the bottom of the v_days table.
--
-- HOME SERVICE: 20260922100000 forced force_home_service=true for both HSN
-- and Hvammur (pickup=true, return_method='delivery', pickup_address from
-- the client's profile) retroactively on every existing order. These
-- backfilled orders follow the same invariant so they're consistent with
-- every other Hvammur order on file and won't trip the admin "Edit order"
-- flow's required-pickup-address check if one is ever reopened.
--
-- EMAIL SUPPRESSION: a plain INSERT into orders fires
-- notify_order_created_trigger (T4). Both notify triggers are disabled for
-- the duration of this transaction and re-enabled immediately after, so the
-- real Hvammur contact doesn't get ~14 "your order was placed" emails for
-- months-old laundry.
--
-- order id: left for assign_order_id_trigger (ORD-####) - not hand-assigned.
--
-- notas: tagged with a {kind:'note', ...} entry marking these as a
-- historical import, so they're visually distinguishable from real-time
-- orders in the admin order-detail activity feed.

do $$
declare
  hvammur_id uuid;
  hvammur_address text;
  v_match_count int;
  v_day record;
  v_order_id text;
begin
  -- Guard against profiles.name ILIKE matching zero OR more than one row
  -- (profiles.name has no unique constraint) - a silent multi-match would
  -- otherwise have `select ... into` keep one arbitrary row and backfill
  -- these historical orders onto the wrong client.
  select count(*) into v_match_count from public.profiles where name ilike '%Hvammur%';
  if v_match_count = 0 then
    raise exception 'Hvammur client profile not found via profiles.name ILIKE %%Hvammur%% — update the name filter in this migration to match the real profiles.name value, then re-run.';
  elsif v_match_count > 1 then
    raise exception 'profiles.name ILIKE %%Hvammur%% matched % rows, expected exactly 1 — update the name filter in this migration to uniquely identify the Hvammur client, then re-run.', v_match_count;
  end if;

  select id, address into hvammur_id, hvammur_address
  from public.profiles where name ilike '%Hvammur%';

  alter table public.orders disable trigger notify_order_created_trigger;
  alter table public.orders disable trigger notify_status_changed_trigger;

  -- fecha | general_kg | gull_kg | koddi | saeng
  for v_day in
    select * from (values
      ('2026-09-01'::date, 46.9::numeric, null::numeric, null::int, null::int),
      ('2026-09-02'::date, 22.8::numeric, 2.3::numeric,  null::int, null::int),
      ('2026-09-03'::date, 41.2::numeric, null::numeric, null::int, null::int),
      ('2026-09-04'::date, 38.5::numeric, 3.0::numeric,  null::int, 1::int),
      ('2026-09-07'::date, 87.7::numeric, 4.2::numeric,  null::int, 1::int),
      ('2026-09-08'::date, 37.2::numeric, null::numeric, null::int, null::int),
      ('2026-09-09'::date, 30.1::numeric, null::numeric, null::int, null::int),
      ('2026-09-10'::date, 46.2::numeric, 3.8::numeric,  null::int, null::int),
      ('2026-09-11'::date, 22.3::numeric, 1.9::numeric,  null::int, null::int),
      ('2026-09-14'::date, 58.7::numeric, 5.3::numeric,  1::int,    null::int),
      ('2026-09-15'::date, 50.0::numeric, 2.0::numeric,  null::int, null::int),
      ('2026-09-16'::date, 34.6::numeric, null::numeric, null::int, null::int),
      ('2026-09-17'::date, 22.0::numeric, null::numeric, null::int, null::int),
      ('2026-09-18'::date, 45.0::numeric, null::numeric, null::int, null::int)
      -- TODO: 2026-09-21 (Monday, last business day before go-live) was
      -- cropped out of the source screenshot - add its row here, e.g.:
      -- ('2026-09-21'::date, <general_kg>, <gull_kg or null>, <koddi or null>, <saeng or null>),
      -- then delete this comment block, before running this migration.
    ) as t(fecha, general_kg, gull_kg, koddi, saeng)
  loop
    -- Guard against double-applying this one-time backfill (no automated
    -- migration-apply step in this repo, so a human could re-run this file
    -- by mistake) - mirrors 20261002100500's own per-date guard.
    if exists (select 1 from public.orders where client_id = hvammur_id and fecha = v_day.fecha) then
      raise notice 'Hvammur order for % already exists, skipping', v_day.fecha;
      continue;
    end if;

    insert into public.orders
      (client_id, client_name, fecha, estado, urgent, return_method, pickup, pickup_address, source, delivered_at, notas)
    values
      (hvammur_id, 'Hvammur', v_day.fecha, 'entregado', false, 'delivery', true, hvammur_address, 'staff',
       v_day.fecha::timestamptz,
       jsonb_build_array(jsonb_build_object('kind', 'note', 'text', 'Historical backfill from paper tracking sheet', 'at', now())))
    returning id into v_order_id;

    if v_day.general_kg is not null and v_day.general_kg > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'hvammur_general_laundry', v_day.general_kg);
    end if;

    if v_day.gull_kg is not null and v_day.gull_kg > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'hvammur_yellow_tagged', v_day.gull_kg);
    end if;

    if v_day.koddi is not null and v_day.koddi > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'p_1790856319955', v_day.koddi);
    end if;

    if v_day.saeng is not null and v_day.saeng > 0 then
      insert into public.order_items (order_id, product_id, qty)
      values (v_order_id, 'p_1790856349266', v_day.saeng);
    end if;
  end loop;

  alter table public.orders enable trigger notify_order_created_trigger;
  alter table public.orders enable trigger notify_status_changed_trigger;
end $$;
