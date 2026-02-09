use ddalab_tauri::api::state::ApiState;
use ddalab_tauri::db::plugins_db::{InstalledPlugin, PluginsDB};
use ddalab_tauri::plugins::manager::{PluginManager, PluginOutput};
use ddalab_tauri::plugins::manifest::PluginManifest;
use ddalab_tauri::plugins::registry::{RegistryClient, RegistryEntry, RegistryIndex};
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::State;

pub struct PluginManagerState(pub Arc<Mutex<PluginManager>>);

#[tauri::command]
pub async fn list_installed_plugins(
    api_state: State<'_, Arc<ApiState>>,
) -> Result<Vec<InstalledPlugin>, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    db.with_connection(|conn| {
        let plugins_db = PluginsDB::new(conn);
        plugins_db
            .list_plugins()
            .map_err(|e| format!("Failed to list plugins: {}", e))
    })
}

#[tauri::command]
pub async fn install_plugin_from_registry(
    plugin_state: State<'_, PluginManagerState>,
    api_state: State<'_, Arc<ApiState>>,
    registry_url: String,
    plugin_id: String,
) -> Result<InstalledPlugin, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    // Fetch registry and find the plugin
    let client = RegistryClient::new();
    let index = client
        .fetch_index(&registry_url)
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))?;

    let entry = index
        .plugins
        .iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| format!("Plugin '{}' not found in registry", plugin_id))?
        .clone();

    // Download the WASM artifact
    let wasm_bytes = client
        .download_artifact(&entry)
        .await
        .map_err(|e| format!("Failed to download plugin: {}", e))?;

    // Install
    let manager = plugin_state.0.lock();
    manager
        .install_from_registry(&wasm_bytes, &entry, db)
        .map_err(|e| format!("Failed to install plugin: {}", e))
}

#[tauri::command]
pub async fn install_plugin_from_file(
    plugin_state: State<'_, PluginManagerState>,
    api_state: State<'_, Arc<ApiState>>,
    file_path: String,
    manifest: PluginManifest,
) -> Result<InstalledPlugin, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    let wasm_bytes =
        std::fs::read(&file_path).map_err(|e| format!("Failed to read WASM file: {}", e))?;

    let manager = plugin_state.0.lock();
    manager
        .install_from_bytes(&wasm_bytes, &manifest, "local", Some(&file_path), db)
        .map_err(|e| format!("Failed to install plugin: {}", e))
}

#[tauri::command]
pub async fn uninstall_plugin(
    plugin_state: State<'_, PluginManagerState>,
    api_state: State<'_, Arc<ApiState>>,
    plugin_id: String,
) -> Result<(), String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    let manager = plugin_state.0.lock();
    manager
        .uninstall(&plugin_id, db)
        .map_err(|e| format!("Failed to uninstall plugin: {}", e))
}

#[tauri::command]
pub async fn toggle_plugin(
    plugin_state: State<'_, PluginManagerState>,
    api_state: State<'_, Arc<ApiState>>,
    plugin_id: String,
    enabled: bool,
) -> Result<bool, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    let manager = plugin_state.0.lock();
    manager
        .set_enabled(&plugin_id, enabled, db)
        .map_err(|e| format!("Failed to toggle plugin: {}", e))
}

#[tauri::command]
pub async fn run_plugin(
    plugin_state: State<'_, PluginManagerState>,
    api_state: State<'_, Arc<ApiState>>,
    plugin_id: String,
    analysis_id: String,
) -> Result<PluginOutput, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    // Load the analysis data (IntermediateData) for the given analysis_id
    // For now, we load from the file path stored in the analysis
    let analysis = db
        .get_analysis_metadata(&analysis_id)
        .map_err(|e| format!("Failed to get analysis: {}", e))?
        .ok_or_else(|| format!("Analysis '{}' not found", analysis_id))?;

    // Load the file data
    let file_path = std::path::Path::new(&analysis.file_path);
    let reader = ddalab_tauri::file_readers::FileReaderFactory::create_reader(file_path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;
    let data = ddalab_tauri::file_readers::FileReaderFactory::to_intermediate_data(&*reader, None)
        .map_err(|e| format!("Failed to read file data: {}", e))?;

    let manager = plugin_state.0.lock();
    manager
        .run_plugin(&plugin_id, &data, db)
        .map_err(|e| format!("Failed to run plugin: {}", e))
}

#[tauri::command]
pub async fn fetch_plugin_registry(registry_url: String) -> Result<RegistryIndex, String> {
    let client = RegistryClient::new();
    client
        .fetch_index(&registry_url)
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))
}

#[tauri::command]
pub async fn get_installed_plugin(
    api_state: State<'_, Arc<ApiState>>,
    plugin_id: String,
) -> Result<Option<InstalledPlugin>, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    db.with_connection(|conn| {
        let plugins_db = PluginsDB::new(conn);
        plugins_db
            .get_plugin(&plugin_id)
            .map_err(|e| format!("Failed to get plugin: {}", e))
    })
}
