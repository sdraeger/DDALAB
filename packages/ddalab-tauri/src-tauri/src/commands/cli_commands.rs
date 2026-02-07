use std::path::PathBuf;
use tauri::Manager;

/// Resolve the path to the bundled CLI binary within app resources.
fn resolve_cli_binary(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let binary_name = if cfg!(target_os = "windows") {
        "bin/ddalab.exe"
    } else {
        "bin/ddalab"
    };

    app_handle
        .path()
        .resolve(binary_name, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve CLI binary path: {}", e))
}

/// Get the platform-specific install directory.
fn install_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "windows") {
        let local_app_data =
            std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
        Ok(PathBuf::from(local_app_data).join("ddalab"))
    } else if cfg!(target_os = "macos") {
        Ok(PathBuf::from("/usr/local/bin"))
    } else {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(PathBuf::from(home).join(".local/bin"))
    }
}

/// Install the CLI binary to a PATH-accessible location.
///
/// - macOS: Symlinks to /usr/local/bin/ddalab
/// - Linux: Symlinks to ~/.local/bin/ddalab
/// - Windows: Copies to %LOCALAPPDATA%\ddalab\ddalab.exe and adds to user PATH
#[tauri::command]
pub async fn install_cli(app_handle: tauri::AppHandle) -> Result<String, String> {
    let source = resolve_cli_binary(&app_handle)?;
    if !source.exists() {
        return Err(format!(
            "CLI binary not found in app bundle: {}",
            source.display()
        ));
    }

    let dest_dir = install_dir()?;
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create directory {}: {}", dest_dir.display(), e))?;

    let binary_name = if cfg!(target_os = "windows") {
        "ddalab.exe"
    } else {
        "ddalab"
    };
    let dest = dest_dir.join(binary_name);

    // Remove existing symlink/file
    if dest.exists() || dest.is_symlink() {
        std::fs::remove_file(&dest)
            .map_err(|e| format!("Failed to remove existing {}: {}", dest.display(), e))?;
    }

    if cfg!(target_os = "windows") {
        // Windows: copy the binary
        std::fs::copy(&source, &dest).map_err(|e| format!("Failed to copy CLI binary: {}", e))?;

        // Add to user PATH via PowerShell
        add_to_windows_path(&dest_dir)?;
    } else {
        // Unix: create symlink
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source, &dest)
            .map_err(|e| format!("Failed to create symlink: {}", e))?;
    }

    Ok(format!(
        "CLI installed to {}. Run 'ddalab --help' to get started.",
        dest.display()
    ))
}

/// Uninstall the CLI binary from PATH.
#[tauri::command]
pub async fn uninstall_cli() -> Result<String, String> {
    let dest_dir = install_dir()?;
    let binary_name = if cfg!(target_os = "windows") {
        "ddalab.exe"
    } else {
        "ddalab"
    };
    let dest = dest_dir.join(binary_name);

    if dest.exists() || dest.is_symlink() {
        std::fs::remove_file(&dest)
            .map_err(|e| format!("Failed to remove {}: {}", dest.display(), e))?;
        Ok(format!("CLI uninstalled from {}", dest.display()))
    } else {
        Ok("CLI is not currently installed".to_string())
    }
}

/// Check if the CLI is installed and accessible from PATH.
#[tauri::command]
pub async fn cli_install_status() -> Result<bool, String> {
    let dest_dir = install_dir()?;
    let binary_name = if cfg!(target_os = "windows") {
        "ddalab.exe"
    } else {
        "ddalab"
    };
    let dest = dest_dir.join(binary_name);
    Ok(dest.exists())
}

/// Windows: add directory to user PATH using PowerShell (no external crate needed).
#[cfg(target_os = "windows")]
fn add_to_windows_path(dir: &std::path::Path) -> Result<(), String> {
    let dir_str = dir
        .to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?;

    // Use PowerShell to check and update user PATH via the registry
    let script = format!(
        r#"
        $dir = '{}'
        $path = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($path -and $path.Split(';') -contains $dir) {{
            exit 0
        }}
        $newPath = if ($path) {{ "$path;$dir" }} else {{ $dir }}
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        "#,
        dir_str.replace('\'', "''")
    );

    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn add_to_windows_path(_dir: &std::path::Path) -> Result<(), String> {
    Ok(())
}
