-- Follow-up to 20260829140000_seed_delivery_sheet_products.sql: that
-- migration treated the pre-existing generic "Sheets"/"Lök" product
-- (p_1784848973135) as already covering the delivery sheet's "Lök
-- venjuleg" (regular sheet) line item. But unlike the other 3 pre-existing
-- matches (Koddaver, Koddar, Sængur — all exact name matches to their
-- sheet counterparts), "Lök" carries no size qualifier at all, whereas the
-- migration just added an explicit sibling, "Lök stór" (Large Sheet). That
-- leaves the regular/large distinction implicit for one size and explicit
-- for the other — inconsistent with the Small Towel / Large Towel pair,
-- which are both explicit.
--
-- Rename only (id, price, category, sort_order untouched) — order_items
-- has no name snapshot, it stores product_id and joins live to
-- products.name_en/name_is (see 20260711140000_schema.sql), so this is a
-- pure display fix with zero effect on order history or referential
-- integrity.

update public.products
set name_en = 'Regular Sheet',
    name_is = 'Lök venjuleg'
where id = 'p_1784848973135';
