// Bilingual (en/is) email copy for the three T4 trigger types. Mirrors the
// tone and {placeholder} style of the existing email_subj_new/email_body_new
// and email_subj_status/email_body_status strings in index.html's I18N
// object (that copy backs the prototype's simulated in-page email log) —
// kept as an independent copy here since this runs in Deno, not the browser,
// but intentionally matches wording so clients see consistent voice whether
// they're looking at the (future, if ever re-added) in-app log or their
// inbox. price_assigned has no index.html precedent; it's new for T6.

export type Lang = "en" | "is";

export const STATUS_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    "en-cola": "Queued",
    "aceptado": "Accepted",
    "en-proceso": "In progress",
    "listo": "Ready",
    "entregado": "Delivered",
  },
  is: {
    "en-cola": "Í röð",
    "aceptado": "Samþykkt",
    "en-proceso": "Í vinnslu",
    "listo": "Tilbúið",
    "entregado": "Afhent",
  },
};

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    quote_pending_item: "quote pending",
    pending_items_note: "+ items pending quote",
    brand_sign_off: "— Norðurljós Laundry",
    order_created_subject: "Your order {id} has been received",
    order_created_body:
      "Hi {name},\n\nWe've received your order {id}.\n\nItems:\n{items}\n\nEstimated total: {total}\nRequested delivery: {date}\n\nWe'll notify you by email as your order progresses.\n\n— Norðurljós Laundry",
    status_changed_subject: "Update on your order {id}: {status}",
    status_changed_body:
      "Hi {name},\n\nYour order {id} is now: {status}.\n\n— Norðurljós Laundry",
    price_assigned_subject: "Price confirmed for your order {id}",
    price_assigned_body:
      "Hi {name},\n\nWe've finished pricing your order {id}.\n\nItems:\n{items}\n\nTotal: {total}\n\nYou can view the full order details anytime by logging in.\n\n— Norðurljós Laundry",
  },
  is: {
    quote_pending_item: "verð óstaðfest",
    pending_items_note: "+ atriði bíða verðs",
    brand_sign_off: "— Norðurljós þvottahús",
    order_created_subject: "Pöntun þín {id} hefur verið móttekin",
    order_created_body:
      "Hæ {name},\n\nVið höfum móttekið pöntun þína {id}.\n\nAtriði:\n{items}\n\nÁætlað heildarverð: {total}\nÓskuð afhending: {date}\n\nVið látum þig vita í tölvupósti eftir því sem pöntunin þróast.\n\n— Norðurljós þvottahús",
    status_changed_subject: "Uppfærsla á pöntun {id}: {status}",
    status_changed_body:
      "Hæ {name},\n\nPöntun þín {id} er núna: {status}.\n\n— Norðurljós þvottahús",
    price_assigned_subject: "Verð staðfest fyrir pöntun {id}",
    price_assigned_body:
      "Hæ {name},\n\nVið höfum lokið við að verðleggja pöntun þína {id}.\n\nAtriði:\n{items}\n\nSamtals: {total}\n\nÞú getur skoðað pöntunina hvenær sem er með því að skrá þig inn.\n\n— Norðurljós þvottahús",
  },
};

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export function fmtISK(n: number, lang: Lang): string {
  return (
    Math.round(n).toLocaleString(lang === "is" ? "is-IS" : "en-GB") + " kr."
  );
}

export function itemLine(
  lang: Lang,
  label: string,
  qty: number,
  cost: number | null,
): string {
  const costStr =
    cost === null ? STRINGS[lang].quote_pending_item : fmtISK(cost, lang);
  return `  • ${qty}× ${label} — ${costStr}`;
}

export function pendingNote(lang: Lang): string {
  return STRINGS[lang].pending_items_note;
}

export function statusLabel(lang: Lang, estado: string): string {
  return STATUS_LABELS[lang][estado] ?? estado;
}

export function renderOrderCreated(
  lang: Lang,
  vars: { name: string; id: string; items: string; total: string; date: string },
): { subject: string; body: string } {
  return {
    subject: interpolate(STRINGS[lang].order_created_subject, vars),
    body: interpolate(STRINGS[lang].order_created_body, vars),
  };
}

export function renderStatusChanged(
  lang: Lang,
  vars: { name: string; id: string; status: string },
): { subject: string; body: string } {
  return {
    subject: interpolate(STRINGS[lang].status_changed_subject, vars),
    body: interpolate(STRINGS[lang].status_changed_body, vars),
  };
}

export function renderPriceAssigned(
  lang: Lang,
  vars: { name: string; id: string; items: string; total: string },
): { subject: string; body: string } {
  return {
    subject: interpolate(STRINGS[lang].price_assigned_subject, vars),
    body: interpolate(STRINGS[lang].price_assigned_body, vars),
  };
}
