# DDALAB Testing Guide

This document provides guidance on how to run and extend the tests for the DDALAB project.

## Test Structure

The tests are organized in the following structure:

```
tests/
├── __init__.py
├── conftest.py
├── integration/
│   ├── __init__.py
│   └── test_client_server_integration.py
└── unit/
    ├── __init__.py
    ├── test_client_config.py
    ├── test_client_state.py
    ├── test_error_handler.py
    ├── test_file_handler.py
    ├── test_graphql_client.py
    ├── test_server_api.py
    ├── test_server_auth.py
    ├── test_server_config.py
    ├── test_server_health.py
    └── test_simple.py
```

- `unit/`: Contains unit tests for individual components
- `integration/`: Contains integration tests for client-server interaction
- `conftest.py`: Contains common fixtures for tests

## Running Tests

Tests can be run using the provided scripts:

```bash
# Run all tests (currently only running simple tests)
./run_tests.sh

# Run tests using tox directly
tox

# Run specific tests
tox -- tests/unit/test_simple.py

# Run with specific Python version
tox -e py311

# Run with coverage report
tox -- --cov=ddalab --cov=server --cov-report=html
```

## Current Status

The following tests are currently passing:
- All tests in `tests/unit/test_simple.py` (basic arithmetic operations)
- All tests in `tests/unit/test_client_state.py` (state management)

The other tests need to be updated to match the actual implementation of the codebase.

## Adding New Tests

When adding new tests:

1. Place unit tests in the `unit/` directory
2. Place integration tests in the `integration/` directory
3. Use appropriate fixtures from `conftest.py`
4. Follow the naming convention: `test_*.py` for test files and `test_*` for test functions
5. Run the tests with `tox` to ensure they pass

## Test Dependencies

The tests require the following dependencies:

- pytest
- pytest-cov
- pytest-mock
- requests-mock
- pytest-asyncio
- httpx

These dependencies are automatically installed by tox in the test environment.

## Fixing Existing Tests

To fix the existing tests:

1. Read the actual implementation of the code being tested
2. Update the test to match the implementation
3. Run the test to see if it passes
4. If it fails, check the error message and update the test accordingly

## Handling Deprecation Warnings

The test runs may show several deprecation warnings:

### Resolved Warnings

1. **pytest-asyncio default fixture loop scope**:
   - Fixed by adding `asyncio_default_fixture_loop_scope = "function"` to the `[tool.pytest.ini_options]` section in `pyproject.toml`.

2. **SQLAlchemy declarative_base deprecation**:
   - Fixed by updating the import in `server/core/database.py` from `sqlalchemy.ext.declarative import declarative_base` to `from sqlalchemy.orm import declarative_base`.

### Remaining Warnings

1. **Pydantic class-based config**:
   - Warning: "Support for class-based `config` is deprecated, use ConfigDict instead."
   - To fix: Update Pydantic models to use ConfigDict instead of class-based configs.

2. **Passlib crypt deprecation**:
   - Warning: "'crypt' is deprecated and slated for removal in Python 3.13"
   - This is coming from a dependency and may require updating passlib or using an alternative.

## Pre-commit Hooks

The project includes pre-commit hooks for running tests and fixing imports:

```bash
# Install pre-commit hooks
./install_hooks.sh

# Run import sorting manually
./fix_imports.sh
```
