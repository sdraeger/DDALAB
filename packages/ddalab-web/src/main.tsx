import "./styles/tokens.css";
import "./styles/base.css";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { sweepAnalyses } from "./app/analyses";
import { engine, openInput, openSynthetic, refreshRecent } from "./app/recordings";
import { flushTabs, restoreTabs } from "./app/tabs";
import { heatmapProbe } from "./features/results/probe";
import { viewerProbe } from "./features/viewer/probe";
import { restoreSession } from "./store/session";
import { useStore } from "./store/store";
import { applyTheme, storedTheme } from "./styles/theme";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

// Dev and e2e builds let tests reach the engine and the store.
if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
  Object.assign(window, {
    __ddalab: {
      engine,
      store: useStore,
      open: openInput,
      openSynthetic,
      viewer: viewerProbe,
      results: heatmapProbe,
      tabs: { flush: flushTabs },
    },
  });
}
void refreshRecent();
const listed = sweepAnalyses();
restoreSession(listed);
void restoreTabs(listed);
// Before React renders: the CSP allows no inline script, and the module entry is the earliest script there is.
applyTheme(storedTheme());

// The CSP allows no inline <style>, which Base UI adds to an opened Select unless told otherwise.
createRoot(root).render(
  <StrictMode>
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </StrictMode>,
);
