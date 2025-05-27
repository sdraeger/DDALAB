# Volume Configuration

This document explains how to configure directory mounts for the DDALAB API container.

## Single Source Configuration

All directory mounting is configured through the `DDALAB_ALLOWED_DIRS` environment variable in your `.env` file.

### Format

```bash
DDALAB_ALLOWED_DIRS=source1:target1:mode1,source2:target2:mode2,...
```

Where:

- `source`: Host machine path
- `target`: Container path
- `mode`: Access mode (`rw` for read-write, `ro` for read-only)

### Examples

**Single directory with read-write access:**

```bash
DDALAB_ALLOWED_DIRS=/Users/simon/Desktop:/app/data/Desktop:rw
```

**Multiple directories with different permissions:**

```bash
DDALAB_ALLOWED_DIRS=/Users/simon/Desktop:/app/data/Desktop:rw,/shared/readonly:/app/shared:ro,./data:/app/data:rw
```

## Usage

### Method 1: Automatic Generation and Start

```bash
./scripts/start-with-volumes.sh
```

This script will:

1. Read `DDALAB_ALLOWED_DIRS` from `.env`
2. Generate `docker-compose.volumes.yml`
3. Start all services with the generated volume configuration

### Method 2: Manual Generation

```bash
# Generate volume configuration
./scripts/generate-volumes.sh

# Start services with generated configuration
docker-compose -f docker-compose.yml -f docker-compose.volumes.yml up -d
```

## Important Notes

1. **Single source of truth**: Only edit `DDALAB_ALLOWED_DIRS` in `.env` file
2. **Auto-generated file**: `docker-compose.volumes.yml` is auto-generated - don't edit manually
3. **Regenerate when needed**: Run the generation script whenever you change `DDALAB_ALLOWED_DIRS`
4. **Path requirements**: Host paths must exist before starting containers

## Troubleshooting

**"Read-only file system" errors:**

- Ensure paths in `DDALAB_ALLOWED_DIRS` use `:rw` mode for directories that need write access
- Regenerate volume configuration after changing `.env`

**"No such file or directory" errors:**

- Verify host paths exist on your machine
- Check path spelling in `DDALAB_ALLOWED_DIRS`

**Permission denied errors:**

- Ensure your user has read/write access to the host directories
- On macOS/Linux, you may need to adjust file permissions
