# admin-create-client

Called by the front end (`cfSave` in `index.html`) when staff/admin checks
"No email for this client" while registering a new client. Creates the Auth
user + profile row *without* sending either of the two emails the normal
add-client flow sends (signup confirmation, password-reset/set-password
link) — via `email_confirm: true` on `admin.createUser` and by never calling
`resetPasswordForEmail`.

Also the only way to register a client with no email at all (the normal
flow hard-requires one); a placeholder, non-deliverable address is minted
server-side and never shown to staff (`profiles.email` is left `null`).

## Required secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically —
do not set these manually.

Must be set once per environment (not auto-injected, unlike the two above):

```
supabase secrets set SUPABASE_ANON_KEY=<the project's anon/publishable key>
```

Used only to build a caller-scoped client for the `auth.getUser()` identity
check — authorization itself (staff/admin role) is decided via the
service-role client against `profiles.role`, not via this key.

## Deploy

```
supabase functions deploy admin-create-client
```

## Request contract

Called with the caller's own session (staff or admin) as the Authorization
bearer token — `supabase.functions.invoke()` does this automatically.

```json
{ "name": "Kárhöll", "phone": "5550555", "address": "Kárhöll", "is_contract": false }
```

`email` is optional — omit it for a no-email client. `is_contract` is
silently ignored (forced `false`) unless the caller's own role is `admin`,
mirroring the admin-only checkbox in `clientAddFormHtml()`.

Response: `{ "id": "<uuid>", "email": "<string|null>" }` on success (200),
or `{ "error": "<message>" }` on failure (401/403/400/409/500).
