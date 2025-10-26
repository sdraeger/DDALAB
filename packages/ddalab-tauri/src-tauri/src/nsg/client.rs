use anyhow::{Context, Result, anyhow};
use reqwest::{Client, multipart};
use std::path::Path;
use std::time::Duration;
use super::models::{NSGCredentials, NSGJobResponse, NSGJobStatusResponse, NSGJobStatusInfo, NSGSelfUri};
use crate::db::NSGJobStatus;

const NSG_BASE_URL: &str = "https://nsgr.sdsc.edu:8443/cipresrest/v1";
const DEFAULT_TIMEOUT_SECS: u64 = 300; // 5 minutes for large file uploads

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

        let response = self.client
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
        log::info!("📤 Submitting NSG job: tool={}, file={} ({:.2} MB)", tool, file_name, file_size_mb);

        let mut form = multipart::Form::new()
            .text("tool", tool.to_string())
            .part(
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

        let response = match self.client
            .post(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            // Note: Don't set Accept header for multipart uploads - NSG returns 406
            // We'll parse XML response instead
            .multipart(form)
            .send()
            .await {
                Ok(resp) => {
                    log::info!("✓ Received response from NSG");
                    resp
                },
                Err(e) => {
                    log::error!("Failed to send request to NSG: {:?}", e);
                    if e.is_timeout() {
                        return Err(anyhow!("NSG request timed out after {} seconds", DEFAULT_TIMEOUT_SECS));
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
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            log::error!("NSG submission failed: {} - {}", status, error_text);
            return Err(anyhow!("NSG job submission failed: {} - {}", status, error_text));
        }

        // Get response text first for debugging
        let response_text = response.text().await
            .context("Failed to read NSG response")?;

        log::debug!("NSG response body: {}", response_text);

        // Try to parse as JSON first
        let job_response = if let Ok(json_response) = serde_json::from_str::<NSGJobResponse>(&response_text) {
            json_response
        } else {
            // If JSON parsing fails, NSG might have returned XML - extract job ID from XML
            log::warn!("Failed to parse JSON response, attempting XML extraction");

            // Extract jobHandle from XML using string operations
            let job_id = if let Some(start) = response_text.find("<jobHandle>") {
                let start_idx = start + "<jobHandle>".len();
                if let Some(end) = response_text[start_idx..].find("</jobHandle>") {
                    response_text[start_idx..start_idx + end].to_string()
                } else {
                    return Err(anyhow!("Failed to find closing </jobHandle> tag in NSG response"));
                }
            } else {
                return Err(anyhow!("Failed to extract job ID from NSG response. Response was: {}", response_text));
            };

            log::info!("Extracted job ID from XML: {}", job_id);

            // Create a minimal NSGJobResponse structure
            // Since we only need the job_id for mark_submitted, we can use a placeholder structure
            NSGJobResponse {
                jobstatus: NSGJobStatusInfo {
                    job_handle: job_id.clone(),
                    self_uri: NSGSelfUri {
                        url: format!("https://nsgr.sdsc.edu:8443/cipresrest/v1/job/{}/{}",
                                    self.credentials.username, job_id),
                        title: job_id,
                    },
                },
            }
        };

        log::info!("✅ NSG job submitted: {}", job_response.job_id());

        Ok(job_response)
    }

    pub async fn get_job_status(&self, job_url: &str) -> Result<NSGJobStatusResponse> {
        let response = self.client
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
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!("Failed to get job status: {} - {}", status, error_text));
        }

        // Try JSON first, fall back to XML if needed
        let response_text = response.text().await
            .context("Failed to read NSG status response")?;

        let status_response = if let Ok(json_response) = serde_json::from_str::<NSGJobStatusResponse>(&response_text) {
            json_response
        } else {
            // NSG returned XML - parse manually
            log::warn!("NSG returned XML for job status, parsing manually");

            // Extract job_stage
            let job_stage = if let Some(start) = response_text.find("<jobStage>") {
                let start_idx = start + "<jobStage>".len();
                if let Some(end) = response_text[start_idx..].find("</jobStage>") {
                    response_text[start_idx..start_idx + end].to_string()
                } else {
                    "UNKNOWN".to_string()
                }
            } else {
                "UNKNOWN".to_string()
            };

            // Check if failed
            let failed = response_text.contains("<failed>true</failed>");

            // Extract resultsUri from XML
            let results_uri = if let Some(start) = response_text.find("<resultsUri>") {
                let start_idx = start + "<resultsUri>".len();
                if let Some(url_start) = response_text[start_idx..].find("<url>") {
                    let url_start_idx = start_idx + url_start + "<url>".len();
                    if let Some(url_end) = response_text[url_start_idx..].find("</url>") {
                        Some(response_text[url_start_idx..url_start_idx + url_end].to_string())
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

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
        log::info!("📥 Downloading NSG output file to: {} (size: {} bytes)", output_path.display(), total_size);

        let response = self.client
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

        if let Some(parent) = output_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .context("Failed to create output directory")?;
        }

        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;

        let mut file = tokio::fs::File::create(output_path)
            .await
            .context("Failed to create output file")?;

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.context("Failed to read chunk")?;
            file.write_all(&chunk)
                .await
                .context("Failed to write chunk")?;

            downloaded += chunk.len() as u64;
            progress_callback(downloaded, total_size);
        }

        file.flush().await.context("Failed to flush file")?;

        log::info!("✅ Downloaded output file: {} ({} bytes)", output_path.display(), downloaded);

        Ok(())
    }

    pub async fn cancel_job(&self, job_url: &str) -> Result<()> {
        log::info!("🛑 Cancelling NSG job: {}", job_url);

        let response = self.client
            .delete(job_url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to cancel job")?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!("Failed to cancel job: {} - {}", status, error_text));
        }

        log::info!("✅ NSG job cancelled");

        Ok(())
    }

    pub async fn list_user_jobs(&self) -> Result<Vec<NSGJobResponse>> {
        let url = format!("{}/job/{}", self.base_url, self.credentials.username);

        let response = self.client
            .get(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to list jobs from NSG")?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!("Failed to list jobs: {} - {}", status, error_text));
        }

        let jobs: Vec<NSGJobResponse> = response
            .json()
            .await
            .context("Failed to parse job list response")?;

        Ok(jobs)
    }

    pub fn username(&self) -> &str {
        &self.credentials.username
    }

    /// List output files for a completed job using the results URI
    pub async fn list_output_files(&self, results_uri: &str) -> Result<Vec<super::models::NSGOutputFile>> {
        log::info!("📂 Listing output files from: {}", results_uri);

        let response = self.client
            .get(results_uri)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("cipres-appkey", &self.credentials.app_key)
            .send()
            .await
            .context("Failed to fetch output files list")?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!("Failed to list output files: {} - {}", status, error_text));
        }

        let response_text = response.text().await
            .context("Failed to read output files response")?;

        log::debug!("Output files response: {}", response_text);

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

                // Extract filename
                let filename = if let Some(name_start) = file_xml.find("<filename>") {
                    let name_start_idx = name_start + "<filename>".len();
                    if let Some(name_end) = file_xml[name_start_idx..].find("</filename>") {
                        file_xml[name_start_idx..name_start_idx + name_end].to_string()
                    } else {
                        search_pos = file_start_idx + file_end + end_tag.len();
                        continue;
                    }
                } else {
                    search_pos = file_start_idx + file_end + end_tag.len();
                    continue;
                };

                // Extract download URI - nested in <downloadUri><url>
                let download_uri = if let Some(uri_start) = file_xml.find("<downloadUri>") {
                    let uri_section_start = uri_start + "<downloadUri>".len();
                    if let Some(url_start) = file_xml[uri_section_start..].find("<url>") {
                        let url_start_idx = uri_section_start + url_start + "<url>".len();
                        if let Some(url_end) = file_xml[url_start_idx..].find("</url>") {
                            let mut uri = file_xml[url_start_idx..url_start_idx + url_end].to_string();
                            // Decode XML entities
                            uri = uri.replace("&amp;", "&");
                            uri
                        } else {
                            search_pos = file_start_idx + file_end + end_tag.len();
                            continue;
                        }
                    } else {
                        search_pos = file_start_idx + file_end + end_tag.len();
                        continue;
                    }
                } else {
                    search_pos = file_start_idx + file_end + end_tag.len();
                    continue;
                };

                // Extract length
                let length = if let Some(len_start) = file_xml.find("<length>") {
                    let len_start_idx = len_start + "<length>".len();
                    if let Some(len_end) = file_xml[len_start_idx..].find("</length>") {
                        file_xml[len_start_idx..len_start_idx + len_end]
                            .parse::<u64>()
                            .unwrap_or(0)
                    } else {
                        0
                    }
                } else {
                    0
                };

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

        log::info!("✅ Found {} output files", files.len());

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
}
