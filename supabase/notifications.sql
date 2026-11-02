-- ===========================================================================
-- Khanimator pitch board — notifications
--
-- Run AFTER schema.sql and admin.sql.
--
-- Rows are written only by triggers running as SECURITY DEFINER. There is no
-- INSERT policy, so nobody can send a notification to anybody — you cannot
-- spam another user's bell by posting to the API.
-- ===========================================================================


create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('reply','pitch_status','new_pitch')),
  title      text not null,
  body       text,
  pitch_id   uuid references public.pitches(id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_inbox
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "read your own notifications"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "mark your own as read"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "clear your own"
  on public.notifications for delete
  using (user_id = auth.uid());

-- No INSERT policy on purpose: only the triggers below create notifications.


-- ------------------------------------------- someone replied to you ------

create or replace function public.notify_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pitch_author uuid;
  pitch_text   text;
begin
  select author_id, body into pitch_author, pitch_text
    from public.pitches where id = new.pitch_id;

  -- Replying to yourself should not ping you.
  if pitch_author is not null and pitch_author <> new.author_id then
    insert into public.notifications (user_id, kind, title, body, pitch_id)
    values (pitch_author, 'reply',
            new.display_name || ' replied to your pitch',
            left(new.body, 140), new.pitch_id);
  end if;

  return new;
end;
$$;

drop trigger if exists replies_notify on public.replies;
create trigger replies_notify
  after insert on public.replies
  for each row execute function public.notify_on_reply();


-- ------------------------------------------- a pitch needs approval ------

create or replace function public.notify_admins_new_pitch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, kind, title, body, pitch_id)
  select a.user_id, 'new_pitch',
         'New pitch waiting for approval',
         left(new.body, 140), new.id
    from public.admins a
   where a.user_id <> new.author_id;   -- a moderator's own pitch needs no ping

  return new;
end;
$$;

drop trigger if exists pitches_notify_admins on public.pitches;
create trigger pitches_notify_admins
  after insert on public.pitches
  for each row execute function public.notify_admins_new_pitch();


-- -------------------------------------------- your pitch moved on -------

create or replace function public.notify_on_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare headline text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  headline := case new.status
    when 'approved' then 'Your pitch is on the board'
    when 'rejected' then 'Your pitch was not taken up'
    when 'building' then 'Your pitch is in production'
    when 'done'     then 'Your pitch has been animated'
    else 'Your pitch changed status'
  end;

  insert into public.notifications (user_id, kind, title, body, pitch_id)
  values (new.author_id, 'pitch_status', headline, left(new.body, 140), new.id);

  return new;
end;
$$;

drop trigger if exists pitches_notify_author on public.pitches;
create trigger pitches_notify_author
  after update on public.pitches
  for each row execute function public.notify_on_status();


-- ---------------------------------------------------------- helpers ------

create or replace function public.unread_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications
   where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_all_read()
returns void language sql security definer set search_path = public as $$
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.unread_count()  from public, anon;
revoke all on function public.mark_all_read() from public, anon;
grant execute on function public.unread_count()  to authenticated;
grant execute on function public.mark_all_read() to authenticated;


-- ------------------------------------------------------ board view -------
-- Replaced to expose author_id, so the page can show a "Delete" control on
-- your own pitch. RLS still decides whether the delete is allowed; this only
-- governs whether the button is drawn.
--
-- Safe to run on an existing project: a view holds no data of its own.

-- Dropped first, not replaced: CREATE OR REPLACE VIEW can only append
-- columns to the end of an existing view, so adding author_id in the
-- middle fails with 42P16. Nothing depends on this view but the client,
-- which queries it by column name.
drop view if exists public.board;

create view public.board
with (security_invoker = on)
as
  select
    p.id,
    p.body,
    p.display_name,
    p.author_id,
    p.status,
    p.created_at,
    coalesce(v.score, 0)::int   as score,
    coalesce(v.votes, 0)::int   as votes,
    coalesce(r.replies, 0)::int as replies
  from public.pitches p
  left join (
    select pitch_id, sum(value) as score, count(*) as votes
      from public.votes group by pitch_id
  ) v on v.pitch_id = p.id
  left join (
    select pitch_id, count(*) as replies
      from public.replies group by pitch_id
  ) r on r.pitch_id = p.id;
