'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mountCard,makeHass,metadata,explicitConfig}=require('./helpers/smart-reports-harness.cjs');
const expected={idle:'not_checked',loading:'not_checked',not_configured:'not_checked',unsupported:'error',permission_denied:'error',error:'error',no_data:'no_data',partial:'partial'};
const labels={en:{not_checked:'– Not checked',error:'✕ Error',no_data:'∅ No data',partial:'½ Partial'},pl:{not_checked:'– Nie sprawdzono',error:'✕ Błąd',no_data:'∅ Brak danych',partial:'½ Częściowo'}};
for(const language of ['en','pl']) for(const [state,result] of Object.entries(expected)) test(`${language}: ${state} has the exact family outcome beside its useful explanation`,async()=>{
 const hass=makeHass({metadataById:{'sensor.grid_import':metadata()}});hass.language=language;
 const f=await mountCard({hass,config:explicitConfig()});
 try{
  const value={...f.card._energyViewState,status:state,code:'synthetic_error'};
  const before=JSON.stringify(value),calls=hass.calls.length;
  f.card._setEnergyViewState(value);
  const block=f.card.shadowRoot.querySelector('#content .state'),badge=block?.querySelector('[data-result-state]');
  assert.ok(badge,'the visible report state needs an explicit family result');
  assert.equal(badge.dataset.resultState,result);assert.equal(badge.textContent.trim(),labels[language][result]);
  assert.ok(block.querySelector('h3').textContent.length>10,'keep the descriptive heading');
  assert.ok(block.querySelector('p').textContent.length>10,'keep source limitations and recovery guidance');
  assert.equal(block.querySelector('[data-result-state="success"]'),null);
  assert.equal(JSON.stringify(f.card._energyViewState),before,'presentation must not alter measurements');
  assert.equal(hass.calls.length,calls,'presentation must not fetch');
  assert.equal(f.card.shadowRoot.getElementById('exportJsonBtn').disabled,!['no_data','partial'].includes(state));
 }finally{f.card.remove();f.dom.window.close();}
});
