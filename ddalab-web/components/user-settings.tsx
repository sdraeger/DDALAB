import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/auth-context";

const UserSettings = () => {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light");
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmail(user.email || "");
      setTheme(user.preferences?.theme || "light");
      // Mock for email notifications since it's not in the actual UserPreferences interface
      setEmailNotifications(false);
    }
  }, [user]);

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    // API call would go here in a real implementation
    setSuccessMessage("Profile updated successfully");
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  const handlePreferencesSave = (e: React.FormEvent) => {
    e.preventDefault();
    // API call would go here in a real implementation
    setSuccessMessage("Settings saved successfully");
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  return (
    <div className="user-settings">
      <h1>User Settings</h1>

      <form onSubmit={handleProfileSave}>
        <h2>Profile Information</h2>
        <div>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <button type="submit">Save Profile</button>
      </form>

      <form onSubmit={handlePreferencesSave}>
        <h2>Preferences</h2>

        <div>
          <fieldset>
            <legend>Theme</legend>
            <div>
              <input
                type="radio"
                id="theme-light"
                name="theme"
                value="light"
                checked={theme === "light"}
                onChange={() => setTheme("light")}
              />
              <label htmlFor="theme-light">Light</label>
            </div>

            <div>
              <input
                type="radio"
                id="theme-dark"
                name="theme"
                value="dark"
                checked={theme === "dark"}
                onChange={() => setTheme("dark")}
              />
              <label htmlFor="theme-dark">Dark</label>
            </div>
          </fieldset>
        </div>

        <div>
          <input
            type="checkbox"
            id="email-notifications"
            checked={emailNotifications}
            onChange={(e) => setEmailNotifications(e.target.checked)}
          />
          <label htmlFor="email-notifications">Email Notifications</label>
        </div>

        <button type="submit">Save Preferences</button>
      </form>

      {successMessage && <div className="success">{successMessage}</div>}
    </div>
  );
};

export default UserSettings;
