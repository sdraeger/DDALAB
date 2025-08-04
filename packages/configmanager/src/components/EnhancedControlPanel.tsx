import React, { useState, useEffect, useRef } from "react";
import { ElectronAPI, UserSelections } from "../utils/electron";
import { useDockerState } from "../hooks/useDockerState";

interface EnhancedControlPanelProps {
  electronAPI?: ElectronAPI;
  userSelections: UserSelections;
  onEditConfig: () => void;
  onSystemInfo: () => void;
  onBugReport: () => void;
}

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  description: string;
  canStart: boolean;
  canStop: boolean;
}

interface LogEntry {
  timestamp: string;
  service: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export const EnhancedControlPanel: React.FC<EnhancedControlPanelProps> = ({
  electronAPI,
  userSelections,
  onEditConfig,
  onSystemInfo,
  onBugReport,
}) => {
  const {
    dockerStatus,
    dockerLogs,
    isTraefikHealthy,
    servicesReady,
    statusUpdate,
    logUpdate,
    addActionLog,
    addErrorLog,
    canStart,
    canStop,
    startDocker,
    stopDocker,
    dockerStarted,
    dockerStopped,
  } = useDockerState();

  const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'logs' | 'config'>('overview');
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [operationInProgress, setOperationInProgress] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailedLogs, setDetailedLogs] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const detailedLogsEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (activeTab === 'overview') {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (activeTab === 'logs') {
      detailedLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(scrollToBottom, [dockerLogs, detailedLogs, activeTab]);

  // Service status checking
  useEffect(() => {
    const checkServiceStatus = async (isInitial = false) => {
      if (!isInitial && operationInProgress) return;

      if (!isInitial) {
        setIsRefreshing(true);
      }

      if (!electronAPI) {
        setServices([{
          name: 'Docker Services',
          status: 'error',
          description: 'Electron API not available',
          canStart: false,
          canStop: false
        }]);
        if (!isInitial) {
          setTimeout(() => setIsRefreshing(false), 500);
        }
        return;
      }

      try {
        const dockerInstalled = await electronAPI.checkDockerInstallation();
        const dockerRunning = await electronAPI.getIsDockerRunning();
        const ddalabRunning = await electronAPI.getDockerStatus();

        const serviceList: ServiceStatus[] = [
          {
            name: 'Docker Engine',
            status: dockerInstalled.dockerInstalled ?
              (dockerRunning ? 'running' : 'stopped') : 'error',
            description: dockerInstalled.dockerInstalled ?
              (dockerRunning ? 'Docker daemon is running' : 'Docker daemon is not running') :
              'Docker is not installed',
            canStart: false,
            canStop: false
          },
          {
            name: 'DDALAB Services',
            status: dockerRunning ? (ddalabRunning ? 'running' : 'stopped') : 'error',
            description: dockerRunning ?
              (ddalabRunning ? 'All DDALAB containers are running' : 'DDALAB containers are stopped') :
              'Docker daemon is not running',
            canStart: dockerRunning && !ddalabRunning,
            canStop: dockerRunning && ddalabRunning
          }
        ];

        setServices(serviceList);
      } catch (error) {
        console.error('Failed to check service status:', error);
        setServices([{
          name: 'Service Check',
          status: 'error',
          description: `Failed to check service status: ${error}`,
          canStart: false,
          canStop: false
        }]);
      } finally {
        if (!isInitial) {
          setTimeout(() => setIsRefreshing(false), 500);
        }
      }
    };

    checkServiceStatus(true);
    const interval = setInterval(() => checkServiceStatus(false), 8000);
    return () => clearInterval(interval);
  }, [electronAPI, operationInProgress]);

  // Other useEffects from original ControlPanelSite
  useEffect(() => {
    if (!electronAPI) return;

    const removeReadyListener = electronAPI.onAllServicesReady?.(() => {
      console.log("[EnhancedControlPanel] Received ddalab-services-ready.");
      servicesReady();
    });

    return () => {
      removeReadyListener?.();
    };
  }, [electronAPI, servicesReady]);

  useEffect(() => {
    const validateSetup = async () => {
      if (!electronAPI?.validateDockerSetup || !userSelections.cloneLocation) return;

      try {
        console.log("[EnhancedControlPanel] Validating setup on load...");
        const result = await electronAPI.validateDockerSetup(userSelections.cloneLocation);
        if (!result.success && result.needsSetup) {
          console.warn("[EnhancedControlPanel] Setup validation failed, needs setup:", result.message);
          addErrorLog(`Setup validation failed: ${result.message}`);
        } else {
          console.log("[EnhancedControlPanel] Setup validation successful");
        }
      } catch (error) {
        console.error("[EnhancedControlPanel] Setup validation error:", error);
        addErrorLog(`Setup validation error: ${error}`);
      }
    };

    validateSetup();
  }, [electronAPI, userSelections.cloneLocation, addErrorLog]);

  // Service control handlers
  const handleStartServices = async () => {
    if (!electronAPI || operationInProgress) return;

    setOperationInProgress('start');
    startDocker();
    addActionLog("Attempting to start DDALAB services...");

    try {
      const result = await electronAPI.startDockerCompose();
      if (!result) {
        addErrorLog("Start operation failed");
      } else {
        try {
          await electronAPI.getDockerLogs();
          addActionLog("Log streaming started");
        } catch (error) {
          console.warn("[EnhancedControlPanel] Failed to start log streaming:", error);
        }
      }
    } catch (error: any) {
      console.error("[EnhancedControlPanel] Error starting services:", error);
      addErrorLog(`Failed to start services: ${error.message}`);
    } finally {
      setOperationInProgress(null);
    }
  };

  const handleStopServices = async () => {
    if (!electronAPI || operationInProgress) return;

    setOperationInProgress('stop');
    stopDocker();
    addActionLog("Attempting to stop DDALAB services...");

    try {
      const result = await electronAPI.stopDockerCompose();
      if (!result) {
        addErrorLog("Stop operation failed");
      } else {
        addActionLog("Services stopped successfully");
      }
    } catch (error: any) {
      console.error("[EnhancedControlPanel] Error stopping services:", error);
      addErrorLog(`Failed to stop services: ${error.message}`);
    } finally {
      setOperationInProgress(null);
    }
  };

  const handleRestartServices = async () => {
    if (!electronAPI || operationInProgress) return;

    setOperationInProgress('restart');
    addActionLog('Restarting DDALAB services...');

    try {
      const stopResult = await electronAPI.stopDockerCompose(false);
      if (!stopResult) {
        throw new Error('Failed to stop services');
      }

      addActionLog('Services stopped, starting again...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const startResult = await electronAPI.startDockerCompose();
      if (startResult) {
        addActionLog('DDALAB services restarted successfully');
      } else {
        addActionLog('Failed to restart services - start operation failed');
      }
    } catch (error) {
      console.error('Failed to restart services:', error);
      addErrorLog(`Failed to restart services: ${error}`);
    } finally {
      setOperationInProgress(null);
    }
  };

  const getStatusIcon = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'running': return '🟢';
      case 'stopped': return '🔴';
      case 'error': return '⚠️';
      default: return '❓';
    }
  };

  const getStatusClass = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'running': return 'success';
      case 'stopped': return 'warning';
      case 'error': return 'danger';
      default: return 'secondary';
    }
  };

  const parseDockerLogs = (logs: string[]): LogEntry[] => {
    return logs.map((log, index) => ({
      timestamp: new Date().toISOString(),
      service: 'Docker',
      level: log.toLowerCase().includes('error') ? 'error' :
             log.toLowerCase().includes('warn') ? 'warn' : 'info',
      message: log
    }));
  };

  const filteredLogs = detailedLogs.filter(log => {
    const levelMatch = filterLevel === 'all' || log.level === filterLevel;
    const serviceMatch = filterService === 'all' || log.service === filterService;
    return levelMatch && serviceMatch;
  });

  const renderOverviewTab = () => (
    <div className="row">
      <div className="col-md-8">
        {/* Service Status Cards */}
        <div className="row mb-4">
          {services.map((service, index) => (
            <div key={index} className="col-md-6 mb-3">
              <div className="card h-100">
                <div className="card-body">
                  <div className="d-flex align-items-center mb-2">
                    <span className="service-icon me-2">{getStatusIcon(service.status)}</span>
                    <h6 className="card-title mb-0">{service.name}</h6>
                    <span className={`badge bg-${getStatusClass(service.status)} ms-auto`}>
                      {service.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="card-text small text-muted">{service.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Main Controls */}
        <div className="card mb-4">
          <div className="card-body">
            <h5 className="card-title">
              Service Controls
              {isRefreshing && (
                <span className="spinner-border spinner-border-sm ms-2 opacity-50" role="status">
                  <span className="visually-hidden">Refreshing...</span>
                </span>
              )}
            </h5>
            <div className="btn-toolbar" role="toolbar">
              <div className="btn-group me-2" role="group">
                <button
                  className="btn btn-success"
                  onClick={handleStartServices}
                  disabled={operationInProgress !== null || !canStart()}
                >
                  {operationInProgress === 'start' ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Starting...
                    </>
                  ) : (
                    '▶️ Start Services'
                  )}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleStopServices}
                  disabled={operationInProgress !== null || !canStop()}
                >
                  {operationInProgress === 'stop' ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Stopping...
                    </>
                  ) : (
                    '⏹️ Stop Services'
                  )}
                </button>
                <button
                  className="btn btn-warning"
                  onClick={handleRestartServices}
                  disabled={operationInProgress !== null || !canStop()}
                >
                  {operationInProgress === 'restart' ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Restarting...
                    </>
                  ) : (
                    '🔄 Restart Services'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Status Summary */}
        <div className="card">
          <div className="card-body">
            <h5 className="card-title">Application Status</h5>
            <div className="row">
              <div className="col-md-6">
                <strong>Overall Status:</strong>
                <span className={`ms-2 badge ${dockerStatus.includes('Running') ? 'bg-success' :
                  dockerStatus.includes('Starting') || dockerStatus.includes('Stopping') ? 'bg-warning' : 'bg-secondary'}`}>
                  {dockerStatus}
                </span>
              </div>
              {(dockerStatus.includes("Running") || dockerStatus.includes("Checking Health")) && (
                <div className="col-md-6">
                  <strong>Services Health:</strong>
                  <span className={`ms-2 badge ${isTraefikHealthy ? 'bg-success' : 'bg-warning'}`}>
                    {isTraefikHealthy ? 'Healthy' : 'Pending'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="col-md-4">
        {/* Quick Actions */}
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="card-title">Quick Actions</h6>
            <div className="d-grid gap-2">
              <button className="btn btn-outline-primary btn-sm" onClick={onEditConfig}>
                ⚙️ Edit Configuration
              </button>
              <button className="btn btn-outline-info btn-sm" onClick={onSystemInfo}>
                ℹ️ System Information
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={onBugReport}>
                🐛 Report Bug
              </button>
            </div>
          </div>
        </div>

        {/* Recent Events */}
        <div className="card">
          <div className="card-body">
            <h6 className="card-title">Recent Events</h6>
            <div
              className="logs-container"
              style={{
                height: "200px",
                overflowY: "scroll",
                backgroundColor: "#f8f9fa",
                border: "1px solid #ced4da",
                padding: "8px",
                fontSize: "0.75em",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {dockerLogs.length > 0 ? (
                dockerLogs.slice(-10).map((log: string, index: number) => (
                  <div key={index} className="small">{log}</div>
                ))
              ) : (
                <p className="text-muted small">No recent events</p>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderServicesTab = () => (
    <div className="services-management">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h4>Service Management</h4>
        {isRefreshing && (
          <span className="text-muted">
            <span className="spinner-border spinner-border-sm me-2" />
            Refreshing status...
          </span>
        )}
      </div>

      {/* Global Actions */}
      <div className="card mb-4">
        <div className="card-body">
          <h6 className="card-title">Global Actions</h6>
          <div className="btn-group" role="group">
            <button
              className="btn btn-success"
              onClick={handleStartServices}
              disabled={operationInProgress !== null || !services.find(s => s.name === 'DDALAB Services')?.canStart}
            >
              {operationInProgress === 'start' ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Starting...
                </>
              ) : (
                '▶️ Start All Services'
              )}
            </button>
            <button
              className="btn btn-danger"
              onClick={handleStopServices}
              disabled={operationInProgress !== null || !services.find(s => s.name === 'DDALAB Services')?.canStop}
            >
              {operationInProgress === 'stop' ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Stopping...
                </>
              ) : (
                '⏹️ Stop All Services'
              )}
            </button>
            <button
              className="btn btn-warning"
              onClick={handleRestartServices}
              disabled={operationInProgress !== null || !services.find(s => s.name === 'DDALAB Services')?.canStop}
            >
              {operationInProgress === 'restart' ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Restarting...
                </>
              ) : (
                '🔄 Restart Services'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Service List */}
      <div className="card">
        <div className="card-body">
          <h6 className="card-title">Service Status</h6>
          {services.map((service, index) => (
            <div key={index} className="service-item border-bottom py-3">
              <div className="d-flex justify-content-between align-items-center">
                <div className="service-info">
                  <div className="d-flex align-items-center mb-2">
                    <span className="service-icon me-2">{getStatusIcon(service.status)}</span>
                    <h6 className="mb-0 me-3">{service.name}</h6>
                    <span className={`badge bg-${getStatusClass(service.status)}`}>
                      {service.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-muted small mb-0">{service.description}</p>
                </div>
                <div className="service-actions">
                  {service.canStart && (
                    <button
                      className="btn btn-sm btn-success me-2"
                      onClick={handleStartServices}
                      disabled={operationInProgress !== null}
                    >
                      Start
                    </button>
                  )}
                  {service.canStop && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={handleStopServices}
                      disabled={operationInProgress !== null}
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderLogsTab = () => (
    <div className="logs-viewer">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>System Logs</h4>
        <div className="d-flex gap-2">
          <select
            className="form-select form-select-sm"
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
          <select
            className="form-select form-select-sm"
            value={filterService}
            onChange={(e) => setFilterService(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">All Services</option>
            <option value="Docker">Docker</option>
            <option value="System">System</option>
          </select>
          <div className="form-check form-switch">
            <input
              className="form-check-input"
              type="checkbox"
              id="autoScroll"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <label className="form-check-label small" htmlFor="autoScroll">
              Auto-scroll
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body p-0">
          <div
            className="logs-container"
            style={{
              height: "500px",
              overflowY: "scroll",
              backgroundColor: "#1e1e1e",
              color: "#fff",
              padding: "16px",
              fontFamily: "Monaco, 'Courier New', monospace",
              fontSize: "0.85em",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {dockerLogs.length > 0 ? (
              dockerLogs.map((log: string, index: number) => (
                <div key={index} className="log-entry">{log}</div>
              ))
            ) : (
              <p className="text-muted">No logs available. Start services to see logs.</p>
            )}
            <div ref={detailedLogsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderConfigTab = () => (
    <div className="configuration-panel">
      <h4 className="mb-4">Configuration</h4>

      <div className="row">
        <div className="col-md-6">
          <div className="card">
            <div className="card-body">
              <h6 className="card-title">Setup Information</h6>
              <div className="mb-3">
                <label className="form-label small text-muted">Setup Type</label>
                <div className="fw-bold">{userSelections.setupType || 'Docker'}</div>
              </div>
              <div className="mb-3">
                <label className="form-label small text-muted">Data Location</label>
                <div className="fw-bold font-monospace small">
                  {userSelections.dataLocation || 'Not configured'}
                </div>
              </div>
              {userSelections.setupType === 'docker' && (
                <>
                  <div className="mb-3">
                    <label className="form-label small text-muted">Web Port</label>
                    <div className="fw-bold">{userSelections.webPort || '3000'}</div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label small text-muted">API Port</label>
                    <div className="fw-bold">{userSelections.apiPort || '8001'}</div>
                  </div>
                </>
              )}
              <button className="btn btn-primary btn-sm" onClick={onEditConfig}>
                ⚙️ Edit Configuration
              </button>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card">
            <div className="card-body">
              <h6 className="card-title">System Actions</h6>
              <div className="d-grid gap-2">
                <button className="btn btn-outline-info btn-sm" onClick={onSystemInfo}>
                  ℹ️ View System Information
                </button>
                <button className="btn btn-outline-secondary btn-sm" onClick={onBugReport}>
                  🐛 Report an Issue
                </button>
                <hr />
                <small className="text-muted">
                  Need help? Use the bug report feature to get support.
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">DDALAB Control Panel</h2>
          <p className="text-muted mb-0">
            Managing: <code className="small">{userSelections.cloneLocation || "Unknown path"}</code>
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <ul className="nav nav-tabs nav-justified mb-4" role="tablist">
        <li className="nav-item" role="presentation">
          <button
            className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
            type="button"
          >
            📊 Overview
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            className={`nav-link ${activeTab === 'services' ? 'active' : ''}`}
            onClick={() => setActiveTab('services')}
            type="button"
          >
            🐳 Services
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            className={`nav-link ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
            type="button"
          >
            📋 Logs
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            className={`nav-link ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
            type="button"
          >
            ⚙️ Configuration
          </button>
        </li>
      </ul>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'services' && renderServicesTab()}
        {activeTab === 'logs' && renderLogsTab()}
        {activeTab === 'config' && renderConfigTab()}
      </div>
    </div>
  );
};
