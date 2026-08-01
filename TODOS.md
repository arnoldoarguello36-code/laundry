# TODOS

Deferred items from the engineering plan (`docs/engineering-plan.md`) — not v1 blockers, revisit post-launch.

- [ ] Supabase Realtime push updates for staff/admin views (v1 uses 20s polling instead).
- [ ] Resend delivery/bounce webhook integration (v1 logs failures via `email_log`, no webhook-driven retry).
- [ ] SQL-based report aggregation (v1 stays client-side JS `reduce()` over fetched rows; revisit if order volume grows by orders of magnitude).
- [ ] Automatic email retry on failure (v1: logged as `failed`, manual follow-up via T8's admin view).
- [ ] Formal multi-location entity modeling for contract clients (e.g. "Hótel Húsavík" stays a single profile + free-text location field).
- [ ] Point-in-time recovery / paid Supabase tier backups (v1: automated daily `pg_dump`, see T10).
- [ ] Online payment / PCI scope (explicitly out of scope until the business needs it).
- [ ] Pagination/search for the client desktop "My Orders" list panel once order history grows past a screenful (from `/plan-design-review` desktop layout pass, 2026-07-28).
- [ ] Automated visual-regression testing across the mobile/desktop breakpoint (e.g. via `/browse` screenshot diffing) once the new responsive layout ships (from `/plan-design-review` desktop layout pass, 2026-07-28).
- [ ] Desktop-native redesign of the staff Orders/Clients/Emails tab content (currently ships as unstyled mobile-card markup inside the desktop sidebar shell — Today and Reports/Dashboards now have true desktop layouts as of the 2026-07-31 `/plan-design-review` pass). Needs its own mockup + design-review round before implementation (from `/plan-eng-review`, 2026-07-28).
- [ ] Log/summary view for "Delivered today" actions (phase 2 — the staff order-card action was restyled to an explicit "✓ Delivered today" button on 2026-07-31, the underlying `deliveredAt` timestamp capture already exists, but there is no dedicated view listing today's deliveries yet).
- [ ] **Security: HTML-escape user-controlled order/client text before innerHTML render.** Order item `desc` (free-text "other" garment description) and client `name` are interpolated unescaped across 8+ render sites (order lists, desktop Today tab, alerts, revenue-by-client, the desktop Reports dashboard's alert list added in the desktop-layout-redesign pass). Staff/admin sessions persist a Supabase JWT in localStorage, so a script payload typed into a client-submitted order is a stored-XSS path to staff session theft / privileged RPC calls. Pre-existing across the app, newly exposed by default on the desktop staff landing view (from adversarial review, /ship, 2026-07-31) and now also the default admin desktop tab (from adversarial review, /ship, 2026-08-01).
