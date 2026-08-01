-- Adds a free-text saved address on the client's profile, so it can be
-- reused/prefilled as the pickup/delivery destination on future orders
-- instead of being re-typed on every order. Nullable, UI-enforced (not
-- DB-constrained) — same pattern as orders.pickup_address in
-- 20260717120000_pickup_address.sql. No new RLS policy needed: the
-- existing profiles_update policy (id = auth.uid()) already covers writes
-- to this column via self-update, and handle_new_user (SECURITY DEFINER)
-- covers the at-signup insert path below.

alter table public.profiles
  add column if not exists address text;

-- handle_new_user gains a fourth raw_user_meta_data field, following the
-- exact pattern already used for phone/preferred_lang: read
-- new.raw_user_meta_data ->> 'address' at signup so the registration form's
-- optional address field (when provided) lands on the profile row created
-- for the new user, without requiring a follow-up UPDATE under RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, name, email, phone, preferred_lang, address)
  values (
    new.id,
    new.raw_user_meta_data ->> 'name',
    new.email,
    new.raw_user_meta_data ->> 'phone',
    coalesce(new.raw_user_meta_data ->> 'preferred_lang', 'is'),
    new.raw_user_meta_data ->> 'address'
  );
  return new;
end;
$$;
