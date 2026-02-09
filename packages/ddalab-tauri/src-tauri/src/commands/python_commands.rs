use crate::file_readers::python_bridge;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvironmentInfo {
    pub detected: bool,
    pub python_path: Option<String>,
    pub has_mne: bool,
    pub mne_version: Option<String>,
}

/// Detect Python environment and MNE availability.
#[tauri::command]
pub async fn detect_python_environment() -> Result<PythonEnvironmentInfo, String> {
    let result = tokio::task::spawn_blocking(|| match python_bridge::detect_python() {
        Some(env) => PythonEnvironmentInfo {
            detected: true,
            python_path: Some(env.python_path),
            has_mne: env.has_mne,
            mne_version: env.mne_version,
        },
        None => PythonEnvironmentInfo {
            detected: false,
            python_path: None,
            has_mne: false,
            mne_version: None,
        },
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    Ok(result)
}

/// Test a specific Python path for MNE availability.
#[tauri::command]
pub async fn test_python_path(path: String) -> Result<PythonEnvironmentInfo, String> {
    let result =
        tokio::task::spawn_blocking(move || match python_bridge::detect_python_at(&path) {
            Some(env) => PythonEnvironmentInfo {
                detected: true,
                python_path: Some(env.python_path),
                has_mne: env.has_mne,
                mne_version: env.mne_version,
            },
            None => PythonEnvironmentInfo {
                detected: false,
                python_path: Some(path),
                has_mne: false,
                mne_version: None,
            },
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    Ok(result)
}
