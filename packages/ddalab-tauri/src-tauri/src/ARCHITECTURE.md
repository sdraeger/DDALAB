# Tauri Backend Architecture

This document describes the modular architecture of the DDALAB Tauri backend, following SOLID principles.

## Module Structure

### Core Modules

#### `main.rs`
- **Responsibility**: Application entry point and plugin initialization
- **Dependencies**: All command modules, app setup
- **Size**: ~66 lines (reduced from ~632 lines)

#### `models.rs`
- **Responsibility**: Data structures and type definitions (Single Responsibility)
- **Contains**:
  - `AppState`, `FileManagerState`, `PlotState`, `DDAState`
  - `AnalysisResult`, `WindowState`, `AppPreferences`
  - Default implementations for all models
- **Principles**: Interface Segregation (focused data contracts)

#### `state_manager.rs`
- **Responsibility**: State persistence and management (Single Responsibility)
- **Features**:
  - JSON state serialization/deserialization
  - State migration system
  - Analysis preview data management
  - Auto-save functionality
- **Principles**: Open/Closed (extensible for new state types)

#### `commands/mod.rs`
- **Responsibility**: Tauri command organization (Dependency Inversion)
- **Sub-modules**:
  - `state_commands.rs` - State CRUD operations
  - `api_commands.rs` - External API interactions
  - `window_commands.rs` - Window management
  - `preference_commands.rs` - User preferences and UI

#### `docker_stack.rs`
- **Responsibility**: Docker infrastructure management (Single Responsibility)
- **Features**:
  - Repository cloning and updates
  - Docker Compose lifecycle management
  - Service health monitoring
  - Environment configuration

#### `app_setup.rs`
- **Responsibility**: Application initialization (Single Responsibility)
- **Features**:
  - Window configuration
  - State manager initialization
  - Event handler registration

#### `utils.rs`
- **Responsibility**: Shared utility functions (DRY principle)
- **Functions**:
  - Directory path resolution
  - Configuration helpers
  - Logging utilities

## SOLID Principles Applied

### Single Responsibility Principle (SRP)
- Each module has one reason to change
- `state_manager.rs` only handles state persistence
- `docker_stack.rs` only manages Docker operations
- `commands/` modules are organized by domain

### Open/Closed Principle (OCP)
- New state types can be added without modifying existing code
- New commands can be added by creating new command modules
- State migration system is extensible

### Liskov Substitution Principle (LSP)
- All command functions follow the same `async fn -> Result<T, String>` pattern
- State update functions use consistent closure patterns

### Interface Segregation Principle (ISP)
- Command modules are segregated by functionality
- Models are focused on specific domains
- No module depends on interfaces it doesn't use

### Dependency Inversion Principle (DIP)
- High-level modules (`main.rs`) depend on abstractions (`commands::*`)
- State management is abstracted behind the `AppStateManager`
- Docker operations are encapsulated in `DockerStackManager`

## Benefits of Refactoring

1. **Maintainability**: Each module is focused and easier to understand
2. **Testability**: Individual modules can be unit tested in isolation
3. **Extensibility**: New features can be added without touching existing code
4. **Code Reuse**: Utilities can be shared across modules
5. **Team Development**: Multiple developers can work on different modules simultaneously

## File Size Reduction

- **Before**: `main.rs` had 632 lines
- **After**: `main.rs` has 66 lines (89% reduction)
- **Total LOC**: Distributed across 8 focused modules

## Command Organization

Commands are now logically grouped:

```rust
// State Management
get_app_state, update_file_manager_state, save_analysis_result

// API Operations
check_api_connection

// Window Management
create_popout_window, store_analysis_preview_data

// User Preferences
get_app_preferences, open_file_dialog, show_notification

// Docker Stack
setup_docker_stack, start_docker_stack, get_docker_stack_status
```

This architecture provides a solid foundation for future development while maintaining clean separation of concerns.
