-- One-time behavior fix (2026-10-02 request): "I want to automatically assign
-- the orders created by the staff manually under delivery status." Staff logs
-- a manual/walk-in/contract order (the "Log order" sheet, sheetMode==='manual'
-- in index.html) via log_manual_order() below, which previously dropped every
-- new row into 'en-cola' (the front of the normal client-facing pipeline:
-- en-cola -> aceptado -> en-proceso -> listo -> entregado). That's wrong for
-- this flow specifically: staff only use "Log order" to record laundry that's
-- already been collected/processed/handed back (same real-world event the
-- historical HSN/Hvammur backfills and 20260922100100's bulk-deliver cleanup
-- both model as 'entregado' from the start) - it was never meant to sit in a
-- live queue waiting for someone to click it through four more states.
--
-- This only changes log_manual_order's default going forward. It does NOT
-- touch any existing row - 20260922100100 already swept prior staff orders to
-- 'entregado' once, and the client self-service insert path (index.html,
-- sheetMode==='client' branch) is untouched and still starts at 'en-cola' as
-- intended, since a client's own request legitimately needs to move through
-- the real pipeline.
--
-- delivered_at is now set to now() at insert time (mirrors
-- advance_order_status's "set delivered_at when reaching the final state"
-- rule - see 20260711140400_rpcs.sql) and a {kind:'status', estado:'entregado',
-- at} notas entry is appended so the order-detail activity feed reads the
-- same way a normally-advanced order would, instead of looking like it
-- skipped every step silently.
--
-- Same signature as the current log_manual_order (20260717120000's 9-arg
-- version, p_pickup_address trailing with a default) - no callers need to
-- change, only the function body.
drop function if exists public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb, text);

create or replace function public.log_manual_order(
  p_client_id      uuid,
  p_client_name    text,
  p_fecha          date,
  p_comentarios    text,
  p_urgent         boolean,
  p_return_method  text,
  p_pickup         boolean,
  p_items          jsonb,
  p_pickup_address text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id text;
  v_item     jsonb;
begin
  if public.current_profile_role() not in ('staff', 'admin') then
    raise exception 'not authorized';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;

  insert into public.orders
    (client_id, client_name, fecha, comentarios, estado, urgent, return_method, pickup, pickup_address, source, delivered_at, notas)
  values
    (p_client_id, p_client_name, p_fecha, p_comentarios, 'entregado', p_urgent, p_return_method, p_pickup,
     case when p_pickup then p_pickup_address else null end, 'staff', now(),
     jsonb_build_array(jsonb_build_object('kind', 'status', 'estado', 'entregado', 'at', now())))
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, qty, price_override, "desc")
    values (
      v_order_id,
      v_item ->> 'product_id',
      (v_item ->> 'qty')::numeric,
      nullif(v_item ->> 'price_override', '')::numeric,
      v_item ->> 'desc'
    );
  end loop;

  return v_order_id;
end;
$$;

revoke execute on function public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb, text) from public;
grant execute on function public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb, text) to authenticated;
