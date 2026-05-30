create extension if not exists pgcrypto;

create table if not exists public.posters (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('poster', 'graffiti', 'text', 'image', 'image_text')),
  text text,
  image_url text,
  color text,
  contact text not null,
  angle double precision not null,
  y double precision not null,
  width double precision not null default 1.35,
  height double precision not null default 1.25,
  staples jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint poster_has_content check (
    (type = 'poster' and text is not null)
    or (type = 'graffiti' and image_url is not null)
    or (type = 'text' and text is not null and image_url is null)
    or (type = 'image' and image_url is not null)
    or (type = 'image_text' and text is not null and image_url is not null)
  )
);

alter table public.posters
  add column if not exists color text;

alter table public.posters
  add column if not exists contact text;

update public.posters
set contact = '@unknown'
where contact is null or btrim(contact) = '';

alter table public.posters
  alter column contact set default '@unknown';

alter table public.posters
  alter column contact set not null;

alter table public.posters
  add column if not exists staples jsonb not null default '[]'::jsonb;

alter table public.posters
  drop constraint if exists posters_type_check;

alter table public.posters
  add constraint posters_type_check
  check (type in ('poster', 'graffiti', 'text', 'image', 'image_text'));

alter table public.posters
  drop constraint if exists poster_has_content;

alter table public.posters
  drop constraint if exists poster_has_contact;

alter table public.posters
  add constraint poster_has_content
  check (
    (type = 'poster' and text is not null)
    or (type = 'graffiti' and image_url is not null)
    or (type = 'text' and text is not null and image_url is null)
    or (type = 'image' and image_url is not null)
    or (type = 'image_text' and text is not null and image_url is not null)
  );

alter table public.posters
  add constraint poster_has_contact
  check (length(btrim(contact)) > 0);

alter table public.posters enable row level security;

alter table public.posters replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'posters'
  ) then
    alter publication supabase_realtime add table public.posters;
  end if;
end
$$;

drop policy if exists "Anyone can read posters" on public.posters;
create policy "Anyone can read posters"
  on public.posters for select
  using (true);

drop policy if exists "Anyone can create posters" on public.posters;
create policy "Anyone can create posters"
  on public.posters for insert
  with check (true);

insert into storage.buckets (id, name, public)
values ('poster-images', 'poster-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Anyone can view poster images" on storage.objects;
create policy "Anyone can view poster images"
  on storage.objects for select
  using (bucket_id = 'poster-images');

drop policy if exists "Anyone can upload poster images" on storage.objects;
create policy "Anyone can upload poster images"
  on storage.objects for insert
  with check (bucket_id = 'poster-images');
