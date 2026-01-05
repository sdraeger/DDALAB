-- Institution configuration table
CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    hipaa_mode BOOLEAN NOT NULL DEFAULT true,
    default_share_expiry_days INTEGER NOT NULL DEFAULT 30,
    allow_federation BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create a default institution for existing data
INSERT INTO institutions (id, name, hipaa_mode, default_share_expiry_days, allow_federation)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Institution', false, 30, false)
ON CONFLICT DO NOTHING;

-- Add institution_id to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'institution_id'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN institution_id UUID REFERENCES institutions(id)
        DEFAULT '00000000-0000-0000-0000-000000000001';
    END IF;
END $$;

-- Add classification to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'classification'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN classification TEXT NOT NULL DEFAULT 'unclassified';
    END IF;
END $$;

-- Add expires_at to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days');
    END IF;
END $$;

-- Add download_count to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'download_count'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Create index for institution lookups
CREATE INDEX IF NOT EXISTS idx_shared_results_institution
    ON shared_results(institution_id) WHERE revoked_at IS NULL;

-- Create index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_shared_results_expires
    ON shared_results(expires_at) WHERE revoked_at IS NULL;
