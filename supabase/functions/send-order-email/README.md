# send-order-email

Called by the T4 DB triggers (`notify_order_created`, `notify_status_changed`,
`notify_price_assigned`) via `pg_net`'s async HTTP queue. Not meant to be
called directly by the front end.

## Required secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by
the Supabase platform — do not set these manually.

Set once per environment before this function will actually send mail:

```
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set RESEND_FROM_ADDRESS="Þvottafélagið <orders@norduljos.is>"
```

`RESEND_FROM_ADDRESS` must be on a domain verified in Resend, or sends will
fail (and get logged to `email_log` with `status='failed'` — see T8).

## Deploy

```
supabase functions deploy send-order-email
```

## Payload contract (sent by the T4 triggers, see
`supabase/migrations/20260711140500_notification_triggers.sql`)

```json
{ "type": "order_created", "order_id": "ORD-1042" }
{ "type": "status_changed", "order_id": "ORD-1042", "old_estado": "en-cola", "new_estado": "aceptado" }
{ "type": "price_assigned", "order_id": "ORD-1042" }
```

Always returns HTTP 200 on any outcome it can classify (sent, skipped, or
failed-and-logged) since the caller (`pg_net`) never inspects the response —
returning non-2xx here would not retry or surface anywhere. Failures are
made visible exclusively through the `email_log` table, not the HTTP
response.
