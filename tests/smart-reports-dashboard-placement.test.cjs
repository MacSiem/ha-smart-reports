"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadRuntime,makeHass,explicitConfig,delay}=require('./helpers/smart-reports-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
async function setup(config={}){
 const dom=loadRuntime(),w=dom.window,ha=w.document.createElement('home-assistant'),card=w.document.createElement('ha-smart-reports'),providers=new Set(),calls=[];let owner,hook=null,stored={title:'Existing',unknown:{keep:true},views:[{title:'Home',type:'sections',sections:[{type:'grid',cards:[]}]}]};
 const hass=makeHass();hass.user.is_active=true;hass.connection=Object.assign(new w.EventTarget(),{connected:true});hass.connected=true;hass.panels={lovelace:{config:{mode:'storage'}}};const original=hass.callWS;
 hass.callWS=async m=>{if(!m.type.startsWith('lovelace/'))return original(m);calls.push(clone(m));if(hook){const result=hook(m);if(result!==undefined)return result;}if(m.type==='lovelace/dashboards/list')return [];if(m.type==='lovelace/config')return clone(stored);if(m.type==='lovelace/config/save'){stored=clone(m.config);return null;}throw Error('unexpected');};
 ha.provideHass=e=>{providers.add(e);e.hass=hass;};ha.addEventListener('show-dialog',e=>{owner=w.document.createElement(e.detail.dialogTag);ha.provideHass(owner);owner.showDialog(e.detail.dialogParams);ha.append(owner);});
 card.setConfig(explicitConfig({future:{keep:true},...config}));ha.append(card);w.document.body.append(ha);card.hass=hass;for(let i=0;i<8;i++)await delay();
 const flush=async()=>{for(let i=0;i<12;i++)await delay();};
 return {w,ha,card,hass,calls,flush,get owner(){return owner;},get stored(){return stored;},set stored(v){stored=v;},set hook(v){hook=v;},q(s){return owner?.querySelector(s)||card.shadowRoot.querySelector(s);},saves(){return calls.filter(m=>m.type==='lovelace/config/save');},async open(){const button=card.shadowRoot.querySelector('[data-smart-dashboard-add]');assert.ok(button);button.click();await flush();const select=owner.querySelector('[data-dashboard]');select.value='0';select.dispatchEvent(new w.Event('change',{bubbles:true}));await flush();},close(){owner?.closeDialog();card.remove();ha.remove();w.close();}};
}
test('Admin full has stable placement footer and detached config without optional Email',async()=>{
 const f=await setup();try{const footer=f.card.shadowRoot.querySelector('[data-smart-dashboard-footer]');assert.ok(footer);assert.equal(f.calls.length,0);assert.equal(f.card._placementConfigV53().variant,'compact');assert.equal(f.card._placementConfigV53().future.keep,true);const cfg=f.card._placementConfigV53();cfg.future.keep=false;assert.equal(f.card._config.future.keep,true);const select=footer.querySelector('[data-smart-dashboard-variant]');select.value='tile';select.dispatchEvent(new f.w.Event('change'));assert.equal(f.card._placementConfigV53().variant,'tile');f.card._renderEnergyState();f.card.hass={...f.hass,language:'pl'};assert.equal(f.card.shadowRoot.querySelector('[data-smart-dashboard-footer]'),footer);assert.match(footer.textContent,/dashboardu/);f.hass.user.is_admin=false;f.card.hass=f.hass;assert.equal(f.card.shadowRoot.querySelector('[data-smart-dashboard-footer]'),null);assert.equal(f.calls.length,0);}finally{f.close();}
});
test('Native Add and exact Undo preserve foreign fields and use a real inert Smart preview',async()=>{
 const f=await setup();try{const before=clone(f.stored);await f.open();const preview=f.q('[data-preview] ha-smart-reports');assert.ok(preview);assert.equal(preview.preview,true);assert.equal(preview.getAttribute('inert'),'');assert.equal(preview._config.variant,'compact');assert.equal(preview.shadowRoot.querySelector('[data-smart-dashboard-footer]'),null);f.q('[data-add]').click();await f.flush();assert.equal(f.saves().length,1);assert.equal(f.stored.views[0].sections[0].cards[0].type,'custom:ha-smart-reports');f.q('[data-undo]').click();await f.flush();assert.equal(f.saves().length,2);assert.deepEqual(f.stored,before);}finally{f.close();}
});
test('Own remount and lost ACK retain native readback and exact Undo with current owner authority',async()=>{
 const f=await setup();try{const before=clone(f.stored);await f.open();f.hook=m=>{if(m.type==='lovelace/config/save'){f.stored=clone(m.config);f.card.remove();return Promise.reject(Error('lost ACK'));}};f.q('[data-add]').click();await f.flush();assert.ok(f.owner.querySelector('dialog[open]'));assert.equal(f.saves().length,1);assert.equal(f.q('[data-undo]').disabled,false);f.hook=null;f.q('[data-undo]').click();await f.flush();assert.equal(f.saves().length,2);assert.deepEqual(f.stored,before);}finally{f.close();}
});
test('Foreign edits before Undo and source detach without transaction do not overwrite dashboard',async()=>{
 const f=await setup();try{await f.open();f.q('[data-add]').click();await f.flush();f.stored.foreignEdit=true;f.q('[data-undo]').click();await f.flush();assert.equal(f.saves().length,1);assert.equal(f.stored.foreignEdit,true);}finally{f.close();}
 const g=await setup();try{await g.open();g.card.remove();await g.flush();assert.equal(g.owner.querySelector('dialog'),null);assert.equal(g.saves().length,0);}finally{g.close();}
});
