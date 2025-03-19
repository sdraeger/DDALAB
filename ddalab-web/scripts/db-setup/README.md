# PostgreSQL User Database for DDALAB

This directory contains scripts to set up a secure PostgreSQL database for storing user credentials following best practices:

- Password hashing with bcrypt
- Token-based authentication
- Proper database schema with indexes
- Secure API endpoints

## Setup Instructions

### Prerequisites

1. PostgreSQL installed and running on your system
2. Node.js and npm installed

### Step 1: Install Dependencies

In the project root directory, install the required Node.js packages:

```bash
cd ddalab-web
npm install bcrypt pg dotenv
```

### Step 2: Configure Environment Variables

Create or update your `.env.local` file in the project root with the following variables:

```
# Database configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ddalab
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Initial admin user
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_admin_password
ADMIN_EMAIL=admin@example.com
```

### Step 3: Create the Database

If you haven't already created a PostgreSQL database, create one with:

```bash
psql -U postgres -c "CREATE DATABASE ddalab;"
```

### Step 4: Run the Setup Script

Execute the setup script to create the tables and initial admin user:

```bash
node scripts/db-setup/setup-user-database.js
```

## Database Schema

The setup creates the following tables:

1. **users**: Stores user credentials with bcrypt-hashed passwords
2. **user_tokens**: Stores API tokens for authenticated users
3. **password_reset_tokens**: Stores temporary password reset tokens
4. **user_refresh_tokens**: Stores JWT refresh tokens

## API Endpoints

The following API endpoints are available for user management:

- **POST /api/auth/login**: Authenticate a user and generate a token
- **PUT /api/auth/register**: Register a new user
- **PATCH /api/auth/verify**: Verify a token and get the associated user
- **DELETE /api/auth/logout**: Revoke a token

## Usage Example

```javascript
// Login
const loginResponse = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'your_secure_admin_password' })
});

const { user, token } = await loginResponse.json();

// Use the token for authenticated requests
const response = await fetch('/api/some-protected-endpoint', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

## Security Best Practices

1. **Password Storage**: Never store plaintext passwords. We use bcrypt with a high work factor (12).
2. **Token Management**: Tokens are securely generated, have expiration dates, and can be revoked.
3. **Rate Limiting**: Implement rate limiting on authentication endpoints to prevent brute force attacks.
4. **Transport Security**: Always use HTTPS in production environments.
5. **Access Control**: The database user should have minimal necessary permissions.

## Integration with Directus

The user system automatically integrates with Directus:

1. **User Synchronization**: When a new user is registered in the PostgreSQL database, a corresponding user is automatically created in Directus with the same credentials.

2. **Role Assignment**: All users created through this system are assigned to the "Public" role in Directus by default.

3. **Configuration**: Make sure to set the following environment variables for Directus integration:
   ```
   DIRECTUS_URL=http://localhost:8055
   DIRECTUS_EMAIL=admin@example.com
   DIRECTUS_PASSWORD=your_directus_admin_password
   ```

4. **Transaction Safety**: If user creation in Directus fails, the transaction in PostgreSQL is rolled back, ensuring consistency between both systems.

5. **How It Works**: The integration uses Directus's API with the admin token to create users. The admin account credentials are only used for this API access, not for regular user authentication.

### Directus Setup Requirements

For this integration to work:

1. Directus must be installed and running
2. An admin account must exist in Directus with credentials specified in the environment variables
3. A "Public" role must exist in Directus (created by default in most installations)
4. The admin account must have permission to create users and access roles

If you encounter issues with the integration, you can manually create users in Directus or customize the synchronization logic in the `userAuth.registerUser` method.

## Invite Code Registration System

The user registration system includes an invite code mechanism to control who can register:

1. **Invite Codes**: Each new user must provide a valid invite code to register
2. **Limited Uses**: Invite codes can be configured for single or multiple uses
3. **Expiration**: Codes can have an expiration date
4. **Email Restriction**: Codes can be tied to specific email addresses

### Managing Invite Codes

Admin users can generate and manage invite codes through the API:

1. **Generate Codes**: `POST /api/auth/invite` (admin only)
   ```javascript
   // Generate a new invite code
   const response = await fetch('/api/auth/invite', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${adminToken}`
     },
     body: JSON.stringify({
       email: 'user@example.com', // Optional: restrict to this email
       maxUses: 5, // How many times the code can be used (default: 1)
       expiresInDays: 30 // Optional: code expires after this many days
     })
   });
   ```

2. **List Codes**: `GET /api/auth/invite` (admin only)
   ```javascript
   // List all invite codes
   const response = await fetch('/api/auth/invite?active=true', {
     headers: {
       'Authorization': `Bearer ${adminToken}`
     }
   });
   ```

### Using Invite Codes

Users can register with a valid invite code:

1. **Validate Code**: `GET /api/auth/register/validate-code?code=XXXX&email=user@example.com`
   ```javascript
   // Check if an invite code is valid
   const response = await fetch(`/api/auth/register/validate-code?code=${inviteCode}`);
   ```

2. **Register**: `POST /api/auth/register`
   ```javascript
   // Register with an invite code
   const response = await fetch('/api/auth/register', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       username: 'newuser',
       password: 'secure_password',
       email: 'user@example.com',
       firstName: 'New',
       lastName: 'User',
       inviteCode: 'abc123' // Valid invite code
     })
   });
   ```

### Initial Setup

When running the setup script, an initial invite code is automatically generated and is valid for 30 days with 5 uses. This code will be displayed in the console output when you run the setup script.

### Integration with Directus

The invite code system works seamlessly with the Directus integration:

1. Users registered with invite codes are also created in Directus
2. The same password validation and security features apply
3. All users are assigned to the Public role in Directus 