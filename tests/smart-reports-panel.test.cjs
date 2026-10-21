"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadRuntime,makeHass,explicitConfig,delay}=require('./helpers/smart-reports-harness.cjs');
async function setup({native=true,preview=false,deferOwner=false,reuseOwner=false,config={}}={}){
 const dom=loadRuntime(),w=dom.window,ha=w.document.createElement('home-assistant'),card=w.document.createElement('ha-smart-reports'),requests=[];
 let cachedOwner;
 if(native)ha.provideHass=()=>{};
 const hass=makeHass();hass.user.is_admin=false;hass.user.is_active=true;hass.connection=Object.assign(new w.EventTarget(),{connected:true});
 ha.addEventListener('show-dialog',event=>{requests.push(event.detail);if(deferOwner)return;const owner=reuseOwner&&cachedOwner?cachedOwner:w.document.createElement(event.detail.dialogTag);cachedOwner=owner;owner.showDialog(event.detail.dialogParams);owner.hass=hass;if(owner.parentNode!==ha)ha.append(owner);});
 card.preview=preview;card.setConfig(explicitConfig({variant:'tile',tap_target:'panel',future:{keep:true},...config}));card._period='30d';card._energyView='costs';ha.append(card);w.document.body.append(ha);card.hass=hass;for(let i=0;i<4;i++)await delay();
 return {w,dom,ha,card,hass,requests,async open(){card.shadowRoot.querySelector('[data-smart-open]').click();for(let i=0;i<4;i++)await delay();return w.document.querySelector('ha-tools-smart-report-panel-dialog-v53');},close(){ha.remove();w.close();}};
}
test('Panel target opens a real full Smart child for a reader and preserves selection without expanding source',async()=>{
 const f=await setup();try{const owner=await f.open();assert.ok(owner);assert.equal(f.requests[0].addHistory,false);assert.ok(f.card.shadowRoot.querySelector('[data-smart-simple]'));const child=owner.querySelector('ha-smart-reports');assert.ok(child);assert.equal(child._inReportPanelV53,true);assert.equal(child._config.variant,'full');assert.equal(child._config.tap_target,'full');assert.equal(child._period,'30d');assert.equal(child._energyView,'costs');assert.equal(child._config.future.keep,true);assert.equal(child._hass,f.hass);assert.equal(owner.querySelector('dialog').open,true);owner.querySelector('[data-smart-panel-close]').click();assert.equal(owner.querySelector('dialog'),null);assert.equal(f.card.shadowRoot.activeElement,f.card.shadowRoot.querySelector('[data-smart-open]'));}finally{f.close();}
});
test('Native owner survives source detach then invalidates from its own current hass and connection',async()=>{
 const f=await setup();try{const owner=await f.open();assert.ok(owner);f.card.remove();assert.ok(owner.querySelector('dialog'));owner.hass={...f.hass,language:'pl'};assert.match(owner.querySelector('[data-smart-panel-close]').textContent,/Zamknij/);f.hass.user.id='other';owner.hass=f.hass;assert.equal(owner.querySelector('dialog'),null);}finally{f.close();}
});
test('Connection event closes an owned panel after source detach without waiting for a hass assignment',async()=>{
 const f=await setup();try{const owner=await f.open();assert.ok(owner);f.card.remove();f.hass.connection.dispatchEvent(new f.w.Event('disconnected'));assert.equal(owner.querySelector('dialog'),null);}finally{f.close();}
});
test('A preview cannot open either panel or inline full report',async()=>{
 for(const target of ['panel','full']){const f=await setup({preview:true,config:{tap_target:target}});try{await f.open();assert.equal(f.requests.length,0);assert.ok(f.card.shadowRoot.querySelector('[data-smart-simple]'));assert.equal(f.w.document.querySelector('dialog'),null);}finally{f.close();}}
});
test('Fallback panel closes on source detach and native pending request can be cancelled before attachment',async()=>{
 const f=await setup({native:false});try{const owner=await f.open();assert.ok(owner);f.card.remove();assert.equal(f.w.document.querySelector('dialog'),null);}finally{f.close();}
 const g=await setup({deferOwner:true});try{await g.open();const request=g.requests[0].dialogParams;g.card.setConfig({variant:'tile',tap_target:'full'});assert.equal(request.closed,true);const late=g.w.document.createElement(g.requests[0].dialogTag);late.showDialog(request);late.hass=g.hass;g.ha.append(late);await delay();assert.equal(late.querySelector('dialog'),null);}finally{g.close();}
});
test('Editor roundtrips panel target, unknown config and label language',async()=>{
 const f=await setup();try{const e=f.w.document.createElement('ha-smart-reports-editor');e.setConfig({...f.card._config});f.ha.append(e);e.hass=f.hass;const target=e.shadowRoot.querySelector('#cf_tap_target');assert.ok(target);assert.equal(target.value,'panel');let config;e.addEventListener('config-changed',event=>config=event.detail.config);target.value='full';target.dispatchEvent(new f.w.Event('change'));assert.equal(config.tap_target,'full');assert.equal(config.future.keep,true);e.hass={...f.hass,language:'pl'};assert.match(e.shadowRoot.querySelector('#cf_tap_target').parentElement.textContent,/oknie/);}finally{f.close();}
});

test('A queued close from the previous dialog cannot close a new request on the reused native owner',async()=>{
 const f=await setup({reuseOwner:true});try{const owner=await f.open();owner.querySelector('[data-smart-panel-close]').click();f.card.shadowRoot.querySelector('[data-smart-open]').click();for(let i=0;i<6;i++)await delay();assert.equal(f.requests.length,2);assert.equal(f.requests[1].dialogParams.closed,false);assert.ok(owner.querySelector('dialog[open]'));assert.ok(owner.querySelector('ha-smart-reports'));}finally{f.close();}
});

for(const native of [true,false])for(const action of ['click','cancel'])test(`Panel ${native?'native':'fallback'} ${action} returns focus to the current source button after a hass refresh`,async()=>{
 const f=await setup({native});try{
  const owner=await f.open(),oldButton=f.card.shadowRoot.querySelector('[data-smart-open]');
  f.card._refreshThrottleMs=0;f.card.hass={...f.hass};
  for(let i=0;i<6;i++)await delay();
  const current=f.card.shadowRoot.querySelector('[data-smart-open]');
  assert.equal(oldButton.isConnected,false,'ordinary report refresh replaced the opener');assert.notEqual(current,oldButton);
  if(action==='click')owner.querySelector('[data-smart-panel-close]').click();
  else owner.querySelector('dialog').dispatchEvent(new f.w.Event('cancel',{cancelable:true}));
  assert.equal(f.card.shadowRoot.activeElement,current);
 }finally{f.close();}
});

test('Panel close control occupies its own row above the size-contained report',async()=>{
 const f=await setup();try{
  const owner=await f.open(),close=owner.querySelector('[data-smart-panel-close]');
  const style=f.w.getComputedStyle(close);
  assert.notEqual(style.cssFloat,'right','a floated close forces the report into a narrow adjacent column');
  assert.equal(style.display,'block');
 }finally{f.close();}
});
