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
