// SUPPLEMENT AFTER RUNTIME: added during manual review, not tests-first evidence.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mountCard, makeHass, explicitConfig, calendarSeries, metadata, delay } = require('./helpers/smart-reports-harness.cjs');
const exportNode = (card,key) => card.shadowRoot.querySelector('[data-ha-tools-export]')?.shadowRoot.querySelector(`[data-export="${key}"]`);
async function fixture() {
 const hass=makeHass({metadataById:{'sensor.grid_import':metadata()},deferred:{'recorder/statistics_during_period':m=>Promise.resolve({'sensor.grid_import':calendarSeries(m.start_time,m.end_time,[0])})}});
 return mountCard({hass,config:explicitConfig({energy_price:0,currency:'PLN'})});
}
// Small RFC4180 reader used only to inspect generated CSV's full-document row.
function cells(csv) {
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
 else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
 return rows;
}
test('W6 CSV full-document row round-trips all reviewed fields and textual formulas stay inert',async()=>{
 const f=await fixture();try{
  const raw=f.card._buildExportDocument(f.card._now());
  raw.energy.devices=Array.from({length:103},(_,i)=>({statistic_id:`sensor.${i}`,label:'\t=HYPERLINK("unsafe")',value:i===0?0:null,recorded_value:i===0?0:null,coverage:null,unit:'kWh',status:i===0?'ready':'no_data',provenance:'explicit',included_in_stat:null}));
  const safe=f.card._projectReviewedExport(raw,true);safe.export_scope={result_state:'partial',truncated:false,included:['full'],excluded:['secrets'],source_limit:'loaded'};
  const csv=f.card._buildReviewedCsv(safe),rows=cells(csv),full=rows.find(row=>row[7]==='reviewed_full_document');
  assert.ok(full);assert.deepEqual(JSON.parse(full[10]),JSON.parse(JSON.stringify(safe)));assert.equal(rows.filter(row=>row[7]==='device').length,103);
  for(const row of rows.filter(row=>row[7]==='device'))assert.equal(row[9].startsWith("'"),true);
 }finally{f.card.remove();f.dom.window.close();}
});
test('W6 detach ignores late preview result and opening again resets consent',async()=>{
 const f=await fixture();try{
  const original=f.card._buildReviewedExport.bind(f.card);let release;
  f.card._buildReviewedExport=options=>new Promise(resolve=>{release=()=>resolve(original(options));});
  f.card.shadowRoot.getElementById('exportJsonBtn').click();assert.ok(release);
  f.card.remove();release();await delay();assert.equal(exportNode(f.card,'preview'),undefined);
  f.card._buildReviewedExport=original;f.window.document.body.append(f.card);await f.card._loadEnergy();
  f.card.shadowRoot.getElementById('exportJsonBtn').click();await delay();assert.equal(exportNode(f.card,'private').checked,false);
 }finally{f.card.remove();f.dom.window.close();}
});
