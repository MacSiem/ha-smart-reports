'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  delay,
  explicitConfig,
  loadRuntime,
  makeHass,
  mountCard,
} = require('./helpers/smart-reports-harness.cjs');

test('public card, metadata and editor contracts remain registered exactly once', () => {
  const dom = loadRuntime();
  const { window } = dom;
  const Card = window.customElements.get('ha-smart-reports');
  const Editor = window.customElements.get('ha-smart-reports-editor');

  assert.equal(typeof Card, 'function');
  assert.equal(typeof Editor, 'function');
  assert.equal((window.customCards || []).filter((entry) => entry.type === 'ha-smart-reports').length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(Card.getStubConfig())),
    { title: 'Smart Reports', energy_source_mode: 'dashboard' },
  );

  const card = window.document.createElement('ha-smart-reports');
  assert.equal(card.getCardSize(), 5);
  assert.deepEqual(
    JSON.parse(JSON.stringify(card.getGridOptions())),
    { rows: 5, columns: 12, min_rows: 3, min_columns: 6 },
  );

  const editor = Card.getConfigElement();
  const config = { type: 'custom:ha-smart-reports', title: 'Configured report' };
  const hass = { language: 'en' };
  assert.equal(editor.localName, 'ha-smart-reports-editor');
  editor.setConfig(config);
  editor.hass = hass;
  assert.deepEqual(JSON.parse(JSON.stringify(editor._config)), config);
  assert.equal(editor._hass, hass);
  assert.ok(editor.shadowRoot.querySelector('#cf_title'));
  assert.ok(editor.shadowRoot.querySelector('#cf_currency'));
  dom.window.close();
});

test('title, tab flags, navigation and per-instance tab state remain functional', async () => {
  const hass = makeHass({
    states: {
      'automation.demo': {
        state: 'on',
        attributes: { friendly_name: 'Demo automation', last_triggered: '2026-08-30T11:00:00.000Z' },
      },
      'sensor.available': { state: '1', attributes: {} },
    },
  });
  const { card, window, dom } = await mountCard({
    hass,
    config: explicitConfig({
      title: 'Configured report',
      show_energy: false,
      show_automations: true,
      show_system: true,
    }),
  });

  const energyTab = card.shadowRoot.querySelector('[data-tab="energy"]');
  const automationsTab = card.shadowRoot.querySelector('[data-tab="automations"]');
  const systemTab = card.shadowRoot.querySelector('[data-tab="system"]');
  assert.equal(card.shadowRoot.querySelector('#title').textContent, 'Configured report');
  assert.equal(energyTab.hidden, true);
  assert.equal(automationsTab.hidden, false);
  assert.equal(systemTab.hidden, false);
  assert.equal(card._activeTab, 'automations');
  assert.equal(automationsTab.getAttribute('aria-selected'), 'true');
  assert.equal(card.shadowRoot.querySelector('#energyToolbar').hidden, true);
  assert.match(card.shadowRoot.textContent, /Demo automation/);

  systemTab.click();
  await delay(10);
  assert.equal(card._activeTab, 'system');
  assert.equal(window.localStorage.getItem('ha-smart-reports:active-tab'), null);
  assert.equal(systemTab.getAttribute('aria-selected'), 'true');
  assert.match(card.shadowRoot.textContent, /System overview/);
  assert.match(card.shadowRoot.textContent, /sensor\s*1/i);

  card.remove();
  dom.window.close();
});

test('support footer remains single, card-owned and safe across rerenders', async () => {
  const { card, dom } = await mountCard({
    hass: makeHass(),
    config: explicitConfig({ show_energy: false, show_automations: false, show_system: true }),
  });

  const assertFooter = () => {
    const footers = card.shadowRoot.querySelectorAll('.donate-section[data-source="own-card"]');
    assert.equal(footers.length, 1);
    const links = [...footers[0].querySelectorAll('a')];
    assert.deepEqual(links.map((link) => link.href), [
      'https://buymeacoffee.com/macsiem',
      'https://www.paypal.com/donate/?hosted_button_id=Y967H4PLRBN8W',
    ]);
    for (const link of links) {
      assert.equal(link.target, '_blank');
      assert.equal(link.rel, 'noopener noreferrer');
    }
  };

  assertFooter();
  card.setConfig(explicitConfig({ title: 'Rerendered', show_energy: true }));
  await delay(10);
  assertFooter();
  card.remove();
  dom.window.close();
});
