'use strict';
// Pure, local reviewed export. Call only with the already validated calendar DTO.
// CSV accepts this factory's immutable projection, never an arbitrary raw object.
const smartCalendarCsvRowsV53 = new WeakMap();
function projectSmartCalendarV53(snapshot, {includePrivate = false} = {}) {
  if (!snapshot || snapshot.schema !== 2 || !['day','week','month','year'].includes(snapshot.period?.kind)) {
    throw new TypeError('Expected validated calendar schema2 snapshot');
  }
  const maps = new Map();
  const identity = kind => value => {
    if (typeof value !== 'string' || !value) return null;
    if (includePrivate === true) return value;
    if (!maps.has(kind)) maps.set(kind,new Map());
    const map = maps.get(kind);
    if (!map.has(value)) map.set(value,`${kind}-${map.size + 1}`);
    return map.get(value);
  };
  const source = identity('source'), area = identity('area'), floor = identity('floor');
  const zone = identity('zone'), version = identity('version'), tariff = identity('tariff');
  const label = identity('label');
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const bool = v => typeof v === 'boolean' ? v : null;
  // Do not coerce Decimal strings through Number: retain precision and exponent.
  const amount = v => typeof v === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) ? v : num(v);
  const choice = values => v => values.includes(v) ? v : v == null ? null : 'unknown';
  const timestamp = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
  const date = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v ? v : null;
  const tz = v => { if(typeof v !== 'string') return null; try {new Intl.DateTimeFormat('en',{timeZone:v});return v;} catch {return null;} };
  const currency = v => typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : null;
  const fields = (keys, type) => Object.fromEntries(keys.split(' ').map(k=>[k,type]));
  const status = choice(['ready','partial','unknown','unavailable','not_configured','no_data','noncomparable','invalid','error']);
  const reason = choice(['incomplete_period','incomplete_coverage','incomplete_household_measurements','incomplete_classification','no_recorded_hours','zero_total_kwh','tariff_unavailable','classification_unavailable','measurement_timezone_unavailable','currency_or_basis_mismatch','missing_statistics','missing_rate','missing_currency','partial_cost','previous_zero','previous_nonpositive','no_data','not_configured','unsupported','unavailable','noncomparable','invalid_measurement','outside_validity','incomplete_measurements','unknown']);
  const basis = choice(['gross','net']);
  const scope = choice(['calendar_totals','common_measurements','per_group_calendar_totals','complete_household_hours','household_period_only','grid_import_recorded_cost']);
  const costFields = fields('energy_cost variable_cost legacy_combined_cost usage_cost fixed_cost total_cost effective_price',amount);
  const known = fields('energy_cost variable_cost legacy_combined_cost usage_cost',amount);
  const components = fields('subscription capacity distribution other legacy_combined',amount);
  const rounding = {quantum:amount,mode:choice(['ROUND_HALF_UP','partition_components_largest_remainder']),stage:choice(['component_period_totals_then_sum']),row_costs:choice(['unrounded_decimal']),partial_day:choice(['overlap_seconds/actual_local_day_seconds'])};
  const coverage = {...fields('ratio expected_source_seconds measured_source_seconds observed_hours expected_hours expected_source_hours measured_source_hours current baseline common_current common_baseline expected_current_seconds expected_baseline_seconds measured_current_seconds measured_baseline_seconds common_group_seconds common_source_seconds',num),complete:bool};
  // Two explicitly supported shapes for group-comparison coverage.
  const comparisonCoverage = {...coverage,baselines:[coverage],current:v=>typeof v==='number'?num(v):project(v,coverage),baseline:v=>typeof v==='number'?num(v):project(v,coverage)};
  const period = {status,reason,kind:choice(['day','week','month','year']),...fields('start end local_start local_end calendar_end calendar_local_end',timestamp),...fields('start_fold end_fold hours calendar_hours',num),timezone:tz,...fields('partial recorder_hour_aligned calendar_clamped',bool),clamps:[choice(['future','recorder','current_time','calendar_end','unknown'])]};
  const periodFees = {components,known_components:components,complete:bool,days:[{day:date,version_id:version,day_fraction:amount}]};
  const fees = {...periodFees,periods:[periodFees]};
  const costs = {...costFields,known_costs:known,currency,price_basis:basis,...fields('measurement_complete pricing_complete components_complete compatible comparable',bool),mask_source_seconds:num,priced_source_seconds:fields('energy_cost variable_cost legacy_combined_cost usage_cost',num),fixed_scope:choice(['household_period','arithmetic_mean_seven_household_periods']),period_count:num,aggregation:choice(['arithmetic_mean_seven_unrounded_components']),fees,rounding,rate_semantics:[choice(['components','legacy_combined'])],issues:[reason]};
  const totals = {...costs,...fields('kwh recorded_household_kwh',amount)};
  const zoneRow = {...costFields,known_costs:known,tariff_id:tariff,version_id:version,zone_id:zone,label,...fields('kwh recorded_kwh',amount),measured_seconds:num,complete:bool};
  const zoneBreakdown = {status,reason,scope,fixed_fee_scope:scope,currency,price_basis:basis,reconciles_recorded_kwh:bool,reconciles_known_costs:bool,zones:[zoneRow],unattributed:{recorded_kwh:amount,measured_seconds:num,missing_seconds:num,known_costs:known,reasons:[reason]}};
  const bin = {...costs,...fields('from to fold end_fold expected_seconds measured_seconds',num),...fields('start end local_start local_end',timestamp),...fields('kwh recorded_kwh',amount),complete:bool,zone_breakdown:zoneBreakdown};
  const chart = {status,reason,timezone:tz,grain:choice(['hour','day','month']),fixed_fee_scope:scope,coverage_kind:choice(['complete_household_hours']),bins:[bin]};
  const group = {...costs,...fields('kwh recorded_kwh measured_kwh',amount),measurement_complete:bool,coverage,name:label,statistic_id:source,device_id:source,area_id:area,area_name:label,floor_id:floor,floor_name:label,parent_id:source,included_in:source,included_in_stat:source,attribution:choice(['measured','nested','unassigned','unmeasured'])};
  const mapOf = (key,shape) => ({mapKey:key,mapShape:shape});
  const groupsMeta = {revision:num,registry_revision:num,captured_at:timestamp,membership_as_of:timestamp,membership_mode:choice(['current_snapshot']),floor_supported:bool,energy_domain:choice(['grid_import']),partition_complete:bool,currency,price_basis:basis,issues:[reason],rounding,domain_provenance:choice(['ha_energy_grid_only_configuration']),reconciles_household_delta:bool,reconciles_household_cost_delta:bool,attribution_label:choice(['current_registry_assignments'])};
  const groups = {...groupsMeta,devices:mapOf(source,group),areas:mapOf(area,group),floors:mapOf(floor,group),unassigned:group,unmeasured:group};
  const clock = {mode:choice(['civil','fixed']),offsetMinutes:num};
  const time = v => typeof v==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
  const seasonDate = v => typeof v==='string' && /^\d\d-\d\d$/.test(v) ? v : null;
  const rule = {zone,weekdays:[num],dates:[date],season:{from:seasonDate,to:seasonDate},intervals:[{from:time,to:time}],priority:num};
  const rate = {zone_usage_rates:[{zone_id:zone,usage_rate:amount}],version_id:version,valid_from:date,valid_to:date,validity_clock:choice(['civil','fixed']),rate_semantics:choice(['components','legacy_combined']),currency,price_basis:basis,fixed_monthly:components,legacy_combined_monthly:amount,clock,profile:{schema:num,currency,timezone:tz,priceBasis:basis,defaultZone:zone,clock,zones:[{id:zone,label,energyRate:amount,variableRate:amount,classification:choice(['cheap','expensive'])}],rules:[rule],exceptions:[rule],dynamic:{intervals:[{from:timestamp,to:timestamp,energyRate:amount,variableRate:amount}]}},provenance:choice(['configured_valid_from'])};
  const summary = {zone_breakdown:zoneBreakdown,window:{start:timestamp,end:timestamp,timezone:tz},cheap_zone_share:{status,reason,scope,classification_source:choice(['explicit_tariff_classification']),...fields('known_cheap_kwh classified_kwh total_kwh ratio',amount)},peak_hour:{status,reason,scope,id:v=>typeof v==='string'&&/^\d+:\d+$/.test(v)?v:null,...fields('from to fold end_fold tied_count',num),...fields('start end local_start local_end',timestamp),kwh:amount}};
  const native = {schema:num,source:choice(['ha_energy']),period_cost:{status,amount,recorded_amount:amount,currency,scope,coverage,components_status:choice(['unknown']),fixed_fees_status:choice(['unknown']),reason},current_prices:[{source_id:source,origin:choice(['number_energy_price','entity_energy_price']),price:amount,currency,energy_unit:choice(['kWh']),observed_at:timestamp,historical:bool,status,reason}],provenance:[{energy_source_id:source,cost_statistic_id:source}]};
  const analysis = {generated_at:timestamp,period,coverage,status,pricing_status:status,totals,chart,groups,rates:[rate],fees,rounding,period_summary:summary,native_pricing:native,active_tariff_id:tariff,issues:[reason]};
  const delta = {status,reason,comparison_scope:scope,...fields('current_kwh baseline_kwh own_current_kwh own_baseline_kwh full_current_kwh full_baseline_kwh delta_kwh percent delta_energy_cost delta_variable_cost delta_legacy_combined_cost delta_usage_cost delta_fixed_cost',amount),coverage:comparisonCoverage,costs:{current:costs,baseline:costs,status,reason,comparison_scope:scope,delta_cost:amount,delta_fixed_cost:amount}};
  const instant = v => typeof v==='number'?num(v):timestamp(v);
  const range = {from:instant,to:instant};
  const comparisonChart = {status,reason,grain:chart.grain,timezone:tz,coverage_kind:choice(['selected_household_comparison_mask']),fixed_fee_scope:scope,comparison_scope:scope,reconciles_comparison_energy:bool,baseline_aggregation:choice(['mean7']),baseline_periods:[range],markers:[{status,reason,mapping:choice(['mean7_common_source_frame_intersection','mean7_calendar_frames','common_source_frame_intersection','calendar_frame_bijection']),...fields('current_from current_to baseline_from baseline_to',instant),...fields('current_kwh baseline_kwh',amount),...fields('expected_current_source_seconds selected_current_source_seconds',num),expected_baseline_source_seconds:v=>Array.isArray(v)?v.map(num):num(v),selected_baseline_source_seconds:v=>Array.isArray(v)?v.map(num):num(v),baseline_aggregation:choice(['mean7']),baseline_ranges:[range]}]};
  const comparison = {...delta,chart:comparisonChart,baseline_kind:choice(['previous','same_weekday','mean7','year_ago']),baseline_periods:[period],baseline_analysis:analysis,costs:{current:costs,baseline:costs,status,reason,comparison_scope:scope,metric:choice(['usage_cost','total_cost']),delta_cost:amount,percent:amount,delta_total_cost:amount,rounding},groups:{...groupsMeta,devices:mapOf(source,delta),areas:mapOf(area,delta),floors:mapOf(floor,delta),unassigned:delta,unmeasured:delta}};
  const shape = {...analysis,context:{tariff_revision:num,registry_revision:num,feature_access_revision:num,measurement_timezone:tz,period_kind:period.kind,period_anchor:date,comparison_kind:comparison.baseline_kind},alternatives:[{...totals,tariff_id:tariff,tariff_name:label,timezone:tz,delta_cost:amount,comparison_reason:reason,issues:[reason]}],comparisons:{previous:comparison,same_weekday:comparison,mean7:comparison,year_ago:comparison}};
  function project(value, schema) {
    if (value === null) return null;
    if (typeof schema === 'function') return schema(value);
    if (Array.isArray(schema)) return Array.isArray(value) ? value.map(v=>project(v,schema[0])) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = Object.create(null);
    if (schema.mapKey) {
      for (const key of Object.keys(value).sort()) {
        const item=project(value[key],schema.mapShape);
        if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length===0)continue;
        const id=schema.mapKey(key); if(id!==null) result[id]=item;
      }
    } else {
      for (const key of Object.keys(schema)) if (Object.hasOwn(value,key) && value[key] !== undefined) result[key]=project(value[key],schema[key]);
    }
    return result;
  }
  const output = project(snapshot,shape);
  output.schema_version = 4;
  output.report_kind = 'calendar_energy';
  output.private_fields = includePrivate === true;
  output.export_scope = {policy:'smart-calendar-report-v1',result_state:snapshot.status==='ready' && snapshot.pricing_status==='ready'?'success':'partial',source:'already_read_calendar_snapshot',cost_semantics:'tariff_book_totals_and_separate_native_recorded_cost',fixed_fees:'household_period_only',recalculated:false,truncated:false};
  const rows=[];
  const rowType = path => path[0]==='comparisons' ? 'comparison' : ({totals:'household_total',chart:'chart_fact',groups:'group_fact',rates:'rate_version',fees:'fee_component',period_summary:'period_fact',native_pricing:'native_ha_cost',alternatives:'alternative_tariff',period:'period',coverage:'coverage'})[path[0]] || 'report_metadata';
  // Traverse ONLY newly constructed allowlisted output; no raw DTO flattening.
  // JSON-pointer paths escape IDs and retain array positions; type distinguishes null/0/empty.
  const capture = (value,path=[]) => {
    if(value && typeof value==='object') {
      const keys=Object.keys(value);
      if (!keys.length) rows.push([rowType(path),'/'+path.join('/'),Array.isArray(value)?'empty_array':'empty_object','']);
      for(const key of keys) capture(value[key],[...path,key.replace(/~/g,'~0').replace(/\//g,'~1')]);
      Object.freeze(value);return;
    }
    rows.push([rowType(path),'/'+path.join('/'),value===null?'null':typeof value,value===null?'':String(value)]);
  };
  capture(output);
  smartCalendarCsvRowsV53.set(output,rows);
  return output;
}
function calendarReportCsvV53(projected) {
  const rows=smartCalendarCsvRowsV53.get(projected);
  if(!rows) throw new TypeError('CSV requires a projection returned by projectSmartCalendarV53');
  const cell = value => {
    let text=String(value);
    // Quote every cell and neutralize formula prefixes even after whitespace/control chars.
    if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return [['row_type','path','value_type','value'],...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
if(typeof module!=='undefined' && module.exports) module.exports={projectSmartCalendarV53,calendarReportCsvV53};
