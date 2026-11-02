/* ==========================================================================
   Supabase connection details for the pitch board.

   The anon key below is PUBLIC BY DESIGN. It identifies the project; it
   grants nothing on its own. Every permission is enforced by the row-level
   security policies in supabase/schema.sql and supabase/admin.sql — verified
   against this project: an anonymous caller reads the audit log as [], and
   inserts to pitches and votes are refused with 42501.

   Never put the `service_role` key here. That one bypasses RLS entirely and
   would hand the database to anyone who views source.

   To rotate these, see Project Settings -> API in the Supabase dashboard.
   ========================================================================== */

window.KHANIMATOR_SUPABASE = {
  url: "https://omemruyeqtzxrpcreqny.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tZW1ydXllcXR6eHJwY3JlcW55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1OTgzOTYsImV4cCI6MjEwOTE3NDM5Nn0.Dj3I10aYFEgN7wlxutfoDmQouTCbzNU3WV4WFOwqWNU"
};
