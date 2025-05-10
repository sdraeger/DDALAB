import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const rootElement = document.getElementById("site-content");

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error(
    "CRITICAL: site-content element not found in installer.html. Installer UI cannot be rendered."
  );
  // Fallback: Display a prominent error message if the crucial div is missing.
  const errorDiv = document.createElement("div");
  errorDiv.style.padding = "20px";
  errorDiv.style.textAlign = "center";
  errorDiv.style.color = "red";
  errorDiv.innerHTML =
    "<h1>Application Error</h1><p>Installer UI components could not be loaded. The required 'site-content' element is missing from the HTML structure. Please check the installer.html file and ensure the application is correctly built.</p>";
  document.body.appendChild(errorDiv);
}
