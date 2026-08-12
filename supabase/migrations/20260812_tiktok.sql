create table if not exists tiktok_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz,
  open_id text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table tiktok_tokens enable row level security;
create policy "tiktok_tokens_select_admin" on tiktok_tokens for select using (is_admin());
