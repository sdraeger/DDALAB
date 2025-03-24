import pool from "./db/user-auth";

async function customAdapter() {
  return {
    async createUser(data) {
      const { rows } = await pool.query(
        "INSERT INTO users (name, email, password, email_verified, image) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [
          data.name,
          data.email,
          data.password || null,
          data.emailVerified,
          data.image,
        ]
      );
      return rows[0];
    },

    async getUser(id) {
      const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [
        id,
      ]);
      return rows[0] || null;
    },

    async getUserByEmail(email) {
      const { rows } = await pool.query(
        "SELECT * FROM users WHERE email = $1",
        [email]
      );
      return rows[0] || null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const { rows } = await pool.query(
        `SELECT u.* FROM users u
         JOIN accounts a ON u.id = a.user_id
         WHERE a.provider = $1 AND a.provider_account_id = $2`,
        [provider, providerAccountId]
      );
      return rows[0] || null;
    },

    async createSession(data) {
      const { rows } = await pool.query(
        "INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, $3) RETURNING *",
        [data.sessionToken, data.userId, data.expires]
      );
      return rows[0];
    },

    async getSessionAndUser(sessionToken) {
      const { rows } = await pool.query(
        `SELECT s.*, u.* FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.session_token = $1`,
        [sessionToken]
      );
      if (!rows[0]) return null;
      const { user_id, session_token, expires, ...user } = rows[0];
      return {
        session: { sessionToken: session_token, userId: user_id, expires },
        user,
      };
    },

    async updateSession(data) {
      const { rows } = await pool.query(
        "UPDATE sessions SET expires = $1 WHERE session_token = $2 RETURNING *",
        [data.expires, data.sessionToken]
      );
      return rows[0];
    },

    async deleteSession(sessionToken) {
      await pool.query("DELETE FROM sessions WHERE session_token = $1", [
        sessionToken,
      ]);
    },

    async linkAccount(data) {
      const { rows } = await pool.query(
        "INSERT INTO accounts (user_id, type, provider, provider_account_id, refresh_token, access_token, expires_at, token_type, scope, id_token, session_state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *",
        [
          data.userId,
          data.type,
          data.provider,
          data.providerAccountId,
          data.refresh_token,
          data.access_token,
          data.expires_at,
          data.token_type,
          data.scope,
          data.id_token,
          data.session_state,
        ]
      );
      return rows[0];
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await pool.query(
        "DELETE FROM accounts WHERE provider = $1 AND provider_account_id = $2",
        [provider, providerAccountId]
      );
    },

    async createVerificationToken(data) {
      const { rows } = await pool.query(
        "INSERT INTO verification_tokens (identifier, token, expires) VALUES ($1, $2, $3) RETURNING *",
        [data.identifier, data.token, data.expires]
      );
      return rows[0];
    },

    async useVerificationToken({ identifier, token }) {
      const { rows } = await pool.query(
        "DELETE FROM verification_tokens WHERE identifier = $1 AND token = $2 RETURNING *",
        [identifier, token]
      );
      return rows[0] || null;
    },
  };
}

export default customAdapter;
