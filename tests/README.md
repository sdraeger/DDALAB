# DDALAB Tests

This directory contains tests for the DDALAB Python client and server.

## Structure

- `unit/`: Unit tests for individual components
- `integration/`: Integration tests for client-server interaction

## Running Tests

Tests can be run using tox:

```bash
# Run all tests
tox

# Run only unit tests
tox -- tests/unit

# Run only integration tests
tox -- tests/integration

# Run with specific Python version
tox -e py311

# Run with coverage report
tox -- --cov=ddalab --cov=server --cov-report=html
```

## Test Requirements

The tests require the following dependencies:
- pytest
- pytest-cov
- pytest-mock
- requests-mock
- pytest-asyncio
- httpx

These dependencies are automatically installed by tox in the test environment.

## Adding New Tests

When adding new tests:
1. Place unit tests in the `unit/` directory
2. Place integration tests in the `integration/` directory
3. Use appropriate fixtures from `conftest.py`
4. Follow the naming convention: `test_*.py` for test files and `test_*` for test functions 