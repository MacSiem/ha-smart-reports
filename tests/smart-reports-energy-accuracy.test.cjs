'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FIXED_NOW,
  ROOT,
  calendarSeries,
  callsOf,
  explicitConfig,
  loadRuntime,
  makeHass,
  metadata,
  mountCard,
  sourceIdsFromStatisticsCall,
} = require('./helpers/smart-reports-harness.cjs');

const prefs = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/energy-dashboard-prefs.json'), 'utf8'));

function statisticsResponder(values, overrides = {}) {
  return (message) => {
    const result = {};
    for (const id of message.statistic_ids) {
      const value = Object.hasOwn(values, id) ? values[id] : 0;
      result[id] = calendarSeries(message.start_time, message.end_time, [value]);
    }
    return Promise.resolve({ ...result, ...overrides });
  };
}

function dashboardMetadata() {
  return {
    'sensor.grid_import': metadata('kWh'),
    'sensor.grid_import_cost': metadata('PLN', { unit_class: undefined }),
    'sensor.hvac_total': metadata('kWh'),
    'sensor.hvac_indoor': metadata('kWh'),
    'sensor.dishwasher': metadata('kWh'),
  };
}

async function mountDashboard(values = {}) {
  const hass = makeHass({
    prefs,
    metadataById: dashboardMetadata(),
    deferred: {
      'recorder/statistics_during_period': statisticsResponder(values),
    },
  });
  return mountCard({ hass, config: { energy_source_mode: 'dashboard' } });
}

test('dashboard mode queries only configured statistics', async () => {
  const { card, hass, dom } = await mountDashboard({
    'sensor.grid_import': 10,
    'sensor.grid_import_cost': 2,
    'sensor.hvac_total': 6,
    'sensor.hvac_indoor': 2,
    'sensor.dishwasher': 1,
  });
  assert.deepEqual(sourceIdsFromStatisticsCall(hass), [
    'sensor.grid_import',
    'sensor.grid_import_cost',
    'sensor.hvac_total',
    'sensor.hvac_indoor',
    'sensor.dishwasher',
  ]);
  assert.equal(sourceIdsFromStatisticsCall(hass).includes('sensor.grid_export'), false);
  assert.equal(sourceIdsFromStatisticsCall(hass).includes('sensor.attic_energy'), false);
  card.remove(); dom.window.close();
});

test('explicit mode never calls energy/get_prefs and honors selected IDs', async () => {
  const ids = ['sensor.grid_a', 'sensor.device_a', 'sensor.cost_a'];
  const hass = makeHass({
    metadataById: {
      'sensor.grid_a': metadata('kWh'),
      'sensor.device_a': metadata('kWh'),
      'sensor.cost_a': metadata('PLN', { unit_class: undefined }),
    },
    deferred: { 'recorder/statistics_during_period': statisticsResponder(Object.fromEntries(ids.map((id) => [id, 1]))) },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: ['sensor.grid_a'],
      energy_device_statistics: [{ statistic_id: 'sensor.device_a', label: 'Device A' }],
      energy_cost_statistics: ['sensor.cost_a'],
    }),
  });
  assert.equal(callsOf(hass, 'energy/get_prefs').length, 0);
  assert.equal(callsOf(hass, 'recorder/list_statistic_ids').length, 0);
  assert.deepEqual(sourceIdsFromStatisticsCall(hass), ids);
  card.remove(); dom.window.close();
});

test('device values never increase household total', async () => {
  const { card, dom } = await mountDashboard({
    'sensor.grid_import': 10,
    'sensor.grid_import_cost': 2,
    'sensor.hvac_total': 6,
    'sensor.hvac_indoor': 2,
    'sensor.dishwasher': 1,
  });
  assert.equal(card._energyViewState.total.value, 10);
  assert.match(card.shadowRoot.textContent, /10(?:\.0)?\s*kWh/);
  assert.doesNotMatch(card.shadowRoot.textContent, /19(?:\.0)?\s*kWh/);
  card.remove(); dom.window.close();
});

test('included child is nested and excluded from top-level ranking', async () => {
  const { card, dom } = await mountDashboard({
    'sensor.grid_import': 10,
    'sensor.grid_import_cost': 2,
    'sensor.hvac_total': 6,
    'sensor.hvac_indoor': 2,
    'sensor.dishwasher': 1,
  });
  assert.deepEqual(Array.from(card._energyViewState.devices.filter((row) => row.depth === 0), (row) => row.statistic_id), [
    'sensor.hvac_total',
    'sensor.dishwasher',
  ]);
  const child = card._energyViewState.devices.find((row) => row.statistic_id === 'sensor.hvac_indoor');
  assert.equal(child.depth, 1);
  assert.equal(child.included_in_stat, 'sensor.hvac_total');
  card.remove(); dom.window.close();
});

test('duplicate statistic IDs are fetched and counted once', async () => {
  const hass = makeHass({
    metadataById: { 'sensor.grid': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': statisticsResponder({ 'sensor.grid': 3 }) },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: ['sensor.grid', 'sensor.grid', { statistic_id: 'sensor.grid' }] }),
  });
  assert.deepEqual(sourceIdsFromStatisticsCall(hass), ['sensor.grid']);
  assert.equal(card._energyViewState.total.value, 3);
  card.remove(); dom.window.close();
});

test('one fetched statistic preserves separate total and device references', async () => {
  const hass = makeHass({
    metadataById: { 'sensor.grid': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': statisticsResponder({ 'sensor.grid': 3 }) },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: ['sensor.grid'],
      energy_device_statistics: [{ statistic_id: 'sensor.grid', label: 'Reference row' }],
    }),
  });
  assert.deepEqual(sourceIdsFromStatisticsCall(hass), ['sensor.grid']);
  assert.equal(card._energyViewState.total.value, 3);
  assert.equal(card._energyViewState.devices[0].label, 'Reference row');
  assert.equal(card._energyViewState.devices[0].provenance, 'explicit');
  assert.equal(card._energyViewState.devices[0].status, 'ready');
  assert.equal(card._energyViewState.devices[0].value, 3);
  assert.equal(card._energyViewState.devices[0].unit, 'kWh');
  assert.equal(card._energyViewState.device_data_status, 'ready');
  assert.match(card.shadowRoot.textContent, /Reference row\s*3\.0 kWh/i);
  const exportedDevice = card._buildExportDocument(FIXED_NOW).energy.devices[0];
  assert.deepEqual(
    JSON.parse(JSON.stringify({ value: exportedDevice.value, unit: exportedDevice.unit, status: exportedDevice.status })),
    { value: 3, unit: 'kWh', status: 'ready' },
  );
  card.remove(); dom.window.close();
});

test('cyclic included_in relationships withhold ranking and expose invalid_relationship', async () => {
  const ids = ['sensor.grid', 'sensor.a', 'sensor.b'];
  const hass = makeHass({
    metadataById: Object.fromEntries(ids.map((id) => [id, metadata('kWh')])),
    deferred: { 'recorder/statistics_during_period': statisticsResponder({ 'sensor.grid': 5, 'sensor.a': 2, 'sensor.b': 1 }) },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: ['sensor.grid'],
      energy_device_statistics: [
        { statistic_id: 'sensor.a', included_in_stat: 'sensor.b' },
        { statistic_id: 'sensor.b', included_in_stat: 'sensor.a' },
      ],
    }),
  });
  assert.equal(card._energyViewState.device_relationship_status, 'invalid_relationship');
  assert.equal(card._energyViewState.top_ranking_available, false);
  card.remove(); dom.window.close();
});

test('missing included_in parent remains visible as nested_parent_missing', async () => {
  const ids = ['sensor.grid', 'sensor.orphan'];
  const hass = makeHass({
    metadataById: Object.fromEntries(ids.map((id) => [id, metadata('kWh')])),
    deferred: { 'recorder/statistics_during_period': statisticsResponder({ 'sensor.grid': 5, 'sensor.orphan': 1 }) },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: ['sensor.grid'],
      energy_device_statistics: [{ statistic_id: 'sensor.orphan', included_in_stat: 'sensor.missing_parent' }],
    }),
  });
  assert.equal(card._energyViewState.device_relationship_status, 'nested_parent_missing');
  assert.equal(card._energyViewState.top_ranking_available, false);
  assert.equal(card._energyViewState.devices[0].relationship_status, 'nested_parent_missing');
  assert.equal(card._energyViewState.devices[0].depth, 1);
  card.remove(); dom.window.close();
});

test('no Energy Dashboard configuration is not_configured and has no live-state fallback', async () => {
  const hass = makeHass({
    prefs: { energy_sources: [], device_consumption: [] },
    states: {
      'sensor.attic_energy': { state: '99999', attributes: { unit_of_measurement: 'kWh' } },
    },
  });
  const { card, dom } = await mountCard({ hass, config: { energy_source_mode: 'dashboard' } });
  assert.equal(card._energyViewState.status, 'not_configured');
  assert.equal(callsOf(hass, 'recorder/list_statistic_ids').length, 0);
  assert.doesNotMatch(card.shadowRoot.textContent, /99999/);
  card.remove(); dom.window.close();
});

function freshCard() {
  const dom = loadRuntime();
  const card = dom.window.document.createElement('ha-smart-reports');
  card._now = () => new Date(FIXED_NOW);
  return { dom, card };
}

function summarize(card, unit, changes, options = {}) {
  const start = options.start || '2026-08-30T00:00:00.000Z';
  const end = options.end || '2026-08-30T02:00:00.000Z';
  const series = options.series || calendarSeries(start, end, changes);
  return card._summarizeSeries(series, metadata(unit, options.metadata || {}), { start: new Date(start), end: new Date(end) }, options.role || 'total');
}

test('normalizes Wh to kWh', () => {
  const { dom, card } = freshCard();
  assert.equal(summarize(card, 'Wh', [250, 750]).value, 1);
  dom.window.close();
});

test('keeps kWh', () => {
  const { dom, card } = freshCard();
  assert.equal(summarize(card, 'kWh', [0.25, 0.75]).value, 1);
  dom.window.close();
});

test('normalizes MWh to kWh', () => {
  const { dom, card } = freshCard();
  assert.equal(summarize(card, 'MWh', [0.00025, 0.00075]).value, 1);
  dom.window.close();
});

test('accepts measured zero', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'kWh', [0, 0]);
  assert.deepEqual({ status: result.status, value: result.value }, { status: 'ready', value: 0 });
  dom.window.close();
});

test('empty series is no_data', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'kWh', [], { series: [] });
  assert.deepEqual({ status: result.status, value: result.value }, { status: 'no_data', value: null });
  dom.window.close();
});

test('missing change is partial', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'kWh', [], {
    series: [{ start: '2026-08-30T00:00:00.000Z', end: '2026-08-30T01:00:00.000Z' }],
  });
  assert.deepEqual({ status: result.status, value: result.value }, { status: 'partial', value: null });
  dom.window.close();
});

test('rejects string numeric data', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'kWh', [], { series: [{ start: 0, end: 3600000, change: '1' }], start: 0, end: 3600000 });
  assert.equal(result.status, 'invalid');
  dom.window.close();
});

test('rejects NaN and Infinity', () => {
  const { dom, card } = freshCard();
  assert.equal(summarize(card, 'kWh', [], { series: [{ start: 0, end: 3600000, change: Number.NaN }], start: 0, end: 3600000 }).status, 'invalid');
  assert.equal(summarize(card, 'kWh', [], { series: [{ start: 0, end: 3600000, change: Number.POSITIVE_INFINITY }], start: 0, end: 3600000 }).status, 'invalid');
  dom.window.close();
});

test('rejects negative import change', () => {
  const { dom, card } = freshCard();
  assert.equal(summarize(card, 'kWh', [-0.1, 0]).status, 'invalid');
  dom.window.close();
});

test('rejects power as energy', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'W', [500, 0], { metadata: { unit_class: 'power' } });
  assert.equal(result.status, 'unsupported');
  dom.window.close();
});

test('rejects a non-normalizable unit even when unit_class is energy', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'J', [1], { metadata: { unit_class: 'energy' } });
  assert.equal(result.status, 'unsupported');
  dom.window.close();
});

test('rejects a statistic without sum support', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'kWh', [1], { metadata: { has_sum: false } });
  assert.equal(result.status, 'unsupported');
  dom.window.close();
});

test('uses recorder reset-aware change instead of sum delta', () => {
  const { dom, card } = freshCard();
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/recorder-statistics.json'), 'utf8'));
  const result = summarize(card, 'kWh', [], { series: fixture.reset_aware, start: 0, end: 7200000 });
  assert.equal(result.value, 1.1);
  dom.window.close();
});

test('gap withholds aggregate', async () => {
  const hass = makeHass({
    metadataById: { 'sensor.grid': metadata('kWh') },
    deferred: {
      'recorder/statistics_during_period': (message) => {
        const full = calendarSeries(message.start_time, message.end_time, [1]);
        full.splice(2, 1);
        return Promise.resolve({ 'sensor.grid': full });
      },
    },
  });
  const { card, dom } = await mountCard({ hass, config: explicitConfig({ energy_total_statistics: ['sensor.grid'], energy_price: 0.5, currency: 'PLN' }) });
  assert.equal(card._energyViewState.status, 'partial');
  assert.equal(card._energyViewState.total.value, null);
  assert.equal(card._energyViewState.cost.value, null);
  card.remove(); dom.window.close();
});

test('edge coverage within one hour remains complete', () => {
  const { dom, card } = freshCard();
  const result = summarize(card, 'kWh', [], {
    start: '2026-08-30T00:00:00.000Z',
    end: '2026-08-30T02:00:00.000Z',
    series: [{
      start: '2026-08-30T00:30:00.000Z',
      end: '2026-08-30T01:30:00.000Z',
      change: 1,
    }],
  });
  assert.deepEqual({ status: result.status, value: result.value }, { status: 'ready', value: 1 });
  dom.window.close();
});

test('spring DST calendar day is 23 hours', () => {
  const { dom, card } = freshCard();
  const bounds = card._zonedDayBounds({ year: 2026, month: 3, day: 29 }, 'Europe/Warsaw');
  assert.equal(bounds.start.toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-03-29T22:00:00.000Z');
  assert.equal(bounds.end - bounds.start, 23 * 3600000);
  dom.window.close();
});

test('autumn DST calendar day is 25 hours', () => {
  const { dom, card } = freshCard();
  const bounds = card._zonedDayBounds({ year: 2026, month: 10, day: 25 }, 'Europe/Warsaw');
  assert.equal(bounds.start.toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(bounds.end - bounds.start, 25 * 3600000);
  dom.window.close();
});

test('7d starts at local midnight six calendar dates earlier', () => {
  const { dom, card } = freshCard();
  const period = card._calendarWindow('7d', FIXED_NOW, 'Europe/Warsaw');
  assert.equal(period.start.toISOString(), '2026-08-23T22:00:00.000Z');
  assert.notEqual(period.start.getTime(), FIXED_NOW.getTime() - 168 * 3600000);
  dom.window.close();
});

test('period change changes WS start_time and exported period', async () => {
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': statisticsResponder({ 'sensor.grid_import': 1 }) },
  });
  const { card, window, dom } = await mountCard({ hass, config: explicitConfig() });
  const firstStart = callsOf(hass, 'recorder/statistics_during_period').at(-1).start_time;
  card.shadowRoot.querySelector('#periodSelect').value = '1d';
  card.shadowRoot.querySelector('#periodSelect').dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const secondStart = callsOf(hass, 'recorder/statistics_during_period').at(-1).start_time;
  assert.notEqual(firstStart, secondStart);
  assert.equal(card._buildExportDocument(FIXED_NOW).period.key, '1d');
  assert.equal(card._buildExportDocument(FIXED_NOW).period.start, secondStart);
  card.remove(); dom.window.close();
});

async function mountCost({ energy = 4, costs = null, config = {}, costUnits = ['PLN'] } = {}) {
  const totals = ['sensor.grid'];
  const costIds = costs == null ? [] : costs.map((_, index) => `sensor.cost_${index + 1}`);
  const ids = [...totals, ...costIds];
  const metadataById = { 'sensor.grid': metadata('kWh') };
  costIds.forEach((id, index) => { metadataById[id] = metadata(costUnits[index] || costUnits[0], { unit_class: undefined }); });
  const values = { 'sensor.grid': energy };
  costIds.forEach((id, index) => { values[id] = costs[index]; });
  const hass = makeHass({ metadataById, deferred: { 'recorder/statistics_during_period': statisticsResponder(values) } });
  return mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: totals, energy_cost_statistics: costIds, currency: 'PLN', ...config }),
  });
}

test('cost statistics win over configured flat rate', async () => {
  const { card, dom } = await mountCost({ costs: [2], config: { energy_price: 999 } });
  assert.deepEqual({ value: card._energyViewState.cost.value, method: card._energyViewState.cost.method }, { value: 2, method: 'cost_statistics' });
  card.remove(); dom.window.close();
});

test('partial dashboard cost coverage never reports one grid cost as complete', async () => {
  const dashboardPrefs = {
    energy_sources: [
      { type: 'grid', stat_energy_from: 'sensor.grid_a', stat_cost: 'sensor.cost_a' },
      { type: 'grid', stat_energy_from: 'sensor.grid_b' },
    ],
    device_consumption: [],
  };
  const hass = makeHass({
    prefs: dashboardPrefs,
    metadataById: {
      'sensor.grid_a': metadata('kWh'),
      'sensor.grid_b': metadata('kWh'),
      'sensor.cost_a': metadata('PLN', { unit_class: undefined }),
    },
    deferred: {
      'recorder/statistics_during_period': statisticsResponder({
        'sensor.grid_a': 4,
        'sensor.grid_b': 4,
        'sensor.cost_a': 1,
      }),
    },
  });
  const { card, dom } = await mountCard({ hass, config: { energy_source_mode: 'dashboard', energy_price: 999, currency: 'PLN' } });
  assert.equal(card._energyViewState.status, 'ready');
  assert.equal(card._energyViewState.total.value, 8);
  assert.deepEqual({ value: card._energyViewState.cost.value, reason: card._energyViewState.cost.reason }, { value: null, reason: 'partial_cost' });
  card.remove(); dom.window.close();
});

test('flat estimate requires explicit rate and complete total', async () => {
  const { card, dom } = await mountCost({ config: { energy_price: 0.5 } });
  assert.deepEqual({ value: card._energyViewState.cost.value, method: card._energyViewState.cost.method }, { value: 2, method: 'flat_rate_estimate' });
  card.remove(); dom.window.close();
});

test('missing energy_price has no fabricated default', async () => {
  const { card, dom } = await mountCost();
  assert.equal(card._energyViewState.cost.value, null);
  assert.doesNotMatch(card.shadowRoot.textContent, /0\.65/);
  card.remove(); dom.window.close();
});

test('zero price is preserved', async () => {
  const { card, dom } = await mountCost({ config: { energy_price: 0 } });
  assert.deepEqual({ value: card._energyViewState.cost.value, method: card._energyViewState.cost.method }, { value: 0, method: 'flat_rate_estimate' });
  card.remove(); dom.window.close();
});

test('one missing cost source withholds combined cost', async () => {
  const ids = ['sensor.grid_a', 'sensor.grid_b', 'sensor.cost_a', 'sensor.cost_b'];
  const hass = makeHass({
    metadataById: {
      'sensor.grid_a': metadata('kWh'),
      'sensor.grid_b': metadata('kWh'),
      'sensor.cost_a': metadata('PLN', { unit_class: undefined }),
      'sensor.cost_b': metadata('PLN', { unit_class: undefined }),
    },
    deferred: {
      'recorder/statistics_during_period': (message) => Promise.resolve({
        'sensor.grid_a': calendarSeries(message.start_time, message.end_time, [4]),
        'sensor.grid_b': calendarSeries(message.start_time, message.end_time, [4]),
        'sensor.cost_a': calendarSeries(message.start_time, message.end_time, [1]),
      }),
    },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: ids.slice(0, 2),
      energy_cost_statistics: ids.slice(2),
      energy_price: 999,
      currency: 'PLN',
    }),
  });
  assert.equal(card._energyViewState.status, 'ready');
  assert.equal(card._energyViewState.total.value, 8);
  assert.deepEqual({ value: card._energyViewState.cost.value, reason: card._energyViewState.cost.reason }, { value: null, reason: 'partial_cost' });
  card.remove(); dom.window.close();
});

test('currency mismatch withholds cost', async () => {
  const { card, dom } = await mountCost({ costs: [1, 1], costUnits: ['PLN', 'EUR'] });
  assert.deepEqual({ value: card._energyViewState.cost.value, reason: card._energyViewState.cost.reason }, { value: null, reason: 'currency_mismatch' });
  card.remove(); dom.window.close();
});

test('partial energy withholds flat estimate', async () => {
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    statisticsById: { 'sensor.grid_import': [] },
  });
  const { card, dom } = await mountCard({ hass, config: explicitConfig({ energy_price: 0.5, currency: 'PLN' }) });
  assert.equal(card._energyViewState.cost.value, null);
  assert.match(card._energyViewState.cost.reason, /energy|data/);
  card.remove(); dom.window.close();
});
