import React, { useState } from "react";
import type { ElectronAPI } from "../utils/electron";

interface ProgressStep {
  id: string;
  title: string;
  isCompleted: boolean;
  isCurrent: boolean;
  isAccessible: boolean;
}

interface ProgressSidebarProps {
  currentSite: string;
  setupType: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  electronAPI?: ElectronAPI;
  isSetupComplete?: boolean;
}

export const ProgressSidebar: React.FC<ProgressSidebarProps> = ({
  currentSite,
  setupType,
  isExpanded,
  onToggle,
  electronAPI,
  isSetupComplete = false,
}) => {
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [buildInfo, setBuildInfo] = useState<{
    version: string;
    environment: string;
  } | null>(null);

  React.useEffect(() => {
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

  const getSteps = (): ProgressStep[] => {
    // If setup is complete, don't show setup steps anymore
    if (isSetupComplete) {
      return [];
    }

    const baseSteps = [
      {
        id: "welcome",
        title: "Setup Type",
        isCompleted: !!setupType,
        isCurrent: currentSite === "welcome",
        isAccessible: true,
      },
      {
        id: "data-location",
        title: "Data Location",
        isCompleted: currentSite !== "welcome" && currentSite !== "data-location",
        isCurrent: currentSite === "data-location",
        isAccessible: !!setupType,
      },
    ];

    if (setupType === "docker") {
      return [
        ...baseSteps,
        {
          id: "clone-location",
          title: "Setup Location",
          isCompleted: ["docker-config", "summary"].includes(currentSite),
          isCurrent: currentSite === "clone-location",
          isAccessible: baseSteps[1].isCompleted,
        },
        {
          id: "docker-config",
          title: "Docker Config",
          isCompleted: currentSite === "summary",
          isCurrent: currentSite === "docker-config",
          isAccessible: currentSite !== "welcome" && currentSite !== "data-location" && currentSite !== "clone-location",
        },
        {
          id: "summary",
          title: "Install",
          isCompleted: false,
          isCurrent: currentSite === "summary",
          isAccessible: ["docker-config", "summary"].includes(currentSite),
        },
      ];
    } else if (setupType === "manual") {
      return [
        ...baseSteps,
        {
          id: "manual-config",
          title: "Configuration",
          isCompleted: currentSite === "summary",
          isCurrent: currentSite === "manual-config",
          isAccessible: baseSteps[1].isCompleted,
        },
        {
          id: "summary",
          title: "Install",
          isCompleted: false,
          isCurrent: currentSite === "summary",
          isAccessible: ["manual-config", "summary"].includes(currentSite),
        },
      ];
    }

    return baseSteps;
  };

  const steps = getSteps();

  return (
    <div className={`progress-sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-header">
        <button
          className="btn btn-sm btn-outline-secondary toggle-btn"
          onClick={onToggle}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isExpanded ? '◀' : '▶'}
        </button>
        {isExpanded && <h6 className="mb-0">{isSetupComplete ? 'DDALAB Control' : 'Setup Progress'}</h6>}
      </div>

      {isExpanded && (
        <div className="sidebar-content">
          {!isSetupComplete && (
            <div className="progress-steps">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`progress-step ${step.isCurrent ? 'current' : ''} ${
                    step.isCompleted ? 'completed' : ''
                  } ${!step.isAccessible ? 'disabled' : ''}`}
                >
                  <div className="step-indicator">
                    {step.isCompleted ? (
                      <span className="checkmark">✓</span>
                    ) : (
                      <span className="step-number">{index + 1}</span>
                    )}
                  </div>
                  <div className="step-title">{step.title}</div>
                </div>
              ))}
            </div>
          )}

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
        .progress-sidebar {
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

        .progress-sidebar.collapsed {
          width: 50px;
        }

        .progress-sidebar.expanded {
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
        }

        .progress-steps {
          flex: 1;
        }

        .progress-step {
          display: flex;
          align-items: center;
          padding: 12px 0;
          opacity: 0.5;
          transition: opacity 0.2s ease;
        }

        .progress-step.current {
          opacity: 1;
          font-weight: 600;
        }

        .progress-step.completed {
          opacity: 0.8;
        }

        .progress-step.disabled {
          opacity: 0.3;
        }

        .step-indicator {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #e9ecef;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 12px;
          font-size: 12px;
          flex-shrink: 0;
        }

        .progress-step.current .step-indicator {
          background: #007bff;
          color: white;
        }

        .progress-step.completed .step-indicator {
          background: #28a745;
          color: white;
        }

        .checkmark {
          font-size: 14px;
          font-weight: bold;
        }

        .step-number {
          font-size: 11px;
          font-weight: 600;
        }

        .step-title {
          font-size: 14px;
          line-height: 1.2;
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
