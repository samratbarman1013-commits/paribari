-- =====================================================================
--  PariBari — Supabase schema
--  Paste this whole file into:  Supabase dashboard -> SQL Editor -> New query -> Run
--  It is safe to run once on a fresh project. Re-running is mostly idempotent.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  name        text,
  bio         text default '',
  avatar_url  text,
  created_at  timestamptz default now()
);

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  image_url   text not null,
  caption     text default '',
  location    text default '',
  created_at  timestamptz default now()
);

create table if not exists public.likes (
  post_id     uuid references public.posts(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references public.posts(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz default now()
);

create table if not exists public.follows (
  follower_id  uuid references public.profiles(id) on delete cascade,
  following_id uuid references public.profiles(id) on delete cascade,
  created_at   timestamptz default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.saves (
  post_id     uuid references public.posts(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (post_id, user_id)
);

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid references public.profiles(id) on delete cascade,
  receiver_id  uuid references public.profiles(id) on delete cascade,
  body         text not null,
  created_at   timestamptz default now()
);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,   -- who receives it
  actor_id    uuid references public.profiles(id) on delete cascade,   -- who caused it
  type        text not null,                                           -- like | comment | follow | message
  post_id     uuid references public.posts(id) on delete cascade,
  read        boolean default false,
  created_at  timestamptz default now()
);

create index if not exists posts_created_idx      on public.posts(created_at desc);
create index if not exists comments_post_idx      on public.comments(post_id, created_at);
create index if not exists messages_pair_idx      on public.messages(sender_id, receiver_id, created_at);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ------------------------------------------------- auto-create profile row
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base  text;
  final text;
  i     int := 0;
begin
  base := regexp_replace(
            lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1))),
            '[^a-z0-9_]', '', 'g');
  if base is null or base = '' then base := 'user'; end if;
  final := base;
  while exists (select 1 from public.profiles where username = final) loop
    i := i + 1;
    final := base || i::text;
  end loop;

  insert into public.profiles (id, username, name, avatar_url)
  values (new.id, final,
          coalesce(new.raw_user_meta_data->>'name', final),
          null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------- RLS
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.likes         enable row level security;
alter table public.comments      enable row level security;
alter table public.follows       enable row level security;
alter table public.saves         enable row level security;
alter table public.messages      enable row level security;
alter table public.notifications enable row level security;

-- profiles
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy profiles_update on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- posts
drop policy if exists posts_read   on public.posts;
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_update on public.posts;
drop policy if exists posts_delete on public.posts;
create policy posts_read   on public.posts for select to authenticated using (true);
create policy posts_insert on public.posts for insert to authenticated with check (auth.uid() = user_id);
create policy posts_update on public.posts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy posts_delete on public.posts for delete to authenticated using (auth.uid() = user_id);

-- likes
drop policy if exists likes_read   on public.likes;
drop policy if exists likes_insert on public.likes;
drop policy if exists likes_delete on public.likes;
create policy likes_read   on public.likes for select to authenticated using (true);
create policy likes_insert on public.likes for insert to authenticated with check (auth.uid() = user_id);
create policy likes_delete on public.likes for delete to authenticated using (auth.uid() = user_id);

-- comments
drop policy if exists comments_read   on public.comments;
drop policy if exists comments_insert on public.comments;
drop policy if exists comments_delete on public.comments;
create policy comments_read   on public.comments for select to authenticated using (true);
create policy comments_insert on public.comments for insert to authenticated with check (auth.uid() = user_id);
create policy comments_delete on public.comments for delete to authenticated using (auth.uid() = user_id);

-- follows
drop policy if exists follows_read   on public.follows;
drop policy if exists follows_insert on public.follows;
drop policy if exists follows_delete on public.follows;
create policy follows_read   on public.follows for select to authenticated using (true);
create policy follows_insert on public.follows for insert to authenticated with check (auth.uid() = follower_id);
create policy follows_delete on public.follows for delete to authenticated using (auth.uid() = follower_id);

-- saves
drop policy if exists saves_read   on public.saves;
drop policy if exists saves_insert on public.saves;
drop policy if exists saves_delete on public.saves;
create policy saves_read   on public.saves for select to authenticated using (auth.uid() = user_id);
create policy saves_insert on public.saves for insert to authenticated with check (auth.uid() = user_id);
create policy saves_delete on public.saves for delete to authenticated using (auth.uid() = user_id);

-- messages
drop policy if exists messages_read   on public.messages;
drop policy if exists messages_insert on public.messages;
create policy messages_read   on public.messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy messages_insert on public.messages for insert to authenticated
  with check (auth.uid() = sender_id);

-- notifications
drop policy if exists notif_read   on public.notifications;
drop policy if exists notif_insert on public.notifications;
drop policy if exists notif_update on public.notifications;
create policy notif_read   on public.notifications for select to authenticated using (auth.uid() = user_id);
create policy notif_insert on public.notifications for insert to authenticated with check (auth.uid() = actor_id);
create policy notif_update on public.notifications for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('avatars','avatars', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('posts','posts', true)
  on conflict (id) do nothing;

drop policy if exists "avatars public read"  on storage.objects;
drop policy if exists "avatars auth write"   on storage.objects;
drop policy if exists "avatars auth update"  on storage.objects;
drop policy if exists "posts public read"    on storage.objects;
drop policy if exists "posts auth write"     on storage.objects;
drop policy if exists "posts auth update"    on storage.objects;

create policy "avatars public read" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars auth write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');
create policy "avatars auth update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars');

create policy "posts public read" on storage.objects for select
  using (bucket_id = 'posts');
create policy "posts auth write" on storage.objects for insert to authenticated
  with check (bucket_id = 'posts');
create policy "posts auth update" on storage.objects for update to authenticated
  using (bucket_id = 'posts');

-- ------------------------------------------------------------- realtime
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- done
