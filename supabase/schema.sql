-- ===========================================================================
-- Khanimator pitch board — database schema
--
-- Run this once, whole, in the Supabase SQL editor:
--   Supabase dashboard → SQL Editor → New query → paste → Run
--
-- Everything the browser can do is controlled by the row-level security
-- policies below, NOT by the JavaScript. The anon key shipped in the page is
-- public by design; these policies are the actual security boundary, so read
-- them as if an attacker had a console open — because they do.
-- ===========================================================================


-- ------------------------------------------------------------------ admins
-- Moderators. Membership is granted by hand (see the INSERT at the bottom);
-- nothing in the app can add a row here.

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Deliberately no policies: with RLS on and no policy, the table is invisible
-- and unwritable from the browser entirely. Only the helper below reads it,
-- and that runs as definer.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;


-- ----------------------------------------------------------------- pitches

create table if not exists public.pitches (
  id            uuid primary key default gen_random_uuid(),
  body          text not null check (char_length(btrim(body)) between 3 and 100),
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 40),
  author_id     uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','building','done')),
  created_at    timestamptz not null default now()
);

create index if not exists pitches_status_created
  on public.pitches (status, created_at desc);

alter table public.pitches enable row level security;

-- Read: anything approved (or further along) is public. Authors can see their
-- own while it waits. Admins see everything.
create policy "pitches are public once approved"
  on public.pitches for select
  using (
    status in ('approved','building','done')
    or author_id = auth.uid()
    or public.is_admin()
  );

-- Write: signed-in only, as yourself, and ALWAYS pending. The WITH CHECK is
-- what stops someone inserting a pre-approved pitch straight onto the board.
create policy "signed-in users may submit a pending pitch"
  on public.pitches for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and status = 'pending'
  );

-- Only moderators change status. Authors cannot approve their own pitch.
create policy "only admins may moderate"
  on public.pitches for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "authors and admins may delete"
  on public.pitches for delete
  using (author_id = auth.uid() or public.is_admin());


-- Spam brake: five pitches per person per day. RLS cannot express a rate, so
-- this is a trigger.
create or replace function public.limit_pitch_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.pitches
   where author_id = new.author_id
     and created_at > now() - interval '1 day';

  if recent >= 5 then
    raise exception 'Five pitches a day is plenty. Try again tomorrow.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists pitches_rate_limit on public.pitches;
create trigger pitches_rate_limit
  before insert on public.pitches
  for each row execute function public.limit_pitch_rate();


-- ------------------------------------------------------------------- votes
-- The composite primary key IS the "one vote per person" rule. It is enforced
-- by the database, so no amount of fiddling in the browser gets a second vote
-- on the same pitch. Changing your mind is an UPDATE of the same row.

create table if not exists public.votes (
  pitch_id   uuid not null references public.pitches(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (pitch_id, user_id)
);

alter table public.votes enable row level security;

create policy "vote tallies are public"
  on public.votes for select
  using (true);

-- You may only vote as yourself, and only on a pitch that is actually live.
create policy "signed-in users may vote on live pitches"
  on public.votes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.pitches p
       where p.id = pitch_id
         and p.status in ('approved','building','done')
    )
  );

create policy "you may change your own vote"
  on public.votes for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "you may take your own vote back"
  on public.votes for delete
  using (user_id = auth.uid());


-- ----------------------------------------------------------------- replies
-- Replies skip moderation by design, so sign-in is required and they are
-- length-capped and rate-limited instead.

create table if not exists public.replies (
  id           uuid primary key default gen_random_uuid(),
  pitch_id     uuid not null references public.pitches(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  body         text not null check (char_length(btrim(body)) between 1 and 300),
  created_at   timestamptz not null default now()
);

create index if not exists replies_pitch_created
  on public.replies (pitch_id, created_at);

alter table public.replies enable row level security;

create policy "replies are visible on live pitches"
  on public.replies for select
  using (
    exists (
      select 1 from public.pitches p
       where p.id = pitch_id
         and p.status in ('approved','building','done')
    )
    or public.is_admin()
  );

create policy "signed-in users may reply to live pitches"
  on public.replies for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.pitches p
       where p.id = pitch_id
         and p.status in ('approved','building','done')
    )
  );

-- No UPDATE policy on purpose: a reply cannot be silently edited after people
-- have read it. Delete and repost instead.
create policy "authors and admins may delete replies"
  on public.replies for delete
  using (author_id = auth.uid() or public.is_admin());


create or replace function public.limit_reply_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.replies
   where author_id = new.author_id
     and created_at > now() - interval '5 minutes';

  if recent >= 10 then
    raise exception 'Slow down a moment.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists replies_rate_limit on public.replies;
create trigger replies_rate_limit
  before insert on public.replies
  for each row execute function public.limit_reply_rate();


-- ------------------------------------------------------------------- board
-- One query for the whole board: pitch, score, reply count. security_invoker
-- makes the view obey the caller's RLS rather than the view owner's, so the
-- moderation rules above still apply through it.

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


-- ===========================================================================
-- LAST STEP — make Moiz a moderator.
--
-- He must sign in to the site with Google once first, so that Supabase
-- creates his auth user. Then run:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'muizkhan2802@gmail.com'
--   on conflict do nothing;
--
-- Check it worked:
--   select u.email from public.admins a join auth.users u on u.id = a.user_id;
-- ===========================================================================
