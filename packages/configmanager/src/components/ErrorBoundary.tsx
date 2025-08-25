import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../utils/logger-client';
import { reportError } from '../utils/error-reporter';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, errorInfo: ErrorInfo) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: Array<string | number>;
  resetOnPropsChange?: boolean;
  isolate?: boolean;
  level?: 'page' | 'section' | 'component';
  componentName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: NodeJS.Timeout | null = null;
  private previousResetKeys: Array<string | number> = [];

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
    this.previousResetKeys = props.resetKeys || [];
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, componentName, level = 'component' } = this.props;
    
    logger.error(`Error in ${componentName || 'Unknown Component'} [${level}]:`, {
      error: error.toString(),
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      level,
      timestamp: new Date().toISOString(),
    });

    reportError({
      message: error.message,
      stack: error.stack || undefined,
      componentStack: errorInfo.componentStack || undefined,
      componentName: componentName || 'Unknown Component',
      level,
      timestamp: new Date().toISOString(),
      context: {
        errorCount: this.state.errorCount + 1,
      },
    }, {
      sendToMain: true,
      showNotification: level === 'page',
      autoRecover: false,
    });

    this.setState(prevState => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    if (onError) {
      onError(error, errorInfo);
    }

    if (this.state.errorCount > 3) {
      logger.error('Error boundary exceeded retry limit', {
        componentName,
        errorCount: this.state.errorCount,
      });
    }
  }

  componentDidUpdate() {
    const { resetKeys, resetOnPropsChange } = this.props;
    const { hasError } = this.state;
    
    if (hasError && resetOnPropsChange) {
      const hasResetKeyChanged = resetKeys?.some(
        (key, index) => key !== this.previousResetKeys[index]
      );
      
      if (hasResetKeyChanged) {
        this.resetErrorBoundary();
        this.previousResetKeys = resetKeys || [];
      }
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
    
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  scheduleReset = (delay: number = 5000) => {
    this.resetTimeoutId = setTimeout(() => {
      this.resetErrorBoundary();
    }, delay);
  };

  render() {
    const { hasError, error, errorInfo, errorCount } = this.state;
    const { children, fallback, isolate, level = 'component' } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback(error, errorInfo!);
      }

      return (
        <div className={`error-boundary-fallback error-boundary-${level}`}>
          <div className="alert alert-danger" role="alert">
            <h5 className="alert-heading">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              {level === 'page' ? 'Page Error' : 
               level === 'section' ? 'Section Error' : 
               'Component Error'}
            </h5>
            <p className="mb-2">
              {error.message || 'An unexpected error occurred'}
            </p>
            {errorCount > 1 && (
              <p className="text-muted small mb-2">
                This error has occurred {errorCount} times
              </p>
            )}
            <div className="mt-3">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary me-2"
                onClick={this.resetErrorBoundary}
              >
                <i className="bi bi-arrow-clockwise me-1"></i>
                Try Again
              </button>
              {isolate && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => window.location.reload()}
                >
                  <i className="bi bi-arrow-repeat me-1"></i>
                  Reload Page
                </button>
              )}
            </div>
            {process.env.NODE_ENV === 'development' && errorInfo && (
              <details className="mt-3">
                <summary className="text-muted small cursor-pointer">
                  Error Details (Development Only)
                </summary>
                <pre className="mt-2 p-2 bg-light rounded small text-wrap">
                  {error.stack}
                  {'\n\nComponent Stack:'}
                  {errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return children;
  }
}

export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
};