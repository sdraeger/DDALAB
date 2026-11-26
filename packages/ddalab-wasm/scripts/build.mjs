// Builds the ddalab-wasm crate with the workspace's `wasm-release` profile (+simd128 via root .cargo/config.toml)
// and stages the artifact at dist/ddalab_wasm.wasm for `npm pack` and local Node consumers.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = here('../../..');
const locked = process.env.CI ? ['--locked'] : [];

execFileSync(
  'cargo',
  ['build', '--profile', 'wasm-release', ...locked, '--target', 'wasm32-unknown-unknown', '-p', 'ddalab-wasm'],
  { cwd: root, stdio: 'inherit' },
);

const built = here('../../../target/wasm32-unknown-unknown/wasm-release/ddalab_wasm.wasm');
const distDir = here('../dist');
mkdirSync(distDir, { recursive: true });
copyFileSync(built, `${distDir}/ddalab_wasm.wasm`);
