-- One-time historical backfill, follow-up to 20261002100200: adds HSN's two
-- "verificar" (yellow-flagged) rows that 20261002100200 deliberately
-- excluded - 2026-10-02 follow-up request decided to include them after all,
-- using the numbers already transcribed from the original sheet:
--   09/09/2026: General=75,9 kg (Skítur 3,3 kg stays out of scope per
--     20261002100200/20261002100100's header; no Gull, no Koddi, no Sæng
--     that day)
--   18/09/2026: General=72,7 kg (no Gull, no Koddi, no Sæng)
--
-- Same product mapping, trigger suppression, home-service fields, and
-- historical-backfill notas tag as 20261002100200 - see that file's header
-- for the full rationale (Pillow/Duvet product ids, email suppression,
-- force_home_service, etc). New migration file rather than editing
-- 20261002100200 in place, since that one has already been applied.
--
-- Guarded with "not exists" per date so this is safe to re-run without
-- creating duplicate orders if it's ever applied twice.

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
  for v_day in
    select * from (values
      ('2026-09-09'::date, 75.9::numeric, null::numeric, null::int, null::int),
      ('2026-09-18'::date, 72.7::numeric, null::numeric, null::int, null::int)
    ) as t(fecha, general_kg, gull_kg, koddi, saeng)
  loop
    if exists (select 1 from public.orders where client_id = hsn_id and fecha = v_day.fecha) then
      raise notice 'HSN order for % already exists, skipping', v_day.fecha;
      continue;
    end if;

    insert into public.orders
      (client_id, client_name, fecha, estado, urgent, return_method, pickup, pickup_address, source, created_at, delivered_at, notas)
    values
      (hsn_id, 'HSN', v_day.fecha, 'entregado', false, 'delivery', true, hsn_address, 'staff',
       v_day.fecha::timestamptz, v_day.fecha::timestamptz,
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
