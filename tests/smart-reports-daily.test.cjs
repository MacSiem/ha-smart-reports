'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadRuntime,makeHass,metadata,calendarSeries,explicitConfig}=require('./helpers/smart-reports-harness.cjs');
async function fixture(period='7d',width=390){
 const dom=loadRuntime(),w=dom.window,c=w.document.createElement('ha-smart-reports');
 c.getBoundingClientRect=()=>({width});c._now=()=>new Date('2026-10-26T12:00:00Z');c._period=period;
 const hass=makeHass({timeZone:'Europe/Warsaw',metadataById:{'sensor.grid_import':metadata()},deferred:{'recorder/statistics_during_period':m=>{
  const rows=calendarSeries(m.start_time,m.end_time,Array(Math.ceil((Date.parse(m.end_time)-Date.parse(m.start_time))/3600000)).fill(1));
  for(const row of rows){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.start));if(date==='2026-10-21')row.change=0;if(date==='2026-10-22'||(date==='2026-10-23'&&new Date(row.start).getUTCHours()===12))row.change=null;}
  return Promise.resolve({'sensor.grid_import':rows});
 }}});hass.connection={connected:true};
 c.setConfig(explicitConfig({show_support:false}));w.document.body.appendChild(c);c.hass=hass;
 if(c._refreshTimer!==null){w.clearTimeout(c._refreshTimer);c._refreshTimer=null;}await c._loadEnergy();
 return{c,w,hass,root:c.shadowRoot,close(){c.remove();dom.window.close();}};
}
const dayNodes=f=>Array.from(f.root.querySelectorAll('[data-daily-day]'));
test('daily chart and Data keep actual recorder values, zero, missing, partial and 25-hour day',async()=>{
 const f=await fixture();try{
 const days=f.c._energyViewState.daily;assert.equal(days.length,7);assert.ok(days.some(d=>d.expected_source_hours===25));assert.ok(days.some(d=>d.recorded_value===0));assert.ok(days.some(d=>d.status==='no_data'));assert.ok(days.some(d=>d.status==='partial'));
 const chart=dayNodes(f);assert.equal(chart.length,7);
 for(const day of days){const n=chart.find(n=>n.dataset.dailyDay===day.start);assert.ok(n);assert.ok(n.textContent.includes(`${f.c._formatNumber(day.recorded_value,2)} kWh`));assert.ok(n.textContent.includes(f.c._t(day.status==='ready'?'Complete history':day.status==='partial'?'Partial history':'No measurements')));assert.equal(n.dataset.availability,day.status);}
 const maximum=Math.max(...days.map(d=>d.recorded_value||0));for(const day of days){const bar=chart.find(n=>n.dataset.dailyDay===day.start).querySelector('.bar-fill');assert.equal(parseFloat(bar.style.width),day.recorded_value?day.recorded_value/maximum*100:0);}
 const texts=chart.map(n=>n.textContent);f.root.querySelector('[data-daily-view="data"]').click();assert.deepEqual(dayNodes(f).map(n=>n.textContent),texts);assert.equal(f.root.querySelector('.daily-track'),null);
 }finally{f.close();}
});
test('day selection exposes exact interval/coverage without fetching or changing full JSON/CSV',async()=>{
 const f=await fixture();try{const stamp=new Date('2026-10-26T12:00:00Z'),before=JSON.stringify(f.c._buildExportDocument(stamp)),csv=f.c._buildCsv(JSON.parse(before)),calls=f.hass.calls.length;
 const day=f.c._energyViewState.daily.find(d=>d.expected_source_hours===25);f.root.querySelector(`[data-daily-day="${day.start}"]`).click();
 const detail=f.root.querySelector('[data-daily-detail]');assert.ok(detail);assert.equal(detail.previousElementSibling.dataset.dailyDay,day.start);for(const text of[day.start,day.end,'Europe/Warsaw','25 / 25','25.00 kWh'])assert.ok(detail.textContent.includes(text),text);
 assert.equal(f.root.querySelector(`[data-daily-day="${day.start}"]`).getAttribute('aria-pressed'),'true');
 f.root.querySelector('[data-daily-view="data"]').click();assert.equal(f.root.querySelector('[data-daily-detail]').dataset.dailyDetail,day.start);f.root.querySelector('[data-daily-clear]').click();assert.equal(f.root.querySelector('[data-daily-detail]'),null);
 assert.equal(f.hass.calls.length,calls);assert.equal(JSON.stringify(f.c._buildExportDocument(stamp)),before);assert.equal(f.c._buildCsv(f.c._buildExportDocument(stamp)),csv);
 }finally{f.close();}
});
test('30 days are reachable in both views, pages keep one scale and boundary focus',async()=>{
 const f=await fixture('30d');try{const all=f.c._energyViewState.daily;assert.equal(all.length,30);
 for(const view of['chart','data']){f.c._dailyPage=0;f.root.querySelector(`[data-daily-view="${view}"]`).click();const seen=[];
 for(let i=0;i<5;i++){seen.push(...dayNodes(f).map(n=>n.dataset.dailyDay));const next=f.root.querySelector('[data-daily-page="next"]');assert.ok(next);if(i<4){next.focus();next.click();}else assert.equal(next.disabled,true);}
 assert.deepEqual(seen,Array.from(all,d=>d.start));assert.ok(f.root.activeElement.matches('[data-daily-view][aria-selected="true"]'));
 }
 }finally{f.close();}
});
test('refresh and locale preserve selected day and focus, outside focus is never stolen',async()=>{
 const f=await fixture();try{const day=dayNodes(f)[2];day.focus();day.click();const key=day.dataset.dailyDay;await f.c._loadEnergy();assert.equal(f.root.activeElement.dataset.dailyDay,key);assert.equal(f.root.querySelector('[data-daily-detail]').dataset.dailyDetail,key);
 f.c.hass={...f.hass,language:'pl'};assert.equal(f.root.activeElement.dataset.dailyDay,key);assert.equal(f.root.querySelector('[data-daily-view="data"]').textContent,'Dane');
 const outside=f.w.document.createElement('input');f.w.document.body.appendChild(outside);outside.focus();await f.c._loadEnergy();assert.equal(f.w.document.activeElement,outside);
 }finally{f.close();}
});
test('compact daily picker invokes both views and restores focus; new period clears selection',async()=>{
 const f=await fixture('7d',260);try{const day=dayNodes(f)[0];day.click();let p=f.root.querySelector('[data-report-picker="daily"]');assert.ok(p);assert.equal(p.hidden,false);assert.deepEqual(Array.from(p.options,o=>o.value),['chart','data']);p.value='data';p.dispatchEvent(new f.w.Event('change'));assert.equal(f.c._dailyView,'data');assert.equal(f.root.activeElement,f.root.querySelector('[data-report-picker="daily"]'));
 f.c._period='1d';await f.c._loadEnergy();assert.equal(f.root.querySelector('[data-daily-detail]'),null);assert.equal(dayNodes(f).length,1);assert.equal(f.root.querySelector('[data-daily-page="next"]').disabled,true);
 }finally{f.close();}
});
