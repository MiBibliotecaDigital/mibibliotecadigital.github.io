alter table public.documents
  add column if not exists bibliographic_identifiers jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_bibliographic_identifiers_array_check'
  ) then
    alter table public.documents
      add constraint documents_bibliographic_identifiers_array_check
      check (jsonb_typeof(bibliographic_identifiers) = 'array');
  end if;
end $$;

create index if not exists documents_bibliographic_identifiers_gin_idx
  on public.documents using gin (bibliographic_identifiers);
