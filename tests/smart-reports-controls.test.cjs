'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntime, makeHass, metadata, calendarSeries, explicitConfig, delay } = require('./helpers/smart-reports-harness.cjs');
async function fixture(mode = 'auto', width = 260) {
  const dom = loadRuntime(), { window } = dom, observers = [];
  window.ResizeObserver = class { constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.disconnected = true; } };
  const card = window.document.createElement('ha-smart-reports');
  card.getBoundingClientRect = () => ({ width });
  card._now = () => new Date('2026-08-30T12:00:00Z'); card._refreshThrottleMs = 0;
  const config = explicitConfig({energy_device_statistics:['sensor.device'], energy_cost_statistics:['sensor.money'], energy_cost_mode:mode, energy_price:2, currency:'PLN', compare_previous_period:true});
  const profile = {schema:1,currency:'PLN',timezone:'UTC',clock:{mode:'civil'},priceBasis:'gross',defaultZone:'base',zones:[{id:'base',energyRate:2,variableRate:0}]};
  let value = 1;
  const hass = makeHass({timeZone:'UTC',metadataById:{'sensor.grid_import':metadata(),'sensor.device':metadata(),'sensor.money':metadata('PLN')},deferred:{
    'recorder/statistics_during_period': m => Promise.resolve(Object.fromEntries(['sensor.grid_import','sensor.device','sensor.money'].map(id=>[id,calendarSeries(m.start_time,m.end_time,Array((Date.parse(m.end_time)-Date.parse(m.start_time))/3600000).fill(value))]))),
    'ha_tools_email/get_tariff': () => Promise.resolve({profile,revision:4,updated_at:null})
  }}); hass.connection = {connected:true};
  card.setConfig(config); window.document.body.appendChild(card); card.hass = hass;
  if(card._refreshTimer!==null){window.clearTimeout(card._refreshTimer);card._refreshTimer=null;}
  await card._loadEnergy();
  return {dom,window,card,hass,config,observers,resize(next){width=next;for(const o of observers.filter(o=>!o.disconnected))o.callback([{target:card,contentRect:{width}}]);},async refresh(){value++;await card._loadEnergy();},close(){card.remove();dom.window.close();}};
}
for (const mode of ['auto','cost_statistics','flat_rate_estimate','configured_tariff']) test(`narrow navigation is available in ${mode}, keeps every enabled section and invokes real handlers`,async()=>{
  const f=await fixture(mode);try{
    const r=f.card.shadowRoot, picker=r.querySelector('[data-report-picker="main"]'); assert.ok(picker);assert.equal(picker.hidden,false);
    assert.deepEqual(Array.from(picker.options,o=>o.value),['energy','automations','system']); assert.equal(r.querySelector('#tabs').hidden,true);
    for(const tab of ['automations','system','energy']){picker.value=tab;picker.dispatchEvent(new f.window.Event('change'));assert.equal(f.card._activeTab,tab);assert.equal(r.activeElement,picker);}
    f.card.setConfig({...f.config,show_system:false});assert.deepEqual(Array.from(picker.options,o=>o.value),['energy','automations']);
  }finally{f.close();}
});
test('resize moves focus before hiding either representation; observers disconnect and reconnect once',async()=>{
  const f=await fixture('auto',900);try{const r=f.card.shadowRoot;const button=r.querySelector('[data-tab="energy"]');button.focus();f.resize(260);
    assert.equal(r.activeElement,r.querySelector('[data-report-picker="main"]'));f.resize(900);assert.equal(r.activeElement,button);
    assert.equal(f.observers.filter(o=>!o.disconnected).length,1);f.card.remove();assert.equal(f.observers.filter(o=>!o.disconnected).length,0);
    f.window.document.body.appendChild(f.card);assert.equal(f.observers.filter(o=>!o.disconnected).length,1);
  }finally{f.close();}
});
test('each nested view retains all choices, selection and focus in its own compact picker',async()=>{
 const f=await fixture('configured_tariff');try{const r=f.card.shadowRoot;
  for(const [group,values,key] of [['energy',['summary','devices','costs'],'_energyView'],['cost',['chart','data'],'_costEvidenceView'],['comparison',['chart','data'],'_comparisonView']]){
   for(const value of values){const p=r.querySelector(`[data-report-picker="${group}"]`);assert.ok(p,group);assert.deepEqual(Array.from(p.options,o=>o.value),values);p.value=value;p.dispatchEvent(new f.window.Event('change'));assert.equal(f.card[key],value);assert.equal(r.activeElement,r.querySelector(`[data-report-picker="${group}"]`));}
  }
 }finally{f.close();}
});
test('changed recorder data preserves the comparison toggle and day identity/metric/side focus',async()=>{
 const f=await fixture('configured_tariff',900);try{const r=f.card.shadowRoot;
  const checkbox=r.querySelector('[data-compare-previous-period]');checkbox.focus();await f.refresh();assert.ok(r.activeElement.matches('[data-compare-previous-period]'));
  const day=r.querySelector('button[data-comparison-day][data-comparison-metric="cost"][data-side="previous"]');assert.ok(day);const identity={...day.dataset};day.focus();await f.refresh();
  assert.equal(r.activeElement.dataset.comparisonDay,identity.comparisonDay);assert.equal(r.activeElement.dataset.comparisonMetric,'cost');assert.equal(r.activeElement.dataset.side,'previous');
 }finally{f.close();}
});
test('refresh restores cost controls and search selection but never steals external focus',async()=>{
 const f=await fixture('configured_tariff',900);try{const r=f.card.shadowRoot;
  r.querySelector('[data-cost-view="data"]').click();r.querySelector('[data-cost-view="data"]').focus();await f.refresh();assert.equal(r.activeElement.dataset.costView,'data');
  r.querySelector('[data-energy-view="devices"]').click();let search=r.querySelector('.device-search');search.value='dev';search.dispatchEvent(new f.window.Event('input'));search=r.querySelector('.device-search');search.focus();search.setSelectionRange(1,3,'backward');await f.refresh();assert.equal(r.activeElement.className,'device-search');assert.equal(r.activeElement.selectionDirection,'backward');assert.equal(r.activeElement.selectionStart,1);
  const outside=f.window.document.createElement('input');f.window.document.body.appendChild(outside);outside.focus();await f.refresh();assert.equal(f.window.document.activeElement,outside);
 }finally{f.close();}
});
test('removed or disabled focused report control falls back to a visible navigation control',async()=>{
 const f=await fixture('configured_tariff',260);try{const r=f.card.shadowRoot;const day=r.querySelector('button[data-comparison-day]');day.focus();f.card._setEnergyViewState({status:'permission_denied'});assert.equal(r.activeElement,r.querySelector('#periodSelect'));assert.equal(r.querySelector('button[data-comparison-day]'),null);
 }finally{f.close();}
});
for(const locale of ['en','pl']) test(`editor synchronous config echo preserves live node and selection, then ${locale} labels and external values`,()=>{
 const dom=loadRuntime();try{const w=dom.window,e=w.document.createElement('ha-smart-reports-editor');e.setConfig({title:'Example',energy_source_mode:'explicit',unknown:{keep:1},energy_total_statistics:[{statistic_id:'sensor.grid_import',label:'Grid'}]});w.document.body.appendChild(e);let count=0;e.addEventListener('config-changed',event=>{count++;e.setConfig(event.detail.config);});
  const input=e.shadowRoot.querySelector('#cf_title');input.focus();input.value='A & <B>';input.setSelectionRange(1,5,'backward');input.dispatchEvent(new w.Event('input'));assert.equal(e.shadowRoot.querySelector('#cf_title'),input);assert.equal(e.shadowRoot.activeElement,input);assert.equal(input.selectionDirection,'backward');assert.equal(input.selectionStart,1);assert.equal(count,1);assert.equal(e._config.unknown.keep,1);
  e.hass={language:locale};const translated=e.shadowRoot.querySelector('#cf_title');assert.equal(e.shadowRoot.activeElement,translated);assert.equal(translated.selectionStart,1);assert.equal(translated.selectionDirection,'backward');
  e.setConfig({...e._config,title:'External'});assert.equal(e.shadowRoot.querySelector('#cf_title').value,'External');
  const outside=w.document.createElement('input');w.document.body.appendChild(outside);outside.focus();e.setConfig({...e._config,title:'Another'});assert.equal(w.document.activeElement,outside);
 }finally{dom.window.close();}
});
test('editor statistic drafts survive locale changes and commit advanced metadata without duplicate listeners',()=>{
 const dom=loadRuntime();try{const w=dom.window,e=w.document.createElement('ha-smart-reports-editor');e.setConfig({energy_source_mode:'explicit',energy_total_statistics:[{statistic_id:'sensor.grid_import',label:'Grid'}]});w.document.body.appendChild(e);
  const area=e.shadowRoot.querySelector('textarea');area.focus();area.value='sensor.grid_import\nsensor.new';area.setSelectionRange(2,7,'forward');e.hass={language:'pl'};const next=e.shadowRoot.querySelector('textarea');assert.equal(e.shadowRoot.activeElement,next);assert.equal(next.value,'sensor.grid_import\nsensor.new');assert.equal(next.selectionStart,2);
  let count=0;e.addEventListener('config-changed',event=>{count++;e.setConfig(event.detail.config);});next.dispatchEvent(new w.Event('change'));assert.equal(count,1);assert.equal(e._config.energy_total_statistics[0].label,'Grid');assert.equal(e._config.energy_total_statistics[1],'sensor.new');
 }finally{dom.window.close();}
});
