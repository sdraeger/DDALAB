# Performance Fixes for ConfigManager Startup

## Issues Identified and Fixed

### 1. Fish Shell Wildcard Issue
**Problem**: The shell utility was detecting Fish shell (`/usr/local/bin/fish`) which handles wildcards differently than bash/sh, causing certificate generation to fail with wildcard domains like `*.ddalab.local`.

**Fixes Applied**:
- Updated shell detection to prefer bash/zsh/sh over fish shell
- Added shell-specific command formatting to escape wildcards for fish shell
- Added proper quoting for wildcard domains in certificate generation

### 2. Missing docker-compose.volumes.yml File
**Problem**: The system was looking for `docker-compose.volumes.yml` but it didn't exist in the expected location, causing Docker Compose commands to fail.

**Fix Applied**:
- Updated `getDockerComposeCommand()` to check if the volumes file exists before including it
- Made the volumes file inclusion conditional rather than mandatory

### 3. Certificate Generation Errors
**Problem**: Multiple issues with certificate generation causing delays:
- Firefox certificate database errors (non-critical but causing delays)
- Wildcard domain expansion errors in fish shell
- Repeated certificate generation attempts

**Fixes Applied**:
- Added proper escaping for wildcard domains in mkcert commands
- Improved error handling for non-critical Firefox certificate issues
- Made certificate generation more robust with better fallback handling

### 4. Shell Detection Performance
**Problem**: Shell detection was happening multiple times and not being cached properly.

**Fix Applied**:
- Improved shell detection caching
- Added smarter shell priority to avoid problematic shells
- Better fallback mechanisms

## Code Changes Made

### 1. Shell Utility Updates (`shell-utils.ts`)
```typescript
// Added fish shell with lower priority
unix: [
  { shell: '/bin/bash', args: ['-c'], priority: 1 },
  { shell: '/bin/zsh', args: ['-c'], priority: 2 },
  { shell: '/bin/sh', args: ['-c'], priority: 3 },
  // ... other shells
  { shell: '/usr/local/bin/fish', args: ['-c'], priority: 20 },
]

// Added shell-specific command formatting
private formatCommandForShell(command: string, shell: string): string {
  if (shell && shell.includes('fish')) {
    return command.replace(/\*\./g, '\\*\\.');
  }
  return command;
}

// Skip fish shell in environment detection
if (envShell && !envShell.includes('fish') && await this._isShellAvailable(envShell)) {
  return envShell;
}
```

### 2. Environment Isolation Updates (`environment-isolation.ts`)
```typescript
static getDockerComposeCommand(setupPath: string): string {
  // Check if volumes file exists
  const volumesFilePath = path.join(setupPath, "docker-compose.volumes.yml");
  let composeFiles = "-f docker-compose.yml";

  try {
    if (fs.existsSync(volumesFilePath)) {
      composeFiles += " -f docker-compose.volumes.yml";
    }
  } catch (error) {
    // If we can't check, just use the base file
  }

  return `docker compose -p ${projectName} ${composeFiles}`;
}
```

### 3. Certificate Service Updates (`certificate-service.ts`)
```typescript
// Properly escape domains for shell execution
const escapedDomains = domains.map(domain => {
  if (domain.includes('*')) {
    // Quote wildcard domains to prevent shell expansion
    return `"${domain}"`;
  }
  return domain;
});
```

## Performance Improvements

1. **Reduced Certificate Generation Time**: Fixed wildcard escaping eliminates failed attempts
2. **Faster Docker Commands**: Conditional volumes file inclusion prevents file not found errors
3. **Better Shell Detection**: Prioritizes compatible shells to avoid syntax issues
4. **Reduced Error Retry Loops**: Better error handling prevents unnecessary retries

## Testing

To verify the fixes work:

1. **Test Shell Detection**:
   ```bash
   npx tsx src/test-shell-utils.ts
   ```

2. **Test Certificate Generation**:
   - Should no longer fail with wildcard errors
   - Should properly quote `*.ddalab.local` domain

3. **Test Docker Commands**:
   - Should work even if `docker-compose.volumes.yml` is missing
   - Should include volumes file when it exists

## Expected Results

- **Faster startup**: Elimination of failed certificate generation attempts
- **More reliable**: Better shell compatibility and error handling
- **Cleaner logs**: Fewer error messages and retries
- **Cross-platform**: Works reliably across different shell environments

## Monitoring

Watch for these log patterns to verify fixes:
- No more "fish: No matches for wildcard" errors
- No more "docker-compose.volumes.yml: no such file" errors
- Certificate generation should complete without wildcard errors
- Shell detection should prefer bash/zsh over fish
