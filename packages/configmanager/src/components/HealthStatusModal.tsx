import React, { useState, useEffect } from 'react';
import { HealthStatus, HealthCheck } from '../services/health-check-service';
import { ModalErrorBoundary } from './ModalErrorBoundary';
import useHealthStatus from '../hooks/useHealthStatus';

interface HealthStatusModalProps {
  onClose: () => void;
  initialHealthStatus?: HealthStatus | null;
}

const HealthStatusModal: React.FC<HealthStatusModalProps> = ({ 
  onClose, 
  initialHealthStatus 
}) => {
  const { healthStatus, runImmediateCheck } = useHealthStatus({ autoStart: false });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<HealthStatus | null>(
    initialHealthStatus || null
  );

  useEffect(() => {
    if (healthStatus) {
      setCurrentStatus(healthStatus);
    }
  }, [healthStatus]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const newStatus = await runImmediateCheck();
      setCurrentStatus(newStatus);
    } catch (error) {
      console.error('Failed to refresh health status:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-success';
      case 'warning':
        return 'bg-warning';
      case 'critical':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  };

  const getCheckStatusIcon = (status: HealthCheck['status']) => {
    switch (status) {
      case 'pass':
        return 'bi-check-circle text-success';
      case 'warn':
        return 'bi-exclamation-triangle text-warning';
      case 'fail':
        return 'bi-x-circle text-danger';
      case 'skip':
        return 'bi-dash-circle text-muted';
      default:
        return 'bi-question-circle text-muted';
    }
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-danger';
      case 'high':
        return 'bg-warning';
      case 'medium':
        return 'bg-info';
      case 'low':
        return 'bg-secondary';
      default:
        return 'bg-secondary';
    }
  };

  const groupChecksByCategory = (checks: HealthCheck[]) => {
    return checks.reduce((acc, check) => {
      if (!acc[check.category]) {
        acc[check.category] = [];
      }
      acc[check.category].push(check);
      return acc;
    }, {} as Record<string, HealthCheck[]>);
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return '';
    return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
  };

  if (!currentStatus) {
    return (
      <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="modal-dialog modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">System Health Status</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
            <div className="modal-body text-center py-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading health status...</span>
              </div>
              <p className="mt-3">Loading health status...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const groupedChecks = groupChecksByCategory(currentStatus.checks);
  const categories = Object.keys(groupedChecks).sort();

  const stats = {
    total: currentStatus.checks.length,
    passed: currentStatus.checks.filter(c => c.status === 'pass').length,
    warnings: currentStatus.checks.filter(c => c.status === 'warn').length,
    failed: currentStatus.checks.filter(c => c.status === 'fail').length,
    skipped: currentStatus.checks.filter(c => c.status === 'skip').length,
  };

  return (
    <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title d-flex align-items-center">
              <i className="bi bi-heart-pulse me-2"></i>
              System Health Status
            </h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          
          <div className="modal-body">
            {/* Overall Status Header */}
            <div className="row mb-4">
              <div className="col-md-6">
                <div className="card">
                  <div className="card-body text-center">
                    <div className={`badge ${getStatusBadgeClass(currentStatus.status)} fs-6 mb-2`}>
                      {currentStatus.status.toUpperCase()}
                    </div>
                    <h2 className="mb-1">{currentStatus.overallHealth}%</h2>
                    <p className="text-muted mb-0">Overall Health</p>
                    <div className="progress mt-2" style={{ height: '8px' }}>
                      <div 
                        className={`progress-bar ${
                          currentStatus.overallHealth > 80 ? 'bg-success' :
                          currentStatus.overallHealth > 60 ? 'bg-warning' : 'bg-danger'
                        }`}
                        style={{ width: `${currentStatus.overallHealth}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="col-md-6">
                <div className="card">
                  <div className="card-body">
                    <h6 className="card-title">Check Summary</h6>
                    <div className="row text-center">
                      <div className="col-3">
                        <div className="text-success fs-4">{stats.passed}</div>
                        <small className="text-muted">Passed</small>
                      </div>
                      <div className="col-3">
                        <div className="text-warning fs-4">{stats.warnings}</div>
                        <small className="text-muted">Warnings</small>
                      </div>
                      <div className="col-3">
                        <div className="text-danger fs-4">{stats.failed}</div>
                        <small className="text-muted">Failed</small>
                      </div>
                      <div className="col-3">
                        <div className="text-muted fs-4">{stats.skipped}</div>
                        <small className="text-muted">Skipped</small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Health Checks by Category */}
            <div className="row">
              <div className="col-12">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="mb-0">Health Checks</h6>
                  <div>
                    <small className="text-muted me-3">
                      Last updated: {new Date(currentStatus.timestamp).toLocaleString()}
                    </small>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-1"></span>
                          Refreshing...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-arrow-clockwise me-1"></i>
                          Refresh
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="accordion" id="healthChecksAccordion">
                  {categories.map((category) => {
                    const checks = groupedChecks[category];
                    const categoryStats = {
                      passed: checks.filter(c => c.status === 'pass').length,
                      warnings: checks.filter(c => c.status === 'warn').length,
                      failed: checks.filter(c => c.status === 'fail').length,
                      skipped: checks.filter(c => c.status === 'skip').length,
                    };

                    return (
                      <div className="accordion-item" key={category}>
                        <h2 className="accordion-header" id={`heading-${category}`}>
                          <button
                            className="accordion-button collapsed"
                            type="button"
                            data-bs-toggle="collapse"
                            data-bs-target={`#collapse-${category}`}
                            aria-expanded="false"
                            aria-controls={`collapse-${category}`}
                          >
                            <div className="d-flex justify-content-between align-items-center w-100 me-3">
                              <span className="fw-bold text-capitalize">{category}</span>
                              <div className="d-flex gap-2">
                                {categoryStats.failed > 0 && (
                                  <span className="badge bg-danger">{categoryStats.failed} failed</span>
                                )}
                                {categoryStats.warnings > 0 && (
                                  <span className="badge bg-warning">{categoryStats.warnings} warnings</span>
                                )}
                                {categoryStats.passed > 0 && (
                                  <span className="badge bg-success">{categoryStats.passed} passed</span>
                                )}
                              </div>
                            </div>
                          </button>
                        </h2>
                        
                        <div
                          id={`collapse-${category}`}
                          className="accordion-collapse collapse"
                          aria-labelledby={`heading-${category}`}
                          data-bs-parent="#healthChecksAccordion"
                        >
                          <div className="accordion-body">
                            <div className="list-group list-group-flush">
                              {checks.map((check) => (
                                <div
                                  key={check.id}
                                  className="list-group-item d-flex justify-content-between align-items-start px-0"
                                >
                                  <div className="d-flex align-items-start">
                                    <i className={`${getCheckStatusIcon(check.status)} me-3 mt-1`}></i>
                                    <div>
                                      <h6 className="mb-1 d-flex align-items-center">
                                        {check.name}
                                        <span className={`badge ms-2 ${getPriorityBadgeClass(check.priority)}`}>
                                          {check.priority}
                                        </span>
                                      </h6>
                                      <p className="mb-1">{check.message}</p>
                                      {check.details && (
                                        <details className="mt-2">
                                          <summary className="text-muted small cursor-pointer">
                                            View Details
                                          </summary>
                                          <pre className="mt-1 p-2 bg-light rounded small">
                                            {JSON.stringify(check.details, null, 2)}
                                          </pre>
                                        </details>
                                      )}
                                    </div>
                                  </div>
                                  {check.duration && (
                                    <span className="badge bg-light text-dark">
                                      {formatDuration(check.duration)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const WrappedHealthStatusModal: React.FC<HealthStatusModalProps> = (props) => (
  <ModalErrorBoundary modalName="Health Status" onClose={props.onClose}>
    <HealthStatusModal {...props} />
  </ModalErrorBoundary>
);

export default WrappedHealthStatusModal;