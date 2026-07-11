-- T1: core schema — profiles, products, settings, orders, order_items, email_log
-- RLS is enabled here (fail-closed) but policies are written in T2 — until T2
-- lands, only the service role can read/write these tables.

create extension if not exists pgcrypto;

create table public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  role                   text not null default 'client' check (role in ('client','staff','admin')),
  name                   text,
  phone                  text,
  email                  text,
  is_contract            boolean not null default false,
  notifications_enabled  boolean not null default true,
  preferred_lang         text not null default 'is' check (preferred_lang in ('en','is')),
  registered_at          timestamptz not null default now()
);

create table public.products (
  id          text primary key,
  name_en     text not null,
  name_is     text not null,
  price       numeric,                 -- null = price-pending item (e.g. "other")
  unit        text not null check (unit in ('pc','kg','set')),
  category    text not null check (category in ('bedding','apparel','general','other')),
  active      boolean not null default true,
  sort_order  int not null default 0
);

create table public.settings (
  id                int primary key default 1 check (id = 1),   -- singleton
  express_percent   numeric not null default 0,
  delivery_fee      numeric not null default 0,
  pickup_fee        numeric not null default 0,
  discount_percent  numeric not null default 0,
  delivery_enabled  boolean not null default true,
  pickup_enabled    boolean not null default true
);

create table public.orders (
  id             text primary key,                              -- e.g. "ORD-1042"
  client_id      uuid references public.profiles(id),           -- null only for pure walk-in w/o account
  client_name    text,
  fecha          date,
  comentarios    text,
  estado         text not null default 'en-cola' check (estado in ('en-cola','aceptado','en-proceso','listo','entregado')),
  urgent         boolean not null default false,
  return_method  text check (return_method in ('store','delivery')),
  pickup         boolean not null default false,
  problem        boolean not null default false,
  source         text not null check (source in ('client','staff')),
  notas          jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  delivered_at   timestamptz
);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        text not null references public.orders(id) on delete cascade,
  product_id      text not null references public.products(id) on delete restrict,
  qty             numeric not null,
  price_override  numeric,             -- admin-assigned quote for "other" items
  "desc"          text
);

create table public.email_log (
  id          uuid primary key default gen_random_uuid(),
  order_id    text references public.orders(id),
  to_address  text not null,
  subject     text not null,
  body        text not null,
  status      text not null check (status in ('sent','failed')),
  sent_at     timestamptz not null default now()
);

-- FK columns aren't auto-indexed by Postgres; these are hit on every order
-- detail/report query.
create index orders_client_id_idx on public.orders(client_id);
create index order_items_order_id_idx on public.order_items(order_id);
create index order_items_product_id_idx on public.order_items(product_id);
create index email_log_order_id_idx on public.email_log(order_id);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.email_log enable row level security;
