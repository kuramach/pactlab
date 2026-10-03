-- Runtime login role for the API and workers. It owns nothing, cannot bypass
-- RLS and holds no privileges until it assumes `pactlab_app` per transaction.
-- `pactlab_app` itself is created (idempotently) by the RLS migration.
CREATE ROLE pactlab_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE pactlab_api LOGIN PASSWORD 'pactlab_api_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
GRANT pactlab_app TO pactlab_api;
