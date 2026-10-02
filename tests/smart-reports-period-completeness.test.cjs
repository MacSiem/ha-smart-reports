'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntime, metadata, makeHass, mountCard, calendarSeries } = require('./helpers/smart-reports-harness.cjs');

for (const [label, start, end] of [
  ['first completed hour is missing', '2026-08-30T01:00:00Z', '2026-08-30T02:00:00Z'],
  ['last completed hour is missing', '2026-08-30T00:00:00Z', '2026-08-30T01:00:00Z'],
  ['bucket extends past the requested end', '2026-08-30T00:00:00Z', '2026-08-30T03:00:00Z'],
]) {
  test(`period total is unavailable when ${label}`, () => {
    const dom = loadRuntime();
    try {
      const card = dom.window.document.createElement('ha-smart-reports');
      const result = card._summarizeSeries(
        [{ start, end, change: 4 }], metadata('kWh'),
        { start: new Date('2026-08-30T00:00:00Z'), end: new Date('2026-08-30T02:00:00Z') }, 'total', 'PLN',
      );
      assert.equal(result.status, 'partial');
      assert.equal(result.value, null);
      assert.equal(result.reason, 'incomplete_coverage');
    } finally { dom.window.close(); }
  });
}

test('calendar report ends at the last completed Recorder hour and exports that exact cutoff', () => {
  const dom = loadRuntime();
  try {
    const card = dom.window.document.createElement('ha-smart-reports');
    card._now = () => new Date('2026-08-30T12:37:15.123Z');
    card._hass = { config: { time_zone: 'Europe/Warsaw' } };
    for (const key of ['1d', '7d', '30d']) {
      card._period = key;
      const period = card._periodDescriptor();
      assert.equal(period.end, '2026-08-30T12:00:00.000Z');
      assert.equal(period.time_zone, 'Europe/Warsaw');
    }
  } finally { dom.window.close(); }
});

test('today before its first completed hour has no data and does not request a partial hour', async () => {
  const hass = makeHass({
    timeZone: 'UTC', metadataById: { 'sensor.grid': metadata('kWh') },
    deferred: { 'recorder/statistics_during_period': (message) => Promise.resolve({
      'sensor.grid': calendarSeries(message.start_time, message.end_time, [4]),
    }) },
  });
  const { card, dom } = await mountCard({ hass, config: {
    energy_source_mode: 'explicit', energy_total_statistics: ['sensor.grid'], energy_price: 0.5, currency: 'PLN',
  } });
  try {
    card._period = '1d';
    card._now = () => new Date('2026-08-30T00:25:00Z');
    hass.calls.length = 0;
    card._invalidateEnergyRequest();
    await card._loadEnergy();
    assert.equal(card._energyViewState.status, 'no_data');
    assert.equal(card._energyViewState.total.value, null);
    assert.equal(card._energyViewState.cost.value, null);
    assert.equal(hass.calls.some((call) => call.type === 'recorder/statistics_during_period'), false);
  } finally { card.remove(); dom.window.close(); }
});

test('today has an empty, forward calendar range before its first complete UTC hour in Kathmandu', async () => {
  const hass = makeHass({ timeZone: 'Asia/Kathmandu', metadataById: { 'sensor.grid': metadata('kWh') } });
  const { card, dom } = await mountCard({ hass, config: {
    energy_source_mode: 'explicit', energy_total_statistics: ['sensor.grid'], energy_price: 0.5, currency: 'PLN',
  } });
  try {
    card._period = '1d';
    card._now = () => new Date('2026-08-29T18:20:00Z'); // Local 00:05, midnight was 18:15 UTC.
    hass.calls.length = 0;
    card._invalidateEnergyRequest();
    await card._loadEnergy();
    assert.equal(card._energyViewState.period.start, '2026-08-29T18:15:00.000Z');
    assert.equal(card._energyViewState.period.end, '2026-08-29T18:15:00.000Z');
    assert.equal(card._energyViewState.status, 'no_data');
    assert.equal(card._energyViewState.total.value, null);
    assert.equal(card._energyViewState.cost.value, null);
    assert.equal(hass.calls.some((call) => call.type === 'recorder/statistics_during_period'), false);
  } finally { card.remove(); dom.window.close(); }
});
