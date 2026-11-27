create or replace function public.username_login_lookup(p_username text,p_key_hash text)
returns table(allowed boolean,email text)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
 v_attempts integer;
 v_email text;
 v_username text:=lower(btrim(coalesce(p_username,'')));
begin
 if v_username !~ '^[a-z0-9._-]{3,32}$' or p_key_hash !~ '^[0-9a-f]{64}$' then
  return query select false,null::text;
  return;
 end if;

 insert into private.username_login_attempts(key_hash,window_started_at,attempts,updated_at)
 values(p_key_hash,now(),1,now())
 on conflict(key_hash) do update
 set attempts=case
      when private.username_login_attempts.window_started_at < now()-interval '15 minutes' then 1
      else private.username_login_attempts.attempts+1
     end,
     window_started_at=case
      when private.username_login_attempts.window_started_at < now()-interval '15 minutes' then now()
      else private.username_login_attempts.window_started_at
     end,
     updated_at=now()
 returning attempts into v_attempts;

 if v_attempts > 8 then
  return query select false,null::text;
  return;
 end if;

 select u.email into v_email
 from public.profiles p
 join auth.users u on u.id=p.id
 where lower(p.username)=v_username and p.status='active'
 limit 1;

 return query select true,v_email;
end;
$$;

revoke all on function public.username_login_lookup(text,text) from public,anon,authenticated;
grant execute on function public.username_login_lookup(text,text) to anon,authenticated;
