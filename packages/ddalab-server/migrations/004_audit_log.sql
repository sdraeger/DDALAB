-- Audit log for compliance tracking
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    institution_id UUID NOT NULL REFERENCES institutions(id),
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('view', 'download', 'share', 'revoke', 'access_denied')),
    share_id TEXT,
    content_type TEXT,
    content_id TEXT,
    source_ip INET,
    user_agent TEXT,
    metadata JSONB
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_share ON audit_log(share_id, timestamp DESC) WHERE share_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_institution ON audit_log(institution_id, timestamp DESC);
