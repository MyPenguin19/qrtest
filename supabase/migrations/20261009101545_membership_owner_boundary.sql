-- Database-only role boundary hotfix. No existing memberships/data are rewritten.
-- Use membership authority, never an owner_id value editable by a Manager.
create function public.is_restaurant_owner(target_restaurant_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
   select 1 from public.restaurant_members m
   where m.restaurant_id=target_restaurant_id and m.user_id=auth.uid() and m.role='owner'
 );
$$;
revoke all on function public.is_restaurant_owner(uuid) from public,anon,service_role;
grant execute on function public.is_restaurant_owner(uuid) to authenticated;

-- Both old and new rows must be within the caller's management boundary.
-- The separate self-owner bootstrap policy remains intact for onboarding.
alter policy restaurant_members_manage on public.restaurant_members to authenticated
 using (public.is_restaurant_owner(restaurant_id) or
   (public.is_restaurant_manager(restaurant_id) and role not in ('owner','manager')))
 with check (public.is_restaurant_owner(restaurant_id) or
   (public.is_restaurant_manager(restaurant_id) and role not in ('owner','manager')));

-- Preserve staff directory reads while matching the existing manage_staff RPC:
-- Managers handle operational staff, but cannot create/edit linked Manager accounts.
create policy staff_manager_read on public.staff for select to authenticated
 using (public.is_restaurant_manager(restaurant_id));
alter policy staff_manager_manage on public.staff to authenticated
 using (public.is_restaurant_owner(restaurant_id) or
   (public.is_restaurant_manager(restaurant_id) and role not in ('owner','manager') and manager_user_id is null))
 with check (public.is_restaurant_owner(restaurant_id) or
   (public.is_restaurant_manager(restaurant_id) and role not in ('owner','manager') and manager_user_id is null));

-- Close owner_id -> bootstrap and delete/recreate takeovers. Normal settings
-- updates and new self-owned restaurant inserts are unchanged. Trusted server
-- and SQL operator operations retain their existing permissions.
create function platform_private.protect_restaurant_ownership() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('anon','authenticated') then
   if TG_OP='DELETE' or new.owner_id is distinct from old.owner_id then
     if not public.is_restaurant_owner(old.id) then
       raise exception 'Only an Owner can change restaurant ownership or delete the restaurant.' using errcode='42501';
     end if;
   end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function platform_private.protect_restaurant_ownership() from public,anon,authenticated,service_role;
create trigger protect_restaurant_ownership before update or delete on public.restaurants
 for each row execute function platform_private.protect_restaurant_ownership();
