import { ipcMain } from "electron";
import { CertificateService } from "../services/certificate-service";
import { logger } from "../utils/logger";
import path from "path";

export function registerCertificateIpcHandlers() {
  // Check if mkcert is available
  ipcMain.handle("check-mkcert-available", async () => {
    logger.info("IPC: check-mkcert-available");
    try {
      return await CertificateService.isMkcertAvailable();
    } catch (error: any) {
      logger.error("Error checking mkcert availability:", error);
      return false;
    }
  });

  // Install mkcert
  ipcMain.handle("install-mkcert", async () => {
    logger.info("IPC: install-mkcert");
    try {
      return await CertificateService.installMkcert();
    } catch (error: any) {
      logger.error("Error installing mkcert:", error);
      return { success: false, error: error.message };
    }
  });

  // Get certificate information
  ipcMain.handle("get-certificate-info", async (event, certsDir: string) => {
    logger.info("IPC: get-certificate-info");
    try {
      return await CertificateService.getCertificateInfo(certsDir);
    } catch (error: any) {
      logger.error("Error getting certificate info:", error);
      return {
        exists: false,
        valid: false,
        subjects: [],
        isSelfSigned: true,
        isTrusted: false,
        error: error.message
      };
    }
  });

  // Generate trusted certificates
  ipcMain.handle("generate-trusted-certificates", async (event, certsDir: string) => {
    logger.info("IPC: generate-trusted-certificates");
    try {
      return await CertificateService.generateTrustedCertificates(certsDir);
    } catch (error: any) {
      logger.error("Error generating trusted certificates:", error);
      return { success: false, error: error.message };
    }
  });

  // Generate self-signed certificates
  ipcMain.handle("generate-self-signed-certificates", async (event, certsDir: string) => {
    logger.info("IPC: generate-self-signed-certificates");
    try {
      return await CertificateService.generateSelfSignedCertificates(certsDir);
    } catch (error: any) {
      logger.error("Error generating self-signed certificates:", error);
      return { success: false, error: error.message };
    }
  });

  // Check if certificates need renewal
  ipcMain.handle("check-certificates-need-renewal", async (event, certsDir: string) => {
    logger.info("IPC: check-certificates-need-renewal");
    try {
      return await CertificateService.needsRenewal(certsDir);
    } catch (error: any) {
      logger.error("Error checking certificate renewal:", error);
      return true; // Assume renewal needed on error
    }
  });

  logger.info("Certificate IPC handlers registered");
}