ALTER TABLE identity_providers
    ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE identity_providers
    ADD COLUMN IF NOT EXISTS client_secret TEXT;

ALTER TABLE identity_providers
    ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE identity_providers
    ADD COLUMN IF NOT EXISTS claims_mapping_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE identity_providers
SET client_id = ''
WHERE client_id IS NULL;

UPDATE identity_providers
SET client_secret = ''
WHERE client_secret IS NULL;

ALTER TABLE identity_providers
    ALTER COLUMN client_id SET NOT NULL;

ALTER TABLE identity_providers
    ALTER COLUMN client_secret SET NOT NULL;
