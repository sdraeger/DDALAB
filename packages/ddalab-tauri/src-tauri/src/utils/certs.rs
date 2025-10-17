use std::path::{Path, PathBuf};
use anyhow::{Result, Context};
use std::io::BufReader;
use rustls_pemfile::{certs, pkcs8_private_keys};

/// Get or create the certificates directory for the application
pub fn get_certs_dir() -> Result<PathBuf> {
    let cert_dir = dirs::config_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot find config directory"))?
        .join("ddalab")
        .join("certs");

    std::fs::create_dir_all(&cert_dir)
        .context("Failed to create certificates directory")?;

    Ok(cert_dir)
}

/// Generate localhost certificates using mkcert (preferred) or openssl (fallback)
pub async fn generate_localhost_certs(cert_dir: &Path) -> Result<()> {
    log::info!("🔐 Generating localhost certificates...");

    let cert_path = cert_dir.join("server.crt");
    let key_path = cert_dir.join("server.key");

    // Try mkcert first (generates trusted certificates)
    if let Ok(mkcert_path) = which::which("mkcert") {
        log::info!("📦 Using mkcert to generate trusted certificates");

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
            log::info!("✅ Generated trusted certificates with mkcert");
            return Ok(());
        } else {
            log::warn!("⚠️ mkcert failed: {}", String::from_utf8_lossy(&output.stderr));
        }
    } else {
        log::warn!("⚠️ mkcert not found in PATH");
    }

    // Fallback to self-signed with openssl
    log::info!("📦 Falling back to openssl for self-signed certificate");

    let output = tokio::process::Command::new("openssl")
        .args(&[
            "req", "-x509", "-newkey", "rsa:4096",
            "-keyout", key_path.to_str().unwrap(),
            "-out", cert_path.to_str().unwrap(),
            "-days", "365",
            "-nodes",
            "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost,DNS:*.local,IP:127.0.0.1,IP:::1",
        ])
        .output()
        .await
        .context("Failed to run openssl")?;

    if output.status.success() {
        log::info!("✅ Generated self-signed certificate with openssl");
        log::warn!("⚠️ Browser will show security warnings for self-signed certificates");
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
        log::info!("📦 Using mkcert to generate trusted LAN certificates");

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
            log::info!("✅ Generated trusted LAN certificates with mkcert");
            return Ok(());
        }
    }

    // Fallback to openssl with SAN
    log::info!("📦 Falling back to openssl for self-signed LAN certificate");

    let san = format!(
        "subjectAltName=DNS:localhost,DNS:{},DNS:*.local,IP:127.0.0.1,IP:{},IP:::1",
        hostname, ip
    );

    let output = tokio::process::Command::new("openssl")
        .args(&[
            "req", "-x509", "-newkey", "rsa:4096",
            "-keyout", key_path.to_str().unwrap(),
            "-out", cert_path.to_str().unwrap(),
            "-days", "365",
            "-nodes",
            "-subj", &format!("/CN={}", hostname),
            "-addext", &san,
        ])
        .output()
        .await
        .context("Failed to run openssl")?;

    if output.status.success() {
        log::info!("✅ Generated self-signed LAN certificate");
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "Failed to generate LAN certificates: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Load TLS configuration from certificate files (for axum-server)
pub async fn load_tls_config(cert_path: &Path, key_path: &Path) -> Result<axum_server::tls_rustls::RustlsConfig> {
    log::info!("🔐 Loading TLS configuration from certificates");

    // Use axum-server's RustlsConfig which handles the file loading
    let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert_path, key_path)
        .await
        .context("Failed to load TLS configuration from PEM files")?;

    log::info!("✅ TLS configuration loaded successfully");

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

    let output = Command::new("openssl")
        .args(&["x509", "-in", cert_path.to_str().unwrap(), "-noout", "-dates", "-subject"])
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
