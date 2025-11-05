# API Module - Modular Architecture

This module contains a modular refactoring of the embedded API server functionality, extracted from the monolithic `embedded_api.rs` file (2693 lines).

## Module Structure

```
src/api/
├── mod.rs              # Public API exports
├── models.rs           # Data models and type definitions
├── auth.rs             # Authentication and security
├── state.rs            # API state management
├── utils.rs            # Utility functions and file handling
├── router.rs           # API router configuration
└── handlers/           # Route handlers directory
    ├── mod.rs          # Handler exports
    ├── health.rs       # Health check endpoint
    ├── files.rs        # File operations (list, info, chunks)
    ├── edf.rs          # EDF-specific operations
    ├── dda.rs          # DDA analysis handlers
    └── history.rs      # Analysis history management
```

## Modules

### `models.rs`

Contains all data structures used across the API:

- `EDFFileInfo` - File metadata
- `ChunkData` - Time series data chunks
- `DDAParameters` - Analysis parameters
- `DDAResult` - Analysis results
- `HealthStatus` - Server health status
- Request/Response models for all endpoints

### `auth.rs`

Authentication and security functionality:

- `generate_session_token()` - Secure token generation
- `constant_time_eq()` - Timing-attack resistant comparison
- `auth_middleware()` - Axum middleware for protected routes

### `state.rs`

API server state management:

- `ApiState` - Main state struct with thread-safe collections
- Session token management
- Analysis database integration (SQLite)
- File cache and result storage

### `utils.rs`

Utility functions for file handling:

- `FileType` - File format detection
- `create_file_info()` - Async file metadata extraction
- `read_file_metadata_with_reader()` - Modular file reader integration
- `generate_overview_with_file_reader()` - Overview data generation
- `read_edf_file_chunk()` - EDF-specific chunk reading

### `router.rs`

Router configuration and setup:

- `create_router()` - Main router factory function
- Public routes (health check)
- Protected routes (all other endpoints)
- CORS configuration
- Request body limit configuration
- 404 fallback handler

### `handlers/` Directory

All route handler functions organized by feature:

- **health.rs** - `/api/health` endpoint
- **files.rs** - `/api/files/*` endpoints (list, info, chunks)
- **edf.rs** - `/api/edf/*` endpoints (info, data, overview)
- **dda.rs** - `/api/dda/*` endpoints (analyze, results, status)
- **history.rs** - `/api/dda/history/*` endpoints (list, save, delete, rename)

## Migration Status

### ✅ Phase 1 Completed (Core Infrastructure)

- Core models extracted ([models.rs](models.rs:1))
- Authentication system modularized ([auth.rs](auth.rs:1))
- State management separated ([state.rs](state.rs:1))
- Utility functions organized ([utils.rs](utils.rs:1))

### ✅ Phase 2 Completed (Route Handlers)

- All route handlers extracted into `handlers/` directory
- Router configuration modularized ([router.rs](router.rs:1))
- Module compiles successfully with no errors
- Full backward compatibility maintained

### 📝 Status Summary

- **Original file**: `embedded_api.rs` (2693 lines) - remains functional
- **New modular API**: Fully extracted and operational
- **Total files created**: 11 new files
- **Lines of code organized**: ~2000+ lines modularized

The refactoring is complete! The original `embedded_api.rs` remains unchanged and functional. The new modular structure is available via `crate::api` and provides identical functionality with improved organization.

## Usage

### Creating a Router

```rust
use std::sync::Arc;
use crate::api::{ApiState, create_router};

// Create API state
let state = Arc::new(ApiState::new(data_directory));

// Create router with all endpoints configured
let router = create_router(state);

// Use with axum Server
axum::Server::bind(&addr)
    .serve(router.into_make_service())
    .await?;
```

### Using API Components

```rust
// Import models
use crate::api::{
    EDFFileInfo,
    ChunkData,
    DDAResult,
    DDAParameters,
    HealthStatus,
};

// Import utilities
use crate::api::{
    FileType,
    create_file_info,
    generate_overview_with_file_reader,
};

// Import state management
use crate::api::{
    ApiState,
    generate_session_token,
};
```

## Benefits

1. **Modularity** - Clear separation of concerns
2. **Maintainability** - Easier to locate and modify specific functionality
3. **Testability** - Individual modules can be unit tested
4. **Reusability** - Components can be reused across different contexts
5. **Scalability** - Easy to add new features without bloating single files

## Design Principles

This refactoring follows SOLID principles:

- **Single Responsibility** - Each module has one clear purpose
- **Open/Closed** - Easy to extend without modifying existing code
- **Dependency Inversion** - Modules depend on abstractions, not implementations
