import React, { useState, useEffect } from "react";
import type { ElectronAPI } from "../utils/electron";

interface ServiceManagementModalProps {
  electronAPI?: ElectronAPI;
  onClose: () => void;
}

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  description: string;
  canStart: boolean;
  canStop: boolean;
}

export const ServiceManagementModal: React.FC<ServiceManagementModalProps> = ({
  electronAPI,
  onClose,
}) => {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [operationInProgress, setOperationInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    const checkServiceStatus = async (isInitial = false) => {
      if (isInitial) {
        setIsInitialLoading(true);
      } else {
        // Don't show refresh indicator if user is performing an operation
        if (!operationInProgress) {
          setIsRefreshing(true);
        }
      }

      if (!electronAPI) {
        setServices([{
          name: 'Docker Services',
          status: 'error',
          description: 'Electron API not available',
          canStart: false,
          canStop: false
        }]);
        if (isInitial) {
          setIsInitialLoading(false);
        } else {
          // Ensure refresh indicator shows for at least 500ms for visibility
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
            canStart: false, // Can't control Docker daemon from app
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
        if (isInitial) {
          setIsInitialLoading(false);
        } else {
          // Ensure refresh indicator shows for at least 500ms for visibility
          setTimeout(() => setIsRefreshing(false), 500);
        }
      }
    };

    // Initial load
    checkServiceStatus(true);

    // Set up periodic refresh without loading indicator
    const interval = setInterval(() => checkServiceStatus(false), 8000);
    return () => clearInterval(interval);
  }, [electronAPI, operationInProgress]);

  const handleStartService = async (serviceName: string) => {
    if (!electronAPI || operationInProgress) return;

    setOperationInProgress(`start-${serviceName}`);
    setStatusMessage(`Starting ${serviceName}...`);

    try {
      if (serviceName === 'DDALAB Services') {
        const result = await electronAPI.startDockerCompose();
        if (result) {
          setStatusMessage('DDALAB services started successfully');
        } else {
          setStatusMessage('Failed to start DDALAB services');
        }
      }
    } catch (error) {
      console.error(`Failed to start ${serviceName}:`, error);
      setStatusMessage(`Failed to start ${serviceName}: ${error}`);
    } finally {
      setOperationInProgress(null);
      // Clear status message after 3 seconds
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const handleStopService = async (serviceName: string) => {
    if (!electronAPI || operationInProgress) return;

    setOperationInProgress(`stop-${serviceName}`);
    setStatusMessage(`Stopping ${serviceName}...`);

    try {
      if (serviceName === 'DDALAB Services') {
        const result = await electronAPI.stopDockerCompose(false);
        if (result) {
          setStatusMessage('DDALAB services stopped successfully');
        } else {
          setStatusMessage('Failed to stop DDALAB services');
        }
      }
    } catch (error) {
      console.error(`Failed to stop ${serviceName}:`, error);
      setStatusMessage(`Failed to stop ${serviceName}: ${error}`);
    } finally {
      setOperationInProgress(null);
      // Clear status message after 3 seconds
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const handleRestartServices = async () => {
    if (!electronAPI || operationInProgress) return;

    setOperationInProgress('restart-all');
    setStatusMessage('Restarting DDALAB services...');

    try {
      // Stop first
      const stopResult = await electronAPI.stopDockerCompose(false);
      if (!stopResult) {
        throw new Error('Failed to stop services');
      }

      setStatusMessage('Services stopped, starting again...');

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Start again
      const startResult = await electronAPI.startDockerCompose();
      if (startResult) {
        setStatusMessage('DDALAB services restarted successfully');
      } else {
        setStatusMessage('Failed to restart services - start operation failed');
      }
    } catch (error) {
      console.error('Failed to restart services:', error);
      setStatusMessage(`Failed to restart services: ${error}`);
    } finally {
      setOperationInProgress(null);
      // Clear status message after 3 seconds
      setTimeout(() => setStatusMessage(''), 3000);
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

  return (
    <div className="service-management-modal">
      <div className="modal-backdrop show"></div>
      <div className="modal show d-block">
        <div className="modal-dialog modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                🐳 Service Management
                {isRefreshing && (
                  <span className="refresh-indicator ms-2">
                    <span className="spinner-border spinner-border-sm" role="status">
                      <span className="visually-hidden">Refreshing...</span>
                    </span>
                  </span>
                )}
              </h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
            </div>
            <div className="modal-body">
              {isInitialLoading ? (
                <div className="text-center">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <p className="mt-2">Checking service status...</p>
                </div>
              ) : (
                <>
                  {/* Status Message */}
                  {statusMessage && (
                    <div className="alert alert-info mb-3">
                      <strong>Status:</strong> {statusMessage}
                    </div>
                  )}

                  {/* Global Actions */}
                  <div className="global-actions mb-4">
                    <h6 className="section-title">Quick Actions</h6>
                    <div className="btn-group" role="group">
                      <button
                        className="btn btn-success"
                        onClick={() => handleStartService('DDALAB Services')}
                        disabled={operationInProgress !== null || !services.find(s => s.name === 'DDALAB Services')?.canStart}
                      >
                        {operationInProgress === 'start-DDALAB Services' ? (
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
                        onClick={() => handleStopService('DDALAB Services')}
                        disabled={operationInProgress !== null || !services.find(s => s.name === 'DDALAB Services')?.canStop}
                      >
                        {operationInProgress === 'stop-DDALAB Services' ? (
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
                        {operationInProgress === 'restart-all' ? (
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

                  {/* Service List */}
                  <div className="services-list">
                    <h6 className="section-title">Service Status</h6>
                    {services.map((service, index) => (
                      <div key={index} className="service-item">
                        <div className="service-info">
                          <div className="service-header">
                            <span className="service-icon">{getStatusIcon(service.status)}</span>
                            <span className="service-name">{service.name}</span>
                            <span className={`badge bg-${getStatusClass(service.status)}`}>
                              {service.status.toUpperCase()}
                            </span>
                          </div>
                          <p className="service-description">{service.description}</p>
                        </div>
                        <div className="service-actions">
                          {service.canStart && (
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => handleStartService(service.name)}
                              disabled={operationInProgress !== null}
                            >
                              {operationInProgress === `start-${service.name}` ? (
                                <span className="spinner-border spinner-border-sm" />
                              ) : (
                                'Start'
                              )}
                            </button>
                          )}
                          {service.canStop && (
                            <button
                              className="btn btn-sm btn-danger ms-2"
                              onClick={() => handleStopService(service.name)}
                              disabled={operationInProgress !== null}
                            >
                              {operationInProgress === `stop-${service.name}` ? (
                                <span className="spinner-border spinner-border-sm" />
                              ) : (
                                'Stop'
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .service-management-modal {
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
          padding: 20px 24px;
          border-bottom: 1px solid #e9ecef;
          background: #fff;
          border-radius: 8px 8px 0 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .modal-title {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
          color: #495057;
          display: flex;
          align-items: center;
        }

        .refresh-indicator {
          opacity: 0.7;
          transition: opacity 0.3s ease;
        }

        .refresh-indicator .spinner-border-sm {
          width: 16px;
          height: 16px;
          border-width: 2px;
          color: #6c757d;
        }

        .btn-close {
          background: transparent;
          border: none;
          font-size: 20px;
          font-weight: 700;
          line-height: 1;
          color: #6c757d;
          opacity: 0.75;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-close:hover {
          color: #000;
          opacity: 1;
        }

        .btn-close:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
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

        .section-title {
          font-size: 16px;
          font-weight: 600;
          color: #495057;
          margin-bottom: 16px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .global-actions {
          background: white;
          padding: 20px;
          border-radius: 12px;
          border: 1px solid #e1e5e9;
        }

        .btn-group .btn {
          margin-right: 8px;
        }

        .btn-group .btn:last-child {
          margin-right: 0;
        }

        .services-list {
          background: white;
          border-radius: 12px;
          border: 1px solid #e1e5e9;
          overflow: hidden;
        }

        .service-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          border-bottom: 1px solid #f1f3f4;
        }

        .service-item:last-child {
          border-bottom: none;
        }

        .service-info {
          flex: 1;
        }

        .service-header {
          display: flex;
          align-items: center;
          margin-bottom: 8px;
        }

        .service-icon {
          font-size: 18px;
          margin-right: 12px;
        }

        .service-name {
          font-weight: 600;
          font-size: 16px;
          color: #2c3e50;
          margin-right: 12px;
        }

        .service-description {
          margin: 0;
          color: #6c757d;
          font-size: 14px;
        }

        .service-actions {
          display: flex;
          align-items: center;
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
        }

        .bg-warning {
          background-color: #fff3cd !important;
          color: #856404 !important;
        }

        .bg-danger {
          background-color: #f8d7da !important;
          color: #721c24 !important;
        }

        .bg-secondary {
          background-color: #e9ecef !important;
          color: #495057 !important;
        }
      `}</style>
    </div>
  );
};
