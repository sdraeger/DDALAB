#!/usr/bin/env node

/**
 * User Database Setup Script
 * 
 * This script initializes the PostgreSQL database with users table and
 * related authentication tables following security best practices.
 * 
 * Usage: 
 * 1. Make sure PostgreSQL is installed and running
 * 2. Set required environment variables (see below)
 * 3. Run: node setup-user-database.js
 */

// Required environment variables:
// - DB_HOST: PostgreSQL host (default: localhost)
// - DB_PORT: PostgreSQL port (default: 5432)
// - DB_NAME: Database name (default: ddalab)
// - DB_USER: Database user (default: postgres)
// - DB_PASSWORD: Database password
// - ADMIN_USERNAME: Initial admin username to create (default: admin)
// - ADMIN_PASSWORD: Initial admin password to create
// - ADMIN_EMAIL: Initial admin email
// - DIRECTUS_URL: URL to Directus instance (default: http://localhost:8055)
// - DIRECTUS_EMAIL: Directus admin email
// - DIRECTUS_PASSWORD: Directus admin password

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const axios = require('axios');

// Load environment variables from .env.local file (if exists) 
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

// Default configuration values
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ddalab',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD,
  adminEmail: process.env.ADMIN_EMAIL,
  directusUrl: process.env.DIRECTUS_URL || 'http://localhost:8055',
  directusEmail: process.env.DIRECTUS_EMAIL,
  directusPassword: process.env.DIRECTUS_PASSWORD,
};

// Verify required configuration
if (!config.password) {
  console.error('Error: DB_PASSWORD environment variable is required');
  process.exit(1);
}

if (!config.adminPassword) {
  console.error('Error: ADMIN_PASSWORD environment variable is required');
  process.exit(1);
}

if (!config.adminEmail) {
  console.error('Error: ADMIN_EMAIL environment variable is required');
  process.exit(1);
}

if (!config.directusEmail || !config.directusPassword) {
  console.error('Error: DIRECTUS_EMAIL and DIRECTUS_PASSWORD environment variables are required');
  process.exit(1);
}

// Read SQL schema file
const schemaFile = path.join(__dirname, 'create_users_table.sql');
const schemaSQL = fs.readFileSync(schemaFile, 'utf8');

/**
 * Get Directus admin token for authentication
 */
async function getDirectusAdminToken() {
  try {
    console.log('Authenticating with Directus...');
    const response = await axios.post(`${config.directusUrl}/auth/login`, {
      email: config.directusEmail,
      password: config.directusPassword,
    });
    
    return response.data.data.access_token;
  } catch (error) {
    console.error('Failed to authenticate with Directus:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with Directus');
  }
}

/**
 * Get the Directus Public role ID
 */
async function getDirectusPublicRoleId(adminToken) {
  try {
    console.log('Fetching Directus roles...');
    const response = await axios.get(`${config.directusUrl}/roles`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    const publicRole = response.data.data.find(role => role.name.toLowerCase() === 'public');
    
    if (!publicRole) {
      throw new Error('Public role not found in Directus');
    }

    return publicRole.id;
  } catch (error) {
    console.error('Failed to fetch Directus roles:', error.response?.data || error.message);
    throw new Error('Failed to fetch Directus roles');
  }
}

/**
 * Create a user in Directus
 */
async function createDirectusUser(userData, adminToken, roleId) {
  try {
    console.log(`Creating Directus user with email: ${userData.email}...`);
    
    // Check if user already exists
    try {
      const checkResponse = await axios.get(`${config.directusUrl}/users`, {
        params: {
          filter: { email: { _eq: userData.email } }
        },
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      
      if (checkResponse.data.data && checkResponse.data.data.length > 0) {
        console.log(`Directus user with email ${userData.email} already exists, skipping creation`);
        return checkResponse.data.data[0];
      }
    } catch (error) {
      // Continue with user creation if check fails
      console.log('User does not exist, proceeding with creation');
    }
    
    // Create the user
    const response = await axios.post(`${config.directusUrl}/users`, {
      email: userData.email,
      password: userData.password,
      first_name: userData.firstName || '',
      last_name: userData.lastName || '',
      role: roleId,
      status: 'active',
    }, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    console.log(`Directus user created successfully: ${userData.email}`);
    return response.data.data;
  } catch (error) {
    console.error('Failed to create Directus user:', error.response?.data || error.message);
    throw new Error('Failed to create Directus user');
  }
}

/**
 * Create an initial invite code
 * @param {number} adminUserId - Admin user ID who created the code
 */
async function createInitialInviteCode(adminUserId) {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password
  });

  try {
    console.log('Creating initial invite code...');
    await client.connect();

    // Generate a random code
    const crypto = require('crypto');
    const code = crypto.randomBytes(8).toString('hex');
    
    // Check if we already have invite codes
    const checkResult = await client.query('SELECT COUNT(*) FROM invite_codes');
    
    if (parseInt(checkResult.rows[0].count) > 0) {
      console.log('Invite codes already exist, skipping creation of initial code');
      return;
    }
    
    // Create an invite code valid for 30 days with 5 uses
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now
    
    await client.query(
      `INSERT INTO invite_codes 
         (code, created_by, max_uses, expires_at, is_active) 
       VALUES ($1, $2, $3, $4, $5)`,
      [code, adminUserId, 5, expiresAt, true]
    );
    
    console.log(`Initial invite code created: ${code} (valid for 30 days, 5 uses)`);
  } catch (error) {
    console.error('Error creating initial invite code:', error);
  } finally {
    await client.end();
  }
}

/**
 * Runs the database setup process
 */
async function setupDatabase() {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password
  });

  try {
    console.log('Connecting to PostgreSQL database...');
    await client.connect();
    
    console.log('Creating user tables schema...');
    await client.query(schemaSQL);
    
    // Create admin user with bcrypt hashed password
    console.log('Creating admin user...');
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(config.adminPassword, saltRounds);
    
    // Check if admin user already exists to avoid duplicates
    const userCheckResult = await client.query(
      'SELECT * FROM users WHERE username = $1',
      [config.adminUsername]
    );
    
    let adminUser;
    if (userCheckResult.rows.length > 0) {
      console.log(`Admin user '${config.adminUsername}' already exists in database.`);
      adminUser = userCheckResult.rows[0];
    } else {
      const result = await client.query(
        `INSERT INTO users 
         (username, password_hash, email, first_name, last_name, is_admin) 
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, email, first_name, last_name, is_admin`,
        [
          config.adminUsername, 
          passwordHash, 
          config.adminEmail,
          'Admin',
          'User',
          true
        ]
      );
      adminUser = result.rows[0];
      console.log(`Admin user '${config.adminUsername}' created successfully in database.`);
    }
    
    // Create the same user in Directus
    try {
      // Get Directus admin token
      const adminToken = await getDirectusAdminToken();
      
      // Get Public role ID
      const publicRoleId = await getDirectusPublicRoleId(adminToken);
      
      // Create admin user in Directus (or verify it exists)
      await createDirectusUser({
        email: config.adminEmail,
        password: config.adminPassword,
        firstName: 'Admin',
        lastName: 'User'
      }, adminToken, publicRoleId);
      
      console.log('Admin user setup in both PostgreSQL and Directus completed successfully.');
    } catch (directusError) {
      console.error('Error setting up Directus user:', directusError.message);
      console.warn('Continuing with database setup only. You may need to manually create the user in Directus.');
    }
    
    // Create an initial invite code
    await createInitialInviteCode(adminUser.id);
    
    console.log('Database setup completed successfully.');
  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupDatabase(); 