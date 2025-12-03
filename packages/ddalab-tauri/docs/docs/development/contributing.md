---
sidebar_position: 2
---

# Contributing

Guide for contributing to DDALAB.

## Getting Started

### Prerequisites

- Node.js 20+
- Rust 1.75+
- npm 10+

### Setup

```bash
git clone https://github.com/sdraeger/DDALAB.git
cd DDALAB
npm install
cd packages/ddalab-tauri
npm run tauri:dev
```

## Development Workflow

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes
4. Run tests: `npm test`
5. Commit: `git commit -m "Add feature"`
6. Push: `git push origin feature/my-feature`
7. Open Pull Request

## Code Style

### TypeScript

- Use TypeScript strict mode
- Follow existing patterns
- Add types for all exports

### Rust

- Run `cargo fmt` before committing
- Run `cargo clippy` for lints
- Follow Rust API guidelines

## Testing

### Frontend

```bash
npm run test        # Run tests
npm run test:watch  # Watch mode
npm run typecheck   # Type checking
```

### Backend

```bash
cd src-tauri
cargo test          # Run tests
cargo clippy        # Linting
```

## Pull Request Guidelines

- Clear description
- Link related issues
- Include tests
- Update documentation
- Pass CI checks

## Questions?

Open an issue on GitHub.
