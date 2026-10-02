'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntime, makeHass } = require('./helpers/smart-reports-harness.cjs');

const STATUS_TOKENS = ['--sr-good', '--sr-warn', '--sr-bad'];
const DARK_SURFACE = 'rgb(28, 28, 28)';
const LIGHT_SURFACE = 'rgb(255, 255, 255)';

function themeFixture(t, initialSurface) {
  const dom = loadRuntime();
  const { window } = dom;
  const { document } = window;
  const card = document.createElement('ha-smart-reports');
  const hass = makeHass();
  let surfaceColor = initialSurface;
  const nativeComputedStyle = window.getComputedStyle.bind(window);

  // jsdom does not resolve shadow styles/custom properties. Stub only the
  // browser's resolved surface color, keeping card lifecycle and theme code real.
  window.getComputedStyle = (element) => {
    const computed = nativeComputedStyle(element);
    if (element === card.shadowRoot.querySelector('.card') && card.isConnected) {
      computed.setProperty('background-color', surfaceColor);
    }
    return computed;
  };
  t.after(() => {
    card.remove();
    dom.window.close();
  });

  function palette() {
    // Evaluate the actual card's token declarations and class cascade with
    // jsdom's CSS engine, projecting :host selectors into its supported DOM.
    // This is a token/lifecycle regression, not a rendered browser contrast audit.
    const style = document.createElement('style');
    style.textContent = card.shadowRoot.querySelector('style').textContent
      .replace(/:host\(([^)]+)\)/g, 'ha-smart-reports$1')
      .replace(/:host\b/g, 'ha-smart-reports');
    document.head.appendChild(style);
    try {
      const computed = nativeComputedStyle(card);
      return Object.fromEntries(STATUS_TOKENS.map((name) => [name, computed.getPropertyValue(name).trim()]));
    } finally {
      style.remove();
    }
  }

  return {
    card,
    hass,
    palette,
    connect: () => document.body.appendChild(card),
    setSurface: (value) => { surfaceColor = value; },
  };
}

function luminance(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  const rgb = /^rgb\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/.exec(color);
  assert.ok(hex || rgb, `expected an opaque sRGB status color, received ${color}`);
  const channels = hex
    ? [0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16))
    : rgb.slice(1).map(Number);
  const linear = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function assertReadable(palette, surface, tokens = STATUS_TOKENS) {
  const background = luminance(surface);
  for (const token of tokens) {
    const foreground = luminance(palette[token]);
    const ratio = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
    assert.ok(ratio >= 4.5, `${token} ${palette[token]} on ${surface}: ${ratio.toFixed(3)}:1 is below 4.5:1`);
  }
}

for (const [status, token] of [['ready', '--sr-good'], ['warning', '--sr-warn'], ['error', '--sr-bad']]) {
  test(`${status} color reaches 4.5:1 on HA #1c1c1c even when darkMode is false`, (t) => {
    const fixture = themeFixture(t, DARK_SURFACE);
    fixture.connect();
    fixture.card.hass = fixture.hass;
    assertReadable(fixture.palette(), DARK_SURFACE, [token]);
  });
}

test('resolved white HA surface keeps all status colors readable even when darkMode is true', (t) => {
  const fixture = themeFixture(t, LIGHT_SURFACE);
  fixture.hass.themes.darkMode = true;
  fixture.connect();
  fixture.card.hass = fixture.hass;
  assertReadable(fixture.palette(), LIGHT_SURFACE);
});

test('theme changes refresh status contrast when HA reuses the hass object', (t) => {
  const fixture = themeFixture(t, LIGHT_SURFACE);
  fixture.connect();
  fixture.card.hass = fixture.hass;
  assertReadable(fixture.palette(), LIGHT_SURFACE);

  fixture.setSurface(DARK_SURFACE);
  fixture.card.hass = fixture.hass;
  assertReadable(fixture.palette(), DARK_SURFACE);

  fixture.setSurface(LIGHT_SURFACE);
  fixture.card.hass = fixture.hass;
  assertReadable(fixture.palette(), LIGHT_SURFACE);
});

test('hass assigned before connect uses the inherited HA surface once attached', (t) => {
  const fixture = themeFixture(t, DARK_SURFACE);
  fixture.card.hass = fixture.hass;
  fixture.connect();
  assertReadable(fixture.palette(), DARK_SURFACE);
});

test('reattaching the card refreshes status colors after a detached theme change', (t) => {
  const fixture = themeFixture(t, LIGHT_SURFACE);
  fixture.card.hass = fixture.hass;
  fixture.connect();
  assertReadable(fixture.palette(), LIGHT_SURFACE);
  fixture.card.remove();
  fixture.setSurface(DARK_SURFACE);
  fixture.connect();
  assertReadable(fixture.palette(), DARK_SURFACE);
});

test('unreadable surface falls back to the HA dark preference', (t) => {
  const fixture = themeFixture(t, 'rgba(0, 0, 0, 0)');
  fixture.hass.themes.darkMode = true;
  fixture.connect();
  fixture.card.hass = fixture.hass;
  assertReadable(fixture.palette(), DARK_SURFACE);
  fixture.hass.themes.darkMode = false;
  fixture.card.hass = fixture.hass;
  assertReadable(fixture.palette(), LIGHT_SURFACE);
});
