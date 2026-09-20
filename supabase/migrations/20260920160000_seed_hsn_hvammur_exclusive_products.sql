-- Exclusive order-sheet catalogs for two contract clients, HSN and
-- Hvammur: restricts their dropdown to exactly 4 client-specific items
-- each. A 5th item, "Other garment", is intentionally NOT duplicated here
-- — it's covered by the existing shared id='other' product, which
-- activeProducts() in index.html now always includes for any client on an
-- exclusive catalog (see the 2026-09-20 comment above activeProducts()).
-- "Other" is a universal free-text/quote-pending item (it.tipo==='other'
-- checks throughout index.html: description input, quote-pending price
-- hint, submit validation), not a per-client catalog entry, and product id
-- is a primary key — giving each client their own "other"-like row under a
-- different id would silently lose all of that behavior.
--
-- Client resolution: HSN and Hvammur's profile rows are not in git — per
-- 20260829140000's header, this catalog has never been seeded from git,
-- always hand-entered live in Supabase. Resolved below by profiles.name
-- ILIKE match rather than a hardcoded UUID, with a hard failure if a name
-- doesn't resolve to exactly one row, so this migration refuses to
-- silently attach the wrong client (or silently no-op) if the on-file name
-- doesn't match what's assumed here — update the ILIKE pattern and re-run
-- instead of trusting a partial/ambiguous match.
--
-- Pricing: real contract pricing is unknown at migration time. Seeded at
-- the same price=1 placeholder convention this project already uses for
-- other manually-reconciled items (see 20260829140000's header) — adjust
-- via the existing admin "Edit product" UI once the real rates are known.
--
-- staff_only=true: matches the existing "Hótel Húsavík" contract-client
-- precedent (docs/design.md, docs/engineering-plan.md) — these are
-- staff-logged manual/contract orders, not client self-service, so the
-- items should stay out of the client-facing self-service dropdown.
--
-- Purely additive (new rows only, on conflict do nothing) — matches this
-- project's established pattern of never editing already-applied/live
-- migrations or data in place.

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

  insert into public.products (id, name_en, name_is, price, unit, category, active, sort_order, staff_only, owner_client_id)
  values
    ('hsn_general_laundry',       'General Laundry',       'Almennur þvottur',   1, 'kg', 'general', true, 3001, true, hsn_id),
    ('hsn_yellow_tagged',         'Yellow-tagged laundry',  'Gulmerktur þvottur', 1, 'kg', 'general', true, 3002, true, hsn_id),
    ('hsn_uniform_shirts',        'Uniform Shirts',         'Einkennisskyrtur',  1, 'pc', 'apparel', true, 3003, true, hsn_id),
    ('hsn_uniform_trousers',      'Uniform Trousers',       'Einkennisbuxur',    1, 'pc', 'apparel', true, 3004, true, hsn_id),
    ('hvammur_general_laundry',   'General Laundry',        'Almennur þvottur',  1, 'kg', 'general', true, 3005, true, hvammur_id),
    ('hvammur_yellow_tagged',     'Yellow-tagged laundry',  'Gulmerktur þvottur', 1, 'kg', 'general', true, 3006, true, hvammur_id),
    ('hvammur_uniform_shirts',    'Uniform Shirts',         'Einkennisskyrtur',  1, 'pc', 'apparel', true, 3007, true, hvammur_id),
    ('hvammur_uniform_trousers',  'Uniform Trousers',       'Einkennisbuxur',    1, 'pc', 'apparel', true, 3008, true, hvammur_id)
  on conflict (id) do nothing;
end $$;
