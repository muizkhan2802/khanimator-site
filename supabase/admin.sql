-- ===========================================================================
-- Khanimator pitch board — moderation audit log
--
-- Run AFTER schema.sql, in the same way:
--   Supabase dashboard → SQL Editor → New query → paste → Run
--
-- The log is written by triggers running as SECURITY DEFINER, not by the
-- browser. That is the point: a moderator cannot approve something and then
-- quietly delete the record of having done it, because the client has no
-- INSERT or DELETE rights on this table at all.
-- ===========================================================================


create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  target_type text,
  target_id   uuid,
  detail      text
);

create index if not exists audit_log_at on public.audit_log (at desc);

alter table public.audit_log enable row level security;

-- Readable by moderators only. Deliberately NO insert, update or delete
-- policy, so the log is append-only from the database's side and untouchable
-- from the browser.
create policy "only moderators read the log"
  on public.audit_log for select
  using (public.is_admin());


-- -------------------------------------------------------- who did it -----

create or replace function public.actor_email()
returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '(unknown)');
$$;


-- ------------------------------------------------- pitch moderation ------

create or replace function public.log_pitch_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.audit_log
        (actor_id, actor_email, action, target_type, target_id, detail)
      values
        (auth.uid(), public.actor_email(),
         old.status || ' → ' || new.status,
         'pitch', new.id, left(new.body, 70));
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (actor_id, actor_email, action, target_type, target_id, detail)
    values
      (auth.uid(), public.actor_email(),
       'deleted pitch', 'pitch', old.id, left(old.body, 70));
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists pitches_audit on public.pitches;
create trigger pitches_audit
  after update or delete on public.pitches
  for each row execute function public.log_pitch_change();


-- --------------------------------------------------- new submissions -----

create or replace function public.log_pitch_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (actor_id, actor_email, action, target_type, target_id, detail)
  values
    (new.author_id, public.actor_email(),
     'pitched', 'pitch', new.id, left(new.body, 70));
  return new;
end;
$$;

drop trigger if exists pitches_audit_insert on public.pitches;
create trigger pitches_audit_insert
  after insert on public.pitches
  for each row execute function public.log_pitch_insert();


-- ------------------------------------------------------ reply deletes ----

create or replace function public.log_reply_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (actor_id, actor_email, action, target_type, target_id, detail)
  values
    (auth.uid(), public.actor_email(),
     'deleted reply', 'reply', old.id, left(old.body, 70));
  return old;
end;
$$;

drop trigger if exists replies_audit on public.replies;
create trigger replies_audit
  after delete on public.replies
  for each row execute function public.log_reply_delete();


-- ---------------------------------------------------------- sign-ins -----
-- Called by the page after a session appears. Advisory rather than
-- authoritative: it records that a signed-in user loaded the site, not every
-- authentication event, and a blocked script means no row. Repeats inside an
-- hour collapse so the log stays readable.
--
-- No IP address and no user agent is stored. See SETUP.md for why.

create or replace function public.record_sign_in()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if exists (
    select 1 from public.audit_log
     where actor_id = auth.uid()
       and action = 'signed in'
       and at > now() - interval '1 hour'
  ) then
    return;
  end if;

  insert into public.audit_log (actor_id, actor_email, action)
  values (auth.uid(), public.actor_email(), 'signed in');
end;
$$;

revoke all on function public.record_sign_in() from public, anon;
grant execute on function public.record_sign_in() to authenticated;


-- ------------------------------------------------------------ counts -----
-- One round trip for the dashboard tiles. Moderators only — the function
-- checks is_admin() itself rather than trusting the caller.

create or replace function public.board_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare result json;
begin
  if not public.is_admin() then
    raise exception 'not a moderator' using errcode = 'insufficient_privilege';
  end if;

  select json_build_object(
    'pending',  (select count(*) from public.pitches where status = 'pending'),
    'approved', (select count(*) from public.pitches where status = 'approved'),
    'building', (select count(*) from public.pitches where status = 'building'),
    'done',     (select count(*) from public.pitches where status = 'done'),
    'rejected', (select count(*) from public.pitches where status = 'rejected'),
    'replies',  (select count(*) from public.replies),
    'votes',    (select count(*) from public.votes),
    'people',   (select count(distinct author_id) from public.pitches)
  ) into result;

  return result;
end;
$$;

revoke all on function public.board_stats() from public, anon;
grant execute on function public.board_stats() to authenticated;
