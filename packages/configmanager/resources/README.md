# ConfigManager Resources

This directory contains bundled DDALAB files that are packaged with the ConfigManager application.

## Structure

- `ddalab-files/` - Essential DDALAB configuration files
  - `docker-compose.yml` - Main Docker Compose configuration
  - `traefik.yml` - Traefik reverse proxy configuration
  - `prometheus.yml` - Prometheus monitoring configuration
  - `acme.json` - Empty file for Let's Encrypt certificates (will be populated at runtime)
  - `dynamic/` - Directory for dynamic Traefik configuration

## Usage

These files are automatically copied to the user's selected project directory when setting up DDALAB through ConfigManager.

In production builds, these files are bundled with the application and accessed via:
- `process.resourcesPath` in the packaged Electron app

In development, the files are copied from the DDALAB root directory.

## Updating Resources

To update these bundled files:
1. Update the source files in the DDALAB root directory
2. Run the update script: `npm run update-resources` (if available)
3. Or manually copy files to this directory
4. Rebuild ConfigManager to include the updated files