-- Federation invite tokens for establishing trust
CREATE TABLE IF NOT EXISTS federation_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    to_institution_id UUID,
    to_institution_name TEXT,
    invite_token TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

-- Federation trust relationships (bidirectional)
CREATE TABLE IF NOT EXISTS federation_trusts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_a UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    institution_b UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    trust_level TEXT NOT NULL DEFAULT 'full' CHECK (trust_level IN ('full', 'read_only', 'revoked')),
    established_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    established_by UUID NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    UNIQUE(institution_a, institution_b),
    CHECK (institution_a < institution_b)  -- Enforce ordering to prevent duplicates
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_federation_invites_token ON federation_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_federation_invites_from ON federation_invites(from_institution_id);
CREATE INDEX IF NOT EXISTS idx_federation_trusts_institutions ON federation_trusts(institution_a, institution_b);
