import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { engine, openSynthetic, refreshRecent } from "./app/recordings";
import { useStore } from "./store/store";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

// Dev and e2e builds let tests reach the engine and the store.
if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
  Object.assign(window, { __ddalab: { engine, store: useStore, openSynthetic } });
}
void refreshRecent();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
