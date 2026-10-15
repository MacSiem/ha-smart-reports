'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntime, metadata, makeHass, mountCard, explicitConfig, calendarSeries, callsOf, delay } = require('./helpers/smart-reports-harness.cjs');

async function fixture({ now = '2026-08-30T12:00:00Z', zone = 'UTC', key = '7d', enabled = true, change = 1, alter, config = {} } = {}) {
  const ids = ['sensor.grid_import', 'sensor.money', 'sensor.device'];
  const hass = makeHass({ timeZone: zone, metadataById: Object.fromEntries(ids.map(id => [id, metadata(id === 'sensor.money' ? 'PLN' : 'kWh')])),
    deferred: { 'recorder/statistics_during_period': message => {
      const data = Object.fromEntries(ids.map(id => [id, calendarSeries(message.start_time, message.end_time, Array(Math.ceil((Date.parse(message.end_time)-Date.parse(message.start_time))/3600000)).fill(change))]));
      return Promise.resolve(alter ? alter(message, data) : data);
    } } });
  hass.connection = { connected: true };
  const mounted = await mountCard({ hass, config: explicitConfig({ energy_device_statistics: ['sensor.device'], energy_cost_statistics: ['sensor.money'], compare_previous_period: false, ...config }) });
  mounted.card._now = () => new Date(now); mounted.card._period = key;
  mounted.card.setConfig(explicitConfig({ energy_device_statistics: ['sensor.device'], energy_cost_statistics: ['sensor.money'], compare_previous_period: enabled, ...config }));
  if (mounted.card._refreshTimer !== null) { mounted.window.clearTimeout(mounted.card._refreshTimer); mounted.card._refreshTimer = null; }
  hass.calls.length = 0; await mounted.card._loadEnergy();
  mounted.close = () => { mounted.card.remove(); mounted.dom.window.close(); };
  return mounted;
}

test('default OFF performs only the current read and preserves literal legacy schema and CSV', async () => {
  const f = await fixture({ enabled: false }); try {
    assert.equal(callsOf(f.hass, 'recorder/statistics_during_period').length, 1);
    assert.equal(f.card._energyViewState.comparison, undefined);
    const report = f.card._buildExportDocument(new Date('2026-08-30T12:00:00Z'));
    assert.equal(report.schema_version, 2); assert.equal(Object.hasOwn(report, 'comparison'), false);
    assert.deepEqual(Object.keys(report).sort(), ['energy','generated_at','period','schema_version','source_mode']);
    assert.ok(f.card._buildCsv(report).startsWith('schema_version,generated_at,period_key,period_start,period_end,time_zone,section,metric,statistic_id,label,value,unit,status,provenance,included_in_stat,reason\n'));
    assert.equal(f.card._buildCsv(report).includes('comparison'), false);
    const csv = f.card._buildCsv(report);
    f.card._energyViewState = { ...f.card._energyViewState, comparison: { status:'partial', private_test_marker:'ignored_when_off' } };
    assert.deepEqual(f.card._buildExportDocument(new Date('2026-08-30T12:00:00Z')), report);
    assert.equal(f.card._buildCsv(f.card._buildExportDocument(new Date('2026-08-30T12:00:00Z'))), csv);
  } finally { f.close(); }
});

for (const [zone, now, key, expectedStart, expectedEnd, hours] of [
  ['Europe/Warsaw','2026-03-30T10:00:00Z','1d','2026-03-28T23:00:00.000Z','2026-03-29T10:00:00.000Z',11],
  ['Europe/Warsaw','2026-10-26T11:00:00Z','1d','2026-10-24T22:00:00.000Z','2026-10-25T11:00:00.000Z',13],
  ['Asia/Kathmandu','2026-08-30T12:00:00Z','7d','2026-08-16T18:15:00.000Z','2026-08-23T12:00:00.000Z',161.75],
]) test(`previous local dates keep exact UTC cutoff in ${zone} ${now}`, async () => {
  const f = await fixture({ zone, now, key }); try {
    const pair = f.card._energyViewState.comparison;
    assert.equal(pair.previous.period.start, expectedStart); assert.equal(pair.previous.period.end, expectedEnd);
    assert.equal(pair.previous.period.actual_hours, hours); assert.equal(pair.current.period.local_cutoff.minute, zone === 'Asia/Kathmandu' ? 45 : 0);
    const calls = callsOf(f.hass, 'recorder/statistics_during_period'); assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].statistic_ids, calls[1].statistic_ids); assert.equal(calls[0].statistic_ids.includes('sensor.unselected'), false);
    assert.equal(callsOf(f.hass, 'recorder/get_statistics_metadata').length, 1);
  } finally { f.close(); }
});

for (const [now, reason] of [['2026-03-30T00:00:00Z','nonexistent_local_cutoff'], ['2026-10-26T01:00:00Z','ambiguous_local_cutoff']]) {
  test(`cutoff ${reason} has explicit noncomparability and no guessed prior request`, async () => {
    const f = await fixture({ zone:'Europe/Warsaw', now, key:'1d' }); try {
      const pair=f.card._energyViewState.comparison; assert.equal(pair.status,'noncomparable'); assert.equal(pair.reason,reason);
      assert.equal(pair.previous,null); assert.equal(pair.metrics.energy.percent,null);
      assert.equal(callsOf(f.hass,'recorder/statistics_during_period').length,1); assert.ok(f.card.shadowRoot.textContent.includes(f.card._t(reason)));
    } finally { f.close(); }
  });
}

test('full local days retain actual DST 23 and 25 hours without UTC-day substitution', () => {
  const dom=loadRuntime(); try { const c=dom.window.document.createElement('ha-smart-reports');
    for (const [start,end,wanted,zone] of [['2026-03-29T22:00:00Z','2026-03-30T22:00:00Z',23,'Europe/Warsaw'],['2026-10-25T23:00:00Z','2026-10-26T23:00:00Z',25,'Europe/Warsaw'],['2026-10-04T13:00:00Z','2026-10-05T13:00:00Z',23.5,'Australia/Lord_Howe'],['2026-04-05T13:30:00Z','2026-04-06T13:30:00Z',24.5,'Australia/Lord_Howe']]) {
      const p=c._previousPeriodDescriptor({key:'1d',start,end,time_zone:zone});
      assert.equal(p.period.actual_hours,wanted);
    }
  } finally { dom.window.close(); }
});

test('previous zero permits measured absolute delta but never a percentage', async () => {
  const f=await fixture({alter:(m,data)=>{ if (Date.parse(m.start_time)<Date.parse('2026-08-24T00:00:00Z')) for (const rows of Object.values(data)) for (const row of rows) row.change=0; return data; }});
  try { const pair=f.card._energyViewState.comparison; assert.equal(pair.metrics.energy.previous,0); assert.equal(pair.metrics.energy.percent,null);
    assert.equal(pair.metrics.energy.reason,'previous_zero'); assert.equal(pair.metrics.energy.delta,pair.metrics.energy.current);
    assert.equal(pair.metrics.energy.provenance,'complete_comparable_measurements');
  } finally { f.close(); }
});

test('missing daily samples are counted, available subset retained, no partial delta or savings', async () => {
  const f=await fixture({alter:(m,data)=>{for(const rows of Object.values(data)) for(const row of rows) if(new Date(row.start).getUTCDate()===18) row.change=null;return data;}});
  try { const pair=f.card._energyViewState.comparison;assert.equal(pair.previous.coverage.missing_energy_days,1);
    assert.equal(pair.metrics.energy.percent,null);assert.equal(pair.metrics.energy.delta,null);assert.equal(pair.metrics.energy.reason,'incomplete_coverage');
    assert.ok(pair.previous.recorded_total.value>0);assert.equal(pair.previous.daily.find(d=>d.energy.status!=='ready').energy.value,null);
  } finally { f.close(); }
});

test('incompatible units and currency cannot create percent or monetary zero', async () => {
  for(const [id,unit] of [['sensor.grid_import','m³'],['sensor.money','EUR']]) {
    const f=await fixture({enabled:false});try{f.hass.callWS=((original)=>function(message){if(message.type==='recorder/get_statistics_metadata')return Promise.resolve({'sensor.grid_import':metadata(id==='sensor.grid_import'?unit:'kWh'),'sensor.money':metadata(id==='sensor.money'?unit:'PLN'),'sensor.device':metadata()});return original.call(this,message);})(f.hass.callWS);
      f.card._config.compare_previous_period=true;await f.card._loadEnergy();const metric=f.card._energyViewState.comparison.metrics[id==='sensor.money'?'cost':'energy'];assert.equal(metric.percent,null);assert.equal(metric.delta,null);
  }finally{f.close();}}
});

test('historical flat estimate remains unknown; configured negative tariff reuses historical valid rate rules', async () => {
  const flat=await fixture({config:{energy_cost_statistics:[],energy_price:2,currency:'PLN'}});try{assert.equal(flat.card._energyViewState.comparison.previous.cost.reason,'historical_flat_rate_unavailable');assert.equal(flat.card._energyViewState.comparison.metrics.cost.percent,null);}finally{flat.close();}
  const p={schema:1,currency:'PLN',timezone:'UTC',clock:{mode:'civil'},priceBasis:'gross',defaultZone:'mine',allowNegativeEnergy:true,zones:[{id:'mine',energyRate:-2,variableRate:0}],validFrom:'2026-08-24'};
  const f=await fixture({config:{energy_cost_mode:'configured_tariff',tariff_profile:p}});try{const pair=f.card._energyViewState.comparison;assert.ok(pair.current.cost.value<0);assert.equal(pair.previous.cost.value,null);assert.ok(pair.previous.cost.records.some(r=>r.reason==='outside_validity'));assert.equal(pair.metrics.cost.percent,null);}finally{f.close();}
});

test('complete pair percentages use actual measured totals, signed money stays signed and overflow is unknown',async()=>{
 const f=await fixture({alter:(m,data)=>{const value=Date.parse(m.start_time)<Date.parse('2026-08-24T00:00:00Z')?1:2;for(const [id,rows]of Object.entries(data))for(const row of rows)row.change=id==='sensor.money'?-value:value;return data;}});
 try{const p=f.card._energyViewState.comparison;assert.equal(p.metrics.energy.percent,100);assert.ok(p.current.cost.value<0);assert.ok(p.previous.cost.value<0);assert.equal(p.metrics.cost.percent,null);assert.ok(p.metrics.cost.delta<0);assert.equal(p.metrics.cost.reason,'previous_nonpositive');
 const extreme=f.card._comparisonDelta(Number.MAX_VALUE,-Number.MAX_VALUE,'PLN','PLN',true);assert.equal(extreme.delta,null);assert.equal(extreme.percent,null);assert.equal(extreme.comparable,false);
 }finally{f.close();}
});

test('aligned Recorder hours in a non-hour zone expose local-midnight gaps in both periods',async()=>{
 const f=await fixture({zone:'Asia/Kathmandu',alter:(m,data)=>{const start=Math.ceil(Date.parse(m.start_time)/3600000)*3600000,end=Math.floor(Date.parse(m.end_time)/3600000)*3600000;for(const id of Object.keys(data))data[id]=calendarSeries(start,end,Array((end-start)/3600000).fill(1));return data;}});
 try{const p=f.card._energyViewState.comparison;assert.ok(p.current.coverage.missing_energy_days>0);assert.ok(p.previous.coverage.missing_energy_days>0);assert.equal(p.metrics.energy.percent,null);assert.ok(p.records.some(r=>r.value===null&&r.status!=='ready'));assert.ok(p.current.daily.some(d=>d.energy.expected_source_hours%1!==0));}finally{f.close();}
});

test('manual opt-in and opt-out change read counts without exposing profile or replaying writes',async()=>{
 const f=await fixture({enabled:false});try{const c=f.card,input=c.shadowRoot.querySelector('[data-compare-previous-period]');input.checked=true;input.dispatchEvent(new f.window.Event('change'));if(c._refreshTimer!==null){f.window.clearTimeout(c._refreshTimer);c._refreshTimer=null;}f.hass.calls.length=0;await c._loadEnergy();assert.equal(callsOf(f.hass,'recorder/statistics_during_period').length,2);
 const off=c.shadowRoot.querySelector('[data-compare-previous-period]');off.checked=false;off.dispatchEvent(new f.window.Event('change'));if(c._refreshTimer!==null){f.window.clearTimeout(c._refreshTimer);c._refreshTimer=null;}f.hass.calls.length=0;await c._loadEnergy();assert.equal(callsOf(f.hass,'recorder/statistics_during_period').length,1);assert.equal(c._buildExportDocument().schema_version,2);assert.equal(f.hass.calls.some(m=>m.type.includes('set_')),false);
 }finally{f.close();}
});

test('Chart/Data/date drilldown/search/pages reuse the same frozen projection and make no reads', async () => {
  const f=await fixture({key:'30d'});try{const pair=f.card._energyViewState.comparison;assert.ok(Object.isFrozen(pair));assert.ok(Object.isFrozen(pair.records));const calls=f.hass.calls.length;
    assert.equal(f.card.shadowRoot.querySelectorAll('[data-comparison-day][data-comparison-metric="energy"]').length,14);
    const day=f.card.shadowRoot.querySelector('[data-comparison-day]');const date=day.dataset.comparisonDay;day.click();
    f.card.shadowRoot.querySelector('[data-comparison-view="data"]').click();assert.ok(f.card.shadowRoot.querySelectorAll('[data-comparison-record]').length<=50);
    assert.ok([...f.card.shadowRoot.querySelectorAll('[data-comparison-record]')].every(row=>row.dataset.comparisonDay===date));
    f.card.shadowRoot.querySelector('[data-comparison-clear]').click();assert.equal(f.card.shadowRoot.querySelectorAll('[data-comparison-record]').length,50);
    f.card.shadowRoot.querySelector('[data-comparison-data-page="next"]').click();assert.equal(f.card.shadowRoot.querySelectorAll('[data-comparison-record]').length,50);
    f.card.shadowRoot.querySelector('[data-energy-view="devices"]').click();const search=f.card.shadowRoot.querySelector('.device-search');search.value='nothing';search.dispatchEvent(new f.window.Event('input'));
    assert.equal(f.hass.calls.length,calls);assert.equal(f.card._energyViewState.comparison,pair);
    assert.ok([...f.card.shadowRoot.querySelectorAll('.comparison-fill')].every(fill=>Number.parseFloat(fill.style.width)>=0&&Number.parseFloat(fill.style.width)<=100));
  }finally{f.close();}
});

test('opt-in safe full JSON/CSV includes both ranges, all source rows, coverage and reasons independently of view',async()=>{
 const f=await fixture({key:'30d'});try{const c=f.card,pair=c._energyViewState.comparison;c._comparisonDataPage=2;c._deviceQuery='nothing';const report=c._buildExportDocument();assert.equal(report.schema_version,3);assert.equal(report.comparison.records.length,pair.records.length);assert.equal(report.comparison.previous.period.start,pair.previous.period.start);
 assert.ok(report.comparison.records.length>100);const csv=c._buildCsv(report);assert.ok(csv.includes(pair.previous.period.start));assert.ok(csv.includes('comparison_record'));assert.ok(csv.includes('comparison_snapshot'));assert.equal(csv.split('\n').filter(line=>line.includes(',comparison_record,')).length,pair.records.length);
 for(const forbidden of ['tariff_profile','draft','rawconfig','group_ids','callWS'])assert.equal(JSON.stringify(report).includes(forbidden),false);
 }finally{f.close();}
});

for(const edge of ['user','groups','active','config','callWS','connection','source','period','disconnect','offline'])test(`late previous response fenced on ${edge}`,async()=>{
 const f=await fixture({enabled:false});let release;try{const old=f.hass.callWS;let reads=0;f.hass.callWS=function(m){if(m.type==='recorder/statistics_during_period'&&++reads===2)return new Promise(r=>release=r);return old.call(this,m);};f.card._config.compare_previous_period=true;
 const pending=f.card._loadEnergy();for(let waiting=0;!release&&waiting<1000;waiting++)await delay(1);assert.equal(typeof release,'function','prior request must be dispatched before testing its late response');
 if(edge==='user')f.hass.user.id='other';if(edge==='groups')f.hass.user.groups=[{id:'household'}];if(edge==='active')f.hass.user.is_active=false;if(edge==='config')f.hass.config.currency='EUR';if(edge==='callWS')f.hass.callWS=async()=>({});if(edge==='connection')f.hass.connection={connected:true};if(edge==='source')f.card._config.energy_total_statistics=['sensor.other'];if(edge==='period')f.card._period='1d';if(edge==='disconnect')f.card.remove();if(edge==='offline')f.window.dispatchEvent(new f.window.Event('offline'));
 f.card._tariffGuard.observe();release({});await pending;assert.equal(f.card._energyViewState.comparison,undefined);assert.equal(f.card.shadowRoot.querySelector('[data-comparison]'),null);
 }finally{release?.({});f.close();}
});

test('overlapping refresh cannot duplicate an occupied prior raw wire and cannot settle old pair',async()=>{
 const f=await fixture({enabled:false});let release;try{const old=f.hass.callWS;let reads=0;f.hass.callWS=function(m){if(m.type==='recorder/statistics_during_period'&&++reads===2)return new Promise(r=>release=r);return old.call(this,m);};f.card._config.compare_previous_period=true;
 const pending=f.card._loadEnergy();for(let waiting=0;!release&&waiting<1000;waiting++)await delay(1);assert.equal(typeof release,'function','prior request must be dispatched before testing its late response');const calls=f.hass.calls.length;await f.card._loadEnergy();assert.equal(f.hass.calls.length,calls);assert.equal(f.card._tariffGuard.occupied(),true);release({});await pending;assert.equal(f.card._energyViewState.comparison,undefined);
 }finally{release?.({});f.close();}
});

for (const zone of ['Asia/Kolkata','Asia/Kathmandu']) test(`daily drilldown retains whole UTC readings without assigning midnight crossings in ${zone}`, async () => {
 const profile={schema:1,currency:'PLN',timezone:zone,clock:{mode:'civil'},priceBasis:'gross',defaultZone:'mine',zones:[{id:'mine',energyRate:2,variableRate:0}]};
 const f=await fixture({zone,config:{energy_cost_mode:'configured_tariff',tariff_profile:profile},alter:(m,data)=>{
  const start=Math.ceil(Date.parse(m.start_time)/3600000)*3600000,end=Math.floor(Date.parse(m.end_time)/3600000)*3600000;
  for(const id of Object.keys(data))data[id]=calendarSeries(start,end,Array((end-start)/3600000).fill(1));return data;
 }});
 try {
  const pair=f.card._energyViewState.comparison;
  const localDate=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
  for(const snap of [pair.current,pair.previous]) {
   const crossing=snap.records.filter(row=>row.role==='total'&&row.status==='ready'&&localDate(Date.parse(row.from))!==localDate(Date.parse(row.to)-1));
   assert.ok(crossing.length>0,'fixture contains measured whole hours spanning midnight');
   for(const row of crossing){assert.equal(row.recorded_value,1);assert.equal(Date.parse(row.to)-Date.parse(row.from),3600000);assert.equal(row.day_index,-1);assert.equal(row.day_allocation_reason,'crosses_local_midnight');}
   for(const day of snap.daily) {
    const roots=snap.records.filter(row=>row.role==='total'&&row.day_index===day.index&&typeof row.recorded_value==='number');
    assert.equal(roots.reduce((sum,row)=>sum+row.recorded_value,0),day.energy.recorded_value ?? 0,'daily chart matches exact same measured records');
    const priced=snap.records.filter(row=>row.role==='priced_energy'&&row.day_index===day.index&&row.available);
    assert.equal(priced.reduce((sum,row)=>sum+row.energyCost,0),day.cost.recorded_value ?? 0,'daily cost matches whole priced rows');
   }
  }
  const report=f.card._buildExportDocument();assert.equal(report.comparison.records.length,pair.records.length);
  assert.ok(report.comparison.records.some(row=>row.day_allocation_reason==='crosses_local_midnight'&&row.recorded_value===1));
 } finally {f.close();}
});

test('comparison labels identify deltas and Data explains source roles and status in Polish',async()=>{
 const f=await fixture({config:{energy_device_statistics:[],energy_cost_statistics:[]}});try{
  f.hass.language='pl';f.card.hass=f.hass;
  assert.ok(f.card.shadowRoot.textContent.includes('Zmiana zmierzonej energii'));
  assert.ok(f.card.shadowRoot.textContent.includes('Zmiana kosztu energii'));
  f.card.shadowRoot.querySelector('[data-comparison-view="data"]').click();
  const labels=[...f.card.shadowRoot.querySelectorAll('.comparison-record dd')].map(dd=>dd.textContent);
  assert.ok(labels.includes('suma'));assert.ok(labels.includes('gotowe'));assert.equal(labels.includes('total'),false);assert.equal(labels.includes('ready'),false);
 }finally{f.close();}
});


test('same-period comparison refresh preserves live device search while Recorder is pending', async () => {
  let hold = false, release;
  const f = await fixture({alter: (message, data) => hold ? new Promise(resolve => { release = () => resolve(data); }) : data});
  let refreshing;
  try {
    f.card.shadowRoot.querySelector('[data-energy-view="devices"]').click();
    const input = f.card.shadowRoot.querySelector('.device-search');
    input.value = 'dev'; input.dispatchEvent(new f.window.Event('input', {bubbles:true}));
    const active = f.card.shadowRoot.querySelector('.device-search'); active.focus(); active.setSelectionRange(2,2);
    hold = true; refreshing = f.card._loadEnergy();
    for (let i=0; i<40 && !release; i++) await delay(5);
    assert.equal(typeof release, 'function', 'Recorder boundary reached');
    assert.equal(f.card._energyViewState.status, 'ready', 'settled current report remains readable');
    assert.equal(f.card.shadowRoot.querySelector('.device-search'), active, 'same live search survives the pending read');
    assert.equal(f.card.shadowRoot.activeElement, active);
    assert.equal(active.selectionStart, 2);
    assert.equal(f.card.shadowRoot.getElementById('exportJsonBtn').disabled, false);
    active.value = 'device'; active.dispatchEvent(new f.window.Event('input', {bubbles:true}));
    assert.equal(f.card._deviceQuery, 'device');
  } finally {
    hold = false; if (release) release(); if (refreshing) await refreshing; f.close();
  }
});

test('previous-period read failure retains current measurements and exports an unavailable comparison', async () => {
  let failPrior = false;
  const f = await fixture({alter: (message,data) => failPrior && Date.parse(message.start_time) < Date.parse('2026-08-24T00:00:00Z')
    ? Promise.reject({code:'timeout', message:'private transport detail must not appear'}) : data});
  try {
    failPrior = true; await f.card._loadEnergy();
    const state = f.card._energyViewState;
    assert.equal(state.status, 'ready', 'optional prior failure cannot erase valid current measurements');
    assert.equal(state.total.value, 156);
    assert.equal(state.devices.length, 1);
    assert.equal(state.comparison.reason, 'read_failed');
    assert.equal(state.comparison.previous.status, 'error');
    assert.equal(state.comparison.previous.period.start, '2026-08-17T00:00:00.000Z');
    assert.equal(state.comparison.previous.total.value, null);
    assert.equal(state.comparison.metrics.energy.delta, null);
    assert.equal(state.comparison.metrics.energy.percent, null);
    assert.equal(f.card.shadowRoot.getElementById('exportJsonBtn').disabled, false);
    assert.match(f.card.shadowRoot.textContent, /Previous period could not be loaded/i);
    const report = f.card._projectReviewedExport(f.card._buildExportDocument(), false);
    assert.equal(report.energy.total.value, 156);
    assert.equal(report.comparison.reason, 'read_failed');
    assert.equal(report.comparison.previous.status, 'error');
    assert.doesNotMatch(JSON.stringify(report), /private transport detail/);
  } finally { f.close(); }
});

test('approved comparison keeps current KPIs first and the previous amount beside each value',async()=>{
 const f=await fixture({alter:(m,data)=>{const value=Date.parse(m.start_time)<Date.parse('2026-08-24T00:00:00Z')?1:2;for(const rows of Object.values(data))for(const row of rows)row.change=value;return data;}});
 try{
  const root=f.card.shadowRoot,main=root.getElementById('content');
  const headline=[...main.querySelectorAll('.metric')].find(e=>e.querySelector('.metric-label')?.textContent==='Grid import');
  assert.ok(headline);assert.match(headline.textContent,/312\.00 kWh/);assert.match(headline.textContent,/Previous period.*156\.00 kWh/);assert.match(headline.textContent,/100\.00%/);
  const details=[...main.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent==='Comparison details');
  assert.ok(details,'full ranges and hourly records remain accessible');assert.equal(details.open,false);
  assert.ok(headline.compareDocumentPosition(details)&f.window.Node.DOCUMENT_POSITION_FOLLOWING);
  const before=callsOf(f.hass,'recorder/statistics_during_period').length;
  details.open=true;details.dispatchEvent(new f.window.Event('toggle'));root.querySelector('[data-comparison-view="data"]').click();
  const rerendered=[...main.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent==='Comparison details');
  assert.equal(rerendered.open,true);assert.ok(rerendered.querySelector('[data-comparison-record]'));assert.equal(callsOf(f.hass,'recorder/statistics_during_period').length,before);
 }finally{f.close();}
});

test('incomplete previous coverage puts an explicit reason next to the headline without a false percent',async()=>{
 const f=await fixture({alter:(m,data)=>{if(Date.parse(m.start_time)<Date.parse('2026-08-24T00:00:00Z'))for(const rows of Object.values(data))rows.pop();return data;}});
 try{
  const metric=[...f.card.shadowRoot.querySelectorAll('.metric')].find(e=>e.querySelector('.metric-label')?.textContent==='Grid import');
  assert.match(metric.textContent,/Previous period/);assert.match(metric.textContent,/incomplete|Incomplete/);assert.equal(metric.textContent.includes('%'),false);
 }finally{f.close();}
});
