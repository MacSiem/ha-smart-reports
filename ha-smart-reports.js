/**
 * Home Assistant Smart Reports Card
 * Energy reports, automation statistics, and system health overview
 * Version: 3.3.0
 */

// HTML escape helper — wrap any user-derived string before interpolation into innerHTML.
const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

class HASmartReports extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // --- Throttle fields ---
    this._lastRenderTime = 0;
    this._renderScheduled = false;
    this._firstHassRender = false;
    // --- Pagination ---
    this._currentPage = {};
    this._pageSize = 15;
    this._hass = null;
    // Default config so the card works in panel/sidebar mode where setConfig() is never called.
    this._config = {
      title: 'Smart Reports',
      energy_entity: null,
      show_energy: true,
      show_automations: true,
      show_system: true,
      currency: 'PLN',
      energy_price: 0.65
    };
    this._activeTab = 'energy';
    this._period = '7d';
    this._scaffoldRendered = false;
    this._refs = { panes: {} };
    this._dataCache = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!hass) return;
    try {
      const now = Date.now();
      if (!this._firstHassRender) {
        this._firstHassRender = true;
        this._render();
        this._updateData();
        this._lastRenderTime = now;
        return;
      }
      if (now - (this._lastRenderTime || 0) < 10000) {
        if (!this._renderScheduled) {
          this._renderScheduled = true;
          setTimeout(() => {
            this._renderScheduled = false;
            try {
              this._updateData();
              this._lastRenderTime = Date.now();
            } catch (e) { this._renderError(e); }
          }, Math.max(0, 10000 - (now - (this._lastRenderTime || 0))));
        }
        return;
      }
      this._updateData();
      this._lastRenderTime = now;
    } catch (e) {
      this._renderError(e);
    }
  }

  _renderError(e) {
    console.error('[ha-smart-reports] render error:', e);
    const msg = (e && e.message) ? e.message : String(e);
    if (this.shadowRoot) {
      this.shadowRoot.innerHTML =
        '<div style="padding:16px;font-family:system-ui,sans-serif;color:#b91c1c;">' +
        '<strong>Smart Reports — render error.</strong><br>' +
        msg.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) +
        '</div>';
    }
  }

  setConfig(config) {
    config = config || {};
    this._config = {
      title: config.title || 'Smart Reports',
      energy_entity: config.energy_entity || null,
      show_energy: config.show_energy !== false,
      show_automations: config.show_automations !== false,
      show_system: config.show_system !== false,
      currency: config.currency || 'PLN',
      energy_price: config.energy_price || 0.65,
      ...config
    };
  }

  getCardSize() { return 5; }
  getGridOptions() { return { rows: 5, columns: 12, min_rows: 3, min_columns: 6 }; }

  static getStubConfig() {
    return { title: 'Smart Reports', energy_entity: 'sensor.energy_total', currency: 'PLN' };
  }

  _getTabs() {
    const tabs = [];
    if (this._config.show_energy) tabs.push({ id: 'energy', label: 'Energy', icon: '⚡' });
    if (this._config.show_automations) tabs.push({ id: 'automations', label: 'Automations', icon: '🤖' });
    if (this._config.show_system) tabs.push({ id: 'system', label: 'System', icon: '🖥️' });
    return tabs;
  }

  _render() {
    if (this._scaffoldRendered) {
      this._syncTabs();
      this._patchActiveTab();
      return;
    }

    const tabs = this._getTabs();
    if (!tabs.some(t => t.id === this._activeTab)) {
      this._activeTab = tabs[0]?.id || 'energy';
    }

    this.shadowRoot.innerHTML = `
      <style>
/* ===== BENTO LIGHT MODE DESIGN SYSTEM ===== */

:host {
  --bento-primary: #3B82F6;
  --bento-primary-hover: #2563EB;
  --bento-primary-light: rgba(59, 130, 246, 0.08);
  --bento-success: #10B981;
  --bento-success-light: rgba(16, 185, 129, 0.08);
  --bento-error: #EF4444;
  --bento-error-light: rgba(239, 68, 68, 0.08);
  --bento-warning: #F59E0B;
  --bento-warning-light: rgba(245, 158, 11, 0.08);
  --bento-bg: #F8FAFC;
  --bento-card: #FFFFFF;
  --bento-border: #E2E8F0;
  --bento-text: #1E293B;
  --bento-text-secondary: #64748B;
  --bento-text-muted: #94A3B8;
  --bento-radius-xs: 6px;
  --bento-radius-sm: 10px;
  --bento-radius-md: 16px;
  --bento-shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
  --bento-shadow-md: 0 4px 12px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.04);
  --bento-shadow-lg: 0 8px 25px rgba(0,0,0,0.06), 0 4px 10px rgba(0,0,0,0.04);
  --bento-transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bento-bg: #1a1a2e;
    --bento-card: #16213e;
    --bento-text: #e2e8f0;
    --bento-text-secondary: #94a3b8;
    --bento-border: #334155;
    --bento-success: #34d399;
    --bento-warning: #fbbf24;
    --bento-error: #f87171;
  }
}
:host-context([data-themes]) {
  --bento-bg: var(--lovelace-background, var(--primary-background-color, #F8FAFC));
  --bento-card: var(--card-background-color, var(--ha-card-background, #FFFFFF));
  --bento-text: var(--primary-text-color, #1E293B);
  --bento-text-secondary: var(--secondary-text-color, #64748B);
  --bento-border: var(--divider-color, #E2E8F0);
}

/* Card */
.card, .ha-card, ha-card, .main-card, .exporter-card, .security-card, .reports-card, .storage-card, .chore-card, .cry-card, .backup-card, .network-card, .sentence-card, .energy-card, .panel-card {
  background: var(--bento-card) !important;
  border: 1px solid var(--bento-border) !important;
  border-radius: var(--bento-radius-md) !important;
  box-shadow: var(--bento-shadow-sm) !important;
  font-family: 'Inter', sans-serif !important;
  color: var(--bento-text) !important;
  overflow: hidden;
  padding: 20px !important;
}

/* Headers */
.card-header, .header, .card-title, h1, h2, h3 {
  color: var(--bento-text) !important;
  font-family: 'Inter', sans-serif !important;
}
.card-header, .header {
  border-bottom: 1px solid var(--bento-border) !important;
  padding-bottom: 12px !important;
  margin-bottom: 16px !important;
}

/* Tabs */
.tabs, .tab-bar, .tab-nav, .tab-header {
  display: flex;
  gap: 4px;
  border-bottom: 2px solid var(--bento-border);
  padding: 0 4px;
  margin-bottom: 20px;
  overflow-x: auto;
}
.tab, .tab-btn, .tab-button {
  padding: 10px 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: 'Inter', sans-serif;
  color: var(--bento-text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: var(--bento-transition);
  white-space: nowrap;
  border-radius: 0;
}
.tab:hover, .tab-btn:hover, .tab-button:hover {
  color: var(--bento-primary);
  background: var(--bento-primary-light);
}
.tab.active, .tab-btn.active, .tab-button.active {
  color: var(--bento-primary);
  border-bottom-color: var(--bento-primary);
  background: rgba(59, 130, 246, 0.04);
  font-weight: 600;
}

/* Tab content */
.tab-content { display: none; }
.tab-content.active { display: block; animation: bentoFadeIn 0.3s ease-out; }
@keyframes bentoFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

/* Buttons */
button, .btn, .action-btn {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--bento-radius-xs);
  transition: var(--bento-transition);
  cursor: pointer;
}
button.active, .btn.active, .btn-primary, .action-btn.active {
  background: var(--bento-primary) !important;
  color: white !important;
  border-color: var(--bento-primary) !important;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
}

/* Status badges */
.badge, .status-badge, .tag, .chip {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.badge-success, .status-ok, .status-good { background: var(--bento-success-light); color: var(--bento-success); }
.badge-error, .status-error, .status-critical { background: var(--bento-error-light); color: var(--bento-error); }
.badge-warning, .status-warning { background: var(--bento-warning-light); color: var(--bento-warning); }
.badge-info, .status-info { background: var(--bento-primary-light); color: var(--bento-primary); }

/* Tables */
table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
th { background: var(--bento-bg); color: var(--bento-text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px; text-align: left; border-bottom: 2px solid var(--bento-border); }
td { padding: 12px 14px; border-bottom: 1px solid var(--bento-border); color: var(--bento-text); font-size: 13px; }
tr:hover td { background: var(--bento-primary-light); }
tr:last-child td { border-bottom: none; }

/* Inputs & selects */
input, select, textarea {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  padding: 8px 12px;
  border: 1.5px solid var(--bento-border);
  border-radius: var(--bento-radius-xs);
  background: var(--bento-card);
  color: var(--bento-text);
  transition: var(--bento-transition);
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--bento-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* Stat cards */
.stat-card, .stat, .metric-card, .stat-box, .overview-stat, .kpi-card {
  background: var(--bento-card);
  border: 1px solid var(--bento-border);
  border-radius: var(--bento-radius-sm);
  padding: 16px;
  transition: var(--bento-transition);
}
.stat-card:hover, .stat:hover, .metric-card:hover { box-shadow: var(--bento-shadow-md); transform: translateY(-1px); }
.stat-value, .metric-value, .stat-number { font-size: 28px; font-weight: 700; color: var(--bento-text); font-family: 'Inter', sans-serif; }
.stat-label, .metric-label, .stat-title { font-size: 12px; font-weight: 500; color: var(--bento-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }

/* Canvas override (prevent Bento CSS from distorting charts) */
canvas {
  max-width: 100% !important;
  height: auto !important;
  width: auto !important;
  border: none !important;
}

/* Pagination */
.pagination, .pag {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding: 16px 0;
  border-top: 1px solid var(--bento-border);
}
.pagination-btn, .pag-btn {
  padding: 8px 14px;
  border: 1.5px solid var(--bento-border);
  background: var(--bento-card);
  color: var(--bento-text);
  border-radius: var(--bento-radius-xs);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: 'Inter', sans-serif;
  transition: var(--bento-transition);
}
.pagination-btn:hover:not(:disabled), .pag-btn:hover:not(:disabled) { background: var(--bento-primary); color: white; border-color: var(--bento-primary); }
.pagination-btn:disabled, .pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pagination-info, .pag-info { font-size: 13px; color: var(--bento-text-secondary); font-weight: 500; padding: 0 8px; }
.page-size-select { padding: 6px 10px; border: 1.5px solid var(--bento-border); border-radius: var(--bento-radius-xs); font-size: 12px; font-family: 'Inter', sans-serif; }

/* Empty state */
.empty-state, .no-data, .no-results {
  text-align: center;
  padding: 48px 24px;
  color: var(--bento-text-secondary);
  font-size: 14px;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--bento-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--bento-text-muted); }

/* ===== END BENTO LIGHT MODE ===== */

        :host {
          --primary: var(--ha-card-header-color, #1976d2);
          --bg: var(--ha-card-background, var(--card-background-color, #fff));
          --text: var(--primary-text-color, #333);
          --text2: var(--secondary-text-color, #666);
          --border: var(--divider-color, #e0e0e0);
          --hover: var(--table-row-alternative-background-color, #f5f5f5);
          --green: #4caf50; --red: #f44336; --orange: #ff9800; --blue: #2196f3;
        }
        .reports-card {
          background: var(--bg); border-radius: 12px; padding: 16px;
          font-family: var(--ha-card-header-font-family, inherit); color: var(--text);
        }
        .card-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;
        }
        .card-header h2 { margin: 0; font-size: 18px; font-weight: 500; }
        .period-select {
          padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px;
          background: var(--bg); color: var(--text); font-size: 12px;
        }
        .tabs {
          display: flex; gap: 4px; margin-bottom: 16px;
          border-bottom: 1px solid var(--border); padding-bottom: 8px;
        }
        .tab {
          padding: 6px 14px; border: none; border-radius: 6px 6px 0 0;
          background: transparent; color: var(--text2); cursor: pointer;
          font-size: 13px; font-weight: 500; transition: all 0.2s;
        }
        .tab:hover { background: var(--hover); }
        .tab.active { background: var(--primary); color: #fff; }
        .tab-icon { margin-right: 4px; }
        .section { margin-bottom: 16px; }
        .section-title {
          font-size: 14px; font-weight: 600; margin-bottom: 8px;
          display: flex; align-items: center; gap: 6px;
        }
        .stats-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px; margin-bottom: 16px;
        }
        .stat-card {
          background: var(--hover); border-radius: 8px; padding: 12px;
          text-align: center;
        }
        .stat-value { font-size: 22px; font-weight: 700; }
        .stat-label { font-size: 11px; color: var(--text2); margin-top: 2px; }
        .stat-trend { font-size: 11px; margin-top: 4px; }
        .trend-up { color: var(--red); }
        .trend-down { color: var(--green); }
        .bar-chart { margin: 8px 0; }
        .bar-row {
          display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px;
        }
        .bar-label { width: 80px; text-align: right; font-size: 12px; color: var(--text2); flex-shrink: 0; }
        .bar-container { flex: 1; height: 20px; background: var(--hover); border-radius: 4px; overflow: hidden; }
        .bar-fill {
          height: 100%; border-radius: 4px; transition: width 0.5s ease;
          display: flex; align-items: center; padding: 0 6px;
          font-size: 11px; color: #fff; font-weight: 500; min-width: 30px;
        }
        .bar-value { font-size: 12px; width: 60px; text-align: right; font-family: monospace; flex-shrink: 0; }
        .auto-list { }
        .auto-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px;
        }
        .auto-item:last-child { border-bottom: none; }
        .auto-name { font-weight: 500; flex: 1; }
        .auto-count {
          background: var(--hover); padding: 2px 8px; border-radius: 12px;
          font-size: 12px; font-weight: 600; margin-left: 8px;
        }
        .auto-status {
          font-size: 11px; color: var(--text2); margin-left: 8px; width: 60px; text-align: right;
        }
        .health-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 12px; background: var(--hover); border-radius: 6px;
          margin-bottom: 6px; font-size: 13px;
        }
        .health-dot {
          width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; flex-shrink: 0;
        }
        .health-name { flex: 1; font-weight: 500; }
        .health-value { font-family: monospace; font-size: 12px; color: var(--text2); }
        .export-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
        .btn-export {
          padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px;
          background: var(--bg); color: var(--text); cursor: pointer; font-size: 12px;
        }
        .btn-export:hover { background: var(--hover); }
        .btn-export.primary { background: var(--primary); color: #fff; border-color: var(--primary); }

        /* RESPONSIVE */
        @media (max-width: 768px) {
          .reports-card { padding: 12px; }
          .card-header { flex-direction: column; gap: 8px; }
          .card-header h2 { font-size: 16px; }
          .report-grid { grid-template-columns: 1fr !important; }
          .report-section { padding: 12px; }
          table { font-size: 12px; }
          td, th { padding: 6px 8px; }
          .tab-bar { flex-wrap: wrap; }
          .tab { font-size: 12px; padding: 6px 10px; }
          .chart-container { height: 200px !important; }
        }
        @media (max-width: 480px) {
          .tab { font-size: 11px; padding: 5px 8px; }
          .report-grid { gap: 8px; }
        }
      </style>
      <ha-card>
        <div class="reports-card">
          <div class="card-header">
            <h2>${_esc(this._config.title)}</h2>
            <select class="period-select" id="periodSelect">
              <option value="1d">Today</option>
              <option value="7d" selected>Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          <div class="tabs" id="tabsContainer">
            ${tabs.map(t => `
              <button class="tab ${t.id === this._activeTab ? 'active' : ''}" data-tab="${t.id}">
                <span class="tab-icon">${t.icon}</span>${t.label}
              </button>
            `).join('')}
          </div>
          <div id="tabContent"></div>
          <div class="export-row">
            <button class="btn-export" id="exportCsvBtn">Export CSV</button>
            <button class="btn-export primary" id="exportJsonBtn">Export JSON</button>
          </div>
        </div>
      </ha-card>
    `;
    this._scaffoldRendered = true;
    this._attachEvents();
  }

  _attachEvents() {
    this.shadowRoot.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (this._activeTab === tab.dataset.tab) return;
        this._activeTab = tab.dataset.tab;
        this._syncTabs();
        this._patchActiveTab();
      });
    });

    this.shadowRoot.getElementById('periodSelect').addEventListener('change', (e) => {
      this._period = e.target.value;
      this._patchActiveTab();
    });

    this.shadowRoot.getElementById('exportCsvBtn').addEventListener('click', () => this._exportReport('csv'));
    this.shadowRoot.getElementById('exportJsonBtn').addEventListener('click', () => this._exportReport('json'));
  }

  _updateData() {
    if (!this._hass) return;
    if (!this._scaffoldRendered) this._render();
    this._dataCache = this._buildDataCache();
    this._patchActiveTab();
  }

  _buildDataCache() {
    const states = this._hass?.states || {};
    const now = Date.now();
    const energyCandidates = [];
    const automations = [];
    const domains = {};
    let totalEntities = 0;
    let unavailable = 0;
    let unknown = 0;
    let active = 0;
    let disabled = 0;
    let recentCount = 0;

    Object.entries(states).forEach(([id, s]) => {
      totalEntities += 1;
      const attrs = s.attributes || {};
      const state = s.state;
      const domain = id.split('.')[0];
      domains[domain] = (domains[domain] || 0) + 1;

      if (state === 'unavailable') unavailable += 1;
      if (state === 'unknown') unknown += 1;

      if (id.includes('energy') || id.includes('power') || id.includes('consumption')) {
        const value = Number.parseFloat(state);
        if (!Number.isNaN(value)) {
          energyCandidates.push({
            id,
            name: attrs.friendly_name || id,
            value,
            unit: attrs.unit_of_measurement || '',
            device_class: attrs.device_class
          });
        }
      }

      if (id.startsWith('automation.')) {
        const lastTriggered = attrs.last_triggered;
        if (state === 'on') active += 1;
        if (state === 'off') disabled += 1;
        if (lastTriggered && now - new Date(lastTriggered) < 86400000) recentCount += 1;
        automations.push({
          id,
          name: attrs.friendly_name || id,
          state,
          last_triggered: lastTriggered,
          current_running: attrs.current || 0
        });
      }
    });

    const sensors = energyCandidates
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const totalEnergy = sensors.reduce((sum, s) => sum + (s.unit.includes('kWh') ? s.value : 0), 0);
    const maxVal = sensors.length > 0 ? Math.max(1, ...sensors.map(s => s.value)) : 1;

    automations.sort((a, b) => {
      if (!a.last_triggered) return 1;
      if (!b.last_triggered) return -1;
      return new Date(b.last_triggered) - new Date(a.last_triggered);
    });

    const topDomains = Object.entries(domains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    return {
      energy: {
        sensors,
        totalEnergy,
        cost: totalEnergy * this._config.energy_price,
        kwhCount: sensors.filter(s => s.unit.includes('kWh')).length,
        maxVal
      },
      automations: {
        items: automations,
        total: automations.length,
        active,
        disabled,
        recentCount
      },
      system: {
        totalEntities,
        domainCount: Object.keys(domains).length,
        unavailable,
        unknown,
        topDomains,
        maxDomain: topDomains.length > 0 ? topDomains[0][1] : 1
      }
    };
  }

  _syncTabs() {
    this.shadowRoot.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === this._activeTab);
    });
    this.shadowRoot.querySelectorAll('.tab-content').forEach(pane => {
      const active = pane.dataset.pane === this._activeTab;
      pane.classList.toggle('active', active);
      pane.style.display = active ? 'block' : 'none';
    });
  }

  _patchActiveTab() {
    if (!this._dataCache || !this._scaffoldRendered) return;
    const pane = this._ensureTabPane(this._activeTab);
    if (!pane) return;
    this._syncTabs();

    switch (this._activeTab) {
      case 'energy': this._patchEnergy(); break;
      case 'automations': this._patchAutomations(); break;
      case 'system': this._patchSystem(); break;
    }
  }

  _ensureTabPane(tabName) {
    const content = this.shadowRoot.getElementById('tabContent');
    if (!content) return null;
    if (this._refs.panes[tabName]) return this._refs.panes[tabName];

    const pane = document.createElement('div');
    pane.className = 'tab-content';
    pane.dataset.pane = tabName;
    pane.style.display = 'none';
    content.appendChild(pane);
    this._refs.panes[tabName] = pane;

    switch (tabName) {
      case 'energy': this._renderEnergyScaffold(pane); break;
      case 'automations': this._renderAutomationsScaffold(pane); break;
      case 'system': this._renderSystemScaffold(pane); break;
    }
    return pane;
  }

  _setText(node, value) {
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }

  _shortName(name) {
    return String(name || '-').split(' ').slice(0, 2).join(' ');
  }

  _renderEnergyScaffold(container) {
    const colors = ['#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9', '#e8f5e9', '#fff9c4', '#ffcc80', '#ffab91', '#ef9a9a'];
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--orange)" data-ref="energyTotal"></div>
          <div class="stat-label">kWh Total</div>
          <div class="stat-trend" style="font-size:11px;color:var(--bento-text-muted)" data-ref="energyKwhCount"></div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--blue)" data-ref="energyCost"></div>
          <div class="stat-label" data-ref="energyCostLabel"></div>
          <div class="stat-trend" style="font-size:11px;color:var(--bento-text-muted)" data-ref="energyRate"></div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green)" data-ref="energySensorCount"></div>
          <div class="stat-label">Energy Sensors</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--red)" data-ref="energyTopConsumer"></div>
          <div class="stat-label">Top Consumer</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">⚡ Energy by Sensor</div>
        <div class="bar-chart">
          ${colors.map((color, i) => `
            <div class="bar-row" data-energy-row="${i}" style="display:none">
              <span class="bar-label"></span>
              <div class="bar-container">
                <div class="bar-fill" style="width:0%;background:${color}"></div>
              </div>
              <span class="bar-value"></span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    this._refs.energy = {
      total: container.querySelector('[data-ref="energyTotal"]'),
      kwhCount: container.querySelector('[data-ref="energyKwhCount"]'),
      cost: container.querySelector('[data-ref="energyCost"]'),
      costLabel: container.querySelector('[data-ref="energyCostLabel"]'),
      rate: container.querySelector('[data-ref="energyRate"]'),
      sensorCount: container.querySelector('[data-ref="energySensorCount"]'),
      topConsumer: container.querySelector('[data-ref="energyTopConsumer"]'),
      rows: [...container.querySelectorAll('[data-energy-row]')].map(row => ({
        row,
        label: row.querySelector('.bar-label'),
        fill: row.querySelector('.bar-fill'),
        value: row.querySelector('.bar-value')
      }))
    };
  }

  _patchEnergy() {
    const refs = this._refs.energy;
    const data = this._dataCache.energy;
    if (!refs || !data) return;

    this._setText(refs.total, data.totalEnergy.toFixed(1));
    this._setText(refs.kwhCount, `${data.kwhCount} sensor\u00F3w kWh`);
    this._setText(refs.cost, data.cost.toFixed(2));
    this._setText(refs.costLabel, `${this._config.currency} Cost`);
    this._setText(refs.rate, `@ ${this._config.energy_price} ${this._config.currency}/kWh`);
    this._setText(refs.sensorCount, data.sensors.length);
    this._setText(refs.topConsumer, data.sensors.length > 0 ? this._shortName(data.sensors[0].name) : '-');

    refs.rows.forEach((ref, i) => {
      const sensor = data.sensors[i];
      ref.row.style.display = sensor ? '' : 'none';
      if (!sensor) return;
      const width = sensor.value / data.maxVal * 100;
      this._setText(ref.label, this._shortName(sensor.name));
      ref.label.title = sensor.id;
      ref.fill.style.width = `${width}%`;
      this._setText(ref.fill, sensor.value > data.maxVal * 0.15 ? sensor.value.toFixed(1) : '');
      this._setText(ref.value, `${sensor.value.toFixed(1)} ${sensor.unit}`);
    });
  }

  _renderAutomationsScaffold(container) {
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--blue)" data-ref="automationTotal"></div>
          <div class="stat-label">Total Automations</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green)" data-ref="automationActive"></div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--red)" data-ref="automationDisabled"></div>
          <div class="stat-label">Disabled</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--orange)" data-ref="automationRecent"></div>
          <div class="stat-label">Triggered Today</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">🤖 Recent Activity</div>
        <div class="auto-list">
          ${Array.from({ length: 10 }, (_, i) => `
            <div class="auto-item" data-automation-row="${i}" style="display:none">
              <span class="auto-name"></span>
              <span class="auto-status"></span>
              <span class="auto-count"></span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    this._refs.automations = {
      total: container.querySelector('[data-ref="automationTotal"]'),
      active: container.querySelector('[data-ref="automationActive"]'),
      disabled: container.querySelector('[data-ref="automationDisabled"]'),
      recent: container.querySelector('[data-ref="automationRecent"]'),
      rows: [...container.querySelectorAll('[data-automation-row]')].map(row => ({
        row,
        name: row.querySelector('.auto-name'),
        status: row.querySelector('.auto-status'),
        count: row.querySelector('.auto-count')
      }))
    };
  }

  _patchAutomations() {
    const refs = this._refs.automations;
    const data = this._dataCache.automations;
    if (!refs || !data) return;

    this._setText(refs.total, data.total);
    this._setText(refs.active, data.active);
    this._setText(refs.disabled, data.disabled);
    this._setText(refs.recent, data.recentCount);

    refs.rows.forEach((ref, i) => {
      const automation = data.items[i];
      ref.row.style.display = automation ? '' : 'none';
      if (!automation) return;
      this._setText(ref.name, automation.name);
      this._setText(ref.status, this._timeAgo(automation.last_triggered));
      this._setText(ref.count, automation.state);
      ref.count.style.color = automation.state === 'on' ? 'var(--green)' : 'var(--red)';
    });
  }

  _renderSystemScaffold(container) {
    const domainColors = {
      sensor: '#4caf50', binary_sensor: '#8bc34a', light: '#ffc107',
      switch: '#2196f3', automation: '#ff9800', climate: '#00bcd4',
      media_player: '#9c27b0', cover: '#795548', person: '#607d8b',
      input_boolean: '#e91e63', script: '#ff5722'
    };

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--blue)" data-ref="systemTotal"></div>
          <div class="stat-label">Total Entities</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green)" data-ref="systemDomains"></div>
          <div class="stat-label">Domains</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" data-ref="systemUnavailable"></div>
          <div class="stat-label">Unavailable</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" data-ref="systemUnknown"></div>
          <div class="stat-label">Unknown</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">🖥️ Entities by Domain</div>
        <div class="bar-chart">
          ${Array.from({ length: 8 }, (_, i) => `
            <div class="bar-row" data-system-domain-row="${i}" style="display:none">
              <span class="bar-label"></span>
              <div class="bar-container">
                <div class="bar-fill" style="width:0%;background:#9e9e9e"></div>
              </div>
              <span class="bar-value"></span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="section">
        <div class="section-title">🏥 Health Check</div>
        ${['Entity Availability', 'Known States', 'Total Entities', 'Unavailable', 'Unknown'].map((name, i) => `
          <div class="health-item" data-system-health-row="${i}">
            <span class="health-dot"></span>
            <span class="health-name">${name}</span>
            <span class="health-value"></span>
          </div>
        `).join('')}
      </div>
    `;
    this._refs.system = {
      total: container.querySelector('[data-ref="systemTotal"]'),
      domains: container.querySelector('[data-ref="systemDomains"]'),
      unavailable: container.querySelector('[data-ref="systemUnavailable"]'),
      unknown: container.querySelector('[data-ref="systemUnknown"]'),
      domainColors,
      domainRows: [...container.querySelectorAll('[data-system-domain-row]')].map(row => ({
        row,
        label: row.querySelector('.bar-label'),
        fill: row.querySelector('.bar-fill'),
        value: row.querySelector('.bar-value')
      })),
      healthRows: [...container.querySelectorAll('[data-system-health-row]')].map(row => ({
        dot: row.querySelector('.health-dot'),
        value: row.querySelector('.health-value')
      }))
    };
  }

  _patchSystem() {
    const refs = this._refs.system;
    const data = this._dataCache.system;
    if (!refs || !data) return;

    this._setText(refs.total, data.totalEntities);
    this._setText(refs.domains, data.domainCount);
    this._setText(refs.unavailable, data.unavailable);
    this._setText(refs.unknown, data.unknown);
    refs.unavailable.style.color = data.unavailable > 0 ? 'var(--red)' : 'var(--green)';
    refs.unknown.style.color = data.unknown > 0 ? 'var(--orange)' : 'var(--green)';

    refs.domainRows.forEach((ref, i) => {
      const domain = data.topDomains[i];
      ref.row.style.display = domain ? '' : 'none';
      if (!domain) return;
      const [name, count] = domain;
      const width = count / data.maxDomain * 100;
      this._setText(ref.label, name);
      ref.fill.style.width = `${width}%`;
      ref.fill.style.background = refs.domainColors[name] || '#9e9e9e';
      this._setText(ref.fill, count > data.maxDomain * 0.15 ? count : '');
      this._setText(ref.value, count);
    });

    const total = Math.max(data.totalEntities, 1);
    const health = [
      { value: `${((data.totalEntities - data.unavailable) / total * 100).toFixed(1)}%`, ok: data.unavailable < total * 0.05 },
      { value: `${((data.totalEntities - data.unknown) / total * 100).toFixed(1)}%`, ok: data.unknown < total * 0.05 },
      { value: data.totalEntities, ok: true },
      { value: data.unavailable, ok: data.unavailable === 0 },
      { value: data.unknown, ok: data.unknown === 0 }
    ];

    refs.healthRows.forEach((ref, i) => {
      const item = health[i];
      this._setText(ref.value, item.value);
      ref.dot.style.background = item.ok ? 'var(--green)' : 'var(--orange)';
    });
  }

  _renderHealthItems(unavailable, unknown, total) {
    const items = [
      { name: 'Entity Availability', value: `${((total - unavailable) / total * 100).toFixed(1)}%`, ok: unavailable < total * 0.05 },
      { name: 'Known States', value: `${((total - unknown) / total * 100).toFixed(1)}%`, ok: unknown < total * 0.05 },
      { name: 'Total Entities', value: total, ok: true },
      { name: 'Unavailable', value: unavailable, ok: unavailable === 0 },
      { name: 'Unknown', value: unknown, ok: unknown === 0 }
    ];

    return items.map(i => `
      <div class="health-item">
        <span class="health-dot" style="background:${i.ok ? 'var(--green)' : 'var(--orange)'}"></span>
        <span class="health-name">${i.name}</span>
        <span class="health-value">${i.value}</span>
      </div>
    `).join('');
  }

  _timeAgo(ts) {
    if (!ts) return 'Never';
    const diff = Date.now() - new Date(ts);
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return `${Math.floor(diff / 86400000)}d`;
  }

  _exportReport(format) {
    const data = this._gatherReportData();
    let content, mime, ext;

    if (format === 'json') {
      content = JSON.stringify(data, null, 2);
      mime = 'application/json'; ext = 'json';
    } else {
      const rows = [['Category', 'Metric', 'Value']];
      Object.entries(data).forEach(([cat, metrics]) => {
        Object.entries(metrics).forEach(([key, val]) => {
          rows.push([cat, key, typeof val === 'object' ? JSON.stringify(val) : String(val)]);
        });
      });
      content = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
      mime = 'text/csv'; ext = 'csv';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ha-report-${new Date().toISOString().slice(0,10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _gatherReportData() {
    const states = this._hass.states;
    const allIds = Object.keys(states);

    return {
      energy: {
        sensors: allIds.filter(id => id.includes('energy')).length,
        total_power_entities: allIds.filter(id => id.includes('power')).length
      },
      automations: {
        total: allIds.filter(id => id.startsWith('automation.')).length,
        active: allIds.filter(id => id.startsWith('automation.') && states[id].state === 'on').length,
        disabled: allIds.filter(id => id.startsWith('automation.') && states[id].state === 'off').length
      },
      system: {
        total_entities: allIds.length,
        domains: [...new Set(allIds.map(id => id.split('.')[0]))].length,
        unavailable: allIds.filter(id => states[id].state === 'unavailable').length,
        unknown: allIds.filter(id => states[id].state === 'unknown').length
      },
      generated: new Date().toISOString(),
      period: this._period
    };
  }


  // --- Pagination helper ---
  _renderPagination(tabName, totalItems) {
    if (!this._currentPage[tabName]) this._currentPage[tabName] = 1;
    const pageSize = this._pageSize;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(this._currentPage[tabName], totalPages);
    this._currentPage[tabName] = page;
    return `
      <div class="pagination">
        <button class="pagination-btn" data-page-tab="${tabName}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&#8249; Prev</button>
        <span class="pagination-info">${page} / ${totalPages} (${totalItems})</span>
        <button class="pagination-btn" data-page-tab="${tabName}" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next &#8250;</button>
        <select class="page-size-select" data-page-tab="${tabName}" data-action="page-size">
          ${[10,15,25,50].map(s => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s}/page</option>`).join('')}
        </select>
      </div>`;
  }

  _paginateItems(items, tabName) {
    if (!this._currentPage[tabName]) this._currentPage[tabName] = 1;
    const start = (this._currentPage[tabName] - 1) * this._pageSize;
    return items.slice(start, start + this._pageSize);
  }

  _setupPaginationListeners() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll('.pagination-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.dataset.pageTab;
        const page = parseInt(e.target.dataset.page);
        if (tab && page > 0) {
          this._currentPage[tab] = page;
          this._render ? this._render() : (this.render ? this.render() : this.renderCard());
        }
      });
    });
    this.shadowRoot.querySelectorAll('.page-size-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        this._pageSize = parseInt(e.target.value);
        Object.keys(this._currentPage).forEach(k => this._currentPage[k] = 1);
        this._render ? this._render() : (this.render ? this.render() : this.renderCard());
      });
    });
  }

}

if (!customElements.get('ha-smart-reports')) { customElements.define('ha-smart-reports', HASmartReports); };

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ha-smart-reports',
  name: 'Smart Reports',
  description: 'Energy reports, automation statistics, and system health overview',
  preview: true
});


// --- Bundled card: ha-log-email (v3.3.0 bundle)
(function() {
  'use strict';

// XSS protection helper (global singleton - tools reuse via window._haToolsEsc)
window._haToolsEsc = window._haToolsEsc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
const _esc = window._haToolsEsc;

// -- HA Tools Persistence (stub -- full impl in ha-tools-panel.js) --
window._haToolsPersistence = window._haToolsPersistence || { _cache: {}, _hass: null, setHass(h) { this._hass = h; }, async save(k, d) { try { localStorage.setItem('ha-tools-' + k, JSON.stringify(d)); } catch(e) { console.debug('[ha-log-email] caught:', e); } }, async load(k) { try { const r = localStorage.getItem('ha-tools-' + k); return r ? JSON.parse(r) : null; } catch(e) { return null; } }, loadSync(k) { try { const r = localStorage.getItem('ha-tools-' + k); return r ? JSON.parse(r) : null; } catch(e) { return null; } } };

/**
 * HA Log Email Card v1.0
 * Send periodic email summaries of HA errors and warnings.
 * Part of HA Tools Panel - Smart Reports
 * Author: Jeff (AI) for MacSiem
 */

class HALogEmail extends HTMLElement {
  static getConfigElement() { return document.createElement('ha-log-email-editor'); }
  constructor() {
    super();
    this._toolId = this.tagName.toLowerCase().replace('ha-', '');
    this._lang = (navigator.language || '').startsWith('pl') ? 'pl' : 'en';
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._centralRecipient = null;
    this._activeTab = 'overview';
    this._tabsScrollLeft = 0;
    this._logData = null;
    this._logHistory = [];
    try { const saved = sessionStorage.getItem('ha-log-email-history'); if (saved) this._logHistory = JSON.parse(saved); } catch(e) { console.debug('[ha-log-email] caught:', e); }
    this._maxHistory = 24;
    this._loading = false;
    this._firstRender = false;
    this._lastFetch = 0;
    this._sendStatus = null;
    this._smtpStatus = null;
    this._smtpTesting = false;
    this._emailBackendChecked = false;
    this._emailBackendAvailable = false;
    this._emailBackendConfig = null;
    this._emailBackendError = null;
    this._emailSchedules = [];
    this._scheduleBusy = {};
    this._legacySchedules = this._loadLegacySchedules();
    // FUNC-2: Real-time error polling
    this._pollingEnabled = false;
    this._pollingTimer = null;
    this._pollingIntervalSec = 60;
    this._lastErrorCount = 0;
    this._lastErrorKeys = new Set();
    try {
      const pollCfg = localStorage.getItem('ha-tools-log-polling');
      if (pollCfg) {
        const p = JSON.parse(pollCfg);
        this._pollingEnabled = !!p.enabled;
        this._pollingIntervalSec = p.interval || 60;
      }
    } catch(e) { console.debug('[ha-log-email] caught:', e); }
  }

  _loadLegacySchedules() {
    const defaults = {
      daily: { kind: 'log_digest', cadence: 'daily', time: '07:00', recipients: [], enabled: false },
      weekly: { kind: 'log_digest', cadence: 'weekly', time: '07:30', recipients: [], enabled: false },
      monthly: { kind: 'log_digest', cadence: 'monthly', time: '08:00', recipients: [], enabled: false }
    };
    try {
      const raw = localStorage.getItem('ha-log-email-schedules');
      if (!raw) return defaults;
      const saved = JSON.parse(raw);
      return {
        daily: { ...defaults.daily, ...(saved.daily || {}) },
        weekly: { ...defaults.weekly, ...(saved.weekly || {}) },
        monthly: { ...defaults.monthly, ...(saved.monthly || {}) }
      };
    } catch (e) {
      console.debug('[ha-log-email] legacy schedule load failed:', e);
      return defaults;
    }
  }

  _saveLegacySchedules() {
    try {
      localStorage.setItem('ha-log-email-schedules', JSON.stringify(this._legacySchedules || {}));
    } catch (e) {
      this._showToast(this._lang === 'pl' ? 'Nie udało się zapisać harmonogramu lokalnie' : 'Could not save local schedule');
    }
  }

  _sanitize(str) {
    if (!str) return str;
    try { return decodeURIComponent(escape(str)); } catch(e) { return str; }
  }
  set hass(hass) {
    if (hass?.language) this._lang = hass.language.startsWith('pl') ? 'pl' : 'en';
    this._hass = hass;
    if (!hass) return;
    if (!this._firstRender) {
      this._firstRender = true;
      this._fetchLogData();
      this._loadEmailBackendConfig();
      this._render();
      return;
    }
    if (!this._emailBackendChecked) this._loadEmailBackendConfig();
  }

  get _t() {
    const T = {
      pl: {
        title: 'Log Email',
        loading: 'Wczytywanie...',
        noData: 'Brak danych',
        error: 'B\u0142\u0105d',
        send: 'Wy\u015Blij',
        test: 'Test',
        errors: 'B\u0142\u0119dy',
        warnings: 'Ostrze\u017Cenia',
        info: 'Informacje',
        lastFetch: 'Ostatnie pobranie',
        sendEmail: 'Wy\u015Blij email',
        emailSent: 'Email wys\u0142any',
        emailFailed: 'B\u0142\u0105d wysy\u0142ki',
        smtpOk: 'SMTP skonfigurowany',
        smtpFail: 'B\u0142\u0105d SMTP',
        newErrorsNotif: (n) => `\u26A0\uFE0F ${n} nowy(ch) b\u0142\u0119d\u00F3w w system_log`,
        locale: (this._lang === 'pl' ? 'pl-PL' : 'en-US'),
      },
      en: {
        title: 'Log Email',
        loading: 'Loading...',
        noData: 'No data',
        error: 'Error',
        send: 'Send',
        test: 'Test',
        errors: 'Errors',
        warnings: 'Warnings',
        info: 'Info',
        lastFetch: 'Last fetch',
        sendEmail: 'Send email',
        emailSent: 'Email sent',
        emailFailed: 'Email failed',
        smtpOk: 'SMTP configured',
        smtpFail: 'SMTP error',
        newErrorsNotif: (n) => `\u26A0\uFE0F ${n} new error(s) in system_log`,
        locale: 'en-US',
      },
    };
    return T[this._lang] || T.en;
  }

  setConfig(config) {
    this._config = {
      title: config.title || 'Log Email Summary',
      email_recipient: config.email_recipient || '',
      notify_service: config.notify_service || '',
      show_errors: config.show_errors !== false,
      show_warnings: config.show_warnings !== false,
      max_entries: config.max_entries || 50,
      ...config
    };
    this._loadCentralRecipient();
  }

  async _loadCentralRecipient() {
    await this._loadEmailBackendConfig();
  }

  async _emailWs(command, payload = {}) {
    const hass = this._hass;
    if (!hass?.callWS) throw new Error('Home Assistant websocket API is unavailable');
    return hass.callWS({ type: 'ha_tools_email/' + command, ...payload });
  }

  async _loadEmailBackendConfig(options = {}) {
    const showErrors = !!options.showErrors;
    const hass = this._hass;
    if (!hass?.callWS) {
      this._emailBackendChecked = true;
      this._emailBackendAvailable = false;
      return null;
    }
    try {
      const resp = await hass.callWS({ type: 'ha_tools_email/get_config' });
      this._emailBackendChecked = true;
      this._emailBackendAvailable = true;
      this._emailBackendConfig = resp || {};
      this._emailSchedules = Array.isArray(resp?.schedules) ? resp.schedules : [];
      this._emailBackendError = null;
      if (resp?.default_recipient && !this._config.email_recipient) this._centralRecipient = resp.default_recipient;
      this._render();
      return resp;
    } catch (e) {
      this._emailBackendChecked = true;
      this._emailBackendAvailable = false;
      this._emailBackendError = e?.message || String(e);
      if (showErrors) this._showToast('⚠️ ' + (this._lang === 'pl' ? 'Backend email niedostępny: ' : 'Email backend unavailable: ') + this._emailBackendError);
      this._render();
      return null;
    }
  }

  async _refreshBackendSchedules(showErrors = false) {
    if (!this._emailBackendAvailable) return;
    try {
      const resp = await this._emailWs('list_schedules');
      this._emailSchedules = Array.isArray(resp?.schedules) ? resp.schedules : [];
      this._emailBackendError = null;
      this._render();
    } catch (e) {
      this._emailBackendError = e?.message || String(e);
      if (showErrors) this._showToast('❌ ' + (this._lang === 'pl' ? 'Nie udało się pobrać harmonogramów: ' : 'Could not load schedules: ') + this._emailBackendError);
    }
  }

  _getEffectiveRecipient() {
    return this._config.email_recipient || this._centralRecipient || this._emailBackendConfig?.default_recipient || '';
  }

  _getLogSchedule(cadence) {
    return (this._emailSchedules || []).find(s => s && s.kind === 'log_digest' && s.cadence === cadence) || null;
  }

  _defaultScheduleTime(cadence) {
    return cadence === 'weekly' ? '07:30' : cadence === 'monthly' ? '08:00' : '07:00';
  }

  _splitRecipients(value) {
    return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
  }

  _scheduleRecipients(cadence) {
    const input = this.shadowRoot?.getElementById('schedule-recipients-' + cadence);
    if (input) return this._splitRecipients(input.value);
    const schedule = this._getLogSchedule(cadence) || this._legacySchedules?.[cadence];
    const recipients = Array.isArray(schedule?.recipients) ? schedule.recipients : [];
    if (recipients.length) return recipients;
    const recipient = this._getEffectiveRecipient();
    return recipient ? [recipient] : [];
  }

  getCardSize() { return 5; }
  getGridOptions() { return { rows: 5, columns: 12, min_rows: 3, min_columns: 6 }; }

  static getStubConfig() {
    return {
      type: 'custom:ha-log-email',
      title: 'Log Email Summary',
      email_recipient: 'your@email.com'
    };
  }

  async _fetchLogData() {
    if (!this._hass) return;
    this._loading = true;
    this._render();
    try {
      const logs = await this._hass.callWS({ type: 'system_log/list' });
      if (Array.isArray(logs)) {
        const now = Date.now();
        const h24 = 24 * 60 * 60 * 1000;
        const recent = logs.filter(e => {
          const ts = e.timestamp ? e.timestamp * 1000 : 0;
          return (now - ts) < h24;
        });
        const errors = recent.filter(e => e.level === 'ERROR' || e.level === 'CRITICAL');
        const warnings = recent.filter(e => e.level === 'WARNING');
        const mapEntry = function(e) {
          return {
            message: Array.isArray(e.message) ? e.message.join(' ') : String(e.message || ''),
            domain: e.name || (Array.isArray(e.source) ? e.source[0] : 'unknown'),
            when: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : '',
            count: e.count || 1,
            level: e.level
          };
        };
        this._logData = {
          errors: errors.slice(0, this._config.max_entries).map(mapEntry),
          warnings: warnings.slice(0, this._config.max_entries).map(mapEntry),
          total: recent.length,
          allLogs: logs.length,
          fetchedAt: new Date().toISOString()
        };
      }
    } catch (err) {
      console.debug('[ha-log-email] system_log/list failed, falling back to sensor:', err);
      this._logData = this._getLogFromSensor();
    }
    this._loading = false;
    this._lastFetch = Date.now();
    // D2: Save snapshot to history
    if (this._logData && this._logData.errors) {
      const snapshot = { ts: new Date().toISOString(), errors: this._logData.errors.length, warnings: this._logData.warnings.length, total: this._logData.total };
      this._logHistory.unshift(snapshot);
      if (this._logHistory.length > this._maxHistory) this._logHistory.pop();
      try { sessionStorage.setItem('ha-log-email-history', JSON.stringify(this._logHistory)); } catch(e) { console.debug('[ha-log-email] caught:', e); }
    }
    this._render();
    // FUNC-2: start polling if enabled on first successful fetch
    if (this._pollingEnabled && !this._pollingTimer) this._startPolling();
  }

  // FUNC-2: Real-time error polling
  _startPolling() {
    this._stopPolling();
    this._pollingEnabled = true;
    this._savePollingConfig();
    // Snapshot current errors as baseline
    if (this._logData?.errors) {
      this._lastErrorKeys = new Set(this._logData.errors.map(e => (Array.isArray(e.message) ? e.message.join(' ') : String(e.message || '')) + '|' + (e.name || '')));
      this._lastErrorCount = this._logData.errors.length;
    }
    this._pollingTimer = setInterval(() => this._pollForNewErrors(), this._pollingIntervalSec * 1000);
  }

  _stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
    this._pollingEnabled = false;
    this._savePollingConfig();
  }

  _savePollingConfig() {
    try {
      localStorage.setItem('ha-tools-log-polling', JSON.stringify({
        enabled: this._pollingEnabled,
        interval: this._pollingIntervalSec
      }));
    } catch(e) { console.debug('[ha-log-email] caught:', e); }
  }

  async _pollForNewErrors() {
    if (!this._hass) return;
    try {
      const logs = await this._hass.callWS({ type: 'system_log/list' });
      if (!Array.isArray(logs)) return;
      const now = Date.now();
      const h1 = 60 * 60 * 1000;
      const recentErrors = logs
        .filter(e => (e.level === 'ERROR' || e.level === 'CRITICAL') && e.timestamp && (now - e.timestamp * 1000) < h1);
      const newErrors = recentErrors.filter(e => {
        const key = (Array.isArray(e.message) ? e.message.join(' ') : String(e.message || '')) + '|' + (e.name || '');
        return !this._lastErrorKeys.has(key);
      });
      if (newErrors.length > 0) {
        // Update baseline
        this._lastErrorKeys = new Set(recentErrors.map(e => (Array.isArray(e.message) ? e.message.join(' ') : String(e.message || '')) + '|' + (e.name || '')));
        this._lastErrorCount = recentErrors.length;
        // Send HA persistent notification
        try {
          await this._hass.callService('persistent_notification', 'create', {
            title: this._t.newErrorsNotif(newErrors.length),
            message: newErrors.slice(0, 3).map(e => `**${e.name || 'unknown'}**: ${(Array.isArray(e.message) ? e.message[0] : String(e.message || '')).substring(0, 150)}`).join('\n\n'),
            notification_id: 'ha_log_email_poll_' + Date.now()
          });
        } catch(notifErr) {
          this._showToast('❌ ' + (this._lang === 'pl' ? 'Nie udało się utworzyć powiadomienia: ' : 'Could not create notification: ') + (notifErr?.message || 'Unknown error'));
        }
        // Also refresh the log data display
        this._fetchLogData();
      }
      this._lastPollTime = Date.now();
    } catch(e) {
      const now = Date.now();
      if (!this._lastPollingErrorToast || now - this._lastPollingErrorToast > 60000) {
        this._lastPollingErrorToast = now;
        this._showToast('❌ ' + (this._lang === 'pl' ? 'Błąd pollingu logów: ' : 'Log polling error: ') + (e?.message || 'Unknown error'));
      }
    }
  }

    _getLogFromSensor() {
    if (!this._hass) return null;
    const sensor = this._hass.states['sensor.ha_log_summary'];
    if (!sensor) return {
      errors: [],
      warnings: [],
      total: 0,
      note: 'Sensor sensor.ha_log_summary not found. Install log_email.yaml package.',
      fetchedAt: new Date().toISOString()
    };
    const attrs = sensor.attributes || {};
    return {
      errors: attrs.errors || [],
      warnings: attrs.warnings || [],
      total: attrs.total || 0,
      lastUpdated: sensor.last_updated,
      fetchedAt: new Date().toISOString()
    };
  }

  // ── HA Tools Email (built-in SMTP) ────────────────────────────────
  _hasLegacyHaToolsEmail() {
    return !!this._hass?.services?.ha_tools_email?.send;
  }

  _getNotifyFallbackService() {
    const notify = this._hass?.services?.notify || {};
    const configured = String(this._config.notify_service || '').replace(/^notify\./, '').trim();
    if (configured && notify[configured]) return configured;
    const candidates = Object.keys(notify).filter(name => /mail|email|smtp|gmail/i.test(name));
    return candidates[0] || '';
  }

  _hasNotifyFallback() {
    return !!this._getNotifyFallbackService();
  }

  _hasHaToolsEmail() {
    if (this._emailBackendAvailable) return !!this._emailBackendConfig?.smtp_configured;
    return this._hasLegacyHaToolsEmail();
  }

  async _sendViaHaToolsEmail(to, subject, body, html) {
    const hass = this._hass;
    if (!hass) throw new Error('Home Assistant is not ready');
    if (this._hasLegacyHaToolsEmail()) {
      const data = { subject, body };
      if (html) data.html = html;
      if (to) data.to = to;
      await hass.callService('ha_tools_email', 'send', data);
      return;
    }
    const notifyService = this._getNotifyFallbackService();
    if (notifyService) {
      const data = { title: subject, message: body };
      if (to) data.target = [to];
      await hass.callService('notify', notifyService, data);
      return;
    }
    throw new Error(this._lang === 'pl' ? 'Brak usługi ha_tools_email lub notify.*' : 'No ha_tools_email or notify.* service available');
  }

  async _testSmtp() {
    if (!this._hass) return;
    if (!this._hasHaToolsEmail()) {
      this._smtpStatus = { ok: false, error: (this._lang === 'pl' ? 'SMTP nie skonfigurowany' : 'SMTP not configured') };
      this._showToast('❌ ' + this._smtpStatus.error);
      this._render();
      return;
    }
    if (this._emailBackendAvailable && !this._hasLegacyHaToolsEmail()) {
      this._smtpStatus = { ok: true, service: 'ha_tools_email/ws', time: new Date().toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) };
      this._showToast('ℹ️ ' + (this._lang === 'pl' ? 'Backend SMTP jest skonfigurowany. Użyj Send Now, aby wysłać raport testowy.' : 'Backend SMTP is configured. Use Send Now to send a test report.'));
      this._render();
      return;
    }
    this._smtpTesting = true;
    this._render();
    try {
      await this._hass.callService('ha_tools_email', 'test', {});
      this._smtpStatus = { ok: true, service: 'ha_tools_email', time: new Date().toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) };
      this._showToast('✅ ' + (this._lang === 'pl' ? 'Email testowy wysłany' : 'Test email sent'));
    } catch (e) {
      this._smtpStatus = { ok: false, error: e.message || 'Unknown error' };
      this._showToast('❌ SMTP test failed: ' + this._smtpStatus.error);
    }
    this._smtpTesting = false;
    this._render();
  }

  _renderSmtpSection() {
    const L = this._lang === 'pl';
    const statusBadge = this._smtpStatus
      ? (this._smtpStatus.ok
        ? '<span class="badge-ok">✅ Test OK (' + _esc(this._smtpStatus.time || '') + ')</span>'
        : '<span class="badge-er">❌ ' + _esc(this._smtpStatus.error || '') + '</span>')
      : '';

    if (this._emailBackendAvailable) {
      const cfg = this._emailBackendConfig || {};
      const scheduleCount = (this._emailSchedules || []).filter(s => s.kind === 'log_digest').length;
      if (cfg.smtp_configured) {
        const server = cfg.server ? _esc(cfg.server) + ':' + _esc(cfg.port || '') : (L ? 'serwer SMTP ukryty' : 'SMTP server configured');
        const sender = cfg.sender ? _esc(cfg.sender) : (L ? 'nadawca z konfiguracji' : 'configured sender');
        const recipient = cfg.default_recipient ? _esc(cfg.default_recipient) : (L ? 'brak domyślnego odbiorcy' : 'no default recipient');
        return '<div class="smtp-section">' +
          '<div class="smtp-header">' +
            '<span class="smtp-icon">✅</span>' +
            '<div>' +
              '<div class="smtp-title">' + (L ? 'SMTP skonfigurowany (ha_tools_email v2)' : 'SMTP configured (ha_tools_email v2)') + '</div>' +
              '<div class="smtp-sub">' + server + ' • ' + sender + ' • ' + recipient + '</div>' +
              '<div class="smtp-sub">' + (L ? 'Harmonogramy na backendzie: ' : 'Server schedules: ') + scheduleCount + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="smtp-actions">' +
            '<button class="send-btn" id="btn-smtp-test" style="width:auto;padding:8px 16px" ' + (this._smtpTesting ? 'disabled' : '') + '>' +
              (this._smtpTesting ? (L ? '⏳ Wysyłam...' : '⏳ Sending...') : (L ? '📨 Test SMTP' : '📨 Test SMTP')) +
            '</button>' + statusBadge +
          '</div>' +
        '</div>';
      }
      return '<div class="smtp-section smtp-missing">' +
        '<div class="smtp-header">' +
          '<span class="smtp-icon">⚠️</span>' +
          '<div class="smtp-info">' +
            '<div class="smtp-title">' + (L ? 'SMTP nie skonfigurowany w ha_tools_email' : 'SMTP not configured in ha_tools_email') + '</div>' +
            '<div class="smtp-sub">' + (L ? 'Backend jest dostępny, ale smtp_configured=false. Hasło nie jest zwracane przez API.' : 'Backend is available, but smtp_configured=false. Password is never returned by the API.') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    if (this._hasLegacyHaToolsEmail()) {
      return '<div class="smtp-section">' +
        '<div class="smtp-header">' +
          '<span class="smtp-icon">✉️</span>' +
          '<div>' +
            '<div class="smtp-title">' + (L ? 'SMTP skonfigurowany (legacy ha_tools_email)' : 'SMTP configured (legacy ha_tools_email)') + '</div>' +
            '<div class="smtp-sub">' + (L ? 'Używam usług Home Assistant ha_tools_email.send/test.' : 'Using Home Assistant ha_tools_email.send/test services.') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="smtp-actions">' +
          '<button class="send-btn" id="btn-smtp-test" style="width:auto;padding:8px 16px" ' + (this._smtpTesting ? 'disabled' : '') + '>' +
            (this._smtpTesting ? (L ? '⏳ Wysyłam...' : '⏳ Sending...') : (L ? '📨 Wyślij test' : '📨 Send test')) +
          '</button>' + statusBadge +
        '</div>' +
      '</div>';
    }

    const notifyService = this._getNotifyFallbackService();
    if (notifyService) {
      return '<div class="smtp-section">' +
        '<div class="smtp-header"><span class="smtp-icon">🔔</span><div>' +
          '<div class="smtp-title">' + (L ? 'Fallback notify.* dostępny' : 'notify.* fallback available') + '</div>' +
          '<div class="smtp-sub">notify.' + _esc(notifyService) + '</div>' +
        '</div></div>' +
      '</div>';
    }

    return '<div class="smtp-section smtp-missing">' +
      '<div class="smtp-header">' +
        '<span class="smtp-icon">⚠️</span>' +
        '<div class="smtp-info">' +
          '<div class="smtp-title">' + (L ? 'SMTP nie skonfigurowany' : 'SMTP not configured') + '</div>' +
          '<div class="smtp-sub">' + (L ? 'Zainstaluj/skonfiguruj HA Tools Email albo starszą usługę ha_tools_email.send.' : 'Install/configure HA Tools Email or the older ha_tools_email.send service.') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  async _sendEmailNowViaBackend(period) {
    if (!this._hass) return;
    if (!this._emailBackendConfig?.smtp_configured) {
      const error = this._lang === 'pl' ? 'SMTP nie skonfigurowany w backendzie ha_tools_email' : 'SMTP is not configured in ha_tools_email backend';
      this._sendStatus = { status: 'error', period, error };
      this._showToast('❌ ' + error);
      this._render();
      return;
    }
    this._sendStatus = { status: 'sending', period };
    this._render();
    try {
      const recipients = this._scheduleRecipients(period);
      await this._emailWs('send_now', { kind: 'log_digest', cadence: period, recipients });
      this._sendStatus = { status: 'success', period, time: new Date().toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) };
      this._showToast('✅ ' + (this._lang === 'pl' ? 'Raport wysłany przez backend' : 'Report sent by backend'));
    } catch (err) {
      this._sendStatus = { status: 'error', period, error: (err.message || 'Unknown error') };
      this._showToast('❌ Send failed: ' + this._sendStatus.error);
    }
    this._render();
  }

  async _sendEmailNow(period) {
    if (!this._hass) return;
    if (this._emailBackendAvailable) {
      await this._sendEmailNowViaBackend(period);
      return;
    }
    if (!this._hasLegacyHaToolsEmail() && !this._hasNotifyFallback()) {
      this._sendStatus = { status: 'error', period, error: (this._lang === 'pl' ? 'Brak backendu email lub usługi notify.*.' : 'No email backend or notify.* service available.') };
      this._showToast('❌ ' + this._sendStatus.error);
      this._render(); return;
    }
    this._sendStatus = { status: 'sending', period };
    this._render();
    try {
      const data = this._logData;
      const errors = data && this._config.show_errors !== false ? (data.errors || []) : [];
      const warnings = data && this._config.show_warnings !== false ? (data.warnings || []) : [];
      const now = new Date().toLocaleString((this._lang === 'pl' ? 'pl-PL' : 'en-US'));
      const labels = {
        daily: this._lang === 'pl' ? 'Raport dzienny' : 'Daily Report',
        weekly: this._lang === 'pl' ? 'Raport tygodniowy' : 'Weekly Report',
        monthly: this._lang === 'pl' ? 'Raport miesięczny' : 'Monthly Report'
      };
      const subject = 'HA Log - ' + (labels[period] || labels.daily) + ' (' + now + ')';
      var body = '<h2>' + subject + '</h2>';
      body += '<p>Errors: <strong>' + errors.length + '</strong> | Warnings: <strong>' + warnings.length + '</strong></p>';
      if (errors.length > 0) {
        body += '<h3 style="color:#ef4444">Errors</h3><ul>';
        errors.forEach(function(e) { body += '<li><b>' + _esc(e.domain||'') + '</b>: ' + _esc(String(e.message||'').substring(0,200)) + ' (x' + (e.count||1) + ')</li>'; });
        body += '</ul>';
      }
      if (warnings.length > 0) {
        body += '<h3 style="color:#f59e0b">Warnings</h3><ul>';
        warnings.forEach(function(e) { body += '<li><b>' + _esc(e.domain||'') + '</b>: ' + _esc(String(e.message||'').substring(0,200)) + ' (x' + (e.count||1) + ')</li>'; });
        body += '</ul>';
      }
      if (errors.length === 0 && warnings.length === 0) body += '<p style="color:#10b981">System czysty.</p>';
      body += '<hr><p style="font-size:11px;color:#999">HA Tools Log Email</p>';
      const to = this._config.email_recipient || this._centralRecipient || '';
      await this._sendViaHaToolsEmail(to, subject, body, body);
      this._sendStatus = { status: 'success', period, time: new Date().toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) };
    } catch (err) {
      this._sendStatus = { status: 'error', period, error: (err.message || 'Unknown error') };
      this._showToast('❌ Send failed: ' + this._sendStatus.error);
    }
    this._render();
  }

    _getScheduleState(entityId) {
    if (!this._hass || !this._hass.states[entityId]) return 'unknown';
    return this._hass.states[entityId].state;
  }

  async _toggleAutomation(entityId) {
    if (!this._hass) return;
    try {
      const state = this._getScheduleState(entityId);
      await this._hass.callService('automation',
        state === 'on' ? 'turn_off' : 'turn_on',
        { entity_id: entityId }
      );
      setTimeout(() => this._render(), 500);
    } catch (e) {
      this._showToast('❌ ' + (this._lang === 'pl' ? 'Nie udało się przełączyć automatyzacji: ' : 'Could not toggle automation: ') + (e?.message || 'Unknown error'));
    }
  }

  _renderScheduleTab(dailyAuto, weeklyAuto) {
    const L = this._lang === 'pl';
    const cadences = ['daily', 'weekly', 'monthly'];
    if (this._emailBackendAvailable) {
      return `
        ${this._renderSmtpSection()}
        <div class="info-note">${L ? 'Harmonogramy są zapisywane po stronie integracji HA Tools Email v2.0.0.' : 'Schedules are stored server-side by the HA Tools Email v2.0.0 integration.'}</div>
        <div class="schedule-grid schedule-grid-single">
          ${cadences.map(c => this._renderBackendScheduleCard(c)).join('')}
        </div>
      `;
    }
    return `
      ${this._renderSmtpSection()}
      <div class="info-note">${L ? 'Tryb legacy: harmonogramy zapisują się tylko w localStorage tej przeglądarki. Do rzeczywistej automatyzacji użyj backendu v2 albo YAML poniżej.' : 'Legacy mode: schedules are saved only in this browser localStorage. Use backend v2 or YAML below for actual automation.'}</div>
      <div class="schedule-grid schedule-grid-single">
        ${cadences.map(c => this._renderLegacyScheduleCard(c)).join('')}
      </div>
      <div class="section-header">${L ? 'Starsze automatyzacje HA' : 'Legacy HA Automations'}</div>
      <div class="schedule-grid">
        <div class="schedule-card">
          <div class="schedule-title">🗓️ Daily Report</div>
          <div class="schedule-desc">Every day at 07:00 — errors + warnings summary</div>
          <div class="schedule-row">
            <span class="schedule-status ${dailyAuto === 'on' ? 'status-on' : 'status-off'}">${dailyAuto === 'on' ? '🟢 Active' : '⚫ Disabled'}</span>
            <button class="toggle-btn" id="btn-daily-toggle">${dailyAuto === 'on' ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
        <div class="schedule-card">
          <div class="schedule-title">📆 Weekly Report</div>
          <div class="schedule-desc">Every Monday at 07:30 — full week log digest</div>
          <div class="schedule-row">
            <span class="schedule-status ${weeklyAuto === 'on' ? 'status-on' : 'status-off'}">${weeklyAuto === 'on' ? '🟢 Active' : '⚫ Disabled'}</span>
            <button class="toggle-btn" id="btn-weekly-toggle">${weeklyAuto === 'on' ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
      </div>
      <div class="section-header" style="margin-top:20px">${L ? 'YAML dla natychmiastowych błędów' : 'Instant Error YAML'}</div>
      <div class="info-card setup-steps">
        <p>${L ? 'Sekcja Send Now nadal zawiera przykładową automatyzację persistent_notification dla nowych ERROR.' : 'The Send Now tab still includes the persistent_notification automation example for new ERROR events.'}</p>
      </div>
    `;
  }

  _renderBackendScheduleCard(cadence) {
    const L = this._lang === 'pl';
    const labels = {
      daily: ['☀️', L ? 'Raport dzienny' : 'Daily Report', L ? 'Codziennie' : 'Every day'],
      weekly: ['📆', L ? 'Raport tygodniowy' : 'Weekly Report', L ? 'Co tydzień' : 'Weekly'],
      monthly: ['📈', L ? 'Raport miesięczny' : 'Monthly Report', L ? 'Co miesiąc' : 'Monthly']
    };
    const schedule = this._getLogSchedule(cadence);
    const [icon, title, cadenceLabel] = labels[cadence] || labels.daily;
    const time = schedule?.time || this._defaultScheduleTime(cadence);
    const recipients = Array.isArray(schedule?.recipients) && schedule.recipients.length ? schedule.recipients.join(', ') : this._getEffectiveRecipient();
    const enabled = schedule ? schedule.enabled !== false : true;
    const busy = !!this._scheduleBusy[cadence];
    return `
      <div class="schedule-card" data-schedule-card="${cadence}">
        <div class="schedule-row"><div class="schedule-title">${icon} ${title}</div><span class="schedule-status ${schedule ? (enabled ? 'status-on' : 'status-off') : 'status-off'}">${schedule ? (enabled ? '🟢 Active' : '⚫ Disabled') : (L ? 'Nie utworzony' : 'Not created')}</span></div>
        <div class="schedule-desc">${cadenceLabel} • ${L ? 'kind: log_digest' : 'kind: log_digest'} ${schedule?.id ? '• ' + _esc(schedule.id) : ''}</div>
        <div class="schedule-fields">
          <label>${L ? 'Godzina' : 'Time'}<input class="schedule-input" type="time" id="schedule-time-${cadence}" value="${_esc(time)}"></label>
          <label>${L ? 'Odbiorcy' : 'Recipients'}<input class="schedule-input" type="text" id="schedule-recipients-${cadence}" value="${_esc(recipients || '')}" placeholder="name@example.com, other@example.com"></label>
          <label class="schedule-check"><input type="checkbox" id="schedule-enabled-${cadence}" ${enabled ? 'checked' : ''}> ${L ? 'Włączony' : 'Enabled'}</label>
        </div>
        <div class="schedule-actions">
          <button class="toggle-btn schedule-save" data-cadence="${cadence}" ${busy ? 'disabled' : ''}>${schedule ? (L ? 'Aktualizuj' : 'Update') : (L ? 'Utwórz' : 'Create')}</button>
          <button class="refresh-btn schedule-send" data-cadence="${cadence}" ${busy || !this._emailBackendConfig?.smtp_configured ? 'disabled' : ''}>${L ? 'Wyślij teraz' : 'Send now'}</button>
          <button class="refresh-btn schedule-delete" data-cadence="${cadence}" ${busy || !schedule ? 'disabled' : ''}>${L ? 'Usuń' : 'Delete'}</button>
        </div>
      </div>
    `;
  }

  _renderLegacyScheduleCard(cadence) {
    const L = this._lang === 'pl';
    const labels = {
      daily: ['☀️', L ? 'Raport dzienny' : 'Daily Report'],
      weekly: ['📆', L ? 'Raport tygodniowy' : 'Weekly Report'],
      monthly: ['📈', L ? 'Raport miesięczny' : 'Monthly Report']
    };
    const [icon, title] = labels[cadence] || labels.daily;
    const schedule = this._legacySchedules?.[cadence] || { time: this._defaultScheduleTime(cadence), recipients: [], enabled: false };
    const recipients = Array.isArray(schedule.recipients) && schedule.recipients.length ? schedule.recipients.join(', ') : this._getEffectiveRecipient();
    return `
      <div class="schedule-card" data-schedule-card="${cadence}">
        <div class="schedule-row"><div class="schedule-title">${icon} ${title}</div><span class="schedule-status ${schedule.enabled ? 'status-on' : 'status-off'}">${schedule.enabled ? '🟢 localStorage' : '⚫ localStorage'}</span></div>
        <div class="schedule-desc">${L ? 'Fallback lokalny. Nie tworzy automatyzacji po stronie HA.' : 'Local fallback. Does not create a Home Assistant server automation.'}</div>
        <div class="schedule-fields">
          <label>${L ? 'Godzina' : 'Time'}<input class="schedule-input" type="time" id="schedule-time-${cadence}" value="${_esc(schedule.time || this._defaultScheduleTime(cadence))}"></label>
          <label>${L ? 'Odbiorcy' : 'Recipients'}<input class="schedule-input" type="text" id="schedule-recipients-${cadence}" value="${_esc(recipients || '')}" placeholder="name@example.com"></label>
          <label class="schedule-check"><input type="checkbox" id="schedule-enabled-${cadence}" ${schedule.enabled ? 'checked' : ''}> ${L ? 'Włączony lokalnie' : 'Enabled locally'}</label>
        </div>
        <div class="schedule-actions">
          <button class="toggle-btn schedule-save" data-cadence="${cadence}">${L ? 'Zapisz lokalnie' : 'Save locally'}</button>
          <button class="refresh-btn schedule-send" data-cadence="${cadence}">${L ? 'Wyślij teraz' : 'Send now'}</button>
          <button class="refresh-btn schedule-delete" data-cadence="${cadence}">${L ? 'Wyczyść' : 'Clear'}</button>
        </div>
      </div>
    `;
  }

  _attachScheduleControls() {
    const root = this.shadowRoot;
    if (!root) return;
    root.querySelectorAll('.schedule-save').forEach(btn => btn.addEventListener('click', () => this._saveSchedule(btn.dataset.cadence)));
    root.querySelectorAll('.schedule-delete').forEach(btn => btn.addEventListener('click', () => this._deleteSchedule(btn.dataset.cadence)));
    root.querySelectorAll('.schedule-send').forEach(btn => btn.addEventListener('click', () => this._sendScheduleNow(btn.dataset.cadence)));
  }

  async _saveSchedule(cadence) {
    if (this._emailBackendAvailable) return this._saveBackendSchedule(cadence);
    return this._saveLegacySchedule(cadence);
  }

  async _deleteSchedule(cadence) {
    if (this._emailBackendAvailable) return this._deleteBackendSchedule(cadence);
    return this._deleteLegacySchedule(cadence);
  }

  async _sendScheduleNow(cadence) {
    if (this._emailBackendAvailable) return this._sendEmailNowViaBackend(cadence);
    return this._sendEmailNow(cadence);
  }

  async _saveBackendSchedule(cadence) {
    if (!cadence) return;
    const existing = this._getLogSchedule(cadence);
    const time = this.shadowRoot?.getElementById('schedule-time-' + cadence)?.value || this._defaultScheduleTime(cadence);
    const recipients = this._scheduleRecipients(cadence);
    const enabled = !!this.shadowRoot?.getElementById('schedule-enabled-' + cadence)?.checked;
    this._scheduleBusy[cadence] = true;
    this._render();
    try {
      const resp = await this._emailWs('set_schedule', {
        action: 'upsert',
        schedule: { id: existing?.id, kind: 'log_digest', cadence, time, recipients, enabled }
      });
      this._emailSchedules = Array.isArray(resp?.schedules) ? resp.schedules : (resp?.schedule ? [...this._emailSchedules.filter(s => s.id !== resp.schedule.id), resp.schedule] : this._emailSchedules);
      this._showToast('✅ ' + (this._lang === 'pl' ? 'Harmonogram zapisany' : 'Schedule saved'));
    } catch (e) {
      this._showToast('❌ ' + (this._lang === 'pl' ? 'Nie udało się zapisać harmonogramu: ' : 'Could not save schedule: ') + (e?.message || 'Unknown error'));
    } finally {
      this._scheduleBusy[cadence] = false;
      await this._refreshBackendSchedules(false);
      this._render();
    }
  }

  async _deleteBackendSchedule(cadence) {
    const existing = this._getLogSchedule(cadence);
    if (!existing?.id) return;
    this._scheduleBusy[cadence] = true;
    this._render();
    try {
      const resp = await this._emailWs('set_schedule', { action: 'delete', schedule_id: existing.id });
      this._emailSchedules = Array.isArray(resp?.schedules) ? resp.schedules : this._emailSchedules.filter(s => s.id !== existing.id);
      this._showToast('✅ ' + (this._lang === 'pl' ? 'Harmonogram usunięty' : 'Schedule deleted'));
    } catch (e) {
      this._showToast('❌ ' + (this._lang === 'pl' ? 'Nie udało się usunąć harmonogramu: ' : 'Could not delete schedule: ') + (e?.message || 'Unknown error'));
    } finally {
      this._scheduleBusy[cadence] = false;
      this._render();
    }
  }

  _saveLegacySchedule(cadence) {
    if (!cadence) return;
    const time = this.shadowRoot?.getElementById('schedule-time-' + cadence)?.value || this._defaultScheduleTime(cadence);
    const recipients = this._scheduleRecipients(cadence);
    const enabled = !!this.shadowRoot?.getElementById('schedule-enabled-' + cadence)?.checked;
    this._legacySchedules = this._legacySchedules || {};
    this._legacySchedules[cadence] = { kind: 'log_digest', cadence, time, recipients, enabled };
    this._saveLegacySchedules();
    this._showToast('✅ ' + (this._lang === 'pl' ? 'Harmonogram zapisany lokalnie' : 'Schedule saved locally'));
    this._render();
  }

  _deleteLegacySchedule(cadence) {
    if (!cadence) return;
    this._legacySchedules = this._legacySchedules || {};
    this._legacySchedules[cadence] = { kind: 'log_digest', cadence, time: this._defaultScheduleTime(cadence), recipients: [], enabled: false };
    this._saveLegacySchedules();
    this._showToast('✅ ' + (this._lang === 'pl' ? 'Harmonogram lokalny wyczyszczony' : 'Local schedule cleared'));
    this._render();
  }

  _buildEmailPreview() {
    const data = this._logData;
    if (!data) return '<p style="color:var(--bento-text-secondary)">No log data loaded yet. Click refresh.</p>';

    const errors = this._config.show_errors !== false ? (data.errors || []) : [];
    const warnings = this._config.show_warnings !== false ? (data.warnings || []) : [];
    const date = new Date().toLocaleString((this._lang === 'pl' ? 'pl-PL' : 'en-US'), { timeZone: 'Europe/Warsaw' });

    return `
      <div style="font-family:Arial,sans-serif;background:#1a1a2e;color:#e2e8f0;padding:16px;border-radius:8px;font-size:13px;max-height:300px;overflow-y:auto">
        <h3 style="margin:0 0 8px;color:#3b82f6">\uD83D\uDEA8 Home Assistant Log Summary</h3>
        <p style="margin:0 0 8px;color:#94a3b8">Generated: ${date}</p>

        <div style="margin-bottom:12px">
          <h4 style="color:#ef4444;margin:0 0 6px">\u274C Errors (${errors.length})</h4>
          ${errors.length === 0 ? '<p style="color:#10b981">\u2705 No errors in last 24h</p>' :
            errors.slice(0, 10).map(e => `
              <div style="background:#2d1b1b;border-left:3px solid #ef4444;padding:6px 8px;margin-bottom:4px;border-radius:0 4px 4px 0">
                <span style="color:#94a3b8;font-size:11px">${e.when ? new Date(e.when).toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) : ''}</span>
                ${e.domain ? `<span style="color:#f87171;font-size:11px"> [${_esc(e.domain)}]</span>` : ''}
                <div style="margin-top:2px">${_esc(String(e.message || '').substring(0, 120))}${String(e.message || '').length > 120 ? '...' : ''}</div>
              </div>
            `).join('') + (errors.length > 10 ? `<p style="color:#94a3b8;font-size:11px">...and ${errors.length - 10} more</p>` : '')
          }
        </div>

        <div>
          <h4 style="color:#f59e0b;margin:0 0 6px">\u26A0\uFE0F Warnings (${warnings.length})</h4>
          ${warnings.length === 0 ? '<p style="color:#10b981">\u2705 No warnings in last 24h</p>' :
            warnings.slice(0, 10).map(e => `
              <div style="background:#2d2410;border-left:3px solid #f59e0b;padding:6px 8px;margin-bottom:4px;border-radius:0 4px 4px 0">
                <span style="color:#94a3b8;font-size:11px">${e.when ? new Date(e.when).toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) : ''}</span>
                ${e.domain ? `<span style="color:#fbbf24;font-size:11px"> [${_esc(e.domain)}]</span>` : ''}
                <div style="margin-top:2px">${_esc(String(e.message || '').substring(0, 120))}${String(e.message || '').length > 120 ? '...' : ''}</div>
              </div>
            `).join('') + (warnings.length > 10 ? `<p style="color:#94a3b8;font-size:11px">...and ${warnings.length - 10} more</p>` : '')
          }
        </div>
      </div>
    `;
  }

  _render() {
    if (!this._hass) return;
    const data = this._logData;
    const errors = data && this._config.show_errors !== false ? (data.errors || []) : [];
    const warnings = data && this._config.show_warnings !== false ? (data.warnings || []) : [];
    const totalErrors = errors.length;
    const totalWarnings = warnings.length;
    const statusColor = totalErrors > 0 ? '#ef4444' : totalWarnings > 5 ? '#f59e0b' : '#10b981';
    const statusLabel = totalErrors > 0 ? `${totalErrors} error${totalErrors > 1 ? 's' : ''}` :
                        totalWarnings > 0 ? `${totalWarnings} warning${totalWarnings > 1 ? 's' : ''}` : 'Clean';

    const dailyEntityId = 'automation.ha_tools_log_email_daily';
    const weeklyEntityId = 'automation.ha_tools_log_email_weekly';
    const dailyAuto = this._getScheduleState(dailyEntityId);
    const weeklyAuto = this._getScheduleState(weeklyEntityId);

    const tabs = [
      { id: 'overview', label: 'Overview', icon: '\uD83D\uDCCA' },
      { id: 'schedule', label: 'Schedule', icon: '\uD83D\uDCC5' },
      { id: 'preview', label: 'Preview', icon: '\uD83D\uDC41\uFE0F' },
      { id: 'send', label: 'Send Now', icon: '\uD83D\uDCE7' },
      { id: 'history', label: 'History', icon: '\uD83D\uDCDC' }
    ];

    const sendStatusHTML = this._sendStatus ? (() => {
      const s = this._sendStatus;
      if (s.status === 'sending') return `<div class="send-status sending">\u23F3 Sending ${s.period} log email...</div>`;
      if (s.status === 'success') return `<div class="send-status success">\u2705 ${s.period} log email sent at ${s.time}</div>`;
      if (s.status === 'error') return `<div class="send-status error">\u274C Send failed: ${s.error}</div>`;
      return '';
    })() : '';

    const smtpHtml = this._renderSmtpSection();
    let tabContent = '';

    if (this._activeTab === 'overview') {
      tabContent = `
        <div class="overview-grid">
          <div class="stat-card ${totalErrors > 0 ? 'stat-error' : 'stat-ok'}">
            <div class="stat-icon">\u274C</div>
            <div class="stat-value">${totalErrors}</div>
            <div class="stat-label">Errors (24h)</div>
          </div>
          <div class="stat-card ${totalWarnings > 5 ? 'stat-warn' : 'stat-ok'}">
            <div class="stat-icon">\u26A0\uFE0F</div>
            <div class="stat-value">${totalWarnings}</div>
            <div class="stat-label">Warnings (24h)</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">\uD83D\uDCDD</div>
            <div class="stat-value">${data ? (data.total || totalErrors + totalWarnings) : '—'}</div>
            <div class="stat-label">Total entries</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">\uD83D\uDFE2</div>
            <div class="stat-value" style="color:${statusColor}">${statusLabel}</div>
            <div class="stat-label">Status</div>
          </div>
        </div>

        <div class="section-header">
          <span>Recent Errors</span>

        </div>
        ${this._loading ? '<div class="loading-bar"></div>' : ''}
        ${errors.length === 0 && !this._loading ?
          '<div class="empty-state">\u2705 No errors found in logbook for last 24h</div>' :
          errors.slice(0, 5).map(e => `
            <div class="log-entry error-entry">
              <span class="log-time">${e.when ? new Date(e.when).toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) : 'unknown'}</span>
              <span class="log-domain error-domain">${_esc(e.domain || 'unknown')}</span>
              <span class="log-msg">${_esc(String(e.message || '').substring(0, 100))}${String(e.message || '').length > 100 ? '…' : ''}</span>
            </div>
          `).join('')
        }

        <div class="section-header" style="margin-top:12px">Recent Warnings</div>
        ${warnings.length === 0 && !this._loading ?
          '<div class="empty-state">\u2705 No warnings found in last 24h</div>' :
          warnings.slice(0, 3).map(e => `
            <div class="log-entry warn-entry">
              <span class="log-time">${e.when ? new Date(e.when).toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US')) : 'unknown'}</span>
              <span class="log-domain warn-domain">${_esc(e.domain || 'unknown')}</span>
              <span class="log-msg">${_esc(String(e.message || '').substring(0, 100))}${String(e.message || '').length > 100 ? '…' : ''}</span>
            </div>
          `).join('')
        }

        ${data && data.fetchedAt ? `<div class="last-updated">Last fetched: ${new Date(data.fetchedAt).toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US'))}</div>` : ''}
        ${data && data.note ? `<div class="info-note">\u2139\uFE0F ${data.note}</div>` : ''}
      `;
    } else if (this._activeTab === 'schedule') {
      tabContent = this._renderScheduleTab(dailyAuto, weeklyAuto);
    } else if (this._activeTab === 'preview') {
      tabContent = `
        <div class="section-header">
          <span>Email Preview</span>
          <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <button class="refresh-btn" id="btn-refresh-preview">\uD83D\uDD04 Refresh Data</button>
            <button class="refresh-btn" id="btn-export-log-json">Export JSON</button>
            <button class="refresh-btn" id="btn-export-log-csv">Export CSV</button>
          </span>
        </div>
        ${this._loading ? '<div class="loading-bar"></div>' : ''}
        ${this._buildEmailPreview()}
        ${data ? `<div class="last-updated">Based on data from: ${new Date(data.fetchedAt).toLocaleTimeString((this._lang === 'pl' ? 'pl-PL' : 'en-US'))}</div>` : ''}
      `;
    } else if (this._activeTab === 'send') {
      tabContent = `
        <div class="send-grid">
          <div class="send-card">
            <div class="send-icon">\uD83D\uDCC5</div>
            <div class="send-title">Daily Summary</div>
            <div class="send-desc">Errors + warnings from last 24 hours</div>
            <div class="send-counts">
              <span class="count-badge error-badge">${totalErrors} errors</span>
              <span class="count-badge warn-badge">${totalWarnings} warnings</span>
            </div>
            <button class="send-btn" id="btn-send-daily">Send Daily Email</button>
          </div>
          <div class="send-card">
            <div class="send-icon">\uD83D\uDCC6</div>
            <div class="send-title">Weekly Digest</div>
            <div class="send-desc">Full week log summary</div>
            <div class="send-counts">
              <span class="count-badge info-badge">7 days</span>
            </div>
            <button class="send-btn" id="btn-send-weekly">Send Weekly Email</button>
          </div>
        </div>
        ${sendStatusHTML}
        <div class="section-header" style="margin-top:16px">Recipient</div>
        <div class="info-card">\uD83D\uDCE7 ${_esc(this._config.email_recipient || '')}</div>
        <div class="info-note" style="margin-top:8px">
          ${this._lang === 'pl' ? 'ℹ️ Wysyła email bezpośrednio przez ha_tools_email (centralna konfiguracja). Nie wymaga osobnych automatyzacji.' : 'ℹ️ Sends email directly via ha_tools_email (central config). No separate automations required.'}
        </div>

        <div class="section-header" style="margin-top:20px">Instant Error Notification</div>
        <div class="info-card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <p style="margin:0;font-weight:600;font-size:13px">🔔 Live error polling</p>
              <p style="margin:4px 0 0;font-size:11px;color:var(--bento-text-secondary,#64748B)">
                ${this._pollingEnabled ? (this._lang === 'pl' ? '🟢 Aktywne — sprawdzanie co ' : '🟢 Active — checking every ') + this._pollingIntervalSec + 's' : (this._lang === 'pl' ? '⚫ Wyłączone' : '⚫ Disabled')}
              </p>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <select id="poll-interval" style="padding:4px 8px;border-radius:6px;font-size:11px;border:1px solid var(--bento-border,#e2e8f0);background:var(--bento-bg,#f8fafc);color:var(--bento-text,#1e293b);">
                ${[30,60,120,300].map(s => `<option value="${s}" ${this._pollingIntervalSec === s ? 'selected' : ''}>${s < 60 ? s + 's' : (s/60) + 'min'}</option>`).join('')}
              </select>
              <button class="toggle-btn" id="btn-poll-toggle" style="padding:6px 14px;font-size:11px;">
                ${this._pollingEnabled ? (this._lang === 'pl' ? 'Wyłącz' : 'Disable') : (this._lang === 'pl' ? 'Włącz' : 'Enable')}
              </button>
              ${this._pollingEnabled && this._lastPollTime ? '<span style="font-size:10px;color:var(--bento-text-secondary,#64748B);margin-left:6px">last: ' + new Date(this._lastPollTime).toLocaleTimeString() + '</span>' : ''}
            </div>
          </div>
          <p style="margin:0 0 8px 0;font-size:11px;color:var(--bento-text-secondary,#64748B)">
            ${this._lang === 'pl' ? 'Polling wysyła persistent_notification w HA przy wykryciu nowego ERROR. Alternatywnie użyj automatyzacji:' : 'Polling sends a persistent_notification in HA when a new ERROR is detected. Alternatively, use an automation:'}
          </p>
          <p style="margin:0 0 8px 0;font-weight:600;font-size:13px">${this._lang === 'pl' ? 'Automatyczne powiadomienia przy nowym bledzie' : 'Automatic notifications on new errors'}</p>
          <p style="margin:0 0 12px 0;font-size:12px;color:var(--bento-text-secondary)">
            ${this._lang === 'pl' ? 'Skopiuj poniższą automatyzację do <code>automations.yaml</code> aby otrzymywać natychmiastowy email/powiadomienie przy każdym nowym ERROR w system_log.' : 'Copy the automation below into <code>automations.yaml</code> to receive an instant email/notification for every new ERROR in system_log.'}
          </p>
          <details style="margin-top:8px">
            <summary style="cursor:pointer;font-weight:600;font-size:12px;color:var(--bento-primary)">${this._lang === 'pl' ? 'Pokaż YAML automatyzacji' : 'Show automation YAML'}</summary>
            <pre style="background:#1e293b;color:#e2e8f0;padding:12px;border-radius:8px;font-size:11px;overflow-x:auto;line-height:1.5;margin-top:8px">alias: "Log Email - Instant Error Alert"
description: "${this._lang === 'pl' ? 'Wyślij powiadomienie przy nowym błędzie w system_log' : 'Send notification on new system_log error'}"
trigger:
  - platform: event
    event_type: system_log_event
    event_data:
      level: ERROR
condition:
  - condition: template
    value_template: >
      {{ (as_timestamp(now()) - as_timestamp(
        state_attr('automation.log_email_instant_error_alert','last_triggered')
        | default(0))) > 300 }}
action:
  - service: persistent_notification.create
    data:
      title: "HA Error Detected"
      message: "{{ trigger.event.data.message[:200] }}"
      notification_id: "log_error_{{ now().timestamp()|int }}"
mode: queued
max: 3</pre>
          </details>
        </div>
      `;
    }

    if (this._activeTab === 'history') {
      tabContent = this._renderHistory();
    }

    this.shadowRoot.innerHTML = `
      <style>${window.HAToolsBentoCSS || ""}


/* ===== BENTO DESIGN SYSTEM (local fallback) ===== */

:host {
  --bento-primary: #3B82F6;
  --bento-primary-hover: #2563EB;
  --bento-primary-light: rgba(59, 130, 246, 0.08);
  --bento-success: #10B981;
  --bento-success-light: rgba(16, 185, 129, 0.08);
  --bento-error: #EF4444;
  --bento-error-light: rgba(239, 68, 68, 0.08);
  --bento-warning: #F59E0B;
  --bento-warning-light: rgba(245, 158, 11, 0.08);
  --bento-bg: var(--primary-background-color, #F8FAFC);
  --bento-card: var(--card-background-color, #FFFFFF);
  --bento-border: var(--divider-color, #E2E8F0);
  --bento-text: var(--primary-text-color, #1E293B);
  --bento-text-secondary: var(--secondary-text-color, #64748B);
  --bento-text-muted: var(--disabled-text-color, #94A3B8);
  --bento-radius-xs: 6px;
  --bento-radius-sm: 10px;
  --bento-radius-md: 16px;
  --bento-shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
  --bento-shadow-md: 0 4px 12px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.04);
  --bento-shadow-lg: 0 8px 25px rgba(0,0,0,0.06), 0 4px 10px rgba(0,0,0,0.04);
  --bento-transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

:host {
          --bg: var(--bento-bg); --card: var(--bento-card); --border: var(--bento-border);
          --text: var(--bento-text); --text2: var(--bento-text-secondary); --text3: var(--bento-text-muted);
          --primary: var(--bento-primary); --success: var(--bento-success); --error: var(--bento-error);
          --warning: var(--bento-warning); --radius: var(--bento-radius-sm); --radius-sm: var(--bento-radius-xs);
          display: block; font-family: Inter, sans-serif;
          color-scheme: light dark;
        }
        @media (prefers-color-scheme: dark) {
          :host {
            --bg: #0f172a; --card: #1e293b; --border: #334155;
            --text: #f1f5f9; --text2: #94a3b8; --text3: #64748b;
          }
        }
        * { box-sizing: border-box; }
        .card { background: var(--bento-card); border-radius: var(--bento-radius-md); overflow: visible; max-width: 100%; box-sizing: border-box; }
        .header { padding: 16px 20px 0; display: flex; align-items: center; gap: 10px; }
        .header-icon { font-size: 22px; }
        .header-title { font-size: 16px; font-weight: 700; color: var(--bento-text); }
        .header-badge { margin-left: auto; background: var(--bento-border); color: var(--bento-text-secondary); font-size: 11px; padding: 3px 8px; border-radius: 20px; font-weight: 500; }
        .tabs { display: flex; border-bottom: 1px solid var(--bento-border); margin-top: 12px; }
        .tab-btn { flex: 1; padding: 10px 4px; font-size: 12px; font-weight: 600; text-align: center; cursor: pointer; color: var(--bento-text-secondary); border: none; background: none; transition: all .2s; }
        .tab-btn:hover { color: var(--bento-primary); }
        .tab-btn.active { color: var(--bento-primary); border-bottom: 2px solid var(--bento-primary); margin-bottom: -1px; }
        .content { padding: 16px; }

        .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .stat-card { background: var(--bento-bg); border-radius: var(--bento-radius-sm); padding: 10px 8px; text-align: center; border: 1px solid var(--bento-border); }
        .stat-card.stat-error { border-color: #ef444440; background: #ef444408; }
        .stat-card.stat-warn { border-color: #f59e0b40; background: #f59e0b08; }
        .stat-card.stat-ok { border-color: #10b98140; background: #10b98108; }
        .stat-icon { font-size: 18px; margin-bottom: 4px; }
        .stat-value { font-size: 20px; font-weight: 700; color: var(--bento-text); }
        .stat-label { font-size: 10px; text-transform: uppercase; color: var(--bento-text-secondary); letter-spacing: 0.3px; margin-top: 2px; }

        .section-header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--bento-text-secondary); text-transform: uppercase; letter-spacing: .5px; margin: 12px 0 8px; }
        .loading-bar { height: 3px; background: linear-gradient(90deg, var(--bento-primary), transparent); border-radius: 2px; animation: load 1s infinite; margin-bottom: 8px; }
        @keyframes load { 0%{background-position:0} 100%{background-position:200px} }

        .log-entry { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 6px; padding: 8px; border-radius: var(--bento-radius-sm); margin-bottom: 4px; font-size: 12px; min-width: 0; overflow: hidden; }
        .error-entry { background: #ef444408; border: 1px solid #ef444420; }
        .warn-entry { background: #f59e0b08; border: 1px solid #f59e0b20; }
        .log-time { color: var(--bento-text-muted); flex-shrink: 0; }
        .log-domain { font-weight: 600; flex-shrink: 1; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; word-break: break-all; }
        .error-domain { color: #ef4444; }
        .warn-domain { color: #f59e0b; }
        .log-msg { color: var(--bento-text-secondary); flex-basis: 100%; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; min-width: 0; }
        .empty-state { text-align: center; color: var(--bento-text-secondary); padding: 16px; font-size: 13px; background: var(--bento-bg); border-radius: var(--bento-radius-sm); }
        .last-updated { font-size: 11px; color: var(--bento-text-muted); text-align: right; margin-top: 8px; }
        .info-note { font-size: 12px; color: var(--bento-text-secondary); background: var(--bento-bg); border-radius: var(--bento-radius-sm); padding: 8px 10px; border-left: 3px solid var(--bento-primary); margin-top: 8px; }

        .refresh-btn { background: var(--bento-border); border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; color: var(--bento-text-secondary); cursor: pointer; font-weight: 500; }
        .refresh-btn:hover { background: var(--bento-primary); color: white; }

        .schedule-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .schedule-card { background: var(--bento-bg); border: 1px solid var(--bento-border); border-radius: var(--bento-radius-sm); padding: 12px; overflow: hidden; word-break: break-word; }
        .schedule-title { font-weight: 600; font-size: 14px; color: var(--bento-text); margin-bottom: 4px; }
        .schedule-desc { font-size: 12px; color: var(--bento-text-secondary); line-height: 1.4; margin-bottom: 10px; }
        .schedule-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        .schedule-status { font-size: 12px; font-weight: 600; }
        .status-on { color: #10b981; }
        .status-off { color: var(--bento-text-muted); }
        .toggle-btn { background: var(--bento-primary); border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; color: white; cursor: pointer; font-weight: 500; }
        .toggle-btn:hover { opacity: .85; }
        .info-card { background: var(--bento-bg); border: 1px solid var(--bento-border); border-radius: var(--bento-radius-sm); padding: 12px; font-size: 13px; color: var(--bento-text-secondary); }
        .setup-steps { line-height: 1.8; }
        .setup-steps p { margin: 6px 0; }
        .setup-steps pre { background: var(--bento-card); border: 1px solid var(--bento-border); border-radius: 4px; padding: 8px; font-size: 12px; color: var(--bento-primary); margin: 4px 0; overflow-x: auto; }
        code { background: var(--bento-border); padding: 1px 4px; border-radius: 3px; font-size: 12px; }

        .smtp-section { background: var(--bento-bg); border: 1px solid var(--bento-border); border-radius: 12px; padding: 14px; margin-bottom: 14px; }
    .smtp-missing { border-color: #f59e0b40; background: #fef3c710; }
    .smtp-header { display: flex; align-items: center; gap: 10px; }
    .smtp-icon { font-size: 22px; }
    .smtp-title { font-weight: 700; font-size: 13px; color: var(--bento-text); }
    .smtp-sub { font-size: 11px; color: var(--bento-text-secondary); margin-top: 2px; }
    .smtp-sub code { background: var(--bento-border); padding: 1px 5px; border-radius: 4px; font-size: 10px; }
    .smtp-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .smtp-guide { margin-top: 12px; font-size: 12px; line-height: 1.6; color: var(--bento-text-secondary); }
    .smtp-guide p { margin: 6px 0; }
    .smtp-guide code { background: var(--bento-border); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
    .badge-ok { color: #10b981; font-size: 12px; font-weight: 600; }
    .badge-er { color: #ef4444; font-size: 12px; font-weight: 600; }
    .send-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .send-card { background: var(--bento-bg); border: 1px solid var(--bento-border); border-radius: var(--bento-radius-sm); padding: 16px; text-align: center; }
        .send-icon { font-size: 28px; margin-bottom: 6px; }
        .send-title { font-weight: 700; color: var(--bento-text); margin-bottom: 4px; }
        .send-desc { font-size: 12px; color: var(--bento-text-secondary); margin-bottom: 10px; }
        .send-counts { display: flex; gap: 6px; justify-content: center; margin-bottom: 12px; flex-wrap: wrap; }
        .count-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; }
        .error-badge { background: #ef444420; color: #ef4444; }
        .warn-badge { background: #f59e0b20; color: #f59e0b; }
        .info-badge { background: #3b82f620; color: #3b82f6; }
        .send-btn { width: 100%; background: var(--bento-primary); color: white; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; transition: .2s; }
        .send-btn:hover { background: #2563eb; transform: translateY(-1px); }
        .send-btn:active { transform: translateY(0); }
        .send-status { padding: 10px 14px; border-radius: var(--bento-radius-sm); margin-top: 12px; font-size: 13px; font-weight: 500; text-align: center; }
        .send-status.sending { background: #3b82f620; color: #3b82f6; }
        .send-status.success { background: #10b98120; color: #10b981; }
        .send-status.error { background: #ef444420; color: #ef4444; }
        .schedule-grid-single { grid-template-columns: 1fr; }
        .schedule-fields { display: grid; grid-template-columns: minmax(120px, 180px) 1fr auto; gap: 10px; align-items: end; margin-top: 10px; }
        .schedule-fields label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 600; color: var(--bento-text-secondary); }
        .schedule-input { width: 100%; min-width: 0; }
        .schedule-check { align-self: center; flex-direction: row !important; align-items: center; white-space: nowrap; }
        .schedule-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .toast { display: none; position: fixed; bottom: 24px; right: 24px; z-index: 9999; background: #1e293b; color: #e2e8f0; padding: 12px 20px; border-radius: var(--bento-radius-sm); font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.3); max-width: 340px; }
        .toast.show { display: block; animation: slideUp .3s ease-out; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        /* === MOBILE FIX === */

        .tabs, .tab-bar { scrollbar-width: thin; scrollbar-color: var(--bento-border, #E2E8F0) transparent; }
        .tabs::-webkit-scrollbar, .tab-bar::-webkit-scrollbar { height: 4px; }
        .tabs::-webkit-scrollbar-track, .tab-bar::-webkit-scrollbar-track { background: transparent; }
        .tabs::-webkit-scrollbar-thumb, .tab-bar::-webkit-scrollbar-thumb { background: var(--bento-border, #E2E8F0); border-radius: 4px; }
@media (max-width: 768px) {
          .card { overflow: hidden; }
          .content { overflow: hidden; padding: 12px; }
          .log-entry { flex-wrap: wrap; gap: 2px 6px; }
          .log-domain { max-width: 60%; font-size: 11px; }
          .log-msg { flex-basis: 100%; max-width: 100%; overflow-wrap: anywhere; font-size: 11px; }
          .overview-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
          .send-grid { grid-template-columns: 1fr; }
          .schedule-grid { grid-template-columns: 1fr; }
          .schedule-card { padding: 10px; }
          .schedule-fields { grid-template-columns: 1fr; }
          .schedule-check { white-space: normal; }
          .toggle-btn { font-size: 11px; padding: 4px 10px; }
          pre { white-space: pre-wrap; word-break: break-all; max-width: calc(100vw - 80px); overflow-x: auto; }
          .tabs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; gap: 2px; }
          .tab-btn, .tab-btn, .tab-btn { padding: 6px 10px; font-size: 12px; white-space: nowrap; }
          .card, .card-container { padding: 14px; }
          .stats, .stats-grid, .summary-grid, .stat-cards, .kpi-grid, .metrics-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
          .stat-val, .kpi-val, .metric-val { font-size: 18px; }
          .stat-lbl, .kpi-lbl, .metric-lbl { font-size: 10px; }
          .panels, .board { flex-direction: column; }
          .column { min-width: unset; }
          h2 { font-size: 18px; }
          h3 { font-size: 15px; }
        }
        @media (max-width: 480px) {
          .tabs { gap: 1px; }
          .tab-btn, .tab-btn, .tab-btn { padding: 5px 8px; font-size: 11px; }
          .stats, .stats-grid, .summary-grid, .stat-cards, .kpi-grid, .metrics-grid { grid-template-columns: 1fr 1fr; }
          .stat-val, .kpi-val, .metric-val { font-size: 16px; }
          .stat-icon { font-size: 16px; }
          .stat-value { font-size: 16px; }
          .overview-grid { gap: 6px; }
        }


</style>

      <ha-card class="card">
        <div class="header">
          <span class="header-icon">\uD83D\uDEA8</span>
          <span class="header-title">${_esc(this._config.title || 'Log Email Summary')}</span>
          <span class="header-badge" style="background:${totalErrors > 0 ? '#ef444420' : '#10b98120'};color:${totalErrors > 0 ? '#ef4444' : '#10b981'}">${statusLabel}</span>
        </div>

        <div class="tabs">
          ${tabs.map(t => `
            <button class="tab-btn ${this._activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
              ${t.icon} ${t.label}
            </button>
          `).join('')}
        </div>

        <div class="content">
          ${tabContent}
        </div>
      </ha-card>
      <div class="toast" id="toast"></div>
    `;

    // Restore tabs scroll position
    if (this._tabsScrollLeft) {
      requestAnimationFrame(() => {
        const tabsEl = this.shadowRoot.querySelector('.tabs');
        if (tabsEl) tabsEl.scrollLeft = this._tabsScrollLeft;
      });
    }

    // Bind events
    this.shadowRoot.querySelectorAll('.tab-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        const tabsEl = this.shadowRoot.querySelector('.tabs');
        this._tabsScrollLeft = tabsEl ? tabsEl.scrollLeft : 0;
        this._activeTab = e.currentTarget.dataset.tab;
        history.replaceState(null, '', location.pathname + '#' + this._toolId + '/' + this._activeTab);
        this._render();
      });
    });

    // btn-refresh removed

    const btnRefreshPreview = this.shadowRoot.getElementById('btn-refresh-preview');
    if (btnRefreshPreview) btnRefreshPreview.addEventListener('click', () => this._fetchLogData());
    const btnExportLogJson = this.shadowRoot.getElementById('btn-export-log-json');
    if (btnExportLogJson) btnExportLogJson.addEventListener('click', () => this._exportLogData('json'));
    const btnExportLogCsv = this.shadowRoot.getElementById('btn-export-log-csv');
    if (btnExportLogCsv) btnExportLogCsv.addEventListener('click', () => this._exportLogData('csv'));

    // Schedule toggle buttons
    const btnDailyToggle = this.shadowRoot.getElementById('btn-daily-toggle');
    if (btnDailyToggle) btnDailyToggle.addEventListener('click', () => this._toggleAutomation('automation.ha_tools_log_email_daily'));
    const btnWeeklyToggle = this.shadowRoot.getElementById('btn-weekly-toggle');
    if (btnWeeklyToggle) btnWeeklyToggle.addEventListener('click', () => this._toggleAutomation('automation.ha_tools_log_email_weekly'));

    this._attachScheduleControls();

    const btnSmtpTest = this.shadowRoot.getElementById('btn-smtp-test');
    if (btnSmtpTest) {
      btnSmtpTest.addEventListener('click', () => this._testSmtp());
    }
    const btnSendDaily = this.shadowRoot.getElementById('btn-send-daily');
    if (btnSendDaily) btnSendDaily.addEventListener('click', () => this._sendEmailNow('daily'));

    const btnSendWeekly = this.shadowRoot.getElementById('btn-send-weekly');
    if (btnSendWeekly) btnSendWeekly.addEventListener('click', () => this._sendEmailNow('weekly'));

    // FUNC-2: Polling toggle
    const btnPollToggle = this.shadowRoot.getElementById('btn-poll-toggle');
    if (btnPollToggle) {
      btnPollToggle.addEventListener('click', () => {
        if (this._pollingEnabled) { this._stopPolling(); } else {
          const sel = this.shadowRoot.getElementById('poll-interval');
          if (sel) this._pollingIntervalSec = parseInt(sel.value) || 60;
          this._startPolling();
        }
        this._render();
      });
    }
    const pollIntervalSel = this.shadowRoot.getElementById('poll-interval');
    if (pollIntervalSel) {
      pollIntervalSel.addEventListener('change', (e) => {
        this._pollingIntervalSec = parseInt(e.target.value) || 60;
        if (this._pollingEnabled) { this._startPolling(); }
        this._savePollingConfig();
      });
    }

    this._injectDiscovery();
  }

  _injectDiscovery() {
    if (customElements.get('ha-tools-panel')) return;
    const container = this.shadowRoot.querySelector('.card') || this.shadowRoot.querySelector('ha-card');
    if (!container) return;
    if (container.querySelector('ha-tools-discovery-banner')) return;
    const _inj = () => {
      if (window.HAToolsDiscovery) {
        window.HAToolsDiscovery.inject(container, 'log-email', true);
      }
    };
    if (window.HAToolsDiscovery) { _inj(); return; }
    const s = document.createElement('script');
    s.src = '/local/community/ha-tools-panel/ha-tools-discovery.js?_=' + Date.now();
    s.async = true;
    s.onload = _inj;
    document.head.appendChild(s);
  }

  _exportLogData(format) {
    const data = this._logData || { errors: [], warnings: [], total: 0, fetchedAt: new Date().toISOString() };
    const payload = {
      generated: new Date().toISOString(),
      filters: {
        show_errors: this._config.show_errors !== false,
        show_warnings: this._config.show_warnings !== false,
        max_entries: this._config.max_entries
      },
      logData: data,
      history: this._logHistory || []
    };
    let content;
    let mime;
    let ext;
    if (format === 'csv') {
      const rows = [['level', 'domain', 'message', 'when', 'count']];
      if (this._config.show_errors !== false) {
        (data.errors || []).forEach(e => rows.push(['ERROR', e.domain || '', e.message || '', e.when || '', e.count || 1]));
      }
      if (this._config.show_warnings !== false) {
        (data.warnings || []).forEach(e => rows.push(['WARNING', e.domain || '', e.message || '', e.when || '', e.count || 1]));
      }
      content = rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\n');
      mime = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify(payload, null, 2);
      mime = 'application/json';
      ext = 'json';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ha-log-email-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    this._showToast('✅ ' + (this._lang === 'pl' ? 'Eksport gotowy' : 'Export ready'));
  }

  _renderHistory() {
    if (!this._logHistory || this._logHistory.length === 0) {
      return '<div class="empty-state"><div style="font-size:48px;opacity:0.5;margin-bottom:12px;">📜</div><h3 style="margin:8px 0 4px;">No History Yet</h3><p>Log snapshots are saved each time data is fetched. History persists during the browser session.</p></div>';
    }
    let html = '<div class="section-title">📊 Log Fetch History (last ' + this._logHistory.length + ' snapshots)</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr><th style="text-align:left;padding:8px;border-bottom:2px solid var(--bento-border,#e2e8f0);">Time</th><th style="text-align:center;padding:8px;border-bottom:2px solid var(--bento-border,#e2e8f0);">Errors</th><th style="text-align:center;padding:8px;border-bottom:2px solid var(--bento-border,#e2e8f0);">Warnings</th><th style="text-align:center;padding:8px;border-bottom:2px solid var(--bento-border,#e2e8f0);">Total</th></tr></thead><tbody>';
    this._logHistory.forEach(s => {
      const dt = new Date(s.ts);
      const time = dt.toLocaleTimeString() + ' ' + dt.toLocaleDateString();
      const errColor = s.errors > 0 ? 'var(--bento-error,#ef4444)' : 'var(--bento-success,#22c55e)';
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--bento-border,#e2e8f0);">' + time + '</td>';
      html += '<td style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--bento-border,#e2e8f0);color:' + errColor + ';font-weight:600;">' + s.errors + '</td>';
      html += '<td style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--bento-border,#e2e8f0);color:var(--bento-warning,#f59e0b);font-weight:600;">' + s.warnings + '</td>';
      html += '<td style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--bento-border,#e2e8f0);">' + s.total + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div style="margin-top:12px;padding:10px;background:rgba(59,130,246,0.06);border-radius:8px;font-size:12px;color:var(--bento-text-secondary,#64748b);">💡 History is stored in browser sessionStorage and resets when the tab is closed. Each automatic/manual refresh adds a snapshot.</div>';
    return html;
  }

  _showToast(msg) {
    const toast = this.shadowRoot?.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  disconnectedCallback() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  }

  setActiveTab(tabId) {
    this._activeTab = tabId;
    this._render();
  }
}

if (!customElements.get('ha-log-email')) customElements.define('ha-log-email', HALogEmail);

window.customElements.whenDefined('ha-log-email').then(() => {
  console.log('[ha-log-email] v1.0 registered');
});

class HaLogEmailEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }
  _dispatch() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
            :host { display:block; padding:16px; }
            h3 { margin:0 0 16px; font-size:15px; font-weight:600; color:var(--bento-text, var(--primary-text-color,#1e293b)); }
            input { outline:none; transition:border-color .2s; }
            input:focus { border-color:var(--bento-primary, var(--primary-color,#3b82f6)); }
        </style>
      <h3>Log Email Summary</h3>
            <div style="margin-bottom:12px;">
              <label style="display:block;font-weight:500;margin-bottom:4px;font-size:13px;">Title</label>
              <input type="text" id="cf_title" value="${_esc(this._config?.title || 'Log Email Summary')}"
                style="width:100%;padding:8px 12px;border:1px solid var(--divider-color,#e2e8f0);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#1e293b);font-size:14px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
              <label style="display:block;font-weight:500;margin-bottom:4px;font-size:13px;">Email recipient (override)</label>
              <input type="text" id="cf_email_recipient" value="${_esc(this._config?.email_recipient || '')}"
                style="width:100%;padding:8px 12px;border:1px solid var(--divider-color,#e2e8f0);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#1e293b);font-size:14px;box-sizing:border-box;">
              <div style="font-size:11px;color:var(--bento-text-secondary);margin-top:4px;">${this._lang === 'pl' ? 'Pozostaw puste, aby u\u017cy\u0107 ustawienia centralnego' : 'Leave empty to use central setting'}</div>
            </div>
    `;
        const f_title = this.shadowRoot.querySelector('#cf_title');
        if (f_title) f_title.addEventListener('input', (e) => {
          this._config = { ...this._config, title: e.target.value };
          this._dispatch();
        });
        const f_email_recipient = this.shadowRoot.querySelector('#cf_email_recipient');
        if (f_email_recipient) f_email_recipient.addEventListener('input', (e) => {
          this._config = { ...this._config, email_recipient: e.target.value };
          this._dispatch();
        });
  }
  connectedCallback() { this._render(); }
}
if (!customElements.get('ha-log-email-editor')) { customElements.define('ha-log-email-editor', HaLogEmailEditor); }

  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'ha-log-email', name: 'Log Email Summary', description: 'Email digest of HA errors and warnings', preview: false });
})();

console.info(
  '%c  HA-SMART-REPORTS  %c v3.3.0 ',
  'background: #4caf50; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px 0 0 4px;',
  'background: #e8f5e9; color: #4caf50; font-weight: bold; padding: 2px 6px; border-radius: 0 4px 4px 0;'
);
