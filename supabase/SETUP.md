# Pitch board — Supabase setup

The board needs a database and a sign-in provider. Everything on the site side
is already built; this is the twenty minutes of account setup that only you can
do, because it involves creating accounts and accepting terms.

Until step 5 is done the board stays in read-only mode: the page renders, says
it isn't connected, and hides the controls. Nothing is broken in the meantime.

---

## 1. Create the Supabase project

1. Sign up at **supabase.com** — use **Moiz's** Google account, same reasoning
   as the domain. Free tier is ample: 500 MB database, 50,000 monthly users.
2. **New project**. Name it `khanimator`. Choose the region closest to most of
   his audience. Save the database password somewhere safe — you will not need
   it for this, but losing it is annoying later.
3. Wait for it to finish provisioning (~2 minutes).

## 2. Create the tables

1. **SQL Editor → New query**
2. Paste the entire contents of `supabase/schema.sql` and **Run**.
3. It should finish with no errors. It creates four tables (`pitches`,
   `votes`, `replies`, `admins`), a `board` view, two rate-limit triggers and
   all the row-level security policies.

**Do not skip this or write your own tables.** The anon key is public by
design — those policies are the only thing standing between the board and
anyone with a browser console.

## 3. Turn on Google sign-in

You need a Google OAuth client, then you paste it into Supabase.

**In Supabase first,** to get the value Google needs:

- **Authentication → Sign In / Providers → Google** → enable it
- Copy the **Callback URL** shown there. It looks like
  `https://<project>.supabase.co/auth/v1/callback`

**Then in Google Cloud Console** (console.cloud.google.com):

- Create a project (or reuse one)
- **APIs & Services → OAuth consent screen** → External → fill in app name,
  support email and developer email → Save
- **APIs & Services → Credentials → Create credentials → OAuth client ID**
  - Application type: **Web application**
  - **Authorised JavaScript origins:** your site origin — the Netlify URL for
    now (`https://khanimator.netlify.app`), plus the real domain once it exists
  - **Authorised redirect URIs:** the Supabase callback URL you copied
- Copy the **Client ID** and **Client secret**

**Back in Supabase:** paste both into the Google provider and save.

> While the consent screen is in "Testing", only accounts you list as test
> users can sign in. Publish it when you are ready for the public — Google
> does not require verification for basic profile and email scopes.

## 4. Tell the site where the project is

- **Project Settings → API**
- Copy the **Project URL** and the **anon / publishable** key

Send me both and I will fill them into `assets/js/supabase-config.js`, or edit
that file yourself — it is two strings.

**Never put the `service_role` key there.** It bypasses every security policy
and would hand the whole database to anyone who views source.

## 5. Make Moiz a moderator

He has to sign in to the live site with Google **once** first, so Supabase
creates his user record. Then, in the SQL editor:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'muizkhan2802@gmail.com'
on conflict do nothing;
```

Confirm it took:

```sql
select u.email from public.admins a join auth.users u on u.id = a.user_id;
```

---

## Approving pitches

Use the dashboard: **`/admin.html`** on the live site.

It is not linked from the public nav and carries `noindex`, but neither of
those is what protects it — an ordinary signed-in visitor who finds the URL
sees "Not a moderator" and gets empty results, because the RLS policies refuse
them. Bookmark it.

The dashboard gives you counts, a filterable queue with Approve / Reject /
Mark in production / Mark animated / Delete, and the access log.

Statuses: `pending` → `approved` puts it on the board; `rejected` hides it for
good; `building` shows an "In production" chip; `done` shows "Animated".

You also get an email per new pitch through the Netlify form, so nothing
depends on you watching the queue.

## The access log

Everything on the board that matters is recorded: pitches submitted, every
status change with its before and after, deletions of pitches and replies, and
sign-ins by signed-in users.

It is written by database triggers running as `SECURITY DEFINER`, and the
table has **no insert, update or delete policy at all**. So a moderator cannot
approve something and then quietly erase the record — not through the site,
not through the console. Only moderators can read it.

**What it deliberately does not record:** IP addresses, user agents, or
anything about visitors who are not signed in. That would make it a
surveillance log of his audience rather than a record of actions taken on the
board, and it would pull real privacy obligations onto a fan site. If you do
want visitor analytics, that is a separate decision — use a privacy-preserving
analytics tool rather than rolling it into this table.

Sign-in rows are advisory rather than authoritative: they are written by the
page when a signed-in session loads, collapse to one per hour, and a blocked
script means no row. Moderation rows are the opposite — those come from the
database and cannot be missed or forged.

## What is enforced where

| Rule | Enforced by |
|---|---|
| One vote per person per pitch | Composite primary key `(pitch_id, user_id)` |
| Pitches start pending | RLS `WITH CHECK (status = 'pending')` on insert |
| Only moderators approve | RLS update policy calling `is_admin()` |
| 100-character pitches | Column `CHECK` constraint, plus `maxlength` in the form |
| Sign-in to pitch, vote or reply | Policies granted `TO authenticated` only |
| Replies cannot be edited after posting | No UPDATE policy exists on `replies` |
| 5 pitches/day, 10 replies/5 min | Triggers `limit_pitch_rate`, `limit_reply_rate` |

None of these live in the JavaScript. The browser code is a convenience layer;
the database is what actually says no.
