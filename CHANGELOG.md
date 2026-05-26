# Changelog

## 0.1.2 (2026-05-26)

### Added
- Governance: optional MCP gateway integration for central auth & telemetry
- Correlation ID propagation for auditable tool execution chains
- Job lifecycle telemetry (start, completion, failure tracking)
- UI for the above, plus probe & health indicators
- 1s timeout cap

### Changed
- PIN: extension can now be used without API, so middleware-only
- API client: awaits terminal telemetry instead of fire-and-forget
- 401 handling: token is kept (can be reactivated), but session invalidated

### Fixed
- Credential detection: now checks storage buckets instead of PIN flag

## 0.1.1 (2026-05-15)

Webstore release with WebMCP tool registration, sandbox, side panel.

## 0.1.0 (2026-03-23)

Initial release.