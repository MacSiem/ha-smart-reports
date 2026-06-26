# Changelog — Smart Reports

All notable changes to **Smart Reports** are documented here.

## [3.4.0] - 2026-06-26

### Changed
- Standalone repository now ships only the Smart Reports viewer card. The bundled `ha-log-email` card was removed; use the dedicated `ha-log-email` / `ha-energy-email` cards with the **HA Tools Email** integration for emailed reports.

## [3.3.0] - 2026-06-12

### Added
- Bundled `custom:ha-log-email` into `ha-smart-reports.js` with guarded custom element registration and `getGridOptions()`.
- Added progressive support for HA Tools Email v2.0.0 websocket commands: `get_config`, `list_schedules`, `set_schedule`, and `send_now`.
- Added server-side log digest schedule management when the backend is available, with legacy localStorage schedule fallback when it is not.

### Changed
- SMTP status now uses backend `smtp_configured` when the websocket API is present, while preserving legacy `ha_tools_email` service and `notify.*` fallback paths.
- Updated console/version metadata to v3.3.0.

## [3.2.0] - 2026-06-12

### Changed
- Added dual-mode defaults so the primary Smart Reports card works when `setConfig()` is not called.
- Added `getGridOptions()` for full-width dashboard rendering.
- Improved render error handling with a visible fallback message.

## [3.1.2] - 2026-05-12

### Fixed
- Added `_esc(...)` helper and wrapped user-derived interpolations in render templates (entity friendly names, automation names).
- Added LICENSE file.
- `hacs.json` now declares minimum Home Assistant version (`2024.1.0`).

## [3.1.1] - 2026-05-12

### Changed
- Internal release readiness improvements.

## [3.1.0] - 2026-03-19

### Added
- Initial public release.
