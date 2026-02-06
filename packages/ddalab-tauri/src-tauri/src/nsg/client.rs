use super::models::{
    NSGCredentials, NSGJobResponse, NSGJobStatusInfo, NSGJobStatusResponse, NSGSelfUri,
};
use anyhow::{anyhow, Context, Result};
use reqwest::{multipart, Client};
use std::path::Path;
use std::time::Duration;

const NSG_BASE_URL: &str = "https://nsgr.sdsc.edu:8443/cipresrest/v1";
const DEFAULT_TIMEOUT_SECS: u64 = 300; // 5 minutes for large file uploads

// Security: Maximum allowed XML response size (1 MB)
const MAX_XML_RESPONSE_SIZE: usize = 1024 * 1024;
// Security: Maximum allowed length for individual XML field values
const MAX_XML_FIELD_LENGTH: usize = 1000;
// Security: Maximum allowed URL length in XML responses
const MAX_XML_URL_LENGTH: usize = 2048;

// Security: Maximum allowed download file size (10 GB)
const MAX_DOWNLOAD_FILE_SIZE: u64 = 10 * 1024 * 1024 * 1024;
// Security: Minimum required free disk space multiplier (1.5x file size)
const DISK_SPACE_MULTIPLIER: f64 = 1.5;

/// Validates that a string contains only safe characters for XML field values.
/// Allows alphanumeric, common punctuation, and whitespace.
fn is_valid_xml_field_chars(s: &str) -> bool {
    s.chars().all(|c| {
        c.is_alphanumeric()
            || c.is_whitespace()
            || matches!(
                c,
                '-' | '_'
                    | '.'
                    | ':'
                    | '/'
                    | '@'
                    | '+'
                    | '='
                    | '?'
                    | '&'
                    | '%'
                    | '#'
                    | '!'
                    | ','
                    | ';'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | '\''
                    | '"'
            )
    })
}

/// Extracts and validates an XML field value with security constraints.
/// Returns None if the field is not found, exceeds max_len, or contains invalid characters.
fn extract_xml_field_validated(xml: &str, tag: &str, max_len: usize) -> Option<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);

    let start = xml.find(&open_tag)?;
    let start_idx = start + open_tag.len();
    let remaining = xml.get(start_idx..)?;
    let end = remaining.find(&close_tag)?;

    // Security: Validate length before allocation
    if end > max_len {
        log::warn!(
            "XML field '{}' exceeds maximum length ({} > {})",
            tag,
            end,
            max_len
        );
        return None;
    }

    let value = remaining.get(..end)?;

    // Security: Validate character set
    if !is_valid_xml_field_chars(value) {
        log::warn!("XML field '{}' contains invalid characters", tag);
        return None;
    }

    Some(value.to_string())
}

/// Extracts a nested XML field (e.g., <outer><inner>value</inner></outer>)
fn extract_nested_xml_field_validated(
    xml: &str,
    outer_tag: &str,
    inner_tag: &str,
    max_len: usize,
) -> Option<String> {
    let open_tag = format!("<{}>", outer_tag);
    let close_tag = format!("</{}>", outer_tag);

    let start = xml.find(&open_tag)?;
    let start_idx = start + open_tag.len();
    let remaining = xml.get(start_idx..)?;
    let end = remaining.find(&close_tag)?;
    let outer_content = remaining.get(..end)?;

    extract_xml_field_validated(outer_content, inner_tag, max_len)
}

/// Validates the size of an XML response before processing.
fn validate_xml_response_size(response: &str) -> Result<()> {
    if response.len() > MAX_XML_RESPONSE_SIZE {
        return Err(anyhow!(
            "XML response exceeds maximum allowed size ({} > {} bytes)",
            response.len(),
            MAX_XML_RESPONSE_SIZE
        ));
    }
    Ok(())
}

pub struct NSGClient {
    client: Client,
    base_url: String,
    credentials: NSGCredentials,
}

impl NSGClient {
    pub fn new(credentials: NSGCredentials) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .danger_accept_invalid_certs(false)
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            base_url: NSG_BASE_URL.to_string(),
            credentials,
        })
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url;
        self
    }

    pub async fn test_connection(&self) -> Result<bool> {
        let url = format!("{}/job/{}", self.base_url, self.credentials.username);

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to connect to NSG")?;

        Ok(response.status().is_success() || response.status().as_u16() == 404)
    }

    pub async fn submit_job(
        &self,
        tool: &str,
        input_file_path: &Path,
        parameters: Vec<(String, String)>,
        status_email: bool,
    ) -> Result<NSGJobResponse> {
        let url = format!("{}/job/{}", self.base_url, self.credentials.username);

        let file_name = input_file_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| anyhow!("Invalid file path"))?;

        let file_bytes = tokio::fs::read(input_file_path)
            .await
            .context("Failed to read input file")?;

        let file_size_mb = file_bytes.len() as f64 / (1024.0 * 1024.0);
        log::info!(
            "📤 Submitting NSG job: tool={}, file={} ({:.2} MB)",
            tool,
            file_name,
            file_size_mb
        );

        let mut form = multipart::Form::new().text("tool", tool.to_string()).part(
            "input.infile_",
            multipart::Part::bytes(file_bytes)
                .file_name(file_name.to_string())
                .mime_str("application/octet-stream")
                .context("Failed to set MIME type")?,
        );

        if status_email {
            form = form.text("metadata.statusEmail", "true");
        }

        log::debug!("NSG URL: {}", url);
        log::debug!("NSG parameters: {:?}", parameters);

        for (key, value) in parameters {
            form = form.text(key, value);
        }

        let response = match self
            .client
            .post(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            // Note: Don't set Accept header for multipart uploads - NSG returns 406
            // We'll parse XML response instead
            .multipart(form)
            .send()
            .await
        {
            Ok(resp) => {
                log::info!("Received response from NSG");
                resp
            }
            Err(e) => {
                log::error!("Failed to send request to NSG: {:?}", e);
                if e.is_timeout() {
                    return Err(anyhow!(
                        "NSG request timed out after {} seconds",
                        DEFAULT_TIMEOUT_SECS
                    ));
                } else if e.is_connect() {
                    return Err(anyhow!("Failed to connect to NSG server: {}", e));
                } else {
                    return Err(anyhow!("Failed to submit job to NSG: {}", e));
                }
            }
        };

        let status = response.status();
        log::info!("NSG response status: {}", status);

        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            log::error!("NSG submission failed: {} - {}", status, error_text);
            return Err(anyhow!(
                "NSG job submission failed: {} - {}",
                status,
                error_text
            ));
        }

        // Get response text first for debugging
        let response_text = response
            .text()
            .await
            .context("Failed to read NSG response")?;

        log::debug!("NSG response body: {}", response_text);

        // Security: Validate response size before processing
        validate_xml_response_size(&response_text)?;

        // Try to parse as JSON first
        let job_response = if let Ok(json_response) =
            serde_json::from_str::<NSGJobResponse>(&response_text)
        {
            json_response
        } else {
            // If JSON parsing fails, NSG might have returned XML - extract job ID from XML
            log::warn!("Failed to parse JSON response, attempting XML extraction");

            // Security: Extract and validate jobHandle from XML
            let job_id =
                    extract_xml_field_validated(&response_text, "jobHandle", MAX_XML_FIELD_LENGTH)
                        .ok_or_else(|| {
                            anyhow!(
                            "Failed to extract valid job ID from NSG response (missing, too long, or invalid characters)"
                        )
                        })?;

            log::info!("Extracted job ID from XML: {}", job_id);

            // Create a minimal NSGJobResponse structure
            // Since we only need the job_id for mark_submitted, we can use a placeholder structure
            NSGJobResponse {
                jobstatus: NSGJobStatusInfo {
                    job_handle: job_id.clone(),
                    self_uri: NSGSelfUri {
                        url: format!(
                            "https://nsgr.sdsc.edu:8443/cipresrest/v1/job/{}/{}",
                            self.credentials.username, job_id
                        ),
                        title: job_id,
                    },
                },
            }
        };

        log::info!("NSG job submitted: {}", job_response.job_id());

        Ok(job_response)
    }

    pub async fn get_job_status(&self, job_url: &str) -> Result<NSGJobStatusResponse> {
        let response = self
            .client
            .get(job_url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            // Note: Don't set Accept header - NSG may return 406
            // We'll parse XML response instead
            .send()
            .await
            .context("Failed to get job status from NSG")?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!(
                "Failed to get job status: {} - {}",
                status,
                error_text
            ));
        }

        // Try JSON first, fall back to XML if needed
        let response_text = response
            .text()
            .await
            .context("Failed to read NSG status response")?;

        // Security: Validate response size before processing
        validate_xml_response_size(&response_text)?;

        let status_response = if let Ok(json_response) =
            serde_json::from_str::<NSGJobStatusResponse>(&response_text)
        {
            json_response
        } else {
            // NSG returned XML - parse manually
            log::warn!("NSG returned XML for job status, parsing manually");

            // Security: Extract and validate job_stage
            let job_stage =
                extract_xml_field_validated(&response_text, "jobStage", MAX_XML_FIELD_LENGTH)
                    .unwrap_or_else(|| "UNKNOWN".to_string());

            // Check if failed
            let failed = response_text.contains("<failed>true</failed>");

            // Security: Extract and validate resultsUri (nested URL field)
            let results_uri = extract_nested_xml_field_validated(
                &response_text,
                "resultsUri",
                "url",
                MAX_XML_URL_LENGTH,
            );

            NSGJobStatusResponse {
                job_stage,
                messages: Vec::new(), // XML message parsing is complex, skip for now
                date_entered: None,
                date_terminated: None,
                failed,
                output_files: None,
                results_uri,
            }
        };

        Ok(status_response)
    }

    pub async fn download_output_file<F>(
        &self,
        download_uri: &str,
        output_path: &Path,
        total_size: u64,
        mut progress_callback: F,
    ) -> Result<()>
    where
        F: FnMut(u64, u64),
    {
        log::info!(
            "📥 Downloading NSG output file to: {} (size: {} bytes)",
            output_path.display(),
            total_size
        );

        // Security: Validate file size against maximum limit
        if total_size > MAX_DOWNLOAD_FILE_SIZE {
            return Err(anyhow!(
                "File size ({} bytes) exceeds maximum allowed download size ({} bytes). \
                 Please download this file manually.",
                total_size,
                MAX_DOWNLOAD_FILE_SIZE
            ));
        }

        // Security: Ensure output directory exists and check disk space
        let output_dir = output_path
            .parent()
            .ok_or_else(|| anyhow!("Invalid output path: no parent directory"))?;

        tokio::fs::create_dir_all(output_dir)
            .await
            .context("Failed to create output directory")?;

        // Security: Check available disk space (need at least 1.5x file size)
        let required_space = (total_size as f64 * DISK_SPACE_MULTIPLIER) as u64;
        let available_space =
            fs2::available_space(output_dir).context("Failed to check available disk space")?;

        if available_space < required_space {
            return Err(anyhow!(
                "Insufficient disk space. Required: {} bytes (1.5x file size), \
                 Available: {} bytes. Free up disk space before downloading.",
                required_space,
                available_space
            ));
        }

        log::info!(
            "Disk space check passed: {} bytes available, {} bytes required",
            available_space,
            required_space
        );

        let response = self
            .client
            .get(download_uri)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to download output file")?;

        let status = response.status();
        if !status.is_success() {
            return Err(anyhow!("Failed to download file: {}", status));
        }

        // Security: Validate Content-Length header if present
        if let Some(content_length) = response.content_length() {
            if content_length > MAX_DOWNLOAD_FILE_SIZE {
                return Err(anyhow!(
                    "Server reported file size ({} bytes) exceeds maximum allowed ({} bytes)",
                    content_length,
                    MAX_DOWNLOAD_FILE_SIZE
                ));
            }

            // Warn if server-reported size differs significantly from declared size
            let size_diff = (content_length as i64 - total_size as i64).unsigned_abs();
            let tolerance = (total_size as f64 * 0.1) as u64; // 10% tolerance
            if size_diff > tolerance && total_size > 0 {
                log::warn!(
                    "Server Content-Length ({}) differs from declared size ({}) by more than 10%",
                    content_length,
                    total_size
                );
            }
        }

        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;

        let mut file = tokio::fs::File::create(output_path)
            .await
            .context("Failed to create output file")?;

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;

        // Security: Use effective_max_size for validation during download
        // This accounts for both the declared size and our hard limit
        let effective_max_size = if total_size > 0 {
            // Allow 10% overage from declared size, but never exceed hard limit
            std::cmp::min((total_size as f64 * 1.1) as u64, MAX_DOWNLOAD_FILE_SIZE)
        } else {
            MAX_DOWNLOAD_FILE_SIZE
        };

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.context("Failed to read chunk")?;

            // Security: Check if download would exceed maximum allowed size
            let new_downloaded = downloaded + chunk.len() as u64;
            if new_downloaded > effective_max_size {
                // Clean up partial file
                drop(file);
                let _ = tokio::fs::remove_file(output_path).await;
                return Err(anyhow!(
                    "Download aborted: actual size ({} bytes) exceeds limit ({} bytes). \
                     The server may have provided incorrect size information.",
                    new_downloaded,
                    effective_max_size
                ));
            }

            file.write_all(&chunk)
                .await
                .context("Failed to write chunk")?;

            downloaded = new_downloaded;
            progress_callback(downloaded, total_size);
        }

        file.flush().await.context("Failed to flush file")?;

        log::info!(
            "Downloaded output file: {} ({} bytes)",
            output_path.display(),
            downloaded
        );

        Ok(())
    }

    pub async fn cancel_job(&self, job_url: &str) -> Result<()> {
        log::info!("🛑 Cancelling NSG job: {}", job_url);

        let response = self
            .client
            .delete(job_url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to cancel job")?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!("Failed to cancel job: {} - {}", status, error_text));
        }

        log::info!("NSG job cancelled");

        Ok(())
    }

    pub async fn list_user_jobs(&self) -> Result<Vec<NSGJobResponse>> {
        let url = format!("{}/job/{}", self.base_url, self.credentials.username);

        log::info!("🔍 Fetching all jobs from NSG API: {}", url);

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to list jobs from NSG")?;

        let status = response.status();
        log::info!("📡 NSG list jobs response status: {}", status);

        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            log::error!("NSG list jobs failed: {} - {}", status, error_text);
            return Err(anyhow!("Failed to list jobs: {} - {}", status, error_text));
        }

        // Get response text - NSG returns XML for job list
        let response_text = response
            .text()
            .await
            .context("Failed to read NSG list response")?;

        log::debug!(
            "📄 NSG list jobs raw response (first 500 chars): {}",
            &response_text.chars().take(500).collect::<String>()
        );

        // Security: Validate response size before processing
        validate_xml_response_size(&response_text)?;

        // Parse XML to extract job IDs
        // NSG returns: <joblist><jobs><jobstatus><selfUri><title>JOB_ID</title>...
        let mut jobs = Vec::new();
        let jobstatus_tag = "<jobstatus>";
        let jobstatus_end = "</jobstatus>";
        let mut search_pos = 0;

        while let Some(job_start) = response_text[search_pos..].find(jobstatus_tag) {
            let job_start_idx = search_pos + job_start + jobstatus_tag.len();

            if let Some(job_end) = response_text[job_start_idx..].find(jobstatus_end) {
                let job_xml = &response_text[job_start_idx..job_start_idx + job_end];

                // Security: Extract and validate job handle from <selfUri><title>JOB_ID</title>
                if let Some(job_handle) = extract_nested_xml_field_validated(
                    job_xml,
                    "selfUri",
                    "title",
                    MAX_XML_FIELD_LENGTH,
                ) {
                    // Security: Extract and validate URL
                    let url = extract_xml_field_validated(job_xml, "url", MAX_XML_URL_LENGTH)
                        .unwrap_or_else(|| {
                            format!(
                                "{}/job/{}/{}",
                                self.base_url, self.credentials.username, job_handle
                            )
                        });

                    // Create minimal NSGJobResponse
                    jobs.push(NSGJobResponse {
                        jobstatus: super::models::NSGJobStatusInfo {
                            job_handle,
                            self_uri: super::models::NSGSelfUri {
                                url: url.clone(),
                                title: url.split('/').last().unwrap_or("").to_string(),
                            },
                        },
                    });
                }

                search_pos = job_start_idx + job_end + jobstatus_end.len();
            } else {
                break;
            }
        }

        log::info!("Successfully parsed {} jobs from NSG API (XML)", jobs.len());

        Ok(jobs)
    }

    pub fn username(&self) -> &str {
        &self.credentials.username
    }

    /// List output files for a completed job using the results URI
    pub async fn list_output_files(
        &self,
        results_uri: &str,
    ) -> Result<Vec<super::models::NSGOutputFile>> {
        log::info!("📂 Listing output files from: {}", results_uri);

        let response = self
            .client
            .get(results_uri)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to fetch output files list")?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!(
                "Failed to list output files: {} - {}",
                status,
                error_text
            ));
        }

        let response_text = response
            .text()
            .await
            .context("Failed to read output files response")?;

        log::debug!("Output files response: {}", response_text);

        // Security: Validate response size before processing
        validate_xml_response_size(&response_text)?;

        // Parse XML response to extract files
        // NSG uses <jobfile> elements in the results/output endpoint
        let mut files = Vec::new();
        let tag = "<jobfile>";
        let end_tag = "</jobfile>";
        let mut search_pos = 0;

        while let Some(file_start) = response_text[search_pos..].find(tag) {
            let file_start_idx = search_pos + file_start + tag.len();

            if let Some(file_end) = response_text[file_start_idx..].find(end_tag) {
                let file_xml = &response_text[file_start_idx..file_start_idx + file_end];

                // Security: Extract and validate filename
                let filename =
                    match extract_xml_field_validated(file_xml, "filename", MAX_XML_FIELD_LENGTH) {
                        Some(name) => name,
                        None => {
                            search_pos = file_start_idx + file_end + end_tag.len();
                            continue;
                        }
                    };

                // Security: Extract and validate download URI - nested in <downloadUri><url>
                let download_uri = match extract_nested_xml_field_validated(
                    file_xml,
                    "downloadUri",
                    "url",
                    MAX_XML_URL_LENGTH,
                ) {
                    Some(mut uri) => {
                        // Decode XML entities
                        uri = uri.replace("&amp;", "&");
                        uri
                    }
                    None => {
                        search_pos = file_start_idx + file_end + end_tag.len();
                        continue;
                    }
                };

                // Security: Extract and validate length (numeric field, max 20 chars for u64)
                let length = extract_xml_field_validated(file_xml, "length", 20)
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0);

                files.push(super::models::NSGOutputFile {
                    filename,
                    download_uri,
                    length,
                });

                search_pos = file_start_idx + file_end + end_tag.len();
            } else {
                break;
            }
        }

        log::info!("Found {} output files", files.len());

        Ok(files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nsg_client_creation() {
        let credentials = NSGCredentials {
            username: "test_user".to_string(),
            password: "test_pass".to_string(),
            app_key: "test_key".to_string(),
        };

        let client = NSGClient::new(credentials);
        assert!(client.is_ok());
    }

    #[test]
    fn test_custom_base_url() {
        let credentials = NSGCredentials {
            username: "test_user".to_string(),
            password: "test_pass".to_string(),
            app_key: "test_key".to_string(),
        };

        let client = NSGClient::new(credentials)
            .unwrap()
            .with_base_url("https://custom.url".to_string());

        assert_eq!(client.base_url, "https://custom.url");
    }

    #[test]
    fn test_extract_xml_field_validated_success() {
        let xml = "<root><jobHandle>NGBW-JOB-DDA_TG-12345</jobHandle></root>";
        let result = extract_xml_field_validated(xml, "jobHandle", 100);
        assert_eq!(result, Some("NGBW-JOB-DDA_TG-12345".to_string()));
    }

    #[test]
    fn test_extract_xml_field_validated_not_found() {
        let xml = "<root><other>value</other></root>";
        let result = extract_xml_field_validated(xml, "jobHandle", 100);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_xml_field_validated_exceeds_max_len() {
        let xml =
            "<root><jobHandle>this_is_a_very_long_value_that_exceeds_limit</jobHandle></root>";
        let result = extract_xml_field_validated(xml, "jobHandle", 10);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_xml_field_validated_invalid_chars() {
        let xml = "<root><jobHandle>value<script>alert('xss')</script></jobHandle></root>";
        let result = extract_xml_field_validated(xml, "jobHandle", 100);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_nested_xml_field_validated() {
        let xml = "<root><resultsUri><url>https://example.com/results</url></resultsUri></root>";
        let result = extract_nested_xml_field_validated(xml, "resultsUri", "url", 100);
        assert_eq!(result, Some("https://example.com/results".to_string()));
    }

    #[test]
    fn test_extract_nested_xml_field_validated_outer_not_found() {
        let xml = "<root><other><url>https://example.com</url></other></root>";
        let result = extract_nested_xml_field_validated(xml, "resultsUri", "url", 100);
        assert_eq!(result, None);
    }

    #[test]
    fn test_is_valid_xml_field_chars() {
        assert!(is_valid_xml_field_chars("NGBW-JOB-DDA_TG-12345"));
        assert!(is_valid_xml_field_chars(
            "https://example.com/path?query=1&other=2"
        ));
        assert!(is_valid_xml_field_chars("COMPLETED"));
        assert!(is_valid_xml_field_chars("file_name.txt"));
        assert!(!is_valid_xml_field_chars("value<script>"));
        assert!(!is_valid_xml_field_chars("value>other"));
        assert!(!is_valid_xml_field_chars("value\0null"));
    }

    #[test]
    fn test_validate_xml_response_size_ok() {
        let response = "a".repeat(1000);
        assert!(validate_xml_response_size(&response).is_ok());
    }

    #[test]
    fn test_validate_xml_response_size_too_large() {
        let response = "a".repeat(MAX_XML_RESPONSE_SIZE + 1);
        assert!(validate_xml_response_size(&response).is_err());
    }

    #[test]
    fn test_max_download_file_size_constant() {
        // Verify the constant is set to 10 GB
        assert_eq!(MAX_DOWNLOAD_FILE_SIZE, 10 * 1024 * 1024 * 1024);
    }

    #[test]
    fn test_disk_space_multiplier_constant() {
        // Verify the multiplier is 1.5x
        assert!((DISK_SPACE_MULTIPLIER - 1.5).abs() < f64::EPSILON);
    }
}
