-- Create users table with secure schema for credential storage
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,                   -- Unique identifier for each user
    username VARCHAR(255) UNIQUE NOT NULL,   -- Username, unique to prevent duplicates
    password_hash CHAR(60) NOT NULL,         -- Fixed-length bcrypt hash (60 chars)
    email VARCHAR(255) UNIQUE,               -- Optional: for recovery or verification
    first_name VARCHAR(100),                 -- User's first name
    last_name VARCHAR(100),                  -- User's last name
    is_active BOOLEAN DEFAULT TRUE,          -- Account status
    is_admin BOOLEAN DEFAULT FALSE,          -- Admin privileges
    last_login TIMESTAMP,                    -- Track last login time
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Track account creation
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Track updates
    invite_code_id INTEGER REFERENCES invite_codes(id) -- Track which invite code was used
);

-- Create index on username for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Create user tokens table for API authentication
CREATE TABLE IF NOT EXISTS user_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    description VARCHAR(255),                -- Purpose of the token (e.g., "API access", "Mobile app")
    last_used_at TIMESTAMP,                  -- Track last usage
    expires_at TIMESTAMP,                    -- Token expiration
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on token for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_tokens_token ON user_tokens(token);

-- Create index on user_id for faster lookups when getting all tokens for a user
CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id ON user_tokens(user_id);

-- Create password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(100) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user refresh tokens table for JWT refresh
CREATE TABLE IF NOT EXISTS user_refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create invite codes table
CREATE TABLE IF NOT EXISTS invite_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,       -- Unique invite code
    email VARCHAR(255),                     -- Optional: pre-assigned to specific email
    created_by INTEGER REFERENCES users(id), -- Who created this code (optional)
    max_uses INTEGER DEFAULT 1,             -- How many times this code can be used
    uses INTEGER DEFAULT 0,                 -- Current use count
    expires_at TIMESTAMP,                   -- Optional expiration date
    is_active BOOLEAN DEFAULT TRUE,         -- Whether this code is active
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on invite code for faster lookups
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);

-- Comments explaining security requirements
COMMENT ON TABLE users IS 'Stores user credentials with bcrypt password hashing';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password - NEVER store plain text passwords';
COMMENT ON TABLE user_tokens IS 'Stores API access tokens for authenticated users';
COMMENT ON TABLE password_reset_tokens IS 'Stores temporary password reset tokens';
COMMENT ON TABLE user_refresh_tokens IS 'Stores JWT refresh tokens';
COMMENT ON TABLE invite_codes IS 'Stores registration invite codes';
COMMENT ON COLUMN invite_codes.code IS 'Unique invite code string';
COMMENT ON COLUMN invite_codes.max_uses IS 'Maximum number of times this code can be used (default: 1 for single-use)';
COMMENT ON COLUMN invite_codes.uses IS 'Number of times this code has been used'; 