-- One-time bulk cleanup (2026-09-22 request): move every staff-entered
-- order to Delivered status, regardless of client. Not a schema change —
-- matches this project's pattern of keeping one-time data-fix scripts in
-- supabase/migrations as a historical record (see 20260920160000,
-- 20260829140000).
--
-- Scope: every order with source='staff' (created via the staff/admin
-- manual-order sheet) that isn't already 'entregado'. Client self-service
-- orders (source='client') are untouched.
--
-- Bypasses the one-step advance_order_status() pipeline on purpose — jumps
-- straight to the final state instead of walking each order through every
-- intermediate status. This still fires notify_status_changed_trigger (T4)
-- once per affected row exactly as any other estado UPDATE would, so each
-- order's client gets the normal "status changed" email if Vault's
-- project_url/service_role_key secrets are configured — that side effect
-- was raised and explicitly accepted ("ignore the email part"), not
-- suppressed.
--
-- delivered_at only fills in when missing, so already-delivered orders
-- keep their real timestamp; the estado<>'entregado' filter additionally
-- makes this a no-op for rows already in their final state, so re-running
-- this file is harmless.
update public.orders
set estado = 'entregado',
    delivered_at = coalesce(delivered_at, now()),
    notas = notas || jsonb_build_array(jsonb_build_object('kind', 'status', 'estado', 'entregado', 'at', now()))
where source = 'staff'
  and estado <> 'entregado';
