use serde::{Deserialize, Serialize};

/// Output format for BIDS EEG data files
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BIDSOutputFormat {
    Edf,
    Brainvision,
}

/// Assignment of a source file to BIDS subject/session/task/run
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSFileAssignment {
    pub source_path: String,
    pub subject_id: String,
    pub session_id: Option<String>,
    pub task: String,
    pub run: Option<u32>,
    pub file_name: String,
    pub duration: Option<f64>,
    pub channel_count: Option<usize>,
}

/// Dataset-level metadata for BIDS
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSDatasetMetadata {
    pub name: String,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub license: String,
    pub funding: Option<String>,
}

/// Export options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportOptions {
    pub output_format: BIDSOutputFormat,
    pub power_line_frequency: u32,
    pub eeg_reference: Option<String>,
}

/// Full export request from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportRequest {
    pub files: Vec<BIDSFileAssignment>,
    pub dataset: BIDSDatasetMetadata,
    pub options: BIDSExportOptions,
    pub output_path: String,
}

/// Progress update during export
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportProgress {
    pub current_file: usize,
    pub total_files: usize,
    pub current_file_name: String,
    pub step: String,
    pub percentage: u32,
}

/// Result of export operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportResult {
    pub success: bool,
    pub dataset_path: String,
    pub files_exported: usize,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

/// Validate a BIDS export request before executing
#[tauri::command]
pub async fn validate_bids_export(request: BIDSExportRequest) -> Result<Vec<String>, String> {
    let mut errors = Vec::new();

    // Check for empty files list
    if request.files.is_empty() {
        errors.push("No files selected for export".to_string());
    }

    // Check for empty dataset name
    if request.dataset.name.trim().is_empty() {
        errors.push("Dataset name is required".to_string());
    }

    // Check for duplicate subject+session+task+run combinations
    let mut seen = std::collections::HashSet::new();
    for file in &request.files {
        let key = format!(
            "sub-{}_ses-{}_task-{}_run-{}",
            file.subject_id,
            file.session_id.as_deref().unwrap_or("none"),
            file.task,
            file.run.unwrap_or(1)
        );
        if !seen.insert(key.clone()) {
            errors.push(format!(
                "Duplicate assignment: {} (file: {})",
                key, file.file_name
            ));
        }
    }

    // Validate subject IDs (alphanumeric only)
    for file in &request.files {
        if !file
            .subject_id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-')
        {
            errors.push(format!(
                "Invalid subject ID '{}': must be alphanumeric",
                file.subject_id
            ));
        }
    }

    Ok(errors)
}

/// Export files to BIDS format
#[tauri::command]
pub async fn export_to_bids(
    app_handle: tauri::AppHandle,
    request: BIDSExportRequest,
) -> Result<BIDSExportResult, String> {
    use crate::file_readers::FileReaderFactory;
    use crate::file_writers::{
        bids_writer::{BIDSFileInfo, BIDSWriter},
        BrainVisionWriter, EDFWriter, FileWriter, WriterConfig,
    };
    use std::path::Path;
    use tauri::Emitter;

    let output_dir = Path::new(&request.output_path);
    let mut warnings = Vec::new();
    let mut files_exported = 0;

    // Validate first
    let validation_errors = validate_bids_export(request.clone()).await?;
    if !validation_errors.is_empty() {
        return Ok(BIDSExportResult {
            success: false,
            dataset_path: String::new(),
            files_exported: 0,
            warnings: vec![],
            error: Some(validation_errors.join("; ")),
        });
    }

    // Create BIDS writer
    let bids_writer = BIDSWriter::new();

    // Collect file info for folder structure
    let file_infos: Vec<BIDSFileInfo> = request
        .files
        .iter()
        .map(|f| BIDSFileInfo {
            subject_id: f.subject_id.clone(),
            session_id: f.session_id.clone(),
            task: f.task.clone(),
            run: f.run,
        })
        .collect();

    // Create folder structure (directories only first)
    for info in &file_infos {
        let dir_path = BIDSWriter::get_file_directory(
            output_dir,
            &info.subject_id,
            info.session_id.as_deref(),
        );
        std::fs::create_dir_all(&dir_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Write dataset-level files
    let subject_ids: Vec<&str> = request
        .files
        .iter()
        .map(|f| f.subject_id.as_str())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    bids_writer
        .write_dataset_description(
            output_dir,
            &request.dataset.name,
            &request.dataset.authors,
            Some(&request.dataset.license),
            request.dataset.funding.as_deref(),
        )
        .map_err(|e| format!("Failed to write dataset_description.json: {}", e))?;

    bids_writer
        .write_participants_tsv(output_dir, &subject_ids)
        .map_err(|e| format!("Failed to write participants.tsv: {}", e))?;

    bids_writer
        .write_readme(output_dir, &request.dataset.name)
        .map_err(|e| format!("Failed to write README: {}", e))?;

    // Process each file
    let total_files = request.files.len();
    let writer_config = WriterConfig::default();

    for (idx, file_assignment) in request.files.iter().enumerate() {
        // Emit progress
        let progress = BIDSExportProgress {
            current_file: idx + 1,
            total_files,
            current_file_name: file_assignment.file_name.clone(),
            step: "reading".to_string(),
            percentage: ((idx as f32 / total_files as f32) * 100.0) as u32,
        };
        let _ = app_handle.emit("bids-export-progress", &progress);

        // Read source file
        let source_path = Path::new(&file_assignment.source_path);
        let reader = match FileReaderFactory::create_reader(source_path) {
            Ok(r) => r,
            Err(e) => {
                warnings.push(format!(
                    "Failed to read {}: {}",
                    file_assignment.file_name, e
                ));
                continue;
            }
        };

        let data = match FileReaderFactory::to_intermediate_data(reader.as_ref(), None) {
            Ok(d) => d,
            Err(e) => {
                warnings.push(format!(
                    "Failed to parse {}: {}",
                    file_assignment.file_name, e
                ));
                continue;
            }
        };

        // Emit converting progress
        let progress = BIDSExportProgress {
            current_file: idx + 1,
            total_files,
            current_file_name: file_assignment.file_name.clone(),
            step: "converting".to_string(),
            percentage: ((idx as f32 / total_files as f32) * 100.0 + 33.0) as u32,
        };
        let _ = app_handle.emit("bids-export-progress", &progress);

        // Determine output directory and filenames
        let eeg_dir = BIDSWriter::get_file_directory(
            output_dir,
            &file_assignment.subject_id,
            file_assignment.session_id.as_deref(),
        );

        let extension = match request.options.output_format {
            BIDSOutputFormat::Edf => "edf",
            BIDSOutputFormat::Brainvision => "vhdr",
        };

        let base_filename = BIDSWriter::build_filename(
            &file_assignment.subject_id,
            file_assignment.session_id.as_deref(),
            &file_assignment.task,
            file_assignment.run,
            "eeg",
            extension,
        );

        let data_path = eeg_dir.join(&base_filename);

        // Write data file
        let write_result = match request.options.output_format {
            BIDSOutputFormat::Edf => {
                let writer = EDFWriter::new();
                writer.write(&data, &data_path, &writer_config)
            }
            BIDSOutputFormat::Brainvision => {
                let writer = BrainVisionWriter::new();
                writer.write(&data, &data_path, &writer_config)
            }
        };

        if let Err(e) = write_result {
            warnings.push(format!(
                "Failed to write {}: {}",
                file_assignment.file_name, e
            ));
            continue;
        }

        // Emit sidecar progress
        let progress = BIDSExportProgress {
            current_file: idx + 1,
            total_files,
            current_file_name: file_assignment.file_name.clone(),
            step: "writing_sidecars".to_string(),
            percentage: ((idx as f32 / total_files as f32) * 100.0 + 66.0) as u32,
        };
        let _ = app_handle.emit("bids-export-progress", &progress);

        // Write sidecar files
        let json_filename = BIDSWriter::build_filename(
            &file_assignment.subject_id,
            file_assignment.session_id.as_deref(),
            &file_assignment.task,
            file_assignment.run,
            "eeg",
            "json",
        );
        let json_path = eeg_dir.join(&json_filename);

        bids_writer
            .write_eeg_sidecar(
                &json_path,
                &file_assignment.task,
                data.metadata.sample_rate,
                Some(request.options.power_line_frequency),
                request.options.eeg_reference.as_deref(),
            )
            .map_err(|e| format!("Failed to write EEG sidecar: {}", e))?;

        // Write channels.tsv
        let channels_filename = BIDSWriter::build_filename(
            &file_assignment.subject_id,
            file_assignment.session_id.as_deref(),
            &file_assignment.task,
            file_assignment.run,
            "channels",
            "tsv",
        );
        let channels_path = eeg_dir.join(&channels_filename);

        bids_writer
            .write_channels_tsv(&channels_path, &data)
            .map_err(|e| format!("Failed to write channels.tsv: {}", e))?;

        files_exported += 1;
    }

    // Emit completion
    let progress = BIDSExportProgress {
        current_file: total_files,
        total_files,
        current_file_name: "Complete".to_string(),
        step: "writing_sidecars".to_string(),
        percentage: 100,
    };
    let _ = app_handle.emit("bids-export-progress", &progress);

    Ok(BIDSExportResult {
        success: files_exported > 0,
        dataset_path: request.output_path,
        files_exported,
        warnings,
        error: None,
    })
}
