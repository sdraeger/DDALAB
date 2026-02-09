# Plugin/Extension System Design

Design notes for DDALAB's plugin/extension system — covering execution safety, distribution, and trust model.

## Sandboxing: the foundation

The safety story starts with **how** plugins execute, not where they come from. Two viable approaches for a Tauri/Rust app:

### WebAssembly (WASM) sandbox

Most promising for DDALAB. Plugins compile to WASM and run in a sandboxed runtime (Wasmtime/Wasmer). They get zero OS access by default — no filesystem, no network, no process spawning. The host explicitly grants narrow capabilities:

- Read-only access to the analysis data being processed
- Write access only to their output slot
- No access to other plugins' data, user credentials, or the DB

This is the model Figma, Zed, and Envoy use. It's fast (near-native for numeric computation), deterministic (good for reproducibility), and language-agnostic (Rust, C, Python-via-pyodide, etc. all compile to WASM).

### Process isolation

Heavier alternative. Each plugin runs as a separate child process communicating over stdin/stdout JSON-RPC (like LSP). Easier to support arbitrary Python scripts (important for researchers), but harder to lock down.

### Hybrid approach (recommended)

WASM for "pure" analysis plugins, process isolation for plugins that need Python/MATLAB interop.

## Permission model

Borrow from browser extensions — declare capabilities upfront:

```yaml
# plugin.yaml
name: "spectral-entropy"
permissions:
  - read:channel_data    # can read loaded EEG channels
  - write:results        # can produce result output
  - ui:panel             # can render a side panel
# notably absent: network, filesystem, shell
```

Users see a clear permissions screen at install time. Plugins requesting `network` or `filesystem` get a prominent warning. The runtime enforces these — a plugin without `network` permission physically cannot make HTTP calls from the WASM sandbox.

## Distribution: a tiered trust model

Rather than one mechanism, use layers:

| Tier | Source | Trust | Review |
|------|--------|-------|--------|
| **Built-in** | Ships with DDALAB | Full trust | Our team reviews |
| **Verified** | Central registry | High trust | Automated checks + manual review for new publishers |
| **Community** | GitHub URL / registry | User's discretion | Automated checks only |
| **Local** | File on disk | User's discretion | None |

### Central registry

A simple static registry (JSON manifest on GitHub Pages or an S3 bucket) indexed by the app. Each entry points to a versioned WASM artifact with a content hash. No need to build a full npm-scale infrastructure — scientific tool ecosystems are small. Think of it like Julia's General registry or Homebrew taps.

### GitHub-native flow

Researchers already use GitHub. A plugin is a repo with a `ddalab-plugin.yaml` manifest. Users install by pasting the repo URL. The app fetches the latest release artifact and verifies its SHA-256 against the manifest. This avoids building a separate hosting platform entirely.

### Institution registries

For clinical/HIPAA environments, institutions can run a private registry (just a JSON file on their server) with only approved plugins. The `ddalab-server` can host this.

## Safety mechanisms

1. **Content-addressed artifacts** — Every plugin version is identified by its WASM blob's SHA-256. No mutable installs. You can always reproduce exactly what ran.

2. **Signature verification** — Plugin authors sign artifacts with a key. The registry stores public keys. The app verifies signatures before loading. New publishers require a brief review before their key is added to the trusted set.

3. **Automated analysis** — On registry submission, run:
   - WASM module inspection (what imports does it request?)
   - Static analysis for suspicious patterns
   - Determinism check (same input → same output across runs)
   - Size/resource bounds check

4. **Runtime resource limits** — WASM sandbox enforces:
   - Memory ceiling (e.g., 512MB)
   - Execution time limit (prevent infinite loops)
   - No spawning threads or processes
   - Fuel-based metering (Wasmtime supports this)

5. **Audit trail** — Log which plugins ran on which data, with version hashes. Critical for scientific reproducibility and compliance.

## Recommended approach for DDALAB

Given our user base (researchers, not general developers):

- **WASM sandbox** as the execution model — it's the only way to get real safety without trusting plugin authors
- **GitHub-based distribution** to start — researchers are already there, minimal infrastructure to build
- **Capability permissions** declared in manifest, enforced at runtime
- **Content hashing** for reproducibility (a paper can cite exactly which plugin version produced results)
- **Skip the full marketplace** initially — a curated `awesome-ddalab-plugins` list with verified entries is enough until the ecosystem grows

The key insight is that WASM gives you safety **by construction** rather than by review. You don't need to trust that a plugin author isn't malicious — the sandbox physically prevents bad behavior regardless.
