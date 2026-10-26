import "./styles/tokens.css";
import "./styles/base.css";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { StrictMode } from "react";
import { preconnect } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { sweepAnalyses } from "./app/analyses";
import { engine, openInput, openSynthetic, refreshRecent } from "./app/recordings";
import { flushTabs, restoreTabs } from "./app/tabs";
import { registerWorker } from "./app/update";
import { loadViewer } from "./app/viewerChunk";
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
// A deep link opens through the OpenNeuro panel: its chunk starts loading with the entry, before the rail first renders,
// and the connections to OpenNeuro's API and to S3 open while it does. LibraryRail reports a chunk that fails to load.
if (location.search.includes("openneuro=")) {
  import("./features/openneuro/OpenNeuroPanel").catch(() => {});
  preconnect("https://openneuro.org", { crossOrigin: "anonymous" });
  preconnect("https://s3.amazonaws.com", { crossOrigin: "anonymous" });
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
// The viewer's chunk loads once the shell has painted: on a cold cache a recording opened later finds it in place,
// where waiting for it beside the open would hold back the first waveform.
requestAnimationFrame(() => setTimeout(() => loadViewer().catch(() => {})));
// The service worker keeps the app for offline use. Dev and e2e builds register none: the e2e tests drive the page as
// served, and a worker would answer from a cache of an earlier build.
if (import.meta.env.MODE === "production") registerWorker();
