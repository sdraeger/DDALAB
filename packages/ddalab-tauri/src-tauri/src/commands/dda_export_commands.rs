use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_dda_export_file(
    app: tauri::AppHandle,
    content: String,
    format: String,
    default_filename: String,
) -> Result<Option<String>, String> {
    log::info!(
        "Saving DDA export file (format: {}, filename: {})",
        format,
        default_filename
    );

    let (filter_name, filter_ext) = match format.as_str() {
        "csv" => ("CSV Files", vec!["csv"]),
        "json" => ("JSON Files", vec!["json"]),
        _ => return Err(format!("Unsupported format: {}", format)),
    };

    let save_path = app
        .dialog()
        .file()
        .add_filter(filter_name, &filter_ext)
        .set_file_name(&default_filename)
        .blocking_save_file();

    if let Some(file_path) = save_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();

        std::fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))?;

        log::info!("Successfully saved DDA export to: {}", path_str);

        Ok(Some(path_str))
    } else {
        log::info!("Export cancelled by user");
        Ok(None)
    }
}

#[tauri::command]
pub async fn save_plot_export_file(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    format: String,
    default_filename: String,
) -> Result<Option<String>, String> {
    log::info!(
        "Saving plot export file (format: {}, filename: {}, size: {} bytes)",
        format,
        default_filename,
        image_data.len()
    );

    let (filter_name, filter_ext) = match format.as_str() {
        "png" => ("PNG Files", vec!["png"]),
        "svg" => ("SVG Files", vec!["svg"]),
        "pdf" => ("PDF Files", vec!["pdf"]),
        _ => return Err(format!("Unsupported format: {}", format)),
    };

    let save_path = app
        .dialog()
        .file()
        .add_filter(filter_name, &filter_ext)
        .set_file_name(&default_filename)
        .blocking_save_file();

    if let Some(file_path) = save_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();

        std::fs::write(path, image_data).map_err(|e| format!("Failed to write file: {}", e))?;

        log::info!("Successfully saved plot export to: {}", path_str);

        Ok(Some(path_str))
    } else {
        log::info!("Export cancelled by user");
        Ok(None)
    }
}
