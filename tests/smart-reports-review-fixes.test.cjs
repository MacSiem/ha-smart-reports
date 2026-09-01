'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FIXED_NOW,
  calendarSeries,
  callsOf,
  explicitConfig,
  loadRuntime,
  makeHass,
  metadata,
  mountCard,
} = require('./helpers/smart-reports-harness.cjs');

const ROOT = path.resolve(__dirname, '..');

function statistics(values) {
  return (message) => Promise.resolve(Object.fromEntries(message.statistic_ids.map((id) => [
    id,
    calendarSeries(message.start_time, message.end_time, [values[id] ?? 0]),
  ])));
}

function freshCard() {
  const dom = loadRuntime();
  return { dom, card: dom.window.document.createElement('ha-smart-reports') };
}

test('F01 validates role metadata and HA currency, and same-id cross-role fails closed', async () => {
  const { dom, card } = freshCard();
  const window = { start: new Date(0), end: new Date(3600000) };
  const series = [{ start: 0, end: 3600000, change: 2 }];
  assert.equal(card._summarizeSeries(series, metadata('kWh', { unit_class: 'power' }), window, 'total', 'PLN').status, 'unsupported');
  assert.equal(card._summarizeSeries(series, metadata('m³', { unit_class: 'volume' }), window, 'cost', 'PLN').status, 'unsupported');
  assert.equal(card._summarizeSeries(series, metadata('kWh', { unit_class: null }), window, 'total', 'PLN').status, 'ready');
  assert.equal(card._summarizeSeries(series, metadata('PLN', { unit_class: null }), window, 'cost', 'PLN').status, 'ready');
  assert.equal(card._summarizeSeries(series, metadata('PLN', { unit_class: 'currency' }), window, 'cost', 'PLN').status, 'ready');
  assert.equal(card._summarizeSeries(series, metadata('EUR', { unit_class: null }), window, 'cost', 'PLN').status, 'unsupported');
  dom.window.close();

  const hass = makeHass({
    metadataById: { 'sensor.shared': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': statistics({ 'sensor.shared': 4 }) },
  });
  hass.config.currency = 'PLN';
  const mounted = await mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: ['sensor.shared'], energy_cost_statistics: ['sensor.shared'] }),
  });
  assert.equal(mounted.card._energyViewState.cost.method, 'unavailable');
  assert.equal(mounted.card._energyViewState.cost.value, null);
  mounted.card.remove(); mounted.dom.window.close();
});

test('F02 partial UI, JSON v2 and CSV retain per-source evidence and safe hostile labels', async () => {
  const hass = makeHass({
    metadataById: {
      'sensor.grid': metadata('kWh'),
      'sensor.cost': metadata('PLN', { unit_class: null }),
    },
    deferred: {
      'recorder/statistics_during_period': (message) => Promise.resolve({
        'sensor.grid': [{ start: message.start_time, end: message.end_time, change: 4 }],
        'sensor.cost': [{ start: message.start_time, end: message.end_time }],
      }),
    },
  });
  hass.config.currency = 'PLN';
  const hostile = '<img src=x onerror=globalThis.pwned=1>';
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: [{ statistic_id: 'sensor.grid', label: hostile }],
      energy_cost_statistics: [{ statistic_id: 'sensor.cost', label: '=COST' }],
    }),
  });
  assert.equal(card._energyViewState.status, 'ready');
  assert.equal(card._energyViewState.cost.reason, 'partial_cost');
  assert.match(card.shadowRoot.textContent, /sensor\.cost/);
  assert.equal(card.shadowRoot.querySelector('img'), null);
  const document = JSON.parse(JSON.stringify(card._buildExportDocument(FIXED_NOW)));
  assert.deepEqual(document.energy.warnings, []);
  assert.deepEqual(document.energy.total_sources, [{
    statistic_id: 'sensor.grid', label: hostile, role: 'total', value: 4, unit: 'kWh', status: 'ready', provenance: 'explicit', included_in_stat: null, reason: null,
  }]);
  assert.deepEqual(document.energy.cost_sources, [{
    statistic_id: 'sensor.cost', label: '=COST', role: 'cost', value: null, unit: 'PLN', status: 'partial', provenance: 'explicit', included_in_stat: null, reason: 'missing_change',
  }]);
  const csv = card._buildCsv(document);
  assert.match(csv, /energy,cost,sensor\.cost,unavailable,,,partial_cost,unavailable,,partial_cost/);
  assert.match(csv, /energy,total_source,sensor\.grid/);
  assert.match(csv, /energy,cost_source,sensor\.cost/);
  assert.match(csv, /partial,explicit,,missing_change/);
  assert.doesNotMatch(csv, /,"=COST"/);
  card.remove(); dom.window.close();
});

test('F03 current Energy prefs map name and fill only missing grid costs from energy info', async () => {
  const prefs = {
    energy_sources: [
      { type: 'grid', stat_energy_from: 'sensor.grid_a', stat_cost: 'sensor.direct_cost' },
      { type: 'grid', stat_energy_from: 'sensor.grid_b' },
    ],
    device_consumption: [{ statistic_id: 'sensor.device', name: 'Heat pump' }],
  };
  const ids = ['sensor.grid_a', 'sensor.grid_b', 'sensor.direct_cost', 'sensor.mapped_cost', 'sensor.device'];
  const hass = makeHass({
    prefs,
    info: { cost_sensors: { 'sensor.grid_a': 'sensor.wrong', 'sensor.grid_b': { statistic_id: 'sensor.mapped_cost' } } },
    metadataById: Object.fromEntries(ids.map((id) => [id, id.includes('cost') ? metadata('PLN', { unit_class: null }) : metadata('kWh')])),
    deferred: { 'recorder/statistics_during_period': statistics(Object.fromEntries(ids.map((id) => [id, 1]))) },
  });
  hass.config.currency = 'PLN';
  const { card, dom } = await mountCard({ hass, config: { energy_source_mode: 'dashboard' } });
  assert.equal(callsOf(hass, 'energy/info').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(card._energyViewState.cost_sources.map((source) => source.statistic_id))), ['sensor.direct_cost', 'sensor.mapped_cost']);
  assert.equal(card._energyViewState.devices[0].label, 'Heat pump');
  assert.equal(card._energyViewState.cost_sources.some((source) => source.statistic_id === 'sensor.wrong'), false);
  card.remove(); dom.window.close();
});

test('F03 legacy flow_from works with metadata arrays and flow_to is not exported', async () => {
  const prefs = {
    energy_sources: [{
      type: 'grid',
      flow_from: [{ stat_energy_from: 'sensor.legacy_import', stat_cost: 'sensor.legacy_cost' }],
      flow_to: [{ stat_energy_to: 'sensor.export', stat_compensation: 'sensor.compensation' }],
    }],
    device_consumption: [],
  };
  const hass = makeHass({
    prefs,
    deferred: {
      'recorder/get_statistics_metadata': () => Promise.resolve([
        { statistic_id: 'sensor.legacy_import', ...metadata('kWh') },
        { statistic_id: 'sensor.legacy_cost', ...metadata('PLN', { unit_class: null }) },
      ]),
      'recorder/statistics_during_period': statistics({ 'sensor.legacy_import': 3, 'sensor.legacy_cost': 1 }),
    },
  });
  const { card, dom } = await mountCard({ hass, config: { energy_source_mode: 'dashboard' } });
  assert.equal(card._energyViewState.total.value, 3);
  assert.equal(card._energyViewState.cost.value, 1);
  assert.doesNotMatch(JSON.stringify(card._buildExportDocument(FIXED_NOW)), /sensor\.export|sensor\.compensation/);
  card.remove(); dom.window.close();
});

test('F04 included_in_stat on a total source is excluded with a warning', async () => {
  const hass = makeHass({
    metadataById: { 'sensor.root': metadata('kWh'), 'sensor.child': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': statistics({ 'sensor.root': 10, 'sensor.child': 3 }) },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: ['sensor.root', { statistic_id: 'sensor.child', included_in_stat: 'sensor.root' }] }),
  });
  assert.equal(card._energyViewState.total.value, 10);
  assert.match(card._energyViewState.warnings.join(' '), /included_in_stat.*sensor\.child/);
  card.remove(); dom.window.close();
});

test('F05 editor safely edits Title/Currency and emits exact config', () => {
  const dom = loadRuntime();
  const Editor = dom.window.customElements.get('ha-smart-reports-editor');
  const editor = new Editor();
  const initial = { type: 'custom:ha-smart-reports', title: 'Old', currency: 'PLN', show_energy: true };
  editor.setConfig(initial);
  const emitted = [];
  editor.addEventListener('config-changed', (event) => emitted.push(JSON.parse(JSON.stringify(event.detail.config))));
  const title = editor.shadowRoot.querySelector('#cf_title');
  const currency = editor.shadowRoot.querySelector('#cf_currency');
  assert.ok(title && currency);
  title.value = '<img src=x onerror=1>';
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  currency.value = 'EUR';
  currency.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(editor.shadowRoot.querySelector('img'), null);
  assert.deepEqual(emitted.at(-1), { ...initial, title: '<img src=x onerror=1>', currency: 'EUR' });
  assert.deepEqual(initial, { type: 'custom:ha-smart-reports', title: 'Old', currency: 'PLN', show_energy: true });
  dom.window.close();
});

test('F06 tab selection is instance-local and all-disabled performs no HA requests', async () => {
  const dom = loadRuntime();
  const first = dom.window.document.createElement('ha-smart-reports');
  const second = dom.window.document.createElement('ha-smart-reports');
  const config = explicitConfig({ show_energy: true, show_automations: true, show_system: true });
  first.setConfig(config); second.setConfig(config);
  dom.window.document.body.append(first, second);
  first.shadowRoot.querySelector('[data-tab="system"]').click();
  assert.equal(first._activeTab, 'system');
  assert.equal(second._activeTab, 'energy');
  first.remove(); second.remove(); dom.window.close();

  const hass = makeHass();
  const disabled = await mountCard({ hass, config: explicitConfig({ show_energy: false, show_automations: false, show_system: false }) });
  assert.equal(disabled.card._activeTab, null);
  assert.equal(disabled.card.shadowRoot.querySelector('#tabs').hidden, true);
  assert.equal(disabled.card.shadowRoot.querySelector('#energyToolbar').hidden, true);
  assert.match(disabled.card.shadowRoot.textContent, /enable at least one report section/i);
  assert.equal(hass.calls.length, 0);
  disabled.card.remove(); disabled.dom.window.close();
});

test('F09 rejects detached buckets while accepting and ignoring boundary-touching buckets', () => {
  const { dom, card } = freshCard();
  const window = { start: new Date(3600000), end: new Date(7200000) };
  const meta = metadata('kWh');
  assert.equal(card._summarizeSeries([{ start: 0, end: 3599999, change: 100 }], meta, window, 'total', 'PLN').status, 'invalid');
  assert.equal(card._summarizeSeries([{ start: 7200001, end: 10800000, change: 100 }], meta, window, 'total', 'PLN').status, 'invalid');
  const touching = card._summarizeSeries([
    { start: 0, end: 3600000, change: 100 },
    { start: 3600000, end: 7200000, change: 1 },
    { start: 7200000, end: 10800000, change: 100 },
  ], meta, window, 'total', 'PLN');
  assert.deepEqual({ status: touching.status, value: touching.value }, { status: 'ready', value: 1 });
  dom.window.close();
});

test('F07 repository contains no codex-runs artifacts', () => {
  const directory = path.join(ROOT, 'codex-runs');
  assert.deepEqual(fs.existsSync(directory) ? fs.readdirSync(directory) : [], []);
});
