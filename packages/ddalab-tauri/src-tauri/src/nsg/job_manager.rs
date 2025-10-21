use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use super::client::NSGClient;
use super::models::{NSGCredentials, NSGResourceConfig};
use crate::api::handlers::dda::DDARequest;
use crate::db::{NSGJobsDatabase, NSGJob, NSGJobStatus};

pub struct NSGJobManager {
    client: Arc<NSGClient>,
    db: Arc<NSGJobsDatabase>,
    output_dir: PathBuf,
}

impl NSGJobManager {
    pub fn new(
        credentials: NSGCredentials,
        db: Arc<NSGJobsDatabase>,
        output_dir: PathBuf,
    ) -> Result<Self> {
        let client = NSGClient::new(credentials)
            .context("Failed to create NSG client")?;

        std::fs::create_dir_all(&output_dir)
            .context("Failed to create NSG output directory")?;

        Ok(Self {
            client: Arc::new(client),
            db,
            output_dir,
        })
    }

    pub async fn create_job(
        &self,
        tool: String,
        dda_params: DDARequest,
        input_file_path: String,
    ) -> Result<NSGJob> {
        self.create_job_with_resources(tool, dda_params, input_file_path, None).await
    }

    pub async fn create_job_with_resources(
        &self,
        tool: String,
        dda_params: DDARequest,
        input_file_path: String,
        resource_config: Option<NSGResourceConfig>,
    ) -> Result<NSGJob> {
        let mut params_json = serde_json::to_value(dda_params)
            .context("Failed to serialize DDA parameters")?;

        // Add resource configuration to job metadata if provided
        if let Some(resources) = resource_config {
            if let Some(obj) = params_json.as_object_mut() {
                obj.insert("resource_config".to_string(), serde_json::to_value(resources)?);
            }
        }

        let job = NSGJob::new_from_dda_params(tool, params_json, input_file_path);

        self.db.save_job(&job)
            .context("Failed to save job to database")?;

        log::info!("📝 Created NSG job: {}", job.id);

        Ok(job)
    }

    pub async fn submit_job(&self, job_id: &str) -> Result<NSGJob> {
        let mut job = self.db.get_job(job_id)
            .context("Failed to get job from database")?
            .ok_or_else(|| anyhow!("Job not found: {}", job_id))?;

        if job.status != NSGJobStatus::Pending {
            return Err(anyhow!("Job is not in pending state: {:?}", job.status));
        }

        let input_path = Path::new(&job.input_file_path);
        if !input_path.exists() {
            return Err(anyhow!("Input file not found: {}", job.input_file_path));
        }

        // Parse DDA parameters to create the job package
        let dda_params: DDARequest = serde_json::from_value(job.dda_params.clone())
            .context("Failed to parse DDA parameters")?;

        // Create ZIP package with modeldir structure, input file, wrapper script, and params.json
        log::info!("📦 Creating job package for: {}", job.id);
        let zip_path = self.create_job_package(&job.id, &dda_params, input_path)
            .context("Failed to create job package")?;

        // Extract resource configuration from job params
        let resource_config = job.dda_params.get("resource_config")
            .and_then(|v| serde_json::from_value::<NSGResourceConfig>(v.clone()).ok());

        // NOTE: PY_EXPANSE is a generic Python runner and doesn't accept custom vparam parameters
        // All DDA-specific parameters are passed via params.json in the ZIP package
        // Our wrapper script (run_dda_nsg.py) reads params.json to get the DDA configuration
        let mut parameters = Vec::new();

        // Add resource parameters if configured
        if let Some(ref config) = resource_config {
            self.add_resource_params(&mut parameters, config);
        }

        let response = self.client
            .submit_job(&job.tool, &zip_path, parameters, true)
            .await
            .context("Failed to submit job to NSG")?;

        job.mark_submitted(response.job_id().to_string());

        self.db.update_job(&job)
            .context("Failed to update job in database")?;

        log::info!("✅ Submitted NSG job: {} -> {}", job.id, job.nsg_job_id.as_ref().unwrap());

        Ok(job)
    }

    pub async fn update_job_status(&self, job_id: &str) -> Result<NSGJob> {
        let mut job = self.db.get_job(job_id)
            .context("Failed to get job from database")?
            .ok_or_else(|| anyhow!("Job not found: {}", job_id))?;

        log::debug!("🔄 Updating job status for {}: current status = {}", job_id, job.status);

        if job.status.is_terminal() {
            log::debug!("Job {} already in terminal state ({}), skipping update", job_id, job.status);
            return Ok(job);
        }

        let nsg_job_id = job.nsg_job_id.clone()
            .ok_or_else(|| anyhow!("Job has not been submitted yet"))?;

        let job_url = format!("{}/job/{}/{}",
            "https://nsgr.sdsc.edu:8443/cipresrest/v1",
            self.client.username(),
            nsg_job_id
        );

        log::debug!("📡 Querying NSG status for job {}: {}", nsg_job_id, job_url);

        let status_response = self.client
            .get_job_status(&job_url)
            .await
            .context("Failed to get job status from NSG")?;

        let new_status = status_response.to_status();
        let old_status = job.status.clone();

        log::info!("📊 Job {} status: {} -> {} (NSG stage: {})",
                   job_id, old_status, new_status, status_response.job_stage);

        job.update_status(new_status.clone());

        if status_response.failed {
            if let Some(error_msg) = status_response.get_error_message() {
                job.error_message = Some(error_msg);
            }
        }

        if new_status == NSGJobStatus::Completed {
            if let Some(ref output_files) = status_response.output_files {
                job.output_files = output_files.iter()
                    .map(|f| f.filename.clone())
                    .collect();
            }
        }

        self.db.update_job(&job)
            .context("Failed to update job in database")?;

        if old_status != new_status {
            log::info!("📊 Job {} status changed: {:?} -> {:?}", job.id, old_status, new_status);
        }

        Ok(job)
    }

    pub async fn cancel_job(&self, job_id: &str) -> Result<NSGJob> {
        let mut job = self.db.get_job(job_id)
            .context("Failed to get job from database")?
            .ok_or_else(|| anyhow!("Job not found: {}", job_id))?;

        if job.status.is_terminal() {
            return Err(anyhow!("Job is already in terminal state: {:?}", job.status));
        }

        if let Some(ref nsg_job_id) = job.nsg_job_id {
            let job_url = format!("{}/job/{}/{}",
                "https://nsgr.sdsc.edu:8443/cipresrest/v1",
                self.client.username(),
                nsg_job_id
            );

            self.client.cancel_job(&job_url).await
                .context("Failed to cancel job on NSG")?;
        }

        job.status = NSGJobStatus::Cancelled;
        job.completed_at = Some(chrono::Utc::now());

        self.db.update_job(&job)
            .context("Failed to update job in database")?;

        log::info!("🛑 Cancelled job: {}", job.id);

        Ok(job)
    }

    pub async fn download_results(&self, job_id: &str) -> Result<Vec<PathBuf>> {
        let job = self.db.get_job(job_id)
            .context("Failed to get job from database")?
            .ok_or_else(|| anyhow!("Job not found: {}", job_id))?;

        if job.status != NSGJobStatus::Completed {
            return Err(anyhow!("Job is not completed: {:?}", job.status));
        }

        let nsg_job_id = job.nsg_job_id
            .ok_or_else(|| anyhow!("Job has no NSG job ID"))?;

        let job_url = format!("{}/job/{}/{}",
            "https://nsgr.sdsc.edu:8443/cipresrest/v1",
            self.client.username(),
            nsg_job_id
        );

        // Get job status to extract the results URI
        let status_response = self.client
            .get_job_status(&job_url)
            .await
            .context("Failed to get job status from NSG")?;

        // Extract results URI from status response
        let results_uri = status_response.results_uri
            .ok_or_else(|| anyhow!("No results URI available for this job"))?;

        log::info!("📋 Using results URI: {}", results_uri);

        // Use the results URI to get the actual output files list
        let output_files = self.client
            .list_output_files(&results_uri)
            .await
            .context("Failed to list output files")?;

        if output_files.is_empty() {
            return Err(anyhow!("No output files available"));
        }

        let job_output_dir = self.output_dir.join(&job.id);
        std::fs::create_dir_all(&job_output_dir)
            .context("Failed to create job output directory")?;

        let mut downloaded_paths = Vec::new();

        for output_file in &output_files {
            let output_path = job_output_dir.join(&output_file.filename);

            self.client
                .download_output_file(&output_file.download_uri, &output_path)
                .await
                .context(format!("Failed to download file: {}", output_file.filename))?;

            downloaded_paths.push(output_path);
        }

        log::info!("✅ Downloaded {} result files for job {}", downloaded_paths.len(), job.id);

        Ok(downloaded_paths)
    }

    pub fn extract_tarball(&self, job_id: &str, tar_path: &str) -> Result<Vec<PathBuf>> {
        use flate2::read::GzDecoder;
        use tar::Archive;
        use std::fs::File;

        log::info!("📦 Extracting tarball: {}", tar_path);

        let tar_path_buf = Path::new(tar_path);
        if !tar_path_buf.exists() {
            return Err(anyhow!("Tarball not found: {}", tar_path));
        }

        // Extract to the same directory as the tar file
        let extract_dir = tar_path_buf.parent()
            .ok_or_else(|| anyhow!("Cannot get parent directory of tar file"))?;

        // Open and decompress the tar.gz file
        let tar_file = File::open(tar_path_buf)
            .context("Failed to open tarball")?;
        let decompressor = GzDecoder::new(tar_file);
        let mut archive = Archive::new(decompressor);

        // Track extracted files
        let mut extracted_paths = Vec::new();

        // Extract all entries
        for entry in archive.entries().context("Failed to read tar entries")? {
            let mut entry = entry.context("Failed to read tar entry")?;
            let entry_path = entry.path().context("Failed to get entry path")?.to_path_buf();
            let output_path = extract_dir.join(&entry_path);

            // Create parent directories if needed
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)
                    .context(format!("Failed to create directory: {}", parent.display()))?;
            }

            // Extract the file
            entry.unpack(&output_path)
                .context(format!("Failed to extract: {}", entry_path.display()))?;

            log::debug!("  Extracted: {}", entry_path.display());
            extracted_paths.push(output_path);
        }

        log::info!("✅ Extracted {} files from tarball", extracted_paths.len());

        Ok(extracted_paths)
    }

    pub fn list_jobs(&self) -> Result<Vec<NSGJob>> {
        self.db.list_jobs()
            .context("Failed to list jobs from database")
    }

    pub fn get_job(&self, job_id: &str) -> Result<Option<NSGJob>> {
        self.db.get_job(job_id)
            .context("Failed to get job from database")
    }

    pub fn delete_job(&self, job_id: &str) -> Result<()> {
        self.db.delete_job(job_id)
            .context("Failed to delete job from database")?;

        log::info!("🗑️  Deleted job: {}", job_id);

        Ok(())
    }

    pub fn get_active_jobs(&self) -> Result<Vec<NSGJob>> {
        self.db.get_active_jobs()
            .context("Failed to get active jobs from database")
    }

    fn create_job_package(&self, job_id: &str, dda_params: &DDARequest, input_file: &Path) -> Result<PathBuf> {
        use std::io::Write;

        let package_dir = self.output_dir.join(format!("{}_package", job_id));
        std::fs::create_dir_all(&package_dir)
            .context("Failed to create package directory")?;

        let input_filename = input_file.file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| anyhow!("Invalid input file name"))?;

        std::fs::copy(input_file, package_dir.join(input_filename))
            .context("Failed to copy input file to package")?;

        // NSG PY_EXPANSE tool expects the main script to be named input.py
        let wrapper_script = include_str!("../../../../../nsg_wrapper/run_dda_nsg.py");
        let wrapper_path = package_dir.join("input.py");
        std::fs::write(&wrapper_path, wrapper_script)
            .context("Failed to write wrapper script")?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&wrapper_path)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&wrapper_path, perms)?;
        }

        // Include local dda.py module (fixed version with customizable parameters)
        let dda_module = include_str!("../../../../../nsg_wrapper/dda.py");
        let dda_path = package_dir.join("dda.py");
        std::fs::write(&dda_path, dda_module)
            .context("Failed to write dda.py module")?;

        let params_json = serde_json::json!({
            "input_file": input_filename,
            "channels": dda_params.channels,
            "time_start": dda_params.time_range.start,
            "time_end": dda_params.time_range.end,
            "window_length": dda_params.window_parameters.window_length,
            "window_step": dda_params.window_parameters.window_step,
            "scale_min": dda_params.scale_parameters.scale_min,
            "scale_max": dda_params.scale_parameters.scale_max,
            "scale_num": dda_params.scale_parameters.scale_num,
            "variants": dda_params.algorithm_selection.enabled_variants,
            "detrending": dda_params.preprocessing_options.detrending,
            "highpass": dda_params.preprocessing_options.highpass,
            "lowpass": dda_params.preprocessing_options.lowpass,
        });

        let params_path = package_dir.join("params.json");
        let mut params_file = std::fs::File::create(&params_path)
            .context("Failed to create params.json")?;
        params_file.write_all(serde_json::to_string_pretty(&params_json)?.as_bytes())
            .context("Failed to write params.json")?;

        let zip_path = self.output_dir.join(format!("{}_job.zip", job_id));
        let zip_file = std::fs::File::create(&zip_path)
            .context("Failed to create ZIP file")?;

        let mut zip = zip::ZipWriter::new(zip_file);
        let options: zip::write::FileOptions<zip::write::ExtendedFileOptions> = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);

        // NSG requires all files to be in a subdirectory, not at root level
        let modeldir = "modeldir";

        for entry in walkdir::WalkDir::new(&package_dir).min_depth(1) {
            let entry = entry?;
            let path = entry.path();
            let name = path.strip_prefix(&package_dir)?;

            if path.is_file() {
                let file_options = zip::write::FileOptions::<zip::write::ExtendedFileOptions>::default()
                    .compression_method(zip::CompressionMethod::Deflated)
                    .unix_permissions(0o755);
                // Prepend modeldir/ to the file path
                let zip_path = format!("{}/{}", modeldir, name.to_string_lossy());
                zip.start_file(zip_path, file_options)?;
                let mut file = std::fs::File::open(path)?;
                std::io::copy(&mut file, &mut zip)?;
            }
        }

        zip.finish()?;

        std::fs::remove_dir_all(&package_dir)
            .context("Failed to clean up package directory")?;

        log::info!("📦 Created job package: {}", zip_path.display());

        Ok(zip_path)
    }

    fn convert_dda_params_to_nsg(&self, params: &DDARequest) -> Vec<(String, String)> {
        let mut nsg_params = Vec::new();

        nsg_params.push(("vparam.channels_".to_string(),
            params.channels.as_ref()
                .map(|ch| ch.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(","))
                .unwrap_or_default()));

        nsg_params.push(("vparam.time_start_".to_string(), params.time_range.start.to_string()));
        nsg_params.push(("vparam.time_end_".to_string(), params.time_range.end.to_string()));

        nsg_params.push(("vparam.window_length_".to_string(),
            params.window_parameters.window_length.to_string()));
        nsg_params.push(("vparam.window_step_".to_string(),
            params.window_parameters.window_step.to_string()));

        nsg_params.push(("vparam.scale_min_".to_string(),
            params.scale_parameters.scale_min.to_string()));
        nsg_params.push(("vparam.scale_max_".to_string(),
            params.scale_parameters.scale_max.to_string()));
        nsg_params.push(("vparam.scale_num_".to_string(),
            params.scale_parameters.scale_num.to_string()));

        if let Some(ref detrending) = params.preprocessing_options.detrending {
            nsg_params.push(("vparam.detrending_".to_string(), detrending.clone()));
        }

        if let Some(highpass) = params.preprocessing_options.highpass {
            nsg_params.push(("vparam.highpass_".to_string(), highpass.to_string()));
        }

        if let Some(lowpass) = params.preprocessing_options.lowpass {
            nsg_params.push(("vparam.lowpass_".to_string(), lowpass.to_string()));
        }

        nsg_params.push(("vparam.variants_".to_string(),
            params.algorithm_selection.enabled_variants.join(",")));

        nsg_params
    }

    fn add_resource_params(&self, params: &mut Vec<(String, String)>, config: &NSGResourceConfig) {
        // NOTE: PY_EXPANSE tool does not appear to accept custom resource parameters
        // The tool runs with default resource allocations managed by NSG/Expanse
        // Tested parameter names that were rejected by NSG API:
        // - runtime_, number_cores_, nodes_ (without vparam prefix)
        // - vparam.runtime_, vparam.number_cores_, vparam.number_nodes_
        //
        // Reference test scripts in nsg_wrapper/ directory do not submit any resource params
        // See: test_nsg_submission.sh, test_dda_wrapper.sh
        //
        // TODO: Investigate if there are valid resource parameter names for PY_EXPANSE
        // For now, we rely on NSG's default resource allocation

        log::info!("📊 NSG job resource config (requested but not submitted - PY_EXPANSE defaults used): runtime={:?}h, cores={:?}, nodes={:?}",
            config.runtime_hours, config.cores, config.nodes);

        // Intentionally not adding any parameters - PY_EXPANSE doesn't accept them
    }
}
