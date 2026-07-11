# TODOS

Deferred items from the engineering plan (`docs/engineering-plan.md`) — not v1 blockers, revisit post-launch.

- [ ] Supabase Realtime push updates for staff/admin views (v1 uses 20s polling instead).
- [ ] Resend delivery/bounce webhook integration (v1 logs failures via `email_log`, no webhook-driven retry).
- [ ] SQL-based report aggregation (v1 stays client-side JS `reduce()` over fetched rows; revisit if order volume grows by orders of magnitude).
- [ ] Automatic email retry on failure (v1: logged as `failed`, manual follow-up via T8's admin view).
- [ ] Formal multi-location entity modeling for contract clients (e.g. "Hótel Húsavík" stays a single profile + free-text location field).
- [ ] Point-in-time recovery / paid Supabase tier backups (v1: automated daily `pg_dump`, see T10).
- [ ] Online payment / PCI scope (explicitly out of scope until the business needs it).
