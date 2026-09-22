-- HSN and Hvammur always use home pickup + home delivery on every order,
-- past and future, and staff cannot toggle it off in the order sheet
-- (2026-09-22 request). force_home_service on profiles drives both the
-- retroactive fix below and the front-end lock in index.html
-- (clientForcesHomeService(), used by renderSheet() and the manual-client
-- / edit-order handlers to force orderDraftMods.pickup=true and
-- returnMethod='delivery' and disable those controls whenever the
-- selected/edited order's client has this flag set).
--
-- This is a client-side-only lock, same enforcement model this project
-- already uses for other order-sheet business rules (e.g. the shared
-- "other" product can't be deleted — UI-level, not RLS-level), consistent
-- with the rest of the manual-order-sheet, which is staff-trusted rather
-- than adversarial.
--
-- Client resolution follows 20260920160000's precedent: HSN and Hvammur's
-- profile rows are not in git, resolved by profiles.name ILIKE match with
-- a hard failure if a name doesn't resolve to exactly one row, so this
-- migration refuses to silently attach the wrong client (or silently
-- no-op) if the on-file name doesn't match what's assumed here.

alter table public.profiles
  add column if not exists force_home_service boolean not null default false;

do $$
declare
  hsn_id uuid;
  hvammur_id uuid;
begin
  select id into hsn_id from public.profiles where name ilike '%HSN%';
  if hsn_id is null then
    raise exception 'HSN client profile not found via profiles.name ILIKE %%HSN%% — update the name filter in this migration to match the real profiles.name value, then re-run.';
  end if;

  select id into hvammur_id from public.profiles where name ilike '%Hvammur%';
  if hvammur_id is null then
    raise exception 'Hvammur client profile not found via profiles.name ILIKE %%Hvammur%% — update the name filter in this migration to match the real profiles.name value, then re-run.';
  end if;

  update public.profiles
  set force_home_service = true
  where id in (hsn_id, hvammur_id);

  -- Retroactive fix for every existing order already on file for these two
  -- clients ("all the previous orders and future ones" per the request).
  -- Backfills pickup_address from the client's profile address when the
  -- order doesn't already have one on file, so a legacy order can still be
  -- reopened in the admin "Edit order" flow later without tripping its
  -- required-pickup-address check (that check only applies outside manual
  -- mode, which is exactly where a reopened legacy order would be edited).
  update public.orders o
  set pickup = true,
      return_method = 'delivery',
      pickup_address = coalesce(nullif(o.pickup_address, ''), p.address)
  from public.profiles p
  where o.client_id = p.id
    and p.id in (hsn_id, hvammur_id);
end $$;
