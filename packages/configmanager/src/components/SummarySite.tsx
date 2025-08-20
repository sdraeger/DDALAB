import React from "react";
import type { UserSelections, ParsedEnvEntry } from "../utils/electron";
import { getFormattedCommentsHtml } from "../utils/electron";

interface SummarySiteProps {
  userSelections: UserSelections;
  parsedEnvEntries: ParsedEnvEntry[]; // To look up comments for display
}

export const SummarySite: React.FC<SummarySiteProps> = ({
  userSelections,
  parsedEnvEntries,
}) => {
  const getCommentsForKey = (key: string): string[] => {
    const entry = parsedEnvEntries.find((e) => e.key === key);
    return entry?.comments || [];
  };

  return (
    <>
      <h2>Summary of Configuration</h2>
      <p>Please review your selections before proceeding.</p>

      <div className="card mb-3">
        <div className="card-header">Setup Type</div>
        <div className="card-body">
          <p className="card-text text-capitalize">
            {userSelections.setupType || "Not selected"}
          </p>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-header">Data Location</div>
        <div className="card-body">
          <p className="card-text">
            <code>{userSelections.dataLocation || "Not specified"}</code>
          </p>
          <small className="text-muted">
            This is where your application data will be stored.
          </small>
        </div>
      </div>

      {userSelections.setupType === "automatic" && (
        <div className="card mb-3">
          <div className="card-header">Project Location</div>
          <div className="card-body">
            <p className="card-text">
              <code>{userSelections.projectLocation || "Not specified"}</code>
            </p>
            <small className="text-muted">
              This is where the DDALAB setup repository will be cloned (contains
              Docker Compose files).
            </small>
          </div>
        </div>
      )}

      <h4>Environment Variables:</h4>
      {Object.keys(userSelections.envVariables).length > 0 ? (
        <table className="table table-sm table-bordered table-striped">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Value</th>
              <th>Description (from .env.example)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(userSelections.envVariables).map(([key, value]) => (
              <tr key={key}>
                <td>
                  <strong>{key}</strong>
                </td>
                <td>
                  <code>{value}</code>
                </td>
                <td>
                  {getCommentsForKey(key).length > 0 ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: getFormattedCommentsHtml(
                          getCommentsForKey(key)
                        ),
                      }}
                    />
                  ) : (
                    <em>No description.</em>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No environment variables configured (or defaults will be used).</p>
      )}
    </>
  );
};
