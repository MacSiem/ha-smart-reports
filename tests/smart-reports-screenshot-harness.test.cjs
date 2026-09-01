'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HARNESS_PATH = path.join(ROOT, 'docs/screenshots/_harness.html');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReadyHarness(dom, timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const card = dom.window.document.getElementById('card');
    const state = card && card._energyViewState;
    if (dom.window.document.title === 'SR-READY' && state && state.status !== 'idle' && state.status !== 'loading') return card;
    await delay(20);
  }
  assert.fail('screenshot harness did not reach SR-READY with a settled energy state');
}

test('N-06 private screenshot harness renders ready actual 6.12 PLN cost with generic demo data', { timeout: 5000 }, async () => {
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => jsdomErrors.push(String(error && error.message ? error.message : error)));
  const dom = await JSDOM.fromFile(HARNESS_PATH, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
  });

  try {
    const card = await waitForReadyHarness(dom);
    assert.deepEqual(jsdomErrors, []);
    assert.equal(card._energyViewState.status, 'ready');
    assert.deepEqual(
      {
        value: card._energyViewState.cost.value,
        method: card._energyViewState.cost.method,
        currency: card._energyViewState.cost.currency,
      },
      { value: 6.12, method: 'cost_statistics', currency: 'PLN' },
    );
    assert.match(card.shadowRoot.textContent, /Actual cost\s*6\.12\s*PLN/i);

    const sourceAndRender = `${fs.readFileSync(HARNESS_PATH, 'utf8')}\n${card.shadowRoot.textContent}`;
    for (const forbidden of [
      /person\.maciej/i,
      /phone_maciej/i,
      /maciej@/i,
      /access[_-]?token/i,
      /authorization\s*:/i,
      /bearer\s+/i,
      /192\.168\.\d{1,3}\.\d{1,3}/,
      /smtp(?:_|\.)/i,
    ]) assert.doesNotMatch(sourceAndRender, forbidden);
    assert.equal(card.hass.user.id, 'demo_user');
    assert.equal(Object.keys(card.hass.states).every((entityId) => !/maciej|phone_/i.test(entityId)), true);
  } finally {
    dom.window.close();
  }
});
