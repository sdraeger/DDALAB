# Environment Configuration

This directory centralizes all environment configurations for the DDALAB project.

## Structure

- `base.env` - Common environment variables shared across all environments
- `local.env` - Local development environment overrides
- `ddalab-web.env` - Environment variables specific to the web application
- `server-scripts.env` - Environment variables for server scripts
- `db-setup.env` - Environment variables for database setup scripts

## Usage

Each project should load the appropriate environment files in the following order:

1. Load the `base.env` file for common variables
2. Load the project-specific env file (e.g., `ddalab-web.env`)
3. Optionally load the environment-specific file (e.g., `local.env` for development)

For example, in a Next.js application:

```javascript
// Load environment configuration
require('dotenv').config({ path: path.resolve(__dirname, '../config/environments/base.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../config/environments/ddalab-web.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../config/environments/local.env') });
```

## Local Development

For local development, symbolic links can be created from the project .env.local files to this centralized location. 