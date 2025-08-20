import React, { useState, useEffect } from "react";
import type { ElectronAPI, UserSelections } from "../utils/electron";
import { useSystemStatusContext } from "../context/SystemStatusProvider";

interface SimplifiedControlSidebarProps {
  isExpanded: boolean;
  onToggle: () => void;
  electronAPI?: ElectronAPI;
  userSelections: UserSelections;
  onNewSetup: () => void;
  onShowUpdateModal: () => void;
}

interface ServiceStatus {
  running: boolean;
  healthy: boolean;
  services: { [key: string]: string };
}

export const SimplifiedControlSidebar: React.FC<SimplifiedControlSidebarProps> = ({
  isExpanded,
  onToggle,
  electronAPI,
  userSelections,
  onNewSetup,
  onShowUpdateModal,
}) => {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [buildInfo, setBuildInfo] = useState<{
    version: string;
    environment: string;
  } | null>(null);
  
  // Use centralized system status
  const systemStatus = useSystemStatusContext();

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

  // Update service status from centralized status
  useEffect(() => {
    const detailedServices = systemStatus.getDetailedServiceStatus();
    
    setServiceStatus({
      running: systemStatus.isDockerRunning,
      healthy: systemStatus.isDdalabHealthy,
      services: {
        "Docker Engine": detailedServices[0]?.description || "Unknown",
        "DDALAB Services": detailedServices[1]?.description || "Unknown"
      }
    });
  }, [systemStatus]);

  const handleCheckForUpdates = async () => {
    if (!electronAPI || isCheckingUpdate) return;

    // Use the enhanced update modal instead of handling updates inline
    onShowUpdateModal();
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

  return (
    <div className={`simplified-control-sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-header">
        <button
          className="btn btn-sm btn-outline-secondary toggle-btn"
          onClick={onToggle}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isExpanded ? '◀' : '▶'}
        </button>
        {isExpanded && <h6 className="mb-0">DDALAB</h6>}
      </div>

      {isExpanded && (
        <div className="sidebar-content">
          {/* Service Status Summary */}
          <div className="status-section">
            <h6 className="section-title">Status</h6>
            {serviceStatus && (
              <div className="status-summary">
                <div className="overall-status">
                  <div className={`status-indicator ${serviceStatus.healthy ? 'healthy' : 'unhealthy'}`}>
                    {serviceStatus.healthy ? '🟢' : '🔴'}
                  </div>
                  <div className="status-text">
                    <div className="fw-bold">
                      {serviceStatus.healthy ? 'Running' : 'Stopped'}
                    </div>
                    <small className="text-muted">
                      {serviceStatus.healthy ? 'All services operational' : 'Services not running'}
                    </small>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Setup Information */}
          <div className="info-section">
            <h6 className="section-title">Setup</h6>
            <div className="info-content">
              <div className="info-item">
                <label>Type:</label>
                <span className="setup-type-badge">
                  {userSelections.setupType || 'Docker'}
                </span>
              </div>
              <div className="info-item">
                <label>Location:</label>
                <div className="location-path" title={userSelections.dataLocation}>
                  {userSelections.dataLocation ?
                    userSelections.dataLocation.split('/').pop() || userSelections.dataLocation :
                    'Not configured'
                  }
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Actions */}
          <div className="actions-section">
            <h6 className="section-title">Actions</h6>
            <div className="d-grid gap-2">
              <button
                className="btn btn-outline-primary btn-sm"
                onClick={onNewSetup}
              >
                🔧 New Setup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer with version and updates */}
      {isExpanded && (
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
                'Check Updates'
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
      )}

      <style jsx>{`
        .simplified-control-sidebar {
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

        .simplified-control-sidebar.collapsed {
          width: 50px;
        }

        .simplified-control-sidebar.expanded {
          width: 280px;
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

        .status-summary {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .overall-status {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .status-indicator {
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .status-text {
          flex: 1;
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

        .actions-section {
          background: #fff;
          padding: 15px;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }

        .sidebar-footer {
          border-top: 1px solid #dee2e6;
          padding: 15px;
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
