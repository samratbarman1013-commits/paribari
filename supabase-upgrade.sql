-- =====================================================================
--  PariBari — UPGRADE schema (run this AFTER supabase-schema.sql)
--  Adds: Stories, Reels, read receipts + photos in chat.
--  Paste the whole file into Supabase -> SQL Editor -> New query -> Run.
--  Safe to run once. It only ADDS things; it does not touch your data.
-- =====================================================================

-- ------------------------------------------------------------- STORIES
create table if not exists public.stories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  media_url   text not null,
  media_type  text not null default 'image',          -- image | video
  caption     text default '',
  created_at  timestamptz default now(),
  expires_at  timestamptz default (now() + interval '24 hours')
);
create index if not exists stories_expires_idx on public.stories(expires_at desc);
create index if not exists stories_user_idx    on public.stories(user_id, created_at desc);

create table if not exists public.story_views (
  story_id    uuid references public.stories(id) on delete cascade,
  viewer_id   uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (story_id, viewer_id)
);

-- --------------------------------------------------------------- REELS
create table if not exists public.reels (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  video_url   text not null,
  caption     text default '',
  created_at  timestamptz default now()
);
create index if not exists reels_created_idx on public.reels(created_at desc);

create table if not exists public.reel_likes (
  reel_id     uuid references public.reels(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (reel_id, user_id)
);

create table if not exists public.reel_comments (
  id          uuid primary key default gen_random_uuid(),
  reel_id     uuid references public.reels(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz default now()
);

-- ------------------------------------------- CHAT: read receipts + media
alter table public.messages add column if not exists read_at    timestamptz;
alter table public.messages add column if not exists media_url  text;
alter table public.messages add column if not exists media_type text;   -- image

-- ------------------------------------------------------------------- RLS
alter table public.stories       enable row level security;
alter table public.story_views   enable row level security;
alter table public.reels         enable row level security;
alter table public.reel_likes    enable row level security;
alter table public.reel_comments enable row level security;

-- stories
drop policy if exists stories_read   on public.stories;
drop policy if exists stories_insert on public.stories;
drop policy if exists stories_delete on public.stories;
create policy stories_read   on public.stories for select to authenticated using (true);
create policy stories_insert on public.stories for insert to authenticated with check (auth.uid() = user_id);
create policy stories_delete on public.stories for delete to authenticated using (auth.uid() = user_id);

-- story_views
drop policy if exists storyviews_read   on public.story_views;
drop policy if exists storyviews_insert on public.story_views;
create policy storyviews_read on public.story_views for select to authenticated
  using (
    viewer_id = auth.uid()
    or exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid())
  );
create policy storyviews_insert on public.story_views for insert to authenticated
  with check (viewer_id = auth.uid());

-- reels
drop policy if exists reels_read   on public.reels;
drop policy if exists reels_insert on public.reels;
drop policy if exists reels_delete on public.reels;
create policy reels_read   on public.reels for select to authenticated using (true);
create policy reels_insert on public.reels for insert to authenticated with check (auth.uid() = user_id);
create policy reels_delete on public.reels for delete to authenticated using (auth.uid() = user_id);

-- reel_likes
drop policy if exists reellikes_read   on public.reel_likes;
drop policy if exists reellikes_insert on public.reel_likes;
drop policy if exists reellikes_delete on public.reel_likes;
create policy reellikes_read   on public.reel_likes for select to authenticated using (true);
create policy reellikes_insert on public.reel_likes for insert to authenticated with check (auth.uid() = user_id);
create policy reellikes_delete on public.reel_likes for delete to authenticated using (auth.uid() = user_id);

-- reel_comments
drop policy if exists reelcomments_read   on public.reel_comments;
drop policy if exists reelcomments_insert on public.reel_comments;
drop policy if exists reelcomments_delete on public.reel_comments;
create policy reelcomments_read   on public.reel_comments for select to authenticated using (true);
create policy reelcomments_insert on public.reel_comments for insert to authenticated with check (auth.uid() = user_id);
create policy reelcomments_delete on public.reel_comments for delete to authenticated using (auth.uid() = user_id);

-- messages: allow the RECEIVER to mark a message as read
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (auth.uid() = receiver_id) with check (auth.uid() = receiver_id);

-- --------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('stories','stories', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('reels','reels', true)     on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('chat','chat', true)       on conflict (id) do nothing;

drop policy if exists "stories public read" on storage.objects;
drop policy if exists "stories auth write"  on storage.objects;
drop policy if exists "reels public read"   on storage.objects;
drop policy if exists "reels auth write"    on storage.objects;
drop policy if exists "chat public read"    on storage.objects;
drop policy if exists "chat auth write"     on storage.objects;

create policy "stories public read" on storage.objects for select using (bucket_id = 'stories');
create policy "stories auth write"  on storage.objects for insert to authenticated with check (bucket_id = 'stories');
create policy "reels public read"   on storage.objects for select using (bucket_id = 'reels');
create policy "reels auth write"    on storage.objects for insert to authenticated with check (bucket_id = 'reels');
create policy "chat public read"    on storage.objects for select using (bucket_id = 'chat');
create policy "chat auth write"     on storage.objects for insert to authenticated with check (bucket_id = 'chat');

-- -------------------------------------------------------------- realtime
do $$ begin
  alter publication supabase_realtime add table public.stories;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.reels;
exception when duplicate_object then null; end $$;

-- done
