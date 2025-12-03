---
sidebar_position: 3
---

# Testing

Testing practices and guidelines for DDALAB.

## Frontend Testing

### Unit Tests

Using Vitest for component and utility testing.

```bash
npm run test
npm run test:watch
npm run test:coverage
```

### Component Tests

Testing React components with React Testing Library.

```typescript
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

test('renders button', () => {
  render(<Button>Click me</Button>);
  expect(screen.getByText('Click me')).toBeInTheDocument();
});
```

## Backend Testing

### Unit Tests

```bash
cd src-tauri
cargo test
```

### Integration Tests

```rust
#[test]
fn test_edf_reader() {
    let reader = EdfReader::new(Path::new("test.edf")).unwrap();
    assert!(reader.channels().len() > 0);
}
```

## E2E Testing

Using Playwright for end-to-end tests.

```bash
npx playwright test
```

## Test Data

Sample test files in `test-data/`:

- `sample.edf` - EDF test file
- `sample.vhdr` - BrainVision test

## CI/CD

Tests run automatically on:

- Pull requests
- Push to main
- Release builds
