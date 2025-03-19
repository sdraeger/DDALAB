# Configuration

This directory contains configuration files and settings for the DDALAB project.

## Environment Configuration

The `environments` directory centralizes all environment variables used across different projects and components. This approach provides:

1. **Consistency**: Common variables are defined once and reused
2. **Separation of concerns**: Project-specific variables are kept separate
3. **Overridability**: Local development settings can override base settings

### Usage

To set up or update environment files across projects:

```bash
./config/setup-env-links.sh
```

This script will generate appropriate `.env.local` files for each project based on:
- Base environment variables (base.env)
- Project-specific variables (e.g., ddalab-web.env)
- Local development overrides (local.env)

### Structure

- `environments/base.env` - Common variables shared across all projects
- `environments/ddalab-web.env` - Web application specific variables
- `environments/db-setup.env` - Database setup specific variables
- `environments/server-scripts.env` - Server scripts specific variables
- `environments/local.env` - Local development overrides

For more details, see [environments/README.md](./environments/README.md). 