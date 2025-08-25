import React, { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { logger } from '../utils/logger-client';

interface SectionErrorBoundaryProps {
  children: ReactNode;
  sectionName: string;
  onReset?: () => void;
  showDetails?: boolean;
}

export const SectionErrorBoundary: React.FC<SectionErrorBoundaryProps> = ({
  children,
  sectionName,
  onReset,
  showDetails = false,
}) => {
  const handleError = (error: Error) => {
    logger.error(`Section Error in ${sectionName}:`, {
      error: error.toString(),
      stack: error.stack,
      section: sectionName,
      timestamp: new Date().toISOString(),
    });
  };

  const renderFallback = (error: Error) => (
    <div className="section-error-boundary p-4">
      <div className="alert alert-warning d-flex align-items-start" role="alert">
        <i className="bi bi-exclamation-triangle-fill me-3 mt-1"></i>
        <div className="flex-grow-1">
          <h6 className="alert-heading mb-2">
            {sectionName} Section Unavailable
          </h6>
          <p className="mb-2 small">
            This section encountered an error and cannot be displayed.
          </p>
          {showDetails && (
            <p className="mb-3 small text-muted">
              Error: {error.message}
            </p>
          )}
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-warning"
              onClick={() => window.location.reload()}
            >
              <i className="bi bi-arrow-clockwise me-1"></i>
              Reload Page
            </button>
            {onReset && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={onReset}
              >
                <i className="bi bi-x-circle me-1"></i>
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <ErrorBoundary
      componentName={sectionName}
      level="section"
      onError={handleError}
      fallback={renderFallback}
      isolate
    >
      {children}
    </ErrorBoundary>
  );
};