-- Idempotent correction of the administrator profile RPC's return record.
create or replace function private.admin_manage_profile(
 p_user_id uuid,p_full_name text,p_username text,p_role text,p_status text,p_update_username boolean default true
) returns jsonb language plpgsql security definer set search_path = '' set row_security = off as $$
declare
 v_actor uuid:=auth.uid(); v_target public.profiles%rowtype; v_role public.app_role;
 v_username text; v_status text; v_admin_count bigint;
begin
 if v_actor is null or not exists(select 1 from public.profiles p where p.id=v_actor and p.role='admin'::public.app_role and p.status='active') then
  raise exception 'Administrator permission required' using errcode='42501';
 end if;
 select * into v_target from public.profiles p where p.id=p_user_id for update;
 if not found then raise exception 'User profile not found' using errcode='P0002'; end if;
 if p_role is not null then
  if p_role not in ('admin','editor','reader') then raise exception 'Invalid role'; end if;
  v_role:=p_role::public.app_role;
 else v_role:=v_target.role; end if;
 if p_status is not null then
  if p_status not in ('active','suspended') then raise exception 'Invalid status'; end if;
  v_status:=p_status;
 else v_status:=v_target.status; end if;
 if p_update_username then
  v_username:=nullif(lower(btrim(coalesce(p_username,''))),'');
  if v_username is not null and v_username !~ '^[a-z0-9._-]{3,32}$' then raise exception 'Username inválido: usá 3–32 caracteres (letras, números, punto, guion o guion bajo).'; end if;
 else v_username:=v_target.username; end if;
 if v_target.id=v_actor and (v_role<>'admin'::public.app_role or v_status<>'active') then raise exception 'No podés quitarte tu propio acceso de administrador.'; end if;
 if v_target.role='admin'::public.app_role and v_target.status='active' and (v_role<>'admin'::public.app_role or v_status<>'active') then
  select count(*) into v_admin_count from public.profiles p where p.role='admin'::public.app_role and p.status='active';
  if v_admin_count<=1 then raise exception 'No se puede desactivar al último administrador activo.'; end if;
 end if;
 update public.profiles set full_name=coalesce(nullif(btrim(coalesce(p_full_name,'')),''),full_name),username=v_username,role=v_role,status=v_status where id=p_user_id;
 select * into v_target from public.profiles p where p.id=p_user_id;
 return to_jsonb(v_target);
end; $$;
