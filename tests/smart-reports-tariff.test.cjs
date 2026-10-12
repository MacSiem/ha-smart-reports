'use strict';
// Breaks caught: accidental default API reads/fallback, device double counting,
// aggregate past pricing, optimistic totals, hidden private export, divergent views.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntime, makeHass, mountCard, metadata, calendarSeries, explicitConfig } = require('./helpers/smart-reports-harness.cjs');
const { createEnergyTariffV3 } = require('../shared/ha-tools-energy-tariff.js');
const profile = (extra = {}) => ({ schema:1,currency:'EUR',timezone:'UTC',clock:{mode:'civil'},priceBasis:'gross',fixedMonthly:12,defaultZone:'base',zones:[{id:'base',energyRate:2,variableRate:0}],rules:[],exceptions:[],...extra });
const period = { key:'test', start:'2026-10-25T00:00:00Z',end:'2026-10-25T02:00:00Z',time_zone:'Europe/Warsaw' };
const rows = (changes=[1,2]) => calendarSeries(period.start,period.end,changes);
function fixture() { const dom=loadRuntime(), card=dom.window.document.createElement('ha-smart-reports'); card.setConfig(explicitConfig({energy_cost_mode:'configured_tariff'})); return {dom,card}; }
function price(card, data, p=profile(), md={'sensor.grid_import':metadata()}, sources=[{statistic_id:'sensor.grid_import',role:'total'}]) { return card._priceConfiguredTariff(period,sources,data,md,{profile:p,revision:7,provenance:'shared_backend'}); }
test('auto retains monetary priority and explicit flat zero without tariff requests',async()=>{
 const hass=makeHass({metadataById:{'sensor.grid_import':metadata(),'sensor.cost':metadata('PLN')},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[3]),'sensor.cost':calendarSeries(m.start_time,m.end_time,[4])})}});
 const {dom,card}=await mountCard({hass,config:explicitConfig({energy_price:0,currency:'PLN',energy_cost_statistics:['sensor.cost']})});
 try { assert.equal(card._energyViewState.cost.method,'cost_statistics'); assert.equal(card._energyViewState.cost.value,4); assert.equal(hass.calls.some(m=>m.type.includes('tariff')),false);
 card.setConfig(explicitConfig({energy_price:0,currency:'PLN',energy_cost_mode:'flat_rate_estimate'})); await card._loadEnergy(); assert.equal(card._energyViewState.cost.value,0); assert.equal(card._energyViewState.cost.method,'flat_rate_estimate');
 } finally {card.remove();dom.window.close();}
});
test('real root buckets price measured zero and multi-root hours once, devices never contribute',()=>{ const {dom,card}=fixture(); try {
 const sources=[{statistic_id:'sensor.a',role:'total'},{statistic_id:'sensor.b',role:'total'}];
 const cost=price(card,{'sensor.a':rows([1,0]),'sensor.b':rows([2,0]),'sensor.device':rows([500,500])},profile(),{'sensor.a':metadata(),'sensor.b':metadata()},sources);
 assert.equal(cost.value,6); assert.equal(cost.coverage.observed_hours,2); assert.equal(cost.records[1].kwh,0); assert.equal(cost.records[1].energyCost,0); assert.equal(cost.fixed_monthly,12); assert.equal(cost.revision,7); assert.ok(Object.isFrozen(cost.records)); assert.ok(Object.isFrozen(cost.records[0]));
 } finally {dom.window.close();} });
test('missing root hours are a labelled measured common-hour subset, never a complete total',()=>{const {dom,card}=fixture();try{
 const c=price(card,{'sensor.grid_import':rows().slice(0,1)}); assert.equal(c.value,null);assert.equal(c.measured_energy_cost,2);assert.equal(c.coverage.observed_hours,1);assert.equal(c.records[1].available,false);assert.equal(c.records[1].energyCost,null);
 }finally{dom.window.close();}});
test('duplicate/overlap/nonaligned/missing metadata or negative measured energy cannot produce priced totals',()=>{const {dom,card}=fixture();try{
 for(const bad of [[...rows(),rows()[0]],rows().map(b=>({...b,end:b.end-1})),rows().map(b=>({...b,change:-1}))]) {const c=price(card,{'sensor.grid_import':bad});assert.equal(c.value,null);assert.equal(c.measured_energy_cost,null);}
 assert.equal(price(card,{'sensor.grid_import':rows()},profile(),{}).value,null);
 }finally{dom.window.close();}});
test('canonical civil DST/fixed clock/date exception and mixed-rate rejection are retained',()=>{const {dom,card}=fixture();try{
 const p=profile({timezone:'Europe/Warsaw',zones:[{id:'base',energyRate:2,variableRate:null},{id:'special',energyRate:3,variableRate:0}],exceptions:[{zone:'special',dates:['2026-10-25'],intervals:[{from:'02:00',to:'03:00'}]}]});
 assert.equal(price(card,{'sensor.grid_import':rows()},p).value,9); // repeated 02:00, two absolute hours
 const mixed=profile({zones:[{id:'base',energyRate:2},{id:'special',energyRate:3}],rules:[{zone:'special',intervals:[{from:'00:30',to:'01:00'}]}]});assert.equal(price(card,{'sensor.grid_import':rows()},mixed).records[0].reason,'mixed_rate_bucket');
 const fixed=profile({...p,clock:{mode:'fixed',offsetMinutes:0}});assert.equal(price(card,{'sensor.grid_import':rows()},fixed).value,6);
 assert.equal(createEnergyTariffV3(p).priceBuckets([{from:period.start,to:'2026-10-25T01:00:00Z',kwh:1}]).rows[0].energyCost,3);
 }finally{dom.window.close();}});
test('negative rates need explicit consent; invalid profile/currency/backend never use flat fallback',()=>{const {dom,card}=fixture();try{
 card.setConfig(explicitConfig({energy_cost_mode:'configured_tariff',energy_price:99,currency:'EUR'}));
 const negative=profile({zones:[{id:'base',energyRate:-2,variableRate:0}]});assert.equal(price(card,{'sensor.grid_import':rows()},negative).value,null);assert.equal(price(card,{'sensor.grid_import':rows()},{...negative,allowNegativeEnergy:true}).value,-6);
 assert.equal(price(card,{'sensor.grid_import':rows()},profile({currency:'eur'})).value,null);
 assert.equal(price(card,{'sensor.grid_import':rows()},null).value,null);
 assert.equal(price(card,{'sensor.grid_import':rows()},profile({validFrom:'2027-01-01'})).value,null);
 }finally{dom.window.close();}});
test('configured tariff uses one existing statistics request and optional backend read',async()=>{
 const hass=makeHass({metadataById:{'sensor.grid_import':metadata()},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[3])}),'ha_tools_email/get_tariff':()=>Promise.resolve({profile:profile(),revision:4,updated_at:null})}});hass.connection={connected:true};
 const {dom,card}=await mountCard({hass,config:explicitConfig({energy_cost_mode:'configured_tariff'})});try{
 assert.equal(card._energyViewState.cost.value,6);assert.equal(hass.calls.filter(m=>m.type==='recorder/statistics_during_period').length,1);assert.equal(hass.calls.filter(m=>m.type==='ha_tools_email/get_tariff').length,1);
 card._energyView='costs';card._renderEnergyState();const calls=hass.calls.length;const snapshot=card._energyViewState.cost.records;
 card.shadowRoot.querySelector('[data-cost-view="data"]').click();assert.equal(card._energyViewState.cost.records,snapshot);assert.equal(hass.calls.length,calls);assert.equal(card.shadowRoot.querySelectorAll('[data-priced-row]').length,snapshot.length);
 const exp=card._buildExportDocument();assert.equal(exp.schema_version,2);assert.equal(exp.energy.tariff.revision,4);assert.equal(exp.energy.tariff.records[0].energyCost,6);assert.equal('profile' in exp.energy.tariff,false);assert.equal('exceptions' in exp.energy.tariff,false);assert.ok(exp.energy.devices);assert.ok(exp.energy.daily);assert.match(card._buildCsv(exp),/tariff_hour_energy/);
 }finally{card.remove();dom.window.close();}
});
test('native editor preserves unknown config and advanced sources while editing zero flat rate and cost mode',()=>{const dom=loadRuntime();try{
 const editor=dom.window.document.createElement('ha-smart-reports-editor');editor.setConfig({...explicitConfig(),unknown:{keep:true},energy_price:9,energy_total_statistics:[{statistic_id:'sensor.grid_import',label:'Grid'}]});let result;editor.addEventListener('config-changed',e=>result=e.detail.config);
 const rate=editor.shadowRoot.querySelector('#cf_energy_price');rate.value='0';rate.dispatchEvent(new dom.window.Event('change'));assert.equal(result.energy_price,0);assert.equal(result.unknown.keep,true);assert.equal(result.energy_total_statistics[0].label,'Grid');
 const mode=editor.shadowRoot.querySelector('#cf_cost_mode');mode.value='configured_tariff';mode.dispatchEvent(new dom.window.Event('change'));assert.equal(result.energy_cost_mode,'configured_tariff');
 }finally{dom.window.close();}});
test('tariff settings preserve active input focus across report rerender and role revocation clears export',async()=>{
 const hass=makeHass({metadataById:{'sensor.grid_import':metadata()},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[3])}),'ha_tools_email/get_tariff':()=>Promise.resolve({profile:profile(),revision:4,updated_at:null})}});hass.connection={connected:true};
 const {dom,card}=await mountCard({hass,config:explicitConfig({energy_cost_mode:'configured_tariff'})});try{
 const details=card.shadowRoot.querySelector('[data-tariff-details]');details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));const name=card.shadowRoot.querySelector('[data-path="name"]');name.focus();name.value='Private draft';name.dispatchEvent(new dom.window.Event('input'));card._renderEnergyState();assert.equal(card.shadowRoot.activeElement.dataset.path,'name');
 hass.user.is_active=false;const exp=card._buildExportDocument();assert.equal(exp.energy.cost.value,null);assert.equal(exp.energy.tariff,undefined);assert.equal(card.shadowRoot.textContent.includes('Private draft'),false);
 }finally{card.remove();dom.window.close();}
});
test('measured kWh remains known when an hour has mixed rates; money remains a gap',()=>{const {dom,card}=fixture();try{
 const p=profile({zones:[{id:'base',energyRate:2},{id:'other',energyRate:4}],rules:[{zone:'other',intervals:[{from:'00:30',to:'01:00'}]}]});const cost=price(card,{'sensor.grid_import':rows()},p);assert.equal(cost.records[0].measurement_available,true);assert.equal(cost.records[0].kwh,1);assert.equal(cost.records[0].available,false);assert.equal(cost.records[0].energyCost,null);
}finally{dom.window.close();}});
test('custom overnight/date rules and absolute negative dynamic feed use canonical measured pricing',()=>{const {dom,card}=fixture();try{
 const p=profile({priceBasis:'net',timezone:'America/New_York',clock:{mode:'fixed',offsetMinutes:0},zones:[{id:'base',energyRate:2,variableRate:null},{id:'night',energyRate:1,variableRate:0.5}],rules:[{zone:'night',weekdays:[6],intervals:[{from:'22:00',to:'02:00'}]}]});
 // Sunday 00:00 belongs to the explicitly selected Saturday overnight rule.
 const c=price(card,{'sensor.grid_import':rows()},p);assert.equal(c.value,3);assert.equal(c.variable_cost,1.5);assert.equal(c.usage_cost,4.5);assert.equal(c.price_basis,'net');
 const dynamic=profile({allowNegativeEnergy:true,dynamic:{intervals:[{from:period.start,to:period.end,energyRate:-1,variableRate:0}]}});assert.equal(price(card,{'sensor.grid_import':rows()},dynamic).value,-3);
}finally{dom.window.close();}});
test('ordinary report rerender keeps the same pending editor and confirms save after independent readback',async()=>{
 let release,revision=4,stored=profile(),reads=0;const hass=makeHass({metadataById:{'sensor.grid_import':metadata()},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[3])}),'ha_tools_email/get_tariff':()=>{reads++;return Promise.resolve({profile:stored,revision,updated_at:revision===4?null:'2026-10-12T00:00:00Z'});},'ha_tools_email/set_tariff':m=>new Promise(resolve=>{release=()=>{stored=m.profile;revision=5;resolve({revision:5});};})}});hass.connection={connected:true};const {dom,card}=await mountCard({hass,config:explicitConfig({energy_cost_mode:'configured_tariff'})});try{
 const details=card.shadowRoot.querySelector('[data-tariff-details]');details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));const mount=card.shadowRoot.querySelector('[data-tariff-mount]');card.shadowRoot.querySelector('[data-action="save"]').click();assert.equal(card._tariffEditorState.busy,true);card._renderEnergyState();assert.equal(card.shadowRoot.querySelector('[data-tariff-mount]'),mount);
 release();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(card._tariffEditorState.busy,false);assert.equal(card._tariffEditorState.status,'success');assert.equal(card._energyViewState.cost.revision,5);assert.equal(reads,2);
 }finally{card.remove();dom.window.close();}
});
