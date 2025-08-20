import React, { useState, useEffect } from "react";
import { ElectronAPI } from "../utils/electron";
import { logger } from '../utils/logger-client';

interface AllowedDirectory {
  path: string;
  containerPath: string;
  permissions: "ro" | "rw";
}

interface AllowedDirectoriesSelectorProps {
  electronAPI: ElectronAPI | undefined;
  initialDirectories?: AllowedDirectory[];
  onChange: (directories: AllowedDirectory[]) => void;
  required?: boolean;
}

export const AllowedDirectoriesSelector: React.FC<AllowedDirectoriesSelectorProps> = ({
  electronAPI,
  initialDirectories = [],
  onChange,
  required = true,
}) => {
  const [directories, setDirectories] = useState<AllowedDirectory[]>(
    initialDirectories.length > 0 ? initialDirectories : [
      { path: "", containerPath: "/app/data", permissions: "rw" }
    ]
  );
  const [errors, setErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    onChange(directories.filter(dir => dir.path !== ""));
  }, [directories]);

  const handleSelectDirectory = async (index: number) => {
    if (electronAPI && electronAPI.selectDirectory) {
      try {
        const path = await electronAPI.selectDirectory();
        if (path) {
          const newDirs = [...directories];
          newDirs[index] = { ...newDirs[index], path };
          setDirectories(newDirs);
          
          // Clear error for this index
          const newErrors = { ...errors };
          delete newErrors[index];
          setErrors(newErrors);
        }
      } catch (error) {
        logger.error('Error selecting directory', error);
        // TODO: Show user-friendly UI notification instead of alert
      }
    }
  };

  const handleContainerPathChange = (index: number, containerPath: string) => {
    const newDirs = [...directories];
    newDirs[index] = { ...newDirs[index], containerPath };
    setDirectories(newDirs);
    
    // Validate container path
    if (!containerPath.startsWith("/")) {
      setErrors({ ...errors, [index]: "Container path must start with /" });
    } else {
      const newErrors = { ...errors };
      delete newErrors[index];
      setErrors(newErrors);
    }
  };

  const handlePermissionsChange = (index: number, permissions: "ro" | "rw") => {
    const newDirs = [...directories];
    newDirs[index] = { ...newDirs[index], permissions };
    setDirectories(newDirs);
  };

  const addDirectory = () => {
    setDirectories([...directories, { path: "", containerPath: "/app/data" + (directories.length + 1), permissions: "rw" }]);
  };

  const removeDirectory = (index: number) => {
    if (directories.length > 1) {
      const newDirs = directories.filter((_, i) => i !== index);
      setDirectories(newDirs);
      
      // Remove error for this index
      const newErrors = { ...errors };
      delete newErrors[index];
      setErrors(newErrors);
    }
  };

  const hasValidDirectories = () => {
    return directories.some(dir => dir.path !== "" && dir.containerPath !== "" && !errors[directories.indexOf(dir)]);
  };

  return (
    <div className="allowed-directories-selector">
      <h3>Allowed Directories {required && <span className="text-danger">*</span>}</h3>
      <p className="text-muted mb-3">
        Configure directories that the application can access. At least one directory must be configured.
      </p>
      
      {directories.map((dir, index) => (
        <div key={index} className="directory-config card mb-3 p-3">
          <div className="row">
            <div className="col-12 col-md-6 col-lg-5 mb-3 mb-lg-0">
              <label className="form-label">
                Host Directory {index === 0 && required && <span className="text-danger">*</span>}
              </label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  value={dir.path}
                  placeholder="Select directory..."
                  readOnly
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => handleSelectDirectory(index)}
                >
                  Browse
                </button>
              </div>
              {index === 0 && required && !dir.path && (
                <small className="text-danger d-block mt-1">A data directory must be selected</small>
              )}
            </div>
            
            <div className="col-12 col-md-6 col-lg-3 mb-3 mb-lg-0">
              <label className="form-label">Container Path</label>
              <input
                type="text"
                className={`form-control ${errors[index] ? 'is-invalid' : ''}`}
                value={dir.containerPath}
                onChange={(e) => handleContainerPathChange(index, e.target.value)}
                placeholder="/app/data"
              />
              {errors[index] && (
                <div className="invalid-feedback">{errors[index]}</div>
              )}
            </div>
            
            <div className="col-12 col-md-6 col-lg-3 mb-3 mb-lg-0">
              <label className="form-label">Permissions</label>
              <select
                className="form-select"
                value={dir.permissions}
                onChange={(e) => handlePermissionsChange(index, e.target.value as "ro" | "rw")}
              >
                <option value="rw">Read/Write</option>
                <option value="ro">Read Only</option>
              </select>
            </div>
            
            <div className="col-12 col-md-6 col-lg-1 d-flex align-items-end">
              {directories.length > 1 && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm w-100"
                  onClick={() => removeDirectory(index)}
                  title="Remove directory"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={addDirectory}
      >
        + Add Another Directory
      </button>
      
      {required && !hasValidDirectories() && (
        <div className="alert alert-warning mt-3">
          <i className="bi bi-exclamation-triangle-fill me-2"></i>
          At least one directory must be configured before proceeding.
        </div>
      )}
    </div>
  );
};