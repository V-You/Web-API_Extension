import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerAllTools } from "../src/webmcp/register-tools";

// Register WebMCP tools with retry (handles async navigator.modelContext injection)
registerAllTools();

// Tab-close job pausing is handled directly by the service worker (sw-job-executor).
// The side panel monitors job state via chrome.storage change events (see job-runner.ts).

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
