import React from "react";
import type { UserSelections } from "../utils/electron";

interface WelcomeSiteProps {
  userSelections: UserSelections;
  onSetupTypeChange: (setupType: "docker" | "manual") => void;
}

export const WelcomeSite: React.FC<WelcomeSiteProps> = ({
  userSelections,
  onSetupTypeChange,
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onSetupTypeChange(event.target.value as "docker" | "manual");
  };

  return (
    <>
      <div className="text-center mb-4">
        <h2>Welcome to DDALAB!</h2>
        <p className="lead">
          This wizard will help you deploy DDALAB using Docker containers.
        </p>
      </div>

      <div className="alert alert-info">
        <h5>🚀 Quick Start with Docker</h5>
        <p>
          DDALAB is now available as Docker containers, making deployment much easier.
          You only need Docker installed on your system.
        </p>
      </div>

      <div className="mb-4">
        <h5>Choose your deployment method:</h5>

        <div className="form-check mb-3">
          <input
            className="form-check-input"
            type="radio"
            name="setupType"
            id="setupTypeDocker"
            value="docker"
            checked={userSelections.setupType === "docker"}
            onChange={handleChange}
          />
          <label className="form-check-label" htmlFor="setupTypeDocker">
            <strong>Docker Deployment (Recommended)</strong>
          </label>
          <div className="ms-4 mt-1 text-muted">
            <small>
              • Uses Docker Hub images (ddalab/api, ddalab/web)<br />
              • Minimal setup required<br />
              • Automatic container management<br />
              • Easy updates and maintenance
            </small>
          </div>
        </div>

        <div className="form-check">
          <input
            className="form-check-input"
            type="radio"
            name="setupType"
            id="setupTypeManual"
            value="manual"
            checked={userSelections.setupType === "manual"}
            onChange={handleChange}
          />
          <label className="form-check-label" htmlFor="setupTypeManual">
            <strong>Manual Configuration</strong>
          </label>
          <div className="ms-4 mt-1 text-muted">
            <small>
              • For advanced users<br />
              • Custom environment configuration<br />
              • Direct file editing
            </small>
          </div>
        </div>
      </div>

      <div className="alert alert-warning">
        <h6>⚠️ Requirements</h6>
        <ul className="mb-0">
          <li><strong>Docker</strong> must be installed and running</li>
          <li>At least <strong>4GB RAM</strong> available</li>
          <li><strong>10GB free disk space</strong> for data storage</li>
        </ul>
      </div>

      <div className="alert alert-success">
        <h6>✅ What you'll get</h6>
        <ul className="mb-0">
          <li>DDALAB Web Interface (accessible via browser)</li>
          <li>DDALAB API Server</li>
          <li>PostgreSQL Database</li>
          <li>MinIO File Storage</li>
          <li>Redis Cache</li>
          <li>Traefik Reverse Proxy</li>
        </ul>
      </div>
    </>
  );
};
