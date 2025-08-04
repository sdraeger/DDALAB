import React, { useState } from 'react';
import { useForm, ValidationError } from '@formspree/react';

interface BugReportModalProps {
  onClose: () => void;
}

export const BugReportModal: React.FC<BugReportModalProps> = ({ onClose }) => {
  const [state, handleSubmit] = useForm("mwpqrpez");
  const [showSuccess, setShowSuccess] = useState(false);

  React.useEffect(() => {
    if (state.succeeded) {
      setShowSuccess(true);
      setTimeout(() => {
        onClose();
      }, 3000);
    }
  }, [state.succeeded, onClose]);

  return (
    <div className="modal fade show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-bug me-2"></i>
              Report a Bug
            </h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {showSuccess ? (
              <div className="text-center py-4">
                <div className="text-success mb-3">
                  <i className="bi bi-check-circle" style={{ fontSize: '3rem' }}></i>
                </div>
                <h4 className="text-success">Thank you for your report!</h4>
                <p className="text-muted">
                  Your bug report has been submitted successfully. We'll review it and get back to you if needed.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label htmlFor="email" className="form-label">
                    Email Address <span className="text-danger">*</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    className="form-control"
                    placeholder="your.email@example.com"
                    required
                  />
                  <ValidationError
                    prefix="Email"
                    field="email"
                    errors={state.errors}
                    className="text-danger small mt-1"
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="subject" className="form-label">
                    Bug Title <span className="text-danger">*</span>
                  </label>
                  <input
                    id="subject"
                    type="text"
                    name="subject"
                    className="form-control"
                    placeholder="Brief description of the bug"
                    required
                  />
                  <ValidationError
                    prefix="Subject"
                    field="subject"
                    errors={state.errors}
                    className="text-danger small mt-1"
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="message" className="form-label">
                    Bug Description <span className="text-danger">*</span>
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    className="form-control"
                    rows={6}
                    placeholder="Please describe the bug in detail:&#10;&#10;• What were you doing when the bug occurred?&#10;• What did you expect to happen?&#10;• What actually happened?&#10;• Steps to reproduce the issue&#10;• Any error messages you saw"
                    required
                  />
                  <ValidationError
                    prefix="Message"
                    field="message"
                    errors={state.errors}
                    className="text-danger small mt-1"
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="environment" className="form-label">
                    Environment Information
                  </label>
                  <textarea
                    id="environment"
                    name="environment"
                    className="form-control"
                    rows={3}
                    placeholder="Operating System, ConfigManager version, etc. (optional)"
                  />
                  <ValidationError
                    prefix="Environment"
                    field="environment"
                    errors={state.errors}
                    className="text-danger small mt-1"
                  />
                </div>

                <div className="d-flex justify-content-end gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onClose}
                    disabled={state.submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-danger"
                    disabled={state.submitting}
                  >
                    {state.submitting ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm me-2"
                          role="status"
                          aria-hidden="true"
                        />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-send me-2"></i>
                        Submit Bug Report
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
