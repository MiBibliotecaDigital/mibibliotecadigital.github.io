create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create or replace function private.current_app_role()
returns public.app_role language sql stable security definer
set search_path = '' set row_security = off
as $$ select p.role from public.profiles p where p.id=(select auth.uid()) and p.status='active' limit 1 $$;
create or replace function private.is_active_user()
returns boolean language sql stable security definer
set search_path = '' set row_security = off
as $$ select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active') $$;
create or replace function private.can_read_document(p_document_id uuid)
returns boolean language sql stable security definer
set search_path = '' set row_security = off
as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active'
 and (p.role in ('admin','editor')
 or not exists(select 1 from public.document_grants g where g.document_id=p_document_id)
 or exists(select 1 from public.document_grants g where g.document_id=p_document_id and g.user_id=(select auth.uid()))))
$$;
revoke all on function private.current_app_role() from public,anon,authenticated;
revoke all on function private.is_active_user() from public,anon,authenticated;
revoke all on function private.can_read_document(uuid) from public,anon,authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.can_read_document(uuid) to authenticated;

drop policy if exists profile_read on public.profiles;
drop policy if exists profile_self_update on public.profiles;
drop policy if exists collection_read on public.collections;
drop policy if exists collection_edit on public.collections;
drop policy if exists document_read on public.documents;
drop policy if exists document_edit on public.documents;
drop policy if exists grants_read on public.document_grants;
drop policy if exists grants_admin on public.document_grants;
drop policy if exists events_read on public.reading_events;
drop policy if exists events_insert on public.reading_events;
drop function if exists public.current_app_role();
drop function if exists public.is_active_user();
revoke all on function public.new_profile() from public,anon,authenticated,service_role;
revoke all on function public.rls_auto_enable() from public,anon,authenticated,service_role;

create policy profile_read on public.profiles for select to authenticated using (id=(select auth.uid()) or (select private.current_app_role())='admin');
create policy profile_self_update on public.profiles for update to authenticated using (id=(select auth.uid()) and (select private.is_active_user())) with check (id=(select auth.uid()) and (select private.is_active_user()));
revoke update on public.profiles from authenticated;
grant update(full_name) on public.profiles to authenticated;

create policy collection_read on public.collections for select to authenticated using ((select private.is_active_user()));
create policy collection_insert on public.collections for insert to authenticated with check ((select private.current_app_role()) in ('admin','editor'));
create policy collection_update on public.collections for update to authenticated using ((select private.current_app_role()) in ('admin','editor')) with check ((select private.current_app_role()) in ('admin','editor'));
create policy collection_delete on public.collections for delete to authenticated using ((select private.current_app_role()) in ('admin','editor'));

create policy document_read on public.documents for select to authenticated using ((is_published or (select private.current_app_role()) in ('admin','editor')) and (select private.can_read_document(id)));
create policy document_insert on public.documents for insert to authenticated with check ((select private.current_app_role()) in ('admin','editor'));
create policy document_update on public.documents for update to authenticated using ((select private.current_app_role()) in ('admin','editor')) with check ((select private.current_app_role()) in ('admin','editor'));
create policy document_delete on public.documents for delete to authenticated using ((select private.current_app_role()) in ('admin','editor'));

create policy grants_read on public.document_grants for select to authenticated using (user_id=(select auth.uid()) or (select private.current_app_role())='admin');
create policy grants_admin_insert on public.document_grants for insert to authenticated with check ((select private.current_app_role())='admin');
create policy grants_admin_update on public.document_grants for update to authenticated using ((select private.current_app_role())='admin') with check ((select private.current_app_role())='admin');
create policy grants_admin_delete on public.document_grants for delete to authenticated using ((select private.current_app_role())='admin');

create policy events_read on public.reading_events for select to authenticated using (user_id=(select auth.uid()) or (select private.current_app_role())='admin');
create policy events_insert on public.reading_events for insert to authenticated with check (user_id=(select auth.uid()) and (select private.is_active_user()));

create index if not exists document_grants_user_id_idx on public.document_grants(user_id);
create index if not exists documents_collection_id_idx on public.documents(collection_id);
create index if not exists reading_events_document_id_idx on public.reading_events(document_id);
create index if not exists reading_events_user_id_idx on public.reading_events(user_id);
