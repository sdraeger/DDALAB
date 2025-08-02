# Development Publishing Guide

This guide explains how to publish development versions of the DDALAB ConfigManager.

## Overview

The configmanager supports multiple publishing channels:

- **Production**: Stable releases (default)
- **Development**: Development builds for testing
- **Beta**: Pre-release versions for beta testing

## Quick Start

### 1. Development Build (Local Testing)

```bash
# Build for local testing
npm run package:dev

# Build for specific platform
npm run package:dev:mac
npm run package:dev:win
npm run package:dev:linux
```

### 2. Publish Development Version

```bash
# Update version and publish development build
npm run version:dev
npm run publish:dev
```

### 3. Publish Beta Version

```bash
# Update version and publish beta build
npm run version:beta
npm run publish:beta
```

## Detailed Publishing Process

### Development Version Publishing

1. **Update Version**:

   ```bash
   # Increment patch version (default)
   npm run version:dev

   # Increment minor version
   npm run version:dev minor

   # Increment major version
   npm run version:dev major
   ```

2. **Build and Publish**:

   ```bash
   # Publish to development channel
   npm run publish:dev
   ```

3. **Verify Release**:
   - Check GitHub releases for draft release
   - Verify development channel is set
   - Test auto-update functionality

### Beta Version Publishing

1. **Update Version**:

   ```bash
   # Increment patch version (default)
   npm run version:beta

   # Increment minor version
   npm run version:beta minor

   # Increment major version
   npm run version:beta major
   ```

2. **Build and Publish**:

   ```bash
   # Publish to beta channel
   npm run publish:beta
   ```

3. **Verify Release**:
   - Check GitHub releases for pre-release
   - Verify beta channel is set
   - Test auto-update functionality

## Configuration Files

### Development Configuration (`electron-builder.dev.json`)

- **App ID**: `com.ddalab.configmanager.dev`
- **Product Name**: "DDALAB ConfigManager (Dev)"
- **Output Directory**: `release-dev`
- **Release Type**: Draft
- **Channel**: Development
- **Artifact Names**: Include "-Dev" suffix

### Beta Configuration (`electron-builder.beta.json`)

- **App ID**: `com.ddalab.configmanager.beta`
- **Product Name**: "DDALAB ConfigManager (Beta)"
- **Output Directory**: `release-beta`
- **Release Type**: Pre-release
- **Channel**: Beta
- **Artifact Names**: Include "-Beta" suffix

## Version Management

### Version Format

- **Development**: `1.0.1-dev.1`, `1.0.1-dev.2`, etc.
- **Beta**: `1.0.1-beta.1`, `1.0.1-beta.2`, etc.
- **Production**: `1.0.1`, `1.0.2`, etc.

### Version Increment Types

- **Patch**: Bug fixes and minor changes
- **Minor**: New features, backward compatible
- **Major**: Breaking changes

## Publishing Workflows

### Development Workflow

1. **Make Changes**: Develop and test locally
2. **Update Version**: `npm run version:dev`
3. **Build**: `npm run build`
4. **Test Locally**: `npm run package:dev`
5. **Publish**: `npm run publish:dev`
6. **Verify**: Check GitHub release and auto-update

### Beta Workflow

1. **Feature Complete**: Ensure all features are implemented
2. **Update Version**: `npm run version:beta`
3. **Build**: `npm run build`
4. **Test Locally**: `npm run package:dev` (use dev config for testing)
5. **Publish**: `npm run publish:beta`
6. **Beta Testing**: Distribute to beta testers
7. **Production**: When ready, publish to production

## Auto-Update Channels

### Channel Configuration

The auto-update system supports different channels:

```javascript
// Development channel
autoUpdater.setFeedURL({
  provider: "github",
  owner: "ddalab",
  repo: "configmanager",
  channel: "development",
});

// Beta channel
autoUpdater.setFeedURL({
  provider: "github",
  owner: "ddalab",
  repo: "configmanager",
  channel: "beta",
});

// Production channel (default)
autoUpdater.setFeedURL({
  provider: "github",
  owner: "ddalab",
  repo: "configmanager",
});
```

### Channel Selection

Users can switch between channels:

- **Development**: Latest development builds
- **Beta**: Pre-release versions
- **Production**: Stable releases

## GitHub Release Types

### Draft Releases (Development)

- **Purpose**: Internal testing and development
- **Visibility**: Only visible to repository collaborators
- **Auto-update**: Not available to end users
- **Use Case**: Development team testing

### Pre-releases (Beta)

- **Purpose**: Beta testing with external users
- **Visibility**: Public but marked as pre-release
- **Auto-update**: Available to users on beta channel
- **Use Case**: Beta testing with select users

### Releases (Production)

- **Purpose**: Stable releases for all users
- **Visibility**: Public release
- **Auto-update**: Available to all users
- **Use Case**: Production deployment

## Environment Variables

### Development Environment

```bash
# Set development environment
export NODE_ENV=development
export ELECTRON_IS_DEV=true

# Build and run in development mode
npm run start
```

### Production Environment

```bash
# Set production environment
export NODE_ENV=production
export ELECTRON_IS_DEV=false

# Build and run in production mode
npm run package
```

## Troubleshooting

### Common Issues

1. **Version Conflicts**:

   ```bash
   # Check current version
   cat package.json | grep version

   # Reset version if needed
   npm run version:dev patch
   ```

2. **Build Failures**:

   ```bash
   # Clean and rebuild
   rm -rf dist/ release-dev/
   npm run build
   npm run package:dev
   ```

3. **Publish Failures**:

   ```bash
   # Check GitHub token
   echo $GH_TOKEN

   # Check repository access
   git remote -v
   ```

4. **Auto-Update Issues**:
   - Verify channel configuration
   - Check GitHub release visibility
   - Test with development builds first

### Debug Commands

```bash
# Check build configuration
npm run build -- --verbose

# Check electron-builder configuration
npx electron-builder --help

# Test auto-update locally
npm run start
```

## Best Practices

### Development Publishing

1. **Frequent Updates**: Publish development builds frequently
2. **Clear Naming**: Use descriptive version numbers
3. **Testing**: Always test locally before publishing
4. **Documentation**: Update release notes for significant changes

### Beta Publishing

1. **Feature Complete**: Ensure all planned features are implemented
2. **Testing**: Thorough testing before beta release
3. **Feedback**: Collect and address beta tester feedback
4. **Timeline**: Set clear timeline for production release

### Production Publishing

1. **Stability**: Only publish stable, tested code
2. **Documentation**: Complete release notes
3. **Rollback Plan**: Have a plan for quick rollback if needed
4. **Monitoring**: Monitor auto-update success rates

## Scripts Reference

### Version Management

```bash
# Development versions
npm run version:dev [patch|minor|major]

# Beta versions
npm run version:beta [patch|minor|major]
```

### Building

```bash
# Development builds
npm run package:dev
npm run package:dev:mac
npm run package:dev:win
npm run package:dev:linux

# Production builds
npm run package
npm run package:mac
npm run package:win
npm run package:linux
```

### Publishing

```bash
# Development publishing
npm run publish:dev

# Beta publishing
npm run publish:beta

# Production publishing
npm run publish
```

## GitHub Integration

### Repository Setup

1. **GitHub Token**: Set `GH_TOKEN` environment variable
2. **Repository Access**: Ensure write access to repository
3. **Release Permissions**: Enable releases in repository settings

### Release Management

1. **Draft Releases**: Use for development builds
2. **Pre-releases**: Use for beta versions
3. **Releases**: Use for production versions

### Auto-Update Configuration

```json
{
  "publish": {
    "provider": "github",
    "owner": "ddalab",
    "repo": "configmanager",
    "releaseType": "draft",
    "channel": "development"
  }
}
```

This configuration ensures proper channel separation and release management for different development stages.
