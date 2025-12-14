use anyhow::{Context, Result};
use rustls_pemfile::{certs, pkcs8_private_keys};
use std::io::BufReader;
use std::path::{Path, PathBuf};

/// Get or create the certificates directory for the application
pub fn get_certs_dir() -> Result<PathBuf> {
    let cert_dir = dirs::config_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot find config directory"))?
        .join("ddalab")
        .join("certs");

    std::fs::create_dir_all(&cert_dir).context("Failed to create certificates directory")?;

    Ok(cert_dir)
}

/// Validate mkcert binary path is from a trusted location
fn validate_mkcert_path(path: &Path) -> Result<()> {
    // Canonicalize the path to resolve symlinks
    let canonical_path = path
        .canonicalize()
        .context("Failed to canonicalize mkcert path")?;

    // Define trusted directories for mkcert installation
    let trusted_prefixes = if cfg!(target_os = "macos") {
        vec!["/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"]
    } else if cfg!(target_os = "windows") {
        vec![
            "C:\\ProgramData\\chocolatey\\bin",
            "C:\\Program Files\\mkcert",
        ]
    } else {
        // Linux/Unix
        vec!["/usr/local/bin", "/usr/bin"]
    };

    // Check if path starts with any trusted prefix
    let path_str = canonical_path.to_string_lossy();
    let is_trusted = trusted_prefixes
        .iter()
        .any(|prefix| path_str.starts_with(prefix));

    if !is_trusted {
        log::warn!(
            "mkcert found at untrusted location: {}. Expected in: {:?}",
            path_str,
            trusted_prefixes
        );
        return Err(anyhow::anyhow!(
            "mkcert binary not in trusted location. Please install via package manager."
        ));
    }

    log::info!("Validated mkcert binary at: {}", path_str);
    Ok(())
}

/// Generate localhost certificates using mkcert (preferred) or openssl (fallback)
pub async fn generate_localhost_certs(cert_dir: &Path) -> Result<()> {
    log::info!("🔐 Generating localhost certificates...");

    let cert_path = cert_dir.join("server.crt");
    let key_path = cert_dir.join("server.key");

    // Try mkcert first (generates trusted certificates)
    if let Ok(mkcert_path) = which::which("mkcert") {
        // Validate mkcert binary is from a trusted location
        if let Err(e) = validate_mkcert_path(&mkcert_path) {
            log::warn!("mkcert validation failed: {}", e);
            log::warn!("Falling back to openssl for certificate generation");
        } else {
            log::info!("Using mkcert to generate trusted certificates");

            // Install mkcert CA root first (makes certificates trusted)
            log::info!("🔐 Installing mkcert CA root certificate...");
            let install_output = tokio::process::Command::new(&mkcert_path)
                .arg("-install")
                .output()
                .await;

            match install_output {
                Ok(output) if output.status.success() => {
                    log::info!("mkcert CA root installed successfully");
                }
                Ok(output) => {
                    log::warn!(
                        "mkcert -install failed (may already be installed): {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
                Err(e) => {
                    log::warn!("Failed to run mkcert -install: {}", e);
                }
            }

            let output = tokio::process::Command::new(mkcert_path)
                .arg("-cert-file")
                .arg(&cert_path)
                .arg("-key-file")
                .arg(&key_path)
                .arg("localhost")
                .arg("127.0.0.1")
                .arg("::1")
                .arg("*.local")
                .output()
                .await
                .context("Failed to run mkcert")?;

            if output.status.success() {
                log::info!("Generated trusted certificates with mkcert");
                return Ok(());
            } else {
                log::warn!("mkcert failed: {}", String::from_utf8_lossy(&output.stderr));
            }
        }
    } else {
        log::warn!("mkcert not found in PATH");
        log::warn!("   Install mkcert for automatic trusted certificate generation:");
        log::warn!("   macOS: brew install mkcert");
        log::warn!("   Windows: choco install mkcert");
        log::warn!("   Linux: See https://github.com/FiloSottile/mkcert#installation");
    }

    // Fallback to self-signed with openssl
    log::info!("Falling back to openssl for self-signed certificate");
    log::warn!("Self-signed certificate will NOT be trusted by your browser");
    log::warn!("You will need to manually trust it in your system keychain or install mkcert");

    let key_path_str = key_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Key path contains invalid UTF-8 characters"))?;
    let cert_path_str = cert_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Certificate path contains invalid UTF-8 characters"))?;

    let output = tokio::process::Command::new("openssl")
        .args(&[
            "req",
            "-x509",
            "-newkey",
            "rsa:4096",
            "-keyout",
            key_path_str,
            "-out",
            cert_path_str,
            "-days",
            "365",
            "-nodes",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,DNS:*.local,IP:127.0.0.1,IP:::1",
        ])
        .output()
        .await
        .context("Failed to run openssl")?;

    if output.status.success() {
        log::info!("Generated self-signed certificate with openssl");
        log::warn!("Browser will show security warnings for self-signed certificates");
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "Failed to generate certificates: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Generate certificates for LAN access with custom hostname/IP
pub async fn generate_lan_certs(cert_dir: &Path, hostname: &str, ip: &str) -> Result<()> {
    log::info!("🔐 Generating LAN certificates for {}...", hostname);

    let cert_path = cert_dir.join("server.crt");
    let key_path = cert_dir.join("server.key");

    // Try mkcert first
    if let Ok(mkcert_path) = which::which("mkcert") {
        // Validate mkcert binary is from a trusted location
        if let Err(e) = validate_mkcert_path(&mkcert_path) {
            log::warn!("mkcert validation failed: {}", e);
            log::warn!("Falling back to openssl for LAN certificate generation");
        } else {
            log::info!("Using mkcert to generate trusted LAN certificates");

            // Install mkcert CA root first (makes certificates trusted)
            log::info!("🔐 Installing mkcert CA root certificate...");
            let install_output = tokio::process::Command::new(&mkcert_path)
                .arg("-install")
                .output()
                .await;

            match install_output {
                Ok(output) if output.status.success() => {
                    log::info!("mkcert CA root installed successfully");
                }
                Ok(output) => {
                    log::warn!(
                        "mkcert -install failed (may already be installed): {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
                Err(e) => {
                    log::warn!("Failed to run mkcert -install: {}", e);
                }
            }

            let output = tokio::process::Command::new(mkcert_path)
                .arg("-cert-file")
                .arg(&cert_path)
                .arg("-key-file")
                .arg(&key_path)
                .arg("localhost")
                .arg("127.0.0.1")
                .arg("::1")
                .arg(hostname)
                .arg(ip)
                .arg("*.local")
                .output()
                .await
                .context("Failed to run mkcert")?;

            if output.status.success() {
                log::info!("Generated trusted LAN certificates with mkcert");
                return Ok(());
            }
        }
    }

    // Fallback to openssl with SAN
    log::info!("Falling back to openssl for self-signed LAN certificate");

    let san = format!(
        "subjectAltName=DNS:localhost,DNS:{},DNS:*.local,IP:127.0.0.1,IP:{},IP:::1",
        hostname, ip
    );

    let key_path_str = key_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Key path contains invalid UTF-8 characters"))?;
    let cert_path_str = cert_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Certificate path contains invalid UTF-8 characters"))?;

    let output = tokio::process::Command::new("openssl")
        .args(&[
            "req",
            "-x509",
            "-newkey",
            "rsa:4096",
            "-keyout",
            key_path_str,
            "-out",
            cert_path_str,
            "-days",
            "365",
            "-nodes",
            "-subj",
            &format!("/CN={}", hostname),
            "-addext",
            &san,
        ])
        .output()
        .await
        .context("Failed to run openssl")?;

    if output.status.success() {
        log::info!("Generated self-signed LAN certificate");
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "Failed to generate LAN certificates: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Load TLS configuration from certificate files (for axum-server)
pub async fn load_tls_config(
    cert_path: &Path,
    key_path: &Path,
) -> Result<axum_server::tls_rustls::RustlsConfig> {
    log::info!("🔐 Loading TLS configuration from certificates");

    // Use axum-server's RustlsConfig which handles the file loading
    let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert_path, key_path)
        .await
        .context("Failed to load TLS configuration from PEM files")?;

    log::info!("TLS configuration loaded successfully");

    Ok(config)
}

/// Check if certificates exist and are valid
pub fn check_certificates(cert_dir: &Path) -> Result<bool> {
    let cert_path = cert_dir.join("server.crt");
    let key_path = cert_dir.join("server.key");

    if !cert_path.exists() || !key_path.exists() {
        return Ok(false);
    }

    // Try to load the certificates to verify they're valid
    let cert_file = std::fs::File::open(cert_path)?;
    let mut cert_reader = BufReader::new(cert_file);

    let certs_count = certs(&mut cert_reader).count();

    Ok(certs_count > 0)
}

/// Get certificate information for display
pub fn get_certificate_info(cert_path: &Path) -> Result<CertificateInfo> {
    use std::process::Command;

    let cert_path_str = cert_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Certificate path contains invalid UTF-8 characters"))?;

    let output = Command::new("openssl")
        .args(&["x509", "-in", cert_path_str, "-noout", "-dates", "-subject"])
        .output()
        .context("Failed to get certificate info")?;

    if !output.status.success() {
        return Err(anyhow::anyhow!("Failed to read certificate info"));
    }

    let info_str = String::from_utf8_lossy(&output.stdout);

    // Parse the output (simple parsing, could be more robust)
    let mut info = CertificateInfo {
        subject: String::new(),
        valid_from: String::new(),
        valid_until: String::new(),
        is_expired: false,
    };

    for line in info_str.lines() {
        if line.starts_with("subject=") {
            info.subject = line.strip_prefix("subject=").unwrap_or("").to_string();
        } else if line.starts_with("notBefore=") {
            info.valid_from = line.strip_prefix("notBefore=").unwrap_or("").to_string();
        } else if line.starts_with("notAfter=") {
            info.valid_until = line.strip_prefix("notAfter=").unwrap_or("").to_string();
        }
    }

    Ok(info)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CertificateInfo {
    pub subject: String,
    pub valid_from: String,
    pub valid_until: String,
    pub is_expired: bool,
}
