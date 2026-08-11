-- Fase 3: posta (Gmail) --

create table if not exists google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table google_tokens enable row level security;
create policy "google_tokens_select_admin" on google_tokens for select using (is_admin());

create table if not exists known_suppliers (
  id bigint generated always as identity primary key,
  email text not null unique,
  name text,
  created_at timestamptz not null default now()
);
alter table known_suppliers enable row level security;
create policy "known_suppliers_select_admin" on known_suppliers for select using (is_admin());
create policy "known_suppliers_insert_admin" on known_suppliers for insert with check (is_admin());
create policy "known_suppliers_delete_admin" on known_suppliers for delete using (is_admin());
