'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {projectSmartCalendarV53:project,calendarReportCsvV53:csv}=require('../shared/ha-smart-reports-calendar-export.js');
// Literal selected facts from analysis-calendar-v53.json, not a copy of the raw DTO.
function fixture() { return {
 schema:2, generated_at:'2026-10-18T12:34:00+00:00',
 context:{entry_id:'NEVER_EXPORT',tariff_revision:4,registry_revision:2,measurement_timezone:'UTC',period_kind:'day',source_signature:'NEVER_EXPORT'},
 period:{status:'ready',reason:null,kind:'day',start:'2026-10-10T00:00:00+00:00',end:'2026-10-11T00:00:00+00:00',timezone:'UTC',hours:24,partial:false},
 coverage:{complete:true,ratio:1,expected_source_seconds:86400,measured_source_seconds:86400},
 status:'ready',pricing_status:'ready',active_tariff_id:'active',snapshot_id:'NEVER_EXPORT',
 totals:{kwh:'240.0',recorded_household_kwh:'240.0',energy_cost:'240.00',variable_cost:'0.00',legacy_combined_cost:'0.00',usage_cost:'240.00',fixed_cost:'1.00',total_cost:'241.00',effective_price:'1.00',currency:'EUR',price_basis:'gross',measurement_complete:true},
 chart:{status:'ready',reason:null,timezone:'UTC',grain:'hour',fixed_fee_scope:'household_period_only',coverage_kind:'complete_household_hours',bins:[{from:1791590400000,to:1791594000000,start:'2026-10-10T00:00:00+00:00',end:'2026-10-10T01:00:00+00:00',kwh:'10.0',recorded_kwh:'10.0',energy_cost:'10.00',variable_cost:'0.00',usage_cost:'10.00',fixed_cost:null,total_cost:null,currency:'EUR'}]},
 groups:{revision:2,membership_mode:'current_snapshot',energy_domain:'grid_import',partition_complete:true,
 devices:{'sensor.device':{kwh:'48',recorded_kwh:'48',usage_cost:'48.00',name:'Desk',area_id:'office',area_name:'Office',floor_id:'upstairs',floor_name:'Upstairs',parent_id:null,attribution:'measured'}},areas:{office:{kwh:'48',usage_cost:'48.00'}},floors:{upstairs:{kwh:'48',usage_cost:'48.00'}},unassigned:{kwh:'0',usage_cost:'0.00',coverage:{observed_hours:0,expected_hours:0}},unmeasured:{kwh:'192.0',usage_cost:'192.00'}},
 rates:[{version_id:'a',valid_from:'2026-01-01',valid_to:null,validity_clock:'civil',rate_semantics:'components',currency:'EUR',price_basis:'gross',fixed_monthly:{subscription:31,capacity:0,distribution:0,other:0},profile:{schema:1,currency:'EUR',timezone:'UTC',priceBasis:'gross',defaultZone:'day',zones:[{id:'day',label:'day',energyRate:1,variableRate:0}],rules:[]}}],
 fees:{components:{subscription:'1.00',capacity:'0.00',distribution:'0.00',other:'0.00',legacy_combined:'0.00'},complete:true,days:[{day:'2026-10-10',version_id:'a',day_fraction:'1'}]},
 comparisons:{previous:{status:'ready',reason:null,current_kwh:240,baseline_kwh:240,delta_kwh:0,percent:0,comparison_scope:'calendar_totals',baseline_kind:'previous',groups:{reconciles_household_delta:false,reconciles_household_cost_delta:false,devices:{'sensor.device':{status:'ready',comparison_scope:'common_measurements',current_kwh:'46',baseline_kwh:'46',own_current_kwh:'48',full_baseline_kwh:null,delta_kwh:'0',delta_fixed_cost:null}},unassigned:{current_kwh:'0',baseline_kwh:'0',delta_kwh:'0',percent:null},unmeasured:{current_kwh:'184.0',own_current_kwh:'192.0',delta_kwh:'0.0'}}}}
}; }
// Minimal RFC4180 reader so assertions examine cells, not escaping coincidences.
function cells(text) {
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++) {const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(value);value='';}else if(c==='\r'&&!quoted&&text[i+1]==='\n'){row.push(value);rows.push(row);row=[];value='';i++;}else value+=c;}
 assert.equal(quoted,false);return rows;
}
test('calendar family is separate; schema2 legacy is refused',()=>{
 const p=project(fixture());assert.equal(p.schema_version,4);assert.equal(p.report_kind,'calendar_energy');assert.equal(p.private_fields,false);
 assert.throws(()=>project({schema:2,period:{kind:'7d'}}),/calendar/);
 for(const kind of ['day','week','month','year']) {const f=fixture();f.period.kind=kind;assert.equal(project(f).period.kind,kind);}
 assert.throws(()=>csv(fixture()),/projection/);
});
test('privacy aliases share cross-level links and survive repeated projection',()=>{
 const f=fixture();f.groups.devices['sensor.child']={name:'Child',parent_id:'sensor.device',included_in:'sensor.device',included_in_stat:'sensor.device',statistic_id:'sensor.child',area_id:'office'};
 const p=project(f),keys=Object.keys(p.groups.devices),device=keys.find(k=>p.groups.devices[k].kwh==='48'),child=keys.find(k=>p.groups.devices[k].included_in);
 assert.equal(p.groups.devices[child].included_in,device);assert.equal(p.groups.devices[child].parent_id,device);assert.equal(p.groups.devices[child].included_in_stat,device);
 assert.equal(p.groups.devices[child].statistic_id,child);assert.ok(Object.hasOwn(p.groups.areas,p.groups.devices[device].area_id));assert.ok(Object.hasOwn(p.groups.floors,p.groups.devices[device].floor_id));
 assert.ok(Object.hasOwn(p.comparisons.previous.groups.devices,device));assert.equal(p.rates[0].version_id,p.fees.days[0].version_id);assert.equal(p.rates[0].profile.defaultZone,p.rates[0].profile.zones[0].id);
 assert.doesNotMatch(JSON.stringify(p),/sensor\.|Desk|Office|Upstairs|NEVER_EXPORT/);assert.equal(JSON.stringify(p),JSON.stringify(project(f)));
});
test('unknown nested keys and sensitive roots are excluded under either privacy choice',()=>{
 const f=fixture();function inject(v) {if(!v||typeof v!=='object')return;Object.values(v).forEach(inject);if(!Array.isArray(v)){v.auth='NEVER_EXPORT';v.user='NEVER_EXPORT';v.host='NEVER_EXPORT';v.snapshot_id='NEVER_EXPORT';v.entry_id='NEVER_EXPORT';v.signature='NEVER_EXPORT';v.unknown='NEVER_EXPORT';}}
 inject(f);for(const includePrivate of [false,true]){const p=project(f,{includePrivate});assert.doesNotMatch(JSON.stringify(p),/NEVER_EXPORT|"auth"|"host"|"user"|"snapshot_id"|"entry_id"|"signature"/);assert.doesNotMatch(csv(p),/NEVER_EXPORT/);}
 const p=project(f,{includePrivate:true});assert.equal(p.groups.devices['sensor.device'].name,'Desk');assert.equal(p.groups.devices['sensor.device'].area_id,'office');assert.equal(p.rates[0].profile.zones[0].id,'day');
});
test('Decimal strings, missing/null/zero and finite numeric metadata remain distinct',()=>{
 const f=fixture();f.totals.energy_cost='9007199254740993.000000000000000001';f.totals.variable_cost='-0.000000000000000001';f.totals.effective_price='1e+400';f.period.hours=Infinity;f.coverage.ratio=NaN;f.totals.fixed_cost=null;delete f.totals.total_cost;f.totals.usage_cost=0;
 const p=project(f);assert.equal(p.totals.energy_cost,f.totals.energy_cost);assert.equal(p.totals.variable_cost,f.totals.variable_cost);assert.equal(p.totals.effective_price,'1e+400');assert.equal(p.period.hours,null);assert.equal(p.coverage.ratio,null);assert.equal(p.totals.fixed_cost,null);assert.equal(p.totals.usage_cost,0);assert.equal(Object.hasOwn(p.totals,'total_cost'),false);
 const rows=cells(csv(p));assert.ok(rows.some(r=>r[1]==='/totals/fixed_cost'&&r[2]==='null'&&r[3]===''));assert.ok(rows.some(r=>r[1]==='/totals/usage_cost'&&r[2]==='number'&&r[3]==='0'));assert.ok(!rows.some(r=>r[1]==='/totals/total_cost'));
});
test('components/fees, Chart/Data facts and group reconciliation use original facts',()=>{
 const f=fixture(),p=project(f);assert.equal(p.totals.total_cost,'241.00');assert.equal(p.fees.components.subscription,'1.00');assert.equal(p.chart.bins[0].fixed_cost,null);assert.equal(p.chart.bins[0].kwh,'10.0');
 assert.equal(p.groups.unassigned.kwh,'0');assert.equal(p.groups.unmeasured.kwh,'192.0');assert.equal(p.comparisons.previous.groups.reconciles_household_cost_delta,false);assert.equal(Object.values(p.comparisons.previous.groups.devices)[0].current_kwh,'46');assert.equal(Object.values(p.comparisons.previous.groups.devices)[0].own_current_kwh,'48');assert.equal(p.rates[0].valid_from,'2026-01-01');assert.equal(p.rates[0].valid_to,null);
 const rows=cells(csv(p));for(const type of ['household_total','fee_component','chart_fact','group_fact','comparison','rate_version'])assert.ok(rows.some(r=>r[0]===type));
 assert.ok(rows.some(r=>r[1]==='/chart/bins/0/kwh'&&r[3]===f.chart.bins[0].kwh));assert.ok(rows.some(r=>r[1]==='/groups/unmeasured/kwh'&&r[3]==='192.0'));
});
test('native HA recorded cost and current prices remain separate from a full bill',()=>{
 const f=fixture();f.native_pricing={schema:1,source:'ha_energy',period_cost:{status:'partial',amount:null,recorded_amount:'12.0000000000001',currency:'EUR',scope:'grid_import_recorded_cost',coverage:{complete:false,expected_source_hours:24,measured_source_hours:12},components_status:'unknown',fixed_fees_status:'unknown',reason:'incomplete_coverage'},current_prices:[{source_id:'sensor.device',origin:'number_energy_price',price:'0.12',currency:'EUR',energy_unit:'kWh',observed_at:f.generated_at,historical:false,status:'ready',reason:null}],provenance:[{energy_source_id:'sensor.device',cost_statistic_id:'sensor.money'}]};
 const p=project(f);assert.equal(p.native_pricing.period_cost.amount,null);assert.equal(p.native_pricing.period_cost.recorded_amount,'12.0000000000001');assert.equal(p.native_pricing.period_cost.fixed_fees_status,'unknown');assert.equal(p.totals.total_cost,'241.00');assert.equal(p.native_pricing.current_prices[0].historical,false);assert.equal(p.native_pricing.current_prices[0].source_id,p.native_pricing.provenance[0].energy_source_id);assert.ok(cells(csv(p)).some(r=>r[0]==='native_ha_cost'&&r[1]==='/native_pricing/period_cost/amount'&&r[2]==='null'));
});
test('CSV is formula-safe, preserves quoted UTF8/newlines and uses immutable reviewed bytes',()=>{
 const f=fixture();f.groups.devices['sensor.device'].name='  \t=HYPERLINK("bad")\nZażółć, gęślą';f.totals.variable_cost='-1.000';const p=project(f,{includePrivate:true});const text=csv(p),rows=cells(text);
 assert.ok(rows.every(r=>r.length===4));assert.ok(rows.some(r=>r[1]==='/groups/devices/sensor.device/name'&&r[3]==="'"+f.groups.devices['sensor.device'].name));assert.ok(rows.some(r=>r[1]==='/totals/variable_cost'&&r[3]==="'-1.000"));assert.equal(p.totals.variable_cost,'-1.000');
 assert.throws(()=>{p.totals.total_cost='BAD';},TypeError);assert.equal(csv(p),text);assert.throws(()=>csv(JSON.parse(JSON.stringify(p))),/projection/);
 for(const prefix of ['=','+','-','@','\r\n=']) {const input=fixture();input.groups.devices['sensor.device'].name=prefix+'x';assert.ok(cells(csv(project(input,{includePrivate:true}))).some(r=>r[1].endsWith('/name')&&r[3]==="'"+prefix+'x'));}
});
test('period timezone and offset timestamps retain DST facts without reconstruction',()=>{
 const f=fixture();f.period.timezone='Australia/Lord_Howe';f.period.hours=24.5;f.period.start='2026-04-05T00:00:00+11:00';f.period.end='2026-04-06T00:00:00+10:30';const p=project(f);assert.equal(p.period.hours,24.5);assert.equal(p.period.timezone,'Australia/Lord_Howe');assert.equal(p.period.start,f.period.start);assert.equal(p.period.end,f.period.end);
});
test('optional producer period/zone and chart comparison proofs retain independent facts',()=>{
 const f=fixture();
 f.rates[0].zone_usage_rates=[{zone_id:'day',usage_rate:'1.00000000000000001'}];
 f.period_summary={window:{start:f.period.start,end:f.period.end,timezone:'UTC'},zone_breakdown:{status:'partial',scope:'complete_household_hours',fixed_fee_scope:'household_period_only',reason:'incomplete_classification',reconciles_recorded_kwh:false,reconciles_known_costs:false,zones:[{version_id:'a',zone_id:'day',tariff_id:'active',label:'day',kwh:null,recorded_kwh:'230.000',complete:false,known_costs:{energy_cost:'230.00'}}],unattributed:{recorded_kwh:'10.0',measured_seconds:3600,missing_seconds:0,reasons:['classification_unavailable']}},cheap_zone_share:{status:'partial',reason:'incomplete_classification',scope:'complete_household_hours',classification_source:'explicit_tariff_classification',known_cheap_kwh:'100.0',classified_kwh:'230.000',total_kwh:'240.0',ratio:null}};
 f.comparisons.previous.chart={status:'ready',reason:null,grain:'hour',timezone:'UTC',coverage_kind:'selected_household_comparison_mask',fixed_fee_scope:'household_period_only',comparison_scope:'calendar_totals',reconciles_comparison_energy:false,markers:[{status:'ready',reason:null,mapping:'calendar_frame_bijection',current_from:f.chart.bins[0].from,current_to:f.chart.bins[0].to,baseline_from:1791504000000,baseline_to:1791507600000,current_kwh:'10.0',baseline_kwh:'9.000000000000001',expected_current_source_seconds:3600,selected_current_source_seconds:3600,expected_baseline_source_seconds:3600,selected_baseline_source_seconds:3600}]};
 const p=project(f);assert.equal(p.period_summary.zone_breakdown.zones[0].recorded_kwh,'230.000');assert.equal(p.period_summary.cheap_zone_share.ratio,null);assert.equal(p.period_summary.zone_breakdown.zones[0].zone_id,p.rates[0].profile.zones[0].id);assert.equal(p.rates[0].zone_usage_rates[0].usage_rate,'1.00000000000000001');assert.equal(p.comparisons.previous.chart.markers[0].baseline_kwh,'9.000000000000001');assert.equal(p.comparisons.previous.chart.reconciles_comparison_energy,false);
 assert.ok(cells(csv(p)).some(r=>r[0]==='period_fact'&&r[1]==='/period_summary/zone_breakdown/zones/0/recorded_kwh'&&r[3]==='230.000'));
});

test('mean7 preserves the producer fee scope and all seven unrounded historical fee periods',()=>{
 const f=fixture();f.comparisons.mean7={...f.comparisons.previous,baseline_kind:'mean7',costs:{current:{fixed_scope:'household_period'},baseline:{fixed_scope:'arithmetic_mean_seven_household_periods',period_count:7,aggregation:'arithmetic_mean_seven_unrounded_components',fixed_cost:'1.00',fees:{complete:true,components:{subscription:'1.00000000000000001'},periods:[1,2,3,4,5,6,7].map(day=>({complete:true,components:{subscription:'1.00000000000000001'},days:[{day:'2026-10-0'+day,version_id:'a',day_fraction:'1'}]}))}}}};
 const p=project(f),b=p.comparisons.mean7.costs.baseline;assert.equal(p.comparisons.mean7.costs.current.fixed_scope,'household_period');assert.equal(b.fixed_scope,'arithmetic_mean_seven_household_periods');assert.equal(b.period_count,7);assert.equal(b.aggregation,'arithmetic_mean_seven_unrounded_components');assert.equal(b.fees.periods.length,7);assert.equal(b.fees.periods[0].days[0].day,'2026-10-01');assert.equal(b.fees.periods[6].days[0].day,'2026-10-07');assert.equal(b.fees.periods[6].components.subscription,'1.00000000000000001');assert.equal(b.fixed_cost,'1.00');assert.ok(cells(csv(p)).some(r=>r[1]==='/comparisons/mean7/costs/baseline/fees/periods/6/days/0/day'&&r[3]==='2026-10-07'));
});
