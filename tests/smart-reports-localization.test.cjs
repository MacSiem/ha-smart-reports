'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntime, makeHass, mountCard, explicitConfig, metadata, calendarSeries } = require('./helpers/smart-reports-harness.cjs');

function successHass(language = 'en') {
  const hass = makeHass({
    metadataById: { 'sensor.grid_import': metadata('kWh') },
    states: {
      'automation.demo': { state: 'off', attributes: { friendly_name: 'User Energy <img src=x>', last_triggered: null } },
      'sensor.unavailable': { state: 'unavailable', attributes: {} },
    },
    deferred: { 'recorder/statistics_during_period': message => Promise.resolve({
      'sensor.grid_import': calendarSeries(message.start_time, message.end_time, [2]),
    }) },
  });
  hass.language = language;
  return hass;
}

function labelTexts(card) {
  return Array.from(card.shadowRoot.querySelectorAll('.metric-label'), node => node.textContent);
}

for (const language of ['pl', 'pl-PL', 'en']) {
  test(`three rendered views and toolbar use ${language}`, async () => {
    const pl = language.startsWith('pl');
    const { card, dom } = await mountCard({ hass: successHass(language), config: explicitConfig({ title: 'My Energy' }) });
    try {
      assert.equal(card.shadowRoot.getElementById('title').textContent, 'My Energy');
      assert.deepEqual(Array.from(card.shadowRoot.querySelectorAll('[data-tab]'), node => node.textContent), pl ? ['Energia', 'Automatyzacje', 'System'] : ['Energy', 'Automations', 'System']);
      assert.deepEqual(Array.from(card.shadowRoot.getElementById('periodSelect').options, node => node.textContent), pl ? ['Dzisiaj', '7 dni', '30 dni'] : ['Today', '7 days', '30 days']);
      assert.equal(card.shadowRoot.getElementById('exportCsvBtn').textContent, pl ? 'Eksport CSV' : 'Export CSV');
      assert.equal(card.shadowRoot.getElementById('tabs').getAttribute('aria-label'), pl ? 'Sekcje raportu' : 'Report sections');
      assert.deepEqual(labelTexts(card), pl ? ['Pobór z sieci', 'Koszt niedostępny'] : ['Grid import', 'Cost unavailable']);
      assert.match(card.shadowRoot.querySelector('.report-context').textContent, pl ? /Okres: 7 dni.*Strefa czasowa:.*Źródła:/ : /Period: 7 days.*Time zone:.*Sources:/);
      card._selectTab('automations');
      assert.deepEqual(labelTexts(card), pl ? ['Wszystkie automatyzacje', 'Aktywne', 'Wyłączone', 'Uruchomione dzisiaj'] : ['Total automations', 'Active', 'Disabled', 'Triggered today']);
      assert.equal(card.shadowRoot.querySelector('.row-name').textContent, 'User Energy <img src=x>');
      assert.equal(card.shadowRoot.querySelector('img'), null);
      assert.match(card.shadowRoot.getElementById('content').textContent, pl ? /Nigdy · wyłączona/ : /Never · off/);
      card._selectTab('system');
      assert.deepEqual(labelTexts(card), pl ? ['Encje', 'Niedostępne', 'Nieznane', 'Domeny'] : ['Entities', 'Unavailable', 'Unknown', 'Domains']);
      assert.match(card.shadowRoot.getElementById('content').textContent, pl ? /Przegląd systemu.*Stan systemu.*Dostępność encji/ : /System overview.*Health check.*Entity availability/);
    } finally { card.remove(); dom.window.close(); }
  });
}

test('ordinary hass changes repaint the selected view immediately and keep export contracts', async () => {
  const hass = successHass();
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  try {
    const report = JSON.stringify(card._buildExportDocument(card._now()));
    const csv = card._buildCsv(card._buildExportDocument(card._now()));
    const periodSelect = card.shadowRoot.getElementById('periodSelect');
    card._selectTab('system');
    for (const language of ['pl', 'en', 'pl']) {
      // Mutate the same HA object too: comparing object identity would miss this.
      hass.language = language; card.hass = hass;
      assert.equal(card.shadowRoot.querySelector('h3').textContent, language === 'pl' ? 'Przegląd systemu' : 'System overview');
      assert.equal(card.shadowRoot.getElementById('periodSelect'), periodSelect);
      assert.equal(periodSelect.value, '7d');
      assert.equal(card._activeTab, 'system');
      assert.equal(JSON.stringify(card._buildExportDocument(card._now())), report);
      assert.equal(card._buildCsv(card._buildExportDocument(card._now())), csv);
    }
    card._selectTab('energy');
    hass.language = 'en'; card.hass = hass;
    assert.equal(card.shadowRoot.querySelector('.metric-label').textContent, 'Grid import');
    hass.language = 'pl'; card.hass = hass;
    assert.equal(card.shadowRoot.querySelector('.metric-label').textContent, 'Pobór z sieci');
    card._selectTab('automations');
    hass.language = 'en'; card.hass = hass;
    assert.equal(card.shadowRoot.querySelector('.metric-label').textContent, 'Total automations');
  } finally { card.remove(); dom.window.close(); }
});

const states = [
  ['idle', 'Loading recorder statistics…', 'Wczytywanie statystyk rejestratora…'],
  ['loading', 'Loading recorder statistics…', 'Wczytywanie statystyk rejestratora…'],
  ['not_configured', 'Configure Energy Dashboard or select explicit statistics.', 'Skonfiguruj panel energii lub wybierz statystyki.'],
  ['unsupported', 'Recorder statistics are unavailable on this Home Assistant instance.', 'Statystyki rejestratora są niedostępne w tej instancji Home Assistant.'],
  ['permission_denied', 'Your account cannot read the selected statistics.', 'Twoje konto nie może odczytać wybranych statystyk.'],
  ['error', 'Couldn’t load energy statistics.', 'Nie udało się wczytać statystyk energii.'],
  ['no_data', 'No recorded energy change in this period.', 'Brak zarejestrowanych zmian energii w tym okresie.'],
  ['partial', 'Partial history — recorded values only.', 'Niepełna historia — tylko zarejestrowane wartości.'],
];
for (const language of ['pl', 'en']) for (const [status, english, polish] of states) {
  test(`${status} state is rendered in ${language} without translating data`, () => {
    const dom = loadRuntime();
    try {
      const card = dom.window.document.createElement('ha-smart-reports');
      card._hass = successHass(language);
      card._renderScaffold();
      card._setEnergyViewState({ status, code: 'provider_error', total: {}, cost: {}, devices: [], warnings: ['opaque provider warning'] });
      assert.equal(card.shadowRoot.querySelector('h3').textContent, language === 'pl' ? polish : english);
      if (status === 'error') assert.equal(card.shadowRoot.querySelector('code').textContent, 'provider_error');
      if (status === 'not_configured') {
        assert.equal(card.shadowRoot.querySelector('.fixed-link').getAttribute('href'), '/config/energy');
        assert.match(card.shadowRoot.getElementById('content').textContent, /opaque provider warning/);
      }
      card._config.show_energy = card._config.show_automations = card._config.show_system = false;
      card._syncTabs();
      assert.equal(card.shadowRoot.querySelector('h3').textContent, language === 'pl' ? 'Włącz co najmniej jedną sekcję raportu.' : 'Enable at least one report section.');
    } finally { dom.window.close(); }
  });
}

test('automation empty view, known warning codes, and settings follow HA language', () => {
  const dom = loadRuntime();
  try {
    const hass = makeHass(); hass.language = 'pl';
    const card = dom.window.document.createElement('ha-smart-reports');
    card._hass = hass; card._renderScaffold(); card._activeTab = 'automations'; card._renderAutomations();
    assert.match(card.shadowRoot.getElementById('content').textContent, /Brak dostępnych encji automatyzacji/);
    card._activeTab = 'energy';
    card._setEnergyViewState({ status: 'partial', total: {}, cost: {}, devices: [{ statistic_id: 'sensor.UserEnergy', label: 'User Energy', status: 'unsupported' }], total_sources: [{ statistic_id: 'sensor.UserEnergy', label: 'User Energy', status: 'partial', reason: 'incomplete_coverage' }], warnings: ['nested_parent_missing', 'opaque provider warning', 'included_in_stat is only valid for device sources: sensor.UserEnergy'] });
    assert.match(card.shadowRoot.getElementById('content').textContent, /User Energy.*nieobsługiwane.*częściowe: niepełne pokrycie okresu.*brak nadrzędnego źródła urządzenia.*opaque provider warning/);
    assert.match(card.shadowRoot.getElementById('content').textContent, /included_in_stat jest dozwolone tylko dla źródeł urządzeń: sensor.UserEnergy/);
    const editor = dom.window.document.createElement('ha-smart-reports-editor');
    editor.setConfig({ title: 'User Energy', currency: 'PLN' }); editor.hass = hass;
    assert.deepEqual(Array.from(editor.shadowRoot.querySelectorAll('label'), node => node.firstChild.textContent), ['Tytuł', 'Waluta']);
    assert.equal(editor.shadowRoot.getElementById('cf_title').value, 'User Energy');
    let changed;
    editor.addEventListener('config-changed', event => { changed = event.detail.config; });
    editor.shadowRoot.getElementById('cf_title').value = 'Edited title';
    editor.shadowRoot.getElementById('cf_title').dispatchEvent(new dom.window.Event('input'));
    assert.equal(changed.title, 'Edited title'); assert.equal(changed.currency, 'PLN');
    hass.language = 'en'; editor.hass = hass;
    assert.deepEqual(Array.from(editor.shadowRoot.querySelectorAll('label'), node => node.firstChild.textContent), ['Title', 'Currency']);
    assert.equal(editor.shadowRoot.getElementById('cf_title').value, 'Edited title');
  } finally { dom.window.close(); }
});


for (const [locale, legacy, expected] of [['pl', 'en', 'Pobór z sieci'], ['en', 'pl', 'Grid import']]) {
  test(`profile locale ${locale} wins over legacy ${legacy} in all views and settings`, async () => {
    const hass = successHass(legacy); hass.locale = { language: locale };
    const { card, dom } = await mountCard({ hass, config: explicitConfig({ title: 'User Energy' }) });
    try {
      assert.equal(card.shadowRoot.querySelector('.metric-label').textContent, expected);
      card._selectTab('automations');
      assert.equal(card.shadowRoot.querySelector('.metric-label').textContent, locale === 'pl' ? 'Wszystkie automatyzacje' : 'Total automations');
      card._selectTab('system');
      assert.equal(card.shadowRoot.querySelector('h3').textContent, locale === 'pl' ? 'Przegląd systemu' : 'System overview');
      const editor = dom.window.document.createElement('ha-smart-reports-editor');
      editor.setConfig({ title: 'User Energy', currency: 'PLN' }); editor.hass = hass;
      assert.equal(editor.shadowRoot.querySelector('label').firstChild.textContent, locale === 'pl' ? 'Tytuł' : 'Title');
      assert.equal(editor.shadowRoot.getElementById('cf_title').value, 'User Energy');
    } finally { card.remove(); dom.window.close(); }
  });
}

test('same hass.locale mutation repaints card/editor and keeps tab, period, exports, user data', async () => {
  const hass = successHass('en'); hass.locale = { language: 'en' };
  const { card, dom } = await mountCard({ hass, config: explicitConfig({ title: 'User Energy', currency: 'PLN' }) });
  try {
    const editor = dom.window.document.createElement('ha-smart-reports-editor');
    editor.setConfig({ title: 'User title', currency: 'PLN' }); editor.hass = hass;
    const report = JSON.stringify(card._buildExportDocument(card._now()));
    const csv = card._buildCsv(card._buildExportDocument(card._now()));
    const select = card.shadowRoot.getElementById('periodSelect');
    const data = card._energyViewState;
    for (const tab of ['energy', 'automations', 'system']) {
      card._selectTab(tab);
      for (const locale of ['pl', 'en', 'pl-PL']) {
        hass.locale.language = locale; card.hass = hass; editor.hass = hass;
        const pl = locale.startsWith('pl');
        assert.equal(card._activeTab, tab);
        assert.equal(card._period, '7d');
        assert.equal(card.shadowRoot.getElementById('periodSelect'), select);
        assert.equal(select.value, '7d');
        assert.equal(select.options[1].textContent, pl ? '7 dni' : '7 days');
        assert.equal(card._energyViewState, data);
        assert.equal(JSON.stringify(card._buildExportDocument(card._now())), report);
        assert.equal(card._buildCsv(card._buildExportDocument(card._now())), csv);
        assert.equal(card.shadowRoot.getElementById('title').textContent, 'User Energy');
        if (tab === 'energy') assert.equal(card.shadowRoot.querySelector('.metric-label').textContent, pl ? 'Pobór z sieci' : 'Grid import');
        if (tab === 'automations') {
          assert.equal(card.shadowRoot.querySelector('.metric-label').textContent, pl ? 'Wszystkie automatyzacje' : 'Total automations');
          assert.equal(card.shadowRoot.querySelector('.row-name').textContent, 'User Energy <img src=x>');
          assert.equal(card.shadowRoot.querySelector('img'), null);
        }
        if (tab === 'system') assert.equal(card.shadowRoot.querySelector('h3').textContent, pl ? 'Przegląd systemu' : 'System overview');
        assert.equal(editor.shadowRoot.querySelector('label').firstChild.textContent, pl ? 'Tytuł' : 'Title');
        assert.equal(editor.shadowRoot.getElementById('cf_title').value, 'User title');
        assert.equal(editor.shadowRoot.getElementById('cf_currency').value, 'PLN');
      }
    }
    delete hass.locale.language; hass.language = 'en'; card.hass = hass;
    assert.equal(card.shadowRoot.querySelector('h3').textContent, 'System overview');
    delete hass.language;
    Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: 'pl-PL' });
    card.hass = hass; editor.hass = hass;
    assert.equal(card.shadowRoot.querySelector('h3').textContent, 'Przegląd systemu');
    assert.equal(editor.shadowRoot.querySelector('label').firstChild.textContent, 'Tytuł');
    Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: '' });
    card.hass = hass; editor.hass = hass;
    assert.equal(card.shadowRoot.querySelector('h3').textContent, 'System overview');
    assert.equal(editor.shadowRoot.querySelector('label').firstChild.textContent, 'Title');
  } finally { card.remove(); dom.window.close(); }
});
