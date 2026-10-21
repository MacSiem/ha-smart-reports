'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeHass, mountCard, metadata, explicitConfig, callsOf, waitForSettled, delay } = require('./helpers/smart-reports-harness.cjs');

for (const language of ['en', 'pl']) {
  test(`HA missing Energy preferences shows configuration guidance in ${language}`, async () => {
    const hass = makeHass({ errors: { 'energy/get_prefs': { code: 'not_found', message: 'No prefs' } }, info: { cost_sensors: {} } });
    hass.language = language;
    hass.config.version = '2026.9.4';
    const { card, dom } = await mountCard({ hass });
    try {
      assert.equal(card._energyViewState.status, 'not_configured');
      assert.equal(card._energyViewState.total.value, null);
      assert.equal(card._energyViewState.cost.value, null);
      assert.equal(card._energyViewState.cost.reason, 'not_configured');
      assert.equal(card.shadowRoot.querySelector('a.fixed-link').getAttribute('href'), '/config/energy');
      assert.match(card.shadowRoot.textContent, language === 'en' ? /Configure Energy Dashboard/ : /Skonfiguruj panel energii/);
      assert.equal(card.shadowRoot.getElementById('content').querySelector('details'), null);
      assert.equal(card.shadowRoot.querySelector('.summary'), null);
      assert.equal(card.shadowRoot.getElementById('exportJsonBtn').disabled, true);
      assert.equal(card.shadowRoot.getElementById('exportCsvBtn').disabled, true);
      assert.equal(card._buildExportDocument().energy.total.value, null);
      assert.equal(callsOf(hass, 'recorder/statistics_during_period').length, 0);
      assert.equal(callsOf(hass, 'recorder/get_statistics_metadata').length, 0);
    } finally { card.remove(); dom.window.close(); }
  });
}

for (const error of [{ code: 'prefs_failed', message: 'No prefs' }, { code: 'timeout', message: 'Timeout' }]) {
  test(`other Energy preferences failure ${error.code} keeps Retry and can recover`, async () => {
    const errors = { 'energy/get_prefs': error };
    const hass = makeHass({ errors });
    const { card, dom } = await mountCard({ hass });
    try {
      assert.equal(card._energyViewState.status, 'error');
      assert.equal(card.shadowRoot.querySelector('details code').textContent, error.code);
      assert.equal(card.shadowRoot.getElementById('exportJsonBtn').disabled, true);
      const retry = [...card.shadowRoot.querySelectorAll('button')].find(button => button.textContent === 'Retry');
      assert.ok(retry);
      errors['energy/get_prefs'] = { code: 'not_found', message: 'No prefs' };
      retry.click();
      await delay(10);
      await waitForSettled(card);
      assert.equal(card._energyViewState.status, 'not_configured');
    } finally { card.remove(); dom.window.close(); }
  });
}

for (const type of ['recorder/get_statistics_metadata', 'recorder/statistics_during_period']) {
  test(`${type} not_found remains a real error with Retry`, async () => {
    const hass = makeHass({ metadataById: { 'sensor.grid_import': metadata() }, errors: { [type]: { code: 'not_found', message: 'No statistics' } } });
    const { card, dom } = await mountCard({ hass, config: explicitConfig() });
    try {
      assert.equal(card._energyViewState.status, 'error');
      assert.equal(card.shadowRoot.querySelector('details code').textContent, 'not_found');
      assert.ok([...card.shadowRoot.querySelectorAll('button')].find(button => button.textContent === 'Retry'));
      assert.equal(card._energyViewState.total.value, null);
      assert.equal(card.shadowRoot.getElementById('exportCsvBtn').disabled, true);
    } finally { card.remove(); dom.window.close(); }
  });
}

test('late missing preferences does not overwrite a newer explicit report', async () => {
  let rejectPrefs;
  const hass = makeHass({ deferred: { 'energy/get_prefs': () => new Promise((resolve, reject) => { rejectPrefs = reject; }) }, metadataById: { 'sensor.grid_import': metadata() } });
  const { card, dom } = await mountCard({ hass });
  try {
    card.setConfig({ type: 'custom:ha-smart-reports', ...explicitConfig() });
    await card._loadEnergy();
    assert.equal(card._energyViewState.status, 'no_data');
    rejectPrefs({ code: 'not_found', message: 'No prefs' });
    await delay(10);
    assert.equal(card._energyViewState.status, 'no_data');
    assert.equal(card._energyViewState.source_mode, 'explicit');
  } finally { card.remove(); dom.window.close(); }
});
