'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntime, makeHass, mountCard, metadata, calendarSeries, explicitConfig, delay } = require('./helpers/smart-reports-harness.cjs');

test('same-period refresh keeps the settled report visible until new data arrives', async () => {
  const hass = makeHass({ metadataById: { 'sensor.grid_import': metadata() }, deferred: {
    'recorder/statistics_during_period': m => Promise.resolve({ 'sensor.grid_import': calendarSeries(m.start_time, m.end_time, [4]) }),
  } });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  try {
    const metric = card.shadowRoot.querySelector('.metric-value');
    let release;
    hass.callWS = m => m.type === 'recorder/get_statistics_metadata'
      ? Promise.resolve([{ statistic_id: 'sensor.grid_import', ...metadata() }])
      : new Promise(resolve => { release = resolve; });
    const refreshing = card._loadEnergy(); await delay();
    assert.equal(card._energyViewState.status, 'ready');
    assert.equal(card.shadowRoot.querySelector('.metric-value'), metric);
    release({ 'sensor.grid_import': calendarSeries(card._energyViewState.period.start, card._energyViewState.period.end, [4]) });
    await refreshing;
    assert.equal(card.shadowRoot.querySelector('.metric-value'), metric);
  } finally { card.remove(); dom.window.close(); }
});

test('partial Recorder coverage exposes measured subtotal without inventing a complete total', async () => {
  const hass = makeHass({ metadataById: { 'sensor.grid_import': metadata() }, deferred: {
    'recorder/statistics_during_period': m => Promise.resolve({ 'sensor.grid_import': calendarSeries(m.start_time, m.end_time, [4]).slice(-2).map((b,i)=>({...b,change:i+1})) }),
  } });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  try {
    const state=card._energyViewState;
    assert.equal(state.status,'partial'); assert.equal(state.total.value,null);
    assert.equal(state.recorded_total.value,3);
    assert.equal(state.total_sources[0].coverage.observed_hours,2);
    assert.equal(state.total_sources[0].coverage.expected_hours,158);
    assert.match(card.shadowRoot.textContent,/Recorded consumption/);
    const report=card._buildExportDocument();
    assert.equal(report.energy.total.value,null); assert.equal(report.energy.recorded_total.value,3);
    assert.match(card._buildCsv(report),/recorded_total/);
  } finally { card.remove(); dom.window.close(); }
});

test('device names come from HA labels while energy remains Recorder-only', async () => {
  const hass=makeHass({metadataById:{'sensor.grid_import':metadata()},states:{'sensor.grid_import':{state:'999999',attributes:{friendly_name:'Kitchen <b>socket</b>'}}},deferred:{
    'recorder/statistics_during_period':m=>Promise.resolve({'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[2])}),
  }});
  const {card,dom}=await mountCard({hass,config:explicitConfig({energy_device_statistics:['sensor.grid_import']})});
  try {
    assert.equal(card._energyViewState.devices[0].label,'Kitchen <b>socket</b>');
    assert.equal(card._energyViewState.total.value,2);assert.equal(card.shadowRoot.querySelector('.row-name b'),null);
    assert.equal(card._buildExportDocument().energy.devices[0].label,'Kitchen <b>socket</b>');
  }finally{card.remove();dom.window.close();}
});

test('invalid or out-of-window samples cannot become a recorded subtotal',()=>{
  const dom=loadRuntime();try{
    const card=dom.window.document.createElement('ha-smart-reports');
    const win={start:'2026-08-30T00:00:00Z',end:'2026-08-30T02:00:00Z'};
    for(const change of [-3,Infinity,'7']){
      const result=card._summarizeSeries([{start:win.start,end:win.end,change}],metadata(),win,'total','PLN');
      assert.equal(result.recorded_value,null);
    }
  }finally{dom.window.close();}
});

test('a new source selection cannot retain the previous selection during loading', async () => {
  const hass=makeHass({metadataById:{'sensor.grid_import':metadata()},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[4])})}});
  const {card,dom}=await mountCard({hass,config:explicitConfig()});
  try{
    let resolveMetadata;
    hass.callWS=()=>new Promise(resolve=>{resolveMetadata=resolve;});
    card.setConfig(explicitConfig({energy_total_statistics:['sensor.other']}));
    await delay(10);
    assert.equal(card._energyViewState.status,'loading');
    assert.equal(card.shadowRoot.querySelector('.metric-value'),null);
    resolveMetadata([]);
  }finally{card.remove();dom.window.close();}
});

test('device bars compare recorded kWh and expose partial coverage',async()=>{
  const hass=makeHass({metadataById:{'sensor.grid_import':metadata(),'sensor.device':metadata()},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({
    'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[4]),
    'sensor.device':calendarSeries(m.start_time,m.end_time,[2]).slice(0,2),
  })}});
  const {card,dom}=await mountCard({hass,config:explicitConfig({energy_device_statistics:[{statistic_id:'sensor.grid_import',label:'Whole circuit'},{statistic_id:'sensor.device',label:'Socket'}]})});
  try{
    const chart=card.shadowRoot.querySelector('[aria-label="Recorded energy by device"]');
    assert.ok(chart);assert.match(chart.textContent,/Whole circuit/);assert.match(chart.textContent,/Socket/);assert.match(chart.textContent,/partial/);
    assert.deepEqual([...chart.querySelectorAll('[role="meter"]')].map(n=>Number(n.getAttribute('aria-valuenow'))),[4,2]);
  }finally{card.remove();dom.window.close();}
});

test('report exposes exact local hours and separate cost coverage in visible text',async()=>{
  const hass=makeHass({metadataById:{'sensor.grid_import':metadata(),'sensor.cost':metadata('PLN')},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({
    'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[4]),
    'sensor.cost':calendarSeries(m.start_time,m.end_time,[0.25]).slice(0,1),
  })}});
  const {card,dom}=await mountCard({hass,config:explicitConfig({energy_cost_statistics:['sensor.cost']})});
  try{
    assert.match(card.shadowRoot.querySelector('.report-context').textContent,/14:00|2:00/);
    const coverage=card.shadowRoot.querySelector('.cost-coverage');assert.ok(coverage);
    assert.match(coverage.textContent,/1.*158.*h/);
    const report=card._buildExportDocument();assert.equal(report.energy.recorded_cost.value,0.25);assert.equal(report.energy.cost.value,null);
    assert.match(card._buildCsv(report),/recorded_cost/);
  }finally{card.remove();dom.window.close();}
});

test('daily history preserves a DST day and leaves a missing source as partial', () => {
  const dom = loadRuntime();
  try {
    const card = dom.window.document.createElement('ha-smart-reports');
    const period = { start: '2026-03-28T23:00:00Z', end: '2026-03-29T22:00:00Z', time_zone: 'Europe/Warsaw' };
    const buckets = Array.from({ length: 23 }, (_, i) => ({ start: Date.parse(period.start) + i * 3600000, end: Date.parse(period.start) + (i + 1) * 3600000, change: 1 }));
    const sources = [{ statistic_id: 'sensor.a', status: 'ready' }, { statistic_id: 'sensor.b', status: 'no_data' }];
    const daily = card._dailyEnergySeries(period, sources, { 'sensor.a': buckets }, { 'sensor.a': metadata(), 'sensor.b': metadata() });
    assert.equal(daily.length, 1);
    assert.equal(daily[0].recorded_value, 23);
    assert.equal(daily[0].value, null);
    assert.equal(daily[0].status, 'partial');
    assert.equal(daily[0].observed_source_hours, 23);
    assert.equal(daily[0].expected_source_hours, 46);
  } finally { dom.window.close(); }
});

test('report views use the same recorded snapshot without requesting more statistics', async () => {
  const hass = makeHass({ metadataById: { 'sensor.grid_import': metadata() }, deferred: {
    'recorder/statistics_during_period': m => Promise.resolve({ 'sensor.grid_import': calendarSeries(m.start_time, m.end_time, [4]) }),
  } });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  try {
    let requests = 0;
    hass.callWS = () => { requests++; throw new Error('view changes must use the loaded snapshot'); };
    const find = text => [...card.shadowRoot.querySelectorAll('button')].find(b => b.textContent === text);
    find('Costs').click();
    assert.equal(card.shadowRoot.querySelector('[aria-label="Energy report views"] [aria-selected="true"]').textContent, 'Costs');
    find('Devices').click();
    find('Summary').click();
    assert.equal(requests, 0);
    assert.equal(card._buildExportDocument().energy.total.value, 4);
  } finally { card.remove(); dom.window.close(); }
});

test('empty Today retains the local window and explains the first completed hour', async () => {
  const hass = makeHass({ metadataById: { 'sensor.grid_import': metadata() }, statisticsById: {} });
  const { card, dom } = await mountCard({ hass, config: explicitConfig() });
  try {
    card._period = '1d';
    await card._loadEnergy();
    assert.equal(card._energyViewState.status, 'no_data');
    assert.ok(card.shadowRoot.querySelector('.report-context'));
    assert.match(card.shadowRoot.textContent, /completed hour|recorder samples/);
    assert.equal(card._buildExportDocument().energy.total.value, null);
  } finally { card.remove(); dom.window.close(); }
});

test('native editor exposes explicit sources while preserving existing advanced references', () => {
  const dom = loadRuntime();
  try {
    const editor = dom.window.document.createElement('ha-smart-reports-editor');
    editor.setConfig({ type: 'custom:ha-smart-reports', energy_source_mode: 'explicit', energy_total_statistics: [{ statistic_id: 'sensor.grid', label: 'Main circuit' }] });
    const select = editor.shadowRoot.querySelector('select');
    assert.ok(select);
    assert.equal(select.value, 'explicit');
    const sources = editor.shadowRoot.querySelector('textarea');
    assert.ok(sources);
    assert.equal(sources.value, 'sensor.grid');
    assert.equal(editor._config.energy_total_statistics[0].label, 'Main circuit');
    let result;
    editor.addEventListener('config-changed', event => { result = event.detail.config; });
    sources.value = 'sensor.grid\nsensor.other';
    sources.dispatchEvent(new dom.window.Event('change'));
    assert.deepEqual(Array.from(result.energy_total_statistics, x => typeof x === 'string' ? x : x.statistic_id), ['sensor.grid', 'sensor.other']);
  } finally { dom.window.close(); }
});
