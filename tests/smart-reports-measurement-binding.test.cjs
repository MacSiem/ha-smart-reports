'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {mountCard,makeHass,metadata,calendarSeries,explicitConfig,delay}=require('./helpers/smart-reports-harness.cjs');
async function fixture(){
 let hold=false,release;const pending=new Promise(resolve=>release=resolve);
 const hass=makeHass({metadataById:{'sensor.grid_import':metadata('kWh'), 'sensor.old_device':metadata('kWh')},
  states:{'sensor.old_device':{attributes:{friendly_name:'Session A private device'}}},
  deferred:{'recorder/statistics_during_period':async msg=>{if(hold)await pending;return {
   'sensor.grid_import':calendarSeries(msg.start_time,msg.end_time,[987]),
   'sensor.old_device':calendarSeries(msg.start_time,msg.end_time,[11])};}}});
 hass.user.id='A';hass.connection={connected:true};
 const f=await mountCard({hass,config:explicitConfig({energy_device_statistics:['sensor.old_device']})});
 f.card._energyView='devices';f.card._renderEnergyState();f.card._refreshThrottleMs=60000;
 assert.equal(f.card._energyViewState.total.value,987);assert.ok(f.card.shadowRoot.textContent.includes('Session A private device'));
 assert.ok(!f.card._tariffGuard,'basic auto/compare-off path must be tested without incidental tariff guard protection');
 return {...f,hold(){hold=true;return release;},close(){f.card.remove();f.dom.window.close();}};
}
for(const change of ['connection','user','timezone','null'])test(`basic report discards accepted A measurements synchronously on ${change}, including in-place HA changes`,async()=>{
 const f=await fixture();try{
  if(change==='connection')f.hass.connection={connected:true};
  if(change==='user')f.hass.user.id='B';
  if(change==='timezone')f.hass.config.time_zone='Asia/Kathmandu';
  f.card.hass=change==='null'?null:f.hass;
  assert.ok(!f.card._energyViewState?.total?.value,'ready measurements must not survive the session boundary');
  assert.ok(!f.card.shadowRoot.textContent.includes('Session A private device'),'private source DOM must disappear before a scheduled read');
  assert.equal(f.card._energyReportConfig,null);
 }finally{f.close();}
});
test('basic report keeps current measurements and device search on locale/theme changes',async()=>{
 const f=await fixture();try{
  const input=f.card.shadowRoot.querySelector('.device-search');input.value='Session';input.dispatchEvent(new f.window.Event('input'));const calls=f.hass.calls.length;
  f.card.hass={...f.hass,language:'pl',themes:{darkMode:true}};
  assert.equal(f.card._energyViewState.total.value,987);assert.equal(f.card._deviceQuery,'Session');assert.equal(f.hass.calls.length,calls);
 }finally{f.close();}
});
test('basic report null to B cannot revive an old pending read or its ready snapshot',async()=>{
 const f=await fixture();try{
  const release=f.hold(),pending=f.card._loadEnergy();await delay();
  f.card.hass=null;f.card.hass={...f.hass,user:{id:'B',is_admin:true},connection:{connected:true}};
  release();await pending;
  assert.ok(!f.card._energyViewState?.total?.value);assert.ok(!f.card.shadowRoot.textContent.includes('Session A private device'));
 }finally{f.close();}
});
