# Smart Reports

![Preview](banner.png)

Smart Reports is a Lovelace card with three focused views:

- historical energy and cost reporting from Home Assistant Recorder statistics;
- automation status and recent activity from `automation.*` entities;
- entity/domain health from the current Home Assistant state registry.

[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.1+-blue.svg?logo=homeassistant)](https://www.home-assistant.io/) [![Version](https://img.shields.io/github/v/release/MacSiem/ha-smart-reports)](https://github.com/MacSiem/ha-smart-reports/releases) [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Part of the [HA Tools](https://github.com/MacSiem) ecosystem.

## Energy data model

The Energy tab never estimates history from current entity states and never
discovers sensors by matching words in entity IDs. It reads Recorder
`change` statistics for an exact local-calendar window in
`hass.config.time_zone`.

The default source mode is `dashboard`:

1. `energy/get_prefs` supplies the grid-import, cost and device statistic IDs
   already configured in Home Assistant Energy.
   Current device entries use their `name` as the display label. If any grid
   source has no direct `stat_cost`, `energy/info` is queried only to fill
   those missing mappings; a direct cost source is never replaced.
2. Grid/root sources alone form the headline household total.
3. Device sources appear only in the breakdown. A source with
   `included_in_stat` is nested under its parent and is not ranked as a second
   top-level consumer.

Use `explicit` mode when the report should use a different declared set of
statistics. Total, device and cost roles are intentionally separate:

```yaml
type: custom:ha-smart-reports
energy_source_mode: explicit
energy_total_statistics:
  - sensor.grid_import_energy
energy_device_statistics:
  - statistic_id: sensor.heat_pump_energy
    label: Heat pump
  - statistic_id: sensor.heat_pump_indoor_energy
    label: Indoor unit
    included_in_stat: sensor.heat_pump_energy
energy_cost_statistics:
  - sensor.grid_import_cost
```

The legacy `energy_entity` option remains a compatibility alias for one
explicit total statistic when `energy_total_statistics` is empty. It does not
enable discovery or a live-state fallback.

### Report views and charts

Energy has **Summary**, **Devices**, and **Costs** views of one recorded snapshot.
Summary shows consumption, cost, source counts and daily history. Devices shows
kWh bars with each device's own coverage. Costs shows the cost samples and their
own time range. Switching views does not request statistics again.

Daily bars use local calendar dates, including DST days. Striped days have
incomplete history; empty days are not measured zero. Device values may have
different coverage, and nested devices remain included in their parent.

The visual editor offers Energy Dashboard or Explicit statistics and separate
total/device/cost IDs. Existing labels and parent relationships remain intact
when their IDs remain selected. Advanced relationships and a flat-rate estimate
can also be declared in YAML. Names come from configured labels, HA friendly
names or statistic metadata; live entity values never supply energy numbers.

The same period and source selection remain visible during refresh. Unchanged
results retain their content DOM. A new period or source selection clears old
values while loading; errors never export stale data.

### Accuracy and unavailable data

- Recorder metadata must declare a sum-capable energy statistic. Power and
  unknown/no-sum sources are rejected. `unit_class: energy` is required when
  present; exact `Wh`/`kWh`/`MWh` is the compatibility fallback only when the
  metadata has no unit class.
- Exact `Wh`, `kWh` and `MWh` units are normalized to kWh. String numerics,
  non-finite values, negative import changes, gaps and overlaps are not
  silently repaired.
- Today, 7-day and 30-day periods start at local midnight. DST days may be 23
  or 25 hours.
- The report ends at the last completed UTC hour shown in its range and exports.
  Missing boundary buckets remain partial; Today has no data until its first completed hour.
- If a required source is incomplete, invalid or has no samples,
  the complete energy total is withheld instead of being shown as zero.
  **Recorded consumption** separately shows only validated samples that exist,
  with source counts and coverage. It is not a complete household total.
  Cost samples appear separately as **Recorded cost** with their own range,
  including when the combined complete report cost is unavailable.
- The card distinguishes loading, not configured, unsupported, permission
  denied, request error, no data, partial data and ready states.

### Cost provenance

Configured cost statistics take precedence and are labeled **Actual cost**.
Their metadata unit must exactly match Home Assistant's configured currency
(`hass.config.currency`); volume, power, energy, mixed and foreign-currency
statistics are withheld.
If no cost statistics are configured, an estimate is available only when both
an explicit finite non-negative `energy_price` and a `currency` are supplied:

```yaml
type: custom:ha-smart-reports
energy_source_mode: dashboard
energy_price: 0.42
currency: PLN
```

There is no default tariff. A zero rate is valid and remains zero.
Recorded cost can cover a shorter period than energy. The current tariff is
not multiplied by past partial energy; a flat-rate estimate still requires a
complete energy total.

## Automations and System

The Automations tab keeps the live operational overview: total, active,
disabled, triggered-today counts and up to ten automation entries ordered by
last trigger. A missing or invalid last-trigger timestamp is shown as **Never**.
**Triggered today** counts automations whose last trigger is between midnight
in Home Assistant's configured time zone and now, excluding future timestamps;
it does not count every trigger event or use a rolling 24-hour window.
The System tab shows entity/domain counts, unavailable/unknown states and availability
percentages. These two tabs are current-state summaries; the Energy period
selector does not change them.

## Export

Energy exports are generated locally in the browser:

- JSON uses `schema_version: 2` and includes period range, timezone, overall
  status, source mode, warnings, per-source total/cost evidence and device
  relationships.
- CSV is flat (one aggregate/source/device metric per row), retains source
  status/provenance/reason, contains no nested JSON and neutralizes
  formula-leading labels before download.

Export is disabled while a request is loading or failed, so an older period
cannot be downloaded as if it were current.

## Screenshots

The previews below use a deterministic, fully synthetic Recorder fixture. They
contain no production entity names, account data, addresses, network details,
tokens or household history.

| Light | Dark | Narrow |
|---|---|---|
| ![Smart Reports light theme with synthetic Recorder data](docs/screenshots/card-report-light.png) | ![Smart Reports dark theme with synthetic Recorder data](docs/screenshots/card-report-dark.png) | ![Smart Reports narrow layout with synthetic Recorder data](docs/screenshots/card-report-narrow.png) |

[`docs/screenshots/manifest.json`](docs/screenshots/manifest.json) binds every
image to the exact `ha-smart-reports.js` SHA-256, fixed clock, locale, timezone
and browser build. The local screenshot gate renders every variant twice,
requires byte-identical PNG output, blocks non-loopback requests, rejects PNG
metadata, checks horizontal overflow and runs OCR privacy checks.

## Installation

### HACS default catalog

Smart Reports is included in the **HACS default catalog** as a Dashboard plugin. No custom repository is needed:

1. Open HACS and search for **Smart Reports**.
2. Download the latest stable version and reload your browser.
3. Add `custom:ha-smart-reports` to your dashboard.

When upgrading, use the update offered by HACS and reload your browser to load the new JavaScript. Existing card configuration, source selections and labels are retained. The optional support dismissal remains local to the browser.

### Compatibility

Requires Home Assistant **2024.1.0** or newer. The minimum is qualified against the Core and frontend API contracts shipped with that version; existing live installation and UI checks used current Home Assistant, rather than a separate 2024.1.0 instance.

Dashboard source selection uses `energy/get_prefs`; explicit selection works from configured statistic IDs without Energy Dashboard discovery. Recorder reads use `recorder/get_statistics_metadata` and `recorder/statistics_during_period` with `period: hour` and `types: [change]`. All these commands and request fields exist in Core 2024.1.0. Older metadata uses `unit_of_measurement`; newer `statistics_unit_of_measurement` is optional. Unit class, source labels and nested-device relationships are used when present, with documented fallbacks otherwise.

The optional `energy/info` lookup fills only missing generated-cost mappings. It also exists in Core 2024.1.0; unavailable mappings do not fabricate costs or replace explicit cost sources. Permission errors remain visible. Energy Dashboard and valid Recorder sum statistics determine data availability; the card's minimum does not guarantee complete retained history.

Automation and system views read the `hass.states` object supplied to Lovelace. Theme, locale, timezone, currency and administrator visibility use the frontend's custom-card contract. The editor uses standard DOM controls and the `config-changed` event. Charts use local DOM and CSS, with no chart library or CDN. Use a browser supported by your Home Assistant frontend.

Smart Reports does not require the HA Tools Email integration, SMTP or any optional email backend. Email scheduling and sending belong to the separate Email products.

### Custom repository (alternative)

1. Open HACS → Frontend (Dashboard) → ⋮ → **Custom repositories**.
2. Add `https://github.com/MacSiem/ha-smart-reports` with category
   **Dashboard**.
3. Install **Smart Reports** and reload the browser.

### Manual

1. Download `ha-smart-reports.js` from the latest release.
2. Copy it to `/config/www/community/ha-smart-reports/`.
3. Add `/local/community/ha-smart-reports/ha-smart-reports.js` as a Lovelace
   module resource.

## Quick start

```yaml
type: custom:ha-smart-reports
```

This uses the Home Assistant Energy Dashboard configuration. If the Energy
Dashboard has no grid-import statistic, the card shows a configuration state
and links to `/config/energy`; it does not guess a sensor.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | string | `Smart Reports` | Card heading. |
| `energy_source_mode` | `dashboard` or `explicit` | `dashboard` | Exact source-selection policy. |
| `energy_total_statistics` | list | empty | Explicit root total statistic IDs. |
| `energy_device_statistics` | list | empty | Explicit device objects/IDs; objects may include `label` and `included_in_stat`. |
| `energy_cost_statistics` | list | empty | Explicit actual-cost statistic IDs. |
| `energy_entity` | string | none | Legacy one-total compatibility alias in explicit mode. |
| `energy_price` | number ≥ 0 | none | Explicit flat estimate rate per kWh. |
| `currency` | string | none | Required with `energy_price`. |
| `show_energy` | boolean | `true` | Show the Energy tab. |
| `show_automations` | boolean | `true` | Show the Automations tab. |
| `show_system` | boolean | `true` | Show the System tab. |
| `show_support` | boolean | `true` | Show the optional support link to administrators unless dismissed. |

The visual editor exposes Title, Currency, source mode and separate total,
device and cost statistic IDs. Tab selection is local to each card instance. If all three `show_*` flags are false, the card shows a
configuration message and performs no Home Assistant data requests.

## Privacy and limitations

The card uses Home Assistant's same-origin WebSocket API and the state object
already provided to Lovelace. It has no telemetry, analytics, remote fonts or
CDN dependency. Support links open only when clicked and use `noopener` and
`noreferrer`.

JSON/CSV exports are built locally and are not uploaded by the card. They can
contain the configured statistic IDs, display labels, report window, warnings
and measured values, so review an export before sharing it outside your Home
Assistant environment. The card never stores credentials, SMTP settings or
Home Assistant access tokens.

Recorder retention and source metadata determine how much historical energy
data is available. Smart Reports is an on-demand dashboard/export card; it
does not schedule or email reports.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Support

- [Buy Me a Coffee](https://buymeacoffee.com/macsiem)
- [PayPal](https://www.paypal.com/donate/?hosted_button_id=Y967H4PLRBN8W)

The optional in-card support link is shown only to administrators. Dismiss it
in the card or set `show_support: false` in the card configuration. Dismissal
is stored in browser local storage and shared by Smart Reports cards on the
same Home Assistant origin when storage is available.

## License

MIT, see [LICENSE](LICENSE).

### Additional recorded fields in exports

JSON schema2 retains the meanings of complete `total.value` and `cost.value`.
It adds `recorded_total`, `recorded_cost`, source/device `recorded_value` and
`coverage`, and `daily` history. Unavailable complete totals remain null.
CSV retains the flat header and adds distinctly named recorded/day/coverage
rows. Total, cost and device roles remain separate; adding them together would
count devices twice. Formula-leading labels remain neutralized.
