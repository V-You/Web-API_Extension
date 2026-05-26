# Changelog

## 0.1.2 (2026-05-26)

### Added
- Gateway governance: optional MCP gateway integration for centralized policy evaluation and telemetry
- Correlation ID propagation for auditable tool execution chains
- Job lifecycle telemetry (start, completion, failure tracking)
- Gateway probe UI with policy/telemetry health status indicators
- Terminal telemetry awaiting (1s timeout cap) for reliable audit guarantees

### Changed
- PIN semantics: gateway token no longer forces app-level PIN gate; gateway-only access now independent
- API client: awaits terminal telemetry instead of fire-and-forget pattern
- 401 handling: token lockout preserves encrypted local token, marks session invalid for graceful recovery

### Fixed
- Credential detection: `hasStoredCredentials()` now checks actual secure storage buckets instead of PIN flag

## 0.1.1

Initial release with WebMCP tool registration, sandbox execution, and side panel UI.
