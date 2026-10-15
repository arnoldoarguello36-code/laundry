-- Adds profiles.kennitala (Icelandic national/company ID), captured at
-- client registration alongside the existing profiles.address column.
-- Both fields are now mandatory in the UI at registration time (self
-- signup + staff "add client" + the no-email admin-create-client path),
-- but stay nullable here at the DB level — same pattern already
-- established for address in 20260801220000_profile_address.sql, so
-- existing clients who predate this change aren't retroactively broken
-- by a NOT NULL constraint. Enforcement lives in index.html's form
-- validation, not here.

alter table public.profiles
  add column if not exists kennitala text;

-- handle_new_user gains a fifth raw_user_meta_data field, following the
-- exact pattern already used for phone/preferred_lang/address: read
-- new.raw_user_meta_data ->> 'kennitala' at signup so the registration
-- form's (now mandatory) kennitala field lands on the profile row
-- created for the new user, without requiring a follow-up UPDATE under
-- RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, name, email, phone, preferred_lang, address, kennitala)
  values (
    new.id,
    new.raw_user_meta_data ->> 'name',
    new.email,
    new.raw_user_meta_data ->> 'phone',
    coalesce(new.raw_user_meta_data ->> 'preferred_lang', 'is'),
    new.raw_user_meta_data ->> 'address',
    new.raw_user_meta_data ->> 'kennitala'
  );
  return new;
end;
$$;
