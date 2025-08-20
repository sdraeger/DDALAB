import React from "react";

interface DirectoryRequirementsModalProps {
  show: boolean;
  onClose: () => void;
}

export const DirectoryRequirementsModal: React.FC<DirectoryRequirementsModalProps> = ({
  show,
  onClose,
}) => {
  if (!show) return null;

  return (
    <div className="modal fade show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1050 }}>
      <div className="modal-dialog modal-lg" style={{ zIndex: 1055 }}>
        <div className="modal-content">
          <div className="modal-header bg-primary text-white">
            <h5 className="modal-title">
              <i className="bi bi-shield-lock me-2"></i>
              Directory Security Requirements
            </h5>
          </div>
          
          <div className="modal-body">
            <div className="alert alert-info">
              <i className="bi bi-info-circle me-2"></i>
              <strong>Security Notice:</strong> DDALAB requires explicit directory permissions for data access.
            </div>
            
            <h6 className="mb-3">Why is this required?</h6>
            <ul className="mb-4">
              <li><strong>Security:</strong> DDALAB runs in a secure containerized environment</li>
              <li><strong>Data Protection:</strong> Only directories you explicitly allow can be accessed</li>
              <li><strong>Isolation:</strong> Prevents unauthorized access to your system files</li>
              <li><strong>Compliance:</strong> Follows security best practices for data analysis tools</li>
            </ul>
            
            <h6 className="mb-3">What you need to configure:</h6>
            <div className="row">
              <div className="col-md-6">
                <div className="card h-100">
                  <div className="card-body">
                    <h6 className="card-title text-primary">
                      <i className="bi bi-database me-2"></i>
                      Primary Data Directory
                    </h6>
                    <p className="card-text small">
                      This directory will store DDALAB's database, configuration files, and analysis results.
                      <strong className="d-block mt-2">Required: Yes</strong>
                    </p>
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="card h-100">
                  <div className="card-body">
                    <h6 className="card-title text-secondary">
                      <i className="bi bi-folder2-open me-2"></i>
                      Additional Directories
                    </h6>
                    <p className="card-text small">
                      Optional directories for importing/exporting data files and datasets.
                      <strong className="d-block mt-2">Required: No</strong>
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="alert alert-warning mt-4">
              <i className="bi bi-exclamation-triangle me-2"></i>
              <strong>Important:</strong> You cannot proceed with setup until at least one directory is configured.
            </div>
          </div>
          
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onClose}
            >
              <i className="bi bi-check me-2"></i>
              I Understand, Continue Setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};