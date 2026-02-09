-- Add institution_id to users for institution-level access control
ALTER TABLE users ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id);

-- Create index for institution member lookups
CREATE INDEX IF NOT EXISTS idx_users_institution ON users(institution_id) WHERE institution_id IS NOT NULL;
