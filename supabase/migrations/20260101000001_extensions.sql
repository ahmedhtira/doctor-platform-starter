-- M1: required extensions.
-- gen_random_uuid() is built into Postgres 17 core, no extension needed.
-- btree_gist is required for the exclusion constraint that prevents
-- overlapping confirmed appointments per doctor (appointments migration).
create extension if not exists btree_gist with schema extensions;
