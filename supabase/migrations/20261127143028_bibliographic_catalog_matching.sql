-- Bibliographic catalog matching and document-type review.
alter table public.documents
  add column if not exists metadata_match_status text not null default 'unmatched',
  add column if not exists metadata_confidence smallint,
  add column if not exists metadata_candidate jsonb,
  add column if not exists document_kind text not null default 'unknown',
  add column if not exists metadata_checked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_metadata_match_status_check') then
    alter table public.documents add constraint documents_metadata_match_status_check
      check (metadata_match_status in ('matched','review','unmatched','non_book','duplicate'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_document_kind_check') then
    alter table public.documents add constraint documents_document_kind_check
      check (document_kind in ('book','academic','article','music_score','periodical','manual','reference','other','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_metadata_confidence_check') then
    alter table public.documents add constraint documents_metadata_confidence_check
      check (metadata_confidence is null or metadata_confidence between 0 and 100);
  end if;
end $$;

create index if not exists documents_metadata_review_queue_idx
  on public.documents (metadata_match_status, metadata_confidence desc, created_at)
  where provider = 'r2' and metadata_reviewed = false;
