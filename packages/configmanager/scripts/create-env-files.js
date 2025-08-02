const fs = require("fs");
const path = require("path");

function createEnvironmentFiles() {
  const baseDir = path.join(__dirname, "../");

  // Development environment
  const devEnv = `# Development Environment Configuration
NODE_ENV=development
ELECTRON_IS_DEV=true

# Docker Configuration
DDALAB_ALLOWED_DIRS=/path/to/dev/data:/app/data:ro,/path/to/dev/logs:/app/logs:rw

# Port Configuration
WEB_PORT=3000
API_PORT=8000
TRAEFIK_PORT=80

# Database Configuration
POSTGRES_DB=ddalab_dev
POSTGRES_USER=ddalab_dev_user
POSTGRES_PASSWORD=dev_password

# MinIO Configuration
MINIO_ROOT_USER=dev_minio_user
MINIO_ROOT_PASSWORD=dev_minio_password

# Application Configuration
APP_ENV=development
DEBUG=true
LOG_LEVEL=debug
`;

  // Testing environment
  const testEnv = `# Testing Environment Configuration
NODE_ENV=test
ELECTRON_IS_TESTING=true

# Docker Configuration
DDALAB_ALLOWED_DIRS=/path/to/test/data:/app/data:ro,/path/to/test/logs:/app/logs:rw

# Port Configuration (different from dev to avoid conflicts)
WEB_PORT=4000
API_PORT=9000
TRAEFIK_PORT=1080

# Database Configuration
POSTGRES_DB=ddalab_test
POSTGRES_USER=ddalab_test_user
POSTGRES_PASSWORD=test_password

# MinIO Configuration
MINIO_ROOT_USER=test_minio_user
MINIO_ROOT_PASSWORD=test_minio_password

# Application Configuration
APP_ENV=testing
DEBUG=true
LOG_LEVEL=debug
`;

  // Production environment
  const prodEnv = `# Production Environment Configuration
NODE_ENV=production
ELECTRON_IS_PRODUCTION=true

# Docker Configuration
DDALAB_ALLOWED_DIRS=/path/to/prod/data:/app/data:ro,/path/to/prod/logs:/app/logs:rw

# Port Configuration
WEB_PORT=3000
API_PORT=8000
TRAEFIK_PORT=80

# Database Configuration
POSTGRES_DB=ddalab_prod
POSTGRES_USER=ddalab_prod_user
POSTGRES_PASSWORD=prod_password

# MinIO Configuration
MINIO_ROOT_USER=prod_minio_user
MINIO_ROOT_PASSWORD=prod_minio_password

# Application Configuration
APP_ENV=production
DEBUG=false
LOG_LEVEL=info
`;

  try {
    // Create environment files
    fs.writeFileSync(path.join(baseDir, ".env.development"), devEnv);
    console.log("Created .env.development");

    fs.writeFileSync(path.join(baseDir, ".env.testing"), testEnv);
    console.log("Created .env.testing");

    fs.writeFileSync(path.join(baseDir, ".env.production"), prodEnv);
    console.log("Created .env.production");

    // Create a template .env file
    const templateEnv = `# Template Environment Configuration
# Copy this file to .env and modify as needed

NODE_ENV=development
ELECTRON_IS_DEV=true

# Docker Configuration
DDALAB_ALLOWED_DIRS=/path/to/your/data:/app/data:ro,/path/to/your/logs:/app/logs:rw

# Port Configuration
WEB_PORT=3000
API_PORT=8000
TRAEFIK_PORT=80

# Database Configuration
POSTGRES_DB=ddalab
POSTGRES_USER=ddalab_user
POSTGRES_PASSWORD=your_password

# MinIO Configuration
MINIO_ROOT_USER=minio_user
MINIO_ROOT_PASSWORD=minio_password

# Application Configuration
APP_ENV=development
DEBUG=true
LOG_LEVEL=debug
`;

    fs.writeFileSync(path.join(baseDir, ".env.template"), templateEnv);
    console.log("Created .env.template");

    console.log("\nEnvironment files created successfully!");
    console.log("Remember to:");
    console.log("1. Update DDALAB_ALLOWED_DIRS with your actual paths");
    console.log("2. Change passwords to secure values");
    console.log("3. Adjust ports if needed");
    console.log("4. Copy .env.template to .env for your setup");
  } catch (error) {
    console.error("Error creating environment files:", error);
  }
}

function showHelp() {
  console.log(`
Environment File Creation Script

Usage:
  node scripts/create-env-files.js

This script creates environment-specific .env files:
- .env.development - For development mode
- .env.testing - For testing mode (different ports)
- .env.production - For production mode
- .env.template - Template for custom setup

The files include:
- Different port configurations to prevent conflicts
- Environment-specific database names
- Separate volume configurations
- Mode-specific settings
`);
}

const command = process.argv[2];

if (command === "help" || command === "--help" || command === "-h") {
  showHelp();
} else {
  createEnvironmentFiles();
}
