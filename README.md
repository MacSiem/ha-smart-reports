# 📈 Smart Reports

Lovelace card with energy reports, automation statistics and system health overview for Home Assistant.

[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.1+-blue.svg?logo=homeassistant)](https://www.home-assistant.io/) [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Part of the [HA Tools](https://github.com/MacSiem/ha-tools-panel) collection for Home Assistant.

## Screenshot

![Screenshot](screenshot.png)

## Installation

### HACS (custom repository)

1. Open HACS in Home Assistant.
2. Go to **Frontend** → ⋮ → **Custom repositories**.
3. Add `https://github.com/MacSiem/ha-smart-reports` with category **Lovelace**.
4. Install **Smart Reports** and restart Home Assistant.

### Manual

1. Download `ha-smart-reports.js` from the [latest release](https://github.com/MacSiem/ha-smart-reports/releases).
2. Copy to `/config/www/community/ha-smart-reports/`.
3. Add as a Lovelace resource: `/local/community/ha-smart-reports/ha-smart-reports.js` (type: `module`).

## Usage

```yaml
type: custom:ha-smart-reports
```

## Bundled Log Email Card

This release also bundles **Log Email Summary** as `custom:ha-log-email`.
It shows recent Home Assistant errors and warnings, builds an email digest preview, supports manual send, export/history, live error polling, and schedule management.

```yaml
type: custom:ha-log-email
title: Log Email Summary
email_recipient: your@email.com
```

When the **HA Tools Email** integration v2.0.0 is installed, the card progressively uses its websocket API for SMTP status, default recipient, server-side schedules, and backend `send_now` log digests. If those websocket commands are unavailable, the card falls back to legacy `ha_tools_email` services, optional `notify.*` delivery, and browser-local schedule settings.

## Privacy

- No telemetry, no analytics, no tracking.
- No external network calls, no CDN-hosted assets (system fonts only).
- Smart Reports data is rendered from your Home Assistant state.
- Log Email sends data only through your configured Home Assistant email/notify service when you explicitly send or enable a schedule.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
