use crate::utils::get_app_data_dir;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};
use tokio::fs;

/// Emit Docker stack status change event to frontend
fn emit_docker_stack_change(app: &AppHandle, status: &DockerStackStatus) {
    if let Err(e) = app.emit("docker-stack-changed", status) {
        log::warn!("Failed to emit docker-stack-changed event: {}", e);
    }
}

const SETUP_REPO_URL: &str = "https://github.com/sdraeger/DDALAB-setup.git";
const DOCKER_COMPOSE_FILE: &str = "docker-compose.tauri.yml";
const ENV_FILE: &str = ".env";
const ENV_TEMPLATE: &str = ".env.tauri.example";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerService {
    pub name: String,
    pub status: ServiceStatus,
    pub health: HealthStatus,
    pub ports: Vec<String>,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServiceStatus {
    Running,
    Stopped,
    Starting,
    Stopping,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Unhealthy,
    Starting,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerStackStatus {
    pub services: Vec<DockerService>,
    pub is_running: bool,
    pub setup_directory: Option<PathBuf>,
    pub last_checked: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerStackConfig {
    pub db_user: String,
    pub db_password: String,
    pub db_name: String,
    pub minio_user: String,
    pub minio_password: String,
    pub jwt_secret: String,
    pub api_image: String,
    pub environment: String,
    pub debug: bool,
}

impl Default for DockerStackConfig {
    fn default() -> Self {
        Self {
            db_user: "ddalab".to_string(),
            db_password: generate_secure_password(),
            db_name: "ddalab".to_string(),
            minio_user: "minioadmin".to_string(),
            minio_password: generate_secure_password(),
            jwt_secret: generate_jwt_secret(),
            api_image: "sdraeger1/ddalab-api:latest".to_string(),
            environment: "development".to_string(),
            debug: true,
        }
    }
}

#[derive(Debug)]
pub struct DockerStackManager {
    app_handle: AppHandle,
    setup_dir: Option<PathBuf>,
}

impl DockerStackManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            setup_dir: None,
        }
    }

    /// Get the setup directory path within the app's data directory
    fn get_setup_directory(&self) -> Result<PathBuf> {
        let app_data_dir =
            get_app_data_dir().map_err(|e| anyhow!("Failed to get app data directory: {}", e))?;
        Ok(app_data_dir.join("docker-setup"))
    }

    /// Clone or update the setup repository
    pub async fn setup_repository(&mut self) -> Result<PathBuf> {
        let setup_dir = self.get_setup_directory()?;

        // Create parent directory if it doesn't exist
        if let Some(parent) = setup_dir.parent() {
            fs::create_dir_all(parent).await?;
        }

        if setup_dir.exists() {
            log::info!("Setup directory exists, updating repository...");
            self.update_repository(&setup_dir).await?;
        } else {
            log::info!("Cloning setup repository...");
            self.clone_repository(&setup_dir).await?;
        }

        // Initialize .env file if it doesn't exist
        self.initialize_env_file(&setup_dir).await?;

        self.setup_dir = Some(setup_dir.clone());
        Ok(setup_dir)
    }

    /// Clone the repository using git command
    async fn clone_repository(&self, target_dir: &Path) -> Result<()> {
        let output = Command::new("git")
            .arg("clone")
            .arg(SETUP_REPO_URL)
            .arg(target_dir)
            .output()
            .map_err(|e| anyhow!("Failed to execute git clone: {}", e))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Git clone failed: {}", error));
        }

        log::info!("Successfully cloned setup repository to {:?}", target_dir);
        Ok(())
    }

    /// Update existing repository using git command
    async fn update_repository(&self, repo_dir: &Path) -> Result<()> {
        let output = Command::new("git")
            .arg("pull")
            .arg("origin")
            .arg("main")
            .current_dir(repo_dir)
            .output()
            .map_err(|e| anyhow!("Failed to execute git pull: {}", e))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            log::warn!("Git pull failed: {}", error);
            // Don't fail completely - repo might already be up to date
        } else {
            log::info!("Successfully updated repository at {:?}", repo_dir);
        }

        Ok(())
    }

    /// Initialize .env file from template
    async fn initialize_env_file(&self, setup_dir: &Path) -> Result<()> {
        let env_file = setup_dir.join(ENV_FILE);
        let template_file = setup_dir.join(ENV_TEMPLATE);

        if !env_file.exists() && template_file.exists() {
            log::info!("Creating .env file from template");

            // Read template and generate secure values
            let template_content = fs::read_to_string(&template_file).await?;
            let config = DockerStackConfig::default();

            let env_content = template_content
                .replace("ddalab_secure_password_123", &config.db_password)
                .replace("minioadmin_secure_password_123", &config.minio_password)
                .replace(
                    "tauri_desktop_app_jwt_secret_key_32chars_long",
                    &config.jwt_secret,
                )
                .replace("sdraeger1/ddalab-api:latest", &config.api_image)
                .replace("development", &config.environment);

            fs::write(&env_file, env_content).await?;
            log::info!("Created .env file with secure defaults");
        }

        Ok(())
    }

    /// Start the Docker stack
    pub async fn start_stack(&mut self) -> Result<DockerStackStatus> {
        let setup_dir = match &self.setup_dir {
            Some(dir) => dir.clone(),
            None => self.setup_repository().await?,
        };

        let docker_compose_path = setup_dir.join(DOCKER_COMPOSE_FILE);
        if !docker_compose_path.exists() {
            return Err(anyhow!(
                "Docker compose file not found: {:?}",
                docker_compose_path
            ));
        }

        log::info!("Starting Docker stack...");

        let output = Command::new("docker-compose")
            .arg("-f")
            .arg(&docker_compose_path)
            .arg("up")
            .arg("-d")
            .current_dir(&setup_dir)
            .output()
            .map_err(|e| anyhow!("Failed to execute docker-compose: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Docker compose failed: {}", stderr));
        }

        log::info!("Docker stack started successfully");

        // Wait a moment for services to start
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

        self.get_stack_status().await
    }

    /// Stop the Docker stack
    pub async fn stop_stack(&mut self) -> Result<DockerStackStatus> {
        let setup_dir = match &self.setup_dir {
            Some(dir) => dir.clone(),
            None => return Err(anyhow!("Setup directory not initialized")),
        };

        let docker_compose_path = setup_dir.join(DOCKER_COMPOSE_FILE);

        log::info!("Stopping Docker stack...");

        let output = Command::new("docker-compose")
            .arg("-f")
            .arg(&docker_compose_path)
            .arg("down")
            .current_dir(&setup_dir)
            .output()
            .map_err(|e| anyhow!("Failed to execute docker-compose: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Docker compose down failed: {}", stderr));
        }

        log::info!("Docker stack stopped successfully");
        self.get_stack_status().await
    }

    /// Get current stack status
    pub async fn get_stack_status(&self) -> Result<DockerStackStatus> {
        let setup_dir = match &self.setup_dir {
            Some(dir) => dir.clone(),
            None => {
                return Ok(DockerStackStatus {
                    services: vec![],
                    is_running: false,
                    setup_directory: None,
                    last_checked: Utc::now(),
                });
            }
        };

        let docker_compose_path = setup_dir.join(DOCKER_COMPOSE_FILE);

        let services = if docker_compose_path.exists() {
            self.get_service_status(&setup_dir).await?
        } else {
            vec![]
        };

        let is_running = services
            .iter()
            .any(|s| matches!(s.status, ServiceStatus::Running));

        Ok(DockerStackStatus {
            services,
            is_running,
            setup_directory: Some(setup_dir),
            last_checked: Utc::now(),
        })
    }

    /// Get status of individual services
    async fn get_service_status(&self, setup_dir: &Path) -> Result<Vec<DockerService>> {
        let docker_compose_path = setup_dir.join(DOCKER_COMPOSE_FILE);

        // Get service status using docker-compose ps
        let output = Command::new("docker-compose")
            .arg("-f")
            .arg(&docker_compose_path)
            .arg("ps")
            .arg("--format")
            .arg("json")
            .current_dir(setup_dir)
            .output()
            .map_err(|e| anyhow!("Failed to get service status: {}", e))?;

        if !output.status.success() {
            log::warn!("Failed to get docker-compose status, services may not be running");
            return Ok(vec![]);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut services = vec![];

        // Parse docker-compose ps JSON output
        for line in stdout.lines() {
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<serde_json::Value>(line) {
                Ok(service_data) => {
                    let name = service_data["Service"]
                        .as_str()
                        .unwrap_or("unknown")
                        .to_string();
                    let state = service_data["State"].as_str().unwrap_or("unknown");
                    let health = service_data["Health"].as_str().unwrap_or("unknown");
                    let ports = service_data["Publishers"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|p| p["PublishedPort"].as_str())
                                .map(|p| p.to_string())
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    let status = match state {
                        "running" => ServiceStatus::Running,
                        "exited" => ServiceStatus::Stopped,
                        "starting" => ServiceStatus::Starting,
                        "stopping" => ServiceStatus::Stopping,
                        _ => ServiceStatus::Unknown,
                    };

                    let health_status = match health {
                        "healthy" => HealthStatus::Healthy,
                        "unhealthy" => HealthStatus::Unhealthy,
                        "starting" => HealthStatus::Starting,
                        _ => HealthStatus::Unknown,
                    };

                    services.push(DockerService {
                        name,
                        status,
                        health: health_status,
                        ports,
                        last_updated: Utc::now(),
                    });
                }
                Err(e) => {
                    log::warn!("Failed to parse service data: {} - Line: {}", e, line);
                }
            }
        }

        Ok(services)
    }

    /// Check if Docker is available
    pub async fn check_docker_availability(&self) -> Result<bool> {
        let output = Command::new("docker").arg("--version").output();

        match output {
            Ok(result) => Ok(result.status.success()),
            Err(_) => Ok(false),
        }
    }

    /// Check if docker-compose is available
    pub async fn check_docker_compose_availability(&self) -> Result<bool> {
        let output = Command::new("docker-compose").arg("--version").output();

        match output {
            Ok(result) => Ok(result.status.success()),
            Err(_) => Ok(false),
        }
    }

    /// Update configuration
    pub async fn update_config(&self, config: DockerStackConfig) -> Result<()> {
        let setup_dir = match &self.setup_dir {
            Some(dir) => dir,
            None => return Err(anyhow!("Setup directory not initialized")),
        };

        let env_file = setup_dir.join(ENV_FILE);

        // Create .env content from config
        let env_content = format!(
            r#"# DDALAB Tauri Desktop App Environment Configuration
# Generated by DDALAB Tauri App

# Database Configuration
DB_USER={}
DB_PASSWORD={}
DB_NAME={}

# MinIO Storage Configuration
MINIO_ROOT_USER={}
MINIO_ROOT_PASSWORD={}

# Authentication & Security
DDALAB_AUTH_MODE=local
DDALAB_JWT_SECRET_KEY={}

# API Configuration
DDALAB_API_IMAGE={}
ENVIRONMENT={}
DEBUG={}

# Optional: Monitoring
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin_secure_password
"#,
            config.db_user,
            config.db_password,
            config.db_name,
            config.minio_user,
            config.minio_password,
            config.jwt_secret,
            config.api_image,
            config.environment,
            config.debug
        );

        fs::write(&env_file, env_content).await?;
        log::info!("Updated Docker stack configuration");

        Ok(())
    }
}

/// Generate a secure random password
fn generate_secure_password() -> String {
    use uuid::Uuid;
    format!("ddalab_{}", Uuid::new_v4().simple())
}

/// Generate a JWT secret key
fn generate_jwt_secret() -> String {
    use uuid::Uuid;
    format!(
        "jwt_{}_{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

// Tauri command exports
#[tauri::command]
pub async fn setup_docker_stack(app_handle: AppHandle) -> Result<DockerStackStatus, String> {
    let mut manager = DockerStackManager::new(app_handle.clone());
    manager
        .setup_repository()
        .await
        .map_err(|e| e.to_string())?;
    let status = manager
        .get_stack_status()
        .await
        .map_err(|e| e.to_string())?;
    emit_docker_stack_change(&app_handle, &status);
    Ok(status)
}

#[tauri::command]
pub async fn start_docker_stack(app_handle: AppHandle) -> Result<DockerStackStatus, String> {
    let mut manager = DockerStackManager::new(app_handle.clone());
    let status = manager.start_stack().await.map_err(|e| e.to_string())?;
    emit_docker_stack_change(&app_handle, &status);
    Ok(status)
}

#[tauri::command]
pub async fn stop_docker_stack(app_handle: AppHandle) -> Result<DockerStackStatus, String> {
    let mut manager = DockerStackManager::new(app_handle.clone());
    let status = manager.stop_stack().await.map_err(|e| e.to_string())?;
    emit_docker_stack_change(&app_handle, &status);
    Ok(status)
}

#[tauri::command]
pub async fn get_docker_stack_status(app_handle: AppHandle) -> Result<DockerStackStatus, String> {
    let manager = DockerStackManager::new(app_handle);
    manager.get_stack_status().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_docker_requirements(
    app_handle: AppHandle,
) -> Result<HashMap<String, bool>, String> {
    let manager = DockerStackManager::new(app_handle);

    let docker_available = manager
        .check_docker_availability()
        .await
        .map_err(|e| e.to_string())?;
    let compose_available = manager
        .check_docker_compose_availability()
        .await
        .map_err(|e| e.to_string())?;

    let mut requirements = HashMap::new();
    requirements.insert("docker".to_string(), docker_available);
    requirements.insert("docker_compose".to_string(), compose_available);

    Ok(requirements)
}

#[tauri::command]
pub async fn update_docker_config(
    app_handle: AppHandle,
    config: DockerStackConfig,
) -> Result<(), String> {
    let manager = DockerStackManager::new(app_handle);
    manager
        .update_config(config)
        .await
        .map_err(|e| e.to_string())
}
