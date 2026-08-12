create table if not exists social_snapshots (
  id bigint generated always as identity primary key,
  platform text not null,
  snapshot_date date not null,
  follower_count integer,
  following_count integer,
  likes_count integer,
  video_count integer,
  created_at timestamptz not null default now(),
  unique (platform, snapshot_date)
);
alter table social_snapshots enable row level security;
create policy "social_snapshots_select_admin" on social_snapshots for select using (is_admin());
