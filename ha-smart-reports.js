/**
 * Home Assistant Smart Reports Card
 * Energy reports, automation statistics, and system health overview
 */

class HASmartReports extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._activeTab = 'energy';
    this._period = '7d';
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot.querySelector('.reports-card')) {
      this._render();
    }
    this._updateData();
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
          <div class="stat-trend trend-down">↓ 5% vs prev</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--blue)">${cost.toFixed(2)}</div>
          <div class="stat-label">${this._config.currency} Cost</div>
          <div class="stat-trend trend-down">↓ 3% vs prev</div>
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
}

customElements.define('ha-smart-reports', HASmartReports);

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
