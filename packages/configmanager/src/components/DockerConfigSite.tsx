import React, { useState } from "react";
import type { UserSelections, ElectronAPI } from "../utils/electron";

interface DockerConfigSiteProps {
	userSelections: UserSelections;
	onUpdateSelections: (selections: Partial<UserSelections>) => void;
	electronAPI?: ElectronAPI;
}

export const DockerConfigSite: React.FC<DockerConfigSiteProps> = ({
	userSelections,
	onUpdateSelections,
	electronAPI,
}) => {
	const [isLoading, setIsLoading] = useState(false);

	const handleWebPortChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		onUpdateSelections({ webPort: event.target.value });
	};

	const handleApiPortChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		onUpdateSelections({ apiPort: event.target.value });
	};

	const handleDbPasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		onUpdateSelections({ dbPassword: event.target.value });
	};

	const handleMinioPasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		onUpdateSelections({ minioPassword: event.target.value });
	};

	const handleTraefikEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		onUpdateSelections({ traefikEmail: event.target.value });
	};

	return (
		<>
			<div className="text-center mb-4">
				<h2>Docker Configuration</h2>
				<p className="lead">
					Configure your DDALAB Docker deployment settings.
				</p>
			</div>

			<div className="alert alert-info">
				<h5>🐳 Docker Deployment Settings</h5>
				<p>
					These settings will be used to configure your DDALAB Docker containers.
					You can use the default values or customize them according to your needs.
				</p>
			</div>

			<div className="row">
				<div className="col-md-6">
					<div className="card mb-3">
						<div className="card-header">
							<h6 className="mb-0">Web Application Settings</h6>
						</div>
						<div className="card-body">
							<div className="mb-3">
								<label htmlFor="webPort" className="form-label">
									Web Port
								</label>
								<input
									type="number"
									className="form-control"
									id="webPort"
									value={userSelections.webPort || "3000"}
									onChange={handleWebPortChange}
									min="1"
									max="65535"
								/>
								<div className="form-text">
									Port for the DDALAB web interface (default: 3000)
								</div>
							</div>

							<div className="mb-3">
								<label htmlFor="apiPort" className="form-label">
									API Port
								</label>
								<input
									type="number"
									className="form-control"
									id="apiPort"
									value={userSelections.apiPort || "8001"}
									onChange={handleApiPortChange}
									min="1"
									max="65535"
								/>
								<div className="form-text">
									Port for the DDALAB API server (default: 8001)
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="col-md-6">
					<div className="card mb-3">
						<div className="card-header">
							<h6 className="mb-0">Database Settings</h6>
						</div>
						<div className="card-body">
							<div className="mb-3">
								<label htmlFor="dbPassword" className="form-label">
									Database Password
								</label>
								<input
									type="password"
									className="form-control"
									id="dbPassword"
									value={userSelections.dbPassword || "ddalab_password"}
									onChange={handleDbPasswordChange}
								/>
								<div className="form-text">
									Password for PostgreSQL database (default: ddalab_password)
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="row">
				<div className="col-md-6">
					<div className="card mb-3">
						<div className="card-header">
							<h6 className="mb-0">File Storage Settings</h6>
						</div>
						<div className="card-body">
							<div className="mb-3">
								<label htmlFor="minioPassword" className="form-label">
									MinIO Password
								</label>
								<input
									type="password"
									className="form-control"
									id="minioPassword"
									value={userSelections.minioPassword || "ddalab_password"}
									onChange={handleMinioPasswordChange}
								/>
								<div className="form-text">
									Password for MinIO file storage (default: ddalab_password)
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="col-md-6">
					<div className="card mb-3">
						<div className="card-header">
							<h6 className="mb-0">SSL/TLS Settings</h6>
						</div>
						<div className="card-body">
							<div className="mb-3">
								<label htmlFor="traefikEmail" className="form-label">
									Traefik Email
								</label>
								<input
									type="email"
									className="form-control"
									id="traefikEmail"
									value={userSelections.traefikEmail || "admin@ddalab.local"}
									onChange={handleTraefikEmailChange}
								/>
								<div className="form-text">
									Email for SSL certificate notifications (default: admin@ddalab.local)
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="alert alert-success">
				<h6>✅ Configuration Summary</h6>
				<ul className="mb-0">
					<li><strong>Data Location:</strong> {userSelections.dataLocation}</li>
					<li><strong>Web Port:</strong> {userSelections.webPort || "3000"}</li>
					<li><strong>API Port:</strong> {userSelections.apiPort || "8001"}</li>
					<li><strong>Database Password:</strong> {userSelections.dbPassword ? "••••••••" : "ddalab_password"}</li>
					<li><strong>MinIO Password:</strong> {userSelections.minioPassword ? "••••••••" : "ddalab_password"}</li>
					<li><strong>Traefik Email:</strong> {userSelections.traefikEmail || "admin@ddalab.local"}</li>
				</ul>
			</div>

			<div className="alert alert-info">
				<h6>ℹ️ What happens next?</h6>
				<p className="mb-0">
					When you proceed, the ConfigManager will:
				</p>
				<ul className="mb-0">
					<li>Clone the DDALAB setup repository</li>
					<li>Generate Docker configuration files with your settings</li>
					<li>Create the necessary directories and security files</li>
					<li>Validate the complete setup</li>
				</ul>
			</div>
		</>
	);
};
