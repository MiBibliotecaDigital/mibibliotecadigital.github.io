create or replace function private.admin_list_profiles()
returns table(
 id uuid,full_name text,username text,email text,role public.app_role,status text,created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
 if auth.uid() is null or not exists(
  select 1 from public.profiles actor
  where actor.id=auth.uid() and actor.role='admin'::public.app_role and actor.status='active'
 ) then
  raise exception 'Administrator permission required' using errcode='42501';
 end if;
 return query
 select p.id,p.full_name,p.username,coalesce(u.email,'')::text,p.role,p.status,p.created_at
 from public.profiles p
 join auth.users u on u.id=p.id
 order by p.created_at desc;
end;
$$;
