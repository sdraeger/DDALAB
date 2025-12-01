# DDA Specification Package

This package is the **single source of truth** for DDA (Delay Differential Analysis) variant metadata and configuration. It uses Smithy IDL models with Rust as the canonical implementation and generates type-safe bindings for multiple languages.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Smithy Models                            │
│  model/traits.smithy, variants.smithy, cli.smithy, etc.    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Rust Library (dda_spec)                        │
│  Compile-time verified constants + utilities                │
│  src/lib.rs, variants.rs, cli.rs, output.rs                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Code Generator                            │
│  src/bin/codegen.rs + templates/*.tera                     │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌────────┐     ┌──────────┐    ┌─────────┐
         │ Python │     │TypeScript│    │  Julia  │
         │variants│     │ variants │    │Variants │
         └────────┘     └──────────┘    └─────────┘
```

## Usage

### Generate All Language Bindings

```bash
# From repo root
npm run codegen

# Or directly
cargo run --package dda-spec --release -- --output packages
```

### Dry Run (Preview)

```bash
cargo run --package dda-spec -- --dry-run --verbose
```

### Verify Generated Code

```bash
npm run codegen:check
```

### Generate Specific Languages

```bash
cargo run --package dda-spec -- --languages rust,typescript
```

## Generated Files

| Language   | Output Path                                    |
|------------|------------------------------------------------|
| Rust       | `dda-rs/src/generated/variants.rs`            |
| Python     | `dda-py/src/dda_py/generated/variants.py`     |
| TypeScript | `ddalab-tauri/src/types/generated/variants.ts`|
| Julia      | `dda-jl/src/generated/Variants.jl`            |

## DDA Variants

| Abbrev | Name              | Position | Stride | Output Suffix   |
|--------|-------------------|----------|--------|-----------------|
| ST     | Single Timeseries | 0        | 4      | `_ST`           |
| CT     | Cross-Timeseries  | 1        | 4      | `_CT`           |
| CD     | Cross-Dynamical   | 2        | 2      | `_CD_DDA_ST`    |
| DE     | Delay Embedding   | 4        | 1      | `_DE`           |
| SY     | Synchronization   | 5        | 1      | `_SY`           |

**Note:** Position 3 is reserved for internal use.

## SELECT Mask

The SELECT mask is a 6-bit array controlling which variants to run:

```
Position: [0,   1,   2,   3,        4,   5  ]
Variant:  [ST,  CT,  CD,  RESERVED, DE,  SY ]
```

Example: To run ST and SY: `[1, 0, 0, 0, 0, 1]`

## Adding a New Variant

1. Edit the Smithy model in `model/variants.smithy`
2. Add the Rust constant in `src/variants.rs`
3. Update `VARIANTS` and `VARIANT_ORDER` arrays
4. Run `cargo test` to verify
5. Run `npm run codegen` to regenerate bindings

## Development

```bash
# Run tests
cargo test --package dda-spec

# Check code
cargo check --package dda-spec

# Run codegen with verbose output
cargo run --package dda-spec -- --verbose
```

## Template Filters

Custom Tera filters available in templates:

- `snake_case`: HelloWorld → hello_world
- `upper_snake_case`: HelloWorld → HELLO_WORLD
- `camel_case`: hello_world → helloWorld
- `pascal_case`: hello_world → HelloWorld
- `pybool`: true → True (Python boolean)
