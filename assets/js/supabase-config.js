/* ==========================================================================
   Supabase connection details for the pitch board.

   FILL THESE IN after creating the Supabase project. Both values live in
   Supabase under Project Settings -> API.

   The anon key is MEANT to be public — it identifies the project, it does not
   grant access. Every permission is enforced by the row-level security
   policies in supabase/schema.sql. Never paste the `service_role` key here;
   that one bypasses RLS entirely and would hand the database to anyone who
   views source.

   While these stay empty the board falls back to read-only: the page renders,
   explains that sign-in is not configured yet, and hides the controls.
   ========================================================================== */

window.KHANIMATOR_SUPABASE = {
  url: "",      // e.g. https://abcdefghijklm.supabase.co
  anonKey: ""   // the long public "anon" / "publishable" key
};
