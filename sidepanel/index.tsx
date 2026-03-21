import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerAllTools } from "../src/webmcp/register-tools";

// Register WebMCP tools (no-op if navigator.modelContext is absent)
registerAllTools();

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
