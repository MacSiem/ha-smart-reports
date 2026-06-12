# Smart Reports Log Email Bundle Report

## Status

done

## Changed Files

- `ha-smart-reports.js` — bumped to v3.3.0 and bundled `custom:ha-log-email` under `// --- Bundled card: ha-log-email (v3.3.0 bundle)`.
- `README.md` — added bundled Log Email card usage and HA Tools Email progressive enhancement notes.
- `CHANGELOG.md` — added `[3.3.0]` and retroactive `[3.2.0]` entries.
- `codex-runs/smart-reports-log-email-bundle-report.md` — this report.

## Commands Run

```text
$ node --check ha-smart-reports.js
exit 0, no output
```

```text
$ grep -c "customElements.define" ha-smart-reports.js
3
```

```text
$ git diff --stat
 CHANGELOG.md        |   18 +
 README.md           |   18 +-
 ha-smart-reports.js | 1503 ++++++++++++++++++++++++++++++++++++++++++++++++++-
 3 files changed, 1536 insertions(+), 3 deletions(-)
```

```text
$ git diff --check
exit 0, no output
```

```text
$ git status --short
 M CHANGELOG.md
 M README.md
 M ha-smart-reports.js
?? codex-runs/
```

```text
$ rg -o "customElements\.define\(['\"][^'\"]+" ha-smart-reports.js | sort | uniq -c
   1 customElements.define('ha-log-email
   1 customElements.define('ha-log-email-editor
   1 customElements.define('ha-smart-reports
```

```text
$ rg -n "(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|http://[^ )]+:8123|https://[^ )]+:8123|ghp_|AIza|sk-|xoxb_|BEGIN (RSA |OPENSSH |)PRIVATE KEY|password:)" README.md CHANGELOG.md ha-smart-reports.js
exit 1, no matches
```

## Design Notes

- Bundle pattern follows the optimizer reference: guarded IIFE, local/global helper setup, `customElements.get()` guards, and `window.customCards.push(...)`.
- `ha-log-email` now implements `getGridOptions()` with full-width defaults.
- HA Tools Email v2 websocket progressive enhancement:
  - `ha_tools_email/get_config` loads SMTP status, default recipient, and schedules. Password is not read or expected.
  - `ha_tools_email/list_schedules` refreshes backend schedules after writes.
  - `ha_tools_email/set_schedule` upserts/deletes `kind: "log_digest"` schedules.
  - `ha_tools_email/send_now` sends backend-composed log digests for manual/schedule send-now actions.
- Legacy fallback remains available when websocket commands are unavailable: `hass.services.ha_tools_email` send/test, optional `notify.*`, persistent notification polling, legacy automation toggles, and browser-local schedule settings.
- Existing log-email features were retained from the source card: system log fetch, `sensor.ha_log_summary` fallback, digest preview, history, live error polling, persistent notification fallback, config filters, and export.

## Risks

- Runtime websocket/admin behavior was not live-tested against Home Assistant in this worker scope; verification here is static.
- The bundled source is large, so future changes should prefer targeted edits or a source regeneration script to avoid drift.
- Backend schedule execution depends on HA Tools Email v2.0.0 being installed and registered with admin websocket permissions.

## Follow-Up

- Coordinator should review the diff and run live HA UI verification if desired.
- Coordinator handles Obsidian/Notion capture if this report needs durable indexing.

## State

git_state: changed, uncommitted
github_state: not_touched
durable_capture: repo-local report only; coordinator handles Obsidian/Notion
instruction_sync: not_applicable
telegram_state: not_required_with_reason: Codex worker repo-local report requested; coordinator handles handoff signaling
