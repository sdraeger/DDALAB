//! BIDS Dataset Writer
//!
//! Creates BIDS-compliant folder structure and generates sidecar files.
//! Does NOT write the actual EEG data - that's done by EdfWriter/BrainVisionWriter.

use crate::intermediate_format::IntermediateData;
use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{FileWriterError, FileWriterResult};

/// BIDS dataset description (dataset_description.json)
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct DatasetDescription {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bids_version: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funding: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "HowToAcknowledge")]
    pub how_to_acknowledge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dataset_d_o_i: Option<String>,
}

/// EEG sidecar JSON (*_eeg.json)
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct EegSidecar {
    pub task_name: String,
    pub sampling_frequency: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power_line_frequency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "EEGReference")]
    pub eeg_reference: Option<String>,
    pub software_filters: String,
    pub recording_type: String,
}

/// Channel entry for *_channels.tsv
#[derive(Serialize)]
pub struct ChannelEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    pub units: String,
    pub sampling_frequency: f64,
    pub status: String,
}

/// Event entry for *_events.tsv
#[derive(Serialize)]
pub struct EventEntry {
    pub onset: f64,
    pub duration: f64,
    pub trial_type: String,
}

/// BIDS file assignment information
pub struct BIDSFileInfo {
    pub subject_id: String,
    pub session_id: Option<String>,
    pub task: String,
    pub run: Option<u32>,
}

pub struct BIDSWriter;

impl BIDSWriter {
    pub fn new() -> Self {
        Self
    }

    /// Create the BIDS folder structure for a dataset
    pub fn create_folder_structure(
        &self,
        output_dir: &Path,
        files: &[(BIDSFileInfo, &IntermediateData)],
    ) -> FileWriterResult<()> {
        // Create root directory
        fs::create_dir_all(output_dir)?;

        // Collect unique subject/session combinations
        let mut paths: HashSet<PathBuf> = HashSet::new();

        for (info, _) in files {
            let mut path = output_dir.join(format!("sub-{}", info.subject_id));

            if let Some(ref session) = info.session_id {
                path = path.join(format!("ses-{}", session));
            }

            path = path.join("eeg");
            paths.insert(path);
        }

        // Create all directories
        for path in paths {
            fs::create_dir_all(&path)?;
        }

        Ok(())
    }

    /// Generate dataset_description.json
    pub fn write_dataset_description(
        &self,
        output_dir: &Path,
        name: &str,
        authors: &[String],
        license: Option<&str>,
        funding: Option<&str>,
    ) -> FileWriterResult<()> {
        let description = DatasetDescription {
            name: name.to_string(),
            bids_version: Some("1.9.0".to_string()),
            authors: authors.to_vec(),
            license: license.map(|s| s.to_string()),
            funding: funding.map(|f| vec![f.to_string()]),
            how_to_acknowledge: None,
            dataset_d_o_i: None,
        };

        let path = output_dir.join("dataset_description.json");
        let json = serde_json::to_string_pretty(&description)
            .map_err(|e| FileWriterError::FormatError(e.to_string()))?;

        let mut file = File::create(&path)?;
        file.write_all(json.as_bytes())?;

        Ok(())
    }

    /// Generate participants.tsv
    pub fn write_participants_tsv(
        &self,
        output_dir: &Path,
        subject_ids: &[&str],
    ) -> FileWriterResult<()> {
        let path = output_dir.join("participants.tsv");
        let mut file = File::create(&path)?;

        // Header
        writeln!(file, "participant_id")?;

        // Rows
        for id in subject_ids {
            writeln!(file, "sub-{}", id)?;
        }

        Ok(())
    }

    /// Generate README
    pub fn write_readme(&self, output_dir: &Path, dataset_name: &str) -> FileWriterResult<()> {
        let path = output_dir.join("README");
        let mut file = File::create(&path)?;

        writeln!(file, "# {}", dataset_name)?;
        writeln!(file)?;
        writeln!(file, "This dataset was exported from DDALAB.")?;
        writeln!(file)?;
        writeln!(
            file,
            "For more information about BIDS, see: https://bids.neuroimaging.io"
        )?;

        Ok(())
    }

    /// Generate *_eeg.json sidecar for a file
    pub fn write_eeg_sidecar(
        &self,
        output_path: &Path,
        task: &str,
        sample_rate: f64,
        power_line_freq: Option<u32>,
        eeg_reference: Option<&str>,
    ) -> FileWriterResult<()> {
        let sidecar = EegSidecar {
            task_name: task.to_string(),
            sampling_frequency: sample_rate,
            power_line_frequency: power_line_freq,
            eeg_reference: eeg_reference.map(|s| s.to_string()),
            software_filters: "n/a".to_string(),
            recording_type: "continuous".to_string(),
        };

        let json = serde_json::to_string_pretty(&sidecar)
            .map_err(|e| FileWriterError::FormatError(e.to_string()))?;

        let mut file = File::create(output_path)?;
        file.write_all(json.as_bytes())?;

        Ok(())
    }

    /// Generate *_channels.tsv for a file
    pub fn write_channels_tsv(
        &self,
        output_path: &Path,
        data: &IntermediateData,
    ) -> FileWriterResult<()> {
        let mut file = File::create(output_path)?;

        // Header
        writeln!(file, "name\ttype\tunits\tsampling_frequency\tstatus")?;

        // Channel rows
        for channel in &data.channels {
            let channel_type = if channel.channel_type.is_empty() {
                "EEG"
            } else {
                &channel.channel_type
            };

            let units = if channel.unit.is_empty() {
                "µV"
            } else {
                &channel.unit
            };

            let sample_rate = channel.sample_rate.unwrap_or(data.metadata.sample_rate);

            writeln!(
                file,
                "{}\t{}\t{}\t{}\tgood",
                channel.label, channel_type, units, sample_rate
            )?;
        }

        Ok(())
    }

    /// Generate *_events.tsv from annotations (if any exist in custom_metadata)
    pub fn write_events_tsv(
        &self,
        output_path: &Path,
        events: &[(f64, f64, String)], // (onset, duration, trial_type)
    ) -> FileWriterResult<()> {
        if events.is_empty() {
            return Ok(()); // Don't create empty events file
        }

        let mut file = File::create(output_path)?;

        // Header
        writeln!(file, "onset\tduration\ttrial_type")?;

        // Event rows
        for (onset, duration, trial_type) in events {
            writeln!(file, "{}\t{}\t{}", onset, duration, trial_type)?;
        }

        Ok(())
    }

    /// Build BIDS filename from components
    pub fn build_filename(
        subject_id: &str,
        session_id: Option<&str>,
        task: &str,
        run: Option<u32>,
        suffix: &str,
        extension: &str,
    ) -> String {
        let mut parts = vec![format!("sub-{}", subject_id)];

        if let Some(session) = session_id {
            parts.push(format!("ses-{}", session));
        }

        parts.push(format!("task-{}", task));

        if let Some(run_num) = run {
            parts.push(format!("run-{:02}", run_num));
        }

        parts.push(suffix.to_string());

        format!("{}.{}", parts.join("_"), extension)
    }

    /// Get the directory path for a file within BIDS structure
    pub fn get_file_directory(
        output_dir: &Path,
        subject_id: &str,
        session_id: Option<&str>,
    ) -> PathBuf {
        let mut path = output_dir.join(format!("sub-{}", subject_id));

        if let Some(session) = session_id {
            path = path.join(format!("ses-{}", session));
        }

        path.join("eeg")
    }
}

impl Default for BIDSWriter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_filename() {
        assert_eq!(
            BIDSWriter::build_filename("01", None, "rest", None, "eeg", "edf"),
            "sub-01_task-rest_eeg.edf"
        );

        assert_eq!(
            BIDSWriter::build_filename("01", Some("baseline"), "rest", Some(1), "eeg", "edf"),
            "sub-01_ses-baseline_task-rest_run-01_eeg.edf"
        );

        assert_eq!(
            BIDSWriter::build_filename(
                "patient001",
                Some("01"),
                "eyesclosed",
                Some(2),
                "eeg",
                "json"
            ),
            "sub-patient001_ses-01_task-eyesclosed_run-02_eeg.json"
        );
    }

    #[test]
    fn test_get_file_directory() {
        let output = Path::new("/data/my_dataset");

        assert_eq!(
            BIDSWriter::get_file_directory(output, "01", None),
            PathBuf::from("/data/my_dataset/sub-01/eeg")
        );

        assert_eq!(
            BIDSWriter::get_file_directory(output, "01", Some("baseline")),
            PathBuf::from("/data/my_dataset/sub-01/ses-baseline/eeg")
        );
    }
}
