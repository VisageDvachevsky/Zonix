CREATE TABLE IF NOT EXISTS api_tokens (
    token_id TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    token_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_tokens_username_idx ON api_tokens (username);
