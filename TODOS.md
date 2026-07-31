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
- [ ] Desktop-native redesign of the staff Orders/Clients/Dashboards/Emails tab content (currently ships as unstyled mobile-card markup inside the new desktop sidebar shell — only the Today tab gets a true desktop layout in this pass). Needs its own mockup + design-review round before implementation (from `/plan-eng-review`, 2026-07-28).
- [ ] Desktop console for the admin role (T3's approved mockup only covers the 5-tab staff nav; admin's 8-tab structure — reports/volume/quotes/products/pricing/orders/clients/failed — is structurally incompatible with it). Admin keeps rendering its existing mobile layout at every viewport width until a dedicated admin desktop mockup is designed and approved (implementation decision, 2026-07-28).
- [ ] **Security: HTML-escape user-controlled order/client text before innerHTML render.** Order item `desc` (free-text "other" garment description) and client `name` are interpolated unescaped across 7+ render sites (order lists, desktop Today tab, alerts, revenue-by-client). Staff/admin sessions persist a Supabase JWT in localStorage, so a script payload typed into a client-submitted order is a stored-XSS path to staff session theft / privileged RPC calls. Pre-existing across the app, newly exposed by default on the desktop staff landing view (from adversarial review, /ship, 2026-07-31).
