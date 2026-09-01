'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIXED_NOW,
  calendarSeries,
  explicitConfig,
  makeHass,
  metadata,
  mountCard,
} = require('./helpers/smart-reports-harness.cjs');

async function exportCard(deviceLabels = []) {
  const deviceIds = deviceLabels.map((_, index) => `sensor.device_${index + 1}`);
  const metadataById = { 'sensor.grid_import': metadata('kWh') };
  deviceIds.forEach((id) => { metadataById[id] = metadata('kWh'); });
  const hass = makeHass({
    metadataById,
    deferred: {
      'recorder/statistics_during_period': (message) => {
        const stats = { 'sensor.grid_import': calendarSeries(message.start_time, message.end_time, [4]) };
        deviceIds.forEach((id, index) => { stats[id] = calendarSeries(message.start_time, message.end_time, [index + 1]); });
        return Promise.resolve(stats);
      },
    },
  });
  return mountCard({
    hass,
    config: explicitConfig({
      energy_price: 0.5,
      currency: 'PLN',
      energy_device_statistics: deviceIds.map((statistic_id, index) => ({ statistic_id, label: deviceLabels[index] })),
    }),
  });
}

test('JSON export matches schema_version 2 literal fixture', async () => {
  const { card, dom } = await exportCard(['HVAC']);
  const document = JSON.parse(JSON.stringify(card._buildExportDocument(FIXED_NOW)));
  assert.deepEqual(document, {
    schema_version: 2,
    generated_at: '2026-08-30T12:00:00.000Z',
    period: { key: '7d', start: '2026-08-23T22:00:00.000Z', end: '2026-08-30T12:00:00.000Z', time_zone: 'Europe/Warsaw' },
    source_mode: 'explicit',
    energy: { status: 'ready', total: {
      label: 'Grid import',
      value: 4,
      unit: 'kWh',
      source_statistic_ids: ['sensor.grid_import'],
    },
    cost: {
      value: 2,
      currency: 'PLN',
      method: 'flat_rate_estimate',
      rate: 0.5,
      source_statistic_ids: ['sensor.grid_import'],
      reason: null,
    },
    total_sources: [{ statistic_id: 'sensor.grid_import', label: 'sensor.grid_import', role: 'total', value: 4, unit: 'kWh', status: 'ready', provenance: 'explicit', included_in_stat: null, reason: null }],
    cost_sources: [],
    devices: [{
      statistic_id: 'sensor.device_1',
      label: 'HVAC',
      value: 1,
      unit: 'kWh',
      status: 'ready',
      provenance: 'explicit',
      included_in_stat: null,
    }],
    warnings: [],
    },
  });
  card.remove(); dom.window.close();
});

test('CSV emits one row per metric and never embeds nested JSON', async () => {
  const { card, dom } = await exportCard(['HVAC', 'Dishwasher']);
  const csv = card._buildCsv(card._buildExportDocument(FIXED_NOW));
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'schema_version,generated_at,period_key,period_start,period_end,time_zone,section,metric,statistic_id,label,value,unit,status,provenance,included_in_stat,reason');
  assert.equal(lines.filter((line) => line.includes(',energy,device,')).length, 2);
  assert.equal(lines.some((line) => /\{.*\}/.test(line)), false);
  card.remove(); dom.window.close();
});

test('CSV neutralizes formula-leading labels', async () => {
  const labels = ['=cmd', '+SUM', '-1+2', '@evil'];
  const { card, dom } = await exportCard(labels);
  const csv = card._buildCsv(card._buildExportDocument(FIXED_NOW));
  for (const label of labels) {
    assert.match(csv, new RegExp(`"'${label.replace(/[+]/g, '\\+')}"`));
  }
  assert.doesNotMatch(csv, /,"[=+\-@]/);
  card.remove(); dom.window.close();
});

test('export carries range, timezone, status and provenance', async () => {
  const { card, dom } = await exportCard(['HVAC']);
  const document = card._buildExportDocument(FIXED_NOW);
  assert.equal(document.period.start, '2026-08-23T22:00:00.000Z');
  assert.equal(document.period.end, '2026-08-30T12:00:00.000Z');
  assert.equal(document.period.time_zone, 'Europe/Warsaw');
  assert.equal(document.energy.status, 'ready');
  assert.equal(document.energy.devices[0].provenance, 'explicit');
  const csv = card._buildCsv(document);
  assert.match(csv, /Europe\/Warsaw/);
  assert.match(csv, /flat_rate_estimate/);
  assert.match(csv, /explicit/);
  card.remove(); dom.window.close();
});
