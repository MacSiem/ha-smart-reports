'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIXED_NOW,
  calendarSeries,
  callsOf,
  explicitConfig,
  loadRuntime,
  makeHass,
  metadata,
  mountCard,
  sourceIdsFromStatisticsCall,
} = require('./helpers/smart-reports-harness.cjs');

const FIXED_PERIOD = {
  key: '7d',
  start: '2026-08-23T22:00:00.000Z',
  end: '2026-08-30T12:00:00.000Z',
  time_zone: 'Europe/Warsaw',
};

function valuesResponse(values) {
  return (message) => {
    const result = {};
    for (const id of message.statistic_ids) {
      if (Object.prototype.hasOwnProperty.call(values, id)) {
        result[id] = calendarSeries(message.start_time, message.end_time, [values[id]]);
      }
    }
    return Promise.resolve(result);
  };
}

function costCsvRow(card, documentValue) {
  return card._buildCsv(documentValue).split('\n').find((line) => line.includes(',energy,cost,'));
}

test('N-01 no_data total with ready actual cost withholds combined cost in UI JSON and CSV', async () => {
  const hass = makeHass({
    metadataById: {
      'sensor.grid': metadata('kWh'),
      'sensor.cost': metadata('PLN', { unit_class: null }),
    },
    deferred: {
      'recorder/statistics_during_period': (message) => Promise.resolve({
        'sensor.grid': [],
        'sensor.cost': calendarSeries(message.start_time, message.end_time, [7]),
      }),
    },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: ['sensor.grid'],
      energy_cost_statistics: ['sensor.cost'],
    }),
  });

  assert.equal(card._energyViewState.status, 'no_data');
  assert.deepEqual(JSON.parse(JSON.stringify(card._energyViewState.cost)), {
    value: null,
    currency: 'PLN',
    method: 'unavailable',
    rate: null,
    source_statistic_ids: ['sensor.cost'],
    reason: 'no_data',
  });
  const documentValue = JSON.parse(JSON.stringify(card._buildExportDocument(FIXED_NOW)));
  assert.deepEqual(documentValue, {
    schema_version: 2,
    generated_at: '2026-08-30T12:00:00.000Z',
    period: FIXED_PERIOD,
    source_mode: 'explicit',
    energy: {
      status: 'no_data',
      total: { label: 'Grid import', value: null, unit: 'kWh', source_statistic_ids: ['sensor.grid'] },
      cost: { value: null, currency: 'PLN', method: 'unavailable', rate: null, source_statistic_ids: ['sensor.cost'], reason: 'no_data' },
      total_sources: [{ statistic_id: 'sensor.grid', label: 'sensor.grid', role: 'total', value: null, unit: 'kWh', status: 'no_data', provenance: 'explicit', included_in_stat: null, reason: 'no_data' }],
      cost_sources: [{ statistic_id: 'sensor.cost', label: 'sensor.cost', role: 'cost', value: 7, unit: 'PLN', status: 'ready', provenance: 'explicit', included_in_stat: null, reason: null }],
      devices: [],
      warnings: [],
    },
  });
  assert.equal(
    costCsvRow(card, documentValue),
    '2,2026-08-30T12:00:00.000Z,7d,2026-08-23T22:00:00.000Z,2026-08-30T12:00:00.000Z,Europe/Warsaw,energy,cost,sensor.cost,unavailable,,PLN,no_data,unavailable,,no_data',
  );
  assert.doesNotMatch(card.shadowRoot.textContent, /7(?:\.0+)?\s*PLN/);
  card.remove(); dom.window.close();
});

test('N-01 unsupported total with ready actual cost never exposes combined cost', async () => {
  const hass = makeHass({
    metadataById: {
      'sensor.grid': metadata('W', { unit_class: 'power' }),
      'sensor.cost': metadata('PLN', { unit_class: null }),
    },
    deferred: {
      'recorder/statistics_during_period': valuesResponse({ 'sensor.grid': 500, 'sensor.cost': 7 }),
    },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: ['sensor.grid'], energy_cost_statistics: ['sensor.cost'] }),
  });

  assert.equal(card._energyViewState.status, 'unsupported');
  assert.deepEqual(JSON.parse(JSON.stringify(card._energyViewState.cost)), {
    value: null,
    currency: 'PLN',
    method: 'unavailable',
    rate: null,
    source_statistic_ids: ['sensor.cost'],
    reason: 'unsupported_source',
  });
  const documentValue = JSON.parse(JSON.stringify(card._buildExportDocument(FIXED_NOW)));
  assert.deepEqual(documentValue, {
    schema_version: 2,
    generated_at: '2026-08-30T12:00:00.000Z',
    period: FIXED_PERIOD,
    source_mode: 'explicit',
    energy: {
      status: 'unsupported',
      total: { label: 'Grid import', value: null, unit: 'kWh', source_statistic_ids: ['sensor.grid'] },
      cost: { value: null, currency: 'PLN', method: 'unavailable', rate: null, source_statistic_ids: ['sensor.cost'], reason: 'unsupported_source' },
      total_sources: [{ statistic_id: 'sensor.grid', label: 'sensor.grid', role: 'total', value: null, unit: 'W', status: 'unsupported', provenance: 'explicit', included_in_stat: null, reason: 'incompatible_energy_metadata' }],
      cost_sources: [{ statistic_id: 'sensor.cost', label: 'sensor.cost', role: 'cost', value: 7, unit: 'PLN', status: 'ready', provenance: 'explicit', included_in_stat: null, reason: null }],
      devices: [],
      warnings: [],
    },
  });
  assert.equal(
    costCsvRow(card, documentValue),
    '2,2026-08-30T12:00:00.000Z,7d,2026-08-23T22:00:00.000Z,2026-08-30T12:00:00.000Z,Europe/Warsaw,energy,cost,sensor.cost,unavailable,,PLN,unsupported_source,unavailable,,unsupported_source',
  );
  card.remove(); dom.window.close();
});

test('N-01 partial total makes ready actual cost unavailable with a partial_energy reason', async () => {
  const hass = makeHass({
    metadataById: {
      'sensor.grid': metadata('kWh'),
      'sensor.cost': metadata('PLN', { unit_class: null }),
    },
    deferred: {
      'recorder/statistics_during_period': (message) => Promise.resolve({
        'sensor.grid': [{ start: message.start_time, end: message.end_time }],
        'sensor.cost': calendarSeries(message.start_time, message.end_time, [7]),
      }),
    },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: ['sensor.grid'], energy_cost_statistics: ['sensor.cost'] }),
  });

  assert.equal(card._energyViewState.status, 'partial');
  assert.deepEqual(
    {
      value: card._energyViewState.cost.value,
      method: card._energyViewState.cost.method,
      reason: card._energyViewState.cost.reason,
    },
    { value: null, method: 'unavailable', reason: 'partial_energy' },
  );
  card.remove(); dom.window.close();
});

test('N-01 measured zero total and zero actual cost remain ready zero', async () => {
  const hass = makeHass({
    metadataById: {
      'sensor.grid': metadata('kWh'),
      'sensor.cost': metadata('PLN', { unit_class: null }),
    },
    deferred: {
      'recorder/statistics_during_period': valuesResponse({ 'sensor.grid': 0, 'sensor.cost': 0 }),
    },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: ['sensor.grid'], energy_cost_statistics: ['sensor.cost'] }),
  });

  assert.equal(card._energyViewState.status, 'ready');
  assert.deepEqual(
    JSON.parse(JSON.stringify(card._energyViewState.cost)),
    { value: 0, currency: 'PLN', method: 'cost_statistics', rate: null, source_statistic_ids: ['sensor.cost'], reason: null },
  );
  const documentValue = JSON.parse(JSON.stringify(card._buildExportDocument(FIXED_NOW)));
  assert.deepEqual(documentValue, {
    schema_version: 2,
    generated_at: '2026-08-30T12:00:00.000Z',
    period: FIXED_PERIOD,
    source_mode: 'explicit',
    energy: {
      status: 'ready',
      total: { label: 'Grid import', value: 0, unit: 'kWh', source_statistic_ids: ['sensor.grid'] },
      cost: { value: 0, currency: 'PLN', method: 'cost_statistics', rate: null, source_statistic_ids: ['sensor.cost'], reason: null },
      total_sources: [{ statistic_id: 'sensor.grid', label: 'sensor.grid', role: 'total', value: 0, unit: 'kWh', status: 'ready', provenance: 'explicit', included_in_stat: null, reason: null }],
      cost_sources: [{ statistic_id: 'sensor.cost', label: 'sensor.cost', role: 'cost', value: 0, unit: 'PLN', status: 'ready', provenance: 'explicit', included_in_stat: null, reason: null }],
      devices: [],
      warnings: [],
    },
  });
  assert.equal(
    costCsvRow(card, documentValue),
    '2,2026-08-30T12:00:00.000Z,7d,2026-08-23T22:00:00.000Z,2026-08-30T12:00:00.000Z,Europe/Warsaw,energy,cost,sensor.cost,cost_statistics,0,PLN,ready,cost_statistics,,',
  );
  card.remove(); dom.window.close();
});

test('N-02 direct grid fields take precedence over stale flow_from per source', async () => {
  const prefs = {
    energy_sources: [
      {
        type: 'grid',
        stat_energy_from: 'sensor.direct_a',
        stat_cost: 'sensor.direct_cost',
        flow_from: [{ stat_energy_from: 'sensor.stale_a', stat_cost: 'sensor.stale_cost_a' }],
      },
      {
        type: 'grid',
        stat_energy_from: 'sensor.direct_b',
        flow_from: [{ stat_energy_from: 'sensor.stale_b', stat_cost: 'sensor.stale_cost_b' }],
      },
    ],
    device_consumption: [{ stat_consumption: 'sensor.device', name: 'Custom heat pump' }],
  };
  const ids = ['sensor.direct_a', 'sensor.direct_b', 'sensor.direct_cost', 'sensor.mapped_cost', 'sensor.device'];
  const hass = makeHass({
    prefs,
    info: { cost_sensors: { 'sensor.direct_a': 'sensor.wrong_cost', 'sensor.direct_b': 'sensor.mapped_cost' } },
    metadataById: Object.fromEntries(ids.map((id) => [id, id.includes('cost') ? metadata('PLN', { unit_class: null }) : metadata('kWh')])),
    deferred: {
      'recorder/statistics_during_period': valuesResponse({
        'sensor.direct_a': 5,
        'sensor.direct_b': 4,
        'sensor.direct_cost': 2,
        'sensor.mapped_cost': 1,
        'sensor.device': 3,
      }),
    },
  });
  const { card, dom } = await mountCard({ hass, config: { energy_source_mode: 'dashboard' } });

  assert.deepEqual(sourceIdsFromStatisticsCall(hass), ids);
  assert.equal(card._energyViewState.total.value, 9);
  assert.equal(card._energyViewState.cost.value, 3);
  assert.equal(card._energyViewState.devices[0].label, 'Custom heat pump');
  assert.doesNotMatch(JSON.stringify(card._buildExportDocument(FIXED_NOW)), /sensor\.stale_|sensor\.wrong_cost/);
  card.remove(); dom.window.close();
});

test('N-02 legacy-only multiple flow_from entries remain supported and ignore flow_to', async () => {
  const prefs = {
    energy_sources: [{
      type: 'grid',
      flow_from: [
        { stat_energy_from: 'sensor.legacy_a', stat_cost: 'sensor.legacy_cost_a' },
        { stat_energy: 'sensor.legacy_b', stat_cost: 'sensor.legacy_cost_b' },
      ],
      flow_to: [{ stat_energy_to: 'sensor.export', stat_compensation: 'sensor.compensation' }],
    }],
    device_consumption: [],
  };
  const ids = ['sensor.legacy_a', 'sensor.legacy_b', 'sensor.legacy_cost_a', 'sensor.legacy_cost_b'];
  const hass = makeHass({
    prefs,
    metadataById: Object.fromEntries(ids.map((id) => [id, id.includes('cost') ? metadata('PLN', { unit_class: null }) : metadata('kWh')])),
    deferred: { 'recorder/statistics_during_period': valuesResponse({ 'sensor.legacy_a': 5, 'sensor.legacy_b': 4, 'sensor.legacy_cost_a': 2, 'sensor.legacy_cost_b': 1 }) },
  });
  const { card, dom } = await mountCard({ hass, config: { energy_source_mode: 'dashboard' } });

  assert.deepEqual(sourceIdsFromStatisticsCall(hass), ids);
  assert.equal(card._energyViewState.total.value, 9);
  assert.equal(card._energyViewState.cost.value, 3);
  assert.equal(callsOf(hass, 'energy/info').length, 0);
  assert.doesNotMatch(JSON.stringify(card._buildExportDocument(FIXED_NOW)), /sensor\.export|sensor\.compensation/);
  card.remove(); dom.window.close();
});

test('N-03 all-invalid included totals remain request-free and render ordered safe warnings', async () => {
  const hostileId = 'sensor.<img src=x onerror=globalThis.pwned=1>';
  const hass = makeHass();
  const { card, window, dom } = await mountCard({
    hass,
    config: explicitConfig({
      energy_total_statistics: [
        { statistic_id: 'sensor.child_b', included_in_stat: 'sensor.parent' },
        { statistic_id: hostileId, included_in_stat: 'sensor.parent' },
      ],
    }),
  });

  assert.equal(card._energyViewState.status, 'not_configured');
  assert.deepEqual(JSON.parse(JSON.stringify(card._energyViewState.warnings)), [
    'included_in_stat is only valid for device sources: sensor.child_b',
    `included_in_stat is only valid for device sources: ${hostileId}`,
  ]);
  assert.equal(callsOf(hass, 'recorder/get_statistics_metadata').length, 0);
  assert.equal(callsOf(hass, 'recorder/statistics_during_period').length, 0);
  assert.match(card.shadowRoot.textContent, /included_in_stat is only valid for device sources: sensor\.child_b/);
  assert.match(card.shadowRoot.textContent, /<img src=x onerror=globalThis\.pwned=1>/);
  assert.equal(card.shadowRoot.querySelector('img'), null);
  assert.equal(window.pwned, undefined);
  card.remove(); dom.window.close();
});

function summarizeBoundary(series) {
  const dom = loadRuntime();
  const card = dom.window.document.createElement('ha-smart-reports');
  const result = card._summarizeSeries(
    series,
    metadata('kWh'),
    { start: new Date(3600000), end: new Date(7200000) },
    'total',
    'PLN',
  );
  return { dom, result };
}

for (const [name, boundaryBucket, effectiveBucket] of [
  ['missing_change before', { start: 0, end: 3600000, change: null }, { start: 3600000, end: 7200000, change: 1 }],
  ['NaN before', { start: 0, end: 3600000, change: Number.NaN }, { start: 3600000, end: 7200000, change: 1 }],
  ['negative after', { start: 7200000, end: 10800000, change: -999 }, { start: 3600000, end: 7200000, change: 1 }],
]) test(`N-04 ignores ${name} in a zero-overlap boundary-touching bucket`, () => {
  const series = name.endsWith('after') ? [effectiveBucket, boundaryBucket] : [boundaryBucket, effectiveBucket];
  const { dom, result } = summarizeBoundary(series);
  assert.deepEqual({ status: result.status, value: result.value }, { status: 'ready', value: 1 });
  dom.window.close();
});

test('N-04 filters touching buckets before validating gaps in effective data', () => {
  const { dom, result } = summarizeBoundary([
    { start: 0, end: 3600000, change: 99 },
    { start: 5400000, end: 7200000, change: 1 },
  ]);
  assert.deepEqual({ status: result.status, value: result.value }, { status: 'ready', value: 1 });
  dom.window.close();
});

test('N-04 keeps strict detached, invalid timestamp and overlapping effective buckets fail-closed', () => {
  const detached = summarizeBoundary([{ start: 0, end: 3599999, change: 1 }]);
  assert.deepEqual({ status: detached.result.status, reason: detached.result.reason }, { status: 'invalid', reason: 'outside_requested_window' });
  detached.dom.window.close();

  const badTimestamp = summarizeBoundary([
    { start: 'not-a-date', end: 3600000, change: null },
    { start: 3600000, end: 7200000, change: 1 },
  ]);
  assert.deepEqual({ status: badTimestamp.result.status, reason: badTimestamp.result.reason }, { status: 'invalid', reason: 'invalid_bucket' });
  badTimestamp.dom.window.close();

  const overlap = summarizeBoundary([
    { start: 3600000, end: 6300000, change: 1 },
    { start: 5400000, end: 7200000, change: 1 },
  ]);
  assert.equal(overlap.result.status, 'invalid');
  overlap.dom.window.close();
});

test('N-05 error UI shows only a safe technical code in details and never the raw API message', async () => {
  const hostileCode = 'E_RECORDER_123"><img src=x onerror=globalThis.pwned=1>';
  const rawMessage = 'RAW_PRIVATE_API_MESSAGE <img src=x onerror=globalThis.pwned=2>';
  const error = Object.assign(new Error(rawMessage), { code: hostileCode });
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    errors: { 'recorder/statistics_during_period': error },
  });
  const { card, window, dom } = await mountCard({ hass, config: explicitConfig() });

  assert.equal(card._energyViewState.status, 'error');
  assert.doesNotMatch(card.shadowRoot.textContent, /RAW_PRIVATE_API_MESSAGE/);
  const details = card.shadowRoot.querySelector('details');
  assert.ok(details, 'expected a safe technical details disclosure');
  assert.equal(details.querySelector('summary').textContent, 'Technical details');
  assert.equal(details.querySelector('code').textContent, hostileCode);
  assert.equal(details.querySelector('img'), null);
  assert.equal(card.shadowRoot.querySelector('[onerror]'), null);
  assert.equal(window.pwned, undefined);
  card.remove(); dom.window.close();
});

test('N-05 ready UI exposes exact period range timezone and total/cost source counts', async () => {
  const hass = makeHass({
    metadataById: {
      'sensor.grid': metadata('kWh'),
      'sensor.cost': metadata('PLN', { unit_class: null }),
    },
    deferred: { 'recorder/statistics_during_period': valuesResponse({ 'sensor.grid': 4, 'sensor.cost': 2 }) },
  });
  const { card, dom } = await mountCard({
    hass,
    config: explicitConfig({ energy_total_statistics: ['sensor.grid'], energy_cost_statistics: ['sensor.cost'] }),
  });

  const context = card.shadowRoot.querySelector('.report-context');
  assert.ok(context, 'expected a visible report context line');
  assert.equal(
    context.textContent,
    'Period: 7 days · Aug 24, 2026 – Aug 30, 2026 · Time zone: Europe/Warsaw · Sources: 1 total, 1 cost',
  );
  assert.equal(context.dataset.periodStart, '2026-08-23T22:00:00.000Z');
  assert.equal(context.dataset.periodEnd, '2026-08-30T12:00:00.000Z');
  assert.match(context.title, /2026-08-23T22:00:00\.000Z → 2026-08-30T12:00:00\.000Z/);
  assert.doesNotMatch(context.textContent, /T\d{2}:\d{2}:\d{2}/);
  card.remove(); dom.window.close();
});

test('N-05 partial UI exposes exact period range timezone and total/cost source counts', async () => {
  const { card, dom } = await mountCard({ hass: makeHass(), config: explicitConfig() });
  card._setEnergyViewState({
    status: 'partial',
    period: FIXED_PERIOD,
    source_mode: 'explicit',
    total: { value: null, unit: 'kWh', source_statistic_ids: ['sensor.a', 'sensor.b'] },
    cost: { value: null, currency: 'PLN', method: 'unavailable', rate: null, source_statistic_ids: ['sensor.cost'], reason: 'partial_energy' },
    total_sources: [
      { statistic_id: 'sensor.a', label: 'A', status: 'ready' },
      { statistic_id: 'sensor.b', label: 'B', status: 'partial', reason: 'missing_change' },
    ],
    cost_sources: [{ statistic_id: 'sensor.cost', label: 'Cost', status: 'ready' }],
    devices: [],
    warnings: [],
  });

  const context = card.shadowRoot.querySelector('.report-context');
  assert.ok(context, 'expected a visible report context line');
  assert.equal(
    context.textContent,
    'Period: 7 days · Aug 24, 2026 – Aug 30, 2026 · Time zone: Europe/Warsaw · Sources: 2 total, 1 cost',
  );
  assert.equal(context.dataset.periodStart, '2026-08-23T22:00:00.000Z');
  assert.equal(context.dataset.periodEnd, '2026-08-30T12:00:00.000Z');
  card.remove(); dom.window.close();
});
