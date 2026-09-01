/**
 * Home Assistant Smart Reports Card
 * Recorder-backed energy reports, automation statistics, and system overview.
 * Version: 4.0.0
 */

(function registerHASmartReports() {
  'use strict';

  if (customElements.get('ha-smart-reports')) return;

  const VERSION = '4.0.0';
  const VALID_PERIODS = new Set(['1d', '7d', '30d']);
  const ENERGY_UNITS = new Set(['Wh', 'kWh', 'MWh']);

  function uniqueById(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item.statistic_id || seen.has(item.statistic_id)) return false;
      seen.add(item.statistic_id);
      return true;
    });
  }

  function normalizeConfiguredSource(value, role, provenance) {
    if (typeof value === 'string') {
      const statisticId = value.trim();
      return statisticId ? {
        statistic_id: statisticId,
        label: null,
        role,
        provenance,
        included_in_stat: null,
      } : null;
    }
    if (!value || typeof value !== 'object') return null;
    const rawId = value.statistic_id || value.stat_consumption || value.stat_energy_from || value.stat_cost;
    const statisticId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!statisticId) return null;
    const included = typeof value.included_in_stat === 'string' && value.included_in_stat.trim()
      ? value.included_in_stat.trim()
      : null;
    return {
      statistic_id: statisticId,
      label: typeof value.label === 'string' && value.label.trim()
        ? value.label.trim()
        : (typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null),
      role,
      provenance,
      included_in_stat: included,
    };
  }

  function normalizeList(value, role, provenance) {
    const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return uniqueById(list.map((item) => normalizeConfiguredSource(item, role, provenance)).filter(Boolean));
  }

  function asDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function numericTime(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const date = asDate(value);
    return date ? date.getTime() : null;
  }

  class HASmartReports extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._hass = null;
      this._config = {
        title: 'Smart Reports',
        show_energy: true,
        show_automations: true,
        show_system: true,
        energy_source_mode: 'dashboard',
        energy_total_statistics: [],
        energy_device_statistics: [],
        energy_cost_statistics: [],
        energy_entity: null,
        energy_price: null,
        currency: null,
      };
      this._activeTab = 'energy';
      this._period = '7d';
      this._connected = false;
      this._scaffoldRendered = false;
      this._refreshTimer = null;
      this._refreshThrottleMs = 10000;
      this._lastRefreshStartedAt = 0;
      this._energyRequestGeneration = 0;
      this._energyViewState = { status: 'idle' };
      this._now = () => new Date();
    }

    connectedCallback() {
      this._connected = true;
      this._renderScaffold();
      this._syncTabs();
      if (this._hass) this._scheduleRefresh(true);
    }

    disconnectedCallback() {
      this._connected = false;
      if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
      this._invalidateEnergyRequest();
    }

    set hass(hass) {
      this._hass = hass;
      this._syncTheme();
      if (this._connected && hass) this._scheduleRefresh(false);
    }

    get hass() {
      return this._hass;
    }

    setConfig(config) {
      const next = config && typeof config === 'object' ? config : {};
      const hasRate = Object.prototype.hasOwnProperty.call(next, 'energy_price');
      const currency = typeof next.currency === 'string' && next.currency.trim() ? next.currency.trim() : null;
      this._config = {
        title: typeof next.title === 'string' && next.title.trim() ? next.title.trim() : 'Smart Reports',
        show_energy: next.show_energy !== false,
        show_automations: next.show_automations !== false,
        show_system: next.show_system !== false,
        energy_source_mode: next.energy_source_mode === 'explicit' ? 'explicit' : 'dashboard',
        energy_total_statistics: Array.isArray(next.energy_total_statistics) ? next.energy_total_statistics : [],
        energy_device_statistics: Array.isArray(next.energy_device_statistics) ? next.energy_device_statistics : [],
        energy_cost_statistics: Array.isArray(next.energy_cost_statistics) ? next.energy_cost_statistics : [],
        energy_entity: typeof next.energy_entity === 'string' && next.energy_entity.trim() ? next.energy_entity.trim() : null,
        energy_price: hasRate && typeof next.energy_price === 'number' && Number.isFinite(next.energy_price) && next.energy_price >= 0
          ? next.energy_price
          : null,
        currency,
      };
      if (this._scaffoldRendered) {
        this._invalidateEnergyRequest();
        this._syncTabs();
        this._scheduleRefresh(true);
      }
    }

    getCardSize() { return 5; }

    getGridOptions() { return { rows: 5, columns: 12, min_rows: 3, min_columns: 6 }; }

    static getStubConfig() { return { title: 'Smart Reports', energy_source_mode: 'dashboard' }; }

    static getConfigElement() { return document.createElement('ha-smart-reports-editor'); }

    _renderScaffold() {
      if (this._scaffoldRendered) return;
      this.shadowRoot.innerHTML = `
        <style>
          :host{--sr-primary:var(--primary-color,#3b82f6);--sr-card:var(--card-background-color,var(--ha-card-background,#fff));--sr-text:var(--primary-text-color,#172033);--sr-muted:var(--secondary-text-color,#667085);--sr-border:var(--divider-color,#d9e0ea);--sr-good:#15803d;--sr-warn:#b45309;--sr-bad:#b42318;display:block;color:var(--sr-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}.card{background:var(--sr-card);border:1px solid var(--sr-border);border-radius:16px;overflow:hidden}.header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 12px}h2,h3,p{margin:0}h2{font-size:20px}h3{font-size:15px}.tabs{display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--sr-border);overflow-x:auto}button,select{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}.tab{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--sr-muted);padding:10px 12px}.tab.active{color:var(--sr-primary);border-bottom-color:var(--sr-primary);font-weight:650}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px 0}.toolbar-actions{display:flex;flex-wrap:wrap;gap:8px}.control,.action{min-height:38px;border:1px solid var(--sr-border);border-radius:9px;background:var(--sr-card);color:var(--sr-text);padding:8px 11px}.action.primary{background:var(--sr-primary);border-color:var(--sr-primary);color:#fff}.action:disabled{cursor:not-allowed;opacity:.45}.pane{padding:20px;min-height:220px}.state{display:grid;gap:12px;place-items:start;padding:22px;border:1px solid var(--sr-border);border-radius:12px}.state[role="status"]{border-left:4px solid var(--sr-primary)}.state.partial{border-left-color:var(--sr-warn)}.state.error{border-left-color:var(--sr-bad)}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.metric{border:1px solid var(--sr-border);border-radius:12px;padding:14px}.metric-label,.muted{color:var(--sr-muted);font-size:12px}.metric-value{margin-top:5px;font-size:23px;font-weight:720}.section{margin-top:18px}.list{display:grid;gap:8px;margin-top:10px}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;border-bottom:1px solid var(--sr-border);padding:9px 2px}.row.child{padding-left:24px}.row-name{overflow-wrap:anywhere}.status-ready{color:var(--sr-good)}.warning{color:var(--sr-warn)}.fixed-link{color:var(--sr-primary)}.donate-section{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;border-top:1px solid var(--sr-border);padding:13px 18px;color:var(--sr-muted);font-size:12px}.donate-section a{color:var(--sr-primary);text-decoration:none}[hidden]{display:none!important}@media(max-width:520px){.header,.toolbar{align-items:stretch;flex-direction:column}.toolbar-actions{width:100%}.action{flex:1}}
        </style>
        <ha-card class="card">
          <div class="header"><h2 id="title"></h2><span class="muted">Recorder-backed</span></div>
          <nav class="tabs" id="tabs" aria-label="Report sections">
            <button class="tab" type="button" data-tab="energy">Energy</button>
            <button class="tab" type="button" data-tab="automations">Automations</button>
            <button class="tab" type="button" data-tab="system">System</button>
          </nav>
          <div class="toolbar" id="energyToolbar">
            <label>Period <select class="control" id="periodSelect" aria-label="Energy report period"><option value="1d">Today</option><option value="7d">7 days</option><option value="30d">30 days</option></select></label>
            <div class="toolbar-actions"><button class="action" type="button" id="exportCsvBtn" disabled>Export CSV</button><button class="action primary" type="button" id="exportJsonBtn" disabled>Export JSON</button></div>
          </div>
          <main class="pane" id="content"></main>
          <footer class="donate-section" data-source="own-card"><span>Support HA Tools</span><a href="https://buymeacoffee.com/macsiem" target="_blank" rel="noopener noreferrer">Buy me a coffee</a><a href="https://www.paypal.com/donate/?hosted_button_id=Y967H4PLRBN8W" target="_blank" rel="noopener noreferrer">PayPal</a></footer>
        </ha-card>`;
      this._scaffoldRendered = true;
      this.shadowRoot.getElementById('periodSelect').value = this._period;
      this.shadowRoot.getElementById('periodSelect').addEventListener('change', (event) => {
        const period = VALID_PERIODS.has(event.target.value) ? event.target.value : '7d';
        if (period === this._period) return;
        this._period = period;
        this._invalidateEnergyRequest();
        this._scheduleRefresh(true);
      });
      for (const button of this.shadowRoot.querySelectorAll('[data-tab]')) button.addEventListener('click', () => this._selectTab(button.dataset.tab));
      this.shadowRoot.getElementById('exportJsonBtn').addEventListener('click', () => this._downloadExport('json'));
      this.shadowRoot.getElementById('exportCsvBtn').addEventListener('click', () => this._downloadExport('csv'));
    }

    _syncTheme() {
      if (this._hass) this.classList.toggle('bento-dark', Boolean(this._hass.themes && this._hass.themes.darkMode));
    }

    _availableTabs() {
      const result = [];
      if (this._config.show_energy) result.push('energy');
      if (this._config.show_automations) result.push('automations');
      if (this._config.show_system) result.push('system');
      return result;
    }

    _syncTabs() {
      if (!this._scaffoldRendered) return;
      const available = this._availableTabs();
      if (!available.includes(this._activeTab)) this._activeTab = available[0] || null;
      this.shadowRoot.getElementById('title').textContent = this._config.title;
      this.shadowRoot.getElementById('tabs').hidden = available.length === 0;
      for (const button of this.shadowRoot.querySelectorAll('[data-tab]')) {
        const tab = button.dataset.tab;
        button.hidden = !available.includes(tab);
        button.classList.toggle('active', tab === this._activeTab);
        button.setAttribute('aria-selected', String(tab === this._activeTab));
      }
      this.shadowRoot.getElementById('energyToolbar').hidden = this._activeTab !== 'energy';
      if (this._activeTab === null) {
        const container = this.shadowRoot.getElementById('content');
        container.replaceChildren(this._stateBlock('Enable at least one report section.', 'Turn on Energy, Automations, or System in the card configuration.', '', 'status'));
      } else if (this._activeTab === 'energy') this._renderEnergyState();
      else if (this._activeTab === 'automations') this._renderAutomations();
      else this._renderSystem();
    }

    _selectTab(tab) {
      if (!this._availableTabs().includes(tab) || tab === this._activeTab) return;
      if (this._activeTab === 'energy') this._invalidateEnergyRequest();
      this._activeTab = tab;
      this._syncTabs();
      this._scheduleRefresh(true);
    }

    _scheduleRefresh(immediate) {
      if (!this._connected || !this._hass) return;
      if (immediate && this._refreshTimer !== null) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (this._refreshTimer !== null) return;
      const elapsed = Date.now() - this._lastRefreshStartedAt;
      const delay = immediate ? 0 : Math.max(0, this._refreshThrottleMs - elapsed);
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this._runRefresh();
      }, delay);
    }

    async _runRefresh() {
      if (!this._connected || !this._hass) return;
      this._lastRefreshStartedAt = Date.now();
      try {
        if (this._activeTab === null) return;
        if (this._activeTab === 'energy') await this._loadEnergy();
        else if (this._activeTab === 'automations') this._renderAutomations();
        else this._renderSystem();
      } catch (error) {
        if (this._activeTab === 'energy' && this._connected) this._setEnergyViewState(this._errorState(error, this._periodDescriptor()));
      }
    }

    _errorState(error, period) {
      return {
        status: this._classifyError(error),
        code: error && error.code != null ? String(error.code) : 'unknown_error',
        period,
        source_mode: this._config.energy_source_mode === 'explicit' ? 'explicit' : 'energy_dashboard',
        total: { value: null, unit: 'kWh', source_statistic_ids: [] },
        cost: { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'request_failed' },
        devices: [], total_sources: [], cost_sources: [], warnings: [],
      };
    }

    _invalidateEnergyRequest() { this._energyRequestGeneration += 1; }

    _isCurrentEnergyRequest(generation) { return this._connected && this.isConnected && this._activeTab === 'energy' && generation === this._energyRequestGeneration; }

    _classifyError(error) {
      const code = error && error.code != null ? String(error.code).toLowerCase() : '';
      const message = error && error.message ? String(error.message).toLowerCase() : '';
      if (code === '401' || code === '403' || code.includes('unauthorized') || message.includes('unauthorized') || message.includes('forbidden')) return 'permission_denied';
      if (code === '404' || code === 'unknown_command' || message.includes('unknown command')) return 'unsupported';
      return 'error';
    }

    _timeZone() {
      const configured = this._hass && this._hass.config && this._hass.config.time_zone;
      if (typeof configured === 'string' && configured) return configured;
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_error) { return 'UTC'; }
    }

    _partsInZone(date, timeZone) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const result = {};
      for (const part of parts) if (part.type !== 'literal') result[part.type] = Number(part.value);
      return result;
    }

    _zonedDateTimeToUtc(parts, timeZone) {
      const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, 0);
      let guess = target;
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const actual = this._partsInZone(new Date(guess), timeZone);
        const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, 0);
        const delta = target - represented;
        guess += delta;
        if (delta === 0) break;
      }
      return new Date(guess);
    }

    _addCalendarDays(parts, days) {
      const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
      return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
    }

    _zonedDayBounds(parts, timeZone) {
      const next = this._addCalendarDays(parts, 1);
      return { start: this._zonedDateTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone), end: this._zonedDateTimeToUtc({ ...next, hour: 0, minute: 0, second: 0 }, timeZone) };
    }

    _calendarWindow(key, nowValue, timeZone) {
      const now = asDate(nowValue) || new Date();
      const safeKey = VALID_PERIODS.has(key) ? key : '7d';
      const local = this._partsInZone(now, timeZone);
      const daysBack = safeKey === '1d' ? 0 : (safeKey === '30d' ? 29 : 6);
      const startDate = this._addCalendarDays(local, -daysBack);
      return { key: safeKey, start: this._zonedDateTimeToUtc({ ...startDate, hour: 0, minute: 0, second: 0 }, timeZone), end: now, time_zone: timeZone };
    }

    _periodDescriptor() {
      const window = this._calendarWindow(this._period, this._now(), this._timeZone());
      return { key: window.key, start: window.start.toISOString(), end: window.end.toISOString(), time_zone: window.time_zone };
    }

    async _dashboardSources(generation) {
      const prefs = await this._hass.callWS({ type: 'energy/get_prefs' });
      if (!this._isCurrentEnergyRequest(generation)) return null;
      const totals = []; const costs = []; const devices = []; const costCoverage = new Map();
      const add = (target, value, role) => {
        const normalized = normalizeConfiguredSource(value, role, 'energy_dashboard');
        if (normalized) target.push(normalized);
        return normalized;
      };
      const addGridFlow = (totalValue, costValue) => {
        const total = add(totals, totalValue, 'total');
        if (!total) return;
        const cost = add(costs, costValue, 'cost');
        costCoverage.set(total.statistic_id, Boolean(cost) || costCoverage.get(total.statistic_id) === true);
      };
      const energySources = prefs && Array.isArray(prefs.energy_sources) ? prefs.energy_sources : [];
      for (const source of energySources) {
        if (!source || source.type !== 'grid') continue;
        const hasDirectImport = typeof source.stat_energy_from === 'string' && source.stat_energy_from.trim();
        if (hasDirectImport) addGridFlow(source.stat_energy_from, source.stat_cost);
        else if (Array.isArray(source.flow_from)) for (const flow of source.flow_from) {
          addGridFlow(flow && (flow.stat_energy_from || flow.stat_energy), flow && flow.stat_cost);
        }
      }
      const consumption = prefs && Array.isArray(prefs.device_consumption) ? prefs.device_consumption : [];
      for (const device of consumption) {
        const normalized = normalizeConfiguredSource(device, 'device', 'energy_dashboard');
        if (normalized) devices.push(normalized);
      }
      let uniqueCosts = uniqueById(costs);
      const uniqueTotals = uniqueById(totals);
      if (uniqueTotals.some((total) => costCoverage.get(total.statistic_id) !== true)) {
        try {
          const info = await this._hass.callWS({ type: 'energy/info' });
          if (!this._isCurrentEnergyRequest(generation)) return null;
          const mapping = info && info.cost_sensors && typeof info.cost_sensors === 'object' ? info.cost_sensors : {};
          const discovered = [...uniqueCosts];
          for (const total of uniqueTotals) {
            if (costCoverage.get(total.statistic_id) === true) continue;
            const exact = mapping[total.statistic_id];
            const mapped = add(discovered, exact && (exact.statistic_id || exact.entity_id || exact), 'cost');
            costCoverage.set(total.statistic_id, Boolean(mapped));
          }
          uniqueCosts = uniqueById(discovered);
        } catch (error) {
          if (!this._isCurrentEnergyRequest(generation)) return null;
          if (this._classifyError(error) === 'permission_denied') throw error;
        }
      }
      const uniqueDevices = uniqueById(devices);
      const hasAnyMappedCost = [...costCoverage.values()].some(Boolean);
      const costConfigurationIncomplete = hasAnyMappedCost && [...costCoverage.values()].some((covered) => !covered);
      return { source_mode: 'energy_dashboard', totals: uniqueTotals, devices: uniqueDevices, costs: uniqueCosts, cost_configuration_incomplete: costConfigurationIncomplete, warnings: [], ordered: uniqueById([...uniqueTotals, ...uniqueCosts, ...uniqueDevices]) };
    }

    _explicitSources() {
      let totals = normalizeList(this._config.energy_total_statistics, 'total', 'explicit');
      if (totals.length === 0 && this._config.energy_entity) totals = normalizeList([this._config.energy_entity], 'total', 'legacy_energy_entity');
      const invalidTotals = totals.filter((source) => source.included_in_stat);
      totals = totals.filter((source) => !source.included_in_stat);
      const devices = normalizeList(this._config.energy_device_statistics, 'device', 'explicit');
      const costs = normalizeList(this._config.energy_cost_statistics, 'cost', 'explicit');
      return { source_mode: 'explicit', totals, devices, costs, warnings: invalidTotals.map((source) => `included_in_stat is only valid for device sources: ${source.statistic_id}`), ordered: uniqueById([...totals, ...devices, ...costs]) };
    }

    _metadataMap(response) {
      if (Array.isArray(response)) {
        const result = {};
        for (const entry of response) if (entry && typeof entry.statistic_id === 'string') result[entry.statistic_id] = entry;
        return result;
      }
      return response && typeof response === 'object' ? response : {};
    }

    _metadataUnit(metadata) {
      if (!metadata || typeof metadata !== 'object') return null;
      const unit = metadata.statistics_unit_of_measurement != null ? metadata.statistics_unit_of_measurement : metadata.unit_of_measurement;
      return typeof unit === 'string' && unit ? unit : null;
    }

    _summarizeSeries(series, metadata, window, role, expectedCurrency) {
      const unit = this._metadataUnit(metadata);
      if (!metadata || metadata.has_sum !== true) return { status: 'unsupported', value: null, unit };
      const unitClass = metadata.unit_class == null ? null : String(metadata.unit_class);
      if (role !== 'cost' && (!ENERGY_UNITS.has(unit) || (unitClass !== null && unitClass !== 'energy'))) return { status: 'unsupported', value: null, unit, reason: 'incompatible_energy_metadata' };
      if (role === 'cost' && (!unit || (unitClass !== null && unitClass !== 'currency') || typeof expectedCurrency !== 'string' || unit !== expectedCurrency)) return { status: 'unsupported', value: null, unit, reason: 'incompatible_currency_metadata' };
      const normalizedUnit = role === 'cost' ? unit : 'kWh';
      if (!Array.isArray(series) || series.length === 0) return { status: 'no_data', value: null, unit: normalizedUnit, reason: 'no_data' };
      const buckets = series.map((bucket) => ({ start: numericTime(bucket && bucket.start), end: numericTime(bucket && bucket.end), change: bucket && bucket.change }));
      if (buckets.some((bucket) => bucket.start === null || bucket.end === null || bucket.end <= bucket.start)) return { status: 'invalid', value: null, unit: normalizedUnit, reason: 'invalid_bucket' };
      buckets.sort((left, right) => left.start - right.start);
      const windowStart = window && asDate(window.start); const windowEnd = window && asDate(window.end);
      let effectiveBuckets = buckets;
      let startMs = null; let endMs = null;
      if (windowStart && windowEnd && windowEnd > windowStart) {
        startMs = windowStart.getTime(); endMs = windowEnd.getTime();
        if (buckets.some((bucket) => bucket.end < startMs || bucket.start > endMs)) return { status: 'invalid', value: null, unit: normalizedUnit, reason: 'outside_requested_window' };
        effectiveBuckets = buckets.filter((bucket) => bucket.end > startMs && bucket.start < endMs);
        if (effectiveBuckets.length === 0) return { status: 'no_data', value: null, unit: normalizedUnit, reason: 'no_data' };
      }
      if (effectiveBuckets.some((bucket) => bucket.change === undefined || bucket.change === null)) return { status: 'partial', value: null, unit: normalizedUnit, reason: 'missing_change' };
      if (effectiveBuckets.some((bucket) => typeof bucket.change !== 'number' || !Number.isFinite(bucket.change))) return { status: 'invalid', value: null, unit: normalizedUnit };
      if (role !== 'cost' && effectiveBuckets.some((bucket) => bucket.change < 0)) return { status: 'invalid', value: null, unit: normalizedUnit };
      for (let index = 1; index < effectiveBuckets.length; index += 1) {
        if (effectiveBuckets[index].start < effectiveBuckets[index - 1].end) return { status: 'invalid', value: null, unit: normalizedUnit };
        if (effectiveBuckets[index].start - effectiveBuckets[index - 1].end > 1000) return { status: 'partial', value: null, unit: normalizedUnit };
      }
      if (startMs !== null && endMs !== null) {
        if (effectiveBuckets[0].start - startMs > 3601000 || endMs - effectiveBuckets[effectiveBuckets.length - 1].end > 3601000) return { status: 'partial', value: null, unit: normalizedUnit, reason: 'incomplete_coverage' };
      }
      let value = effectiveBuckets.reduce((sum, bucket) => sum + bucket.change, 0);
      if (role !== 'cost') {
        if (unit === 'Wh') value /= 1000;
        else if (unit === 'MWh') value *= 1000;
      }
      return Number.isFinite(value) ? { status: 'ready', value, unit: normalizedUnit } : { status: 'invalid', value: null, unit: normalizedUnit };
    }

    _buildDeviceRows(sources) {
      const byId = new Map(sources.map((source) => [source.statistic_id, source]));
      const missingParentIds = new Set(sources.filter((source) => source.included_in_stat && !byId.has(source.included_in_stat)).map((source) => source.statistic_id));
      let relationshipStatus = missingParentIds.size > 0 ? 'nested_parent_missing' : 'valid';
      const visitState = new Map();
      const visit = (source) => {
        const current = visitState.get(source.statistic_id) || 0;
        if (current === 1) return false;
        if (current === 2) return true;
        visitState.set(source.statistic_id, 1);
        if (source.included_in_stat) {
          const parent = byId.get(source.included_in_stat);
          if (parent && !visit(parent)) return false;
        }
        visitState.set(source.statistic_id, 2);
        return true;
      };
      if (sources.some((source) => !visit(source))) relationshipStatus = 'invalid_relationship';
      if (relationshipStatus === 'invalid_relationship') return { rows: sources.map((source) => ({ ...source, relationship_status: 'invalid_relationship', depth: 0 })), relationship_status: relationshipStatus, top_ranking_available: false };
      if (relationshipStatus === 'nested_parent_missing') return {
        rows: sources.map((source) => ({ ...source, relationship_status: missingParentIds.has(source.statistic_id) ? 'nested_parent_missing' : 'valid', depth: missingParentIds.has(source.statistic_id) ? 1 : 0 })),
        relationship_status: relationshipStatus,
        top_ranking_available: false,
      };
      const children = new Map();
      for (const source of sources) if (source.included_in_stat) {
        if (!children.has(source.included_in_stat)) children.set(source.included_in_stat, []);
        children.get(source.included_in_stat).push(source);
      }
      const valueOrder = (left, right) => (right.status === 'ready' ? right.value : Number.NEGATIVE_INFINITY) - (left.status === 'ready' ? left.value : Number.NEGATIVE_INFINITY) || left.statistic_id.localeCompare(right.statistic_id);
      const roots = sources.filter((source) => !source.included_in_stat).sort(valueOrder); const rows = [];
      const append = (source, depth) => { rows.push({ ...source, depth }); for (const child of (children.get(source.statistic_id) || []).sort(valueOrder)) append(child, depth + 1); };
      for (const root of roots) append(root, 0);
      return { rows, relationship_status: 'valid', top_ranking_available: true };
    }

    _calculateCost(total, costSources, config) {
      const configured = Array.isArray(costSources) ? costSources : [];
      if (configured.length > 0) {
        if (configured.some((source) => source.reason === 'incompatible_currency_metadata')) return { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: 'currency_mismatch' };
        if (configured.some((source) => source.status !== 'ready')) return { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: 'partial_cost' };
        const currencies = [...new Set(configured.map((source) => source.unit))];
        if (currencies.length !== 1) return { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: 'currency_mismatch' };
        return { value: configured.reduce((sum, source) => sum + source.value, 0), currency: currencies[0], method: 'cost_statistics', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: null };
      }
      if (typeof config.energy_price !== 'number' || !Number.isFinite(config.energy_price) || config.energy_price < 0) return { value: null, currency: config.currency || null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'missing_rate' };
      if (typeof config.currency !== 'string' || !config.currency.trim()) return { value: null, currency: null, method: 'unavailable', rate: config.energy_price, source_statistic_ids: [], reason: 'missing_currency' };
      if (!total || typeof total.value !== 'number' || !Number.isFinite(total.value)) return { value: null, currency: config.currency, method: 'unavailable', rate: config.energy_price, source_statistic_ids: [], reason: 'energy_data_unavailable' };
      return { value: total.value * config.energy_price, currency: config.currency, method: 'flat_rate_estimate', rate: config.energy_price, source_statistic_ids: Array.isArray(total.source_statistic_ids) ? [...total.source_statistic_ids] : [], reason: null };
    }

    async _loadEnergy() {
      const generation = ++this._energyRequestGeneration;
      const period = this._periodDescriptor();
      const mode = this._config.energy_source_mode === 'explicit' ? 'explicit' : 'energy_dashboard';
      this._setEnergyViewState({ status: 'loading', period, source_mode: mode, total: { value: null, unit: 'kWh', source_statistic_ids: [] }, cost: { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'loading' }, devices: [], warnings: [] });
      try {
        const selection = mode === 'explicit' ? this._explicitSources() : await this._dashboardSources(generation);
        if (!selection || !this._isCurrentEnergyRequest(generation)) return;
        if (selection.totals.length === 0) {
          this._setEnergyViewState({ status: 'not_configured', period, source_mode: selection.source_mode, total: { value: null, unit: 'kWh', source_statistic_ids: [] }, cost: { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'not_configured' }, devices: [], total_sources: [], cost_sources: [], warnings: [...(selection.warnings || [])] });
          return;
        }
        const ids = selection.ordered.map((source) => source.statistic_id);
        const metadataResponse = await this._hass.callWS({ type: 'recorder/get_statistics_metadata', statistic_ids: ids });
        if (!this._isCurrentEnergyRequest(generation)) return;
        const statisticsResponse = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: period.start, end_time: period.end, statistic_ids: ids, period: 'hour', types: ['change'] });
        if (!this._isCurrentEnergyRequest(generation)) return;
        const metadataById = this._metadataMap(metadataResponse); const statisticsById = statisticsResponse && typeof statisticsResponse === 'object' ? statisticsResponse : {};
        const window = { start: new Date(period.start), end: new Date(period.end) };
        const expectedCurrency = this._hass && this._hass.config && this._hass.config.currency;
        const roleReferences = [...selection.totals, ...selection.costs, ...selection.devices];
        const summaryByRole = new Map(roleReferences.map((source) => [`${source.role}:${source.statistic_id}`, this._summarizeSeries(statisticsById[source.statistic_id], metadataById[source.statistic_id], window, source.role, expectedCurrency)]));
        const materialize = (source) => ({ ...source, ...summaryByRole.get(`${source.role}:${source.statistic_id}`), label: source.label || source.statistic_id });
        const totalSources = selection.totals.map(materialize);
        const costSources = selection.costs.map(materialize);
        const deviceSources = selection.devices.map(materialize);
        let status = 'ready';
        if (totalSources.every((source) => source.status === 'no_data')) status = 'no_data';
        else if (totalSources.every((source) => source.status === 'unsupported')) status = 'unsupported';
        else if (totalSources.some((source) => source.status !== 'ready')) status = 'partial';
        const completeTotal = status === 'ready'
          ? { status: 'ready', value: totalSources.reduce((sum, source) => sum + source.value, 0), unit: 'kWh', source_statistic_ids: totalSources.map((source) => source.statistic_id) }
          : { status, value: null, unit: 'kWh', source_statistic_ids: totalSources.map((source) => source.statistic_id) };
        let cost = this._calculateCost(completeTotal, costSources, this._config);
        if (selection.cost_configuration_incomplete) cost = { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: costSources.map((source) => source.statistic_id), reason: 'partial_cost' };
        if (status !== 'ready') {
          const reason = status === 'no_data' ? 'no_data' : (status === 'unsupported' ? 'unsupported_source' : 'partial_energy');
          cost = { ...cost, value: null, method: 'unavailable', reason };
        }
        const deviceModel = this._buildDeviceRows(deviceSources);
        const deviceDataStatus = deviceSources.some((source) => source.status !== 'ready') ? 'partial' : 'ready';
        const warnings = [...(selection.warnings || [])];
        if (deviceModel.relationship_status !== 'valid') warnings.push(deviceModel.relationship_status);
        this._setEnergyViewState({ status, period, source_mode: selection.source_mode, total: completeTotal, cost, devices: deviceModel.rows, total_sources: totalSources, cost_sources: costSources, device_data_status: deviceDataStatus, device_relationship_status: deviceModel.relationship_status, top_ranking_available: deviceModel.top_ranking_available, warnings });
      } catch (error) {
        if (this._isCurrentEnergyRequest(generation)) this._setEnergyViewState(this._errorState(error, period));
      }
    }

    _setEnergyViewState(state) { this._energyViewState = state; if (this._scaffoldRendered && this._activeTab === 'energy') this._renderEnergyState(); }

    _stateBlock(title, detail, className, role) {
      const block = document.createElement('section'); block.className = `state ${className || ''}`.trim(); if (role) block.setAttribute('role', role);
      const heading = document.createElement('h3'); heading.textContent = title; block.appendChild(heading);
      if (detail) { const paragraph = document.createElement('p'); paragraph.className = 'muted'; paragraph.textContent = detail; block.appendChild(paragraph); }
      return block;
    }

    _renderEnergyState() {
      if (!this._scaffoldRendered) return;
      const container = this.shadowRoot.getElementById('content'); const state = this._energyViewState || { status: 'idle' };
      const exportable = ['ready', 'partial', 'no_data'].includes(state.status);
      this.shadowRoot.getElementById('exportJsonBtn').disabled = !exportable; this.shadowRoot.getElementById('exportCsvBtn').disabled = !exportable; container.replaceChildren();
      if (state.status === 'loading' || state.status === 'idle') { container.appendChild(this._stateBlock('Loading recorder statistics…', 'This report uses recorded changes for the selected local-calendar period.', '', 'status')); return; }
      if (state.status === 'not_configured') {
        const block = this._stateBlock('Configure Energy Dashboard or select explicit statistics.', 'Smart Reports does not discover sensors by substring and does not use live entity states.', '', 'status');
        for (const warningText of state.warnings || []) { const warning = document.createElement('p'); warning.className = 'warning'; warning.textContent = warningText; block.appendChild(warning); }
        const link = document.createElement('a'); link.className = 'fixed-link'; link.href = '/config/energy'; link.textContent = 'Open Energy configuration'; block.appendChild(link); container.appendChild(block); return;
      }
      if (state.status === 'unsupported') { container.appendChild(this._stateBlock('Recorder statistics are unavailable on this Home Assistant instance.', 'Check recorder support and the selected statistic metadata.', 'error', 'alert')); return; }
      if (state.status === 'permission_denied') { container.appendChild(this._stateBlock('Your account cannot read the selected statistics.', 'Use an account with recorder statistics access.', 'error', 'alert')); return; }
      if (state.status === 'error') {
        const block = this._stateBlock('Couldn’t load energy statistics.', 'The previous period is not shown as current data.', 'error', 'alert');
        const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Technical details'; const code = document.createElement('code'); code.textContent = state.code == null ? 'unknown_error' : String(state.code); details.append(summary, code); block.appendChild(details);
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'action'; retry.textContent = 'Retry'; retry.addEventListener('click', () => this._scheduleRefresh(true), { once: true }); block.appendChild(retry); container.appendChild(block); return;
      }
      if (state.status === 'no_data') { container.appendChild(this._stateBlock('No recorded energy change in this period.', 'Measured zero is rendered separately; this state means no recorder samples were available.', '', 'status')); return; }
      if (state.status === 'partial') container.appendChild(this._stateBlock('Partial data — totals and cost are withheld.', 'At least one required statistic was missing, invalid, incomplete, or used an incompatible currency.', 'partial', 'status'));
      if (!['ready', 'partial'].includes(state.status)) return;
      const period = state.period || {}; const context = document.createElement('p'); context.className = 'muted report-context';
      const timeZone = period.time_zone || this._timeZone();
      const periodLabel = period.key === '1d' ? 'Today' : (period.key === '30d' ? '30 days' : (period.key === '7d' ? '7 days' : (period.key || '—')));
      context.textContent = `Period: ${periodLabel} · ${this._formatPeriodDate(period.start, timeZone)} – ${this._formatPeriodDate(period.end, timeZone)} · Time zone: ${timeZone} · Sources: ${(state.total_sources || []).length} total, ${(state.cost_sources || []).length} cost`;
      context.dataset.periodStart = period.start || '';
      context.dataset.periodEnd = period.end || '';
      context.title = `Exact recorder window: ${period.start || '—'} → ${period.end || '—'}`;
      container.appendChild(context);
      const summary = document.createElement('section'); summary.className = 'summary';
      summary.appendChild(this._metric('Grid import', `${this._formatNumber(state.total.value, 1)} ${state.total.unit || 'kWh'}`));
      const costLabel = state.cost && state.cost.method === 'cost_statistics' ? 'Actual cost' : (state.cost && state.cost.method === 'flat_rate_estimate' ? 'Estimated cost' : 'Cost unavailable');
      const costValue = state.cost && typeof state.cost.value === 'number' ? `${this._formatNumber(state.cost.value, 2)} ${state.cost.currency || ''}`.trim() : '—';
      summary.appendChild(this._metric(costLabel, costValue)); container.appendChild(summary);
      const deviceSection = document.createElement('section'); deviceSection.className = 'section'; const deviceHeading = document.createElement('h3'); deviceHeading.textContent = state.top_ranking_available === false ? 'Device breakdown unavailable' : (state.device_data_status === 'partial' ? 'Reported devices — partial' : 'Device breakdown'); deviceSection.appendChild(deviceHeading);
      const list = document.createElement('div'); list.className = 'list';
      for (const device of state.devices || []) {
        const row = document.createElement('div'); row.className = `row${device.depth > 0 ? ' child' : ''}`; const name = document.createElement('span'); name.className = 'row-name'; name.textContent = device.label || device.statistic_id; const value = document.createElement('span'); value.className = device.status === 'ready' ? 'status-ready' : 'warning'; value.textContent = device.status === 'ready' ? `${this._formatNumber(device.value, 1)} ${device.unit || 'kWh'}` : device.status; row.append(name, value); list.appendChild(row);
      }
      if ((state.devices || []).length === 0) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No device statistics are configured.'; list.appendChild(empty); }
      deviceSection.appendChild(list); container.appendChild(deviceSection);
      const evidence = document.createElement('section'); evidence.className = 'section';
      const evidenceHeading = document.createElement('h3'); evidenceHeading.textContent = 'Source evidence'; evidence.appendChild(evidenceHeading);
      const evidenceList = document.createElement('div'); evidenceList.className = 'list';
      for (const source of [...(state.total_sources || []), ...(state.cost_sources || [])]) {
        const row = document.createElement('div'); row.className = 'row';
        const name = document.createElement('span'); name.className = 'row-name'; const sourceLabel = source.label || source.statistic_id; name.textContent = sourceLabel === source.statistic_id ? source.statistic_id : `${sourceLabel} (${source.statistic_id})`;
        const detail = document.createElement('span'); detail.className = source.status === 'ready' ? 'status-ready' : 'warning'; detail.textContent = source.reason ? `${source.status}: ${source.reason}` : source.status;
        row.append(name, detail); evidenceList.appendChild(row);
      }
      for (const warningText of state.warnings || []) { const warning = document.createElement('p'); warning.className = 'warning'; warning.textContent = warningText; evidenceList.appendChild(warning); }
      evidence.appendChild(evidenceList); container.appendChild(evidence);
    }

    _metric(labelText, valueText) {
      const metric = document.createElement('div'); metric.className = 'metric'; const label = document.createElement('div'); label.className = 'metric-label'; label.textContent = labelText; const value = document.createElement('div'); value.className = 'metric-value'; value.textContent = valueText; metric.append(label, value); return metric;
    }

    _formatNumber(value, digits) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      try { return new Intl.NumberFormat(this._hass && this._hass.language ? this._hass.language : navigator.language, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); } catch (_error) { return value.toFixed(digits); }
    }

    _formatPeriodDate(value, timeZone) {
      const date = asDate(value);
      if (!date) return '—';
      const language = this._hass && this._hass.language ? this._hass.language : navigator.language;
      try { return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone }).format(date); } catch (_error) { return date.toISOString().slice(0, 10); }
    }

    _timeAgo(value) {
      const date = asDate(value);
      if (!date) return 'Never';
      const now = asDate(this._now()) || new Date();
      const difference = Math.max(0, now.getTime() - date.getTime());
      if (difference < 60000) return 'now';
      if (difference < 3600000) return `${Math.floor(difference / 60000)}m`;
      if (difference < 86400000) return `${Math.floor(difference / 3600000)}h`;
      return `${Math.floor(difference / 86400000)}d`;
    }

    _renderAutomations() {
      if (!this._scaffoldRendered || this._activeTab !== 'automations') return;
      const container = this.shadowRoot.getElementById('content'); container.replaceChildren(); const states = this._hass && this._hass.states ? this._hass.states : {};
      const automations = Object.entries(states).filter(([entityId]) => entityId.startsWith('automation.')).map(([entityId, state]) => ({ entity_id: entityId, label: state && state.attributes && state.attributes.friendly_name ? String(state.attributes.friendly_name) : entityId, state: state && state.state != null ? String(state.state) : 'unknown', last_triggered: state && state.attributes ? state.attributes.last_triggered : null })).sort((left, right) => {
        const leftTime = asDate(left.last_triggered); const rightTime = asDate(right.last_triggered);
        if (leftTime && rightTime) return rightTime - leftTime;
        if (leftTime) return -1;
        if (rightTime) return 1;
        return left.label.localeCompare(right.label);
      });
      const now = asDate(this._now()) || new Date();
      const active = automations.filter((automation) => automation.state === 'on').length;
      const disabled = automations.filter((automation) => automation.state === 'off').length;
      const triggeredToday = automations.filter((automation) => {
        const triggered = asDate(automation.last_triggered);
        return triggered && now - triggered < 86400000;
      }).length;
      const summary = document.createElement('div'); summary.className = 'summary'; summary.append(this._metric('Total automations', String(automations.length)), this._metric('Active', String(active)), this._metric('Disabled', String(disabled)), this._metric('Triggered today', String(triggeredToday))); container.appendChild(summary);
      const heading = document.createElement('h3'); heading.className = 'section'; heading.textContent = 'Recent activity'; container.appendChild(heading); const list = document.createElement('div'); list.className = 'list';
      for (const automation of automations.slice(0, 10)) { const row = document.createElement('div'); row.className = 'row'; const name = document.createElement('span'); name.className = 'row-name'; name.textContent = automation.label; const status = document.createElement('span'); status.textContent = `${this._timeAgo(automation.last_triggered)} · ${automation.state}`; row.append(name, status); list.appendChild(row); }
      if (automations.length === 0) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No automation entities are available.'; list.appendChild(empty); }
      container.appendChild(list);
    }

    _renderSystem() {
      if (!this._scaffoldRendered || this._activeTab !== 'system') return;
      const container = this.shadowRoot.getElementById('content'); container.replaceChildren(); const states = this._hass && this._hass.states ? this._hass.states : {}; const entries = Object.entries(states);
      const unavailable = entries.filter(([, state]) => state && state.state === 'unavailable').length; const unknown = entries.filter(([, state]) => state && state.state === 'unknown').length; const domains = new Map();
      for (const [entityId] of entries) { const domain = entityId.split('.')[0]; domains.set(domain, (domains.get(domain) || 0) + 1); }
      const heading = document.createElement('h3'); heading.textContent = 'System overview'; container.appendChild(heading); const summary = document.createElement('div'); summary.className = 'summary section';
      for (const [label, value] of [['Entities', entries.length], ['Unavailable', unavailable], ['Unknown', unknown], ['Domains', domains.size]]) summary.appendChild(this._metric(label, String(value)));
      container.appendChild(summary); const list = document.createElement('div'); list.className = 'list section';
      for (const [domain, count] of [...domains.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) { const row = document.createElement('div'); row.className = 'row'; const label = document.createElement('span'); label.textContent = domain; const value = document.createElement('span'); value.textContent = String(count); row.append(label, value); list.appendChild(row); }
      container.appendChild(list);
      const healthHeading = document.createElement('h3'); healthHeading.className = 'section'; healthHeading.textContent = 'Health check'; container.appendChild(healthHeading);
      const health = document.createElement('div'); health.className = 'list'; const divisor = Math.max(entries.length, 1);
      for (const [labelText, valueText] of [
        ['Entity availability', `${(((entries.length - unavailable) / divisor) * 100).toFixed(1)}%`],
        ['Known states', `${(((entries.length - unknown) / divisor) * 100).toFixed(1)}%`],
        ['Total entities', String(entries.length)],
        ['Unavailable', String(unavailable)],
        ['Unknown', String(unknown)],
      ]) {
        const row = document.createElement('div'); row.className = 'row'; const label = document.createElement('span'); label.textContent = labelText; const value = document.createElement('span'); value.textContent = valueText; row.append(label, value); health.appendChild(row);
      }
      container.appendChild(health);
    }

    _buildExportDocument(nowValue) {
      const state = this._energyViewState || {}; const period = state.period || this._periodDescriptor(); const total = state.total || {}; const cost = state.cost || {}; const generated = asDate(nowValue) || new Date();
      return {
        schema_version: 2,
        generated_at: generated.toISOString(),
        period: { key: period.key || this._period, start: period.start || null, end: period.end || null, time_zone: period.time_zone || this._timeZone() },
        source_mode: state.source_mode || (this._config.energy_source_mode === 'explicit' ? 'explicit' : 'energy_dashboard'),
        energy: {
          status: state.status || 'error',
          total: { label: 'Grid import', value: typeof total.value === 'number' && Number.isFinite(total.value) ? total.value : null, unit: total.unit || 'kWh', source_statistic_ids: Array.isArray(total.source_statistic_ids) ? [...total.source_statistic_ids] : [] },
          cost: { value: typeof cost.value === 'number' && Number.isFinite(cost.value) ? cost.value : null, currency: cost.currency || null, method: cost.method || 'unavailable', rate: typeof cost.rate === 'number' && Number.isFinite(cost.rate) ? cost.rate : null, source_statistic_ids: Array.isArray(cost.source_statistic_ids) ? [...cost.source_statistic_ids] : [], reason: cost.reason || null },
          total_sources: (state.total_sources || []).map((source) => this._exportSource(source)),
          cost_sources: (state.cost_sources || []).map((source) => this._exportSource(source)),
          devices: (state.devices || []).map((device) => ({ statistic_id: device.statistic_id, label: device.label || device.statistic_id, value: typeof device.value === 'number' && Number.isFinite(device.value) ? device.value : null, unit: device.unit || 'kWh', status: device.status || 'invalid', provenance: device.provenance || 'unknown', included_in_stat: device.included_in_stat || null })),
          warnings: Array.isArray(state.warnings) ? state.warnings.map(String) : [],
        },
      };
    }

    _exportSource(source) {
      return { statistic_id: source.statistic_id, label: source.label || source.statistic_id, role: source.role, value: typeof source.value === 'number' && Number.isFinite(source.value) ? source.value : null, unit: source.unit || null, status: source.status || 'invalid', provenance: source.provenance || 'unknown', included_in_stat: source.included_in_stat || null, reason: source.reason || null };
    }

    _csvCell(value) {
      let text = value == null ? '' : String(value); let forceQuote = false;
      if (/^[=+\-@]/.test(text)) { text = `'${text}`; forceQuote = true; }
      return forceQuote || /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    _buildCsv(documentValue) {
      const report = documentValue || this._buildExportDocument(this._now());
      const header = ['schema_version', 'generated_at', 'period_key', 'period_start', 'period_end', 'time_zone', 'section', 'metric', 'statistic_id', 'label', 'value', 'unit', 'status', 'provenance', 'included_in_stat', 'reason'];
      const base = [report.schema_version, report.generated_at, report.period.key, report.period.start, report.period.end, report.period.time_zone]; const rows = [header];
      rows.push([...base, 'energy', 'total', report.energy.total.source_statistic_ids.join('|'), report.energy.total.label, report.energy.total.value, report.energy.total.unit, report.energy.status, report.source_mode, '', '']);
      rows.push([...base, 'energy', 'cost', report.energy.cost.source_statistic_ids.join('|'), report.energy.cost.method, report.energy.cost.value, report.energy.cost.currency, report.energy.cost.value == null ? (report.energy.cost.reason || 'unavailable') : 'ready', report.energy.cost.method, '', report.energy.cost.reason]);
      for (const source of report.energy.total_sources || []) rows.push([...base, 'energy', 'total_source', source.statistic_id, source.label, source.value, source.unit, source.status, source.provenance, source.included_in_stat, source.reason]);
      for (const source of report.energy.cost_sources || []) rows.push([...base, 'energy', 'cost_source', source.statistic_id, source.label, source.value, source.unit, source.status, source.provenance, source.included_in_stat, source.reason]);
      for (const device of report.energy.devices) rows.push([...base, 'energy', 'device', device.statistic_id, device.label, device.value, device.unit, device.status, device.provenance, device.included_in_stat, '']);
      return `${rows.map((row) => row.map((value) => this._csvCell(value)).join(',')).join('\n')}\n`;
    }

    _downloadExport(format) {
      const state = this._energyViewState || {}; if (!['ready', 'partial', 'no_data'].includes(state.status)) return;
      const report = this._buildExportDocument(this._now()); this._lastExportDocument = report; this._lastDownloadedExport = report; const isJson = format === 'json'; const contents = isJson ? `${JSON.stringify(report, null, 2)}\n` : this._buildCsv(report); const blob = new Blob([contents], { type: isJson ? 'application/json' : 'text/csv' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `smart-report-${report.period.key}.${isJson ? 'json' : 'csv'}`; anchor.click(); URL.revokeObjectURL(url);
    }
  }

  class HASmartReportsEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this._config = {}; }
    setConfig(config) { this._config = config && typeof config === 'object' ? { ...config } : {}; this._render(); }
    set hass(hass) { this._hass = hass; }
    _render() {
      this.shadowRoot.replaceChildren();
      const style = document.createElement('style'); style.textContent = ':host{display:grid;gap:12px;padding:12px;color:var(--primary-text-color,#172033);font-family:system-ui,sans-serif}label{display:grid;gap:5px}input{font:inherit;padding:9px;border:1px solid var(--divider-color,#d9e0ea);border-radius:8px;background:var(--card-background-color,#fff);color:inherit}input:focus-visible{outline:2px solid var(--primary-color,#3b82f6);outline-offset:2px}';
      const field = (id, labelText, key) => { const label = document.createElement('label'); label.textContent = labelText; const input = document.createElement('input'); input.id = id; input.value = typeof this._config[key] === 'string' ? this._config[key] : ''; input.addEventListener('input', () => { this._config = { ...this._config, [key]: input.value }; this._dispatch(); }); label.appendChild(input); return label; };
      this.shadowRoot.append(style, field('cf_title', 'Title', 'title'), field('cf_currency', 'Currency', 'currency'));
    }
    _dispatch() { this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { ...this._config } }, bubbles: true, composed: true })); }
  }

  customElements.define('ha-smart-reports', HASmartReports);
  customElements.define('ha-smart-reports-editor', HASmartReportsEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === 'ha-smart-reports')) window.customCards.push({ type: 'ha-smart-reports', name: 'Smart Reports', description: 'Recorder-backed energy, automation, and system reports', preview: true, documentationURL: 'https://github.com/MacSiem/ha-smart-reports' });
  console.info(`%c HA-SMART-REPORTS %c v${VERSION} `, 'color: white; background: #2563eb; font-weight: 700;', 'color: #2563eb; background: #dbeafe;');
})();
