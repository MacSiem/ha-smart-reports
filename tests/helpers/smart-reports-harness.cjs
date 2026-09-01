'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_PATH = process.env.SMART_REPORTS_SOURCE_PATH
  ? path.resolve(ROOT, process.env.SMART_REPORTS_SOURCE_PATH)
  : path.join(ROOT, 'ha-smart-reports.js');
const FIXED_NOW = new Date('2026-08-30T12:00:00.000Z');

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubBrowser(window) {
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    get: () => 'en-US',
  });
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  window.URL.createObjectURL = () => 'blob:smart-report';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {
    this.dataset.clicked = 'true';
  };
}

function loadRuntime(sourcePath = SOURCE_PATH) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/lovelace/demo',
  });
  stubBrowser(dom.window);
  dom.window.eval(fs.readFileSync(sourcePath, 'utf8'));
  return dom;
}

function metadata(unit = 'kWh', extra = {}) {
  return {
    has_sum: true,
    unit_class: unit === 'Wh' || unit === 'kWh' || unit === 'MWh' ? 'energy' : undefined,
    statistics_unit_of_measurement: unit,
    ...extra,
  };
}

function calendarSeries(start, end, changes, extra = {}) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  assert.ok(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs);
  const bucketCount = Math.max(1, Math.ceil((endMs - startMs) / 3600000));
  const values = Array.isArray(changes) ? changes : [changes];
  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = startMs + index * 3600000;
    const bucketEnd = Math.min(endMs, bucketStart + 3600000);
    return {
      start: bucketStart,
      end: bucketEnd,
      change: index < values.length ? values[index] : 0,
      ...extra,
    };
  });
}

function makeHass({
  prefs = null,
  info = null,
  metadataById = {},
  statisticsById = {},
  states = {},
  timeZone = 'Europe/Warsaw',
  errors = {},
  deferred = {},
} = {}) {
  const calls = [];
  const hass = {
    language: 'en',
    themes: { darkMode: false },
    config: { time_zone: timeZone, version: '2026.8.0', currency: 'PLN' },
    user: { id: 'demo_user', name: 'Demo User', is_admin: true },
    states,
    callWS(message) {
      calls.push(structuredClone(message));
      const type = message.type;
      if (deferred[type]) return deferred[type](message);
      if (errors[type]) return Promise.reject(errors[type]);
      if (type === 'energy/get_prefs') return Promise.resolve(prefs);
      if (type === 'energy/info') return Promise.resolve(info || { cost_sensors: {} });
      if (type === 'recorder/get_statistics_metadata') return Promise.resolve(metadataById);
      if (type === 'recorder/statistics_during_period') return Promise.resolve(statisticsById);
      return Promise.reject(Object.assign(new Error(`unexpected callWS: ${type}`), { code: 'unknown_command' }));
    },
  };
  hass.calls = calls;
  return hass;
}

async function mountCard({ config = {}, hass, sourcePath = SOURCE_PATH, throttleMs = 0 } = {}) {
  const dom = loadRuntime(sourcePath);
  const { window } = dom;
  const card = window.document.createElement('ha-smart-reports');
  card._refreshThrottleMs = throttleMs;
  card._now = () => new Date(FIXED_NOW);
  card.setConfig({ type: 'custom:ha-smart-reports', ...config });
  window.document.body.appendChild(card);
  if (hass) card.hass = hass;
  await waitForSettled(card);
  return { dom, window, card, hass };
}

async function waitForSettled(card, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  do {
    await delay(5);
    if (card._energyViewState && card._energyViewState.status !== 'loading') return card._energyViewState;
  } while (Date.now() < deadline);
  return card._energyViewState;
}

function callsOf(hass, type) {
  return hass.calls.filter((call) => call.type === type);
}

function explicitConfig(overrides = {}) {
  return {
    energy_source_mode: 'explicit',
    energy_total_statistics: ['sensor.grid_import'],
    energy_device_statistics: [],
    energy_cost_statistics: [],
    ...overrides,
  };
}

function sourceIdsFromStatisticsCall(hass) {
  const calls = callsOf(hass, 'recorder/statistics_during_period');
  return calls.length ? calls.at(-1).statistic_ids : [];
}

module.exports = {
  FIXED_NOW,
  ROOT,
  SOURCE_PATH,
  calendarSeries,
  callsOf,
  delay,
  explicitConfig,
  loadRuntime,
  makeHass,
  metadata,
  mountCard,
  sourceIdsFromStatisticsCall,
  waitForSettled,
};
