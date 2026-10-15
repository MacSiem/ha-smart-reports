'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mountCard}=require('./helpers/smart-reports-harness.cjs');
const devices=[
 {statistic_id:'sensor.parent',label:'Kitchen',value:10,recorded_value:10,unit:'kWh',status:'ready'},
 {statistic_id:'sensor.fridge',label:'Fridge',included_in_stat:'sensor.parent',depth:1,value:4,recorded_value:4,unit:'kWh',status:'ready'},
 {statistic_id:'sensor.office',label:'Office',value:20,recorded_value:20,unit:'kWh',status:'ready'},
];
async function fixture(language='en'){
 const f=await mountCard();f.card._hass={language,config:{time_zone:'UTC'},user:{id:'qa',is_admin:true},callWS:()=>{throw Error('Display search must not fetch');}};
 f.card._energyView='devices';f.card._setEnergyViewState({status:'ready',period:{key:'7d',start:'2026-08-23T00:00:00Z',end:'2026-08-30T00:00:00Z',time_zone:'UTC'},total:{value:30,unit:'kWh'},cost:{value:12,currency:'PLN'},recorded_total:{value:30},devices:structuredClone(devices),total_sources:[],cost_sources:[]});return f;
}
test('search matches label or statistic ID without mutating the full ranking or totals',async()=>{
 const f=await fixture();try{const before=JSON.stringify(f.card._energyViewState);const input=f.card.shadowRoot.querySelector('.device-search');assert.ok(input);input.value='  FRIDGE ';input.dispatchEvent(new f.window.Event('input'));
 assert.deepEqual(Array.from(f.card.shadowRoot.querySelectorAll('[data-device-statistic]'),e=>e.dataset.deviceStatistic),['sensor.fridge']);assert.equal(JSON.stringify(f.card._energyViewState),before);
 const text=f.card.shadowRoot.textContent;assert.match(text,/Kitchen/);assert.match(text,/sensor.parent/);assert.match(text,/30\.00 kWh/);
 const i=f.card.shadowRoot.querySelector('.device-search');i.value='sensor.office';i.dispatchEvent(new f.window.Event('input'));assert.deepEqual(Array.from(f.card.shadowRoot.querySelectorAll('[data-device-statistic]'),e=>e.dataset.deviceStatistic),['sensor.office']);
 }finally{f.card.remove();f.dom.window.close();}
});
test('search preserves full-snapshot JSON/CSV exports and the original bar scale',async()=>{
 const f=await fixture();try{const json=JSON.stringify(f.card._buildExportDocument('2026-08-30T00:00:00Z'));const before=f.card.shadowRoot.querySelector('[data-device-statistic="sensor.fridge"] .bar-fill').style.width;
 const i=f.card.shadowRoot.querySelector('.device-search');i.value='fridge';i.dispatchEvent(new f.window.Event('input'));assert.equal(f.card.shadowRoot.querySelector('.bar-fill').style.width,before);assert.equal(JSON.stringify(f.card._buildExportDocument('2026-08-30T00:00:00Z')),json);assert.match(f.card.shadowRoot.textContent,/Export includes all devices/);
 assert.equal(f.card._buildExportDocument('2026-08-30T00:00:00Z').energy.devices.length,3);
 }finally{f.card.remove();f.dom.window.close();}
});
test('typing retains focus and caret, Escape and clear restore the entire ordered ranking',async()=>{
 const f=await fixture();try{let i=f.card.shadowRoot.querySelector('.device-search');i.focus();i.value='fridge';i.setSelectionRange(2,2);i.dispatchEvent(new f.window.Event('input'));i=f.card.shadowRoot.querySelector('.device-search');assert.equal(f.card.shadowRoot.activeElement,i);assert.equal(i.selectionStart,2);
 i.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.card.shadowRoot.querySelectorAll('[data-device-statistic]').length,3);assert.equal(f.card.shadowRoot.activeElement,f.card.shadowRoot.querySelector('.device-search'));
 i=f.card.shadowRoot.querySelector('.device-search');i.value='absent';i.dispatchEvent(new f.window.Event('input'));assert.match(f.card.shadowRoot.textContent,/No matching devices/);f.card.shadowRoot.querySelector('.device-search-clear').click();assert.deepEqual(Array.from(f.card.shadowRoot.querySelectorAll('[data-device-statistic]'),e=>e.dataset.deviceStatistic),devices.map(e=>e.statistic_id));
 }finally{f.card.remove();f.dom.window.close();}
});
test('Polish search, parent context and full-export notice are localized and escaped',async()=>{
 const f=await fixture('pl');try{f.card._energyViewState.devices[1].label='<img src=x onerror=1>';f.card._renderEnergyState();assert.equal(f.card.shadowRoot.querySelector('img'),null);assert.match(f.card.shadowRoot.textContent,/Szukaj urządzenia/);assert.match(f.card.shadowRoot.textContent,/Eksport obejmuje wszystkie urządzenia/);assert.match(f.card.shadowRoot.textContent,/Urządzenie nadrzędne: Kitchen/);
 }finally{f.card.remove();f.dom.window.close();}
});

test('source search matches root label/ID, reveals matching evidence and preserves full export',async()=>{
 const f=await fixture();try{f.card._energyViewState.total_sources=[{statistic_id:'sensor.grid',label:'House import',unit:'kWh',value:30,status:'ready'}];f.card._renderEnergyState();const before=JSON.stringify(f.card._buildExportDocument('2026-08-30T00:00:00Z'));
  const i=f.card.shadowRoot.querySelector('.device-search');assert.ok(i);i.value='HOUSE';i.dispatchEvent(new f.window.Event('input'));assert.deepEqual(Array.from(f.card.shadowRoot.querySelectorAll('[data-energy-source]'),e=>e.dataset.energySource),['sensor.grid']);assert.equal(f.card.shadowRoot.querySelector('.source-evidence').open,true);assert.equal(f.card.shadowRoot.querySelectorAll('[data-device-statistic]').length,0);assert.equal(JSON.stringify(f.card._buildExportDocument('2026-08-30T00:00:00Z')),before);
 }finally{f.card.remove();f.dom.window.close();}
});

test('Devices puts search directly after its tabs and keeps the full report behind a disclosure',async()=>{
 const f=await fixture();try{
  const root=f.card.shadowRoot,nav=root.querySelector('[data-report-nav="energy"]');
  assert.ok(nav.nextElementSibling.classList.contains('device-search-form'),'device search must not be pushed below the four report KPIs');
  const totals=root.querySelector('.device-report-details');assert.ok(totals);assert.equal(totals.open,false);assert.equal(totals.querySelectorAll('.metric').length,4,'full report values remain available');
  assert.match(root.querySelector('.device-total-note').textContent,/30\.00 kWh/);
  totals.open=true;totals.dispatchEvent(new f.window.Event('toggle'));
  const input=root.querySelector('.device-search');input.focus();input.value='fridge';input.setSelectionRange(3,3);input.dispatchEvent(new f.window.Event('input'));
  assert.equal(root.querySelector('.device-report-details').open,true);assert.match(root.querySelector('.device-total-note').textContent,/30\.00 kWh/);assert.equal(root.activeElement,root.querySelector('.device-search'));assert.equal(root.activeElement.selectionStart,3);
 }finally{f.card.remove();f.dom.window.close();}
});
