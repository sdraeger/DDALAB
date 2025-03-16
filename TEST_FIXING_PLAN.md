# Test Fixing Plan

This document outlines the plan for fixing the remaining tests in the DDALAB project.

## Current Status

Currently, only the simple tests in `tests/unit/test_simple.py` are passing. The other tests need to be updated to match the actual implementation of the codebase.

## Issues Identified

Based on the test runs, the following issues have been identified:

1. **Dataclass Frozen Instances**: Tests like `test_app_state_update` are failing due to `FrozenInstanceError` when trying to modify dataclass instances. (Fixed in `test_client_state.py`)
2. **Missing Attributes**: Several tests are failing due to `AttributeError` messages indicating missing attributes in classes like `FileHandler` and `AppState`.
3. **Async Function Handling**: Some tests are not properly handling async functions with `await`.
4. **Mock Configuration**: Tests are not correctly mocking dependencies and external services.
5. **Assertion Errors**: Some tests have incorrect assertions that don't match the actual implementation.
6. **Deprecation Warnings**: Several deprecation warnings appear during test runs:
   - Pydantic class-based config deprecation
   - Passlib crypt deprecation
   - ~~SQLAlchemy declarative_base deprecation~~ (Fixed)

## Fixing Approach

The approach to fixing the tests will be incremental, focusing on one test file at a time:

### Phase 1: Fix Unit Tests

1. **~~Fix `test_client_state.py`~~**: (Completed)
   - ~~Update tests to handle frozen dataclasses correctly~~
   - ~~Fix logger attribute issues~~

2. **Fix `test_file_handler.py`**:
   - Update tests to match the current `FileHandler` implementation
   - Fix async function handling with proper `await` statements
   - Update mocks for `config_manager` and other dependencies

3. **Fix `test_server_auth.py`**:
   - Update tests to handle async functions correctly
   - Fix JWT token validation and user authentication tests

4. **Fix `test_server_config.py`**:
   - Update tests to match the current server configuration implementation
   - Fix environment variable mocking

5. **Fix `test_graphql_client.py`**:
   - Update tests to properly mock server connections
   - Fix error handling tests

6. **Fix remaining unit tests**:
   - Update tests for `test_server_api.py`, `test_server_health.py`, etc.

### Phase 2: Fix Integration Tests

1. **Fix `test_client_server_integration.py`**:
   - Update server startup handling
   - Fix client-server connection tests

### Phase 3: Improve Test Coverage

1. **Add new tests** for untested functionality
2. **Improve coverage** for partially tested modules

### Phase 4: Fix Deprecation Warnings

1. **Update Pydantic models**:
   - Replace class-based `config` with `ConfigDict` in all Pydantic models

2. **~~Fix SQLAlchemy deprecation~~**: (Completed)
   - ~~Update import in `server/core/database.py` to use `sqlalchemy.orm.declarative_base()`~~

3. **Address Passlib warning**:
   - Investigate alternatives to the deprecated 'crypt' functionality
   - Update the code to use recommended alternatives

## Implementation Plan

For each test file:

1. **Analyze the actual implementation** of the code being tested
2. **Update the test** to match the implementation
3. **Run the test** to see if it passes
4. **Fix any issues** that arise
5. **Document changes** made to the tests

## Timeline

- **Week 1**: Fix unit tests (Phase 1)
- **Week 2**: Fix integration tests (Phase 2)
- **Week 3**: Improve test coverage (Phase 3)
- **Week 4**: Fix deprecation warnings (Phase 4)

## Conclusion

By following this plan, we will incrementally fix all the tests in the DDALAB project, ensuring that they accurately reflect the current implementation of the codebase and provide good test coverage. 