import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";

export interface CertificateInfo {
  exists: boolean;
  valid: boolean;
  expiresAt?: Date;
  daysUntilExpiry?: number;
  subjects: string[];
  isSelfSigned: boolean;
  isTrusted: boolean;
}

export class CertificateService {
  /**
   * Check if mkcert is available on the system
   */
  static async isMkcertAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      exec("which mkcert", (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Install mkcert using Homebrew (macOS)
   */
  static async installMkcert(): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // First check if brew is available
      exec("which brew", (brewError) => {
        if (brewError) {
          resolve({
            success: false,
            error: "Homebrew not found. Please install mkcert manually from https://github.com/FiloSottile/mkcert"
          });
          return;
        }

        // Install mkcert using brew
        exec("brew install mkcert", (error, stdout, stderr) => {
          if (error) {
            logger.error("Failed to install mkcert:", error.message);
            resolve({
              success: false,
              error: `Failed to install mkcert: ${stderr || error.message}`
            });
          } else {
            logger.info("mkcert installed successfully");
            resolve({ success: true });
          }
        });
      });
    });
  }

  /**
   * Check certificate information
   */
  static async getCertificateInfo(certsDir: string): Promise<CertificateInfo> {
    const certPath = path.join(certsDir, "server.crt");
    const keyPath = path.join(certsDir, "server.key");

    try {
      // Check if files exist
      await fs.access(certPath);
      await fs.access(keyPath);
    } catch {
      return {
        exists: false,
        valid: false,
        subjects: [],
        isSelfSigned: true,
        isTrusted: false
      };
    }

    return new Promise((resolve) => {
      // Get certificate details
      exec(`openssl x509 -in "${certPath}" -text -noout`, (error, stdout) => {
        if (error) {
          logger.error("Failed to read certificate:", error.message);
          resolve({
            exists: true,
            valid: false,
            subjects: [],
            isSelfSigned: true,
            isTrusted: false
          });
          return;
        }

        try {
          const certText = stdout;
          
          // Extract expiry date
          const notAfterMatch = certText.match(/Not After : (.+)/);
          const expiresAt = notAfterMatch ? new Date(notAfterMatch[1]) : undefined;
          const daysUntilExpiry = expiresAt 
            ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : undefined;
          
          // Extract subjects (CN and SAN)
          const subjects: string[] = [];
          const cnMatch = certText.match(/Subject: .*?CN\s*=\s*([^,\n]+)/);
          if (cnMatch) {
            subjects.push(cnMatch[1].trim());
          }
          
          // Extract SAN entries
          const sanMatch = certText.match(/X509v3 Subject Alternative Name:\s*\n\s*(.+)/);
          if (sanMatch) {
            const sanEntries = sanMatch[1].split(',').map(entry => {
              const match = entry.match(/DNS:(.+)|IP Address:(.+)/);
              return match ? (match[1] || match[2]).trim() : null;
            }).filter(Boolean);
            subjects.push(...sanEntries);
          }

          // Check if certificate is valid (not expired)
          const valid = expiresAt ? expiresAt > new Date() : false;
          
          // Check if it's self-signed (issuer == subject for basic check)
          const issuerMatch = certText.match(/Issuer: (.+)/);
          const subjectMatch = certText.match(/Subject: (.+)/);
          const isSelfSigned = issuerMatch && subjectMatch 
            ? issuerMatch[1] === subjectMatch[1] || issuerMatch[1].includes("mkcert")
            : true;
          
          // If created by mkcert, it's trusted locally
          const isTrusted = certText.includes("mkcert") || certText.includes("localhost");

          resolve({
            exists: true,
            valid,
            expiresAt,
            daysUntilExpiry,
            subjects: [...new Set(subjects)], // Remove duplicates
            isSelfSigned,
            isTrusted
          });
        } catch (parseError) {
          logger.error("Failed to parse certificate:", parseError);
          resolve({
            exists: true,
            valid: false,
            subjects: [],
            isSelfSigned: true,
            isTrusted: false
          });
        }
      });
    });
  }

  /**
   * Generate trusted certificates using mkcert
   */
  static async generateTrustedCertificates(certsDir: string): Promise<{ success: boolean; error?: string }> {
    const mainWindow = getMainWindow();
    
    try {
      // Ensure certificates directory exists
      await fs.mkdir(certsDir, { recursive: true });
      
      // Check if mkcert is available
      const mkcertAvailable = await this.isMkcertAvailable();
      if (!mkcertAvailable) {
        return {
          success: false,
          error: "mkcert is not installed. Please install it first using the certificate management options."
        };
      }

      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "Initializing mkcert root CA...",
          step: "certificates"
        });
      }

      // Install mkcert root CA (handle Firefox database errors gracefully)
      try {
        await this.executeCommand("mkcert -install");
      } catch (installError: any) {
        // Check if it's a Firefox-specific error but mkcert CA is already installed
        if (installError.message.includes("The local CA is already installed") && 
            installError.message.includes("certutil") && 
            installError.message.includes("Firefox")) {
          logger.warn("Firefox certificate database error (non-critical):", installError.message);
          logger.info("mkcert CA is already installed in system trust store, continuing...");
          
          if (mainWindow) {
            mainWindow.webContents.send("setup-progress", {
              message: "mkcert CA already installed (Firefox database warning ignored)",
              step: "certificates"
            });
          }
        } else {
          // Re-throw other errors
          throw installError;
        }
      }

      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "Generating SSL certificates...",
          step: "certificates"
        });
      }

      // Generate certificates
      const certPath = path.join(certsDir, "server.crt");
      const keyPath = path.join(certsDir, "server.key");
      
      // Backup existing certificates
      try {
        const timestamp = Date.now();
        await fs.rename(certPath, `${certPath}.bak.${timestamp}`);
        await fs.rename(keyPath, `${keyPath}.bak.${timestamp}`);
        logger.info("Backed up existing certificates");
      } catch {
        // No existing certificates, which is fine
      }

      // Generate new certificates
      const domains = [
        "localhost",
        "127.0.0.1", 
        "::1",
        "ddalab.local",
        "*.ddalab.local",
        "host.docker.internal"
      ];

      const command = `cd "${certsDir}" && mkcert -cert-file server.crt -key-file server.key ${domains.join(" ")}`;
      await this.executeCommand(command);

      // Verify certificates were created
      await fs.access(certPath);
      await fs.access(keyPath);

      // Set appropriate permissions
      await fs.chmod(certPath, 0o644);
      await fs.chmod(keyPath, 0o600);

      logger.info("Trusted SSL certificates generated successfully");
      
      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "SSL certificates generated successfully",
          step: "certificates"
        });
      }

      return { success: true };

    } catch (error: any) {
      logger.error("Failed to generate trusted certificates:", error);
      return {
        success: false,
        error: `Failed to generate certificates: ${error.message}`
      };
    }
  }

  /**
   * Generate fallback self-signed certificates using OpenSSL
   */
  static async generateSelfSignedCertificates(certsDir: string): Promise<{ success: boolean; error?: string }> {
    const mainWindow = getMainWindow();
    
    try {
      await fs.mkdir(certsDir, { recursive: true });
      
      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "Generating self-signed SSL certificates...",
          step: "certificates"
        });
      }

      const certPath = path.join(certsDir, "server.crt");
      const keyPath = path.join(certsDir, "server.key");

      // Create OpenSSL config for SAN
      const configPath = path.join(certsDir, "cert.conf");
      const configContent = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = Local
L = Local
O = DDALAB
OU = Development
CN = localhost

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = ddalab.local
DNS.3 = *.ddalab.local
IP.1 = 127.0.0.1
IP.2 = ::1
`;
      
      await fs.writeFile(configPath, configContent);

      // Generate private key and certificate
      const command = `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -config "${configPath}" -extensions v3_req`;
      await this.executeCommand(command);

      // Clean up config file
      await fs.unlink(configPath);

      // Set appropriate permissions
      await fs.chmod(certPath, 0o644);
      await fs.chmod(keyPath, 0o600);

      logger.info("Self-signed SSL certificates generated");
      
      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "Self-signed SSL certificates generated (browsers will show warnings)",
          step: "certificates"
        });
      }

      return { success: true };

    } catch (error: any) {
      logger.error("Failed to generate self-signed certificates:", error);
      return {
        success: false,
        error: `Failed to generate self-signed certificates: ${error.message}`
      };
    }
  }

  /**
   * Execute a shell command with promise support
   */
  private static executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          logger.error(`Command failed: ${command}`, error);
          reject(new Error(`${error.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Check if certificates need renewal (within 30 days of expiry)
   */
  static async needsRenewal(certsDir: string): Promise<boolean> {
    const certInfo = await this.getCertificateInfo(certsDir);
    
    if (!certInfo.exists || !certInfo.valid) {
      return true;
    }

    return certInfo.daysUntilExpiry !== undefined && certInfo.daysUntilExpiry <= 30;
  }

  /**
   * Get Firefox troubleshooting information
   */
  static getFirefoxTroubleshootingInfo(): string {
    return `
Firefox Certificate Database Issue:

This error occurs when Firefox's certificate database is corrupted or incompatible.
The mkcert CA is properly installed in your system trust store, but Firefox 
cannot update its internal database.

Solutions:
1. The certificates will still work in all browsers including Firefox
2. You can manually trust the certificate in Firefox when prompted
3. Or fix Firefox's certificate database:
   - Close all Firefox windows
   - Delete Firefox profile's cert9.db file
   - Restart Firefox and run 'mkcert -install' again

This is a known Firefox issue and does not affect certificate functionality.
`;
  }
}