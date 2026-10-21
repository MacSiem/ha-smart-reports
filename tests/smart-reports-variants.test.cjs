 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadRuntime,makeHass,explicitConfig,metadata,calendarSeries,delay}=require('./helpers/smart-reports-harness.cjs');
async function setup(config={}){
 const dom=loadRuntime(),w=dom.window,card=w.document.createElement('ha-smart-reports');
 card._now=()=>new Date('2026-08-30T12:00:00Z');card._refreshThrottleMs=1000000;
 const ids=['sensor.grid_import','sensor.a','sensor.b','sensor.c','sensor.d'];
 const hass=makeHass({timeZone:'UTC',metadataById:Object.fromEntries(ids.map(id=>[id,metadata()])),deferred:{'recorder/statistics_during_period':m=>{
 const current=m.end_time==='2026-08-30T12:00:00.000Z';return Object.fromEntries(ids.map((id,i)=>[id,calendarSeries(m.start_time,m.end_time,Array(Math.ceil((Date.parse(m.end_time)-Date.parse(m.start_time))/3600000)).fill(current?[10,2,4,1,3][i]:1))]));
 }}});hass.connection={connected:true};
 card.setConfig(explicitConfig({energy_device_statistics:ids.slice(1),energy_price:2,currency:'PLN',...config}));w.document.body.append(card);card.hass=hass;
 if(card._refreshTimer!==null){w.clearTimeout(card._refreshTimer);card._refreshTimer=null;}
 if(card._activeTab==='energy')await card._loadEnergy();for(let i=0;i<4;i++)await delay();
 return {dom,w,card,hass,close(){card.remove();w.close();}};
}
test('old cards retain full view; picker creates compact and an explicit default tab only applies on initial configuration',async()=>{
 const f=await setup();try{assert.equal(f.card.shadowRoot.querySelector('[data-smart-simple]'),null);assert.equal(f.card.constructor.getStubConfig().variant,'compact');
 f.card.setConfig(explicitConfig({default_tab:'system'}));assert.equal(f.card._activeTab,'energy');
 const other=f.w.document.createElement('ha-smart-reports');other.setConfig({default_tab:'system'});f.w.document.body.append(other);other.hass=f.hass;assert.equal(other._activeTab,'system');other.setConfig({default_tab:'energy',show_system:false});assert.equal(other._activeTab,'energy');other.remove();
 }finally{f.close();}
});
test('tile and compact advertise native Sections sizes',async()=>{
 for(const [variant,columns,rows] of [['tile',6,1],['compact',12,4]]){const f=await setup({variant});try{const g=f.card.getGridOptions();assert.equal(g.columns,columns);assert.equal(g.rows,rows);assert.equal(f.card.getCardSize(),rows);}finally{f.close();}}
});
test('compact uses the accepted report and three largest measured changes with no report controls',async()=>{
 const f=await setup({variant:'compact'});try{const root=f.card.shadowRoot,summary=root.querySelector('[data-smart-simple="compact"]');assert.ok(summary);assert.equal(root.getElementById('tabs').hidden,true);assert.equal(root.getElementById('energyToolbar').hidden,true);assert.equal(root.querySelector('.donate-section').hidden,true);assert.equal(root.querySelector('[data-smart-access-settings]').hidden,true);
 assert.match(summary.querySelector('[data-smart-import]').textContent,/kWh/);assert.match(summary.querySelector('[data-smart-cost]').textContent,/PLN|zł/);const changes=[...summary.querySelectorAll('[data-smart-change]')];assert.equal(changes.length,3);assert.match(changes[0].textContent,/sensor.b/);assert.match(changes[1].textContent,/sensor.d/);assert.match(changes[2].textContent,/sensor.a/);assert.ok(summary.querySelector('[data-smart-comparison]'));assert.equal(summary.querySelectorAll('button').length,1);
 }finally{f.close();}
});
test('tile exposes one headline and opens full with keyboard focus; Back restores the opener without extra statistics reads',async()=>{
 const f=await setup({variant:'tile'});try{let root=f.card.shadowRoot;const s=root.querySelector('[data-smart-simple="tile"]');assert.ok(s);assert.equal(s.querySelectorAll('button').length,1);assert.equal(s.querySelector('[data-smart-change]'),null);const before=f.hass.calls.filter(m=>m.type.startsWith('recorder/')).length;const open=s.querySelector('button');open.focus();open.click();const back=root.querySelector('[data-smart-back]');assert.ok(back);assert.equal(root.activeElement,back);assert.equal(root.querySelector('[data-smart-simple]'),null);back.click();assert.equal(root.activeElement,root.querySelector('[data-smart-open]'));assert.equal(f.hass.calls.filter(m=>m.type.startsWith('recorder/')).length,before);
 }finally{f.close();}
});
test('simple summaries clear accepted data immediately when the current user changes',async()=>{
 const f=await setup({variant:'compact'});try{assert.match(f.card.shadowRoot.querySelector('[data-smart-import]').textContent,/kWh/);f.hass.user.id='other';f.card.hass=f.hass;assert.doesNotMatch(f.card.shadowRoot.querySelector('[data-smart-simple]').textContent,/1,680|3,360/);assert.equal(f.card._energyViewState.status,'idle');}finally{f.close();}
});
test('compact alias and editor keep unknown keys, selected variant and title caret on language updates',async()=>{
 const f=await setup({compact:true});try{assert.ok(f.card.shadowRoot.querySelector('[data-smart-simple="compact"]'));const e=f.w.document.createElement('ha-smart-reports-editor');e.setConfig({type:'custom:ha-smart-reports',variant:'tile',default_tab:'system',foreign:{keep:true},title:'My report'});f.w.document.body.append(e);e.hass=f.hass;
 const select=e.shadowRoot.getElementById('cf_variant');assert.equal(select.value,'tile');let emitted;e.addEventListener('config-changed',ev=>emitted=ev.detail.config);select.value='compact';select.dispatchEvent(new f.w.Event('change'));assert.deepEqual(JSON.parse(JSON.stringify(emitted.foreign)),{keep:true});assert.equal(emitted.default_tab,'system');const title=e.shadowRoot.getElementById('cf_title');title.focus();title.setSelectionRange(2,5);f.hass.language='pl';e.hass=f.hass;assert.equal(e.shadowRoot.activeElement.id,'cf_title');assert.equal(e.shadowRoot.activeElement.selectionStart,2);assert.equal(e.shadowRoot.getElementById('cf_variant').value,'compact');e.remove();
 }finally{f.close();}
});

test('HA can attach a card before setConfig without a phantom Back action; Back label follows language changes',async()=>{
 const dom=loadRuntime(),w=dom.window,card=w.document.createElement('ha-smart-reports');try{
 w.document.body.append(card);card.hass=makeHass();assert.equal(card.shadowRoot.querySelector('[data-smart-back]'),null);
 card.setConfig({variant:'tile'});card.hass=makeHass();card.shadowRoot.querySelector('[data-smart-open]').click();const back=card.shadowRoot.querySelector('[data-smart-back]');assert.equal(back.textContent,'Back to summary');back.focus();const pl=makeHass();pl.language='pl-PL';card.hass=pl;assert.equal(back.textContent,'Wróć do skrótu');
 }finally{card.remove();w.close();}
});

test('energy summaries remain usable with a different initial full tab and after returning from System',async()=>{
 const f=await setup({variant:'compact',default_tab:'system'});try{const r=f.card.shadowRoot;assert.equal(f.card._activeTab,'energy');assert.match(r.querySelector('[data-smart-import]').textContent,/kWh/);r.querySelector('[data-smart-open]').click();assert.equal(f.card._activeTab,'system');r.querySelector('[data-smart-back]').click();assert.equal(f.card._activeTab,'energy');assert.match(r.querySelector('[data-smart-import]').textContent,/kWh/);
 f.card.setConfig({variant:'compact',show_energy:false});assert.doesNotMatch(r.querySelector('[data-smart-simple]').textContent,/Loading/);assert.ok(r.querySelector('[data-smart-open]'));
 }finally{f.close();}
});

test('Compact independently uses comparable recorded cost and refuses historical flat-rate estimates',async()=>{
 const f=await setup({variant:'compact'});try{const r=f.card.shadowRoot;assert.match(r.querySelector('[data-smart-cost-comparison]')?.textContent||'',/no comparable data/);
 const state={...f.card._energyViewState,comparison:{metrics:{energy:{comparable:false},cost:{comparable:true,delta:-12,percent:-5,unit:'PLN'}}}};
 f.card._renderSimpleReport(r.getElementById('content'),state);assert.match(r.querySelector('[data-smart-cost-comparison]').textContent,/−12 PLN.*−5%/);
 }finally{f.close();}
});
test('Tile and Compact preserve a small nonzero amount rather than showing zero',async()=>{
 for(const variant of ['tile','compact']){const f=await setup({variant});try{const r=f.card.shadowRoot,state={...f.card._energyViewState,total:{value:0.000000001},cost:{value:-0.000000001,currency:'PLN'}};f.card._renderSimpleReport(r.getElementById('content'),state);assert.match(r.querySelector('[data-smart-import]').textContent,/<0.000001/);assert.doesNotMatch(r.querySelector('[data-smart-import]').textContent,/0.00 kWh/);if(variant==='compact')assert.match(r.querySelector('[data-smart-cost]').textContent,/>−0.000001/);}finally{f.close();}}
});

test('Tile provides a themed icon and one accessible full-surface action with complete state text',async()=>{
 const f=await setup({variant:'tile'});try{const r=f.card.shadowRoot,s=r.querySelector('[data-smart-simple]'),icon=s.querySelector('ha-icon'),button=s.querySelector('[data-smart-open]');assert.ok(icon);assert.equal(icon.getAttribute('icon'),'mdi:chart-box-outline');assert.equal(icon.getAttribute('aria-hidden'),'true');assert.equal(button.getAttribute('aria-label'),'Open report');assert.match(button.getAttribute('title'),/kWh.*PLN/);assert.equal(s.querySelectorAll('button').length,1);button.click();assert.ok(r.querySelector('[data-smart-back]'));}finally{f.close();}
});
