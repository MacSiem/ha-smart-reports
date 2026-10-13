// Smart Reports reviewed export boundary. Pure schema-directed projection;
// never traverse unknown input keys, arbitrary config, profiles or raw errors.
function projectSmartReportV3(report, includePrivate = false) {
  const ids = new Map(), labels = new Map(), zones = new Map();
  const alias = (map, value, prefix) => {
    if (typeof value !== 'string' || !value) return null;
    if (!map.has(value)) map.set(value, `${prefix}-${map.size + 1}`);
    return map.get(value);
  };
  const identity = value => typeof value !== 'string' ? null : includePrivate ? value : alias(ids, value, 'source');
  const label = (value, owner) => typeof value !== 'string' ? null : includePrivate ? value
    : owner?.statistic_id ? identity(owner.statistic_id) : value === 'Grid import' ? value : alias(labels, value, 'label');
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const boolean = value => typeof value === 'boolean' ? value : null;
  const choice = values => value => value == null ? null : values.includes(value) ? value : 'unknown';
  const status = choice(['ready','partial','no_data','idle','loading','not_configured','unsupported','permission_denied','error','invalid','noncomparable','unavailable','unknown']);
  const reason = choice(['request_failed','loading','not_configured','no_data','missing_statistics','missing_rate','missing_currency','energy_data_unavailable',
    'currency_mismatch','partial_cost','unsupported_source','partial_energy','incompatible_energy_metadata','incompatible_currency_metadata',
    'invalid_bucket','outside_requested_window','missing_change','incomplete_coverage','historical_flat_rate_unavailable',
    'tariff_authority_unavailable','tariff_unconfirmed','invalid_profile','invalid_root_sources','nonaligned_window','nonaligned_boundary',
    'invalid_measurement','nonfinite_measurement','missing_measurement','invalid_timestamp','outside_validity','ambiguous_rules','mixed_rate_bucket',
    'nonfinite_cost','invalid_coverage','overlapping_measurement','nonfinite_total','ambiguous_local_cutoff','nonexistent_local_cutoff',
    'unit_mismatch','nonfinite_delta','previous_zero','previous_nonpositive','crosses_local_midnight','nested_parent_missing','invalid_relationship',
    'unsupported','unavailable','unknown','authority_changed','read_failed','timeout','readback_failed']);
  const provenance = choice(['explicit','energy_dashboard','legacy_energy_entity','card_config','shared_backend','complete_comparable_measurements','unavailable','unknown','recorder_available_samples']);
  const method = choice(['cost_statistics','flat_rate_estimate','configured_tariff','unavailable']);
  const unit = value => typeof value === 'string' && (/^[A-Z]{3}$/.test(value) || ['Wh','kWh','MWh','m³','m3','ft³','gal','L','l','W','kW','h','%'].includes(value)) ? value : value == null ? null : 'unknown';
  const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
  const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) ? value : null;
  const timezone = value => { if (typeof value !== 'string') return null; try { new Intl.DateTimeFormat('en', {timeZone:value}); return value; } catch { return null; } };
  const zone = value => alias(zones,value,'zone'); // profile identifiers are never an opt-in field
  const fields = (names, type) => Object.fromEntries(names.split(' ').map(name => [name,type]));
  const local = fields('year month day hour minute second',number);
  const period = {key:choice(['1d','7d','30d']),start:stamp,end:stamp,time_zone:timezone,actual_hours:number,local_start:local,local_cutoff:local};
  const interval = {from:stamp,to:stamp,reason};
  const coverage = { ...fields('observed_hours expected_hours observed_source_hours expected_source_hours',number),first_sample:stamp,last_sample:stamp,complete:boolean,measured_subset:boolean,unmeasured_intervals:[interval] };
  const source = {statistic_id:identity,label,role:choice(['total','cost','device','priced_energy']),value:number,recorded_value:number,coverage,unit,status,provenance,included_in_stat:identity,reason};
  const total = {label,status,value:number,unit,source_statistic_ids:[identity]};
  const subtotal = {value:number,unit,status,...fields('sources_with_data complete_sources configured_sources',number),source_statistic_ids:[identity]};
  const day = {start:stamp,end:stamp,value:number,recorded_value:number,unit,status,observed_source_hours:number,expected_source_hours:number};
  const measuredBySource = (value, owner) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    // Dynamic map keys are restricted to this record's explicit source IDs.
    return Object.fromEntries((Array.isArray(owner?.source_statistic_ids) ? owner.source_statistic_ids : [])
      .filter(id => typeof id === 'string' && Object.hasOwn(value,id)).map(id => [identity(id),number(value[id])]));
  };
  const record = { ...source, side:choice(['current','previous']),day_index:number,day_allocation_reason:reason,local_date:date,from:stamp,to:stamp,
    source_statistic_ids:[identity],source_kwh:measuredBySource,available:boolean,measurement_available:boolean,zone,zones:[zone],
    ...fields('kwh energyRate variableRate energyCost variableCost usageCost',number),currency:unit,price_basis:choice(['gross','net']),revision:number };
  const tariffDay = {from:stamp,to:stamp,...fields('kwh energyCost recorded_kwh recorded_energy_cost expected_hours measured_hours observed_hours',number),
    measurement_available:boolean,available:boolean,status,records:[record]};
  const tariff = {records:[record],daily:[tariffDay],coverage,revision:number,provenance,currency:unit,price_basis:choice(['gross','net']),
    tariff_timezone:timezone,tariff_clock:{mode:choice(['civil','fixed']),offsetMinutes:number},
    ...fields('fixed_monthly variable_cost usage_cost measured_energy_cost measured_kwh',number),current_profile_validity:{available:boolean,reason,checked_at:stamp}};
  const cost = { ...tariff,value:number,currency:unit,method,rate:number,source_statistic_ids:[identity],reason };
  const warning = value => {
    const prefix = 'included_in_stat is only valid for device sources: ';
    if (typeof value === 'string' && value.startsWith(prefix)) return prefix + identity(value.slice(prefix.length));
    return choice(['nested_parent_missing','invalid_relationship'])(value);
  };
  const snapshotDay = {index:number,start:stamp,end:stamp,energy:day,cost:day};
  const snapshot = {period,source_mode:choice(['explicit','energy_dashboard']),status,total,cost,recorded_total:subtotal,recorded_cost:subtotal,
    total_sources:[source],cost_sources:[source],devices:[source],warnings:[warning],daily:[snapshotDay],records:[record],
    coverage:fields('missing_energy_days missing_cost_days observed_energy_source_hours expected_energy_source_hours observed_cost_source_hours expected_cost_source_hours',number)};
  const metric = {...fields('current previous delta percent',number),unit,comparable:boolean,reason,provenance};
  const metadata = {has_sum:boolean,unit_class:choice(['energy','currency']),name:label};
  const scope = {statistic_id:identity,role:source.role,unit,provenance,included_in_stat:identity,energy_statistic_ids:[identity],
    metadata:(value,owner)=>value && typeof value === 'object' ? {has_sum:boolean(value.has_sum),unit_class:metadata.unit_class(value.unit_class),name:label(value.name,owner)} : null};
  const comparison = {status,reason,shift_days:number,requested_local_start:local,requested_local_cutoff:local,scope:[scope],current:snapshot,previous:snapshot,
    metrics:{energy:metric,cost:metric},daily:[{index:number,current:snapshotDay,previous:snapshotDay}],records:[record]};
  const schema = {schema_version:number,generated_at:stamp,period,source_mode:snapshot.source_mode,comparison,
    energy:{status,total,cost,tariff,recorded_total:subtotal,recorded_cost:subtotal,daily:[day],total_sources:[source],cost_sources:[source],devices:[source],warnings:[warning]}};
  function project(value, shape, owner) {
    if (value == null) return null;
    if (typeof shape === 'function') return shape(value,owner);
    if (Array.isArray(shape)) return Array.isArray(value) ? value.map(item => project(item,shape[0],item)) : [];
    if (typeof value !== 'object' || Array.isArray(value)) return null;
    const output = {};
    // Only the reviewed schema can introduce keys. No rest/spread of raw objects.
    for (const [key,type] of Object.entries(shape)) if (Object.hasOwn(value,key) && value[key] !== undefined) output[key]=project(value[key],type,value);
    return output;
  }
  return project(report,schema);
}
// Node tests use the canonical factory; this line is excluded from runtime copies.
if (typeof module !== 'undefined' && module.exports) module.exports = { projectSmartReportV3 };
