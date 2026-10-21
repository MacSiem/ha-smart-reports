'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('./fixtures/analysis-calendar-v53.json');
const {loadRuntime,makeHass,explicitConfig,delay}=require('./helpers/smart-reports-harness.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
const capabilities=(visible=true,read=true,revision=0)=>({status:'ready',revision,energy_model_schema:'ha_tools.energy_report/1',capabilities:{energy_analysis:{visible,read},energy_tariff:{visible:true,read:true,execute:false},energy_reports:{visible:false,read:false,execute:false},log_reports:{visible:false,read:false,execute:false}}});
async function settle(){for(let i=0;i<18;i++)await delay();}
async function setup({caps=()=>capabilities(),admin=false,analysis=()=>clone(fixture),subscribe=null}={}){
 const dom=loadRuntime(),w=dom.window,card=w.document.createElement('ha-smart-reports'),listeners=new Set(),order=[];let policy={schema:1,features:{}},revision=0;
 const hass=makeHass({timeZone:'UTC',deferred:{'ha_tools_email/feature_capabilities':()=>{order.push('capabilities');return Promise.resolve().then(caps);},'ha_tools_email/energy_analysis':()=>{order.push('analysis');return Promise.resolve().then(analysis);},'ha_tools_email/get_feature_access':()=>({status:'ready',revision,policy:clone(policy)}),'config/auth/list':()=>[{id:'household',name:'Household',is_active:true,system_generated:false}],'ha_tools_email/set_feature_access':m=>{assert.equal(m.expected_revision,revision);policy=clone(m.policy);revision++;return {status:'ready',revision,policy:clone(policy)};}}});
 hass.user.is_admin=admin;hass.user.is_active=true;hass.connection={connected:true,addEventListener(){},removeEventListener(){},subscribeMessage:async(fn,m)=>{assert.equal(m.type,'ha_tools_email/subscribe_analysis_updates');order.push('subscribe');if(subscribe)await subscribe();listeners.add(fn);return()=>listeners.delete(fn);}};
 card.setConfig(explicitConfig());w.document.body.append(card);card.hass=hass;card._refreshThrottleMs=1000000;
 if(card._refreshTimer!==null){w.clearTimeout(card._refreshTimer);card._refreshTimer=null;}
 await settle();return {dom,w,card,hass,listeners,order,close(){card.remove();dom.window.close();}};
}
const button=f=>f.card.shadowRoot.querySelector('[data-smart-analysis="calendar"]');
const analysisCount=f=>f.hass.calls.filter(m=>m.type==='ha_tools_email/energy_analysis').length;
test('feature visibility false never grants a calendar read even when read is true',async()=>{
 const f=await setup({caps:()=>capabilities(false,true)});try{assert.equal(button(f).hidden,true);assert.equal(analysisCount(f),0);button(f).click();await settle();assert.equal(analysisCount(f),0);assert.equal(f.card.shadowRoot.querySelector('.analysis-tiles'),null);}finally{f.close();}
});
test('visible calendar with read denied offers an explanation without an analysis request',async()=>{
 const f=await setup({caps:()=>capabilities(true,false)});try{assert.equal(button(f).hidden,false);button(f).click();await settle();assert.equal(analysisCount(f),0);assert.equal(f.card.shadowRoot.querySelector('.analysis-tiles'),null);assert.match(f.card.shadowRoot.querySelector('main').textContent,/access|permission/i);}finally{f.close();}
});
test('household calendar confirms capabilities after subscription ACK before showing the validated DTO',async()=>{
 const f=await setup();try{assert.deepEqual(f.order.slice(0,3),['capabilities','subscribe','capabilities']);assert.equal(analysisCount(f),0);button(f).click();await settle();assert.equal(analysisCount(f),1);assert.ok(f.card.shadowRoot.querySelector('.analysis-tiles'));assert.match(f.card.shadowRoot.querySelector('main').textContent,/241/);assert.equal(f.card.shadowRoot.querySelector('[data-smart-calendar-export="json"]').disabled,false);}finally{f.close();}
});
for(const kind of ['unknown_command','unauthorized','malformed'])test(`calendar capability ${kind} cannot dispatch analysis or replace standalone access`,async()=>{
 const f=await setup({caps:()=>kind==='malformed'?{status:'ready',revision:0,capabilities:{energy_analysis:{visible:true}}}:Promise.reject({code:kind})});try{assert.equal(f.card._analysisMode,'recorded');assert.equal(f.card.shadowRoot.getElementById('energyToolbar').hidden,false);button(f).click();await settle();assert.equal(analysisCount(f),0);assert.equal(f.card.shadowRoot.querySelector('.analysis-tiles'),null);assert.doesNotMatch(f.card.shadowRoot.querySelector('main').textContent,/unknown_command|unauthorized|invalid_capabilities/);}finally{f.close();}
});
test('capability change during subscription ACK cannot reveal an initially allowed calendar',async()=>{
 let count=0,release;const f=await setup({caps:()=>++count===1?capabilities():capabilities(false,true,1),subscribe:()=>new Promise(r=>{release=r;})});try{assert.ok(release);assert.equal(analysisCount(f),0);release();await settle();assert.equal(button(f).hidden,true);assert.equal(analysisCount(f),0);}finally{f.close();}
});
test('a DTO from a different feature-policy revision stays hidden and cannot be exported',async()=>{
 const f=await setup({analysis:()=>{const d=clone(fixture);d.context.feature_access_revision=1;return d;}});try{button(f).click();await settle();assert.equal(analysisCount(f),1);assert.equal(f.card.shadowRoot.querySelector('.analysis-tiles'),null);assert.equal(f.card._reviewedExportContext().sourceConfirmed,false);assert.equal(f.card.shadowRoot.querySelector('[data-smart-calendar-export="json"]')?.disabled??true,true);}finally{f.close();}
});
test('policy invalidation immediately drops accepted rows while a fresh capability read is pending',async()=>{
 let pending=false;const f=await setup({caps:()=>pending?new Promise(()=>{}):capabilities()});try{button(f).click();await settle();assert.ok(f.card.shadowRoot.querySelector('.analysis-tiles'));pending=true;for(const fn of [...f.listeners])fn({});assert.equal(f.card.shadowRoot.querySelector('.analysis-tiles'),null);assert.equal(f.card._reviewedExportContext().sourceConfirmed,false);await settle();assert.equal(f.card.shadowRoot.querySelector('.analysis-tiles'),null);assert.equal(analysisCount(f),1);}finally{f.close();}
});
test('only an active administrator can open native feature-policy settings and save the expected revision',async()=>{
 const f=await setup({admin:true});try{const open=f.card.shadowRoot.querySelector('[data-smart-access-settings]');assert.ok(open);assert.equal(open.hidden,false);open.click();const details=f.card.shadowRoot.querySelector('[data-feature-access-v53]');assert.ok(details);assert.equal(f.hass.calls.filter(m=>m.type==='ha_tools_email/get_feature_access').length,0);details.open=true;details.dispatchEvent(new f.w.Event('toggle'));await settle();const mode=details.querySelector('[data-access-feature="energy_analysis"][data-access-operation="visible"] select');assert.ok(mode);mode.value='selected_users';mode.dispatchEvent(new f.w.Event('change',{bubbles:true}));const user=details.querySelector('[data-access-feature="energy_analysis"][data-access-operation="visible"] input');user.checked=true;user.dispatchEvent(new f.w.Event('change',{bubbles:true}));details.querySelector('[data-feature-access="save"]').click();await settle();const writes=f.hass.calls.filter(m=>m.type==='ha_tools_email/set_feature_access');assert.equal(writes.length,1);assert.equal(writes[0].expected_revision,0);assert.deepEqual(clone(writes[0].policy.features.energy_analysis.visible),{mode:'selected_users',user_ids:['household']});assert.equal(f.hass.calls.filter(m=>m.type==='config/auth/list').length,1);assert.equal(f.card._featureAccessV53.state().revision,1);}finally{f.close();}
});
test('household users never fetch the administrator policy or account directory',async()=>{
 const f=await setup();try{assert.equal(f.card.shadowRoot.querySelector('[data-smart-access-settings]')?.hidden??true,true);f.card._selectTab('config');await settle();assert.notEqual(f.card._activeTab,'config');assert.equal(f.hass.calls.filter(m=>['ha_tools_email/get_feature_access','ha_tools_email/set_feature_access','config/auth/list'].includes(m.type)).length,0);}finally{f.close();}
});

test('a late control event from the previous user cannot clear the current accepted calendar',async()=>{
 const f=await setup();try{
 const oldControl=[...f.listeners][0];assert.equal(typeof oldControl,'function');
 button(f).click();await settle();
 f.hass.user.id='new_household';f.card.hass=f.hass;await settle();
 const tile=f.card.shadowRoot.querySelector('.analysis-tiles');assert.ok(tile);
 const calls=f.hass.calls.length;oldControl({});await settle();
 assert.equal(f.card.shadowRoot.querySelector('.analysis-tiles'),tile);
 assert.equal(f.hass.calls.length,calls);
 }finally{f.close();}
});
