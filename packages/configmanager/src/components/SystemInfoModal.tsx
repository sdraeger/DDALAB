import React, { useState, useEffect } from "react";
import type { ElectronAPI } from "../utils/electron";

interface SystemInfoModalProps {
  electronAPI?: ElectronAPI;
  onClose: () => void;
}

interface SystemInfo {
  version: string;
  environment: string;
  platform: string;
  nodeVersion: string;
  electronVersion: string;
  dockerInfo?: {
    dockerInstalled: boolean;
    dockerComposeInstalled: boolean;
    dockerVersion?: string;
    dockerComposeVersion?: string;
    dockerRunning?: boolean;
    error?: string;
  };
  paths: {
    dataLocation?: string;
    cloneLocation?: string;
    userDataPath: string;
  };
}

export const SystemInfoModal: React.FC<SystemInfoModalProps> = ({
  electronAPI,
  onClose,
}) => {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      console.log('SystemInfoModal: Starting to fetch system info...');
      setIsLoading(true);
      
      try {
        // Start with basic info that should always work
        const info: SystemInfo = {
          version: 'Unknown',
          environment: 'Unknown',
          platform: navigator?.platform || 'Unknown',
          nodeVersion: 'Unknown',
          electronVersion: 'Unknown',
          paths: {
            userDataPath: 'Unknown'
          }
        };

        console.log('SystemInfoModal: Basic info initialized:', info);

        if (!electronAPI) {
          console.warn('SystemInfoModal: electronAPI not available, using basic info only');
          setSystemInfo(info);
          return;
        }

        console.log('SystemInfoModal: electronAPI available, fetching detailed info...');

        // Get system info (platform, versions, etc.)
        try {
          console.log('SystemInfoModal: Getting system info...');
          const systemData = await electronAPI.getSystemInfo();
          info.platform = systemData.platform || 'Unknown';
          info.nodeVersion = systemData.nodeVersion || 'Unknown';
          info.electronVersion = systemData.electronVersion || 'Unknown';
          console.log('SystemInfoModal: System data:', systemData);
        } catch (error) {
          console.error('SystemInfoModal: Failed to get system info:', error);
          info.platform = 'Error getting platform';
          info.nodeVersion = 'Error getting Node version';
          info.electronVersion = 'Error getting Electron version';
        }

        // Get version - this should be safe
        try {
          console.log('SystemInfoModal: Getting version...');
          const version = await electronAPI.getCurrentVersion();
          info.version = version || 'Unknown';
          console.log('SystemInfoModal: Version:', info.version);
        } catch (error) {
          console.error('SystemInfoModal: Failed to get version:', error);
          info.version = 'Error getting version';
        }

        // Get environment - this should be safe
        try {
          console.log('SystemInfoModal: Getting environment...');
          const environment = await electronAPI.getEnvironment();
          info.environment = environment || 'Unknown';
          console.log('SystemInfoModal: Environment:', info.environment);
        } catch (error) {
          console.error('SystemInfoModal: Failed to get environment:', error);
          info.environment = 'Error getting environment';
        }

        // Initialize Docker info with safe defaults
        info.dockerInfo = {
          dockerInstalled: false,
          dockerComposeInstalled: false,
          dockerRunning: false,
          error: 'Checking...'
        };

        // Get Docker installation info
        try {
          console.log('SystemInfoModal: Checking Docker installation...');
          const dockerStatus = await electronAPI.checkDockerInstallation();
          console.log('SystemInfoModal: Docker installation status:', dockerStatus);
          
          info.dockerInfo = {
            dockerInstalled: dockerStatus?.dockerInstalled || false,
            dockerComposeInstalled: dockerStatus?.dockerComposeInstalled || false,
            dockerVersion: dockerStatus?.dockerVersion,
            dockerComposeVersion: dockerStatus?.dockerComposeVersion,
            error: dockerStatus?.error
          };
        } catch (error) {
          console.error('SystemInfoModal: Failed to get Docker installation info:', error);
          info.dockerInfo.error = `Failed to check Docker: ${error}`;
        }

        // Get Docker daemon status
        try {
          console.log('SystemInfoModal: Checking Docker daemon status...');
          const dockerRunning = await electronAPI.getIsDockerRunning();
          console.log('SystemInfoModal: Docker running:', dockerRunning);
          
          if (info.dockerInfo) {
            info.dockerInfo.dockerRunning = dockerRunning;
          }
        } catch (error) {
          console.error('SystemInfoModal: Failed to get Docker running status:', error);
          if (info.dockerInfo) {
            info.dockerInfo.dockerRunning = false;
          }
        }

        // Get DDALAB service status
        try {
          console.log('SystemInfoModal: Checking DDALAB service status...');
          const ddalabRunning = await electronAPI.getDockerStatus();
          console.log('SystemInfoModal: DDALAB running:', ddalabRunning);
          
          if (info.dockerInfo) {
            (info.dockerInfo as any).ddalabRunning = ddalabRunning;
          }
        } catch (error) {
          console.error('SystemInfoModal: Failed to get DDALAB status:', error);
          // Not critical, continue
        }

        // Get setup paths
        try {
          console.log('SystemInfoModal: Getting setup paths...');
          const state = await electronAPI.getConfigManagerState();
          console.log('SystemInfoModal: Config manager state:', state);
          
          info.paths.dataLocation = state?.dataLocation || 'Not configured';
          info.paths.cloneLocation = state?.cloneLocation || 'Not configured';
        } catch (error) {
          console.error('SystemInfoModal: Failed to get setup paths:', error);
          info.paths.dataLocation = 'Error loading paths';
          info.paths.cloneLocation = 'Error loading paths';
        }

        console.log('SystemInfoModal: Final system info:', info);
        setSystemInfo(info);
        
      } catch (error) {
        console.error('SystemInfoModal: Critical error in fetchSystemInfo:', error);
        
        // Fallback: create minimal system info
        const fallbackInfo: SystemInfo = {
          version: 'Error',
          environment: 'Error',
          platform: 'Unknown',
          nodeVersion: 'Unknown',
          electronVersion: 'Unknown',
          dockerInfo: {
            dockerInstalled: false,
            dockerComposeInstalled: false,
            dockerRunning: false,
            error: `Critical error: ${error}`
          },
          paths: {
            dataLocation: 'Error',
            cloneLocation: 'Error',
            userDataPath: 'Error'
          }
        };
        
        setSystemInfo(fallbackInfo);
      } finally {
        console.log('SystemInfoModal: Finished fetching system info');
        setIsLoading(false);
      }
    };

    fetchSystemInfo();
  }, [electronAPI]);

  const copyToClipboard = async () => {
    if (!systemInfo) return;

    const text = `DDALAB ConfigManager System Information
Version: ${systemInfo.version}
Environment: ${systemInfo.environment}
Platform: ${systemInfo.platform}
Node.js: ${systemInfo.nodeVersion}
Electron: ${systemInfo.electronVersion}

Docker Information:
- Docker Installed: ${systemInfo.dockerInfo?.dockerInstalled ? 'Yes' : 'No'}
- Docker Compose Installed: ${systemInfo.dockerInfo?.dockerComposeInstalled ? 'Yes' : 'No'}
- Docker Version: ${systemInfo.dockerInfo?.dockerVersion || 'Unknown'}
- Docker Compose Version: ${systemInfo.dockerInfo?.dockerComposeVersion || 'Unknown'}
- Docker Running: ${systemInfo.dockerInfo?.dockerRunning ? 'Yes' : 'No'}

Setup Paths:
- Data Location: ${systemInfo.paths.dataLocation || 'Not configured'}
- Clone Location: ${systemInfo.paths.cloneLocation || 'Not configured'}`;

    try {
      await navigator.clipboard.writeText(text);
      alert('System information copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      alert('Failed to copy to clipboard');
    }
  };

  return (
    <div className="system-info-modal">
      <div className="modal-backdrop show"></div>
      <div className="modal show d-block">
        <div className="modal-dialog modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title-container">
                <h5 className="modal-title">🛠️ System Information</h5>
                <p className="modal-subtitle">DDALAB ConfigManager diagnostic information</p>
              </div>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
            <div className="modal-body">
              {isLoading ? (
                <div className="text-center">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <p className="mt-2">Gathering system information...</p>
                </div>
              ) : !systemInfo ? (
                <div className="alert alert-danger">
                  <h6>Error Loading System Information</h6>
                  <p>Unable to load system information. This might be due to:</p>
                  <ul>
                    <li>Electron API not available</li>
                    <li>Permission issues</li>
                    <li>Application startup errors</li>
                  </ul>
                  <p>Please check the developer console for more details.</p>
                </div>
              ) : (
                <div className="system-info-content">
                  {/* Application Info */}
                  <div className="info-section">
                    <h6 className="section-title">Application</h6>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-label">Version:</span>
                        <span className="info-value">{systemInfo.version}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Environment:</span>
                        <span className={`info-value badge ${systemInfo.environment === 'production' ? 'bg-success' : 'bg-warning'}`}>
                          {systemInfo.environment}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Platform:</span>
                        <span className="info-value">{systemInfo.platform}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Node.js:</span>
                        <span className="info-value">{systemInfo.nodeVersion}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Electron:</span>
                        <span className="info-value">{systemInfo.electronVersion}</span>
                      </div>
                    </div>
                  </div>

                  {/* Docker Info */}
                  <div className="info-section">
                    <h6 className="section-title">Docker Status</h6>
                    {systemInfo.dockerInfo ? (
                      <div className="info-grid">
                        <div className="info-item">
                          <span className="info-label">Docker Installed:</span>
                          <span className={`info-value badge ${systemInfo.dockerInfo.dockerInstalled ? 'bg-success' : 'bg-danger'}`}>
                            {systemInfo.dockerInfo.dockerInstalled ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">Docker Compose:</span>
                          <span className={`info-value badge ${systemInfo.dockerInfo.dockerComposeInstalled ? 'bg-success' : 'bg-danger'}`}>
                            {systemInfo.dockerInfo.dockerComposeInstalled ? 'Yes' : 'No'}
                          </span>
                        </div>
                        {systemInfo.dockerInfo.dockerVersion && (
                          <div className="info-item">
                            <span className="info-label">Docker Version:</span>
                            <span className="info-value">{systemInfo.dockerInfo.dockerVersion}</span>
                          </div>
                        )}
                        {systemInfo.dockerInfo.dockerComposeVersion && (
                          <div className="info-item">
                            <span className="info-label">Compose Version:</span>
                            <span className="info-value">{systemInfo.dockerInfo.dockerComposeVersion}</span>
                          </div>
                        )}
                        <div className="info-item">
                          <span className="info-label">Docker Running:</span>
                          <span className={`info-value badge ${systemInfo.dockerInfo.dockerRunning ? 'bg-success' : 'bg-warning'}`}>
                            {systemInfo.dockerInfo.dockerRunning ? 'Yes' : 'No'}
                          </span>
                        </div>
                        {(systemInfo.dockerInfo as any).ddalabRunning !== undefined && (
                          <div className="info-item">
                            <span className="info-label">DDALAB Services:</span>
                            <span className={`info-value badge ${(systemInfo.dockerInfo as any).ddalabRunning ? 'bg-success' : 'bg-warning'}`}>
                              {(systemInfo.dockerInfo as any).ddalabRunning ? 'Running' : 'Stopped'}
                            </span>
                          </div>
                        )}
                        {systemInfo.dockerInfo.error && (
                          <div className="info-item">
                            <span className="info-label">Error:</span>
                            <span className="info-value text-danger">{systemInfo.dockerInfo.error}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted">Docker information unavailable</p>
                    )}
                  </div>

                  {/* Setup Paths */}
                  <div className="info-section">
                    <h6 className="section-title">Setup Paths</h6>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-label">Data Location:</span>
                        <span className="info-value path-value">{systemInfo.paths.dataLocation || 'Not configured'}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Clone Location:</span>
                        <span className="info-value path-value">{systemInfo.paths.cloneLocation || 'Not configured'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={copyToClipboard}
                disabled={!systemInfo}
              >
                Copy to Clipboard
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .system-info-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2000;
        }

        .modal-backdrop {
          background-color: rgba(0, 0, 0, 0.5);
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1999;
        }

        .modal {
          z-index: 2001;
        }

        .modal-content {
          border-radius: 16px;
          border: none;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        }

        .modal-header {
          padding: 24px 24px 16px;
          border-bottom: 1px solid #e9ecef;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-radius: 16px 16px 0 0;
        }

        .modal-title-container {
          flex: 1;
        }

        .modal-title {
          font-size: 20px;
          font-weight: 700;
          margin: 0;
          color: white;
        }

        .modal-subtitle {
          font-size: 14px;
          margin: 4px 0 0 0;
          color: rgba(255, 255, 255, 0.8);
          font-weight: 400;
        }

        .btn-close {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          width: 32px;
          height: 32px;
          opacity: 1;
        }

        .btn-close:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .modal-body {
          padding: 24px;
          background: #f8f9fa;
        }

        .modal-footer {
          padding: 16px 24px;
          border-top: 1px solid #e9ecef;
          background: white;
          border-radius: 0 0 16px 16px;
        }

        .system-info-content {
          max-height: 500px;
          overflow-y: auto;
        }

        .info-section {
          margin-bottom: 24px;
          background: #ffffff;
          border-radius: 12px;
          border: 1px solid #e1e5e9;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
          overflow: hidden;
        }

        .section-title {
          font-size: 15px;
          font-weight: 600;
          color: #2c3e50;
          margin: 0;
          padding: 16px 20px;
          background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
          border-bottom: 1px solid #dee2e6;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .info-grid {
          padding: 0;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 12px 20px;
          border-bottom: 1px solid #f1f3f4;
          transition: background-color 0.2s ease;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-item:hover {
          background-color: #f8f9fa;
        }

        .info-label {
          font-weight: 500;
          color: #495057;
          min-width: 140px;
          font-size: 14px;
          flex-shrink: 0;
          margin-right: 16px;
        }

        .info-value {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          font-size: 13px;
          color: #2c3e50;
          text-align: right;
          flex: 1;
          word-break: break-word;
          line-height: 1.4;
        }

        .path-value {
          font-size: 12px;
          color: #6c757d;
          background: #f8f9fa;
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid #e9ecef;
          max-width: 350px;
          word-break: break-all;
          line-height: 1.3;
        }

        .badge {
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 20px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .bg-success {
          background-color: #d4edda !important;
          color: #155724 !important;
          border: 1px solid #c3e6cb;
        }

        .bg-warning {
          background-color: #fff3cd !important;
          color: #856404 !important;
          border: 1px solid #ffeaa7;
        }

        .bg-danger {
          background-color: #f8d7da !important;
          color: #721c24 !important;
          border: 1px solid #f5c6cb;
        }

        .text-danger {
          color: #dc3545 !important;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
};