-- T4: order/status/price triggers that fire the T6 Edge Function via pg_net's
-- async HTTP queue. pg_net enqueues the request and returns immediately, so
-- these AFTER triggers never add latency to (or fail alongside) the write
-- that fired them — that's what makes "order write never blocked by email"
-- true, per the engineering plan's async-queue decision.
--
-- GAP FILL — requires manual setup not expressible in a git-committed
-- migration: notify_email_function() below reads the project URL and a
-- service-role key from Supabase Vault (vault.decrypted_secrets), not from
-- this file, since committing a service-role key to git would leak it. Two
-- secrets must be created once per environment (Dashboard → Project
-- Settings → Vault, or `select vault.create_secret(value, name)`):
--   name = 'project_url'        value = https://<project-ref>.supabase.co
--   name = 'service_role_key'   value = <service role JWT>
-- Edge Functions require a valid Authorization Bearer token by default; the
-- service-role key is what lets this DB-originated call reach the function.
-- Until both secrets exist, notify_email_function raises a warning and
-- no-ops rather than failing the triggering write.
--
-- The Edge Function itself (name assumed here: send-order-email) is T6, not
-- yet written. It owns writing email_log rows (success or status='failed')
-- since it — not this trigger — knows the actual Resend call outcome.

create extension if not exists pg_net;

create or replace function public.notify_email_function(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise warning 'notify_email_function: project_url/service_role_key not configured in Vault, skipping email';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/send-order-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := p_payload
  );
end;
$$;

-- ===== notify_order_created =====
create or replace function public.notify_order_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.notify_email_function(
    jsonb_build_object('type', 'order_created', 'order_id', new.id)
  );
  return new;
end;
$$;

create trigger notify_order_created_trigger
  after insert on public.orders
  for each row execute function public.notify_order_created();

-- ===== notify_status_changed =====
-- Only fires on an actual estado change — editing comentarios/problem/notas
-- must not send an email.
create or replace function public.notify_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado is distinct from old.estado then
    perform public.notify_email_function(jsonb_build_object(
      'type', 'status_changed',
      'order_id', new.id,
      'old_estado', old.estado,
      'new_estado', new.estado
    ));
  end if;
  return new;
end;
$$;

create trigger notify_status_changed_trigger
  after update on public.orders
  for each row execute function public.notify_status_changed();

-- ===== notify_price_assigned =====
-- Batches per order: fires exactly once, when the row being priced is the
-- LAST order_item on its order still missing a price — not once per item.
create or replace function public.notify_price_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_still_pending int;
begin
  if old.price_override is null and new.price_override is not null then
    select count(*) into v_still_pending
    from public.order_items
    where order_id = new.order_id and price_override is null;

    if v_still_pending = 0 then
      perform public.notify_email_function(
        jsonb_build_object('type', 'price_assigned', 'order_id', new.order_id)
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger notify_price_assigned_trigger
  after update on public.order_items
  for each row execute function public.notify_price_assigned();
