import React, { useState, useEffect } from 'react';
import type { ElectronAPI } from '../utils/electron';
import type { UpdateInfo, UpdateStatus, UpdateProgress, UpdateStatusType } from '../types/update-types';

interface UpdateProgressModalProps {
  electronAPI?: ElectronAPI;
  onClose: () => void;
  initialStatus?: UpdateStatusType;
}

interface UpdateState {
  status: UpdateStatusType;
  message: string;
  progress?: UpdateProgress;
  updateInfo?: UpdateInfo;
  error?: string;
  canCancel: boolean;
  canClose: boolean;
  showDetails: boolean;
}

export const UpdateProgressModal: React.FC<UpdateProgressModalProps> = ({
  electronAPI,
  onClose,
  initialStatus = 'idle'
}) => {
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: initialStatus,
    message: initialStatus === 'idle' ? 'Preparing to check for updates...' : 'Checking for updates...',
    canCancel: false,
    canClose: initialStatus === 'idle',
    showDetails: false
  });

  useEffect(() => {
    if (!electronAPI) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: 'Update service not available',
        error: 'Electron API not accessible',
        canClose: true,
        canCancel: false
      }));
      return;
    }

    // Listen for update status changes
    const unsubscribe = electronAPI.onEnhancedUpdateStatus?.((status: UpdateStatus) => {
      setUpdateState(prev => ({
        ...prev,
        status: status.status,
        message: status.message,
        progress: status.progress,
        updateInfo: status.updateInfo,
        error: status.error,
        canCancel: ['checking', 'downloading'].includes(status.status),
        canClose: ['not-available', 'error', 'cancelled', 'installed'].includes(status.status)
      }));
    });

    // Start update check if not already started
    if (initialStatus === 'idle') {
      handleCheckForUpdates();
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [electronAPI, initialStatus]);

  const handleCheckForUpdates = async () => {
    if (!electronAPI) return;

    setUpdateState(prev => ({
      ...prev,
      status: 'checking',
      message: 'Checking for updates...',
      canCancel: true,
      canClose: false
    }));

    try {
      await electronAPI.enhancedCheckForUpdates();
    } catch (error: any) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: 'Failed to check for updates',
        error: error.message,
        canCancel: false,
        canClose: true
      }));
    }
  };

  const handleDownloadUpdate = async () => {
    if (!electronAPI || !updateState.updateInfo) return;

    try {
      await electronAPI.enhancedDownloadUpdate();
    } catch (error: any) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: 'Failed to download update',
        error: error.message,
        canCancel: false,
        canClose: true
      }));
    }
  };

  const handleInstallUpdate = async () => {
    if (!electronAPI) return;

    try {
      await electronAPI.installUpdate();
    } catch (error: any) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        message: 'Failed to install update',
        error: error.message,
        canCancel: false,
        canClose: true
      }));
    }
  };

  const handleCancel = async () => {
    if (!electronAPI) return;

    try {
      await electronAPI.cancelUpdate();
      setUpdateState(prev => ({
        ...prev,
        status: 'cancelled',
        message: 'Update cancelled',
        canCancel: false,
        canClose: true
      }));
    } catch (error: any) {
      console.error('Failed to cancel update:', error);
    }
  };

  const handleClose = () => {
    if (updateState.canClose) {
      onClose();
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    return formatBytes(bytesPerSecond) + '/s';
  };

  const getStatusIcon = (): string => {
    switch (updateState.status) {
      case 'checking': return '🔍';
      case 'available': return '⬇️';
      case 'not-available': return '✅';
      case 'downloading': return '📥';
      case 'downloaded': return '📦';
      case 'installing': return '⚙️';
      case 'installed': return '🎉';
      case 'error': return '❌';
      case 'cancelled': return '⏹️';
      default: return '📱';
    }
  };

  const getStatusColor = (): string => {
    switch (updateState.status) {
      case 'checking': return 'primary';
      case 'available': return 'info';
      case 'not-available': return 'success';
      case 'downloading': return 'primary';
      case 'downloaded': return 'warning';
      case 'installing': return 'warning';
      case 'installed': return 'success';
      case 'error': return 'danger';
      case 'cancelled': return 'secondary';
      default: return 'secondary';
    }
  };

  const renderActionButtons = () => {
    switch (updateState.status) {
      case 'available':
        return (
          <div className="d-flex gap-2">
            <button className="btn btn-secondary" onClick={handleClose}>
              Skip This Version
            </button>
            <button className="btn btn-primary" onClick={handleDownloadUpdate}>
              Download Update
            </button>
          </div>
        );
      case 'downloaded':
        return (
          <div className="d-flex gap-2">
            <button className="btn btn-secondary" onClick={handleClose}>
              Install Later
            </button>
            <button className="btn btn-success" onClick={handleInstallUpdate}>
              Install Now & Restart
            </button>
          </div>
        );
      case 'not-available':
      case 'error':
      case 'cancelled':
      case 'installed':
        return (
          <button className="btn btn-primary" onClick={handleClose}>
            Close
          </button>
        );
      default:
        return (
          <div className="d-flex gap-2">
            {updateState.canCancel && (
              <button className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            )}
            <button
              className="btn btn-outline-secondary"
              onClick={handleClose}
              disabled={!updateState.canClose}
            >
              Close
            </button>
          </div>
        );
    }
  };

  const renderProgressBar = () => {
    if (!updateState.progress || updateState.status !== 'downloading') return null;

    const { percent, bytesPerSecond, transferred, total } = updateState.progress;

    return (
      <div className="progress-section">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="small text-muted">Downloading...</span>
          <span className="small text-muted">{Math.round(percent)}%</span>
        </div>
        <div className="progress mb-2" style={{ height: '8px' }}>
          <div
            className="progress-bar progress-bar-striped progress-bar-animated"
            role="progressbar"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="d-flex justify-content-between text-muted small">
          <span>{formatBytes(transferred)} / {formatBytes(total)}</span>
          <span>{formatSpeed(bytesPerSecond)}</span>
        </div>
      </div>
    );
  };

  const renderUpdateDetails = () => {
    if (!updateState.updateInfo || !updateState.showDetails) return null;

    const { currentVersion, newVersion, releaseDate, releaseNotes, fileSize } = updateState.updateInfo;

    return (
      <div className="update-details mt-3 p-3 bg-light rounded">
        <h6 className="mb-3">Update Details</h6>
        <div className="row">
          <div className="col-6">
            <small className="text-muted">Current Version:</small>
            <div className="fw-bold">{currentVersion}</div>
          </div>
          <div className="col-6">
            <small className="text-muted">New Version:</small>
            <div className="fw-bold text-primary">{newVersion}</div>
          </div>
        </div>
        {releaseDate && (
          <div className="mt-2">
            <small className="text-muted">Release Date:</small>
            <div>{new Date(releaseDate).toLocaleDateString()}</div>
          </div>
        )}
        {fileSize && (
          <div className="mt-2">
            <small className="text-muted">Download Size:</small>
            <div>{formatBytes(fileSize)}</div>
          </div>
        )}
        {releaseNotes && (
          <div className="mt-3">
            <small className="text-muted">Release Notes:</small>
            <div className="mt-1 small" style={{ maxHeight: '100px', overflowY: 'auto' }}>
              {releaseNotes}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="update-modal">
      <div className="modal-backdrop show"></div>
      <div className="modal show d-block">
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {getStatusIcon()} Software Update
              </h5>
              <button
                type="button"
                className="btn-close"
                onClick={handleClose}
                disabled={!updateState.canClose}
                aria-label="Close"
              />
            </div>

            <div className="modal-body">
              {/* Status Message */}
              <div className="text-center mb-4">
                <div className={`alert alert-${getStatusColor()} mb-3`}>
                  <div className="d-flex align-items-center justify-content-center">
                    {['checking', 'downloading', 'installing'].includes(updateState.status) && (
                      <div className="spinner-border spinner-border-sm me-2" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    )}
                    {updateState.message}
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              {renderProgressBar()}

              {/* Error Message */}
              {updateState.error && (
                <div className="alert alert-danger">
                  <strong>Error:</strong> {updateState.error}
                </div>
              )}

              {/* Update Available Info */}
              {updateState.status === 'available' && updateState.updateInfo && (
                <div className="update-available-info text-center">
                  <div className="mb-3">
                    <h6>New version available!</h6>
                    <div className="d-flex justify-content-center align-items-center gap-3">
                      <span className="badge bg-secondary">{updateState.updateInfo.currentVersion}</span>
                      <span>→</span>
                      <span className="badge bg-primary">{updateState.updateInfo.newVersion}</span>
                    </div>
                  </div>

                  <button
                    className="btn btn-link btn-sm"
                    onClick={() => setUpdateState(prev => ({ ...prev, showDetails: !prev.showDetails }))}
                  >
                    {updateState.showDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                </div>
              )}

              {/* Update Details */}
              {renderUpdateDetails()}

              {/* Development Mode Notice */}
              {updateState.status === 'error' && updateState.message.includes('not packed') && (
                <div className="alert alert-info">
                  <strong>Development Mode:</strong> Auto-updates are only available in production builds.
                  In development mode, updates must be installed manually.
                </div>
              )}
            </div>

            <div className="modal-footer">
              {renderActionButtons()}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .update-modal {
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
          border-radius: 8px;
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

        .btn-close:hover:not(:disabled) {
          color: #000;
          opacity: 1;
        }

        .btn-close:disabled {
          opacity: 0.25;
          cursor: not-allowed;
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
          border-radius: 0 0 8px 8px;
        }

        .progress-section {
          background: white;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }

        .update-available-info {
          background: white;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }

        .update-details {
          border: 1px solid #dee2e6;
        }

        .btn-link {
          text-decoration: none;
        }

        .btn-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
};
