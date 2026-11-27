-- Harden profile updates: authenticated users may edit their display name only.
-- Role and status changes must be performed by a trusted administrator function.
revoke update on table public.profiles from authenticated;
grant update (full_name) on table public.profiles to authenticated;

drop policy if exists profile_self_update on public.profiles;
create policy profile_self_update
on public.profiles
for update
to authenticated
using (id = auth.uid() and public.is_active_user())
with check (id = auth.uid() and public.is_active_user());
