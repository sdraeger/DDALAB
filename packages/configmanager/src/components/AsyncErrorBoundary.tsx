import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { logger } from '../utils/logger-client';

interface AsyncErrorBoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
  loadingComponent?: ReactNode;
  timeout?: number;
  componentName?: string;
}

interface AsyncErrorBoundaryState {
  hasError: boolean;
  isRetrying: boolean;
}

export class AsyncErrorBoundary extends Component<
  AsyncErrorBoundaryProps,
  AsyncErrorBoundaryState
> {
  private retryTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: AsyncErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      isRetrying: false,
    };
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  handleError = (error: Error, errorInfo: ErrorInfo) => {
    const { componentName = 'AsyncComponent' } = this.props;
    
    logger.error(`Async Error in ${componentName}:`, {
      error: error.toString(),
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    this.setState({ hasError: true });
  };

  handleRetry = async () => {
    const { onRetry, timeout = 5000 } = this.props;
    
    this.setState({ isRetrying: true });

    if (onRetry) {
      try {
        await onRetry();
        this.setState({ hasError: false, isRetrying: false });
      } catch (error) {
        logger.error('Retry failed:', error);
        this.setState({ isRetrying: false });
        
        this.retryTimeoutId = setTimeout(() => {
          this.handleRetry();
        }, timeout);
      }
    } else {
      window.location.reload();
    }
  };

  renderFallback = (error: Error) => {
    const { isRetrying } = this.state;
    const { loadingComponent } = this.props;

    if (isRetrying && loadingComponent) {
      return loadingComponent;
    }

    return (
      <div className="async-error-boundary p-4">
        <div className="alert alert-danger" role="alert">
          <h5 className="alert-heading d-flex align-items-center">
            <i className="bi bi-cloud-slash-fill me-2"></i>
            Loading Error
          </h5>
          <p className="mb-2">
            Failed to load this component. This might be a temporary network issue.
          </p>
          <p className="small text-muted mb-3">
            {error.message}
          </p>
          <button
            type="button"
            className="btn btn-sm btn-outline-danger"
            onClick={this.handleRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status">
                  <span className="visually-hidden">Retrying...</span>
                </span>
                Retrying...
              </>
            ) : (
              <>
                <i className="bi bi-arrow-repeat me-2"></i>
                Retry
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  render() {
    const { children, componentName } = this.props;

    return (
      <ErrorBoundary
        componentName={componentName}
        onError={this.handleError}
        fallback={this.renderFallback}
        level="component"
      >
        {children}
      </ErrorBoundary>
    );
  }
}