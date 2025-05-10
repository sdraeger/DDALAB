import React, { useState, useEffect } from "react";
import type { UserSelections, ParsedEnvEntry, ElectronAPI } from "../utils";
import { getFormattedCommentsHtml } from "../utils"; // Using the string version

interface ManualConfigSiteProps {
  userSelections: UserSelections;
  onEnvVariableChange: (key: string, value: string) => void;
  electronAPI: ElectronAPI | undefined;
  parsedEnvEntries: ParsedEnvEntry[];
  setParsedEnvEntries: React.Dispatch<React.SetStateAction<ParsedEnvEntry[]>>;
}

const ManualConfigSite: React.FC<ManualConfigSiteProps> = ({
  userSelections,
  onEnvVariableChange,
  electronAPI,
  parsedEnvEntries,
  setParsedEnvEntries,
}) => {
  // Simplified loading/error states - primarily relies on App.tsx providing valid props.
  if (!parsedEnvEntries) {
    // parsedEnvEntries might initially be undefined from App.tsx state
    return <p>Loading configuration options...</p>;
  }

  if (parsedEnvEntries.length === 0) {
    return (
      <p>
        No environment variables to configure. This might indicate an issue with
        the bundled default .env.example or the loading process.
      </p>
    );
  }

  return (
    <>
      <h2>Manual Configuration</h2>
      <p>
        Please provide values for the following variables. Descriptions are
        based on the <code>.env.example</code> file.
      </p>
      <form>
        {parsedEnvEntries.map(({ key, value: defaultValue, comments }) => (
          <div className="mb-3 env-variable-item" key={key}>
            <label htmlFor={`env-${key}`} className="form-label">
              <strong>{key}</strong>
            </label>
            <input
              type="text"
              className="form-control form-control-sm"
              id={`env-${key}`}
              value={userSelections.envVariables[key] || ""} // Use current value or empty string
              onChange={(e) => onEnvVariableChange(key, e.target.value)}
              placeholder={defaultValue} // Show original default as placeholder
            />
            {comments && comments.length > 0 && (
              <div
                className="form-text variable-description mt-1"
                dangerouslySetInnerHTML={{
                  __html: getFormattedCommentsHtml(comments),
                }}
              />
            )}
          </div>
        ))}
      </form>
    </>
  );
};

export default ManualConfigSite;
