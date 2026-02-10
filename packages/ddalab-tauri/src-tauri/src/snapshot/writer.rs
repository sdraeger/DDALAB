use crate::db::annotation_db::AnnotationDatabase;
use crate::snapshot::types::*;
use anyhow::{Context, Result};
use ddalab_tauri::db::analysis_db::AnalysisDatabase;
use ddalab_tauri::utils::file_hash::compute_file_hash;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

pub struct SnapshotWriter<'a> {
    analysis_db: &'a AnalysisDatabase,
    annotation_db: &'a AnnotationDatabase,
    app_version: String,
}

impl<'a> SnapshotWriter<'a> {
    pub fn new(
        analysis_db: &'a AnalysisDatabase,
        annotation_db: &'a AnnotationDatabase,
        app_version: String,
    ) -> Self {
        Self {
            analysis_db,
            annotation_db,
            app_version,
        }
    }

    pub fn write_snapshot(
        &self,
        source_file_path: &str,
        output_path: &Path,
        analysis_ids: &[String],
        mode: &SnapshotMode,
        name: &str,
        description: Option<&str>,
        source_file_info: &SourceFileInfo,
        workflow: Option<&serde_json::Value>,
    ) -> Result<SnapshotManifest> {
        let file_hash =
            compute_file_hash(source_file_path).context("Failed to compute source file hash")?;

        let source_info = SourceFileInfo {
            original_path: source_file_info.original_path.clone(),
            file_name: source_file_info.file_name.clone(),
            file_hash,
            file_size: source_file_info.file_size,
            duration_seconds: source_file_info.duration_seconds,
            sample_rate: source_file_info.sample_rate,
            channels: source_file_info.channels.clone(),
            format: source_file_info.format.clone(),
        };

        let output_file =
            std::fs::File::create(output_path).context("Failed to create snapshot file")?;
        let mut zip = ZipWriter::new(output_file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        let mut analysis_entries = Vec::new();

        for analysis_id in analysis_ids {
            let analysis = self
                .analysis_db
                .get_analysis(analysis_id)
                .context("Failed to query analysis database")?
                .ok_or_else(|| anyhow::anyhow!("Analysis not found: {}", analysis_id))?;

            let results_file = match mode {
                SnapshotMode::Full => {
                    let msgpack_bytes = rmp_serde::to_vec_named(&analysis)
                        .context("Failed to serialize analysis to MessagePack")?;
                    let compressed = lz4_flex::compress_prepend_size(&msgpack_bytes);
                    let zip_path = format!("results/{}.msgpack.lz4", analysis_id);

                    zip.start_file(&zip_path, options)
                        .context("Failed to start ZIP entry for analysis")?;
                    zip.write_all(&compressed)
                        .context("Failed to write analysis data")?;

                    Some(zip_path)
                }
                SnapshotMode::RecipeOnly => None,
            };

            analysis_entries.push(SnapshotAnalysisEntry {
                id: analysis.id.clone(),
                name: analysis.name.clone(),
                created_at: analysis.timestamp.clone(),
                variant_name: analysis.variant_name.clone(),
                variant_display_name: analysis.variant_display_name.clone(),
                parameters: analysis.parameters.clone(),
                results_file,
            });
        }

        let file_annotations = self
            .annotation_db
            .get_file_annotations(source_file_path)
            .context("Failed to get annotations")?;
        let has_annotations = !file_annotations.global_annotations.is_empty()
            || !file_annotations.channel_annotations.is_empty();

        if has_annotations {
            let annotations_json = serde_json::to_string_pretty(&file_annotations)
                .context("Failed to serialize annotations")?;
            zip.start_file("annotations.json", options)
                .context("Failed to start ZIP entry for annotations")?;
            zip.write_all(annotations_json.as_bytes())
                .context("Failed to write annotations")?;
        }

        let has_workflow = workflow.is_some();
        if let Some(wf) = workflow {
            let workflow_json =
                serde_json::to_string_pretty(wf).context("Failed to serialize workflow")?;
            zip.start_file("workflow.json", options)
                .context("Failed to start ZIP entry for workflow")?;
            zip.write_all(workflow_json.as_bytes())
                .context("Failed to write workflow")?;
        }

        let manifest = SnapshotManifest {
            format_version: SNAPSHOT_FORMAT_VERSION.to_string(),
            mode: mode.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            application_version: self.app_version.clone(),
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            source_file: source_info,
            analyses: analysis_entries,
            has_annotations,
            has_workflow,
        };

        let manifest_json =
            serde_json::to_string_pretty(&manifest).context("Failed to serialize manifest")?;
        zip.start_file("manifest.json", options)
            .context("Failed to start ZIP entry for manifest")?;
        zip.write_all(manifest_json.as_bytes())
            .context("Failed to write manifest")?;

        zip.finish().context("Failed to finalize ZIP archive")?;

        Ok(manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ddalab_tauri::models::AnalysisResult;
    use std::io::Read;
    use tempfile::TempDir;

    #[test]
    fn test_write_snapshot_and_verify_zip_structure() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");

        let analysis_db_path = temp_dir.path().join("analysis.db");
        let annotation_db_path = temp_dir.path().join("annotations.db");
        let source_file_path = temp_dir.path().join("test_data.edf");
        let snapshot_path = temp_dir.path().join("test.ddalab");

        std::fs::write(&source_file_path, b"fake EDF data for testing")
            .expect("Failed to write test source file");

        let analysis_db =
            AnalysisDatabase::new(&analysis_db_path).expect("Failed to create analysis DB");
        let annotation_db =
            AnnotationDatabase::new(&annotation_db_path).expect("Failed to create annotation DB");

        let test_analysis = AnalysisResult {
            id: "test-analysis-001".to_string(),
            file_path: source_file_path.to_string_lossy().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            variant_name: "single_timeseries".to_string(),
            variant_display_name: "Single Timeseries (ST)".to_string(),
            parameters: serde_json::json!({
                "variants": ["single_timeseries"],
                "window_length": 1000,
                "window_step": 500,
                "selected_channels": ["Fp1", "Fp2"],
                "delay_list": [1, 2, 3]
            }),
            chunk_position: None,
            plot_data: Some(serde_json::json!({
                "results": {"summary": {"mean_complexity": 0.5}},
                "channels": ["Fp1", "Fp2"],
                "q_matrix": [[0.1, 0.2], [0.3, 0.4]],
                "status": "completed"
            })),
            name: Some("Test Analysis".to_string()),
        };
        analysis_db
            .save_analysis(&test_analysis)
            .expect("Failed to save analysis");

        let writer = SnapshotWriter::new(&analysis_db, &annotation_db, "1.2.8".to_string());

        let source_info = SourceFileInfo {
            original_path: source_file_path.to_string_lossy().to_string(),
            file_name: "test_data.edf".to_string(),
            file_hash: String::new(),
            file_size: 25,
            duration_seconds: Some(120.0),
            sample_rate: Some(256.0),
            channels: vec!["Fp1".to_string(), "Fp2".to_string()],
            format: "edf".to_string(),
        };

        let manifest = writer
            .write_snapshot(
                &source_file_path.to_string_lossy(),
                &snapshot_path,
                &["test-analysis-001".to_string()],
                &SnapshotMode::Full,
                "Test Snapshot",
                Some("A test snapshot"),
                &source_info,
                None,
            )
            .expect("Failed to write snapshot");

        assert_eq!(manifest.format_version, SNAPSHOT_FORMAT_VERSION);
        assert_eq!(manifest.name, "Test Snapshot");
        assert_eq!(manifest.analyses.len(), 1);
        assert!(!manifest.source_file.file_hash.is_empty());

        let snapshot_file = std::fs::File::open(&snapshot_path).expect("Failed to open snapshot");
        let mut archive = zip::ZipArchive::new(snapshot_file).expect("Failed to read ZIP");

        let mut found_manifest = false;
        let mut found_results = false;
        for i in 0..archive.len() {
            let file = archive.by_index(i).expect("Failed to read ZIP entry");
            let name = file.name().to_string();
            if name == "manifest.json" {
                found_manifest = true;
            }
            if name == "results/test-analysis-001.msgpack.lz4" {
                found_results = true;
            }
        }
        assert!(found_manifest, "manifest.json should be present in the ZIP");
        assert!(
            found_results,
            "results/test-analysis-001.msgpack.lz4 should be present in the ZIP"
        );

        let mut manifest_file = archive.by_name("manifest.json").expect("No manifest.json");
        let mut manifest_content = String::new();
        manifest_file
            .read_to_string(&mut manifest_content)
            .expect("Failed to read manifest");
        let parsed_manifest: SnapshotManifest =
            serde_json::from_str(&manifest_content).expect("Failed to parse manifest JSON");
        assert_eq!(parsed_manifest.analyses.len(), 1);
        assert_eq!(parsed_manifest.analyses[0].id, "test-analysis-001");
        assert!(parsed_manifest.analyses[0].results_file.is_some());
    }
}
