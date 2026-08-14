-- DeskOS — spatial desktop schema.
--
-- Mirrors the runtime model in Assets/Scripts/DeskOSUI.ts:
--   * a folder owns files; a file may be reassigned to another folder
--   * desk placement (pinned / grouped / offsets) is user state, so it lives
--     alongside the content rather than in a separate table
--   * text documents keep their body inline; media lives in Storage and the
--     row only carries the path

create table if not exists desk_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug       text not null,
  title      text not null,
  subtitle   text not null default '',
  pos_x      double precision not null default 0,
  pos_y      double precision not null default 0,
  sort_index integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table if not exists desk_files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id    uuid references desk_folders(id) on delete set null,
  kind         text not null check (kind in ('text','image','video','audio')),
  name         text not null,
  meta         text not null default '',
  -- documents only
  body         text,
  -- media only: object path inside the 'deskos' bucket
  storage_path text,
  -- desk placement, straight off ContentHandles
  pinned       boolean          not null default false,
  grouped      boolean          not null default true,
  offset_x     double precision not null default 0,
  offset_y     double precision not null default 0,
  rest_x       double precision not null default 0,
  rest_y       double precision not null default 0,
  created_at   timestamptz      not null default now(),
  updated_at   timestamptz      not null default now()
);

create index if not exists desk_files_folder_idx on desk_files (user_id, folder_id);

alter table desk_folders enable row level security;
alter table desk_files   enable row level security;

create policy "own folders" on desk_folders
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own files" on desk_files
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Media bucket. Public read keeps image/audio/video fetches simple; writes stay
-- scoped to the uploading user by the policies below.
insert into storage.buckets (id, name, public)
  values ('deskos', 'deskos', true)
  on conflict do nothing;

create policy "deskos public read" on storage.objects
  for select using (bucket_id = 'deskos');
create policy "deskos auth upload" on storage.objects
  for insert with check (bucket_id = 'deskos' and auth.role() = 'authenticated');
create policy "deskos own delete" on storage.objects
  for delete using (bucket_id = 'deskos' and auth.uid()::text = (storage.foldername(name))[2]);
