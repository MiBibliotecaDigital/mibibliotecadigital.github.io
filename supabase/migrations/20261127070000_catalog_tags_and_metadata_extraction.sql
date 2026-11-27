alter table public.documents
  add column if not exists tags text[] not null default '{}',
  add column if not exists isbn text,
  add column if not exists publisher text,
  add column if not exists metadata_source text not null default 'filename',
  add column if not exists metadata_reviewed boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.documents'::regclass
      and conname='documents_metadata_source_check'
  ) then
    alter table public.documents
      add constraint documents_metadata_source_check
      check(metadata_source in ('filename','embedded','pdf_text','manual'));
  end if;
end $$;

create index if not exists documents_tags_gin_idx
  on public.documents using gin(tags);
create index if not exists documents_publication_year_idx
  on public.documents(publication_year);
create index if not exists documents_page_count_idx
  on public.documents(page_count);
