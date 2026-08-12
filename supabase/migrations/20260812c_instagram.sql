create table if not exists instagram_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  page_access_token text not null,
  page_id text,
  ig_user_id text,
  ig_username text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table instagram_tokens enable row level security;
create policy "instagram_tokens_select_admin" on instagram_tokens for select using (is_admin());
