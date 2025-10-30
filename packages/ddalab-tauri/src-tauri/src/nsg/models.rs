use crate::api::handlers::dda::DDARequest;
use crate::db::{NSGJob, NSGJobStatus};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

impl NSGJob {
    pub fn new(tool: String, dda_params: DDARequest, input_file_path: String) -> Self {
        let params_json =
            serde_json::to_value(dda_params).unwrap_or_else(|_| serde_json::json!({}));

        Self::new_from_dda_params(tool, params_json, input_file_path)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGCredentials {
    pub username: String,
    pub password: String,
    pub app_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGJobRequest {
    pub tool: String,
    pub input_file_path: String,
    pub dda_params: DDARequest,
    pub metadata: Option<NSGJobMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGJobMetadata {
    pub status_email: bool,
    pub description: Option<String>,
    pub resource_config: Option<NSGResourceConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGResourceConfig {
    /// Maximum runtime in hours (default 1.0, max 48.0 for EXPANSE)
    pub runtime_hours: Option<f64>,
    /// Number of CPU cores (default 1, max 128 for EXPANSE)
    pub cores: Option<u32>,
    /// Number of nodes (usually 1 for single-node jobs)
    pub nodes: Option<u32>,
}

impl Default for NSGResourceConfig {
    fn default() -> Self {
        Self {
            runtime_hours: Some(1.0),
            cores: Some(1),
            nodes: Some(1),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGJobResponse {
    pub jobstatus: NSGJobStatusInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGJobStatusInfo {
    #[serde(rename = "jobHandle")]
    pub job_handle: String,
    #[serde(rename = "selfUri")]
    pub self_uri: NSGSelfUri,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGSelfUri {
    pub url: String,
    pub title: String,
}

impl NSGJobResponse {
    pub fn job_id(&self) -> &str {
        &self.jobstatus.job_handle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGJobStatusResponse {
    pub job_stage: String,
    pub messages: Vec<NSGMessage>,
    pub date_entered: Option<String>,
    pub date_terminated: Option<String>,
    pub failed: bool,
    pub output_files: Option<Vec<NSGOutputFile>>,
    pub results_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGMessage {
    pub stage: String,
    pub timestamp: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGOutputFile {
    pub filename: String,
    pub length: u64,
    pub download_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGToolParameter {
    pub name: String,
    pub value: String,
}

impl NSGJobStatusResponse {
    pub fn to_status(&self) -> NSGJobStatus {
        if self.failed {
            return NSGJobStatus::Failed;
        }

        match self.job_stage.as_str() {
            "SUBMITTED" => NSGJobStatus::Submitted,
            "QUEUE" => NSGJobStatus::Queue,
            "INPUTSTAGING" => NSGJobStatus::InputStaging,
            "RUNNING" | "RUN" => NSGJobStatus::Running,
            "COMPLETED" | "COMPLETE" => NSGJobStatus::Completed,
            "FAILED" | "TERMINATED" => NSGJobStatus::Failed,
            _ => NSGJobStatus::Submitted,
        }
    }

    pub fn get_error_message(&self) -> Option<String> {
        if self.failed {
            let error_msgs: Vec<String> = self
                .messages
                .par_iter()
                .filter(|m| {
                    m.text.contains("error")
                        || m.text.contains("Error")
                        || m.text.contains("failed")
                })
                .map(|m| m.text.clone())
                .collect();

            if !error_msgs.is_empty() {
                return Some(error_msgs.join("; "));
            }
            return Some("Job failed".to_string());
        }
        None
    }
}
