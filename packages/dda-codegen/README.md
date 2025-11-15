# DDA Code Generator

Generates language bindings for DDA (Delay Differential Analysis) from a single YAML specification.

## Overview

This tool parses `DDA_SPEC.yaml` and generates consistent, type-safe code for multiple programming languages:

- **Rust**: Variant metadata, CLI constants, and helper functions
- **Python**: Variant metadata and utility functions
- **TypeScript**: Type definitions for frontend integration
- **Julia**: (Future) Julia package bindings

## Features

- ✅ **Single Source of Truth**: All implementations derived from `DDA_SPEC.yaml`
- ✅ **Type Safety**: Generates fully-typed code with compile-time checks
- ✅ **Comprehensive Tests**: Auto-generated test suites for each language
- ✅ **Documentation**: Inline documentation from spec descriptions
- ✅ **Consistent APIs**: Identical behavior across all languages

## Usage

### Generate Code for All Languages

```bash
cargo run --manifest-path packages/dda-codegen/Cargo.toml
```

### Generate for Specific Languages

```bash
cargo run --manifest-path packages/dda-codegen/Cargo.toml -- --languages rust,python
```

### Dry Run (Preview Only)

```bash
cargo run --manifest-path packages/dda-codegen/Cargo.toml -- --dry-run --verbose
```

### CLI Options

```
Options:
  -s, --spec <SPEC>              Path to DDA_SPEC.yaml [default: DDA_SPEC.yaml]
  -o, --output <OUTPUT>          Output directory root [default: packages]
  -l, --languages <LANGUAGES>    Languages to generate [default: rust,python,typescript]
      --dry-run                  Don't write files
  -v, --verbose                  Verbose logging
  -h, --help                     Print help
```

## Output Structure

```
packages/
├── dda-rs/src/generated/
│   ├── mod.rs
│   ├── variants.rs          # Variant registry & helpers
│   └── cli.rs               # CLI constants
├── dda-py/src/dda_py/generated/
│   └── variants.py          # Python variant metadata
└── ddalab-tauri/src/types/generated/
    └── variants.ts          # TypeScript types
```

## Integration

### Rust

```rust
use dda_rs::generated::variants::*;

// Access variant metadata
let st = VariantMetadata::from_abbrev("ST").unwrap();
println!("Stride: {}", st.stride);

// Generate SELECT mask
let mask = generate_select_mask(&["ST", "SY"]);
assert_eq!(mask, [1, 0, 0, 0, 0, 1]);

// Parse SELECT mask
let enabled = parse_select_mask(&[1, 0, 0, 0, 0, 1]);
assert_eq!(enabled, vec!["ST", "SY"]);
```

### Python

```python
from dda_py.generated.variants import *

# Access variant metadata
st = get_variant_by_abbrev("ST")
print(f"Stride: {st.stride}")

# Generate SELECT mask
mask = generate_select_mask(["ST", "SY"])
assert mask == [1, 0, 0, 0, 0, 1]

# Parse SELECT mask
enabled = parse_select_mask([1, 0, 0, 0, 0, 1])
assert enabled == ["ST", "SY"]
```

### TypeScript

```typescript
import { VARIANT_REGISTRY, generateSelectMask, parseSelectMask } from '@/types/generated/variants';

// Access variant metadata
const st = getVariantByAbbrev("ST");
console.log(`Stride: ${st?.stride}`);

// Generate SELECT mask
const mask = generateSelectMask(["ST", "SY"]);
// Result: [1, 0, 0, 0, 0, 1]

// Parse SELECT mask
const enabled = parseSelectMask([1, 0, 0, 0, 0, 1]);
// Result: ["ST", "SY"]
```

## Development Workflow

### 1. Update the Spec

```bash
vim DDA_SPEC.yaml
```

### 2. Regenerate Code

```bash
npm run codegen  # or cargo run as shown above
```

### 3. Review Changes

```bash
git diff packages/*/generated/
```

### 4. Test

```bash
# Test Rust generated code
cargo test --package dda-rs generated

# Test Python generated code
pytest packages/dda-py/tests/

# Test TypeScript (via frontend build)
npm run typecheck --workspace=ddalab-tauri
```

### 5. Commit

```bash
git add DDA_SPEC.yaml packages/*/generated/
git commit -m "feat: update DDA spec to add XYZ"
```

## Templates

Templates are located in `templates/` and use the Tera template engine:

```
templates/
├── rust/
│   ├── variants.tera
│   └── cli.tera
├── python/
│   └── variants.tera
└── typescript/
    └── variants.tera
```

### Custom Filters

- `snake_case`: Convert to snake_case
- `camel_case`: Convert to camelCase
- `pascal_case`: Convert to PascalCase
- `upper_snake_case`: Convert to UPPER_SNAKE_CASE

## CI/CD Integration

Add to your CI pipeline to ensure generated code stays in sync:

```yaml
# .github/workflows/codegen-check.yml
name: Check Code Generation

on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Generate code
        run: cargo run --manifest-path packages/dda-codegen/Cargo.toml

      - name: Check for differences
        run: |
          if ! git diff --quiet; then
            echo "❌ Generated code is out of sync with DDA_SPEC.yaml!"
            echo "Please run 'npm run codegen' and commit the changes."
            git diff
            exit 1
          fi
          echo "✅ Generated code is in sync"
```

## Extending to New Languages

To add support for a new language (e.g., Julia):

1. Create template directory: `templates/julia/`
2. Add templates: `variants.tera`, etc.
3. Update `generate_language_code()` in `src/main.rs`:
   ```rust
   "julia" => output_root.join("dda-jl/src/generated"),
   ```
4. Update default languages in CLI args
5. Test generation: `cargo run -- --languages julia`

## Architecture

### Code Generator (`src/main.rs`)

1. **Parse Spec**: Load and deserialize `DDA_SPEC.yaml`
2. **Prepare Context**: Sort variants, add metadata
3. **Render Templates**: Use Tera to render language-specific templates
4. **Write Files**: Save generated code to language-specific directories

### Template System

- **Tera Engine**: Rust-based template engine (similar to Jinja2)
- **Type-Safe Context**: Strongly-typed data passed to templates
- **Custom Filters**: Case conversion utilities
- **Conditional Logic**: `{% if %}`, `{% for %}` for dynamic generation

## Troubleshooting

### Generated code has compilation errors

1. Re-run with `--verbose` to see detailed output
2. Check template syntax in `templates/`
3. Verify spec structure matches expected format

### Spec parsing fails

- Validate YAML syntax: `yamllint DDA_SPEC.yaml`
- Check required fields are present
- Ensure enum values match expected strings

### Tests fail after regeneration

- Review spec changes that may have affected test expectations
- Update test data if spec changes are intentional
- Check template logic for correctness

## License

MIT

## Maintainers

DDALAB Team
