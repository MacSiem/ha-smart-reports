'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeHass, metadata, calendarSeries, explicitConfig, mountCard, delay } = require('./helpers/smart-reports-harness.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const dialog = card => card.shadowRoot.querySelector('[data-ha-tools-export]')?.shadowRoot;
const node = (card, key) => dialog(card)?.querySelector(`[data-export="${key}"]`);
async function setup({ comparison = true, tariff = false, household = false, count = 3 } = {}) {
  const ids = ['sensor.grid_import', 'sensor.money', ...Array.from({ length: count }, (_, i) => `sensor.private_device_${i}`)];
  const hass = makeHass({ metadataById: Object.fromEntries(ids.map(id => [id, metadata(id === 'sensor.money' ? 'PLN' : 'kWh', {name:'PRIVATE_LABEL'})])),
    deferred: {'recorder/statistics_during_period': m => Promise.resolve(Object.fromEntries(ids.map(id => [id, calendarSeries(m.start_time,m.end_time,[id === 'sensor.money' ? -4 : 2])])))} });
  const listeners = new Map();
  hass.connection = { connected:true, addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(fn); }, removeEventListener(type,fn) { listeners.get(type)?.delete(fn); } };
  hass.user.is_admin = !household;
  const config = explicitConfig({ compare_previous_period: comparison, energy_cost_statistics:['sensor.money'], energy_device_statistics: ids.slice(2).map((statistic_id,i)=>({statistic_id,label:`PRIVATE_LABEL_${i}`, ...(i ? {included_in_stat:ids[2]} : {})})),
    ...(tariff ? { energy_cost_mode:'configured_tariff', tariff_profile:{schema:1,currency:'PLN',timezone:'Europe/Warsaw',clock:{mode:'civil'},priceBasis:'gross',fixedMonthly:15,defaultZone:'PRIVATE_ZONE',allowNegativeEnergy:true,zones:[{id:'PRIVATE_ZONE',label:'PRIVATE_ZONE_NAME',energyRate:-2,variableRate:0}]} } : {}) });
  const f = await mountCard({hass, config});
  // Idle existing scheduled refreshes are not part of preview/Save observations.
  f.card._refreshThrottleMs = 1000000;
  f.emit = type => { for (const fn of listeners.get(type)||[]) fn({type}); };
  f.close = () => { f.card.remove(); f.dom.window.close(); };
  return f;
}
async function open(f, format = 'json') { f.card.shadowRoot.getElementById(format === 'json' ? 'exportJsonBtn' : 'exportCsvBtn').click(); await delay(); return node(f.card,'preview')?.textContent; }
async function consent(f) { const input=node(f.card,'private'); input.checked=true;input.dispatchEvent(new f.window.Event('change')); assert.equal(node(f.card,'save').disabled,true); node(f.card,'refresh').click();await delay(); }
function blobText(window, blob) { return new Promise((resolve,reject)=>{const r=new window.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsText(blob);}); }

// Regression: clicking either real export button must never immediately download.
for (const format of ['json','csv']) test(`W6 ${format} exact reviewed Blob, one handoff, no API`,async()=>{
 const f=await setup();try {
  const calls=f.hass.calls.length, blobs=[];let clicks=0;
  f.window.URL.createObjectURL=b=>{blobs.push(b);return 'blob:reviewed';};
  f.window.HTMLAnchorElement.prototype.click=function(){clicks++;assert.equal(this.download,`smart-report-7d.${format}`);};
  const preview=await open(f,format);assert.ok(preview);assert.equal(clicks,0);assert.equal(node(f.card,'private').checked,false);assert.equal(f.hass.calls.length,calls);
  assert.doesNotMatch(preview,/sensor\.|PRIVATE_LABEL|demo_user|PRIVATE_ZONE/);
  node(f.card,'save').click();node(f.card,'save').click();await delay();assert.equal(clicks,1);assert.equal(blobs.length,1);assert.equal(await blobText(f.window,blobs[0]),preview);assert.equal(f.hass.calls.length,calls);assert.equal(node(f.card,'save').disabled,true);
 }finally{f.close();}
});

// Regression: final boundary must preserve ALL measured fields while rejecting unknown nested fields.
test('W6 reviewed projection preserves full tariff/comparison/hidden-device data and rejects injected fields',async()=>{
 const f=await setup({tariff:true,count:55});try {
  f.card._deviceQuery='no matching device';
  const raw=plain(f.card._buildExportDocument(f.card._now()));
  const inject=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(inject);return;}Object.values(value).forEach(inject);value.unknown_private='NEVER_EXPORT';value.token='NEVER_EXPORT';value.profile={name:'NEVER_EXPORT'};};inject(raw);
  const projected=f.card._projectReviewedExport(raw,true);
  assert.doesNotMatch(JSON.stringify(projected),/NEVER_EXPORT|unknown_private|"token"|"profile"/);
  const expected=plain(f.card._buildExportDocument(f.card._now()));
  // Zone IDs are always aliases; every numerical field/record remains equal.
  const measured=value=>{if(Array.isArray(value))return value.map(measured);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['zone','zones'].includes(k)).map(([k,v])=>[k,measured(v)]));return value;};
  assert.deepEqual(measured(plain(projected)),measured(expected));
  const exported=JSON.parse(await open(f));assert.equal(exported.energy.devices.length,55);assert.equal(exported.comparison.previous.devices.length,55);
  assert.equal(exported.energy.tariff.fixed_monthly,15);assert.equal(exported.energy.tariff.records[0].energyRate,-2);assert.equal(exported.energy.tariff.records[0].variableRate,0);
  assert.equal(exported.comparison.records.length,expected.comparison.records.length);assert.equal(exported.comparison.daily.length,7);
  const alias=exported.energy.total.source_statistic_ids[0];assert.equal(exported.energy.tariff.records[0].source_statistic_ids[0],alias);assert.equal(Object.keys(exported.energy.tariff.records[0].source_kwh)[0],alias);
  assert.equal(exported.energy.devices[1].included_in_stat,exported.energy.devices[0].statistic_id);
  assert.equal(exported.export_scope.counts.devices,55);assert.equal(exported.export_scope.truncated,false);
  await consent(f);const named=JSON.parse(node(f.card,'preview').textContent);assert.equal(named.energy.devices[0].label,'PRIVATE_LABEL_0');assert.equal(named.energy.devices[0].statistic_id,'sensor.private_device_0');
  assert.doesNotMatch(JSON.stringify(named),/PRIVATE_ZONE_NAME|"tariff_profile"|"users"|"addresses"/);
 }finally{f.close();}
});

test('W6 partial and no-data metadata preserve zero, negative, null, offsets and missing coverage',async()=>{
 const f=await setup();try {
  const raw=plain(f.card._buildExportDocument(f.card._now()));raw.period.time_zone='Australia/Lord_Howe';raw.comparison.current.period.actual_hours=24.5;
  raw.energy.total.value=0;raw.energy.cost.value=-4;raw.energy.devices[0].value=null;raw.energy.devices[0].coverage.observed_hours=0;raw.energy.status='partial';
  raw.comparison.metrics.energy={current:0,previous:0,unit:'kWh',delta:0,percent:null,comparable:true,reason:'previous_zero',provenance:'complete_comparable_measurements'};
  const p=plain(f.card._projectReviewedExport(raw,false));assert.equal(p.energy.total.value,0);assert.equal(p.energy.cost.value,-4);assert.equal(p.energy.devices[0].value,null);assert.equal(p.energy.devices[0].coverage.observed_hours,0);assert.equal(p.comparison.current.period.actual_hours,24.5);assert.equal(p.period.time_zone,'Australia/Lord_Howe');assert.equal(p.comparison.metrics.energy.percent,null);
  f.card._setEnergyViewState({...f.card._energyViewState,status:'no_data',total:{value:null,unit:'kWh',source_statistic_ids:[]}});
  const file=JSON.parse(await open(f));assert.equal(file.energy.total.value,null);assert.equal(file.export_scope.result_state,'no_data');assert.equal(node(f.card,'status').dataset.resultState,'partial');
 }finally{f.close();}
});

test('W6 filename/format/consent changes require explicit preview and repaint preserves caret',async()=>{
 const f=await setup();try {
  await open(f);const name=node(f.card,'filename');name.focus();name.value='reviewed.json';name.setSelectionRange(3,6);name.dispatchEvent(new f.window.Event('input'));
  f.card._renderEnergyState();assert.equal(node(f.card,'filename'),name);assert.equal(dialog(f.card).activeElement,name);assert.equal(name.selectionStart,3);assert.equal(name.selectionEnd,6);assert.equal(node(f.card,'save').disabled,true);
  node(f.card,'refresh').click();await delay();assert.equal(node(f.card,'save').disabled,false);
  node(f.card,'format').value='csv';node(f.card,'format').dispatchEvent(new f.window.Event('change'));assert.equal(node(f.card,'save').disabled,true);
  name.value='reviewed.csv';name.dispatchEvent(new f.window.Event('input'));node(f.card,'refresh').click();await delay();assert.match(node(f.card,'preview').textContent,/reviewed_full_document/);
  await consent(f);node(f.card,'cancel').click();await open(f);assert.equal(node(f.card,'private').checked,false);
 }finally{f.close();}
});

// Regression: ordinary household read access must not be replaced with admin-only export.
test('W6 household read access, offline/reconnect, role/user/locale/source/tariff/detach invalidation',async()=>{
 const f=await setup({household:true});try {
  await open(f);assert.equal(node(f.card,'save').disabled,false);await consent(f);
  f.emit('disconnected');assert.equal(node(f.card,'save').disabled,true);assert.equal(node(f.card,'private').checked,false);assert.equal(node(f.card,'preview').textContent,'');
  f.emit('ready');await delay();assert.equal(node(f.card,'save').disabled,true);assert.equal(node(f.card,'preview').textContent,'');
  await f.card._loadEnergy();node(f.card,'refresh').click();await delay();assert.equal(node(f.card,'save').disabled,false);
  f.hass.user.is_admin=true;f.card.hass=f.hass;assert.equal(node(f.card,'save').disabled,true);
  f.card.remove();assert.equal(dialog(f.card),undefined);
 }finally{f.close();}
});
for (const mutate of [
 f=>{f.hass.user.id='different_user';f.card.hass=f.hass;},
 f=>{f.hass.language='pl';f.card.hass=f.hass;},
 f=>{f.hass.locale={language:'pl',number_format:'comma_decimal'};f.card.hass=f.hass;},
 f=>{f.hass.connection={connected:true};f.card.hass=f.hass;},
 f=>{f.card.setConfig({...f.card._config,energy_device_statistics:[]});},
 f=>{f.card.setConfig({...f.card._config,tariff_profile:{schema:1}});},
 f=>{const p=f.card.shadowRoot.getElementById('periodSelect');p.value='1d';p.dispatchEvent(new f.window.Event('change'));},
 f=>{f.window.dispatchEvent(new f.window.Event('offline'));},
]) test('W6 context mutation consumes bytes and private consent immediately',async()=>{
 const f=await setup();try {await open(f);await consent(f);mutate(f);assert.equal(node(f.card,'save')?.disabled??true,true);assert.equal(node(f.card,'preview')?.textContent??'','');assert.equal(node(f.card,'private')?.checked??false,false);}finally{f.close();}
});

test('W6 late recorder result after user change cannot become exportable',async()=>{
 const f=await setup({comparison:false});try {
  let release;const old=f.hass.callWS;f.hass.callWS=m=>m.type==='recorder/statistics_during_period'?new Promise(resolve=>{release=resolve;}):old.call(f.hass,m);
  f.card.hass=f.hass;const work=f.card._loadEnergy();for(let i=0;i<20&&!release;i++)await Promise.resolve();assert.ok(release);
  f.hass.user.id='new_user';f.card.hass=f.hass;
  release({'sensor.grid_import':calendarSeries('2026-08-23T22:00:00Z','2026-08-30T12:00:00Z',[999])});await work;
  assert.notEqual(f.card._energyViewState.total?.value,999);assert.equal(f.card._reviewedExportContext().sourceConfirmed,false);
 }finally{f.close();}
});


test('native export survives actual content repaint with frozen bytes and caret; cancel restores current opener',async()=>{
 const f=await setup();try{
  let downloads=0;f.window.HTMLAnchorElement.prototype.click=function(){downloads++;};
  await open(f);const host=f.card.shadowRoot.querySelector('[data-ha-tools-export]'),native=dialog(f.card).querySelector('dialog');assert(native);assert(native.matches(':modal'));
  const name=node(f.card,'filename');name.value='native-reviewed.json';name.dispatchEvent(new f.window.Event('input'));node(f.card,'refresh').click();await delay();const frozen=node(f.card,'preview').textContent;assert(frozen.length);
  name.focus();name.setSelectionRange(2,7);const oldContent=f.card.shadowRoot.querySelector('#content').firstChild;const observer=new f.window.MutationObserver(()=>{});observer.observe(f.card.shadowRoot,{childList:true,subtree:true});
  f.card._renderEnergyState();const removed=observer.takeRecords().some(change=>Array.from(change.removedNodes).some(node=>node===host||node.contains?.(host)));observer.disconnect();
  assert.equal(removed,false);assert.equal(oldContent.isConnected,false);assert.equal(f.card.shadowRoot.querySelector('[data-ha-tools-export]'),host);assert(native.matches(':modal'));assert.equal(dialog(f.card).querySelector('dialog'),native);assert.equal(node(f.card,'filename'),name);assert.equal(name.value,'native-reviewed.json');assert.equal(name.selectionStart,2);assert.equal(name.selectionEnd,7);assert.equal(dialog(f.card).activeElement,name);assert.equal(node(f.card,'preview').textContent,frozen);assert.equal(downloads,0);
  native.dispatchEvent(new f.window.Event('cancel',{cancelable:true}));await delay();assert.equal(native.open,false);assert.equal(dialog(f.card),undefined);assert.equal(f.card.shadowRoot.activeElement.id,'exportJsonBtn');await open(f);assert(dialog(f.card).querySelector('dialog').matches(':modal'));assert.equal(node(f.card,'private').checked,false);assert.equal(downloads,0);
 }finally{f.close();}
});
