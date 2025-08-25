import React, { useEffect, useState } from 'react';
import { healthCheckService, HealthStatus, HealthCheck } from '../services/health-check-service';
import { logger } from '../utils/logger-client';
import useHealthStatus from '../hooks/useHealthStatus';

interface HealthStatusIndicatorProps {
  showDetails?: boolean;
  size?: 'sm' | 'md' | 'lg';
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  onHealthChange?: (status: HealthStatus) => void;
}

const HealthStatusIndicator: React.FC<HealthStatusIndicatorProps> = ({
  showDetails = false,
  size = 'md',
  position = 'top-right',
  onHealthChange,
}) => {
  const { healthStatus, runImmediateCheck, startHealthCheck } = useHealthStatus({ autoStart: false });
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [isManualChecking, setIsManualChecking] = useState(false);

  useEffect(() => {
    if (healthStatus) {
      setLastUpdate(new Date(healthStatus.timestamp).toLocaleTimeString());
      onHealthChange?.(healthStatus);
      
      // Auto-collapse after status change
      if (isExpanded && healthStatus.status === 'healthy') {
        setTimeout(() => setIsExpanded(false), 3000);
      }
    }
  }, [healthStatus, onHealthChange, isExpanded]);

  const handleManualCheck = async () => {
    if (isManualChecking) return;
    
    setIsManualChecking(true);
    try {
      await runImmediateCheck();
    } catch (error) {
      logger.error('Manual health check failed:', error);
    } finally {
      setIsManualChecking(false);
    }
  };

  const handleStartMonitoring = () => {
    startHealthCheck();
  };

  const getPositionClasses = () => {
    const positions = {
      'top-right': 'top-0 end-0 m-3',
      'top-left': 'top-0 start-0 m-3',
      'bottom-right': 'bottom-0 end-0 m-3',
      'bottom-left': 'bottom-0 start-0 m-3',
    };
    return positions[position];
  };

  if (!healthStatus) {
    return (
      <div className={`health-status-indicator position-fixed ${getPositionClasses()}`} style={{ zIndex: 1030 }}>
        <div className="card shadow-sm">
          <div className="card-body p-2">
            <button 
              className="btn btn-sm btn-outline-primary d-flex align-items-center"
              onClick={handleManualCheck}
              disabled={isManualChecking}
            >
              {isManualChecking ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Checking...
                </>
              ) : (
                <>
                  <i className="bi bi-heart-pulse me-2"></i>
                  Check Health
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const getStatusIcon = () => {
    const hasInstallationIssues = healthStatus.checks?.some(check => 
      check.category === 'installation' && 
      check.status === 'fail' && 
      check.priority === 'critical'
    );

    if (hasInstallationIssues) {
      return 'bi-folder-x text-danger';
    }

    switch (healthStatus.status) {
      case 'healthy':
        return 'bi-check-circle-fill text-success';
      case 'warning':
        return 'bi-exclamation-triangle-fill text-warning';
      case 'critical':
        return 'bi-x-circle-fill text-danger';
      default:
        return 'bi-question-circle-fill text-muted';
    }
  };

  const getStatusText = () => {
    const hasInstallationIssues = healthStatus.checks?.some(check => 
      check.category === 'installation' && 
      check.status === 'fail' && 
      check.priority === 'critical'
    );

    if (hasInstallationIssues) {
      return 'Installation missing';
    }

    switch (healthStatus.status) {
      case 'healthy':
        return 'All systems operational';
      case 'warning':
        return 'Some issues detected';
      case 'critical':
        return 'Critical issues found';
      default:
        return 'Status unknown';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'fs-6';
      case 'lg':
        return 'fs-4';
      default:
        return 'fs-5';
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

  const renderHealthDetails = () => {
    if (!showDetails || !isExpanded) return null;

    const groupedChecks = groupChecksByCategory(healthStatus.checks);
    const categories = Object.keys(groupedChecks).sort();

    return (
      <div className="health-details mt-2 p-2 bg-light rounded small">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="fw-bold">Health Report</span>
          <span className="text-muted">
            <i className="bi bi-clock me-1"></i>
            {lastUpdate}
          </span>
        </div>
        
        <div className="mb-2">
          <div className="d-flex justify-content-between">
            <span>Overall Health:</span>
            <span className="fw-bold">{healthStatus.overallHealth}%</span>
          </div>
          <div className="progress mt-1" style={{ height: '4px' }}>
            <div 
              className={`progress-bar ${
                healthStatus.overallHealth > 80 ? 'bg-success' :
                healthStatus.overallHealth > 60 ? 'bg-warning' : 'bg-danger'
              }`}
              style={{ width: `${healthStatus.overallHealth}%` }}
            ></div>
          </div>
        </div>

        <div className="accordion accordion-flush" id="healthAccordion">
          {categories.map((category, index) => {
            const checks = groupedChecks[category];
            const failedChecks = checks.filter(c => c.status === 'fail').length;
            const warningChecks = checks.filter(c => c.status === 'warn').length;
            
            return (
              <div className="accordion-item" key={category}>
                <h2 className="accordion-header" id={`heading-${category}`}>
                  <button
                    className="accordion-button collapsed py-1 px-2 small"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target={`#collapse-${category}`}
                    aria-expanded="false"
                    aria-controls={`collapse-${category}`}
                  >
                    <span className="me-2 text-capitalize">{category}</span>
                    {failedChecks > 0 && (
                      <span className="badge bg-danger me-1">{failedChecks}</span>
                    )}
                    {warningChecks > 0 && (
                      <span className="badge bg-warning">{warningChecks}</span>
                    )}
                  </button>
                </h2>
                <div
                  id={`collapse-${category}`}
                  className="accordion-collapse collapse"
                  aria-labelledby={`heading-${category}`}
                  data-bs-parent="#healthAccordion"
                >
                  <div className="accordion-body py-1 px-2">
                    {checks.map((check) => (
                      <div
                        key={check.id}
                        className="d-flex justify-content-between align-items-center py-1"
                      >
                        <div className="d-flex align-items-center">
                          <i
                            className={`me-2 ${
                              check.status === 'pass' ? 'bi-check-circle text-success' :
                              check.status === 'warn' ? 'bi-exclamation-triangle text-warning' :
                              check.status === 'fail' ? 'bi-x-circle text-danger' :
                              'bi-dash-circle text-muted'
                            }`}
                          ></i>
                          <div>
                            <div className="fw-bold">{check.name}</div>
                            <div className="text-muted small">{check.message}</div>
                          </div>
                        </div>
                        {check.duration && (
                          <span className="text-muted small">{check.duration}ms</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={`health-status-indicator position-fixed ${getPositionClasses()}`} style={{ zIndex: 1030 }}>
      <div className="card shadow-sm">
        <div 
          className="card-body p-2 d-flex align-items-center cursor-pointer"
          onClick={() => showDetails && setIsExpanded(!isExpanded)}
          style={{ cursor: showDetails ? 'pointer' : 'default' }}
        >
          <i className={`${getStatusIcon()} ${getSizeClasses()} me-2`}></i>
          <div>
            <div className="fw-bold small">{getStatusText()}</div>
            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
              Health: {healthStatus.overallHealth}%
            </div>
          </div>
          {showDetails && (
            <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} ms-2`}></i>
          )}
        </div>
        {renderHealthDetails()}
      </div>
    </div>
  );
};

export default HealthStatusIndicator;