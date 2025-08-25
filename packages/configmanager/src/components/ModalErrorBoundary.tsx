import React, { ErrorInfo, ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { logger } from '../utils/logger-client';

interface ModalErrorBoundaryProps {
  children: ReactNode;
  modalName: string;
  onClose?: () => void;
}

export const ModalErrorBoundary: React.FC<ModalErrorBoundaryProps> = ({
  children,
  modalName,
  onClose,
}) => {
  const handleError = (error: Error, errorInfo: ErrorInfo) => {
    logger.error(`Modal Error in ${modalName}:`, {
      error: error.toString(),
      stack: error.stack,
      modal: modalName,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });
  };

  const renderFallback = (error: Error) => (
    <div className="modal-error-boundary">
      <div className="modal-header border-danger">
        <h5 className="modal-title text-danger">
          <i className="bi bi-exclamation-octagon-fill me-2"></i>
          Error Loading {modalName}
        </h5>
        {onClose && (
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label="Close"
          ></button>
        )}
      </div>
      <div className="modal-body">
        <div className="alert alert-danger mb-0" role="alert">
          <p className="mb-2">
            The {modalName} encountered an error and cannot be displayed.
          </p>
          <p className="small text-muted mb-0">
            {error.message}
          </p>
        </div>
      </div>
      <div className="modal-footer">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => window.location.reload()}
        >
          <i className="bi bi-arrow-clockwise me-2"></i>
          Reload Application
        </button>
        {onClose && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );

  return (
    <ErrorBoundary
      componentName={`Modal-${modalName}`}
      level="component"
      onError={handleError}
      fallback={renderFallback}
      isolate
    >
      {children}
    </ErrorBoundary>
  );
};