"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fixture=require('./fixtures/analysis-calendar-v53.json');
const {featureCapabilities}=require('./helpers/smart-reports-feature-capabilities.cjs');
const {loadRuntime,makeHass,explicitConfig,delay}=require('./helpers/smart-reports-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
async function setup(response=()=>clone(fixture),config={}) {
 const dom=loadRuntime(),w=dom.window,card=w.document.createElement('ha-smart-reports'),listeners=new Set();let removed=0;
 const hass=makeHass({timeZone:'UTC',deferred:{'ha_tools_email/feature_capabilities':()=>featureCapabilities(hass.user.is_admin===true),'ha_tools_email/energy_analysis':m=>Promise.resolve().then(()=>response(m))}});
 hass.user.is_active=true;hass.connection={connected:true,subscribeMessage:async(fn,m)=>{assert.equal(m.type,'ha_tools_email/subscribe_analysis_updates');listeners.add(fn);return ()=>{listeners.delete(fn);removed++;};}};
 card.setConfig(explicitConfig(config));w.document.body.append(card);card.hass=hass;
 if(card._refreshTimer!==null){w.clearTimeout(card._refreshTimer);card._refreshTimer=null;}
 const open=async()=>{const button=card.shadowRoot.querySelector('[data-smart-analysis="calendar"]');assert.ok(button,'visible calendar analysis entry');for(let i=0;i<12&&button.disabled;i++)await delay();assert.equal(button.disabled,false);button.click();for(let i=0;i<12;i++)await delay();};
 return {dom,w,card,hass,listeners,open,get removed(){return removed;},close(){card.remove();dom.window.close();}};
}
test('standalone explicit preserves 7d and performs no shared-analysis read until chosen',async()=>{
 const h=await setup();try{assert.equal(h.card._period,'7d');assert.equal(h.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length,0);assert.ok(h.card.shadowRoot.querySelector('[data-smart-analysis="calendar"]'));assert.equal(h.card._config.energy_source_mode,'explicit');}finally{h.close();}
});
test('calendar analysis uses one authorized DTO with its own period, groups and bill, without Recorder header',async()=>{
 const h=await setup();try{await h.open();const r=h.card.shadowRoot;assert.equal(h.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length,1);assert.equal(h.hass.calls.at(-1).period,'day');assert.ok(r.querySelector('[data-analysis-chart]'));assert.match(r.textContent,/241/);assert.match(r.textContent,/Unmeasured/);assert.equal(r.querySelector('.report-context'),null);assert.equal(r.querySelector('#energyToolbar').hidden,true);assert.equal(h.card._period,'7d');assert.equal(h.listeners.size,2); // Capability control and active analysis each own one subscription.
}finally{h.close();}
});
for(const code of ['unauthorized','unknown_command'])test(`calendar ${code} cannot fall back to standalone or display previous rows`,async()=>{
 const h=await setup(()=>Promise.reject({code}));try{await h.open();const r=h.card.shadowRoot;assert.equal(r.querySelector('.analysis-tiles'),null);assert.equal(r.querySelector('.report-context'),null);assert.ok(r.querySelector('[role="status"]'));assert.equal(h.hass.calls.filter(m=>m.type==='recorder/statistics_during_period').length,0);}finally{h.close();}
});
test('authorization update immediately removes accepted rows before pending replacement',async()=>{
 let pending=false;const h=await setup(()=>pending?new Promise(()=>{}):clone(fixture));try{await h.open();assert.ok(h.card.shadowRoot.querySelector('.analysis-tiles'));pending=true;for(const fn of [...h.listeners])fn({});assert.equal(h.card.shadowRoot.querySelector('.analysis-tiles'),null);}finally{h.close();}
});
test('same-object user mutation clears calendar data and invalidates the subscription',async()=>{
 const h=await setup();try{await h.open();h.hass.user.id='other';h.hass.callWS=()=>new Promise(()=>{});h.card.hass=h.hass;assert.equal(h.card.shadowRoot.querySelector('.analysis-tiles'),null);assert.ok(h.removed>=1);}finally{h.close();}
});
test('leaving calendar view unsubscribes; standalone periods and export are restored independently',async()=>{
 const h=await setup();try{await h.open();const b=h.card.shadowRoot.querySelector('[data-smart-analysis="recorded"]');assert.ok(b);b.click();assert.equal(h.listeners.size,1); // Only the control subscription remains while standalone is active.
assert.equal(h.card.shadowRoot.querySelector('[data-analysis-chart]'),null);assert.equal(h.card.shadowRoot.querySelector('#periodSelect').value,'7d');assert.equal(h.card.shadowRoot.querySelector('#energyToolbar').hidden,false);}finally{h.close();}
});
test('calendar Data and room/floor/device changes reuse the accepted snapshot without refetch',async()=>{
 const h=await setup();try{await h.open();const r=h.card.shadowRoot;r.querySelector('[data-analysis-action="view"][data-analysis-value="data"]').click();assert.ok(r.querySelector('[data-analysis-bin]'));const level=r.querySelector('[data-analysis-action="level"]');level.value='floors';level.dispatchEvent(new h.w.Event('change',{bubbles:true}));assert.equal(r.querySelector('[data-analysis-action="level"]').value,'floors');assert.equal(h.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length,1);}finally{h.close();}
});

test('ordinary same-context hass refresh preserves the live calendar date node, open options and unfinished draft',async()=>{
 const h=await setup();try{await h.open();const r=h.card.shadowRoot,details=r.querySelector('[data-analysis-calendar-options]');details.open=true;const input=details.querySelector('input');input.focus();input.value='2026-10-16';h.card.hass=h.hass;assert.equal(r.querySelector('[data-analysis-calendar-options]'),details);assert.equal(details.open,true);assert.equal(r.activeElement,input);assert.equal(input.value,'2026-10-16');assert.equal(h.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length,1);}finally{h.close();}
});
test('scheduled calendar refresh does not interrupt an active date draft',async()=>{
 const h=await setup();try{await h.open();const r=h.card.shadowRoot,details=r.querySelector('[data-analysis-calendar-options]');details.open=true;const input=details.querySelector('input');input.focus();input.value='2026-10-16';await h.card._runRefresh();assert.equal(r.querySelector('[data-analysis-calendar-options]'),details);assert.equal(r.activeElement,input);assert.equal(input.value,'2026-10-16');}finally{h.close();}
});
test('calendar date options stay open when switching Chart to Data',async()=>{
 const h=await setup();try{await h.open();const r=h.card.shadowRoot;r.querySelector('[data-analysis-calendar-options]').open=true;r.querySelector('[data-analysis-action="view"][data-analysis-value="data"]').click();assert.equal(r.querySelector('[data-analysis-calendar-options]').open,true);}finally{h.close();}
});

test('compact reuses the accepted calendar totals, measured device changes and native full view without another analysis read',async()=>{
 const h=await setup(()=>clone(fixture),{variant:'compact'});try{
 h.card.shadowRoot.querySelector('[data-smart-open]').click();await h.open();
 const calls=h.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length;
 h.card.shadowRoot.querySelector('[data-smart-back]').click();const r=h.card.shadowRoot,s=r.querySelector('[data-smart-simple="compact"]');assert.ok(s);assert.match(s.querySelector('[data-smart-import]').textContent,/240/);assert.match(s.querySelector('[data-smart-cost]').textContent,/241/);assert.equal(s.querySelectorAll('[data-smart-change]').length,1);assert.match(s.querySelector('[data-smart-change]').textContent,/Desk/);assert.match(s.querySelector('[data-smart-comparison]').textContent,/0/);assert.equal(r.querySelector('[data-analysis-chart]'),null);assert.equal(h.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length,calls);
 s.querySelector('[data-smart-open]').click();assert.ok(r.querySelector('[data-analysis-chart]'));assert.equal(h.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length,calls);
 }finally{h.close();}
});

test('revoked calendar in Compact still offers a safe route to the available full report',async()=>{
 const h=await setup(()=>clone(fixture),{variant:'compact'});try{h.card.shadowRoot.querySelector('[data-smart-open]').click();await h.open();h.card.shadowRoot.querySelector('[data-smart-back]').click();
 const call=h.hass.callWS;h.hass.callWS=function(m){return m.type==='ha_tools_email/feature_capabilities'?Promise.resolve({status:'ready',revision:1,capabilities:{energy_analysis:{visible:true,read:false}}}):call.call(this,m);};h.card.hass=h.hass;for(let i=0;i<18;i++)await delay();const root=h.card.shadowRoot;assert.ok(root.querySelector('[data-smart-open]'));assert.doesNotMatch(root.querySelector('[data-smart-simple]').textContent,/240|241/);root.querySelector('[data-smart-open]').click();assert.ok(root.querySelector('[data-smart-analysis="recorded"]'));
 }finally{h.close();}
});
