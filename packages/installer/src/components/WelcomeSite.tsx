import React from "react";
import type { UserSelections } from "../utils/electron";

interface WelcomeSiteProps {
  userSelections: UserSelections;
  onSetupTypeChange: (setupType: "automatic" | "manual") => void;
}

export const WelcomeSite: React.FC<WelcomeSiteProps> = ({
  userSelections,
  onSetupTypeChange,
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onSetupTypeChange(event.target.value as "automatic" | "manual");
  };

  return (
    <>
      <h2>Welcome!</h2>
      <p>This wizard will help you configure DDALAB.</p>
      <p>Choose your setup preference:</p>

      {/* Ensure Bootstrap form-check structure is used */}
      <div className="form-check mb-2">
        <input
          className="form-check-input"
          type="radio"
          name="setupType"
          id="setupTypeAutomatic"
          value="automatic"
          checked={userSelections.setupType === "automatic"}
          onChange={handleChange}
        />
        <label className="form-check-label" htmlFor="setupTypeAutomatic">
          Automatic Setup (Recommended)
        </label>
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
          Manual Setup (For expert users)
        </label>
      </div>

      <hr style={{ margin: "20px 0" }} />
      <p style={{ fontSize: "0.9em" }}>
        This setup wizard is optional. If you are an expert user, you can
        configure the application by directly editing the <code>.env</code> file
        (located in the root directory).
        <br />
        <strong>
          However, only do this if you know what you are doing, as incorrect
          configurations can lead to application errors.
        </strong>
      </p>
    </>
  );
};
