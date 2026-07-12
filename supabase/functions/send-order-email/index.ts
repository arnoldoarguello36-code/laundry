// T6: the Edge Function that T4's three DB triggers call via pg_net's async
// HTTP queue (notify_order_created, notify_status_changed,
// notify_price_assigned). Non-blocking by construction — pg_net already
// returned control to the triggering transaction before this function even
// starts running, so nothing here can add latency to (or fail) an order
// write. On any failure (bad Resend key, network error, missing data) this
// still writes an `email_log` row with status='failed' instead of throwing
// silently, per the engineering plan's "failures are visible, not swallowed"
// requirement (surfaced later by the T8 admin view).
//
// Required secrets (not auto-injected — set once per environment via
// `supabase secrets set NAME=value` or Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY       Resend API key
//   RESEND_FROM_ADDRESS  verified sender, e.g. "Norðurljós Laundry <orders@norduljos.is>"
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically to
// every Supabase Edge Function; not set manually.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fmtISK,
  itemLine,
  pendingNote,
  renderOrderCreated,
  renderPriceAssigned,
  renderStatusChanged,
  statusLabel,
  type Lang,
} from "./templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Payload = {
  type: "order_created" | "status_changed" | "price_assigned";
  order_id: string;
  old_estado?: string;
  new_estado?: string;
};

type OrderRow = {
  id: string;
  client_id: string | null;
  fecha: string | null;
  urgent: boolean;
  return_method: string | null;
  pickup: boolean;
  estado: string;
  order_items: {
    qty: number;
    price_override: number | null;
    desc: string | null;
    products: {
      name_en: string;
      name_is: string;
      price: number | null;
    } | null;
  }[];
};

type ProfileRow = {
  name: string | null;
  email: string | null;
  preferred_lang: Lang;
  notifications_enabled: boolean;
};

type Settings = {
  express_percent: number;
  delivery_fee: number;
  pickup_fee: number;
  discount_percent: number;
};

async function logEmail(
  order_id: string | null,
  to_address: string,
  subject: string,
  body: string,
  status: "sent" | "failed",
) {
  const { error } = await admin.from("email_log").insert({
    order_id,
    to_address,
    subject,
    body,
    status,
  });
  if (error) {
    // Nothing further we can do — the DB write itself is what surfaces
    // failures to the T8 admin view, so log to stderr for operator visibility.
    console.error("email_log insert failed:", error.message);
  }
}

async function sendViaResend(to: string, subject: string, text: string) {
  if (!RESEND_API_KEY || !RESEND_FROM_ADDRESS) {
    throw new Error(
      "RESEND_API_KEY / RESEND_FROM_ADDRESS not configured for this environment",
    );
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_ADDRESS,
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${detail}`);
  }
}

function computeItemsAndTotal(order: OrderRow, settings: Settings, lang: Lang) {
  let itemsTotal = 0;
  let hasPending = false;
  const lines: string[] = [];

  for (const it of order.order_items) {
    const unitPrice = it.price_override ?? it.products?.price ?? null;
    const cost = unitPrice === null ? null : unitPrice * it.qty;
    if (cost === null) hasPending = true;
    else itemsTotal += cost;
    const label = it.products
      ? lang === "is" ? it.products.name_is : it.products.name_en
      : it.desc ?? "Other";
    lines.push(itemLine(lang, label, it.qty, cost));
  }

  const expressFee = order.urgent
    ? Math.round(itemsTotal * (settings.express_percent / 100))
    : 0;
  const deliveryFee = order.return_method === "delivery" ? settings.delivery_fee : 0;
  const pickupFee = order.pickup ? settings.pickup_fee : 0;
  const discount = settings.discount_percent
    ? Math.round(itemsTotal * (settings.discount_percent / 100))
    : 0;
  const total = Math.max(0, itemsTotal + expressFee + deliveryFee + pickupFee - discount);

  const totalStr = fmtISK(total, lang) + (hasPending ? ` (${pendingNote(lang)})` : "");
  return { itemsText: lines.join("\n"), totalStr };
}

Deno.serve(async (req: Request) => {
  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }

  const { type, order_id } = payload;
  if (!type || !order_id) {
    return new Response("type and order_id are required", { status: 400 });
  }

  try {
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select(
        "id, client_id, fecha, urgent, return_method, pickup, estado, order_items(qty, price_override, desc, products(name_en, name_is, price))",
      )
      .eq("id", order_id)
      .single<OrderRow>();

    if (orderErr || !order) {
      throw new Error(`order ${order_id} not found: ${orderErr?.message ?? "no row"}`);
    }

    if (!order.client_id) {
      // Pure walk-in with no account (T3's log_manual_order allows
      // p_client_id = null) — nothing to email, not a failure.
      return new Response("no client on order, skipped", { status: 200 });
    }

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("name, email, preferred_lang, notifications_enabled")
      .eq("id", order.client_id)
      .single<ProfileRow>();

    if (profileErr || !profile) {
      throw new Error(`profile for order ${order_id} not found: ${profileErr?.message ?? "no row"}`);
    }

    if (!profile.email || !profile.notifications_enabled) {
      // Client opted out or has no email on file — not a failure.
      return new Response("client has no email or opted out, skipped", { status: 200 });
    }

    const lang: Lang = profile.preferred_lang ?? "is";
    const name = profile.name ?? "";
    let subject: string;
    let body: string;

    if (type === "order_created") {
      const { data: settings } = await admin
        .from("settings")
        .select("express_percent, delivery_fee, pickup_fee, discount_percent")
        .eq("id", 1)
        .single<Settings>();
      const { itemsText, totalStr } = computeItemsAndTotal(
        order,
        settings ?? {
          express_percent: 0,
          delivery_fee: 0,
          pickup_fee: 0,
          discount_percent: 0,
        },
        lang,
      );
      ({ subject, body } = renderOrderCreated(lang, {
        name,
        id: order.id,
        items: itemsText,
        total: totalStr,
        date: order.fecha ?? "",
      }));
    } else if (type === "status_changed") {
      ({ subject, body } = renderStatusChanged(lang, {
        name,
        id: order.id,
        status: statusLabel(lang, payload.new_estado ?? order.estado),
      }));
    } else if (type === "price_assigned") {
      const { data: settings } = await admin
        .from("settings")
        .select("express_percent, delivery_fee, pickup_fee, discount_percent")
        .eq("id", 1)
        .single<Settings>();
      const { itemsText, totalStr } = computeItemsAndTotal(
        order,
        settings ?? {
          express_percent: 0,
          delivery_fee: 0,
          pickup_fee: 0,
          discount_percent: 0,
        },
        lang,
      );
      ({ subject, body } = renderPriceAssigned(lang, {
        name,
        id: order.id,
        items: itemsText,
        total: totalStr,
      }));
    } else {
      throw new Error(`unknown notification type: ${type}`);
    }

    try {
      await sendViaResend(profile.email, subject, body);
      await logEmail(order_id, profile.email, subject, body, "sent");
      return new Response("sent", { status: 200 });
    } catch (sendErr) {
      await logEmail(order_id, profile.email, subject, body, "failed");
      console.error("send failed:", sendErr);
      return new Response("send failed, logged", { status: 200 });
    }
  } catch (err) {
    // Couldn't even build the email (order/profile lookup failed, unknown
    // type, etc.) — still write a failed row so it's visible in T8, using
    // whatever we know.
    console.error("send-order-email error:", err);
    await logEmail(
      order_id,
      "unknown",
      `(${payload.type}) send-order-email failed`,
      String(err),
      "failed",
    );
    return new Response("error, logged", { status: 200 });
  }
});
