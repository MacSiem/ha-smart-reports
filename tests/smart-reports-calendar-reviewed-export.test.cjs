'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fixture=require('./fixtures/analysis-calendar-v53.json');
const {featureCapabilities}=require('./helpers/smart-reports-feature-capabilities.cjs');
const {loadRuntime,makeHass,explicitConfig,delay}=require('./helpers/smart-reports-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const dialog=card=>card.shadowRoot.querySelector('[data-ha-tools-export]')?.shadowRoot;
const field=(card,key)=>dialog(card)?.querySelector(`[data-export="${key}"]`);
async function setup(){
 const dom=loadRuntime(),w=dom.window,card=w.document.createElement('ha-smart-reports'),listeners=new Set();let pending=false;
 const dto=clone(fixture);dto.groups.devices['sensor.device'].unknown='NEVER_EXPORT';dto.context.auth='NEVER_EXPORT';
 const hass=makeHass({timeZone:'UTC',deferred:{'ha_tools_email/feature_capabilities':()=>featureCapabilities(hass.user.is_admin===true),'ha_tools_email/energy_analysis':()=>pending?new Promise(()=>{}):Promise.resolve(clone(dto))}});
 hass.user.is_active=true;hass.user.is_admin=false;
 hass.connection={connected:true,subscribeMessage:async(fn)=>{listeners.add(fn);return()=>listeners.delete(fn);},addEventListener(){},removeEventListener(){}};
 card.setConfig(explicitConfig());w.document.body.append(card);card.hass=hass;card._refreshThrottleMs=1000000;
 if(card._refreshTimer!==null){w.clearTimeout(card._refreshTimer);card._refreshTimer=null;}
 const choose=card.shadowRoot.querySelector('[data-smart-analysis="calendar"]');for(let i=0;i<12&&choose.disabled;i++)await delay();assert.equal(choose.disabled,false);choose.click();for(let i=0;i<12;i++)await delay();
 return {dom,w,card,hass,listeners,dto,pause(){pending=true;},close(){card.remove();dom.window.close();}};
}
async function open(f,format='json'){
 const button=f.card.shadowRoot.querySelector(`[data-smart-calendar-export="${format}"]`);
 assert.ok(button,'calendar offers its own reviewed export button');assert.equal(button.disabled,false);button.click();await delay();return field(f.card,'preview')?.textContent;
}
async function consent(f){const input=field(f.card,'private');input.checked=true;input.dispatchEvent(new f.w.Event('change'));field(f.card,'refresh').click();await delay();}
function blobText(w,blob){return new Promise((resolve,reject)=>{const r=new w.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsText(blob);});}
for(const format of ['json','csv'])test(`calendar ${format} previews and hands off identical immutable bytes without reading again`,async()=>{
 const f=await setup();try{
  const calls=f.hass.calls.length,blobs=[];let clicks=0;f.w.URL.createObjectURL=b=>{blobs.push(b);return 'blob:calendar';};f.w.HTMLAnchorElement.prototype.click=function(){clicks++;assert.match(this.download,new RegExp('\\.'+format+'$'));};
  const preview=await open(f,format);assert.ok(preview);assert.equal(clicks,0);assert.equal(f.hass.calls.length,calls);assert.doesNotMatch(preview,/sensor\.|NEVER_EXPORT|Desk|Office|Upstairs/);
  if(format==='json'){const p=JSON.parse(preview);assert.equal(p.report_kind,'calendar_energy');assert.equal(p.schema_version,4);assert.equal(p.totals.total_cost,'241.00');assert.equal(p.totals.kwh,'240.0');assert.equal(p.chart.bins.length,24);assert.equal(p.groups.unmeasured.kwh,'192.0');assert.equal(p.rates[0].valid_from,'2026-01-01');assert.equal(p.export_scope.truncated,false);}
  else {assert.match(preview,/"row_type","path","value_type","value"\r\n/);assert.match(preview,/"\/totals\/total_cost","string","241.00"/);assert.match(preview,/\/chart\/bins\/23\/kwh/);}
  field(f.card,'save').click();field(f.card,'save').click();await delay();assert.equal(clicks,1);assert.equal(blobs.length,1);assert.equal(await blobText(f.w,blobs[0]),preview);assert.equal(f.hass.calls.length,calls);
 }finally{f.close();}
});
test('calendar private opt-in is reviewed, resets on reopen, and never exports unknown DTO fields',async()=>{
 const f=await setup();try{await open(f);await consent(f);const p=JSON.parse(field(f.card,'preview').textContent);assert.equal(p.groups.devices['sensor.device'].name,'Desk');assert.doesNotMatch(JSON.stringify(p),/NEVER_EXPORT|snapshot_id|entry_id|source_signature/);field(f.card,'cancel').click();await open(f);assert.equal(field(f.card,'private').checked,false);assert.doesNotMatch(field(f.card,'preview').textContent,/sensor\.|Desk/);}finally{f.close();}
});
test('calendar date change consumes preview and consent before a pending new read',async()=>{
 const f=await setup();try{await open(f);await consent(f);const revision=f.card._reviewedExportContext().revision;f.pause();const input=f.card.shadowRoot.querySelector('[data-analysis-action="anchor"]');input.value='2026-10-09';input.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(field(f.card,'save').disabled,true);assert.equal(field(f.card,'preview').textContent,'');assert.equal(field(f.card,'private').checked,false);assert.equal(f.card._reviewedExportContext().sourceConfirmed,false);assert.ok(f.card._reviewedExportContext().revision>revision);}finally{f.close();}
});
test('calendar authorization invalidation cannot export the accepted snapshot or the legacy report',async()=>{
 const f=await setup();try{let downloads=0;f.w.HTMLAnchorElement.prototype.click=function(){downloads++;};await open(f);await consent(f);f.pause();for(const fn of [...f.listeners])fn({});assert.equal(field(f.card,'save').disabled,true);assert.equal(field(f.card,'preview').textContent,'');assert.equal(field(f.card,'private').checked,false);field(f.card,'save').click();assert.equal(downloads,0);assert.equal(f.card._reviewedExportContext().sourceConfirmed,false);assert.equal(f.card._buildReviewedExport({draft:{format:'json',includePrivate:true},signal:new AbortController().signal}).serialized,undefined);}finally{f.close();}
});
test('calendar source round trip cannot reuse a reviewed file or its private consent',async()=>{
 const f=await setup();try{await open(f);await consent(f);const old=f.card._reviewedExportContext().revision;f.card.shadowRoot.querySelector('[data-smart-analysis="recorded"]').click();assert.equal(field(f.card,'save')?.disabled??true,true);assert.equal(field(f.card,'preview')?.textContent??'','');f.card.shadowRoot.querySelector('[data-smart-analysis="calendar"]').click();for(let i=0;i<12;i++)await delay();assert.ok(f.card._reviewedExportContext().revision>old);assert.equal(field(f.card,'private')?.checked??false,false);assert.equal(field(f.card,'preview')?.textContent??'','');}finally{f.close();}
});

test('calendar cached same-source refresh preserves reviewed bytes, consent and revision',async()=>{
 const f=await setup();try{await open(f);await consent(f);const before=field(f.card,'preview').textContent,revision=f.card._reviewedExportContext().revision,calls=f.hass.calls.length;await f.card._runRefresh();await delay();assert.equal(field(f.card,'preview').textContent,before);assert.equal(field(f.card,'private').checked,true);assert.equal(field(f.card,'save').disabled,false);assert.equal(f.card._reviewedExportContext().revision,revision);assert.equal(f.hass.calls.length,calls);}finally{f.close();}
});
test('calendar producer household-period fee scope survives both comparison sides',async()=>{
 const f=await setup();try{const report=JSON.parse(await open(f));assert.equal(report.comparisons.previous.costs.current.fixed_scope,'household_period');assert.equal(report.comparisons.previous.costs.baseline.fixed_scope,'household_period');}finally{f.close();}
});

test('calendar cancel returns focus to its live opener after a cached refresh',async()=>{
 const f=await setup();try{const opener=f.card.shadowRoot.querySelector('[data-smart-calendar-export="json"]');opener.focus();await open(f);const name=field(f.card,'filename');name.value='calendar-review.json';name.dispatchEvent(new f.w.Event('input'));field(f.card,'refresh').click();await delay();name.focus();name.setSelectionRange(3,8);await f.card._runRefresh();await delay();assert.equal(field(f.card,'filename'),name);assert.equal(name.selectionStart,3);assert.equal(name.selectionEnd,8);field(f.card,'cancel').click();assert.equal(f.card.shadowRoot.activeElement,f.card.shadowRoot.querySelector('[data-smart-calendar-export="json"]'));}finally{f.close();}
});
