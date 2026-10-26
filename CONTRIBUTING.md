# Contributing to DDALAB

First off, thank you for considering contributing to DDALAB! Whether you are fixing a bug, improving documentation, or adding a new analysis feature, your help is what makes scientific tools better for everyone.

## Code of Conduct

By participating in this project, you agree to maintain a professional and respectful environment. We prioritize clear communication, intellectual honesty, and constructive feedback.

## AI and LLM Usage

We embrace the use of **Large Language Models (LLMs)** and AI coding assistants (such as Claude, ChatGPT, or GitHub Copilot) to accelerate development.

- **Welcome:** Feel free to use AI to generate boilerplate, refactor code, or brainstorm implementations.
- **Review:** All code—whether human-written or AI-generated—must undergo the standard GitHub Pull Request review process to ensure quality and scientific accuracy.
- **Responsibility:** If you use an LLM, you are responsible for ensuring the code is functional, secure, and adheres to the project's architecture.

## How Can I Contribute?

### Reporting Bugs

- **Check the Issue Tracker:** See if the bug has already been reported.
- **Provide Context:** Include your Operating System, DDALAB version, and the type of data you were processing (e.g., EDF, BIDS).
- **Provide Logs:** For the web app, include the browser console output and the browser name and version. For the CLI, include the output of `ddalab -vv`.

### Pull Requests

1. **Fork the repo** and create your branch from `main`.
2. **Setup the environment** as described in the `README.md`.
3. **Follow the architecture:**

- Web application changes belong in `packages/ddalab-web`.
- Computational, reader, and CLI changes belong in `packages/dda-rs`. The browser runs the same crate through `packages/ddalab-wasm`.

4. **Update documentation:** If you add a feature, please update the relevant documentation in the `README.md` of the package you changed.

## Style & Formatting Guidelines

Before submitting a Pull Request, format the code for the language you changed and keep style consistent with the surrounding files.

For Rust changes, run:
`cargo fmt --manifest-path packages/dda-rs/Cargo.toml`

## Development Workflow

### Web application

`cd packages/ddalab-web && npm ci && npm run dev`

### Backend (Rust)

The analysis engine is built for performance. If you are modifying `dda-rs`:

- Do not overuse paralellization, as an overhead may be incurred for smaller parallel tasks.
- Ensure all processing remains local.
- Add a test case to verify accuracy.

## Recognition

All contributors will be acknowledged in the project documentation. For significant contributions to the codebase or methodology, we are happy to discuss co-authorship on future software publications.

---

**Questions?**
Feel free to reach out via GitHub Issues or contact Simon Dräger directly via `sdraeger` `at` `salk.edu`.
