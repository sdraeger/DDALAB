import React, { useState } from 'react';

interface QuitConfirmationModalProps {
  onClose: () => void;
  onConfirmQuit: (stopDDALAB: boolean) => void;
  isDDALABRunning: boolean;
}

export const QuitConfirmationModal: React.FC<QuitConfirmationModalProps> = ({
  onClose,
  onConfirmQuit,
  isDDALABRunning
}) => {
  const [stopDDALAB, setStopDDALAB] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirmQuit(stopDDALAB);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="modal fade show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 9999 }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-exclamation-triangle text-warning me-2"></i>
              Quit DDALAB ConfigManager
            </h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              disabled={isProcessing}
            ></button>
          </div>
          <div className="modal-body">
            {isDDALABRunning ? (
              <>
                <div className="alert alert-warning d-flex align-items-center" role="alert">
                  <i className="bi bi-info-circle me-2"></i>
                  <div>
                    <strong>DDALAB is currently running</strong> in Docker containers.
                  </div>
                </div>

                <p className="mb-3">
                  You are about to quit the ConfigManager while DDALAB services are running.
                  What would you like to do?
                </p>

                <div className="form-check mb-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="stopDDALAB"
                    checked={stopDDALAB}
                    onChange={(e) => setStopDDALAB(e.target.checked)}
                    disabled={isProcessing}
                  />
                  <label className="form-check-label" htmlFor="stopDDALAB">
                    <strong>Stop DDALAB services</strong> before quitting
                  </label>
                  <div className="form-text">
                    If unchecked, DDALAB will continue running in the background via Docker.
                  </div>
                </div>

                <div className={`alert ${stopDDALAB ? 'alert-info' : 'alert-success'} small`}>
                  <i className={`bi ${stopDDALAB ? 'bi-stop-circle' : 'bi-play-circle'} me-2`}></i>
                  {stopDDALAB ?
                    'DDALAB services will be stopped and ConfigManager will quit.' :
                    'ConfigManager will quit but DDALAB will continue running in Docker containers.'
                  }
                </div>
              </>
            ) : (
              <>
                <p className="mb-0">
                  Are you sure you want to quit DDALAB ConfigManager?
                </p>
                <small className="text-muted">
                  DDALAB services are not currently running.
                </small>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  {stopDDALAB ? 'Stopping DDALAB...' : 'Quitting...'}
                </>
              ) : (
                <>
                  <i className="bi bi-power me-2"></i>
                  {isDDALABRunning && stopDDALAB ? 'Stop DDALAB & Quit' : 'Quit'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
