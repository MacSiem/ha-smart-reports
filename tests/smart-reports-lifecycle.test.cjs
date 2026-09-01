'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIXED_NOW,
  calendarSeries,
  callsOf,
  delay,
  explicitConfig,
  loadRuntime,
  makeHass,
  metadata,
  mountCard,
  waitForSettled,
} = require('./helpers/smart-reports-harness.cjs');

function successHass(value = 2, states = {}) {
  return makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    states,
    deferred: {
      'recorder/statistics_during_period': (message) => Promise.resolve({
        'sensor.grid_import': calendarSeries(message.start_time, message.end_time, [value]),
      }),
    },
  });
}

async function mountedShell() {
  return mountCard({ hass: successHass(), config: explicitConfig() });
}

async function waitUntil(predicate, message, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail(message);
}

const fixedPeriod = {
  key: '7d',
  start: '2026-08-23T22:00:00.000Z',
  end: '2026-08-30T12:00:00.000Z',
  time_zone: 'Europe/Warsaw',
};

for (const [status, text] of [
  ['loading', 'Loading recorder statistics'],
  ['not_configured', 'Configure Energy Dashboard'],
  ['unsupported', 'Recorder statistics are unavailable'],
  ['permission_denied', 'cannot read the selected statistics'],
  ['error', 'Couldn’t load energy statistics'],
  ['no_data', 'No recorded energy change'],
  ['partial', 'Partial data'],
  ['ready', 'Grid import'],
]) {
  test(`renders ${status} energy state`, async () => {
    const { card, dom } = await mountedShell();
    const state = status === 'ready'
      ? {
          status,
          period: fixedPeriod,
          source_mode: 'explicit',
          total: { value: 1, unit: 'kWh', source_statistic_ids: ['sensor.grid_import'] },
          cost: { value: null, currency: null, method: 'unavailable', reason: 'missing_rate', source_statistic_ids: [] },
          devices: [], total_sources: [], cost_sources: [], warnings: [],
        }
      : { status, code: 'demo_error', period: fixedPeriod, total: { value: null }, cost: { value: null }, devices: [], warnings: [] };
    card._setEnergyViewState(state);
    assert.match(card.shadowRoot.textContent, new RegExp(text, 'i'));
    card.remove(); dom.window.close();
  });
}

test('zero is rendered differently from no_data', async () => {
  const { card, dom } = await mountCard({ hass: successHass(0), config: explicitConfig() });
  assert.match(card.shadowRoot.textContent, /0\.0\s*kWh/);
  assert.doesNotMatch(card.shadowRoot.textContent, /No recorded energy change/i);
  card._setEnergyViewState({ status: 'no_data', period: fixedPeriod, total: { value: null }, cost: { value: null }, devices: [], warnings: [] });
  assert.match(card.shadowRoot.textContent, /No recorded energy change/i);
  assert.doesNotMatch(card.shadowRoot.textContent, /0\.0\s*kWh/);
  card.remove(); dom.window.close();
});

test('API error never falls back to current entity states', async () => {
  const error = Object.assign(new Error('recorder exploded'), { code: 'unknown_error' });
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    states: { 'sensor.grid_import': { state: '99999', attributes: { unit_of_measurement: 'kWh' } } },
    errors: { 'recorder/statistics_during_period': error },
  });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  assert.equal(card._energyViewState.status, 'error');
  assert.doesNotMatch(card.shadowRoot.textContent, /99999/);
  card.remove(); dom.window.close();
});

test('permission error has a distinct permission_denied state', async () => {
  const error = Object.assign(new Error('Unauthorized'), { code: 401 });
  const hass = makeHass({ errors: { 'recorder/get_statistics_metadata': error } });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  assert.equal(card._energyViewState.status, 'permission_denied');
  card.remove(); dom.window.close();
});

test('unsupported command has a distinct unsupported state', async () => {
  const error = Object.assign(new Error('Unknown command'), { code: 'unknown_command' });
  const hass = makeHass({ errors: { 'recorder/get_statistics_metadata': error } });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  assert.equal(card._energyViewState.status, 'unsupported');
  card.remove(); dom.window.close();
});

test('hostile statistic label remains text', async () => {
  const hostile = '\"\'><img src=x onerror=globalThis.pwned=1>';
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh'), 'sensor.hostile': metadata('kWh') },
    deferred: {
      'recorder/statistics_during_period': (message) => Promise.resolve({
        'sensor.grid_import': calendarSeries(message.start_time, message.end_time, [4]),
        'sensor.hostile': calendarSeries(message.start_time, message.end_time, [2]),
      }),
    },
  });
  const { card, window, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_device_statistics: [{ statistic_id: 'sensor.hostile', label: hostile }] }),
  });
  assert.equal(card.shadowRoot.querySelector('img'), null);
  assert.equal(window.pwned, undefined);
  assert.match(card.shadowRoot.textContent, /<img src=x onerror=globalThis\.pwned=1>/);
  card.remove(); dom.window.close();
});

test('hostile statistic id cannot create an attribute or URL', async () => {
  const hostileId = 'sensor.x\" onclick=\"globalThis.pwned=1';
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh'), [hostileId]: metadata('kWh') },
    deferred: {
      'recorder/statistics_during_period': (message) => Promise.resolve({
        'sensor.grid_import': calendarSeries(message.start_time, message.end_time, [4]),
        [hostileId]: calendarSeries(message.start_time, message.end_time, [1]),
      }),
    },
  });
  const { card, window, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_device_statistics: [{ statistic_id: hostileId, label: 'Hostile ID' }] }),
  });
  assert.equal(card.shadowRoot.querySelector('[onclick]'), null);
  assert.equal(card.shadowRoot.querySelector(`a[href*="sensor.x"]`), null);
  assert.equal(window.pwned, undefined);
  card.remove(); dom.window.close();
});

test('export button is disabled in loading and cannot export the previous period', async () => {
  let resolveStats;
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': () => new Promise((resolve) => { resolveStats = resolve; }) },
  });
  const dom = loadRuntime();
  const { window } = dom;
  const card = window.document.createElement('ha-smart-reports');
  card._refreshThrottleMs = 0;
  card._now = () => new Date(FIXED_NOW);
  card.setConfig(explicitConfig());
  window.document.body.appendChild(card);
  card.hass = hass;
  await delay(20);
  const oldExport = { schema_version: 2, period: { key: '7d' } };
  card._lastExportDocument = oldExport;
  const button = card.shadowRoot.querySelector('#exportJsonBtn');
  assert.equal(card._energyViewState.status, 'loading');
  assert.equal(button.disabled, true);
  button.click();
  assert.equal(card._lastDownloadedExport, undefined);
  resolveStats({ 'sensor.grid_import': [] });
  await delay(20);
  card.remove(); dom.window.close();
});

test('latest period wins when older request resolves last', async () => {
  const requests = [];
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    deferred: {
      'recorder/statistics_during_period': (message) => new Promise((resolve) => requests.push({ message, resolve })),
    },
  });
  const dom = loadRuntime();
  const { window } = dom;
  const card = window.document.createElement('ha-smart-reports');
  card._refreshThrottleMs = 0;
  card._now = () => new Date(FIXED_NOW);
  card.setConfig(explicitConfig());
  window.document.body.appendChild(card);
  card.hass = hass;
  await waitUntil(() => requests.length >= 1, 'initial statistics request was not started');
  const select = card.shadowRoot.querySelector('#periodSelect');
  select.value = '1d';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitUntil(() => requests.length >= 2, 'replacement statistics request was not started');
  requests[1].resolve({ 'sensor.grid_import': calendarSeries(requests[1].message.start_time, requests[1].message.end_time, [1]) });
  await waitForSettled(card);
  requests[0].resolve({ 'sensor.grid_import': calendarSeries(requests[0].message.start_time, requests[0].message.end_time, [7]) });
  await delay(30);
  assert.equal(card._energyViewState.period.key, '1d');
  assert.equal(card._energyViewState.total.value, 1);
  assert.equal(card._buildExportDocument(FIXED_NOW).period.key, '1d');
  card.remove(); dom.window.close();
});

test('disconnect before response prevents DOM mutation', async () => {
  let request;
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': (message) => new Promise((resolve) => { request = { message, resolve }; }) },
  });
  const dom = loadRuntime();
  const { window } = dom;
  const card = window.document.createElement('ha-smart-reports');
  card._refreshThrottleMs = 0;
  card._now = () => new Date(FIXED_NOW);
  card.setConfig(explicitConfig());
  window.document.body.appendChild(card);
  card.hass = hass;
  await waitUntil(() => Boolean(request), 'statistics request was not started');
  card.remove();
  const before = card.shadowRoot.innerHTML;
  request.resolve({ 'sensor.grid_import': calendarSeries(request.message.start_time, request.message.end_time, [9]) });
  await delay(30);
  assert.equal(card.shadowRoot.innerHTML, before);
  dom.window.close();
});

test('disconnect clears the single pending refresh timer', async () => {
  const { card, hass, dom } = await mountCard({ hass: successHass(), config: explicitConfig(), throttleMs: 10000 });
  card.hass = { ...hass };
  assert.notEqual(card._refreshTimer, null);
  card.remove();
  assert.equal(card._refreshTimer, null);
  dom.window.close();
});

test('reattach schedules exactly one refresh and does not duplicate listeners', async () => {
  const { card, hass, window, dom } = await mountCard({ hass: successHass(), config: explicitConfig(), throttleMs: 0 });
  const before = callsOf(hass, 'recorder/statistics_during_period').length;
  card.remove();
  window.document.body.appendChild(card);
  await delay(30);
  const after = callsOf(hass, 'recorder/statistics_during_period').length;
  assert.equal(after - before, 1);
  assert.equal(card.shadowRoot.querySelectorAll('#periodSelect').length, 1);
  card.remove(); dom.window.close();
});

test('two card instances keep timers and request generations isolated', async () => {
  const dom = loadRuntime();
  const { window } = dom;
  const hassA = successHass(1);
  const hassB = successHass(2);
  const cards = [hassA, hassB].map((hass) => {
    const card = window.document.createElement('ha-smart-reports');
    card._refreshThrottleMs = 0;
    card._now = () => new Date(FIXED_NOW);
    card.setConfig(explicitConfig());
    window.document.body.appendChild(card);
    card.hass = hass;
    return card;
  });
  await Promise.all(cards.map((card) => waitForSettled(card)));
  assert.deepEqual(cards.map((card) => card._energyViewState.total.value), [1, 2]);
  const secondGeneration = cards[1]._energyRequestGeneration;
  cards[0]._invalidateEnergyRequest();
  assert.equal(cards[1]._energyRequestGeneration, secondGeneration);
  cards[0].remove();
  assert.equal(cards[1].isConnected, true);
  cards[1].remove(); dom.window.close();
});

test('rapid hass updates coalesce to one refresh with 10 second throttle', async () => {
  const { card, hass, dom } = await mountCard({ hass: successHass(), config: explicitConfig(), throttleMs: 10000 });
  const before = callsOf(hass, 'recorder/statistics_during_period').length;
  card.hass = hass;
  const timer = card._refreshTimer;
  card.hass = hass;
  card.hass = hass;
  assert.notEqual(timer, null);
  assert.equal(card._refreshTimer, timer);
  assert.equal(callsOf(hass, 'recorder/statistics_during_period').length, before);
  card.remove(); dom.window.close();
});

test('switching away from Energy invalidates pending energy request', async () => {
  let pending;
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    states: { 'automation.demo': { state: 'on', attributes: { friendly_name: 'Demo automation' } } },
    deferred: { 'recorder/statistics_during_period': (message) => new Promise((resolve) => { pending = { message, resolve }; }) },
  });
  const dom = loadRuntime();
  const { window } = dom;
  const card = window.document.createElement('ha-smart-reports');
  card._refreshThrottleMs = 0;
  card._now = () => new Date(FIXED_NOW);
  card.setConfig(explicitConfig());
  window.document.body.appendChild(card);
  card.hass = hass;
  await waitUntil(() => Boolean(pending), 'statistics request was not started');
  card.shadowRoot.querySelector('[data-tab="automations"]').click();
  const generation = card._energyRequestGeneration;
  pending.resolve({ 'sensor.grid_import': calendarSeries(pending.message.start_time, pending.message.end_time, [8]) });
  await delay(30);
  assert.equal(card._activeTab, 'automations');
  assert.equal(card._energyRequestGeneration, generation);
  assert.match(card.shadowRoot.textContent, /Demo automation/);
  assert.doesNotMatch(card.shadowRoot.textContent, /8\.0\s*kWh/);
  card.remove(); dom.window.close();
});

test('Automations preserves active, disabled, triggered-today and recent-activity reporting', async () => {
  const hass = successHass(1, {
    'automation.recent': {
      state: 'on',
      attributes: { friendly_name: 'Recent automation', last_triggered: '2026-08-30T11:00:00.000Z', current: 0 },
    },
    'automation.disabled': {
      state: 'off',
      attributes: { friendly_name: 'Disabled automation', last_triggered: null, current: 0 },
    },
  });
  const { card, window, dom } = await mountCard({ hass, config: explicitConfig() });
  card.shadowRoot.querySelector('[data-tab="automations"]').click();
  await delay(10);
  const text = card.shadowRoot.textContent;
  assert.match(text, /Active\s*1/i);
  assert.match(text, /Disabled\s*1/i);
  assert.match(text, /Triggered today\s*1/i);
  assert.match(text, /Recent automation/);
  assert.match(text, /1h/);
  assert.equal(card.shadowRoot.querySelector('[onclick]'), null);
  card.remove(); dom.window.close();
});

test('System preserves domain breakdown and health percentages', async () => {
  const hass = successHass(1, {
    'sensor.good': { state: '1', attributes: {} },
    'sensor.unavailable': { state: 'unavailable', attributes: {} },
    'switch.unknown': { state: 'unknown', attributes: {} },
    'light.good': { state: 'on', attributes: {} },
  });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  card.shadowRoot.querySelector('[data-tab="system"]').click();
  await delay(10);
  const text = card.shadowRoot.textContent;
  assert.match(text, /Entity availability\s*75\.0%/i);
  assert.match(text, /Known states\s*75\.0%/i);
  assert.match(text, /sensor\s*2/i);
  assert.match(text, /switch\s*1/i);
  assert.match(text, /light\s*1/i);
  card.remove(); dom.window.close();
});
