import React, { useState } from "react";
import type { ElectronAPI as PreloadElectronAPI } from "../../preload";
import type { UserSelections, ParsedEnvEntry, ElectronAPI } from "../utils";
import { getFormattedCommentsHtml } from "../utils";

interface ManualConfigSiteProps {
  userSelections: UserSelections;
  onEnvVariableChange: (key: string, value: string) => void;
  electronAPI: ElectronAPI | undefined;
  parsedEnvEntries: ParsedEnvEntry[];
  setParsedEnvEntries: React.Dispatch<React.SetStateAction<ParsedEnvEntry[]>>;
  onManualSetupCompleted?: (installPath: string) => void;
}

const ManualConfigSite: React.FC<ManualConfigSiteProps> = ({
  userSelections,
  onEnvVariableChange,
  electronAPI,
  parsedEnvEntries,
  setParsedEnvEntries,
  onManualSetupCompleted,
}) => {
  const [selectedInstallDir, setSelectedInstallDir] = useState<string | null>(
    null
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
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
        setSelectedInstallDir(result);
      } else {
        console.log("Directory selection cancelled or no directory selected.");
      }
    } catch (error) {
      console.error("Error showing open dialog:", error);
      setFeedbackMessage({
        type: "error",
        text: "Could not open directory dialog. See console for details.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinishManualSetup = async () => {
    if (!selectedInstallDir) {
      setFeedbackMessage({
        type: "error",
        text: "Please select a DDALAB Install Directory first.",
      });
      return;
    }

    setIsLoading(true);
    setFeedbackMessage(null);

    try {
      if (!window.electronAPI) {
        throw new Error("Electron API (window.electronAPI) not available.");
      }
      const result = await (
        window.electronAPI as PreloadElectronAPI
      ).markSetupComplete(selectedInstallDir);

      if (result.success && result.finalSetupPath) {
        setFeedbackMessage({
          type: "success",
          text: `Manual setup complete! Install directory is set to: ${result.finalSetupPath}. You can now proceed.`,
        });
        if (onManualSetupCompleted) {
          onManualSetupCompleted(result.finalSetupPath);
        }
      } else {
        setFeedbackMessage({
          type: "error",
          text:
            result.message || "An unknown error occurred during finalization.",
        });
      }
    } catch (error: any) {
      console.error("Error finishing manual setup:", error);
      setFeedbackMessage({
        type: "error",
        text:
          error.message ||
          "Failed to communicate with the setup process. See console.",
      });
    } finally {
      setIsLoading(false);
    }
  };

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

      <p className="mt-3">
        2. Optionally, review and adjust any environment variables below. These
        will be saved if you proceed.
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

      <hr />

      <div className="mt-3">
        <p>
          3. Finalize the manual setup. This will save the selected install
          directory.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleFinishManualSetup}
          disabled={!selectedInstallDir || isLoading}
        >
          {isLoading ? "Processing..." : "Finish Manual Setup & Save State"}
        </button>
      </div>

      {feedbackMessage && (
        <div
          className={`mt-3 alert ${
            feedbackMessage.type === "success"
              ? "alert-success"
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

export default ManualConfigSite;
