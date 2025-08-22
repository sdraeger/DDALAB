import React, { useState } from "react";
import type {
  UserSelections,
  ParsedEnvEntry,
  ElectronAPI,
} from "../utils/electron";
import { getFormattedCommentsHtml } from "../utils/electron";
import { logger } from '../utils/logger-client';

interface ManualConfigSiteProps {
  userSelections: UserSelections;
  onEnvVariableChange: (key: string, value: string) => void;
  onUpdateSelections: (selections: Partial<UserSelections>) => void;
  electronAPI: ElectronAPI | undefined;
  parsedEnvEntries: ParsedEnvEntry[];
  setParsedEnvEntries: React.Dispatch<React.SetStateAction<ParsedEnvEntry[]>>;
  onManualSetupCompleted?: (installPath: string) => void;
}

export const ManualConfigSite: React.FC<ManualConfigSiteProps> = ({
  userSelections,
  onEnvVariableChange,
  onUpdateSelections,
  electronAPI,
  parsedEnvEntries,
  setParsedEnvEntries,
  onManualSetupCompleted,
}) => {
  // Use dataLocation from userSelections instead of local state
  const selectedInstallDir = userSelections.dataLocation;
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error" | "warning";
    text: string;
  } | null>(null);

  const handleSelectDirectory = async () => {
    setFeedbackMessage(null);
    setIsLoading(true);
    try {
      const api = window.electronAPI || electronAPI;
      if (!api) {
        throw new Error("Electron API not available.");
      }
      const result = await api.selectDirectory();
      if (result) {
        onUpdateSelections({ dataLocation: result });

        // Load environment variables from the selected directory
        logger.info(
          "[ManualConfigSite] Loading ENV vars from selected directory:",
          result
        );
        try {
          const entries = await api.loadEnvVars(result);
          if (entries) {
            logger.info(
              "[ManualConfigSite] Loaded ENV vars from manual setup directory:",
              entries
            );
            setParsedEnvEntries(entries);

            // Update the user selections with the loaded values
            const loadedVars: { [key: string]: string } = {};
            entries.forEach((entry: ParsedEnvEntry) => {
              loadedVars[entry.key] = entry.value;
            });

            // Update all variables at once to avoid race conditions
            logger.debug(
              "[ManualConfigSite] Loading variables:",
              Object.keys(loadedVars)
            );
            logger.debug(
              "[ManualConfigSite] Current envVariables:",
              userSelections.envVariables
            );

            // Use bulk update to set all environment variables at once
            onUpdateSelections({
              envVariables: { ...userSelections.envVariables, ...loadedVars },
            });

            logger.debug(
              "[ManualConfigSite] Updated envVariables with:",
              loadedVars
            );

            setFeedbackMessage({
              type: "success",
              text: `Environment variables loaded from ${result}/.env`,
            });
          } else {
            logger.info(
              "[ManualConfigSite] No .env file found in selected directory"
            );
            setFeedbackMessage({
              type: "success",
              text: `Directory selected: ${result}. No .env file found - you can configure variables manually.`,
            });
          }
        } catch (envError: any) {
          logger.error(
            "[ManualConfigSite] Error loading env vars from selected directory:",
            envError
          );
          setFeedbackMessage({
            type: "error",
            text: `Directory selected but failed to load environment variables: ${envError.message}`,
          });
        }
      } else {
        logger.info("Directory selection cancelled or no directory selected.");
      }
    } catch (error) {
      logger.error("Error showing open dialog:", error);
      setFeedbackMessage({
        type: "error",
        text: "Could not open directory dialog. See console for details.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <h2>Manual Configuration</h2>
      <p>
        Please provide values for the following variables. Descriptions are
        based on the <code>.env</code> file from your selected directory.
      </p>
      <div className="mb-3">
        <p>
          1. Select your existing DDALAB Install Directory (the one containing
          your <code>docker-compose.yml</code> file).
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm me-2"
          onClick={handleSelectDirectory}
          disabled={isLoading}
        >
          {isLoading ? "Loading..." : "Select DDALAB Install Directory"}
        </button>
        {selectedInstallDir && (
          <p className="mt-2">
            Selected Directory: <code>{selectedInstallDir}</code>
          </p>
        )}
      </div>

      {parsedEnvEntries && parsedEnvEntries.length > 0 ? (
        <>
          <p className="mt-3">
            2. Review and adjust any environment variables below. These will be
            saved if you proceed.
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
                  value={userSelections.envVariables[key] || ""}
                  onChange={(e) => onEnvVariableChange(key, e.target.value)}
                  placeholder={defaultValue}
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
      ) : (
        <div className="mt-3">
          <p className="text-muted">
            {selectedInstallDir
              ? "No environment variables found. You can proceed to finalize the setup."
              : "Please select a directory first to load environment variables."}
          </p>
        </div>
      )}

      <div className="mt-3">
        <p className="text-info">
          <i className="fas fa-info-circle"></i> Click "Next" to proceed with
          the setup validation.
        </p>
      </div>

      {feedbackMessage && (
        <div
          className={`mt-3 alert ${
            feedbackMessage.type === "success"
              ? "alert-success"
              : feedbackMessage.type === "warning"
              ? "alert-warning"
              : "alert-danger"
          }`}
          role="alert"
        >
          {feedbackMessage.text}
        </div>
      )}
    </>
  );
};
