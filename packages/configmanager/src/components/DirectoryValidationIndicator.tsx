import React from "react";

interface DirectoryValidationIndicatorProps {
  directories: Array<{ path: string; containerPath: string; permissions: string }>;
  isValid: boolean;
  className?: string;
}

export const DirectoryValidationIndicator: React.FC<DirectoryValidationIndicatorProps> = ({
  directories,
  isValid,
  className = "",
}) => {
  const validDirectories = directories.filter(dir => dir.path && dir.containerPath);
  
  return (
    <div className={`directory-validation-indicator ${className}`}>
      <div className="d-flex align-items-center mb-2">
        <div className={`status-icon me-2 ${isValid ? 'text-success' : 'text-warning'}`}>
          {isValid ? (
            <i className="bi bi-check-circle-fill" title="Valid configuration"></i>
          ) : (
            <i className="bi bi-exclamation-triangle-fill" title="Configuration incomplete"></i>
          )}
        </div>
        <span className="fw-bold">
          Directory Configuration Status
        </span>
      </div>
      
      <div className="ps-4">
        <div className="mb-2">
          <small className="text-muted">
            Configured directories: {validDirectories.length} / {Math.max(1, directories.length)}
          </small>
        </div>
        
        {validDirectories.map((dir, index) => (
          <div key={index} className="mb-1">
            <small className="d-block text-truncate">
              <span className="text-muted">Host:</span> {dir.path}
            </small>
            <small className="d-block text-truncate">
              <span className="text-muted">Container:</span> {dir.containerPath} 
              <span className={`badge ms-1 ${dir.permissions === 'rw' ? 'bg-primary' : 'bg-secondary'}`}>
                {dir.permissions}
              </span>
            </small>
          </div>
        ))}
        
        {!isValid && (
          <div className="alert alert-warning alert-sm mt-2 mb-0">
            <small>
              <i className="bi bi-info-circle me-1"></i>
              Complete directory configuration to proceed
            </small>
          </div>
        )}
      </div>
    </div>
  );
};