# admin-update-client-email

Called by the front end (`ceSave` in `index.html`, the "Customize" client
form) whenever staff/admin changes a client's email to something different
from what's already on the profile. Syncs `auth.users.email` via the Admin
API before the existing plain `profiles` table update runs.

Exists because `profiles.email` is a denormalized display column — editing
it alone never touched the real Auth account's email, so clients created
via `admin-create-client`'s no-email path (whose Auth account is pinned to
a non-deliverable `client+<uuid>@no-email.norduljos.is` placeholder) could
never actually receive a password-reset link or log in, even after staff
"successfully" gave them a real address through Customize.

Does **not** touch the `profiles` table itself — `ceSave` still owns that
write and runs it immediately after this call succeeds.

## Required secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically —
do not set these manually.

`SUPABASE_ANON_KEY` must already be set from deploying `admin-create-client`
(same project, same value) — if not:

```
supabase secrets set SUPABASE_ANON_KEY=<the project's anon/publishable key>
```

## Deploy

```
supabase functions deploy admin-update-client-email
```

## Request contract

Called with the caller's own session (staff or admin) as the Authorization
bearer token — `supabase.functions.invoke()` does this automatically.

```json
{ "client_id": "<uuid>", "email": "jon@example.is" }
```

Response: `{ "id": "<uuid>", "email": "<string>" }` on success (200), or
`{ "error": "<message>" }` on failure (401/403/400/404/409/500). 409 means
the email is already registered to another Auth account.
