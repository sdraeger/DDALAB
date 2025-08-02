# Quick Publishing Guide

## Development Version Publishing

### 1. Update Version and Build

```bash
# Update to next development version
npm run version:dev

# Build and package for development
npm run package:dev
```

### 2. Publish to GitHub (Development Channel)

```bash
# Publish as draft release (development channel)
npm run publish:dev
```

## Beta Version Publishing

### 1. Update Version and Build

```bash
# Update to next beta version
npm run version:beta

# Build and package for beta
npm run package:dev  # Use dev config for testing
```

### 2. Publish to GitHub (Beta Channel)

```bash
# Publish as pre-release (beta channel)
npm run publish:beta
```

## Production Version Publishing

### 1. Update Version and Build

```bash
# Manually update version in package.json
# Then build and package
npm run package
```

### 2. Publish to GitHub (Production Channel)

```bash
# Publish as release (production channel)
npm run publish
```

## Platform-Specific Builds

### Development Builds

```bash
npm run package:dev:mac    # macOS
npm run package:dev:win    # Windows
npm run package:dev:linux  # Linux
```

### Production Builds

```bash
npm run package:mac        # macOS
npm run package:win        # Windows
npm run package:linux      # Linux
```

## Version Management

### Development Versions

```bash
npm run version:dev        # 1.0.1-dev.1
npm run version:dev minor  # 1.1.0-dev.1
npm run version:dev major  # 2.0.0-dev.1
```

### Beta Versions

```bash
npm run version:beta       # 1.0.1-beta.1
npm run version:beta minor # 1.1.0-beta.1
npm run version:beta major # 2.0.0-beta.1
```

## Environment Setup

### Required Environment Variables

```bash
export GH_TOKEN=your_github_token
export NODE_ENV=development  # for dev builds
```

### GitHub Repository Setup

- Repository: `ddalab/configmanager`
- GitHub token with repo permissions
- Releases enabled in repository settings

## Quick Commands Reference

| Command                     | Description                    |
| --------------------------- | ------------------------------ |
| `npm run version:dev`       | Update to next dev version     |
| `npm run version:beta`      | Update to next beta version    |
| `npm run package:dev`       | Build development version      |
| `npm run package:dev:mac`   | Build dev version for macOS    |
| `npm run package:dev:win`   | Build dev version for Windows  |
| `npm run package:dev:linux` | Build dev version for Linux    |
| `npm run publish:dev`       | Publish dev version to GitHub  |
| `npm run publish:beta`      | Publish beta version to GitHub |
| `npm run publish`           | Publish production version     |

## Release Types

| Channel     | Release Type | Visibility         | Auto-Update        |
| ----------- | ------------ | ------------------ | ------------------ |
| Development | Draft        | Collaborators only | No                 |
| Beta        | Pre-release  | Public             | Yes (beta channel) |
| Production  | Release      | Public             | Yes (default)      |

## Troubleshooting

### Common Issues

1. **Missing GitHub Token**: Set `GH_TOKEN` environment variable
2. **Build Failures**: Run `npm run build` first
3. **Icon Issues**: Run `npm run build-icons`
4. **Version Conflicts**: Check current version in `package.json`

### Debug Commands

```bash
# Check current version
cat package.json | grep version

# Clean and rebuild
rm -rf dist/ release-dev/
npm run build

# Test locally
npm run start
```
