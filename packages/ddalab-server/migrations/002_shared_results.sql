CREATE TABLE IF NOT EXISTS shared_results (
    share_token TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    result_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    access_policy JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shared_results_owner
    ON shared_results(owner_user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
    session_id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    encryption_key_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at);
