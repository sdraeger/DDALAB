# Platform Architecture Fix for DDALAB Container

## Overview

This document describes the generalized solution implemented in the configmanager to automatically ensure the `ddalab` container always runs with `linux/amd64` platform specification, preventing SIGTRAP errors on non-AMD64 systems.

## Problem

The `ddalab` Docker container requires `linux/amd64` architecture to prevent SIGTRAP errors when running DDA (Digital Data Analysis). Without this specification, the container may try to run with the host's native architecture, causing compatibility issues.

## Solution

The configmanager now automatically applies platform fixes through multiple mechanisms:

### 1. **Automatic Platform Injection**

When generating new docker-compose.yml configurations, the configmanager automatically includes `platform: linux/amd64` for the ddalab service:

```yaml
ddalab:
  image: ${DDALAB_IMAGE:-sdraeger1/ddalab:latest}
  platform: linux/amd64  # <- Automatically added
  env_file:
    - ./.env
```

### 2. **Existing Installation Fix**

For existing installations, the configmanager applies the platform fix during:
- Setup validation (`ensureValidSetup`)
- Initial setup process
- Configuration updates

### 3. **Smart Detection and Patching**

The `ensureDdalabPlatform` method intelligently:
- Detects existing `ddalab` service definitions
- Adds `platform: linux/amd64` if missing
- Updates existing platform specifications to ensure AMD64
- Preserves existing docker-compose.yml structure and formatting

## Implementation Details

### Core Methods

#### `ensureDdalabPlatform(composeContent: string): string`
- Parses docker-compose.yml content
- Identifies the `ddalab` service section
- Adds or updates the platform specification
- Maintains proper YAML indentation and structure

#### `applyPlatformFix(setupPath: string): Promise<void>`
- Applies the platform fix to existing docker-compose.yml files
- Handles file reading, processing, and writing
- Provides proper error handling and logging

### Integration Points

1. **New Setups**: Called during `setupDDALAB()` after `updateDockerCompose()`
2. **Existing Setups**: Called during `ensureValidSetup()` for validation
3. **Service Generation**: Platform specification included in generated ddalab service definition

## Benefits

1. **Automatic Fix**: No manual intervention required
2. **Backward Compatible**: Works with existing installations
3. **Future Proof**: Applied to all new setups automatically
4. **Non-Destructive**: Preserves existing docker-compose.yml structure
5. **Error Prevention**: Eliminates SIGTRAP errors from architecture mismatches

## Usage

### Automatic Application
The platform fix is applied automatically during:
- New DDALAB installations
- Setup validation checks
- Configuration updates

### Manual Application
You can manually apply the fix using the configmanager:

```typescript
import { SetupService } from './services/setup-service';

// Apply to specific directory
await SetupService.applyPlatformFix('/path/to/ddalab');
```

### Testing
Run the platform fix test:

```bash
npx tsx src/test-platform-fix.ts
```

## Example Transformations

### Before (Missing Platform)
```yaml
ddalab:
  image: sdraeger1/ddalab:latest
  env_file:
    - ./.env
  ports:
    - "3000:3000"
```

### After (Platform Added)
```yaml
ddalab:
  image: sdraeger1/ddalab:latest
  platform: linux/amd64
  env_file:
    - ./.env
  ports:
    - "3000:3000"
```

### Before (Wrong Platform)
```yaml
ddalab:
  image: sdraeger1/ddalab:latest
  platform: linux/arm64
  env_file:
    - ./.env
```

### After (Platform Corrected)
```yaml
ddalab:
  image: sdraeger1/ddalab:latest
  platform: linux/amd64
  env_file:
    - ./.env
```

## Monitoring and Logging

The platform fix provides comprehensive logging:

- **Success**: `Applied platform fix to /path/to/docker-compose.yml`
- **Warning**: `Could not apply platform fix to /path/to/docker-compose.yml: [reason]`
- **Debug**: Details about platform detection and application

## Troubleshooting

### Common Issues

1. **File Permission Errors**: Ensure configmanager has write access to docker-compose.yml
2. **Malformed YAML**: The fix preserves existing structure but requires valid YAML syntax
3. **Missing ddalab Service**: The fix only applies if a ddalab service is found

### Verification

To verify the fix was applied:

```bash
# Check if platform is set correctly
grep -A 5 "ddalab:" /path/to/docker-compose.yml | grep "platform: linux/amd64"
```

## Future Enhancements

1. **Platform Detection**: Could be extended to detect host architecture and apply appropriate fixes
2. **Other Services**: Could be extended to apply platform fixes to other services if needed
3. **Validation**: Could include validation to ensure the platform specification is working correctly

## Related Files

- `src/services/setup-service.ts` - Main implementation
- `src/test-platform-fix.ts` - Test script
- `docs/PLATFORM_FIX.md` - This documentation
