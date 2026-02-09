use anyhow::{bail, Context, Result};
use std::collections::HashSet;
use wasmtime::*;

use super::host_functions::HostState;
use super::manifest::PluginPermission;

const DEFAULT_FUEL: u64 = 1_000_000_000;
const DEFAULT_MEMORY_LIMIT: usize = 512 * 1024 * 1024; // 512 MB

pub struct PluginRuntime {
    engine: Engine,
}

impl PluginRuntime {
    pub fn new() -> Result<Self> {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.wasm_bulk_memory(true);

        let engine = Engine::new(&config).context("Failed to create WASM engine")?;

        Ok(Self { engine })
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub fn execute(
        &self,
        wasm_bytes: &[u8],
        input_json: &[u8],
        permissions: &HashSet<PluginPermission>,
        metadata_json: Option<Vec<u8>>,
    ) -> Result<Vec<u8>> {
        let module =
            Module::new(&self.engine, wasm_bytes).context("Failed to compile WASM module")?;

        let mut store = Store::new(
            &self.engine,
            HostState::new(permissions.clone(), metadata_json),
        );

        store.set_fuel(DEFAULT_FUEL)?;

        let mut linker = Linker::new(&self.engine);

        // Register host functions
        super::host_functions::register_host_functions(&mut linker)?;

        // Memory limits
        store.limiter(|state| state);

        let instance = linker
            .instantiate(&mut store, &module)
            .context("Failed to instantiate WASM module")?;

        // Get guest exports
        let malloc = instance
            .get_typed_func::<i32, i32>(&mut store, "plugin_malloc")
            .context("Plugin missing 'plugin_malloc' export")?;
        let run = instance
            .get_typed_func::<(i32, i32), i32>(&mut store, "plugin_run")
            .context("Plugin missing 'plugin_run' export")?;
        let memory = instance
            .get_memory(&mut store, "memory")
            .context("Plugin missing 'memory' export")?;

        // Allocate space in guest for input
        let input_len = input_json.len() as i32;
        let input_ptr = malloc
            .call(&mut store, input_len)
            .context("plugin_malloc failed")?;

        if input_ptr <= 0 {
            bail!("plugin_malloc returned invalid pointer: {}", input_ptr);
        }

        // Write input into guest memory
        memory
            .write(&mut store, input_ptr as usize, input_json)
            .context("Failed to write input to guest memory")?;

        // Call plugin_run
        let result_ptr = run
            .call(&mut store, (input_ptr, input_len))
            .context("plugin_run failed")?;

        if result_ptr <= 0 {
            bail!("plugin_run returned error code: {}", result_ptr);
        }

        // Read result length from first 4 bytes at result_ptr
        let mut len_bytes = [0u8; 4];
        memory
            .read(&store, result_ptr as usize, &mut len_bytes)
            .context("Failed to read result length")?;
        let result_len = u32::from_le_bytes(len_bytes) as usize;

        if result_len > DEFAULT_MEMORY_LIMIT {
            bail!(
                "Plugin result too large: {} bytes (limit: {})",
                result_len,
                DEFAULT_MEMORY_LIMIT
            );
        }

        // Read result data (starts after the 4-byte length prefix)
        let mut result_data = vec![0u8; result_len];
        memory
            .read(&store, result_ptr as usize + 4, &mut result_data)
            .context("Failed to read result data")?;

        // Collect logs from host state
        let host_state = store.data();
        let logs = host_state.logs();
        for log_msg in logs {
            log::info!("[plugin] {}", log_msg);
        }

        Ok(result_data)
    }

    pub fn read_manifest(&self, wasm_bytes: &[u8]) -> Result<Vec<u8>> {
        let module =
            Module::new(&self.engine, wasm_bytes).context("Failed to compile WASM module")?;

        let mut store = Store::new(&self.engine, HostState::new(HashSet::new(), None));
        store.set_fuel(DEFAULT_FUEL)?;

        let mut linker = Linker::new(&self.engine);
        super::host_functions::register_host_functions(&mut linker)?;
        store.limiter(|state| state);

        let instance = linker.instantiate(&mut store, &module)?;

        let get_manifest = instance
            .get_typed_func::<(), i32>(&mut store, "plugin_get_manifest")
            .context("Plugin missing 'plugin_get_manifest' export")?;
        let memory = instance
            .get_memory(&mut store, "memory")
            .context("Plugin missing 'memory' export")?;

        let manifest_ptr = get_manifest.call(&mut store, ())?;
        if manifest_ptr <= 0 {
            bail!(
                "plugin_get_manifest returned invalid pointer: {}",
                manifest_ptr
            );
        }

        // Read length prefix
        let mut len_bytes = [0u8; 4];
        memory.read(&store, manifest_ptr as usize, &mut len_bytes)?;
        let manifest_len = u32::from_le_bytes(len_bytes) as usize;

        if manifest_len > 1024 * 1024 {
            bail!("Manifest too large: {} bytes", manifest_len);
        }

        let mut manifest_data = vec![0u8; manifest_len];
        memory.read(&store, manifest_ptr as usize + 4, &mut manifest_data)?;

        Ok(manifest_data)
    }
}

impl ResourceLimiter for HostState {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> Result<bool> {
        Ok(desired <= DEFAULT_MEMORY_LIMIT)
    }

    fn table_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> Result<bool> {
        Ok(desired <= 100_000)
    }
}
