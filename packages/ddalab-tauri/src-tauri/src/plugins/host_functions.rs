use anyhow::{Context, Result};
use parking_lot::Mutex;
use std::collections::HashSet;
use wasmtime::*;

use super::manifest::PluginPermission;

pub struct HostState {
    permissions: HashSet<PluginPermission>,
    metadata_json: Option<Vec<u8>>,
    logs: Mutex<Vec<String>>,
    progress: Mutex<u32>,
}

impl HostState {
    pub fn new(permissions: HashSet<PluginPermission>, metadata_json: Option<Vec<u8>>) -> Self {
        Self {
            permissions,
            metadata_json,
            logs: Mutex::new(Vec::new()),
            progress: Mutex::new(0),
        }
    }

    pub fn has_permission(&self, perm: &PluginPermission) -> bool {
        self.permissions.contains(perm)
    }

    pub fn logs(&self) -> Vec<String> {
        self.logs.lock().clone()
    }

    pub fn add_log(&self, msg: String) {
        self.logs.lock().push(msg);
    }
}

pub fn register_host_functions(linker: &mut Linker<HostState>) -> Result<()> {
    linker
        .func_wrap(
            "env",
            "host_log",
            |mut caller: Caller<'_, HostState>, ptr: i32, len: i32| -> i32 {
                let memory = match caller.get_export("memory") {
                    Some(Extern::Memory(m)) => m,
                    _ => return -1,
                };

                let mut buf = vec![0u8; len as usize];
                if memory.read(&caller, ptr as usize, &mut buf).is_err() {
                    return -1;
                }

                match String::from_utf8(buf) {
                    Ok(msg) => {
                        caller.data().add_log(msg);
                        0
                    }
                    Err(_) => -1,
                }
            },
        )
        .context("Failed to register host_log")?;

    linker
        .func_wrap(
            "env",
            "host_emit_progress",
            |caller: Caller<'_, HostState>, pct: i32| {
                let clamped = pct.clamp(0, 100) as u32;
                *caller.data().progress.lock() = clamped;
            },
        )
        .context("Failed to register host_emit_progress")?;

    linker
        .func_wrap(
            "env",
            "host_get_metadata",
            |mut caller: Caller<'_, HostState>, out_ptr: i32, out_cap: i32| -> i32 {
                if !caller
                    .data()
                    .has_permission(&PluginPermission::ReadMetadata)
                {
                    return -1; // Permission denied
                }

                let metadata = match &caller.data().metadata_json {
                    Some(m) => m.clone(),
                    None => return 0, // No metadata available
                };

                let len = metadata.len();
                if len > out_cap as usize {
                    return -2; // Buffer too small
                }

                let memory = match caller.get_export("memory") {
                    Some(Extern::Memory(m)) => m,
                    _ => return -3,
                };

                if memory
                    .write(&mut caller, out_ptr as usize, &metadata)
                    .is_err()
                {
                    return -3;
                }

                len as i32
            },
        )
        .context("Failed to register host_get_metadata")?;

    Ok(())
}
