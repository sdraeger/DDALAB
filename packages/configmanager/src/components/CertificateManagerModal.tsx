import React, { useState, useEffect } from 'react';
import type { ElectronAPI } from '../utils/electron';
import { logger } from '../utils/logger-client';

interface CertificateInfo {
  exists: boolean;
  valid: boolean;
  expiresAt?: Date;
  daysUntilExpiry?: number;
  subjects: string[];
  isSelfSigned: boolean;
  isTrusted: boolean;
  error?: string;
}

interface CertificateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  electronAPI?: ElectronAPI;
  certsDir: string;
  onCertificatesUpdated?: () => void;
}

export const CertificateManagerModal: React.FC<CertificateManagerModalProps> = ({
  isOpen,
  onClose,
  electronAPI,
  certsDir,
  onCertificatesUpdated,
}) => {
  const [certificateInfo, setCertificateInfo] = useState<CertificateInfo | null>(null);
  const [mkcertAvailable, setMkcertAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen && electronAPI) {
      loadCertificateInfo();
      checkMkcertAvailability();
    }
  }, [isOpen, electronAPI, certsDir]);

  const loadCertificateInfo = async () => {
    if (!electronAPI) return;
    
    setIsLoading(true);
    try {
      const info = await electronAPI.getCertificateInfo(certsDir);
      setCertificateInfo(info);
    } catch (error) {
      logger.error('Failed to load certificate info', error);
      setMessage({ type: 'error', text: 'Failed to load certificate information' });
    } finally {
      setIsLoading(false);
    }
  };

  const checkMkcertAvailability = async () => {
    if (!electronAPI) return;
    
    try {
      const available = await electronAPI.checkMkcertAvailable();
      setMkcertAvailable(available);
    } catch (error) {
      logger.error('Failed to check mkcert availability', error);
    }
  };

  const handleInstallMkcert = async () => {
    if (!electronAPI) return;
    
    setIsLoading(true);
    setMessage(null);
    
    try {
      const result = await electronAPI.installMkcert();
      if (result.success) {
        setMessage({ type: 'success', text: 'mkcert installed successfully!' });
        setMkcertAvailable(true);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to install mkcert' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to install mkcert' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateTrustedCertificates = async () => {
    if (!electronAPI) return;
    
    setIsGenerating(true);
    setMessage(null);
    
    try {
      const result = await electronAPI.generateTrustedCertificates(certsDir);
      if (result.success) {
        setMessage({ type: 'success', text: 'Trusted certificates generated successfully!' });
        await loadCertificateInfo();
        onCertificatesUpdated?.();
      } else {
        // Check if it's a Firefox database error
        if (result.error && result.error.includes('Firefox') && result.error.includes('certutil')) {
          setMessage({ 
            type: 'warning', 
            text: 'Certificates generated but Firefox database warning occurred (certificates will still work in all browsers)' 
          });
          // Still refresh the certificate info as they might have been generated
          await loadCertificateInfo();
          onCertificatesUpdated?.();
        } else {
          setMessage({ type: 'error', text: result.error || 'Failed to generate trusted certificates' });
        }
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to generate trusted certificates' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSelfSignedCertificates = async () => {
    if (!electronAPI) return;
    
    setIsGenerating(true);
    setMessage(null);
    
    try {
      const result = await electronAPI.generateSelfSignedCertificates(certsDir);
      if (result.success) {
        setMessage({ 
          type: 'success', 
          text: 'Self-signed certificates generated successfully! (Browsers will still show warnings)' 
        });
        await loadCertificateInfo();
        onCertificatesUpdated?.();
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to generate self-signed certificates' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to generate self-signed certificates' });
    } finally {
      setIsGenerating(false);
    }
  };

  const getStatusBadge = (info: CertificateInfo) => {
    if (!info.exists) {
      return <span className="badge bg-warning">No Certificate</span>;
    }
    if (!info.valid) {
      return <span className="badge bg-danger">Expired</span>;
    }
    if (info.isTrusted) {
      return <span className="badge bg-success">Trusted</span>;
    }
    return <span className="badge bg-warning">Self-Signed</span>;
  };

  const getExpiryWarning = (info: CertificateInfo) => {
    if (!info.exists || !info.valid || !info.daysUntilExpiry) return null;
    
    if (info.daysUntilExpiry <= 7) {
      return <small className="text-danger">⚠️ Expires in {info.daysUntilExpiry} days</small>;
    }
    if (info.daysUntilExpiry <= 30) {
      return <small className="text-warning">⚠️ Expires in {info.daysUntilExpiry} days</small>;
    }
    return null;
  };

  if (!isOpen) return null;

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">🔒 SSL Certificate Management</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              disabled={isLoading || isGenerating}
            />
          </div>

          <div className="modal-body">
            {message && (
              <div className={`alert alert-${message.type === 'error' ? 'danger' : message.type} alert-dismissible fade show`}>
                {message.text}
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMessage(null)}
                />
              </div>
            )}

            {/* Current Certificate Status */}
            <div className="card mb-4">
              <div className="card-header">
                <h6 className="mb-0">Current Certificate Status</h6>
              </div>
              <div className="card-body">
                {isLoading ? (
                  <div className="text-center py-3">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="mt-2 mb-0">Loading certificate information...</p>
                  </div>
                ) : certificateInfo ? (
                  <div>
                    <div className="row">
                      <div className="col-md-6">
                        <strong>Status:</strong> {getStatusBadge(certificateInfo)}
                        {getExpiryWarning(certificateInfo) && (
                          <div className="mt-1">{getExpiryWarning(certificateInfo)}</div>
                        )}
                      </div>
                      {certificateInfo.expiresAt && (
                        <div className="col-md-6">
                          <strong>Expires:</strong>{' '}
                          <small>{new Date(certificateInfo.expiresAt).toLocaleDateString()}</small>
                        </div>
                      )}
                    </div>
                    
                    {certificateInfo.subjects.length > 0 && (
                      <div className="mt-3">
                        <strong>Domains:</strong>
                        <div className="mt-1">
                          {certificateInfo.subjects.map((subject, index) => (
                            <span key={index} className="badge bg-light text-dark me-1">
                              {subject}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-muted">Failed to load certificate information</p>
                )}
              </div>
            </div>

            {/* mkcert Section */}
            <div className="card mb-4">
              <div className="card-header">
                <h6 className="mb-0">🎯 Recommended: Trusted Certificates</h6>
              </div>
              <div className="card-body">
                <p className="mb-3">
                  Use <strong>mkcert</strong> to generate locally trusted SSL certificates. 
                  This eliminates browser security warnings completely.
                </p>
                
                {mkcertAvailable ? (
                  <div>
                    <div className="alert alert-success">
                      <strong>✅ mkcert is available</strong> - You can generate trusted certificates
                    </div>
                    <button
                      className="btn btn-success"
                      onClick={handleGenerateTrustedCertificates}
                      disabled={isGenerating || isLoading}
                    >
                      {isGenerating ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" />
                          Generating Trusted Certificates...
                        </>
                      ) : (
                        '🔒 Generate Trusted Certificates'
                      )}
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="alert alert-warning">
                      <strong>⚠️ mkcert is not installed</strong> - Install it to generate trusted certificates
                    </div>
                    <button
                      className="btn btn-primary me-2"
                      onClick={handleInstallMkcert}
                      disabled={isLoading || isGenerating}
                    >
                      {isLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" />
                          Installing...
                        </>
                      ) : (
                        '📦 Install mkcert'
                      )}
                    </button>
                    <small className="text-muted">
                      This will install mkcert using Homebrew (macOS)
                    </small>
                  </div>
                )}
              </div>
            </div>

            {/* Fallback Section */}
            <div className="card">
              <div className="card-header">
                <h6 className="mb-0">🔧 Fallback: Self-Signed Certificates</h6>
              </div>
              <div className="card-body">
                <p className="mb-3">
                  Generate traditional self-signed certificates. 
                  <strong className="text-warning">Browsers will still show security warnings.</strong>
                </p>
                
                <button
                  className="btn btn-outline-secondary"
                  onClick={handleGenerateSelfSignedCertificates}
                  disabled={isGenerating || isLoading}
                >
                  {isGenerating ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Generating Self-Signed Certificates...
                    </>
                  ) : (
                    '⚠️ Generate Self-Signed Certificates'
                  )}
                </button>
              </div>
            </div>

            {/* Information Section */}
            <div className="mt-4">
              <h6>ℹ️ About SSL Certificates</h6>
              <ul className="small text-muted">
                <li><strong>Trusted certificates</strong> (mkcert): No browser warnings, works like production SSL</li>
                <li><strong>Self-signed certificates</strong>: Browser warnings, requires manual acceptance</li>
                <li>Both options provide the same encryption, the difference is in browser trust</li>
                <li>You may need to restart DDALAB services after generating new certificates</li>
              </ul>

              <div className="alert alert-info mt-3">
                <h6 className="alert-heading">🦊 Firefox Database Warnings</h6>
                <p className="mb-1 small">
                  If you see Firefox certificate database errors, don't worry! This is a common Firefox issue.
                </p>
                <p className="mb-0 small">
                  <strong>The certificates will still work perfectly in all browsers, including Firefox.</strong>
                  The error only affects Firefox's internal certificate database, not the actual certificates.
                </p>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isLoading || isGenerating}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};