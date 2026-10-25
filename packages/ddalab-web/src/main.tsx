import "./styles/tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { engine, openSynthetic, refreshRecent } from "./app/recordings";
import { useStore } from "./store/store";
import { applyTheme, storedTheme } from "./styles/theme";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

// Dev and e2e builds let tests reach the engine and the store.
if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
  Object.assign(window, { __ddalab: { engine, store: useStore, openSynthetic } });
}
void refreshRecent();
// Before React renders: the CSP allows no inline script, and the module entry is the earliest script there is.
applyTheme(storedTheme());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
