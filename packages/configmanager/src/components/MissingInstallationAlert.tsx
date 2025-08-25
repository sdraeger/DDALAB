import React, { useEffect, useState } from 'react';
import { HealthStatus } from '../services/health-check-service';
import { useHealthStatusContext } from '../context/HealthStatusProvider';
import { logger } from '../utils/logger-client';

interface MissingInstallationAlertProps {
  onStartNewSetup?: () => void;
  onShowHealthDetails?: () => void;
}

const MissingInstallationAlert: React.FC<MissingInstallationAlertProps> = ({
  onStartNewSetup,
  onShowHealthDetails,
}) => {
  const { healthStatus } = useHealthStatusContext();
  const [isVisible, setIsVisible] = useState(false);
  const [criticalIssues, setCriticalIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!healthStatus) return;

    const criticalInstallationIssues = healthStatus.checks
      .filter(check => 
        check.category === 'installation' && 
        check.status === 'fail' && 
        check.priority === 'critical'
      );

    if (criticalInstallationIssues.length > 0) {
      const messages = criticalInstallationIssues.map(check => check.message);
      setCriticalIssues(messages);
      setIsVisible(true);
      
      logger.warn('Critical installation issues detected:', {
        issues: criticalInstallationIssues,
        healthStatus: healthStatus.status,
      });
    } else {
      setIsVisible(false);
      setCriticalIssues([]);
    }
  }, [healthStatus]);

  const handleDismiss = () => {
    setIsVisible(false);
  };

  const getRecoveryActions = () => {
    const hasDataLocationIssue = criticalIssues.some(msg => 
      msg.includes('data directory missing') || msg.includes('installation not found')
    );
    
    const hasCommonInstallationIssue = criticalIssues.some(msg =>
      msg.includes('No DDALAB installation found in common locations')
    );

    const actions = [];

    if (hasDataLocationIssue || hasCommonInstallationIssue) {
      actions.push({
        id: 'new_setup',
        label: 'Run Setup Again',
        icon: 'bi-gear-fill',
        variant: 'primary',
        description: 'Start the setup process to configure DDALAB',
        onClick: onStartNewSetup,
      });
    }

    actions.push({
      id: 'view_details',
      label: 'View Details',
      icon: 'bi-info-circle',
      variant: 'outline-info',
      description: 'See detailed health check information',
      onClick: () => {
        handleDismiss();
        onShowHealthDetails?.();
      },
    });

    return actions;
  };

  if (!isVisible || criticalIssues.length === 0) {
    return null;
  }

  const recoveryActions = getRecoveryActions();

  return (
    <div className="missing-installation-alert position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" 
         style={{ 
           backgroundColor: 'rgba(0, 0, 0, 0.8)', 
           zIndex: 9999,
           backdropFilter: 'blur(4px)'
         }}>
      <div className="card shadow-lg" style={{ maxWidth: '600px', width: '90%' }}>
        <div className="card-header bg-danger text-white d-flex align-items-center">
          <i className="bi bi-exclamation-triangle-fill me-2 fs-4"></i>
          <h5 className="mb-0">DDALAB Installation Issue</h5>
          <button 
            type="button" 
            className="btn-close btn-close-white ms-auto"
            onClick={handleDismiss}
            title="Dismiss alert"
          ></button>
        </div>
        
        <div className="card-body">
          <div className="alert alert-danger mb-3" role="alert">
            <h6 className="alert-heading">
              <i className="bi bi-folder-x me-2"></i>
              Installation Not Found
            </h6>
            <p className="mb-2">
              DDALAB installation directory appears to be missing or inaccessible. 
              This could happen if:
            </p>
            <ul className="mb-2">
              <li>The installation directory was deleted or moved</li>
              <li>The disk containing DDALAB was unmounted</li>
              <li>Permissions have changed</li>
              <li>The installation was corrupted</li>
            </ul>
          </div>

          <div className="mb-3">
            <h6>Detected Issues:</h6>
            <ul className="list-unstyled">
              {criticalIssues.map((issue, index) => (
                <li key={index} className="d-flex align-items-start mb-2">
                  <i className="bi bi-x-circle text-danger me-2 mt-1 flex-shrink-0"></i>
                  <span className="small">{issue}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-3">
            <h6>Recommended Actions:</h6>
            <div className="d-grid gap-2">
              {recoveryActions.map((action) => (
                <button
                  key={action.id}
                  className={`btn btn-${action.variant} d-flex align-items-center`}
                  onClick={action.onClick}
                  disabled={!action.onClick}
                >
                  <i className={`${action.icon} me-2`}></i>
                  <div className="text-start flex-grow-1">
                    <div className="fw-bold">{action.label}</div>
                    <small className="text-muted">{action.description}</small>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="alert alert-info mb-0">
            <small>
              <i className="bi bi-info-circle me-1"></i>
              If you have a backup of your DDALAB installation, restore it to the expected location 
              and restart ConfigManager.
            </small>
          </div>
        </div>
        
        <div className="card-footer text-muted text-center">
          <small>
            This alert will automatically dismiss once the installation is detected.
          </small>
        </div>
      </div>
    </div>
  );
};

export default MissingInstallationAlert;