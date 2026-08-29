-- Catalog enrichment from the physical "Afhendingarskýrsla" (delivery report)
-- sheet used for Askja and other contract-linen clients. The sheet tracks 11
-- line items; cross-checked against the live products table (queried
-- directly, since no catalog seed has ever existed in git — the catalog was
-- hand-entered by an admin) most already have a matching product:
--
--   Sheet item (is)     | English         | Live catalog today
--   --------------------|-----------------|----------------------------------
--   Handklæði lítil     | Small towel     | missing (only generic "Towels")
--   Handklæði stór      | Large towel     | missing (only generic "Towels")
--   Baðmottur           | Bath mat        | missing entirely
--   Sængurver           | Duvet cover     | missing (catalog only has the
--                       |                 |   duvet itself, "Sængur"/"Duvets")
--   Koddaver            | Pillowcase      | exists: p_pillow_cases
--   Lök venjuleg        | Regular sheet   | covered by existing generic
--                       |                 |   "Sheets" (p_1784848973135)
--   Lök stór            | Large sheet     | missing (no size variant)
--   Tuskur              | Rags/cloths     | missing entirely
--   Koddar              | Pillows         | exists: p_1785231555572
--   Sængur              | Duvets          | exists: p_1785231589061
--   Viskastykki         | Tea towels      | missing entirely
--
-- So only the 7 genuinely-missing items are added here — purely additive,
-- no changes to any existing row (matches this project's established
-- pattern of never editing already-applied/live data in place).
--
-- Pricing: the delivery sheet is a quantity tally only (dates x counts),
-- it carries no price data. Every existing per-piece product in the live
-- catalog currently uses a price=1 placeholder (real billing appears to be
-- reconciled manually), so these new rows follow that same convention
-- rather than inventing prices. Staff can adjust via the existing "Edit
-- product" admin UI at any time, same as any other catalog row.
--
-- category follows the closest existing sibling: "Sheets" and "Towels" are
-- both category='general' in the live catalog (not 'bedding'), so the new
-- towel/sheet/rag/tea-towel items match that; duvet cover joins
-- 'bedding' alongside Duvets/Pillows/Mattress Covers.

insert into public.products (id, name_en, name_is, price, unit, category, active, sort_order, staff_only)
values
  ('p_towel_small', 'Small Towel',  'Handklæði lítil', 1, 'pc', 'general', true, 1009, false),
  ('p_towel_large', 'Large Towel',  'Handklæði stór',  1, 'pc', 'general', true, 1010, false),
  ('p_bath_mat',    'Bath Mat',     'Baðmottur',       1, 'pc', 'general', true, 1011, false),
  ('p_duvet_cover', 'Duvet Cover',  'Sængurver',       1, 'pc', 'bedding', true, 1012, false),
  ('p_sheet_large', 'Large Sheet',  'Lök stór',        1, 'pc', 'general', true, 1013, false),
  ('p_rags',        'Rags',         'Tuskur',          1, 'pc', 'general', true, 1014, false),
  ('p_tea_towel',   'Tea Towel',    'Viskastykki',     1, 'pc', 'general', true, 1015, false)
on conflict (id) do nothing;
