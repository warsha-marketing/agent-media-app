-- Self-hosted storage tables can exist without service_role table grants.
-- BYPASSRLS alone does not grant table access: signed uploads then fail with
-- SQLSTATE 42501, which storage-api reports as a row-level security error.
-- Keep the existing private buckets and user ownership policies intact.
GRANT SELECT ON storage.buckets TO service_role;
GRANT SELECT, INSERT, UPDATE ON storage.objects TO service_role;
-- Signed read URLs are requested with the user's JWT; the existing SELECT
-- policy restricts generation-inputs reads to that user's folder.
GRANT SELECT ON storage.objects TO authenticated;
