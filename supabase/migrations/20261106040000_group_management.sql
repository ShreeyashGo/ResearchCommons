-- Group management: owner-only invite rotation, member removal, role changes,
-- and a leave flow that never strands a group without an owner.
-- All membership deletes now go through these RPCs.

drop policy if exists memberships_delete on public.group_memberships;

create or replace function public.rotate_invite_code(p_group_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_group_owner(p_group_id) then
    raise exception 'only group owners can do that' using errcode = '42501';
  end if;
  update public.research_groups
     set invite_code = encode(extensions.gen_random_bytes(6), 'hex')
   where id = p_group_id
  returning invite_code into v_code;
  return v_code;
end $$;

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform 1 from public.research_groups where id = p_group_id for update;
  if not public.is_group_owner(p_group_id) then
    raise exception 'only group owners can do that' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'use leave_group to leave a group' using errcode = '22023';
  end if;
  delete from public.group_memberships
   where group_id = p_group_id and user_id = p_user_id;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.set_group_member_role(
  p_group_id uuid, p_user_id uuid, p_role public.group_role
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current public.group_role;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform 1 from public.research_groups where id = p_group_id for update;
  if not public.is_group_owner(p_group_id) then
    raise exception 'only group owners can do that' using errcode = '42501';
  end if;
  select role into v_current from public.group_memberships
   where group_id = p_group_id and user_id = p_user_id;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if v_current = 'owner' and p_role = 'member' and (
    select count(*) from public.group_memberships
     where group_id = p_group_id and role = 'owner'
  ) = 1 then
    raise exception 'a group needs at least one owner' using errcode = '23514';
  end if;
  update public.group_memberships set role = p_role
   where group_id = p_group_id and user_id = p_user_id;
end $$;

create or replace function public.leave_group(p_group_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.group_role;
  v_members int;
  v_owners int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform 1 from public.research_groups where id = p_group_id for update;
  select role into v_role from public.group_memberships
   where group_id = p_group_id and user_id = v_uid;
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  select count(*), count(*) filter (where role = 'owner')
    into v_members, v_owners
    from public.group_memberships where group_id = p_group_id;
  if v_members = 1 then
    delete from public.research_groups where id = p_group_id;
    return 'deleted';
  end if;
  if v_role = 'owner' and v_owners = 1 then
    raise exception 'make another member an owner before leaving' using errcode = '23514';
  end if;
  delete from public.group_memberships where group_id = p_group_id and user_id = v_uid;
  return 'left';
end $$;

-- Share-lock the group row so a concurrent last-member leave_group (which takes
-- FOR UPDATE on it) either finishes first or waits for this join to commit.
create or replace function public.join_group(p_invite_code text)
returns public.research_groups language plpgsql security definer set search_path = '' as $$
declare
  g public.research_groups;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into g from public.research_groups
   where invite_code = lower(trim(p_invite_code))
   for share;
  if not found then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;
  insert into public.group_memberships (group_id, user_id, role)
  values (g.id, (select auth.uid()), 'member')
  on conflict (group_id, user_id) do nothing;
  return g;
end $$;

revoke all on function public.rotate_invite_code(uuid),
  public.remove_group_member(uuid, uuid),
  public.set_group_member_role(uuid, uuid, public.group_role),
  public.leave_group(uuid) from public, anon;
grant execute on function public.rotate_invite_code(uuid),
  public.remove_group_member(uuid, uuid),
  public.set_group_member_role(uuid, uuid, public.group_role),
  public.leave_group(uuid) to authenticated;
