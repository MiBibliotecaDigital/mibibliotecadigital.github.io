-- Durable PDF upload reservations and a separately retryable metadata queue.
alter table public.documents
  add column if not exists upload_status text not null default 'stored',
  add column if not exists metadata_status text not null default 'pending',
  add column if not exists metadata_error text,
  add column if not exists original_filename text,
  add column if not exists uploaded_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_upload_status_check') then
    alter table public.documents add constraint documents_upload_status_check
      check (upload_status in ('uploading','stored','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_metadata_status_check') then
    alter table public.documents add constraint documents_metadata_status_check
      check (metadata_status in ('pending','processing','complete','partial','error'));
  end if;
end $$;

update public.documents
set upload_status = 'stored',
    metadata_status = case
      when metadata_reviewed then 'complete'
      when provider = 'demo' then 'complete'
      when metadata_source in ('pdf_text','pdf+isbn','manual') then 'complete'
      else 'pending'
    end,
    metadata_error = null
where upload_status is distinct from 'stored'
   or metadata_status is distinct from case
      when metadata_reviewed then 'complete'
      when provider = 'demo' then 'complete'
      when metadata_source in ('pdf_text','pdf+isbn','manual') then 'complete'
      else 'pending'
   end;

create index if not exists documents_metadata_queue_idx
  on public.documents (metadata_status, created_at)
  where provider = 'r2' and metadata_reviewed = false;

create index if not exists documents_upload_recovery_idx
  on public.documents (upload_status, created_at)
  where provider = 'r2';

create unique index if not exists documents_r2_key_unique_idx
  on public.documents (r2_key)
  where provider = 'r2' and r2_key is not null;
