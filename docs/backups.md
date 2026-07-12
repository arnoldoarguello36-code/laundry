# Backups

T10: automated nightly backups of the production database, plus a restore
runbook. See `.github/workflows/db-backup.yml` for the scheduled job itself
and the required secrets.

## What gets backed up

`pg_dump --format=custom` against the full production Postgres database
(schema + data, all 6 tables + RLS policies + triggers + RPCs), gzipped, and
uploaded to an external S3-compatible bucket every night at 03:15 UTC. "External"
here specifically means *not* Supabase-hosted storage — the whole point is
surviving a Supabase-side incident (account lockout, project deletion,
billing lapse, etc.), so the backup must live somewhere Supabase can't touch.

The workflow does not prune old backups — set an S3 lifecycle rule on the
bucket (e.g. expire objects after 90 days) if you don't want them to
accumulate forever.

## One-time setup

1. Create the destination bucket (AWS S3, Cloudflare R2, Backblaze B2 — any
   S3-compatible object store works). R2 and B2 are the cheaper options for
   a small business and both speak the S3 API.
2. Create an access key scoped to just that bucket (least privilege — this
   key should not be able to touch anything else in the account).
3. Set the 5 repo secrets listed in `.github/workflows/db-backup.yml`'s
   header comment (`SUPABASE_DB_URL`, `BACKUP_S3_BUCKET`,
   `BACKUP_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
4. Trigger the workflow manually once (Actions tab -> "Nightly database
   backup" -> "Run workflow") to confirm it succeeds end-to-end before
   relying on the schedule.

## Restoring from a backup (do this dry-run before launch, per T9/T10)

Restoring `pg_dump --format=custom` output requires a target Postgres
database to restore into — for a dry run, use a **fresh, throwaway Supabase
project** (never restore over a live project as a test).

```bash
# 1. Download the dump you want to test (replace with an actual filename
#    from the bucket)
aws s3 cp s3://<bucket>/norduljos-<timestamp>.dump.gz . \
  [--endpoint-url <endpoint, if using R2/B2>]
gunzip norduljos-<timestamp>.dump.gz

# 2. Create a fresh Supabase project (dashboard -> New project) and grab its
#    connection string (Project Settings -> Database -> Connection string).

# 3. Restore into it
pg_restore \
  --dbname="<fresh-project-connection-string>" \
  --no-owner --no-privileges \
  --clean --if-exists \
  norduljos-<timestamp>.dump

# 4. Verify: row counts on the core tables roughly match what you expect,
#    and a couple of spot-check orders/profiles/emails look intact.
psql "<fresh-project-connection-string>" -c "
  select
    (select count(*) from public.profiles) as profiles,
    (select count(*) from public.orders) as orders,
    (select count(*) from public.order_items) as order_items,
    (select count(*) from public.email_log) as email_log;
"
```

**This dry run has not been performed yet** — it requires an actual
Supabase project and a real production dump, neither of which exist in this
environment. Do this at least once before launch (per the T9 cutover
checklist), and periodically thereafter (e.g. quarterly) to make sure the
restore path still works as the schema evolves — an untested backup is not
a backup.

## What this does NOT cover

- **Point-in-time recovery.** This is a once-a-day full dump, so worst-case
  data loss on a full restore is "up to 24h of orders." If that's not
  acceptable, Supabase's paid tiers include PITR — worth revisiting once
  order volume justifies the upgrade cost.
- **Storage/Auth config backup.** This dumps the Postgres database only
  (which includes `auth.users` via the standard Supabase schema, so
  accounts/passwords are covered) but not Supabase project *settings*
  (Edge Function secrets, custom SMTP config, etc.) — re-running the T6
  Edge Function secrets setup is a manual step after any full project
  recreation, not something a data restore replaces.
