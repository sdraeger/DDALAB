import React, { useState, useEffect } from "react";
import type { ElectronAPI, UserSelections } from "../utils/electron";

interface ControlPanelSidebarProps {
  isExpanded: boolean;
  onToggle: () => void;
  electronAPI?: ElectronAPI;
  userSelections: UserSelections;
  onEditConfig: () => void;
  onViewLogs: () => void;
  onManageServices: () => void;
  onSystemInfo: () => void;
}

interface ServiceStatus {
  running: boolean;
  healthy: boolean;
  services: { [key: string]: string };
}

export const ControlPanelSidebar: React.FC<ControlPanelSidebarProps> = ({
  isExpanded,
  onToggle,
  electronAPI,
  userSelections,
  onEditConfig,
  onViewLogs,
  onManageServices,
  onSystemInfo,
}) => {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [buildInfo, setBuildInfo] = useState<{
    version: string;
    environment: string;
  } | null>(null);

  useEffect(() => {
    const fetchBuildInfo = async () => {
      if (electronAPI) {
        try {
          const version = await electronAPI.getCurrentVersion();
          const environment = await electronAPI.getEnvironment();
          setBuildInfo({ version, environment });
        } catch (error) {
          console.error("Failed to fetch build info:", error);
        }
      }
    };
    fetchBuildInfo();
  }, [electronAPI]);

  useEffect(() => {
    const checkServiceStatus = async () => {
      if (electronAPI) {
        try {
          // Check Docker installation status
          const dockerInstallStatus = await electronAPI.checkDockerInstallation();
          console.log('Docker installation status:', dockerInstallStatus);

          // Check if Docker daemon is running
          const dockerDaemonRunning = await electronAPI.getIsDockerRunning();
          console.log('Docker daemon running:', dockerDaemonRunning);

          // Check if DDALAB containers are running
          const ddalabRunning = await electronAPI.getDockerStatus();
          console.log('DDALAB containers running:', ddalabRunning);

          let dockerEngineStatus = "Not installed";
          if (dockerInstallStatus.dockerInstalled) {
            if (dockerDaemonRunning) {
              dockerEngineStatus = "Running";
            } else {
              dockerEngineStatus = "Installed but not running";
            }
          } else if (dockerInstallStatus.error) {
            dockerEngineStatus = `Error: ${dockerInstallStatus.error}`;
          }

          let ddalabServicesStatus = "Docker not running";
          if (dockerDaemonRunning) {
            ddalabServicesStatus = ddalabRunning ? "Running" : "Stopped";
          }

          setServiceStatus({
            running: dockerDaemonRunning,
            healthy: dockerDaemonRunning && ddalabRunning,
            services: {
              "Docker Engine": dockerEngineStatus,
              "DDALAB Services": ddalabServicesStatus
            }
          });
        } catch (error) {
          console.error("Failed to check service status:", error);
          setServiceStatus({
            running: false,
            healthy: false,
            services: {
              "Docker Engine": "Error checking status",
              "DDALAB Services": "Error checking status"
            }
          });
        }
      }
    };

    checkServiceStatus();
    const interval = setInterval(checkServiceStatus, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [electronAPI]);

  const handleCheckForUpdates = async () => {
    if (!electronAPI || isCheckingUpdate) return;

    setIsCheckingUpdate(true);
    try {
      await electronAPI.checkForUpdates();
      const info = await electronAPI.getUpdateInfo();
      setUpdateInfo(info);
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const getStatusClass = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('running')) {
      return 'running';
    } else if (lowerStatus.includes('stopped') || lowerStatus.includes('not running')) {
      return 'stopped';
    } else if (lowerStatus.includes('error') || lowerStatus.includes('unknown')) {
      return 'error';
    } else if (lowerStatus.includes('not installed')) {
      return 'error';
    } else if (lowerStatus.includes('installed')) {
      return 'warning';
    }
    return 'stopped';
  };

  const quickActions = [
    {
      id: 'edit-config',
      title: 'Edit Configuration',
      icon: '⚙️',
      description: 'Modify setup variables',
      onClick: onEditConfig
    },
    {
      id: 'manage-services',
      title: 'Manage Services',
      icon: '🐳',
      description: 'Start/stop Docker services',
      onClick: onManageServices
    },
    {
      id: 'view-logs',
      title: 'View Logs',
      icon: '📋',
      description: 'Application and Docker logs',
      onClick: onViewLogs
    },
    {
      id: 'system-info',
      title: 'System Info',
      icon: 'ℹ️',
      description: 'System and Docker status',
      onClick: onSystemInfo
    }
  ];

  return (
    <div className={`control-panel-sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-header">
        <button
          className="btn btn-sm btn-outline-secondary toggle-btn"
          onClick={onToggle}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isExpanded ? '◀' : '▶'}
        </button>
        {isExpanded && <h6 className="mb-0">DDALAB Control</h6>}
      </div>

      {isExpanded && (
        <div className="sidebar-content">
          {/* Service Status */}
          <div className="status-section">
            <h6 className="section-title">Service Status</h6>
            {serviceStatus && (
              <div className="status-grid">
                {Object.entries(serviceStatus.services).map(([service, status]) => (
                  <div key={service} className="status-item">
                    <span className="service-name">{service}</span>
                    <span className={`status-badge ${getStatusClass(status)}`}>
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="actions-section">
            <h6 className="section-title">Quick Actions</h6>
            <div className="action-grid">
              {quickActions.map(action => (
                <button
                  key={action.id}
                  className="action-button"
                  onClick={action.onClick}
                  title={action.description}
                >
                  <span className="action-icon">{action.icon}</span>
                  <span className="action-title">{action.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Setup Information */}
          <div className="info-section">
            <h6 className="section-title">Setup Info</h6>
            <div className="info-content">
              <div className="info-item">
                <label>Setup Type:</label>
                <span className="setup-type-badge">
                  {userSelections.setupType || 'Docker'}
                </span>
              </div>
              <div className="info-item">
                <label>Data Location:</label>
                <div className="location-path" title={userSelections.dataLocation}>
                  {userSelections.dataLocation ?
                    userSelections.dataLocation.split('/').pop() || userSelections.dataLocation :
                    'Not configured'
                  }
                </div>
              </div>
              {userSelections.setupType === 'docker' && (
                <div className="info-item">
                  <label>Ports:</label>
                  <span className="port-info">
                    Web: {userSelections.webPort || '3000'},
                    API: {userSelections.apiPort || '8001'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Footer with version and updates */}
          <div className="sidebar-footer">
            <div className="build-info">
              {buildInfo && (
                <div className="mb-2">
                  <small className="text-muted">
                    v{buildInfo.version}
                    {buildInfo.environment !== 'production' && (
                      <span className="badge badge-warning ms-1">
                        {buildInfo.environment}
                      </span>
                    )}
                  </small>
                </div>
              )}

              <button
                className="btn btn-sm btn-outline-primary w-100"
                onClick={handleCheckForUpdates}
                disabled={isCheckingUpdate}
              >
                {isCheckingUpdate ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-1" />
                    Checking...
                  </>
                ) : (
                  'Check for Updates'
                )}
              </button>

              {updateInfo && (
                <div className="mt-2">
                  {updateInfo.available ? (
                    <div className="alert alert-info alert-sm">
                      <small>Update available: v{updateInfo.version}</small>
                    </div>
                  ) : (
                    <div className="alert alert-success alert-sm">
                      <small>Up to date</small>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .control-panel-sidebar {
          position: fixed;
          left: 0;
          top: 0;
          height: 100vh;
          background: #f8f9fa;
          border-right: 1px solid #dee2e6;
          transition: width 0.3s ease;
          z-index: 1000;
          display: flex;
          flex-direction: column;
        }

        .control-panel-sidebar.collapsed {
          width: 50px;
        }

        .control-panel-sidebar.expanded {
          width: 320px;
        }

        .sidebar-header {
          padding: 15px;
          border-bottom: 1px solid #dee2e6;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .toggle-btn {
          min-width: 32px;
          height: 32px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sidebar-content {
          flex: 1;
          padding: 20px 15px 15px;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          gap: 20px;
        }

        .section-title {
          font-size: 13px;
          font-weight: 600;
          color: #6c757d;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 10px;
        }

        .status-section {
          background: #fff;
          padding: 15px;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }

        .status-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .status-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .service-name {
          font-size: 12px;
          font-weight: 500;
        }

        .status-badge {
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .status-badge.running {
          background: #d4edda;
          color: #155724;
        }

        .status-badge.stopped {
          background: #f8d7da;
          color: #721c24;
        }

        .status-badge.warning {
          background: #fff3cd;
          color: #856404;
        }

        .status-badge.error {
          background: #f8d7da;
          color: #721c24;
        }

        .actions-section {
          flex: 1;
        }

        .action-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .action-button {
          background: #fff;
          border: 1px solid #e9ecef;
          border-radius: 8px;
          padding: 15px 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          transition: all 0.2s ease;
          cursor: pointer;
          text-decoration: none;
        }

        .action-button:hover {
          border-color: #007bff;
          background: #f8f9ff;
          transform: translateY(-1px);
        }

        .action-icon {
          font-size: 20px;
        }

        .action-title {
          font-size: 11px;
          font-weight: 500;
          text-align: center;
          line-height: 1.2;
          color: #495057;
        }

        .info-section {
          background: #fff;
          padding: 15px;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }

        .info-content {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .info-item label {
          font-size: 11px;
          font-weight: 600;
          color: #6c757d;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .setup-type-badge {
          background: #e7f3ff;
          color: #0066cc;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: capitalize;
          align-self: flex-start;
        }

        .location-path {
          font-size: 12px;
          color: #495057;
          background: #f8f9fa;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: monospace;
          word-break: break-all;
        }

        .port-info {
          font-size: 11px;
          color: #495057;
          font-family: monospace;
        }

        .sidebar-footer {
          border-top: 1px solid #dee2e6;
          padding-top: 15px;
        }

        .build-info {
          text-align: center;
        }

        .badge-warning {
          background-color: #ffc107;
          color: #000;
        }

        .alert-sm {
          padding: 6px 8px;
          font-size: 11px;
          margin-bottom: 0;
        }

        .alert-info {
          background-color: #d1ecf1;
          border-color: #bee5eb;
          color: #0c5460;
        }

        .alert-success {
          background-color: #d4edda;
          border-color: #c3e6cb;
          color: #155724;
        }
      `}</style>
    </div>
  );
};
