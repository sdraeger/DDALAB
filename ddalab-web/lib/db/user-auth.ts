/**
 * User Authentication Module
 *
 * Provides functions for user credential management and authentication
 * using PostgreSQL and bcrypt for secure password handling.
 */
import { Pool } from "pg";
import { hash, compare } from "bcrypt";
import { randomBytes } from "crypto";
import axios from "axios";
import { getEnvVar } from "../utils/env";
import * as jwt from "jsonwebtoken";
import { DEFAULT_USER_PREFERENCES } from "@/contexts/settings-context";

interface UserData {
  username: string;
  password: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface InviteCodeOptions {
  createdBy?: number;
  email?: string;
  maxUses?: number;
  expiresAt?: Date;
}

interface DirectusRole {
  id: string;
  name: string;
}

interface DirectusError {
  response?: {
    data?: any;
    status?: number;
  };
  message: string;
}

interface DirectusUserData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

// Initialize database connection pool
const pool = new Pool({
  host: getEnvVar("DB_HOST"),
  port: parseInt(getEnvVar("DB_PORT")),
  database: getEnvVar("DB_NAME"),
  user: getEnvVar("DB_USER"),
  password: getEnvVar("DB_PASSWORD"),
  // Auto-reconnection and connection limiting
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds if connection could not be established
});

// Log connection errors for debugging
pool.on("error", (err: Error) => {
  console.error("Unexpected database connection error:", err);
});

// Add JWT configuration to match the server
const JWT_SECRET_KEY = getEnvVar("JWT_SECRET_KEY");
const JWT_ALGORITHM = getEnvVar("JWT_ALGORITHM");

/**
 * Get Directus admin credentials and authenticate
 * @returns {Promise<string>} Directus admin token
 */
async function getDirectusAdminToken(): Promise<string> {
  const directusUrl = getEnvVar("DIRECTUS_URL");
  const directusEmail = getEnvVar("DIRECTUS_EMAIL");
  const directusPassword = getEnvVar("DIRECTUS_PASSWORD");

  try {
    const response = await axios.post(`${directusUrl}/auth/login`, {
      email: directusEmail,
      password: directusPassword,
    });

    return response.data.data.access_token;
  } catch (error: unknown) {
    const directusError = error as DirectusError;
    console.error(
      "Failed to authenticate with Directus:",
      directusError.response?.data || directusError.message
    );
    throw new Error("Failed to authenticate with Directus");
  }
}

/**
 * Get the Directus Public role ID
 * @param {string} adminToken - Directus admin token
 * @returns {Promise<string>} Public role ID
 */
async function getDirectusPublicRoleId(adminToken: string): Promise<string> {
  const directusUrl = getEnvVar("DIRECTUS_URL", "http://localhost:8055");

  try {
    const response = await axios.get(`${directusUrl}/roles`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    const publicRole = response.data.data.find(
      (role: DirectusRole) => role.name.toLowerCase() === "public"
    );

    if (!publicRole) {
      throw new Error("Public role not found in Directus");
    }

    return publicRole.id;
  } catch (error: unknown) {
    const directusError = error as DirectusError;
    console.error(
      "Failed to fetch Directus roles:",
      directusError.response?.data || directusError.message
    );
    throw new Error("Failed to fetch Directus roles");
  }
}

/**
 * Create a user in Directus
 * @param {Object} userData - User data (username, password, email, etc.)
 * @param {string} adminToken - Directus admin token
 * @returns {Promise<Object>} Created Directus user
 */
async function createDirectusUser(
  userData: DirectusUserData,
  adminToken: string
): Promise<any> {
  const directusUrl = getEnvVar("DIRECTUS_URL", "http://localhost:8055");

  try {
    console.log(
      `Attempting to create Directus user for email: ${userData.email}`
    );

    // Get the Public role ID
    console.log("Fetching Directus public role ID...");
    const publicRoleId = await getDirectusPublicRoleId(adminToken);
    console.log(`Got Directus public role ID: ${publicRoleId}`);

    // Prepare user data for Directus
    const directusUserData = {
      email: userData.email,
      password: userData.password,
      first_name: userData.firstName || "",
      last_name: userData.lastName || "",
      role: publicRoleId,
      status: "active",
      provider: "default",
    };
    console.log("Sending user creation request to Directus...");

    // Create user in Directus
    const response = await axios.post(
      `${directusUrl}/users`,
      directusUserData,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }
    );

    console.log("Directus user creation successful:", response.data.data?.id);
    return response.data.data;
  } catch (error: unknown) {
    const directusError = error as DirectusError;
    console.error("Failed to create Directus user:");
    console.error("- Error message:", directusError.message);
    console.error("- Status code:", directusError.response?.status);
    console.error(
      "- Response data:",
      JSON.stringify(directusError.response?.data || {})
    );
    console.error("- Directus URL:", directusUrl);
    console.error("- User data (partial):", {
      email: userData.email,
      first_name: userData.firstName,
      last_name: userData.lastName,
    });
    throw new Error("Failed to create Directus user");
  }
}

/**
 * User Authentication API
 */
const userAuth = {
  /**
   * Generate a new invite code
   * @param {Object} options - Options for the invite code
   * @param {number} [options.createdBy] - User ID who created this code
   * @param {string} [options.email] - Pre-assign to specific email
   * @param {number} [options.maxUses=1] - Maximum number of uses
   * @param {Date} [options.expiresAt] - Expiration date
   * @returns {Promise<Object>} - Created invite code
   */
  async createInviteCode(options: InviteCodeOptions = {}) {
    const { createdBy, email, maxUses = 1, expiresAt } = options;

    // Generate a random code
    const code = randomBytes(16).toString("hex");

    const query = `
      INSERT INTO invite_codes 
        (code, email, created_by, max_uses, expires_at)
      VALUES 
        ($1, $2, $3, $4, $5)
      RETURNING id, code, email, max_uses, expires_at, created_at
    `;

    const result = await pool.query(query, [
      code,
      email || null,
      createdBy || null,
      maxUses,
      expiresAt || null,
    ]);

    return result.rows[0];
  },

  /**
   * Validate an invite code
   * @param {string} code - Invite code to validate
   * @param {string} [email] - Optional email to validate against
   * @returns {Promise<Object|null>} - Invite code details if valid, null otherwise
   */
  async validateInviteCode(code: string, email: string | null = null) {
    const query = `
      SELECT id, code, email, max_uses, uses, expires_at, is_active
      FROM invite_codes
      WHERE code = $1
        AND is_active = true
        AND (max_uses > uses OR max_uses = -1)
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;

    const result = await pool.query(query, [code]);

    if (result.rows.length === 0) {
      return {
        valid: false,
        message: "Invalid or expired invite code",
      };
    }

    const inviteCode = result.rows[0];

    // If the code is restricted to a specific email and an email is provided, check it
    if (inviteCode.email && email && inviteCode.email !== email) {
      return {
        valid: false,
        message: "This invite code is for a different email address",
      };
    }

    // If the code is restricted to a specific email but no email is provided
    if (inviteCode.email && !email) {
      return {
        valid: true,
        message: "Invite code is valid but requires a specific email",
        email: inviteCode.email,
      };
    }

    return {
      valid: true,
      message: "Invite code is valid",
      email: inviteCode.email || null,
    };
  },

  /**
   * Register a new user with an invite code
   * @param {Object} userData - User information
   * @param {string} userData.username - Username
   * @param {string} userData.password - Password
   * @param {string} userData.email - Email
   * @param {string} userData.firstName - First name (optional)
   * @param {string} userData.lastName - Last name (optional)
   * @param {string} inviteCode - Invite code
   * @returns {Promise<Object>} - Newly created user (without password)
   */
  async registerWithInviteCode(userData: UserData, inviteCode: string) {
    const { username, password, email, firstName, lastName } = userData;

    console.log("Registering user with invite code:", {
      username,
      email,
      inviteCode,
      hasFirstName: !!firstName,
      hasLastName: !!lastName,
    });

    // Start a database transaction
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Validate the invite code
      const codeQuery = `
        SELECT id, code, email, max_uses, uses
        FROM invite_codes
        WHERE code = $1
          AND is_active = true
          AND (max_uses > uses OR max_uses = -1)
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        FOR UPDATE
      `;

      const codeResult = await client.query(codeQuery, [inviteCode]);

      if (codeResult.rows.length === 0) {
        throw new Error("Invalid, expired, or already used invite code");
      }

      const code = codeResult.rows[0];

      // If the code is assigned to a specific email, verify it matches
      if (code.email && code.email !== email) {
        throw new Error("Invite code is assigned to a different email address");
      }

      // Hash password with bcrypt before storing
      const saltRounds = 12;
      const passwordHash = await hash(password, saltRounds);

      // Insert user into PostgreSQL database
      // Note: invite_code_id column is defined in the schema but may not exist in all database deployments
      const query = `
        INSERT INTO users 
          (username, password_hash, email, first_name, last_name) 
        VALUES 
          ($1, $2, $3, $4, $5)
        RETURNING id, username, email, first_name, last_name, created_at
      `;

      const result = await client.query(query, [
        username,
        passwordHash,
        email,
        firstName || null,
        lastName || null,
      ]);

      // Increment the usage count for the invite code
      await client.query(
        "UPDATE invite_codes SET uses = uses + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [code.id]
      );

      const newUser = result.rows[0];

      // Create the same user in Directus (optional)
      try {
        // Get admin token
        const adminToken = await getDirectusAdminToken();

        // Create user in Directus
        const directusUserData: DirectusUserData = {
          email,
          password,
          firstName,
          lastName,
        };
        await createDirectusUser(directusUserData, adminToken);

        console.log(
          "User successfully created in both PostgreSQL and Directus"
        );
      } catch (directusError) {
        // Log Directus error but don't fail the registration
        console.error(
          "Warning: User created in database but failed to create in Directus:",
          directusError
        );
        console.log("Continuing with registration despite Directus error");
      }

      // Commit the transaction regardless of Directus result
      await client.query("COMMIT");

      return newUser;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Register a new user (for backward compatibility, doesn't require invite code)
   * @param {Object} userData - User information (username, password, email, etc.)
   * @returns {Promise<Object>} - Newly created user (without password)
   */
  async registerUser(userData: UserData) {
    const { username, password, email, firstName, lastName } = userData;

    // Start a database transaction
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Hash password with bcrypt before storing
      const saltRounds = 12; // Higher for more security, but slower
      const passwordHash = await hash(password, saltRounds);

      // Insert user into PostgreSQL database
      const query = `
        INSERT INTO users 
          (username, password_hash, email, first_name, last_name) 
        VALUES 
          ($1, $2, $3, $4, $5)
        RETURNING id, username, email, first_name, last_name, created_at
      `;

      const result = await client.query(query, [
        username,
        passwordHash,
        email,
        firstName || null,
        lastName || null,
      ]);

      const newUser = result.rows[0];

      // Create the same user in Directus (optional)
      try {
        // Get admin token
        const adminToken = await getDirectusAdminToken();

        // Create user in Directus
        const directusUserData: DirectusUserData = {
          email,
          password,
          firstName,
          lastName,
        };
        await createDirectusUser(directusUserData, adminToken);

        console.log(
          "User successfully created in both PostgreSQL and Directus"
        );
      } catch (directusError) {
        // Log Directus error but don't fail the registration
        console.error(
          "Warning: User created in database but failed to create in Directus:",
          directusError
        );
        console.log("Continuing with registration despite Directus error");
      }

      // Commit the transaction regardless of Directus result
      await client.query("COMMIT");

      return newUser;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Authenticate a user with username and password
   * @param {string} username - Username to authenticate
   * @param {string} password - Password to verify
   * @returns {Promise<Object|null>} - User object if authenticated, null otherwise
   */
  async authenticateUser(username: string, password: string) {
    // Query to get user with password
    const query = `
      SELECT u.id, u.username, u.email, u.password_hash,
             u.first_name, u.last_name, u.is_admin,
             up.theme, up.session_expiration, up.eeg_zoom_factor
      FROM users u
      LEFT JOIN user_preferences up ON u.id = up.user_id
      WHERE u.username = $1
        AND u.is_active = true
    `;

    const result = await pool.query(query, [username]);

    if (result.rows.length === 0) {
      return null; // User not found
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await compare(password, user.password_hash);
    if (!isValid) {
      return null; // Password incorrect
    }

    // Remove password_hash from user object
    const { password_hash, ...safeUser } = user;

    // Format preferences
    const preferences = {
      theme: safeUser.theme || DEFAULT_USER_PREFERENCES.theme,
      sessionExpiration:
        safeUser.session_expiration ||
        DEFAULT_USER_PREFERENCES.sessionExpiration,
      eegZoomFactor:
        safeUser.eeg_zoom_factor || DEFAULT_USER_PREFERENCES.eegZoomFactor,
    };

    // Remove individual preference fields
    const { theme, session_expiration, eeg_zoom_factor, ...userWithoutPrefs } =
      safeUser;

    // Return user with formatted preferences
    return {
      ...userWithoutPrefs,
      preferences,
    };
  },

  /**
   * Generate an API token for a user
   * @param {number} userId - User ID to create token for
   * @param {string} description - Optional token description
   * @param {number} expiresInDays - Days until token expires (optional, default: 30)
   * @returns {Promise<Object>} - Created token object
   */
  async createUserToken(
    userId: number,
    description: string = "API Access",
    expiresInDays: number = 30
  ) {
    // Get the user's username for the JWT payload
    const userResult = await pool.query(
      "SELECT username FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error("User not found");
    }

    const username = userResult.rows[0].username;

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create JWT payload to match the format used by the API server
    const jwtPayload = {
      sub: username, // 'sub' is the standard JWT claim for subject (username)
      exp: Math.floor(expiresAt.getTime() / 1000), // Expiration time in seconds
    };

    // Generate JWT token using the same algorithm and secret as the API server
    const token = jwt.sign(jwtPayload, JWT_SECRET_KEY, {
      algorithm: JWT_ALGORITHM,
    });

    // Store the token in the database
    const query = `
      INSERT INTO user_tokens 
        (user_id, token, description, expires_at)
      VALUES 
        ($1, $2, $3, $4)
      RETURNING id, token, description, expires_at, created_at
    `;

    const result = await pool.query(query, [
      userId,
      token,
      description,
      expiresAt,
    ]);

    return result.rows[0];
  },

  /**
   * Validate a user token
   * @param {string} token - Token to validate
   * @returns {Promise<Object|null>} - User object if token is valid, null otherwise
   */
  async validateToken(token: string) {
    // Check if token exists and hasn't expired
    const query = `
      SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_admin,
             t.id as token_id, t.expires_at
      FROM user_tokens t
      JOIN users u ON t.user_id = u.id
      WHERE t.token = $1
        AND t.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = true
    `;

    const result = await pool.query(query, [token]);

    if (result.rows.length === 0) {
      return null; // Token not found, expired, or user not active
    }

    // Update last_used_at timestamp
    await pool.query(
      "UPDATE user_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1",
      [result.rows[0].token_id]
    );

    // Remove token_id and expires_at from returned user object
    const { token_id, expires_at, ...user } = result.rows[0];
    return user;
  },

  /**
   * Revoke (delete) a user token
   * @param {string} token - Token to revoke
   * @returns {Promise<boolean>} - True if token was revoked, false if not found
   */
  async revokeToken(token: string) {
    const result = await pool.query(
      "DELETE FROM user_tokens WHERE token = $1 RETURNING id",
      [token]
    );

    return result.rowCount !== null && result.rowCount > 0;
  },

  /**
   * Create a password reset token
   * @param {string} email - User email to create reset token for
   * @returns {Promise<Object|null>} - Reset token or null if user not found
   */
  async createPasswordResetToken(email: string) {
    // Find user by email
    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND is_active = true",
      [email]
    );

    if (userResult.rows.length === 0) {
      return null; // User not found or not active
    }

    const userId = userResult.rows[0].id;

    // Generate a secure random token
    const token = randomBytes(20).toString("hex");

    // Token expires in 24 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Delete any existing reset tokens for this user
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [
      userId,
    ]);

    // Create a new reset token
    const query = `
      INSERT INTO password_reset_tokens 
        (user_id, token, expires_at)
      VALUES 
        ($1, $2, $3)
      RETURNING token, expires_at
    `;

    const result = await pool.query(query, [userId, token, expiresAt]);
    return result.rows[0];
  },

  /**
   * Reset password using a valid reset token
   * @param {string} token - Reset token
   * @param {string} newPassword - New password to set
   * @returns {Promise<boolean>} - True if password was reset, false if token invalid
   */
  async resetPassword(token: string, newPassword: string) {
    // Check if token exists and hasn't expired
    const tokenQuery = `
      SELECT user_id, expires_at
      FROM password_reset_tokens
      WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP
    `;

    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      return false; // Token not found or expired
    }

    const userId = tokenResult.rows[0].user_id;

    // Hash the new password
    const saltRounds = 12;
    const passwordHash = await hash(newPassword, saltRounds);

    // Update the user's password
    await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [passwordHash, userId]
    );

    // Delete the used token
    await pool.query("DELETE FROM password_reset_tokens WHERE token = $1", [
      token,
    ]);

    return true;
  },

  /**
   * Change password for authenticated user
   * @param {number} userId - User ID
   * @param {string} currentPassword - Current password for verification
   * @param {string} newPassword - New password to set
   * @returns {Promise<boolean>} - True if password was changed, false if verification failed
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string
  ) {
    // Get current password hash for verification
    const userQuery = `
      SELECT password_hash
      FROM users
      WHERE id = $1 AND is_active = true
    `;

    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return false; // User not found or not active
    }

    // Verify current password
    const passwordMatch = await compare(
      currentPassword,
      userResult.rows[0].password_hash
    );

    if (!passwordMatch) {
      return false; // Current password doesn't match
    }

    // Hash the new password
    const saltRounds = 12;
    const passwordHash = await hash(newPassword, saltRounds);

    // Update the password
    await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [passwordHash, userId]
    );

    return true;
  },
};

export default userAuth;
