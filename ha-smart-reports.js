/**
 * Home Assistant Smart Reports Card
 * Energy reports, automation statistics, and system health overview
 */

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
    this._config = {};
    this._activeTab = 'energy';
    this._period = '7d';
  }

  set hass(hass) {
    this._hass = hass;
    if (!hass) return;
    const now = Date.now();
    if (!this._firstHassRender) {
      this._firstHassRender = true;
      this._updateData();
      this._render();
      this._lastRenderTime = now;
      return;
    }
    if (now - (this._lastRenderTime || 0) < 10000) {
      if (!this._renderScheduled) {
        this._renderScheduled = true;
        setTimeout(() => {
          this._renderScheduled = false;
      this._updateData();
          this._render();
          this._lastRenderTime = Date.now();
        }, 5000 - (now - (this._lastRenderTime || 0)));
      }
      return;
    }
      this._updateData();
    this._render();
    this._lastRenderTime = now;
  }

  setConfig(config) {
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

  static getStubConfig() {
    return { title: 'Smart Reports', energy_entity: 'sensor.energy_total', currency: 'PLN' };
  }

  _render() {
    const tabs = [];
    if (this._config.show_energy) tabs.push({ id: 'energy', label: 'Energy', icon: '⚡' });
    if (this._config.show_automations) tabs.push({ id: 'automations', label: 'Automations', icon: '🤖' });
    if (this._config.show_system) tabs.push({ id: 'system', label: 'System', icon: '🖥️' });

    this.shadowRoot.innerHTML = `
      <style>
/* ===== BENTO LIGHT MODE DESIGN SYSTEM ===== */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

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

/* Card */
.card, .ha-card, ha-card, .main-card, .exporter-card, .security-card, .reports-card, .storage-card, .chore-card, .cry-card, .backup-card, .network-card, .sentence-card, .energy-card, .panel-card {
  background: var(--bento-card) !important;
  border: 1px solid var(--bento-border) !important;
  border-radius: var(--bento-radius-md) !important;
  box-shadow: var(--bento-shadow-sm) !important;
  font-family: 'Inter', sans-serif !important;
  color: var(--bento-text) !important;
  overflow: hidden;
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
            <h2>${this._config.title}</h2>
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
    this._attachEvents();
    this._updateData();
  }

  _attachEvents() {
    this.shadowRoot.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._activeTab = tab.dataset.tab;
        this.shadowRoot.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._updateData();
      });
    });

    this.shadowRoot.getElementById('periodSelect').addEventListener('change', (e) => {
      this._period = e.target.value;
      this._updateData();
    });

    this.shadowRoot.getElementById('exportCsvBtn').addEventListener('click', () => this._exportReport('csv'));
    this.shadowRoot.getElementById('exportJsonBtn').addEventListener('click', () => this._exportReport('json'));
  }

  _updateData() {
    const content = this.shadowRoot.getElementById('tabContent');
    if (!content || !this._hass) return;

    switch (this._activeTab) {
      case 'energy': this._renderEnergy(content); break;
      case 'automations': this._renderAutomations(content); break;
      case 'system': this._renderSystem(content); break;
    }
  }

  _renderEnergy(container) {
    const sensors = Object.entries(this._hass.states)
      .filter(([id]) => id.includes('energy') || id.includes('power') || id.includes('consumption'))
      .filter(([, s]) => !isNaN(parseFloat(s.state)))
      .map(([id, s]) => ({
        id, name: s.attributes.friendly_name || id,
        value: parseFloat(s.state),
        unit: s.attributes.unit_of_measurement || '',
        device_class: s.attributes.device_class
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const totalEnergy = sensors.reduce((sum, s) => sum + (s.unit.includes('kWh') ? s.value : 0), 0);
    const cost = totalEnergy * this._config.energy_price;

    const maxVal = sensors.length > 0 ? Math.max(...sensors.map(s => s.value)) : 1;
    const colors = ['#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9', '#e8f5e9', '#fff9c4', '#ffcc80', '#ffab91', '#ef9a9a'];

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--orange)">${totalEnergy.toFixed(1)}</div>
          <div class="stat-label">kWh Total</div>
          <div class="stat-trend" style="font-size:11px;color:var(--bento-text-muted)">${sensors.filter(s => s.unit.includes('kWh')).length} sensor\u00F3w kWh</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--blue)">${cost.toFixed(2)}</div>
          <div class="stat-label">${this._config.currency} Cost</div>
          <div class="stat-trend" style="font-size:11px;color:var(--bento-text-muted)">@ ${this._config.energy_price} ${this._config.currency}/kWh</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green)">${sensors.length}</div>
          <div class="stat-label">Energy Sensors</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--red)">${sensors.length > 0 ? sensors[0].name.split(' ').slice(0, 2).join(' ') : '-'}</div>
          <div class="stat-label">Top Consumer</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">⚡ Energy by Sensor</div>
        <div class="bar-chart">
          ${sensors.map((s, i) => `
            <div class="bar-row">
              <span class="bar-label" title="${s.id}">${s.name.split(' ').slice(0, 2).join(' ')}</span>
              <div class="bar-container">
                <div class="bar-fill" style="width:${(s.value / maxVal * 100)}%;background:${colors[i] || '#ccc'}">
                  ${s.value > maxVal * 0.15 ? s.value.toFixed(1) : ''}
                </div>
              </div>
              <span class="bar-value">${s.value.toFixed(1)} ${s.unit}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _renderAutomations(container) {
    const automations = Object.entries(this._hass.states)
      .filter(([id]) => id.startsWith('automation.'))
      .map(([id, s]) => ({
        id, name: s.attributes.friendly_name || id,
        state: s.state,
        last_triggered: s.attributes.last_triggered,
        current_running: s.attributes.current || 0
      }))
      .sort((a, b) => {
        if (!a.last_triggered) return 1;
        if (!b.last_triggered) return -1;
        return new Date(b.last_triggered) - new Date(a.last_triggered);
      });

    const active = automations.filter(a => a.state === 'on').length;
    const disabled = automations.filter(a => a.state === 'off').length;
    const recentCount = automations.filter(a => {
      if (!a.last_triggered) return false;
      return (Date.now() - new Date(a.last_triggered)) < 86400000;
    }).length;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--blue)">${automations.length}</div>
          <div class="stat-label">Total Automations</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green)">${active}</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--red)">${disabled}</div>
          <div class="stat-label">Disabled</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--orange)">${recentCount}</div>
          <div class="stat-label">Triggered Today</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">🤖 Recent Activity</div>
        <div class="auto-list">
          ${automations.slice(0, 10).map(a => `
            <div class="auto-item">
              <span class="auto-name">${a.name}</span>
              <span class="auto-status">${this._timeAgo(a.last_triggered)}</span>
              <span class="auto-count" style="color:${a.state === 'on' ? 'var(--green)' : 'var(--red)'}">
                ${a.state}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _renderSystem(container) {
    const allEntities = Object.keys(this._hass.states);
    const domains = {};
    allEntities.forEach(id => {
      const d = id.split('.')[0];
      domains[d] = (domains[d] || 0) + 1;
    });

    const topDomains = Object.entries(domains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const maxDomain = topDomains.length > 0 ? topDomains[0][1] : 1;

    const unavailable = allEntities.filter(id => this._hass.states[id].state === 'unavailable').length;
    const unknown = allEntities.filter(id => this._hass.states[id].state === 'unknown').length;

    const domainColors = {
      sensor: '#4caf50', binary_sensor: '#8bc34a', light: '#ffc107',
      switch: '#2196f3', automation: '#ff9800', climate: '#00bcd4',
      media_player: '#9c27b0', cover: '#795548', person: '#607d8b',
      input_boolean: '#e91e63', script: '#ff5722'
    };

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--blue)">${allEntities.length}</div>
          <div class="stat-label">Total Entities</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green)">${Object.keys(domains).length}</div>
          <div class="stat-label">Domains</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:${unavailable > 0 ? 'var(--red)' : 'var(--green)'}">${unavailable}</div>
          <div class="stat-label">Unavailable</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:${unknown > 0 ? 'var(--orange)' : 'var(--green)'}">${unknown}</div>
          <div class="stat-label">Unknown</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">🖥️ Entities by Domain</div>
        <div class="bar-chart">
          ${topDomains.map(([d, count]) => `
            <div class="bar-row">
              <span class="bar-label">${d}</span>
              <div class="bar-container">
                <div class="bar-fill" style="width:${(count / maxDomain * 100)}%;background:${domainColors[d] || '#9e9e9e'}">
                  ${count > maxDomain * 0.15 ? count : ''}
                </div>
              </div>
              <span class="bar-value">${count}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="section">
        <div class="section-title">🏥 Health Check</div>
        ${this._renderHealthItems(unavailable, unknown, allEntities.length)}
      </div>
    `;
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

console.info(
  '%c  HA-SMART-REPORTS  %c v1.0.0 ',
  'background: #4caf50; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px 0 0 4px;',
  'background: #e8f5e9; color: #4caf50; font-weight: bold; padding: 2px 6px; border-radius: 0 4px 4px 0;'
);
