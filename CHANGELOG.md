# Changelog — Smart Reports

All notable changes to **Smart Reports** are documented here.

## [4.3.0] - 2026-10-21

- Add an optional HA Energy calendar report with day, week, month and year periods; selected comparisons, room/floor/device views, measured coverage, historical rates and separate fixed fees use one authorized server snapshot.
- Keep standalone Recorder statistics independent; calendar permission failures never substitute another data source. Confirm feature access through a secured update subscription before reading, and invalidate data and export previews when access changes.
- Review complete calendar JSON/CSV exports locally with aliases by default, explicit private-field consent and the historical rate versions used in the calculation.
- Add Tile, Compact and Full layouts, an initial tab and an optional full report window. Compact shows measured energy and cost comparisons with their own coverage; partial cost comparisons remain separate from whole-period bills.
- Fit Tile in a native dashboard row with a themed icon and one accessible action. Preserve tiny nonzero amounts and focus when returning from the full report. Keep the full report width on narrow screens, restore the current opener after HA closes its window, and wrap whole tab buttons without splitting labels.
- Reset an unsupported comparison when switching calendar periods, so returning from a year-ago report to Day keeps the report and date controls usable.
- Add native dashboard destination previews and one explicit save, with confirmed readback and exact session Undo. Keep confirmation through an own card remount; refuse overwrite after another dashboard edit or an unconfirmed write.
- Explain sources, gaps, costs, comparisons and exports in optional Polish/English full-view help. Bind delayed dialog close events to their original window when HA reuses the native owner.

## [4.2.0] - 2026-10-15

- Clear accepted measurements and device details immediately when the Home Assistant user, connection or timezone changes, including disconnection; preserve current measurements on locale and theme changes.

- Keep device search directly below its view tabs; retain the unfiltered report total and all detailed comparison values below the results.

- Keep a validated comparison currency when current cost hours are missing; show incomplete history rather than an incompatible-currency error, without inventing totals or percentages.

- Keep current values and report tabs above comparison details; show previous amounts beside headline values and use compact paired daily bars. Full ranges and hourly evidence stay available in expandable details.
- Clarify the optional shared-tariff backend floor and the update requirement when Email & Reports also provides the Smart card.

- Add an opt-in equivalent previous-period comparison with both ranges, source scope, timezone and coverage; withhold percentages when the periods cannot be compared.
- Search device names and statistic IDs locally without changing report totals or the complete export.
- Show Chart/Data views from the same measured snapshot, with explicit gaps and calendar boundaries.
- Price measured hourly energy against configured tariffs, preserving custom schedules, zero rates and separate variable/fixed charges; never assume missing measurements or hypothetical savings.
- Review JSON/CSV filename, scope, private-field consent and exact content before downloading. Keep aliases by default and preserve the complete reviewed report in CSV.
- Keep the native export dialog stable during report updates and invalidate stale previews after source, identity or connection changes.

## [4.1.2] - 2026-10-11

- Show Energy configuration guidance when Home Assistant reports that Energy Dashboard preferences do not exist, instead of a statistics loading error.
- Preserve Retry for other preference failures and Recorder errors; unconfigured reports keep unavailable values and disabled exports.

## [4.1.1] - 2026-10-08

- Correct the published 4.1.0 release date and document installation from the HACS default catalog, with custom repository setup kept separately.
- Explain the Home Assistant 2024.1.0 API compatibility contract, optional cost mapping and local frontend dependencies.
- Preserve card behavior; this maintenance release changes documentation and version metadata only. Screenshot provenance is refreshed for this exact source.

## [4.1.0] - 2026-10-05

- Restore useful recorded consumption/cost summaries even with incomplete history, keeping complete totals separate and exposing source coverage.
- Add Summary, Devices and Costs views, daily energy history, device kWh bars and current system domain bars.
- Show friendly names, exact local hours and each cost source's own coverage and recorded range.
- Keep the settled report visible during same-period refresh and preserve its DOM when data is unchanged; clear old values when source selection changes.
- Expose dashboard/explicit source selection in the visual editor while preserving advanced references.
- Extend JSON/CSV with recorded values, daily history and coverage; never fabricate a tariff or treat gaps as zero.
- Keep independently complete recorded costs available when energy history is incomplete.

## [4.0.1] - 2026-10-04

- Translate the report views, status messages and editor into Polish using the Home Assistant profile language; update the selected view on language changes while preserving the report period, data and export schema.

- Show an automation with no last-trigger timestamp as Never instead of displaying an age from the Unix epoch.
- Count automations whose last trigger is since midnight in Home Assistant's configured time zone, including long DST days, and exclude future timestamps.
- Keep status colors readable on the rendered Home Assistant card background, including dark custom themes whose dark mode flag is false and theme changes after reconnecting.
- Stop treating missing first/last Recorder buckets or a bucket crossing the requested boundary as a complete period total.
- End calendar reports at the last completed UTC hour, retain that exact cutoff in exports, and show no data before Today's first completed hour.
- Keep the report card at its natural height in Home Assistant Sections, including empty states and longer evidence text.
- Replace the prominent support panel with one optional, dismissible link visible only to administrators.

## [4.0.0] - 2026-09-01

### Changed
- Energy reports now use exact Home Assistant Energy Dashboard or explicit Recorder statistic IDs; live-state substring discovery and the fabricated default tariff were removed.
- Today, 7-day and 30-day reports now use local-calendar Recorder `change` windows with explicit partial/no-data/error states and DST-safe boundaries.
- Headline totals now include root total sources only; device and `included_in_stat` relationships are kept in a separate nested breakdown.
- Cost now reports actual configured cost statistics first, otherwise an explicitly configured flat-rate estimate, with provenance shown in the UI and exports.
- JSON export now uses schema version 2; CSV is flat and neutralizes formula-leading labels.
- Schema-v2 JSON and CSV now retain per-source status, provenance and reasons. JSON also retains report warnings; partial results show the same evidence in the UI.
- Dashboard parsing now supports current Energy preference names and fills only missing grid cost mappings without replacing direct cost sources.
- The visible period context now uses readable local-calendar dates while preserving the exact Recorder start/end timestamps as element metadata and export fields.

### Fixed
- Added latest-request-wins generation guards, a single coalescing timer, disconnect cleanup, reattach safety and per-instance isolation.
- Dynamic statistic labels are rendered with DOM text APIs.
- Energy/cost metadata is role-aware, cost currency must match Home Assistant, invalid total relationships and out-of-window buckets fail closed, and tab state is instance-local.
- Restored safe visual-editor fields for Title and Currency; disabling all sections now produces a request-free configuration state.
- A statistic reused in more than one role is still fetched once, but now keeps separate, complete total/device/cost summaries in the UI and exports.

### Testing
- Added pinned jsdom behavior suites for source selection, units, DST, gaps, cost, lifecycle, safe rendering and export.
- Added source-bound light, dark and narrow screenshot gates with fixed synthetic data, offline rendering, byte-determinism, overflow checks, PNG metadata rejection and OCR privacy checks.

## [3.4.0] - 2026-06-27

### Changed
- Standalone repository now ships only the Smart Reports viewer card. The bundled `ha-log-email` card was removed; use the dedicated `ha-log-email` / `ha-energy-email` cards with the **HA Tools Email** integration for emailed reports.
- Theme: dark/light now follows the active Home Assistant theme (luminance of `--card-background-color`) instead of the OS color-scheme preference, matching the rest of the HA Tools cards.

### Added
- `validate` CI workflow (node --check, theming invariant, focus-visible a11y) and a `:focus-visible` outline for keyboard navigation.

### Fixed
- The energy summary badge was hardcoded in Polish ("N sensorów kWh"); it now renders in English ("N kWh sensor(s)").

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
