# Logging System Documentation

## Overview

The ConfigManager application uses a comprehensive logging system that provides structured logging with different log levels, contextual loggers, and environment-based filtering.

## Features

- **Multiple Log Levels**: DEBUG, INFO, WARN, ERROR, FATAL
- **Contextual Loggers**: Create loggers with specific contexts
- **Environment-based Filtering**: Different log levels for development/production
- **File Logging**: Automatic file logging with rotation in production (main process)
- **Structured Logging**: JSON-formatted additional data
- **Browser Compatible**: Separate implementation for renderer process
- **IPC Integration**: Renderer logs are forwarded to main process

## Usage

### Main Process

```typescript
import { logger, createLogger } from './utils/logger';

// Use default logger
logger.info('Application started');
logger.debug('Debug information', { data: 'value' });
logger.error('An error occurred', error);

// Create contextual logger
const dbLogger = createLogger('database');
dbLogger.warn('Slow query', { duration: 5000 });
```

### Renderer Process

```typescript
import { logger } from '../utils/logger-client';

// Same API as main process
logger.info('Component mounted');
logger.error('Failed to fetch data', error);
```

### Preload Script

The preload script has its own lightweight logging:

```typescript
// Automatically filtered based on NODE_ENV
preloadLog.debug('Technical details'); // Only in development
preloadLog.info('Important event');    // Always in development
preloadLog.error('Critical error');    // Always shown
```

## Log Levels

1. **DEBUG** - Detailed information for debugging
2. **INFO** - General informational messages
3. **WARN** - Warning messages for potential issues
4. **ERROR** - Error messages for failures
5. **FATAL** - Critical errors that may cause application failure

## Environment Variables

- `LOG_LEVEL` - Set the minimum log level (DEBUG, INFO, WARN, ERROR, FATAL, NONE)
- `NODE_ENV` - Production mode enables file logging and sets default level to INFO
- `ENABLE_CONSOLE_LOG` - Force console logging in production

## Log Files

In production, logs are written to:
- Location: `{userData}/logs/ddalab-{date}.log`
- Rotation: Automatic when file exceeds 10MB
- Retention: Keeps last 5 log files

## Best Practices

1. **Use Appropriate Levels**:
   - DEBUG for verbose debugging info
   - INFO for general application flow
   - WARN for recoverable issues
   - ERROR for failures and exceptions

2. **Include Context**:
   ```typescript
   logger.error('Failed to save file', error, {
     filePath: '/path/to/file',
     userId: user.id
   });
   ```

3. **Create Contextual Loggers**:
   ```typescript
   const serviceLogger = createLogger('MyService');
   // Logs will show [MyService] in the output
   ```

4. **Avoid Console.log**:
   - All `console.log` statements have been replaced
   - Use the logger for consistency

## Migration Guide

### Replacing Console Statements

```typescript
// Before
console.log('User logged in:', userId);
console.error('Failed to connect:', error);
alert('Operation failed!');

// After
logger.info('User logged in', { userId });
logger.error('Failed to connect', error);
logger.error('Operation failed');
// TODO: Show UI notification instead of alert
```

### Creating Service Loggers

```typescript
// In a service file
import { createLogger } from '../utils/logger';
const logger = createLogger('ServiceName');

export class MyService {
  constructor() {
    logger.info('Service initialized');
  }
}
```

## Testing

Run the test script to verify logging:

```bash
npx tsx src/test-logger.ts
```

This will demonstrate all logging features including levels, contexts, and filtering.
