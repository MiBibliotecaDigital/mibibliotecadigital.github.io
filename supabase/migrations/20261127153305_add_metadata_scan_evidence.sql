alter table public.documents
  add column if not exists metadata_evidence jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_metadata_evidence_object_check'
  ) then
    alter table public.documents
      add constraint documents_metadata_evidence_object_check
      check (jsonb_typeof(metadata_evidence) = 'object');
  end if;
end $$;
