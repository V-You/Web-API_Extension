# Version 2 notes

Deferred from v1:

- **Detailed progress trace** -- per-call live log streaming during job execution.
- **Undo / rollback** for setting changes.
- **Diff view** for setting changes (before/after comparison).
- **Operation blocking in Prod** -- option to block specific operations (e.g. entity deletion).
- **Approval workflow** for bulk Prod operations.
- **`chrome.identity` OAuth2** as an alternative to PIN-encrypted credentials.
- **Support diagnostics export** -- anonymized logs, extension version, Chrome version, connection status.
- **DataLake-style cached reporting** -- replaced by long-running live queries in v1.
- **Desktop-agent bridge** -- WebSocket to `localhost` for non-browser agents.
- **Other browsers** -- Edge, Brave (depends on WebMCP adoption).
- **Data redaction** -- configurable rules for entity names, IDs, emails, commercial data.
- **Summary-only mode** -- LLM never sees raw API responses, only aggregated counts.
- **Profile switching** -- multiple PSP roots in a single extension instance.