-- service_role bypasses RLS (bypassrls) but that's independent of the
-- GRANT system — this CLI version's local default (auto_expose_new_tables
-- unset/off, see supabase/config.toml) does not implicitly grant table
-- privileges to service_role any more than it does to anon/authenticated.
-- Every privileged function already has its own explicit EXECUTE grant to
-- service_role; this covers direct table access (used by the trusted
-- server layer and by the test fixtures acting as an admin).
grant all privileges on all tables in schema public to service_role;
alter default privileges in schema public grant all privileges on tables to service_role;
