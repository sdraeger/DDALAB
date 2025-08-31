# Shell Utility Documentation

## Overview

The Shell Utility provides a robust, cross-platform abstraction for executing shell commands in the ConfigManager application. It automatically detects the best available shell on the system and provides a consistent interface for command execution.

## Features

- **Automatic Shell Detection**: Detects the best available shell based on platform and availability
- **Cross-Platform Compatibility**: Works on Windows, macOS, Linux, and other Unix-like systems
- **Fallback Mechanisms**: Multiple fallback options to ensure command execution works
- **Consistent Interface**: Same API across all platforms
- **Error Handling**: Comprehensive error handling and logging
- **Shell Argument Escaping**: Platform-appropriate argument escaping

## Architecture

### Shell Priority Order

#### Windows (`win32`)
1. `powershell.exe` (highest priority)
2. `cmd.exe`
3. `cmd` (fallback)

#### Unix-like Systems (macOS, Linux, etc.)
1. `$SHELL` environment variable (if available)
2. `/bin/bash`
3. `/bin/zsh`
4. `/bin/sh`
5. `/usr/bin/bash`
6. `/usr/local/bin/bash`
7. `bash` (in PATH)
8. `zsh` (in PATH)
9. `sh` (in PATH, lowest priority)

### Detection Process

1. **Environment Check**: First checks `$SHELL` environment variable on Unix systems
2. **Availability Testing**: Tests each shell candidate by executing a simple command
3. **File System Check**: For absolute paths, verifies the shell executable exists and is executable
4. **Fallback**: If no preferred shell is found, uses system defaults
5. **Caching**: Results are cached to avoid repeated detection

## Usage

### Basic Command Execution

```typescript
import { shellUtils } from './utils/shell-utils';

// Execute a command and get result
const result = await shellUtils.execCommand('docker --version');
if (result.success) {
  console.log('Docker version:', result.stdout);
} else {
  console.error('Command failed:', result.stderr);
}
```

### Using with Node.js exec()

```typescript
// Use with standard Node.js exec function
shellUtils.exec('echo "Hello World"', {}, (error, stdout, stderr) => {
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Output:', stdout);
  }
});
```

### Getting Exec Options

```typescript
// Get exec options for manual use
const options = await shellUtils.getExecOptions({
  cwd: '/some/directory',
  env: { ...process.env, CUSTOM_VAR: 'value' }
});

exec('some-command', options, callback);
```

### Shell Information

```typescript
// Get current detected shell
const shell = shellUtils.getCurrentShell();
console.log('Current shell:', shell);

// Platform detection
if (shellUtils.isWindows()) {
  console.log('Running on Windows');
}

// Command separator
const separator = shellUtils.getCommandSeparator();
console.log('Command separator:', separator); // ' && '
```

### Argument Escaping

```typescript
// Escape arguments for shell execution
const arg = 'file with spaces.txt';
const escaped = shellUtils.escapeShellArg(arg);
console.log('Escaped:', escaped); // "file with spaces.txt" or 'file with spaces.txt'
```

## API Reference

### Methods

#### `detectShell(): Promise<string>`
Detects and returns the best available shell for the current platform.

#### `execCommand(command: string, options?: ExecOptions): Promise<ExecResult>`
Executes a command and returns a promise with the result.

#### `exec(command: string, options: ExecOptions, callback: Function): void`
Executes a command using Node.js exec with proper shell options.

#### `getExecOptions(additionalOptions?: ExecOptions): Promise<ExecOptions>`
Returns exec options with the detected shell configured.

#### `getCurrentShell(): string | null`
Returns the currently detected shell (synchronous).

#### `resetDetection(): void`
Forces re-detection of the shell (useful for testing).

#### `isWindows(): boolean`
Returns true if running on Windows platform.

#### `getCommandSeparator(): string`
Returns the platform-appropriate command separator.

#### `escapeShellArg(arg: string): string`
Escapes a shell argument for safe execution.

### Types

#### `ExecResult`
```typescript
interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code?: number;
}
```

## Error Handling

The shell utility includes comprehensive error handling:

1. **Shell Detection Failures**: Falls back to system defaults
2. **Command Execution Errors**: Returns structured error information
3. **Platform Compatibility**: Handles platform-specific differences
4. **Logging**: All errors are logged for debugging

## Best Practices

### Do's
- Use `shellUtils.execCommand()` for simple command execution
- Use `shellUtils.exec()` when you need Node.js exec callback interface
- Check `result.success` before using command output
- Use `shellUtils.escapeShellArg()` for user-provided arguments

### Don'ts
- Don't hardcode shell paths or names
- Don't assume a specific shell is available
- Don't use raw user input in shell commands without escaping
- Don't bypass the shell utility for command execution

## Testing

Run the test script to verify shell utility functionality:

```bash
npx tsx src/test-shell-utils.ts
```

The test script verifies:
- Shell detection
- Command execution
- Error handling
- Platform detection
- Argument escaping
- Docker command availability

## Browser Compatibility

For renderer processes, a browser-compatible version is available:

```typescript
import { shellUtils } from './utils/shell-utils-browser';
// Provides limited functionality suitable for browser environment
```

## Migration from Direct exec() Calls

### Before
```typescript
exec(command, {
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
}, callback);
```

### After
```typescript
shellUtils.exec(command, {}, callback);
```

## Troubleshooting

### Common Issues

1. **"No suitable shell found"**: Check if any shell is available on the system
2. **Command execution failures**: Verify the command exists and is in PATH
3. **Permission errors**: Ensure the shell executable has proper permissions

### Debug Information

Enable debug logging to see shell detection process:
```typescript
import { logger } from './utils/logger';
logger.setLevel(LogLevel.DEBUG);
```

This will show detailed information about:
- Shell detection attempts
- Command execution details
- Error conditions
