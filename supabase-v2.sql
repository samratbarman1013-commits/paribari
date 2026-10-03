-- =====================================================================
--  PariBari v2 — schema upgrade (run AFTER supabase-schema.sql and supabase-upgrade.sql)
--  Adds: carousel / video posts, comment likes + replies, story highlights,
--        Notes, and DM reactions / replies / shared posts.
--  Paste the whole file into Supabase -> SQL Editor -> New query -> Run.
--  Safe to run once. It only ADDS things; it never deletes your data.
-- =====================================================================

-- ================================================== POST MEDIA (carousel)
create table if not exists public.post_media (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  position    int  not null default 0,
  url         text not null,
  media_type  text not null default 'image',        -- image | video
  created_at  timestamptz default now()
);
create index if not exists post_media_post_idx on public.post_media(post_id, position);

-- give every existing single-photo post one media row
insert into public.post_media (post_id, position, url, media_type)
select p.id, 0, p.image_url, 'image'
from public.posts p
where not exists (select 1 from public.post_media m where m.post_id = p.id);

-- ============================================== COMMENT LIKES + REPLIES
alter table public.comments
  add column if not exists parent_id uuid references public.comments(id) on delete cascade;

create table if not exists public.comment_likes (
  comment_id  uuid references public.comments(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (comment_id, user_id)
);

-- ======================================================== HIGHLIGHTS
create table if not exists public.highlights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null default 'Highlight',
  cover_url   text,
  created_at  timestamptz default now()
);
create index if not exists highlights_user_idx on public.highlights(user_id, created_at desc);

create table if not exists public.highlight_items (
  id            uuid primary key default gen_random_uuid(),
  highlight_id  uuid not null references public.highlights(id) on delete cascade,
  media_url     text not null,
  media_type    text not null default 'image',
  caption       text default '',
  position      int  not null default 0,
  created_at    timestamptz default now()
);
create index if not exists highlight_items_idx on public.highlight_items(highlight_id, position);

-- ============================================================= NOTES
create table if not exists public.notes (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz default now(),
  expires_at  timestamptz default (now() + interval '24 hours')
);

-- ================================================== DM UPGRADES
alter table public.messages add column if not exists reply_to        uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists shared_post_id  uuid references public.posts(id) on delete set null;

create table if not exists public.message_reactions (
  message_id  uuid references public.messages(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz default now(),
  primary key (message_id, user_id)
);

-- =================================================================== RLS
alter table public.post_media        enable row level security;
alter table public.comment_likes     enable row level security;
alter table public.highlights        enable row level security;
alter table public.highlight_items   enable row level security;
alter table public.notes             enable row level security;
alter table public.message_reactions enable row level security;

-- post_media
drop policy if exists postmedia_read   on public.post_media;
drop policy if exists postmedia_insert on public.post_media;
drop policy if exists postmedia_delete on public.post_media;
create policy postmedia_read   on public.post_media for select to authenticated using (true);
create policy postmedia_insert on public.post_media for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
create policy postmedia_delete on public.post_media for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));

-- comment_likes
drop policy if exists commentlikes_read   on public.comment_likes;
drop policy if exists commentlikes_insert on public.comment_likes;
drop policy if exists commentlikes_delete on public.comment_likes;
create policy commentlikes_read   on public.comment_likes for select to authenticated using (true);
create policy commentlikes_insert on public.comment_likes for insert to authenticated with check (auth.uid() = user_id);
create policy commentlikes_delete on public.comment_likes for delete to authenticated using (auth.uid() = user_id);

-- highlights
drop policy if exists highlights_read   on public.highlights;
drop policy if exists highlights_insert on public.highlights;
drop policy if exists highlights_update on public.highlights;
drop policy if exists highlights_delete on public.highlights;
create policy highlights_read   on public.highlights for select to authenticated using (true);
create policy highlights_insert on public.highlights for insert to authenticated with check (auth.uid() = user_id);
create policy highlights_update on public.highlights for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy highlights_delete on public.highlights for delete to authenticated using (auth.uid() = user_id);

-- highlight_items
drop policy if exists hitems_read   on public.highlight_items;
drop policy if exists hitems_insert on public.highlight_items;
drop policy if exists hitems_delete on public.highlight_items;
create policy hitems_read   on public.highlight_items for select to authenticated using (true);
create policy hitems_insert on public.highlight_items for insert to authenticated
  with check (exists (select 1 from public.highlights h where h.id = highlight_id and h.user_id = auth.uid()));
create policy hitems_delete on public.highlight_items for delete to authenticated
  using (exists (select 1 from public.highlights h where h.id = highlight_id and h.user_id = auth.uid()));

-- notes
drop policy if exists notes_read   on public.notes;
drop policy if exists notes_upsert on public.notes;
drop policy if exists notes_update on public.notes;
drop policy if exists notes_delete on public.notes;
create policy notes_read   on public.notes for select to authenticated using (true);
create policy notes_upsert on public.notes for insert to authenticated with check (auth.uid() = user_id);
create policy notes_update on public.notes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy notes_delete on public.notes for delete to authenticated using (auth.uid() = user_id);

-- message_reactions
drop policy if exists msgreactions_read   on public.message_reactions;
drop policy if exists msgreactions_insert on public.message_reactions;
drop policy if exists msgreactions_update on public.message_reactions;
drop policy if exists msgreactions_delete on public.message_reactions;
create policy msgreactions_read   on public.message_reactions for select to authenticated using (true);
create policy msgreactions_insert on public.message_reactions for insert to authenticated with check (auth.uid() = user_id);
create policy msgreactions_update on public.message_reactions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy msgreactions_delete on public.message_reactions for delete to authenticated using (auth.uid() = user_id);

-- =============================================================== storage
insert into storage.buckets (id, name, public) values ('highlights','highlights', true) on conflict (id) do nothing;

drop policy if exists "highlights public read" on storage.objects;
drop policy if exists "highlights auth write"  on storage.objects;
create policy "highlights public read" on storage.objects for select using (bucket_id = 'highlights');
create policy "highlights auth write"  on storage.objects for insert to authenticated with check (bucket_id = 'highlights');

-- ============================================================== realtime
do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;

-- done
