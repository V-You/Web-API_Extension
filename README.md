# Web API Extension

**Web API Extension** is a Chrome extension that lets ACI customers operate their payment SaaS (BIP or POPP) through its Web API (also known as Merchant Onboarding API) without needing a standalone MCP server. It uses WebMCP for in-browser tool publication, UTCP for efficient tool orchestration, and code mode for local script execution -- representing the most modern, fastest, and most secure approach to SaaS automation via API.

The extension replaces the legacy "Web API MCP Server" with a browser-native, zero-infrastructure alternative that uses the active SaaS tab for context binding, executes logic locally, and minimizes data exposure to external LLM providers.

[screenshots]

## Overview

- **Exposes the full Web API** to any WebMCP-compatible AI agent running in Chrome.
- **Automates the SaaS via its API** using only a browser extension: no backend proxy, no MCP server, no external credential files or secret stores.
- **>90% context-window reduction** compared to the legacy MCP approach by using type-on-demand discovery and code-mode execution.
- Transferable showcase: Architecture works for any SaaS with a keyed-property API.

### Non-goals

- Does not replace the Saa dashboard UI for human-only workflows.
- Does not support offline or disconnected operation.
- No mobile browser support.
- No multi-tenant or multi-PSP profile switching (deferred).
- No built-in LLM or chat UI. The extension is a tool provider, not an agent host. BYOK support.

## ...

...






--- 

**License**

This software is licensed under **Creative Commons BY-NC-SA 4.0** for non-commercial use only. To use this software for commercial purposes, you must purchase a commercial license. Contact the author to purchase a license.