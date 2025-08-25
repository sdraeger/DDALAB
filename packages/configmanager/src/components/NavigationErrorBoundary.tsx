import React, { ErrorInfo, ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { logger } from '../utils/logger-client';

interface NavigationErrorBoundaryProps {
  children: ReactNode;
  currentSite?: string;
  onNavigateHome?: () => void;
}

export const NavigationErrorBoundary: React.FC<NavigationErrorBoundaryProps> = ({
  children,
  currentSite = 'Unknown',
  onNavigateHome,
}) => {
  const handleError = (error: Error, errorInfo: ErrorInfo) => {
    logger.error('Navigation Error:', {
      error: error.toString(),
      stack: error.stack,
      currentSite,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });
  };

  const renderFallback = (error: Error) => (
    <div className="navigation-error-boundary d-flex align-items-center justify-content-center min-vh-100">
      <div className="text-center p-5">
        <i className="bi bi-compass display-1 text-danger mb-4"></i>
        <h3 className="mb-3">Navigation Error</h3>
        <p className="text-muted mb-4">
          We encountered an error while navigating to {currentSite}.
        </p>
        <p className="small text-muted mb-4">
          {error.message}
        </p>
        <div className="d-flex gap-3 justify-content-center">
          {onNavigateHome && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNavigateHome}
            >
              <i className="bi bi-house-door me-2"></i>
              Go to Start
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => window.location.reload()}
          >
            <i className="bi bi-arrow-clockwise me-2"></i>
            Reload Application
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <ErrorBoundary
      componentName={`Navigation-${currentSite}`}
      level="page"
      onError={handleError}
      fallback={renderFallback}
      resetKeys={[currentSite]}
      resetOnPropsChange
    >
      {children}
    </ErrorBoundary>
  );
};