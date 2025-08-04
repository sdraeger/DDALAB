import React, { useState, useEffect } from "react";
import type { ElectronAPI, UserSelections, ParsedEnvEntry } from "../utils/electron";

interface ConfigurationEditorProps {
  userSelections: UserSelections;
  parsedEnvEntries: ParsedEnvEntry[];
  electronAPI?: ElectronAPI;
  onSave: (selections: Partial<UserSelections>, envEntries: ParsedEnvEntry[]) => void;
  onCancel: () => void;
}

export const ConfigurationEditor: React.FC<ConfigurationEditorProps> = ({
  userSelections,
  parsedEnvEntries,
  electronAPI,
  onSave,
  onCancel,
}) => {
  const [editedSelections, setEditedSelections] = useState<UserSelections>({ ...userSelections });
  const [editedEnvEntries, setEditedEnvEntries] = useState<ParsedEnvEntry[]>([...parsedEnvEntries]);
  const [activeTab, setActiveTab] = useState<'basic' | 'docker' | 'env'>('basic');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditedSelections({ ...userSelections });
    setEditedEnvEntries([...parsedEnvEntries]);
  }, [userSelections, parsedEnvEntries]);

  const handleBasicChange = (field: keyof UserSelections, value: any) => {
    setEditedSelections(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleEnvChange = (index: number, field: 'key' | 'value', newValue: string) => {
    setEditedEnvEntries(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: newValue };
      return updated;
    });
  };

  const handleAddEnvEntry = () => {
    setEditedEnvEntries(prev => [
      ...prev,
      { key: '', value: '', comments: [] }
    ]);
  };

  const handleRemoveEnvEntry = (index: number) => {
    setEditedEnvEntries(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update environment variables object from entries
      const envVariables = editedEnvEntries.reduce((acc, entry) => {
        if (entry.key.trim()) {
          acc[entry.key] = entry.value;
        }
        return acc;
      }, {} as { [key: string]: string });

      const updatedSelections = {
        ...editedSelections,
        envVariables
      };

      await onSave(updatedSelections, editedEnvEntries);
    } catch (error) {
      console.error('Failed to save configuration:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const renderBasicTab = () => (
    <div className="tab-content">
      <div className="form-group mb-3">
        <label className="form-label">Setup Type</label>
        <select
          className="form-select"
          value={editedSelections.setupType}
          onChange={(e) => handleBasicChange('setupType', e.target.value)}
        >
          <option value="docker">Docker</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <div className="form-group mb-3">
        <label className="form-label">Data Location</label>
        <div className="input-group">
          <input
            type="text"
            className="form-control"
            value={editedSelections.dataLocation}
            onChange={(e) => handleBasicChange('dataLocation', e.target.value)}
            placeholder="/path/to/data"
          />
          <button
            className="btn btn-outline-secondary"
            type="button"
            onClick={async () => {
              if (electronAPI?.selectDirectory) {
                const path = await electronAPI.selectDirectory();
                if (path) handleBasicChange('dataLocation', path);
              }
            }}
          >
            Browse
          </button>
        </div>
      </div>

      {editedSelections.setupType === 'docker' && (
        <div className="form-group mb-3">
          <label className="form-label">Setup Location</label>
          <div className="input-group">
            <input
              type="text"
              className="form-control"
              value={editedSelections.cloneLocation}
              onChange={(e) => handleBasicChange('cloneLocation', e.target.value)}
              placeholder="/path/to/setup"
            />
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={async () => {
                if (electronAPI?.selectDirectory) {
                  const path = await electronAPI.selectDirectory();
                  if (path) handleBasicChange('cloneLocation', path);
                }
              }}
            >
              Browse
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderDockerTab = () => (
    <div className="tab-content">
      <div className="row">
        <div className="col-md-6">
          <div className="form-group mb-3">
            <label className="form-label">Web Port</label>
            <input
              type="number"
              className="form-control"
              value={editedSelections.webPort || ''}
              onChange={(e) => handleBasicChange('webPort', e.target.value)}
              placeholder="3000"
            />
          </div>
        </div>
        <div className="col-md-6">
          <div className="form-group mb-3">
            <label className="form-label">API Port</label>
            <input
              type="number"
              className="form-control"
              value={editedSelections.apiPort || ''}
              onChange={(e) => handleBasicChange('apiPort', e.target.value)}
              placeholder="8001"
            />
          </div>
        </div>
      </div>

      <div className="form-group mb-3">
        <label className="form-label">Database Password</label>
        <input
          type="password"
          className="form-control"
          value={editedSelections.dbPassword || ''}
          onChange={(e) => handleBasicChange('dbPassword', e.target.value)}
          placeholder="Enter database password"
        />
      </div>

      <div className="form-group mb-3">
        <label className="form-label">MinIO Password</label>
        <input
          type="password"
          className="form-control"
          value={editedSelections.minioPassword || ''}
          onChange={(e) => handleBasicChange('minioPassword', e.target.value)}
          placeholder="Enter MinIO password"
        />
      </div>

      <div className="form-group mb-3">
        <label className="form-label">Traefik Email</label>
        <input
          type="email"
          className="form-control"
          value={editedSelections.traefikEmail || ''}
          onChange={(e) => handleBasicChange('traefikEmail', e.target.value)}
          placeholder="admin@ddalab.local"
        />
      </div>

      <div className="form-check mb-3">
        <input
          className="form-check-input"
          type="checkbox"
          checked={editedSelections.useDockerHub !== false}
          onChange={(e) => handleBasicChange('useDockerHub', e.target.checked)}
        />
        <label className="form-check-label">
          Use Docker Hub images
        </label>
      </div>
    </div>
  );

  const renderEnvTab = () => (
    <div className="tab-content">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h6>Environment Variables</h6>
        <button
          className="btn btn-sm btn-outline-primary"
          onClick={handleAddEnvEntry}
        >
          Add Variable
        </button>
      </div>

      <div className="env-entries">
        {editedEnvEntries.map((entry, index) => (
          <div key={index} className="env-entry mb-2">
            <div className="row g-2">
              <div className="col-4">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="KEY"
                  value={entry.key}
                  onChange={(e) => handleEnvChange(index, 'key', e.target.value)}
                />
              </div>
              <div className="col-7">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="value"
                  value={entry.value}
                  onChange={(e) => handleEnvChange(index, 'value', e.target.value)}
                />
              </div>
              <div className="col-1">
                <button
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => handleRemoveEnvEntry(index)}
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="configuration-editor">
      <div className="modal-backdrop show"></div>
      <div className="modal show d-block">
        <div className="modal-dialog modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Edit Configuration</h5>
              <button type="button" className="btn-close" onClick={onCancel}></button>
            </div>
            <div className="modal-body">
              {/* Tab Navigation */}
              <ul className="nav nav-tabs mb-3">
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'basic' ? 'active' : ''}`}
                    onClick={() => setActiveTab('basic')}
                  >
                    Basic Settings
                  </button>
                </li>
                {editedSelections.setupType === 'docker' && (
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'docker' ? 'active' : ''}`}
                      onClick={() => setActiveTab('docker')}
                    >
                      Docker Config
                    </button>
                  </li>
                )}
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'env' ? 'active' : ''}`}
                    onClick={() => setActiveTab('env')}
                  >
                    Environment Variables
                  </button>
                </li>
              </ul>

              {/* Tab Content */}
              {activeTab === 'basic' && renderBasicTab()}
              {activeTab === 'docker' && renderDockerTab()}
              {activeTab === 'env' && renderEnvTab()}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .configuration-editor {
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

        .tab-content {
          min-height: 400px;
        }

        .env-entry {
          padding: 8px;
          background: #f8f9fa;
          border-radius: 4px;
        }

        .form-label {
          font-weight: 600;
          font-size: 13px;
          color: #495057;
        }

        .nav-link {
          background: none;
          border: none;
          color: #6c757d;
          padding: 8px 16px;
        }

        .nav-link.active {
          color: #007bff;
          border-bottom: 2px solid #007bff;
        }
      `}</style>
    </div>
  );
};