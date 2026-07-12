-- T1: profile-provisioning + role-escalation-protection triggers.
-- Both are SECURITY DEFINER with pinned search_path per the engineering plan
-- (unpinned search_path on a security-definer function is a schema-injection
-- privilege-escalation vector).

-- T5 note: also captures phone from signup metadata (new.raw_user_meta_data
-- ->> 'phone'). Needed so the T5 "staff registers a client" flow can set a
-- new client's phone number at creation time — a direct UPDATE afterward
-- would require the T2 profiles_update policy (id = auth.uid() OR admin) to
-- let plain staff write another user's row, which it deliberately doesn't.
-- Routing phone through the same SECURITY DEFINER insert that already sets
-- name/email sidesteps that RLS gap instead of loosening the policy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, name, email, phone, preferred_lang)
  values (new.id, new.raw_user_meta_data ->> 'name', new.email, new.raw_user_meta_data ->> 'phone', 'is');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevents a client (or staff) from self-escalating role/is_contract via the
-- RLS-permitted "update own profile row" path. RLS is row-level only and
-- cannot restrict individual columns, so this is enforced here instead.
-- Only a caller whose OWN profile.role = 'admin' may change role/is_contract
-- on any row. Note: this runs for every UPDATE regardless of caller
-- (including future admin-driven promotions), so an admin promoting another
-- user to staff must do so under their own authenticated session — not via a
-- raw service-role batch update, which would resolve auth.uid() to null and
-- be rejected.
create or replace function public.protect_profile_role_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_role text;
begin
  if new.role is distinct from old.role or new.is_contract is distinct from old.is_contract then
    select role into caller_role from public.profiles where id = auth.uid();
    if caller_role is distinct from 'admin' then
      raise exception 'not authorized to change role or is_contract';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_role_columns_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_role_columns();
