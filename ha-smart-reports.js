/**
 * Home Assistant Smart Reports Card
 * Recorder-backed energy reports, automation statistics, and system overview.
 * Version: 4.2.0
 */

(function registerHASmartReports() {
  'use strict';

  if (customElements.get('ha-smart-reports')) return;

  // BEGIN mirror shared/ha-tools-energy-tariff.js

// Canonical, side-effect-free tariff model. Consumers vendor this factory inside
// their own scope. Rates are user settings, never a country's assumed defaults.
function createEnergyTariffV3(input) {
  const errors = [];
  const fail = (path, reason) => errors.push({ path, reason });
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const dateKey = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
    const stamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
  };
  const monthDay = value => typeof value === 'string' && /^\d{2}-\d{2}$/.test(value) && dateKey('2000-' + value);
  const timestamp = value => {
    let stamp;
    if (finite(value)) stamp = Math.trunc(value);
    else {
      // One shared calendar/offset contract; Date.parse alone normalizes Feb 30
      // and 24:00, unlike the server. Milliseconds truncate in both consumers.
      const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
      if (!match || !dateKey(match[1])) return NaN;
      stamp = Date.parse(value);
    }
    return finite(stamp) && stamp >= -62135596800000 && stamp <= 253402300799999 ? stamp : NaN;
  };
  const minutes = (value, end = false) => {
    if (end && value === '24:00') return 1440;
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  };
  const p = record(input) ? input : {};
  if (!record(input)) fail('profile', 'invalid_profile');
  if (p.schema !== 1) fail('schema', 'unsupported_schema');
  if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) fail('currency', 'invalid_currency');
  if (!['gross', 'net'].includes(p.priceBasis)) fail('priceBasis', 'invalid_price_basis');
  let formatter;
  try {
    if (typeof p.timezone !== 'string' || !p.timezone) throw new Error('timezone');
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: p.timezone,
      calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch (_) { fail('timezone', 'invalid_timezone'); }
  const clock = record(p.clock) ? { ...p.clock } : {};
  if (!['civil', 'fixed'].includes(clock.mode)) fail('clock.mode', 'invalid_clock');
  if (clock.mode === 'fixed' && (!Number.isInteger(clock.offsetMinutes) || clock.offsetMinutes < -840 || clock.offsetMinutes > 840))
    fail('clock.offsetMinutes', 'invalid_offset');
  for (const key of ['validFrom', 'validTo']) if (p[key] != null && !dateKey(p[key])) fail(key, 'invalid_date');
  if (dateKey(p.validFrom) && dateKey(p.validTo) && p.validFrom > p.validTo) fail('validTo', 'reversed_validity');
  if (p.fixedMonthly != null && (!finite(p.fixedMonthly) || p.fixedMonthly < 0)) fail('fixedMonthly', 'invalid_fee');
  const energyRate = (value, path) => {
    if (!finite(value) || (value < 0 && p.allowNegativeEnergy !== true)) fail(path, 'invalid_rate');
    return value;
  };
  const variableRate = (value, path) => {
    if (value == null) return null;
    if (!finite(value) || value < 0) fail(path, 'invalid_fee');
    return value;
  };
  const zones = new Map();
  if (!Array.isArray(p.zones) || !p.zones.length || p.zones.length > 32) fail('zones', 'invalid_zones');
  for (const [i, z] of (Array.isArray(p.zones) ? p.zones : []).entries()) {
    const path = `zones.${i}`;
    if (!record(z) || typeof z.id !== 'string' || !/^[\w-]{1,64}$/.test(z.id) || zones.has(z.id)) {
      fail(path, 'invalid_zone'); continue;
    }
    zones.set(z.id, { zone: z.id, label: typeof z.label === 'string' ? z.label : z.id,
      energyRate: energyRate(z.energyRate, path + '.energyRate'), variableRate: variableRate(z.variableRate, path + '.variableRate') });
  }
  const defaultZone = p.defaultZone == null ? null : p.defaultZone;
  if (defaultZone !== null && !zones.has(defaultZone)) fail('defaultZone', 'unknown_zone');
  const parseRules = (value, kind) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 512) { fail(kind, 'invalid_rules'); return []; }
    return value.map((r, i) => {
      const path = `${kind}.${i}`;
      if (!record(r)) { fail(path, 'invalid_rule'); return null; }
      if (!zones.has(r.zone)) fail(path + '.zone', 'unknown_zone');
      const priority = r.priority == null ? 0 : r.priority;
      if (!Number.isInteger(priority) || Math.abs(priority) > 10000) fail(path + '.priority', 'invalid_priority');
      let weekdays = null, dates = null, season = null;
      if (r.weekdays != null) {
        if (!Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) fail(path + '.weekdays', 'invalid_weekdays');
        else weekdays = new Set(r.weekdays);
      }
      if (r.dates != null || kind === 'exceptions') {
        if (!Array.isArray(r.dates) || !r.dates.length || r.dates.length > 3660 || r.dates.some(d => !dateKey(d))) fail(path + '.dates', 'invalid_dates');
        else dates = new Set(r.dates);
      }
      if (r.season != null) {
        if (!record(r.season) || !monthDay(r.season.from) || !monthDay(r.season.to)) fail(path + '.season', 'invalid_season');
        else season = { from: r.season.from, to: r.season.to };
      }
      const intervals = [];
      if (!Array.isArray(r.intervals) || !r.intervals.length || r.intervals.length > 48) fail(path + '.intervals', 'invalid_intervals');
      else for (const [j, interval] of r.intervals.entries()) {
        const from = minutes(interval?.from), to = minutes(interval?.to, true);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) fail(`${path}.intervals.${j}`, 'invalid_interval');
        else intervals.push({ from, to });
      }
      return { zone: r.zone, priority, weekdays, dates, season, intervals };
    }).filter(Boolean);
  };
  const rules = parseRules(p.rules, 'rules'), exceptions = parseRules(p.exceptions, 'exceptions');
  let dynamic = null;
  if (p.dynamic != null) {
    if (!record(p.dynamic) || !Array.isArray(p.dynamic.intervals) || p.dynamic.intervals.length > 10000) fail('dynamic', 'invalid_dynamic');
    else {
      dynamic = p.dynamic.intervals.map((r, i) => {
        const from = timestamp(r?.from), to = timestamp(r?.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) fail(`dynamic.intervals.${i}`, 'invalid_interval');
        return { from, to, zone: 'dynamic', label: 'Dynamic',
          energyRate: energyRate(r?.energyRate, `dynamic.intervals.${i}.energyRate`),
          variableRate: variableRate(r?.variableRate, `dynamic.intervals.${i}.variableRate`) };
      }).sort((a, b) => a.from - b.from);
      for (let i = 1; i < dynamic.length; i++) if (dynamic[i].from < dynamic[i - 1].to) fail('dynamic', 'overlapping_prices');
    }
  }
  const valid = errors.length === 0;
  const unavailable = reason => ({ available: false, reason });
  const localParts = stamp => {
    if (clock.mode === 'fixed') {
      const d = new Date(stamp + clock.offsetMinutes * 60000);
      return { date: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
    }
    const values = Object.fromEntries(formatter.formatToParts(stamp).filter(v => v.type !== 'literal').map(v => [v.type, v.value]));
    return { date: `${values.year}-${values.month}-${values.day}`, minute: Number(values.hour) * 60 + Number(values.minute) };
  };
  const matchesDay = (rule, day) => {
    if (rule.dates && !rule.dates.has(day)) return false;
    if (rule.weekdays && !rule.weekdays.has(new Date(day + 'T00:00:00Z').getUTCDay())) return false;
    const mmdd = day.slice(5), s = rule.season;
    return !s || (s.from <= s.to ? mmdd >= s.from && mmdd <= s.to : mmdd >= s.from || mmdd <= s.to);
  };
  const matches = (rule, day, minute) => rule.intervals.some(interval => {
    if (interval.from < interval.to) return minute >= interval.from && minute < interval.to && matchesDay(rule, day);
    if (minute >= interval.from) return matchesDay(rule, day);
    if (minute < interval.to) {
      const previousDay = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
      return matchesDay(rule, previousDay);
    }
    return false;
  });
  const rateAt = instant => {
    if (!valid) return unavailable('invalid_profile');
    const stamp = timestamp(instant);
    if (!Number.isFinite(stamp)) return unavailable('invalid_timestamp');
    const local = localParts(stamp);
    if ((p.validFrom && local.date < p.validFrom) || (p.validTo && local.date > p.validTo)) return unavailable('outside_validity');
    if (dynamic) {
      // Price periods use absolute timestamps, so repeated DST hours are distinct.
      let low = 0, high = dynamic.length;
      while (low < high) { const mid = (low + high) >>> 1; if (dynamic[mid].from <= stamp) low = mid + 1; else high = mid; }
      const price = dynamic[low - 1];
      return price && stamp < price.to ? { available: true, ...price, date: local.date } : unavailable('missing_rate');
    }
    const special = exceptions.filter(r => matches(r, local.date, local.minute));
    const candidates = special.length ? special : rules.filter(r => matches(r, local.date, local.minute));
    let zone = defaultZone;
    if (candidates.length) {
      const priority = Math.max(...candidates.map(r => r.priority));
      const ids = new Set(candidates.filter(r => r.priority === priority).map(r => r.zone));
      if (ids.size !== 1) return unavailable('ambiguous_rules');
      zone = [...ids][0];
    }
    return zones.has(zone) ? { available: true, ...zones.get(zone), date: local.date } : unavailable('missing_rate');
  };
  const samePrice = (a, b) => a.available && b.available && a.energyRate === b.energyRate && a.variableRate === b.variableRate;
  const priceBucket = row => {
    const from = timestamp(row?.from), to = timestamp(row?.to), kwh = row?.kwh;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 86400000 || !finite(kwh) || kwh < 0)
      return { available: false, reason: 'invalid_measurement', from, to };
    const first = rateAt(from);
    if (!first.available) return { ...first, from, to };
    // Never apportion an aggregate measurement across different prices. Every
    // minute boundary and every dynamic boundary is checked, including the end.
    const checkpoints = new Set([to - 1]);
    for (let t = (Math.floor(from / 60000) + 1) * 60000; t < to; t += 60000) checkpoints.add(t);
    if (dynamic) for (const price of dynamic) for (const t of [price.from, price.to]) if (t > from && t < to) checkpoints.add(t);
    const zoneIds = new Set([first.zone]);
    for (const stamp of checkpoints) {
      const next = rateAt(stamp);
      if (!next.available) return { ...next, from, to };
      if (!samePrice(first, next)) return { available: false, reason: 'mixed_rate_bucket', from, to };
      zoneIds.add(next.zone);
    }
    const energyCost = kwh * first.energyRate, variableCost = first.variableRate === null ? null : kwh * first.variableRate;
    const usageCost = variableCost === null ? null : energyCost + variableCost;
    if (![energyCost, variableCost, usageCost].every(v => v === null || finite(v)))
      return { available: false, reason: 'nonfinite_cost', from, to };
    const ids = [...zoneIds].sort();
    return { available: true, from, to, kwh, zone: ids.length === 1 ? ids[0] : null,
      zones: ids, zoneAttribution: ids.length === 1 ? 'single' : 'multiple', energyRate: first.energyRate,
      variableRate: first.variableRate, energyCost, variableCost, usageCost };
  };
  const priceBuckets = (rows, coverage) => {
    const issues = [], priced = [];
    if (!valid) issues.push({ reason: 'invalid_profile' });
    if (!Array.isArray(rows) || !rows.length) issues.push({ reason: 'no_data' });
    for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
      const result = priceBucket(row); priced.push({ index, ...result });
      if (!result.available) issues.push({ index, reason: result.reason });
    }
    const ordered = [...priced].sort((a, b) => a.from - b.from);
    for (let i = 1; i < ordered.length; i++) if (ordered[i].from < ordered[i - 1].to) issues.push({ index: ordered[i].index, reason: 'overlapping_measurement' });
    if (coverage != null) {
      const from = timestamp(coverage.from), to = timestamp(coverage.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) issues.push({ reason: 'invalid_coverage' });
      else if (!ordered.length || ordered[0].from !== from || ordered.at(-1).to !== to || ordered.some((r, i) => i && r.from !== ordered[i - 1].to))
        issues.push({ reason: 'missing_measurement' });
    }
    let complete = !issues.length;
    let kwh = complete ? priced.reduce((sum, r) => sum + r.kwh, 0) : null;
    let energyCost = complete ? priced.reduce((sum, r) => sum + r.energyCost, 0) : null;
    let variableCost = complete && priced.every(r => r.variableCost !== null) ? priced.reduce((sum, r) => sum + r.variableCost, 0) : null;
    let usageCost = energyCost !== null && variableCost !== null ? energyCost + variableCost : null;
    if (complete && ![kwh, energyCost, variableCost, usageCost].every(v => v === null || finite(v))) {
      issues.push({ reason: 'nonfinite_total' }); complete = false;
      kwh = energyCost = variableCost = usageCost = null;
    }
    return { complete, issues, rows: priced, kwh, energyCost, variableCost, usageCost,
      currency: p.currency ?? null, priceBasis: p.priceBasis ?? null, timezone: p.timezone ?? null,
      clock: { ...clock }, fixedMonthly: valid && finite(p.fixedMonthly) ? p.fixedMonthly : null };
  };
  return { valid, errors, rateAt, priceBuckets };
}

function energyTariffProfileV3(config, haConfig, kind) {
  const c = config || {}, h = haConfig || {};
  if (Object.hasOwn(c, 'tariff_profile')) return c.tariff_profile;
  const isOptimizer = kind === 'optimizer';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  // Older Optimizer YAML accepted decimal strings. Preserve those explicit
  // prices, while refusing empty strings, booleans and automatic sample rates.
  const optimizerNumber = value => number(value) ?? (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
  const mode = c.energy_tariff_mode || (isOptimizer && c.off_peak_rate != null ? 'day_night' : 'flat');
  const start = c.energy_day_hour_start ?? c.peak_hours?.start ?? 6;
  const end = c.energy_night_hour_start ?? c.peak_hours?.end ?? 22;
  const clockTime = value => Number.isInteger(value) && value >= 0 && value <= 24 ? `${String(value).padStart(2, '0')}:00` : 'invalid';
  // Legacy weekday/weekend classification used the current calendar day, even
  // after midnight. Custom overnight rules intentionally use the start day.
  const day = start === end ? [{ from: '00:00', to: '24:00' }] :
    Number.isInteger(start) && Number.isInteger(end) && start > end && start <= 24 && end >= 0 ?
      [...(start < 24 ? [{ from: clockTime(start), to: '24:00' }] : []),
        ...(end > 0 ? [{ from: '00:00', to: clockTime(end) }] : [])] :
      [{ from: clockTime(start), to: clockTime(end) }];
  const zone = (id, energyRate) => ({ id, label: id, energyRate, variableRate: null });
  const profile = { schema: 1, name: 'Configured tariff', currency: c.currency || h.currency || '',
    timezone: h.time_zone || '', clock: { mode: 'civil' }, priceBasis: c.energy_price_basis || 'gross',
    fixedMonthly: null, defaultZone: 'flat', zones: [], rules: [] };
  if (mode === 'flat') profile.zones = [zone('flat', isOptimizer ? optimizerNumber(c.peak_rate ?? c.energy_price) : number(c.energy_price))];
  else if (mode === 'day_night') {
    profile.zones = [zone('day', isOptimizer ? optimizerNumber(c.peak_rate ?? c.energy_price) : number(c.energy_price_day)),
      zone('night', isOptimizer ? optimizerNumber(c.off_peak_rate) : number(c.energy_price_night))];
    profile.defaultZone = 'night'; profile.rules = [{ zone: 'day', intervals: day }];
  } else if (mode === 'weekday_weekend') {
    profile.zones = [zone('weekday', number(c.energy_price_weekday)), zone('weekend', number(c.energy_price_weekend))];
    profile.defaultZone = 'weekday'; profile.rules = [{ zone: 'weekend', weekdays: [0, 6], intervals: [{ from: '00:00', to: '24:00' }] }];
  } else if (mode === 'mixed') {
    profile.zones = [zone('wd_day', number(c.energy_price_wd_day)), zone('wd_night', number(c.energy_price_wd_night)),
      zone('we_day', number(c.energy_price_we_day)), zone('we_night', number(c.energy_price_we_night))];
    profile.defaultZone = 'wd_night'; profile.rules = [
      { zone: 'wd_day', weekdays: [1, 2, 3, 4, 5], intervals: day },
      { zone: 'we_night', weekdays: [0, 6], intervals: [{ from: '00:00', to: '24:00' }] },
      { zone: 'we_day', weekdays: [0, 6], priority: 1, intervals: day }];
  } else profile.schema = 0;
  return profile;
}

  // END mirror shared/ha-tools-energy-tariff.js

  // BEGIN HA TOOLS UI V3 source-sha256=54ed3b533163c3b9b704f107fa1697f95476d35ab55ba99265718aea85ec9674
// HA Tools v3: vendored inside each consumer's own closure, never a window API.
function createUiV3({ language = 'en' } = {}) {
  const pl = String(language).startsWith('pl');
  const states = {
    success: ['Success', 'Sukces', '✓'],
    partial: ['Partial', 'Częściowo', '½'],
    unconfirmed: ['Unconfirmed', 'Niepotwierdzony', '?'],
    error: ['Error', 'Błąd', '✕'],
    not_checked: ['Not checked', 'Nie sprawdzono', '–'],
    no_data: ['No data', 'Brak danych', '∅'],
  };
  const status = (value) => {
    const code = typeof value === 'string' && Object.hasOwn(states, value) ? value : 'not_checked';
    const row = states[code];
    return { code, label: row[pl ? 1 : 0], icon: row[2], countsAsSuccess: code === 'success' };
  };
  const statusHtml = (value) => {
    const result = status(value);
    return `<span class="ht-result-state ht-result-state--${result.code}" data-result-state="${result.code}"><span aria-hidden="true">${result.icon}</span> ${result.label}</span>`;
  };
  const parseColor = value => {
    const text = typeof value === 'string' ? value.trim() : '';
    const hex = /^#([a-f0-9]{3}|[a-f0-9]{6})$/i.exec(text);
    if (hex) return (hex[1].length === 3 ? [...hex[1]].map(c=>c+c).join('') : hex[1]).match(/../g).map(c=>parseInt(c,16));
    const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*1(?:\.0+)?)?\s*\)$/i.exec(text);
    return rgb ? rgb.slice(1,4).map(c=>Math.min(255,Math.round(Number(c)))) : null;
  };
  const hexColor = rgb => '#' + rgb.map(c=>c.toString(16).padStart(2,'0')).join('');
  const luminance = rgb => rgb.map(c=>c/255).map(c=>c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4)
    .reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const ratio = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  const primaryColors = (value, {dark = false} = {}) => {
    const original = parseColor(value) || parseColor(dark ? '#818cf8' : '#2563eb');
    const white = [255,255,255], ink = [15,23,42];
    const foreground = ratio(original,white) >= ratio(original,ink) ? white : ink;
    const target = foreground === white ? 0 : 255;
    let fill = original;
    // The nearest 5% step keeps a supplied theme color when it is readable.
    for (let step=1; ratio(fill,foreground)<4.5 && step<=20; step++)
      fill = original.map(c=>Math.round(c+(target-c)*step*.05));
    return {fill:hexColor(fill),foreground:hexColor(foreground),contrast:ratio(fill,foreground)};
  };
  const applyTheme = host => {
    const view = host?.ownerDocument?.defaultView;
    if (!host?.isConnected || !view?.getComputedStyle) return null;
    const raw = view.getComputedStyle(host).getPropertyValue('--primary-color').trim();
    let resolved = raw;
    // Resolve ordinary named colors through the browser without a persistent node.
    if (raw && !parseColor(raw) && !raw.includes('var(') && raw !== 'transparent' && view.CSS?.supports?.('color',raw)) {
      const probe = host.ownerDocument.createElement('span');
      probe.style.display = 'none'; probe.style.color = raw;
      host.append(probe);
      try { resolved = view.getComputedStyle(probe).color; } finally { probe.remove(); }
    }
    const result = primaryColors(resolved,{dark:host.classList.contains('bento-dark') || host.classList.contains('hat-dark')});
    for (const [key,value] of [['--hat-primary-fill-computed',result.fill],['--hat-on-primary-computed',result.foreground]])
      if (host.style.getPropertyValue(key) !== value) host.style.setProperty(key,value);
    return result;
  };
  // v5.3: public tokens stay inheritable; private defaults follow the HA dark flag.
  const css = `
:host, .hat {
  color-scheme: light;
  /* powierzchnie i tekst — z motywu HA, w nawiasie wartość domyślna */
  --_hat-bg:       var(--primary-background-color, #f3f4f6);
  --_hat-card:     var(--ha-card-background, var(--card-background-color, #ffffff));
  --_hat-chip:     var(--secondary-background-color, #f3f4f6);
  --_hat-border:   var(--ha-card-border-color, var(--divider-color, #e5e7eb));
  --_hat-text:     var(--primary-text-color, #111827);
  --_hat-text-2:   var(--secondary-text-color, #4b5563);
  --_hat-text-3:   var(--hat-text-3-theme, #6b7280);   /* tylko na tle karty; ≥ 12 px */
  --_hat-grid:     color-mix(in srgb, var(--hat-text, var(--_hat-text)) 6%, var(--hat-card, var(--_hat-card)));
  --_hat-radius:   var(--ha-card-border-radius, 12px);

  /* Computed values supplied by the host when available; literals are explicit fallback colors, not dynamic contrast. */
  --_hat-primary:      var(--primary-color, #2563eb);
  --_hat-primary-fill: var(--hat-primary-fill-computed, #2563eb);
  --_hat-on-primary:   var(--hat-on-primary-computed, #ffffff);

  /* stany: wypełnienie (≥ 3:1) i tekst (≥ 4,5:1) */
  --_hat-good: #0ca30c;  --_hat-good-text: #15803d;
  --_hat-warn: #fab219;  --_hat-warn-text: #a16207;  --_hat-warn-readout: #9a5b05;
  --_hat-crit: #d03b3b;  --_hat-crit-text: #b91c1c;

  /* serie (W23) */
  --_hat-s1: #2a78d6; --_hat-s2: #eb6834; --_hat-s3: #1baf7a; --_hat-s4: #eda100; --_hat-s5: #e87ba4;
  --_hat-zone-cheap: #1baf7a; --_hat-zone-exp: #2a78d6;
  --_hat-d1: #eb6834; --_hat-d2: #6250d6; --_hat-d3: #e87ba4; --_hat-d4: #eda100;
  --_hat-unmeasured: #9ca3af;

  /* typografia (W16: treść ≥ 14, metadane ≥ 12, wersaliki ≥ 11) */
  --_hat-font: var(--ha-font-family-body, Roboto, Inter, system-ui, sans-serif);
  --_hat-fs-display: 28px;  --_hat-fs-number2: 20px;  --_hat-fs-title: 16px;
  --_hat-fs-body: 14px;     --_hat-fs-meta: 12px;     --_hat-fs-caps: 11px;
  --_hat-fw-regular: 400;   --_hat-fw-medium: 500;    --_hat-fw-bold: 600;

  /* odstępy (siatka 4 px) i rozmiary */
  --_hat-space-1: 4px; --_hat-space-2: 8px; --_hat-space-3: 12px; --_hat-space-4: 16px; --_hat-space-5: 24px;
  --_hat-icon-lg: 36px; --_hat-icon-lg-glyph: 20px;   /* nagłówek, kafelek */
  --_hat-icon-md: 28px; --_hat-icon-md-glyph: 16px;   /* wiersz, launcher */
  --_hat-icon-sm: 24px; --_hat-icon-sm-glyph: 14px;   /* odznaka */
  --_hat-tint: 18%;                                   /* tło ikony = akcent 18 % */
  --_hat-pill-h: 32px;  --_hat-pill-h-mini: 28px;  --_hat-target: 44px;
  --_hat-row-h: 56px;   --_hat-gap: 8px;           /* siatka Sections HA */
  --_hat-motion: 150ms ease;
  font-family: var(--hat-font, var(--_hat-font));
  color: var(--hat-text, var(--_hat-text));
}

/* ---------- 2. Tokeny: ciemny (hass.themes.darkMode → klasa .hat-dark) ---------- */
:host(.hat-dark), :host(.bento-dark), .hat.hat-dark {
  --_hat-bg:     var(--primary-background-color, #111214);
  --_hat-card:   var(--ha-card-background, var(--card-background-color, #1c1c1e));
  --_hat-chip:   var(--secondary-background-color, #26272b);
  --_hat-border: var(--ha-card-border-color, var(--divider-color, #2e2f33));
  --_hat-text:   var(--primary-text-color, #e5e7eb);
  --_hat-text-2: var(--secondary-text-color, #a1a1aa);
  --_hat-text-3: var(--hat-text-3-theme, #8b8b93);
  --_hat-primary-fill: var(--hat-primary-fill-computed, #818cf8);
  --_hat-on-primary:   var(--hat-on-primary-computed, #0f172a);
  --_hat-good: #22c55e;  --_hat-good-text: #22c55e;
  --_hat-warn: #fab219;  --_hat-warn-text: #fab219;  --_hat-warn-readout: #fab219;
  --_hat-crit: #e05252;  --_hat-crit-text: #f87171;
  --_hat-s1: #3987e5; --_hat-s2: #d95926; --_hat-s3: #199e70; --_hat-s4: #c98500; --_hat-s5: #d55181;
  --_hat-zone-cheap: #199e70; --_hat-zone-exp: #3987e5;
  --_hat-d1: #d95926; --_hat-d2: #9085e9; --_hat-d3: #d55181; --_hat-d4: #c98500;
  --_hat-unmeasured: #6b7280;
  color-scheme: dark;
}



.ht-result-state { display:inline-flex;align-items:center;gap:var(--hat-space-1,4px);min-height:24px;padding:0 10px;border:1px solid currentColor;border-radius:999px;font-size:var(--hat-fs-meta,12px);font-weight:600;line-height:16px;white-space:normal;background:transparent; }
.ht-result-state--success { color:var(--hat-good-text, var(--_hat-good-text)); }
.ht-result-state--partial,.ht-result-state--unconfirmed { color:var(--hat-warn-text, var(--_hat-warn-text)); }
.ht-result-state--error { color:var(--hat-crit-text, var(--_hat-crit-text)); }
.ht-result-state--not_checked,.ht-result-state--no_data { color:var(--hat-text-2, var(--_hat-text-2)); }
.ht-result-state--no_data { border-style:dashed; }
`;
  return { status, statusHtml, css, primaryColors, applyTheme };
}
// END HA TOOLS UI V3

  // BEGIN mirror shared/ha-tools-tariff-guard.js
// One wire fence for the card-owned host and settings editor. A public timeout
// is uncertainty, never permission to dispatch another raw operation.
function createTariffGuardV3({ getHass, getContext = () => null, browser = typeof window === 'object' ? window : null, timeoutMs = 15000 }) {
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  let epoch = 0, association, connection, connectionOffline = false, browserOffline = browser?.navigator?.onLine === false;
  let raw = null, suspended = false;
  const listeners = new Set(), wireListeners = new Set();
  const notify = () => { epoch++; for (const listener of [...listeners]) listener(); };
  const connectionEvent = event => {
    if (event.type === 'disconnected' || event.type === 'reconnect-error') connectionOffline = true;
    else if (event.type === 'ready') connectionOffline = false;
    notify();
  };
  const types = ['disconnected', 'ready', 'reconnect-error'];
  const bind = next => {
    if (connection === next) return;
    for (const type of types) connection?.removeEventListener?.(type, connectionEvent);
    connection = next; connectionOffline = next?.connected === false;
    if (!suspended) for (const type of types) connection?.addEventListener?.(type, connectionEvent);
  };
  const browserEvent = event => { browserOffline = event.type === 'offline'; notify(); };
  browser?.addEventListener?.('offline', browserEvent);
  browser?.addEventListener?.('online', browserEvent);
  const read = h => {
    bind(h?.connection);
    return { user: h?.user?.id, admin: h?.user?.is_admin === true, owner: h?.user?.is_owner === true,
      active: h?.user?.is_active !== false, groups: canonical(h?.user?.groups || []), groupIds: canonical(h?.user?.group_ids || []),
      connection: h?.connection, callWS: h?.callWS,
      connected: h?.connection?.connected !== false && !connectionOffline,
      online: !suspended && !browserOffline && browser?.navigator?.onLine !== false,
      haConfig: canonical(h?.config || {}), context: canonical(getContext()) };
  };
  const equal = (a, b) => a && b && Object.keys(b).every(k => a[k] === b[k]);
  const observe = (...prospectiveHass) => {
    const now = read(prospectiveHass.length ? prospectiveHass[0] : getHass()), changed = association && !equal(association, now);
    association = now;
    if (changed) notify();
    return { ...now, epoch };
  };
  const available = a => !!a?.user && a.active && !!a.connection && a.connected && a.online && typeof a.callWS === 'function';
  const snapshot = () => observe();
  const current = (token, admin = false) => {
    const now = observe();
    return token?.epoch === now.epoch && equal(token, Object.fromEntries(Object.entries(now).filter(([k]) => k !== 'epoch'))) && available(now) && (!admin || now.admin);
  };
  const call = (token, payload, admin = false) => {
    if (!current(token, admin)) return Promise.reject({ code: 'authority_changed' });
    if (raw) return Promise.reject({ code: 'wire_occupied' });
    let resolvePublic, rejectPublic, finished = false;
    const result = new Promise((resolve, reject) => { resolvePublic = resolve; rejectPublic = reject; });
    const slot = {}; raw = slot;
    const timer = setTimeout(() => { finished = true; rejectPublic({ code: 'timeout' }); }, timeoutMs);
    let request;
    try { request = Promise.resolve(token.callWS.call(getHass(), payload)); }
    catch (error) { request = Promise.reject(error); }
    // Both branches handle late settlement; no floating rejected finally promise.
    const settled = () => {
      clearTimeout(timer); if (raw === slot) raw = null;
      for (const listener of [...wireListeners]) listener();
    };
    request.then(value => {
      settled();
      if (!finished) { finished = true; current(token, admin) ? resolvePublic(value) : rejectPublic({ code: 'authority_changed' }); }
    }, error => { settled(); if (!finished) { finished = true; rejectPublic(error); } });
    return result;
  };
  const suspend = () => {
    if (suspended) return;
    suspended = true;
    for (const type of types) connection?.removeEventListener?.(type, connectionEvent);
    browser?.removeEventListener?.('offline', browserEvent); browser?.removeEventListener?.('online', browserEvent);
    notify();
  };
  const resume = () => {
    if (!suspended) return;
    suspended = false; browserOffline = browser?.navigator?.onLine === false;
    for (const type of types) connection?.addEventListener?.(type, connectionEvent);
    browser?.addEventListener?.('offline', browserEvent); browser?.addEventListener?.('online', browserEvent);
    notify(); observe();
  };
  const dispose = () => {
    for (const type of types) connection?.removeEventListener?.(type, connectionEvent);
    browser?.removeEventListener?.('offline', browserEvent); browser?.removeEventListener?.('online', browserEvent);
    notify(); listeners.clear(); wireListeners.clear(); // Raw occupancy intentionally survives disposal.
  };
  observe(); // Observe typed edges before the card/editor is ever mounted.
  return { snapshot, observe, current, available, call, occupied: () => raw !== null,
    subscribeWire: listener => { wireListeners.add(listener); return () => wireListeners.delete(listener); },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, invalidate: notify, suspend, resume, dispose };
}
  // END mirror shared/ha-tools-tariff-guard.js

  // BEGIN mirror shared/ha-tools-tariff-settings.js
// Node-only dependency; runtime consumers vendor the guard in their own closure.


// Vendor inside each card's closure. The parent owns state and its mount; no
// global registration, helper services, SMTP configuration or browser storage.
function createTariffSettingsV3({ root, getHass, language = 'en', state, validate, onSaved, onLoaded, onCancel, ui, guard }) {
  if (!root || !state || typeof getHass !== 'function' || typeof validate !== 'function') throw new TypeError('tariff_settings_adapter');
  const translations = new Map();
  const pl = () => String(typeof language === 'function' ? language() : language).startsWith('pl');
  const t = (en, polish) => { translations.set(en, polish); return pl() ? polish : en; };
  const localMessage = () => {
    const message = state.message || '';
    for (const [en, polish] of translations) {
      if (message === en || message === polish) return pl() ? polish : en;
    }
    return message;
  };
  const family = () => typeof ui === 'function' ? ui() : ui;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const canonical = value => JSON.stringify(value, function (_, v) {
    return object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
  });
  const equal = (a, b) => canonical(a) === canonical(b);
  const validProfile = profile => { try { return validate(profile)?.valid === true; } catch (_) { return false; } };
  // The server returns only this bounded marker when persisted validation fails.
  // Its confirmed revision lets an administrator explicitly replace the profile.
  const invalidMarker = profile => object(profile) && profile.schema === 0 && Object.keys(profile).length === 1;
  const statuses = () => ({ success: t('Success', 'Sukces'), partial: t('Partial', 'Częściowo'),
    unconfirmed: t('Unconfirmed', 'Niepotwierdzony'), error: t('Error', 'Błąd'),
    not_checked: t('Not checked', 'Nie sprawdzono'), no_data: t('No data', 'Brak danych') });
  const statusHtml = () => family()?.statusHtml(state.status) || `<span data-result-state="${esc(state.status)}"><span aria-hidden="true">${({ success: '✓', partial: '½', unconfirmed: '?', error: '✕', not_checked: '–', no_data: '∅' })[state.status] || '–'}</span> ${esc(statuses()[state.status] || statuses().not_checked)}</span>`;
  const blank = () => ({ schema: 1, type: 'Custom', name: '', currency: getHass()?.config?.currency || '',
    timezone: getHass()?.config?.time_zone || '', clock: { mode: 'civil' }, priceBasis: 'gross',
    fixedMonthly: null, defaultZone: null, zones: [], rules: [], exceptions: [] });
  const seed = profile => invalidMarker(profile) ? blank() : clone(profile) || blank();
  if (!object(state.draft) || invalidMarker(state.draft)) state.draft = seed(state.profile);
  if (!statuses()[state.status]) state.status = 'not_checked';
  if (invalidMarker(state.profile) && state.status === 'not_checked') state.status = 'error';
  guard ||= createTariffGuardV3({ getHass });
  let operation = 0, association, resumeFocus = null, disposed = false;
  const observe = () => (association = guard.observe());
  const available = a => guard.available(a);
  const ticket = () => ({ ...observe(), operation: ++operation });
  const current = (token, admin = false) => token.operation === operation && guard.current(token, admin);
  const call = (token, payload, admin = false) => current(token, admin)
    ? guard.call(token, payload, admin) : Promise.reject({ code: 'authority_changed' });
  const unsubscribe = guard.subscribe(() => {
    if (disposed) return;
    operation++; resumeFocus = null;
    state.profile = null; state.revision = null; state.updated_at = null;
    state.draft = blank(); state._draftBaseline = clone(state.draft);
    state.feedText = undefined; state.feedError = null; state.backendAvailable = false;
    state.busy = false; state.status = 'unconfirmed'; state.message = '';
    // This mount may already have been detached; erase it too, synchronously.
    root.replaceChildren();
  });
  const unsubscribeWire = guard.subscribeWire(() => { if (!disposed && root.isConnected && available(guard.observe())) render(); });
  const envelope = value => object(value) && Object.hasOwn(value, 'profile') &&
    (value.profile === null || invalidMarker(value.profile) || (object(value.profile) && validProfile(value.profile))) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    Object.hasOwn(value, 'updated_at') && (value.updated_at === null ||
      (typeof value.updated_at === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.updated_at) && Number.isFinite(Date.parse(value.updated_at))));
  const message = (status, text) => { state.status = status; state.message = text; };
  const unknown = () => { state.writeUnconfirmed = true; message('unconfirmed', t('Saving was not confirmed. Check the stored tariff before retrying. Your draft is preserved.',
    'Nie potwierdzono zapisu. Sprawdź zapisaną taryfę przed ponowieniem. Szkic został zachowany.')); };
  const load = async () => {
    if (disposed || state.busy || guard.occupied()) return;
    const token = ticket();
    if (!available(token)) { message('error', t('Tariff backend unavailable.', 'Backend taryf jest niedostępny.')); render(); return; }
    const pristine = equal(state.draft, seed(state.profile)), draft = clone(state.draft);
    state.busy = true; state.message = t('Loading stored tariff…', 'Wczytywanie zapisanej taryfy…'); render();
    try {
      const result = await call(token, { type: 'ha_tools_email/get_tariff' });
      if (!current(token)) return;
      if (!envelope(result)) throw { code: 'malformed' };
      state.profile = clone(result.profile); state.revision = result.revision; state.updated_at = result.updated_at;
      state.backendAvailable = true; state.writeUnconfirmed = false;
      state.draft = pristine ? seed(result.profile) : draft;
      if (pristine) { state.feedText = undefined; state.feedError = null; }
      if (invalidMarker(result.profile)) message('error', t('The stored tariff is invalid. Review and save a replacement; costs stay unavailable until a valid profile is confirmed.',
        'Zapisana taryfa jest niepoprawna. Sprawdź i zapisz nowy profil; koszty pozostają niedostępne do potwierdzenia poprawnej taryfy.'));
      else message(result.profile ? 'not_checked' : 'no_data', t('Stored tariff loaded. Review the fields before saving.', 'Wczytano taryfę. Sprawdź pola przed zapisem.'));
      if (current(token) && typeof onLoaded === 'function') onLoaded(clone(result));
    } catch (_) {
      if (current(token)) { state.backendAvailable = false; message('error', t('Tariff backend unavailable or response invalid. Draft preserved.', 'Backend taryf jest niedostępny lub odpowiedź jest błędna. Zachowano szkic.')); }
    } finally { if (current(token)) { state.busy = false; render(); } }
  };
  const save = async () => {
    if (disposed || state.busy || guard.occupied()) return;
    const token = ticket();
    if (!available(token) || !token.admin || state.writeUnconfirmed || state.backendAvailable === false || !Number.isSafeInteger(state.revision)) {
      message('error', t('Admin access and a loaded tariff backend are required.', 'Wymagane uprawnienia administratora i wczytany backend taryf.')); render(); return;
    }
    if (state.feedError) { message('error', state.feedError); render(); return; }
    const proposed = clone(state.draft);
    let result;
    try { result = validate(proposed); } catch (_) { result = { valid: false }; }
    if (!result?.valid) {
      message('error', t('Invalid tariff. Check the marked paths: ', 'Niepoprawna taryfa. Sprawdź wskazane pola: ') +
        (result?.errors || []).map(e => `${e.path}: ${e.reason}`).join('; ')); render(); return;
    }
    const previousRevision = state.revision;
    state.busy = true; message('not_checked', t('Saving; waiting for stored readback…', 'Zapis; oczekiwanie na odczyt zapisanego profilu…')); render();
    try {
      const written = await call(token, { type: 'ha_tools_email/set_tariff', profile: proposed, expected_revision: previousRevision }, true);
      if (!current(token, true)) return;
      if (!object(written) || !Number.isSafeInteger(written.revision) || written.revision !== previousRevision + 1) { unknown(); return; }
      const stored = await call(token, { type: 'ha_tools_email/get_tariff' }, true);
      if (!current(token, true)) return;
      if (!envelope(stored) || stored.updated_at === null || stored.revision !== written.revision || !equal(stored.profile, proposed)) { unknown(); return; }
      state.writeUnconfirmed = false;
      state.profile = clone(stored.profile); state.draft = clone(stored.profile); state.revision = stored.revision; state.updated_at = stored.updated_at;
      message('success', t('Tariff saved and confirmed by stored readback.', 'Taryfa zapisana i potwierdzona odczytem.'));
      if (current(token, true) && typeof onSaved === 'function') onSaved(clone(stored));
    } catch (error) {
      if (current(token, true) && ['conflict', 'revision_conflict', 'tariff_revision_conflict'].includes(error?.code)) {
        state.writeUnconfirmed = true;
        message('error', t('Revision conflict. Load the stored tariff and reconcile your draft.', 'Konflikt wersji. Wczytaj zapisaną taryfę i porównaj ze szkicem.'));
      } else if (current(token)) unknown();
    } finally { if (current(token)) { state.busy = false; render(); } }
  };
  const cancel = () => {
    // A dispatched save cannot be undone safely. The button remains disabled.
    if (disposed || state.busy || guard.occupied()) return;
    operation++; state.draft = seed(state.profile); state.feedError = null; state.feedText = undefined;
    message('not_checked', ''); render(); if (typeof onCancel === 'function') onCancel();
  };
  const read = path => path.split('.').reduce((value, key) => value?.[key], state.draft);
  const write = (path, value) => {
    const keys = path.split('.'); let at = state.draft;
    for (const key of keys.slice(0, -1)) { if (!object(at[key]) && !Array.isArray(at[key])) at[key] = {}; at = at[key]; }
    at[keys.at(-1)] = value;
  };
  const mutable = () => observe().admin && !state.busy && !guard.occupied() && available(association);
  const field = (path, label, kind = 'text', choices) => {
    const value = read(path);
    const attrs = `data-path="${esc(path)}" aria-label="${esc(label)}"${mutable() ? '' : ' disabled'}`;
    let input;
    if (choices) input = `<select ${attrs}>${choices.map(([v, l]) => `<option value="${esc(v)}"${String(value ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else input = `<input ${attrs} type="${kind === 'number' ? 'number' : kind}"${kind === 'number' ? ' step="any"' : ''} value="${esc(Array.isArray(value) ? value.join(', ') : value)}">`;
    return `<label class="ht-tariff-field"><span>${esc(label)}</span>${input}</label>`;
  };
  const button = (action, label) => `<button type="button" data-action="${esc(action)}"${mutable() ? '' : ' disabled'}>${esc(label)}</button>`;
  const zoneChoices = () => [['', t('Choose a zone', 'Wybierz strefę')], ...(state.draft.zones || []).map(z => [z.id, z.label || z.id])];
  const intervals = (kind, i, row) => (row.intervals || []).map((_, j) => `<div class="ht-tariff-row">${
    field(`${kind}.${i}.intervals.${j}.from`, t('From HH:MM', 'Od HH:MM'))}${
    field(`${kind}.${i}.intervals.${j}.to`, t('To HH:MM (24:00 allowed)', 'Do HH:MM (także 24:00)'))}${
    mutable() ? button(`remove-interval:${kind}:${i}:${j}`, t('Remove interval', 'Usuń przedział')) : ''}</div>`).join('') +
    (mutable() ? button(`add-interval:${kind}:${i}`, t('Add interval', 'Dodaj przedział')) : '');
  const rows = kind => (state.draft[kind] || []).map((row, i) => `<fieldset><legend>${esc(t(kind === 'rules' ? 'Rule' : 'Date exception', kind === 'rules' ? 'Reguła' : 'Wyjątek daty'))} ${i + 1}</legend><div class="ht-tariff-grid">${
    field(`${kind}.${i}.zone`, t('Zone', 'Strefa'), 'text', zoneChoices())}${field(`${kind}.${i}.priority`, t('Priority', 'Priorytet'), 'number')}${
    kind === 'exceptions' ? field(`${kind}.${i}.dates`, t('Dates YYYY-MM-DD, comma separated', 'Daty RRRR-MM-DD, oddzielone przecinkami')) :
      field(`${kind}.${i}.season.from`, t('Season from MM-DD (optional)', 'Sezon od MM-DD (opcjonalny)')) + field(`${kind}.${i}.season.to`, t('Season to MM-DD (optional)', 'Sezon do MM-DD (opcjonalny)'))}</div>${
    kind === 'rules' ? `<div class="ht-tariff-days">${[t('Sunday', 'Niedziela'), t('Monday', 'Poniedziałek'), t('Tuesday', 'Wtorek'), t('Wednesday', 'Środa'), t('Thursday', 'Czwartek'), t('Friday', 'Piątek'), t('Saturday', 'Sobota')].map((label, d) => `<label><input type="checkbox" data-weekday="${i}:${d}"${row.weekdays?.includes(d) ? ' checked' : ''}${mutable() ? '' : ' disabled'}><span>${esc(label)}</span></label>`).join('')}</div><p>${esc(t('No checked days = every day. Overnight intervals start on the selected day.', 'Brak zaznaczonych dni = codziennie. Przedział nocny zaczyna się w zaznaczonym dniu.'))}</p>` : ''}${
    intervals(kind, i, row)}${mutable() ? button(`remove-row:${kind}:${i}`, t('Remove rule', 'Usuń regułę')) : ''}</fieldset>`).join('');
  const css = `.ht-tariff-v3{box-sizing:border-box;color:var(--primary-text-color,#172033);font:inherit;width:100%;min-width:0;max-width:100%;padding:12px;background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:var(--bento-radius,20px)}
.ht-tariff-v3 *{box-sizing:border-box;min-width:0}.ht-tariff-v3 h3,.ht-tariff-v3 p{overflow-wrap:anywhere}.ht-tariff-v3 fieldset{border:1px solid var(--divider-color,#d8dce5);border-radius:14px;margin:12px 0;padding:12px}.ht-tariff-v3 legend{max-width:100%;overflow-wrap:anywhere}.ht-tariff-v3 .ht-tariff-grid,.ht-tariff-v3 .ht-tariff-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:12px;margin:8px 0}.ht-tariff-v3 .ht-tariff-field{display:flex;flex-direction:column;gap:6px;overflow-wrap:anywhere}.ht-tariff-v3 input,.ht-tariff-v3 select,.ht-tariff-v3 textarea,.ht-tariff-v3 button{font:inherit;color:inherit;border:1px solid var(--divider-color,#c7cdd9);border-radius:10px;background:var(--secondary-background-color,#f7f8fa);min-height:44px;max-width:100%;width:100%;padding:10px}.ht-tariff-v3 textarea{resize:vertical;min-height:110px}.ht-tariff-v3 button{cursor:pointer;width:auto;white-space:normal;overflow-wrap:anywhere}.ht-tariff-v3 button:disabled{cursor:default;opacity:.6}.ht-tariff-v3 :is(input,select,textarea,button):focus-visible{outline:3px solid var(--primary-color,#395fd1);outline-offset:2px}.ht-tariff-v3 .ht-tariff-days,.ht-tariff-v3 .ht-tariff-actions{display:flex;flex-wrap:wrap;gap:8px}.ht-tariff-v3 .ht-tariff-days label{display:flex;align-items:center;gap:8px;min-height:44px}.ht-tariff-v3 input[type=checkbox]{width:24px;min-height:24px;height:24px}.ht-tariff-v3 [role=status]{padding:12px;border-radius:12px;overflow-wrap:anywhere;background:var(--secondary-background-color,#f1f3f6);margin:12px 0}.ht-tariff-v3 [data-status=success]{color:var(--bento-success,#16804a);background:var(--bento-success-light,#e8f5ed)}.ht-tariff-v3 [data-status=error]{color:var(--error-color,#ba1a1a)}.ht-tariff-v3 [data-status=unconfirmed],.ht-tariff-v3 [data-status=partial]{color:var(--warning-color,#a15b00)}.ht-tariff-v3 details{margin:12px 0}.ht-tariff-v3 summary{min-height:44px;cursor:pointer}`;
  function render() {
    if (disposed) return;
    const active = root.getRootNode().activeElement;
    const focused = active && root.contains(active) ? active : root.querySelector(':focus');
    const focusKey = focused ? { path: focused.dataset.path, action: focused.dataset.action, weekday: focused.dataset.weekday, feed: focused.dataset.feed,
      selection: typeof focused.selectionStart === 'number' ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null } : resumeFocus;
    const documentFocus = root.ownerDocument.activeElement, ownerRoot = root.getRootNode();
    const externalFocus = documentFocus && documentFocus !== root.ownerDocument.body &&
      documentFocus !== ownerRoot.host && !root.contains(documentFocus);
    if (focused && state.busy) resumeFocus = focusKey;
    const a = observe();
    if (state.busy && (!available(a) || !a.admin) && state.message) unknown();
    const p = state.draft;
    root.innerHTML = `<style>${css}${family()?.css || ''}</style><section class="ht-tariff-v3" aria-label="${esc(t('Tariff settings', 'Ustawienia taryfy'))}"><h3>${esc(t('Your electricity tariff', 'Twoja taryfa energii'))}</h3><p>${esc(t('Enter your own rates and hours. Names G11/G12/G12w/G12n do not fill rates, holidays or schedules.', 'Wpisz własne ceny i godziny. Nazwy G11/G12/G12w/G12n nie uzupełniają cen, świąt ani harmonogramu.'))}</p>${
      !a.admin ? `<p>${esc(t('Household access: read only.', 'Dostęp domownika: tylko odczyt.'))}</p>` : ''}${
      !available(a) || state.backendAvailable === false ? `<p>${esc(t('Tariff backend unavailable. No local fallback.', 'Backend taryf jest niedostępny. Brak lokalnego zapisu zastępczego.'))}</p>` :
        !Number.isSafeInteger(state.revision) ? `<p>${esc(t('Backend availability not checked. Load the tariff first.', 'Dostępność backendu nie została sprawdzona. Najpierw wczytaj taryfę.'))}</p>` : ''}
${invalidMarker(state.profile) ? `<p role="alert">${esc(t('The stored tariff is invalid. Create and save a valid replacement. No rates were guessed.', 'Zapisana taryfa jest niepoprawna. Utwórz i zapisz poprawny profil. Nie przyjęto domyślnych stawek.'))}</p>` : ''}
<div class="ht-tariff-grid">${field('type', t('Tariff name type', 'Typ nazwy taryfy'), 'text', ['Custom', 'G11', 'G12', 'G12w', 'G12n'].map(v => [v, v]))}${field('name', t('Tariff name (optional)', 'Nazwa taryfy (opcjonalna)'))}${field('currency', t('Currency ISO 4217', 'Waluta ISO 4217'))}${field('timezone', t('IANA timezone', 'Strefa czasowa IANA'))}${field('clock.mode', t('Tariff clock', 'Zegar taryfy'), 'text', [['civil', t('Civil time (DST)', 'Czas lokalny (zmiana czasu)')], ['fixed', t('Fixed UTC offset', 'Stałe przesunięcie UTC')]])}${field('clock.offsetMinutes', t('Fixed offset minutes', 'Stałe przesunięcie w minutach'), 'number')}${field('priceBasis', t('Price basis', 'Podstawa ceny'), 'text', [['gross', t('Gross', 'Brutto')], ['net', t('Net', 'Netto')]])}${field('validFrom', t('Valid from (optional)', 'Ważna od (opcjonalnie)'), 'date')}${field('validTo', t('Valid to (optional)', 'Ważna do (opcjonalnie)'), 'date')}${field('fixedMonthly', t('Fixed monthly fee (separate)', 'Opłata stała miesięczna (osobno)'), 'number')}</div>
<h3>${esc(t('Energy and variable fees per kWh', 'Energia i opłaty zmienne za kWh'))}</h3><p>${esc(t('Empty = unknown; zero is a known zero. Fixed monthly fees are shown separately, never prorated.', 'Puste = nieznane; zero jest znaną wartością zero. Opłata stała jest osobna, bez proporcjonalnego naliczania.'))}</p>${
(p.zones || []).map((_, i) => `<fieldset><legend>${esc(t('Zone', 'Strefa'))} ${i + 1}</legend><div class="ht-tariff-grid">${field(`zones.${i}.id`, t('Zone ID', 'ID strefy'))}${field(`zones.${i}.label`, t('Zone label', 'Etykieta strefy'))}${field(`zones.${i}.energyRate`, t('Energy / kWh', 'Energia / kWh'), 'number')}${field(`zones.${i}.variableRate`, t('Variable fees / kWh (optional)', 'Opłaty zmienne / kWh (opcjonalne)'), 'number')}</div>${mutable() ? button(`remove-zone:${i}`, t('Remove zone', 'Usuń strefę')) : ''}</fieldset>`).join('')}${mutable() ? button('add-zone', t('Add zone', 'Dodaj strefę')) : ''}${field('defaultZone', t('Default zone (optional)', 'Strefa domyślna (opcjonalna)'), 'text', zoneChoices())}
<h3>${esc(t('Schedule rules', 'Reguły harmonogramu'))}</h3>${rows('rules')}${mutable() ? button('add-rule', t('Add rule', 'Dodaj regułę')) : ''}<h3>${esc(t('Date exceptions', 'Wyjątki dat'))}</h3>${rows('exceptions')}${mutable() ? button('add-exception', t('Add date exception', 'Dodaj wyjątek daty')) : ''}
<details><summary>${esc(t('Advanced: absolute dynamic price feed', 'Zaawansowane: bezwzględne przedziały cen dynamicznych'))}</summary><p>${esc(t('Optional dynamic feed overrides schedule prices. Use explicit UTC/offset timestamps. Only this feed uses JSON.', 'Opcjonalny feed dynamiczny zastępuje ceny harmonogramu. Użyj znaczników UTC lub z przesunięciem. JSON służy wyłącznie temu feedowi.'))}</p><label class="ht-tariff-field"><span>${esc(t('Dynamic feed JSON (empty = off)', 'Feed dynamiczny JSON (pusty = wyłączony)'))}</span><textarea data-feed="true"${mutable() ? '' : ' disabled'}>${esc(state.feedText ?? (p.dynamic == null ? '' : JSON.stringify(p.dynamic, null, 2)))}</textarea></label>${field('allowNegativeEnergy', t('Negative energy prices', 'Ujemne ceny energii'), 'text', [['false', t('Disabled', 'Wyłączone')], ['true', t('Explicitly allowed', 'Jawnie dozwolone')]])}</details>
<div role="status" aria-live="polite" data-status="${esc(state.status)}">${statusHtml()}${state.message ? ': ' + esc(localMessage()) : ''}</div><div class="ht-tariff-actions"><button type="button" data-action="load"${state.busy || guard.occupied() || !available(a) ? ' disabled' : ''}>${esc(t('Load stored tariff', 'Wczytaj zapisaną taryfę'))}</button>${a.admin ? `<button type="button" data-action="save"${state.busy || guard.occupied() || !available(a) || state.writeUnconfirmed || state.backendAvailable === false || !Number.isSafeInteger(state.revision) ? ' disabled' : ''}>${esc(t('Save tariff', 'Zapisz taryfę'))}</button><button type="button" data-action="cancel"${state.busy || guard.occupied() ? ' disabled' : ''}>${esc(t('Cancel', 'Anuluj'))}</button>` : ''}</div></section>`;
    root.querySelectorAll('[data-path]').forEach(el => el.addEventListener('input', () => {
      if (!mutable()) { render(); return; }
      const path = el.dataset.path;
      let value = el.value;
      if (el.type === 'number') value = value.trim() === '' ? null : Number(value);
      else if (path.endsWith('.dates')) value = value.split(/[\s,]+/).filter(Boolean);
      else if (path === 'allowNegativeEnergy') value = value === 'true';
      else if (['validFrom', 'validTo', 'defaultZone'].includes(path)) value = value || null;
      write(path, value);
      if (path.includes('.season.')) {
        const base = path.split('.').slice(0, 2).join('.'), season = read(base + '.season');
        if (!season.from && !season.to) delete read(base).season;
      }
      message('not_checked', '');
      const badge = root.querySelector('[role=status]');
      if (badge) { badge.dataset.status = 'not_checked'; badge.innerHTML = statusHtml(); }
    }));
    root.querySelectorAll('[data-path]').forEach(el => el.addEventListener('change', () => {
      if (/^zones\.\d+\.(id|label)$/.test(el.dataset.path)) render();
    }));
    root.querySelectorAll('[data-weekday]').forEach(el => el.addEventListener('change', () => {
      if (!mutable()) { render(); return; }
      const [i, day] = el.dataset.weekday.split(':').map(Number), row = p.rules[i], days = new Set(row.weekdays || []);
      if (el.checked) days.add(day); else days.delete(day);
      if (days.size) row.weekdays = [...days].sort(); else delete row.weekdays;
      message('not_checked', ''); render();
    }));
    root.querySelector('[data-feed]')?.addEventListener('input', event => {
      if (!mutable()) { render(); return; }
      state.feedText = event.target.value;
      try { const dynamic = state.feedText.trim() ? JSON.parse(state.feedText) : null;
        if (dynamic !== null && !object(dynamic)) throw Error();
        p.dynamic = dynamic; state.feedError = null; message('not_checked', '');
      } catch (_) { state.feedError = t('Invalid dynamic feed JSON.', 'Niepoprawny JSON feedu dynamicznego.'); message('error', state.feedError); }
      const badge = root.querySelector('[role=status]');
      if (badge) { badge.dataset.status = state.status; badge.innerHTML = statusHtml() + (state.message ? ': ' + esc(localMessage()) : ''); }
    });
    root.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => {
      const [action, ...args] = el.dataset.action.split(':');
      if (action === 'load') { void load(); return; }
      if (!mutable()) return;
      if (action === 'save') { void save(); return; }
      if (action === 'cancel') { cancel(); return; }
      if (action === 'add-zone') {
        p.zones ||= []; let id = `zone-${p.zones.length + 1}`;
        while (p.zones.some(z => z.id === id)) id += '-new';
        p.zones.push({ id, label: '', energyRate: null, variableRate: null });
      } else if (action === 'remove-zone') p.zones.splice(Number(args[0]), 1);
      else if (action === 'add-rule' || action === 'add-exception') {
        const kind = action === 'add-rule' ? 'rules' : 'exceptions'; p[kind] ||= [];
        p[kind].push({ zone: p.defaultZone || p.zones?.[0]?.id || '', priority: 0,
          ...(kind === 'exceptions' ? { dates: [] } : {}), intervals: [{ from: '00:00', to: '24:00' }] });
      } else if (action === 'remove-row') p[args[0]].splice(Number(args[1]), 1);
      else if (action === 'add-interval') { const row = p[args[0]][Number(args[1])]; row.intervals ||= []; row.intervals.push({ from: '00:00', to: '24:00' }); }
      else if (action === 'remove-interval') p[args[0]][Number(args[1])].intervals.splice(Number(args[2]), 1);
      message('not_checked', ''); render();
    }));
    if (focusKey) {
      const target = [...root.querySelectorAll('input,select,textarea,button')].find(el =>
        (focusKey.path && el.dataset.path === focusKey.path) || (focusKey.action && el.dataset.action === focusKey.action) ||
        (focusKey.weekday && el.dataset.weekday === focusKey.weekday) || (focusKey.feed && el.dataset.feed === focusKey.feed));
      if (target && !target.disabled && !externalFocus) {
        target.focus();
        if (focusKey.selection && typeof target.selectionStart === 'number') {
          const length = target.value.length;
          target.setSelectionRange(Math.min(focusKey.selection.start, length), Math.min(focusKey.selection.end, length), focusKey.selection.direction || 'none');
        }
      }
    }
    if (!state.busy) resumeFocus = null;
  }
  return { render, load, cancel, dispose: () => { disposed = true; operation++; unsubscribe(); unsubscribeWire(); } };
}
  // END mirror shared/ha-tools-tariff-settings.js

  // BEGIN mirror shared/ha-tools-tariff-host.js
// Node-only import; omitted in consumer closure.

// Card-owned adapter: it never writes card YAML, helpers, schedules or SMTP.
function createTariffHostV3({ card, kind, createModel, legacyProfile, createSettings, createUi, readTimeoutMs = 15000, guard, onRefresh }) {
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const language = () => card._hass?.locale?.language || card._hass?.language || card._lang || 'en';
  const text = (en, pl) => String(language()).startsWith('pl') ? pl : en;
  guard ||= createTariffGuardV3({ getHass: () => card._hass, getContext: () => card._config, timeoutMs: readTimeoutMs });
  const identity = () => guard.snapshot();
  const same = (a, b) => a?.epoch === b?.epoch && a?.user === b?.user && a?.connection === b?.connection;
  let pending = null, attemptedEpoch = null, cachedKey, cachedModel, editorRoot, editor, focusKey = null;
  const state = () => (card._tariffEditorState ||= { profile: null, revision: null, status: 'not_checked', busy: false });
  const effectiveConfig = () => {
    const config = card._config || {};
    if (Object.hasOwn(config, 'tariff_profile')) return config;
    return card._sharedTariffProfile != null && same(card._sharedTariffAssociation, identity(card._hass))
      ? { ...config, tariff_profile: card._sharedTariffProfile } : config;
  };
  const activeProfile = () => legacyProfile(effectiveConfig(), card._hass?.config, kind);
  const model = function (proposed) {
    if (arguments.length) return createModel(proposed);
    const profile = activeProfile(), key = JSON.stringify(profile);
    if (cachedModel && key === cachedKey) return cachedModel;
    cachedKey = key; cachedModel = createModel(profile); return cachedModel;
  };
  const currency = () => {
    const value = activeProfile()?.currency;
    return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : '';
  };
  const purge = () => {
    card._sharedTariffProfile = null; card._sharedTariffAssociation = null;
    card._sharedTariffLoadedAt = 0; card._tariffEditorState = null;
    card._sharedTariffReadStatus = 'not_checked'; card._tariffSettingsOpen = false;
    cachedKey = undefined; cachedModel = undefined; editorRoot?.replaceChildren(); editor?.dispose?.(); editorRoot = null; editor = null; focusKey = null;
    for (const mount of card.shadowRoot?.querySelectorAll('[data-tariff-mount]') || []) mount.replaceChildren();
    const details = card.shadowRoot?.querySelector('[data-tariff-details]'); if (details) details.open = false;
    // Pending raw request remains owned by guard; a new epoch cannot free it.
  };
  guard.subscribe(purge);
  const reset = (...nextHass) => guard.observe(...nextHass);
  const load = async (force = false) => {
    const token = identity();
    if (!guard.available(token)) return false;
    if (card._sharedTariffReadStatus === 'success' && same(card._sharedTariffAssociation, token)) return true;
    if (pending) return pending;
    if (guard.occupied() || (!force && attemptedEpoch === token.epoch)) return false;
    attemptedEpoch = token.epoch;
    const operation = (async () => {
      try {
        const result = await guard.call(token, { type: 'ha_tools_email/get_tariff' });
        if (!guard.current(token)) return false;
        if (!result || !Object.hasOwn(result, 'profile') || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
          !Object.hasOwn(result, 'updated_at') || (result.updated_at !== null &&
          (typeof result.updated_at !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(result.updated_at) || !Number.isFinite(Date.parse(result.updated_at)))))
          throw new Error('invalid_tariff_response');
        const valid = result.profile === null || createModel(result.profile).valid;
        const profile = result.profile === null ? null : valid ? clone(result.profile) : { schema: 0 };
        card._sharedTariffProfile = profile; card._sharedTariffAssociation = token; card._sharedTariffLoadedAt = Date.now();
        card._sharedTariffReadStatus = 'success';
        const saved = state(), pristine = !saved.draft || JSON.stringify(saved.draft) === JSON.stringify(saved._draftBaseline) || JSON.stringify(saved.draft) === JSON.stringify(saved.profile);
        saved.profile = clone(profile); saved.revision = result.revision; saved.updated_at = result.updated_at;
        saved.backendAvailable = true;
        if (pristine) { saved.draft = valid ? clone(profile) : undefined; saved._draftBaseline = clone(saved.draft); }
        return true;
      } catch (_) {
        if (guard.current(token)) card._sharedTariffReadStatus = 'unconfirmed';
        return false;
      }
    })();
    pending = operation;
    operation.then(() => { if (pending === operation) pending = null; }, () => { if (pending === operation) pending = null; });
    return operation;
  };
  const snapshot = () => {
    const token = identity(), own = Object.hasOwn(card._config || {}, 'tariff_profile');
    if (!guard.available(token)) return { profile: null, reason: 'tariff_authority_unavailable' };
    if (own) return { profile: clone(card._config.tariff_profile), revision: null, provenance: 'card_config' };
    if (!same(card._sharedTariffAssociation, token) || card._sharedTariffReadStatus !== 'success') return { profile: null, reason: 'tariff_unconfirmed' };
    return { profile: clone(card._sharedTariffProfile), revision: state().revision, provenance: 'shared_backend', updated_at: state().updated_at };
  };
  const markup = () => {
    const active = card.shadowRoot?.activeElement;
    focusKey = active?.closest('[data-tariff-details]') ? {
      summary: active.tagName === 'SUMMARY', path: active.dataset.path,
      action: active.dataset.action, weekday: active.dataset.weekday, feed: active.dataset.feed,
      selection: typeof active.selectionStart === 'number' ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null
    } : null;
    return `<style>
    [data-energy-container]{container-type:inline-size;container-name:energy-card}
    .tabs{flex-wrap:wrap;overflow:visible;max-width:100%}
    .tabs>button{min-height:44px;min-width:44px;white-space:normal;overflow-wrap:anywhere;flex:0 1 auto}
    button{min-height:44px;min-width:44px}
    .energy-tab-picker{display:none;margin:12px 0}
    .energy-tab-picker select{font:inherit;color:var(--primary-text-color,#172033);background:var(--card-background-color,#fff);width:100%;max-width:100%;min-height:44px;border:1px solid var(--divider-color,#d8dce5);border-radius:10px;padding:10px}
    .energy-tab-picker select:focus-visible{outline:3px solid var(--primary-color,#395fd1);outline-offset:2px}
    @container energy-card (max-width:279.99px){.tabs{display:none}.energy-tab-picker{display:block}}
    [data-tariff-details]{margin:16px 0;min-width:0;max-width:100%}
    [data-tariff-details]>summary{min-height:44px;display:flex;align-items:center;padding:10px;border:1px solid var(--divider-color,#d8dce5);border-radius:10px;cursor:pointer;overflow-wrap:anywhere}
    [data-tariff-details]>summary:focus-visible{outline:3px solid var(--primary-color,#395fd1);outline-offset:2px}
    </style>${card._sharedTariffReadStatus === 'unconfirmed' ? `<p role="status">${text('Shared tariff could not be confirmed. Reload explicitly to confirm prices. No tariff cost is guessed.', 'Nie udało się potwierdzić wspólnej taryfy. Wczytaj ponownie, aby potwierdzić ceny. Koszt taryfy nie jest zgadywany.')}</p>` : ''}
    <details data-tariff-details${card._tariffSettingsOpen ? ' open' : ''}><summary>${text('Tariff settings', 'Ustawienia taryfy')}</summary>
    ${Object.hasOwn(card._config || {}, 'tariff_profile') ? `<p>${text('This card uses its own configured tariff. Shared settings apply to cards using the shared profile.', 'Ta karta używa własnej skonfigurowanej taryfy. Ustawienia współdzielone dotyczą kart korzystających ze wspólnego profilu.')}</p>` : ''}
    <div data-tariff-mount></div></details>`;
  };
  const mount = root => {
    if (editorRoot !== root || !editor) {
      editor?.dispose?.();
      const saved = state();
      if (!saved.draft) {
        const profile = activeProfile();
        if (createModel(profile).valid) saved.draft = clone(profile);
      }
      editorRoot = root;
      const mountToken = identity();
      const refreshed = envelope => {
        if (!guard.current(mountToken)) return;
        card._sharedTariffProfile = clone(envelope.profile); card._sharedTariffAssociation = identity(card._hass);
        card._sharedTariffLoadedAt = Date.now();
        card._sharedTariffReadStatus = 'success';
        // The editor finishes its pending state before the parent replaces DOM.
        queueMicrotask(() => {
          if (!guard.current(mountToken)) return;
          if (onRefresh) { onRefresh(envelope); return; }
          if (kind === 'insights') void card._fetchData();
          if (kind === 'email') void card._fetchAllPeriodStats().then(() => card._render());
          card._render();
        });
      };
      editor = createSettings({ root, getHass: () => card._hass, language, state: saved, validate: createModel,
        guard, ui: () => createUi({ language: language() }),
        onSaved: refreshed, onLoaded: refreshed,
        onCancel: () => {
          card._tariffSettingsOpen = false;
          const details = root.closest('[data-tariff-details]');
          if (details) { details.open = false; details.querySelector('summary')?.focus(); }
        } });
    }
    if (!Object.hasOwn(state(), '_draftBaseline')) state()._draftBaseline = clone(state().draft);
    editor.render();
  };
  const bind = () => {
    guard.observe();
    const tabs = card.shadowRoot.querySelector('.tabs');
    if (tabs && kind !== 'smart') {
      tabs.parentElement.setAttribute('data-energy-container', '');
      const buttons = [...tabs.querySelectorAll('button')];
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', text('Energy views', 'Widoki energii'));
      let picker = card.shadowRoot.querySelector('.energy-tab-picker select');
      if (!picker) {
        const label = document.createElement('label'); label.className = 'energy-tab-picker';
        picker = document.createElement('select'); label.append(picker); tabs.before(label);
        picker.addEventListener('change', () => buttons[Number(picker.value)]?.click());
      }
      picker.setAttribute('aria-label', text('Energy view', 'Widok energii'));
      picker.replaceChildren(...buttons.map((button, index) => {
        const option = document.createElement('option'); option.value = String(index);
        option.textContent = button.textContent.trim(); option.selected = button.classList.contains('active');
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(option.selected));
        if (!button.dataset.energyPickerBound) {
          button.dataset.energyPickerBound = 'true';
          button.addEventListener('click', () => queueMicrotask(() => {
            buttons.forEach((item, i) => {
              const active = item.classList.contains('active'); item.setAttribute('aria-selected', String(active));
              if (active) picker.value = String(i);
            });
          }));
        }
        return option;
      }));
    }
    const details = card.shadowRoot.querySelector('[data-tariff-details]');
    if (!details) return;
    let root = details.querySelector('[data-tariff-mount]');
    if (editorRoot && editor && root !== editorRoot) { root.replaceWith(editorRoot); root = editorRoot; }
    if (!details.dataset.bound) {
      details.dataset.bound = 'true';
      details.addEventListener('toggle', () => {
        card._tariffSettingsOpen = details.open;
        if (details.open) mount(root);
      });
    }
    if (details.open) mount(root);
    if (focusKey) {
      const key = focusKey; focusKey = null;
      const target = key.summary ? details.querySelector('summary') : details.open &&
        [...root.querySelectorAll('input,select,textarea,button')].find(el =>
          (key.path && el.dataset.path === key.path) || (key.action && el.dataset.action === key.action) ||
          (key.weekday && el.dataset.weekday === key.weekday) || (key.feed && el.dataset.feed === key.feed));
      if (target && !target.disabled) {
        target.focus({ preventScroll: true });
        if (key.selection && typeof target.selectionStart === 'number') {
          const length = target.value.length;
          target.setSelectionRange(Math.min(key.selection.start, length), Math.min(key.selection.end, length), key.selection.direction || 'none');
        }
      }
    }
  };
  return { model, profile: activeProfile, currency, reset, load, snapshot, markup, bind, guard, ui: () => createUi({ language: language() }) };
}

  // END mirror shared/ha-tools-tariff-host.js

  const VERSION = '4.2.0';
  const VALID_PERIODS = new Set(['1d', '7d', '30d']);
  const ENERGY_UNITS = new Set(['Wh', 'kWh', 'MWh']);

  const PL = Object.freeze({
    'missing_measurement':'brak pomiaru','shared_backend':'wspólne ustawienia taryfy','card_config':'ustawienia karty',
    'gross':'brutto','net':'netto','nonaligned_window':'okres nie obejmuje pełnych godzin',
    'tariff_authority_unavailable':'ustawienia taryfy niedostępne','tariff_unconfirmed':'ustawienia taryfy niepotwierdzone',
    'invalid_profile':'nieprawidłowa taryfa','mixed_rate_bucket':'zmiana stawki wewnątrz przedziału',

    'Previous period could not be loaded.':'Nie udało się wczytać poprzedniego okresu.',
    'read_failed':'odczyt nie powiódł się',
    'All hours':'Wszystkie godziny','Page':'Strona','Previous':'Poprzednia','Next':'Następna',
    'Complete history':'Kompletna historia','Partial history':'Niepełna historia','No measurements':'Brak pomiarów',
    'Daily consumption views':'Widoki dziennego zużycia','Day details':'Szczegóły dnia','Clear day selection':'Wyczyść wybór dnia',
    'Select a day for its interval and measurement coverage.':'Wybierz dzień, aby zobaczyć jego przedział i kompletność pomiarów.',
    'Hourly records':'Dane godzinowe','Daily overview':'Przegląd dzienny','UTC interval':'Przedział UTC',
    'Energy / kWh':'Energia / kWh','Zone':'Strefa','Status':'Stan',
    'Select a day to inspect its hours. Stripes show measured subsets; gaps are not zero.':'Wybierz dzień, aby zobaczyć godziny. Paski oznaczają zmierzoną część danych; brak danych nie oznacza zera.',

    "shared_backend": "Wspólny profil z backendu",
    "card_config": "Profil z konfiguracji karty",
    "Configured tariff energy cost": "Koszt energii według skonfigurowanej taryfy",
    "Measured hours": "Zmierzone godziny",
    "Revision": "Wersja",
    "Current profile validity": "Bieżąca dostępność profilu",
    "Energy cost only; variable and fixed fees are separate. This is not a complete electricity bill.": "Tylko koszt energii; opłaty zmienne i stałe są osobno. To nie jest pełny rachunek za prąd.",
    "Measured subset only": "Tylko zmierzony podzbiór",
    "Variable fees": "Opłaty zmienne",
    "Energy and variable fees": "Energia i opłaty zmienne",
    "Fixed monthly fee (separate)": "Miesięczna opłata stała (osobno)",
    "month": "miesiąc",
    "Cost evidence": "Dane kosztu",
    "Chart": "Wykres",
    "Data": "Dane",
    "Measured energy": "Zmierzona energia",
    "Priced energy": "Wyceniona energia",
    "Flat rate per kWh": "Stała stawka za kWh",
    "Cost mode": "Tryb kosztu",
    "Recorded costs, then explicit flat estimate": "Zarejestrowane koszty, potem jawny stały szacunek",
    "Recorded monetary statistics": "Statystyki kosztów w walucie",
    "Configured tariff from measured hours": "Skonfigurowana taryfa ze zmierzonych godzin",
    "invalid_profile": "Niepoprawny profil",
    "missing_measurement": "Brak pomiaru",
    "mixed_rate_bucket": "Różne ceny wewnątrz godziny",
    "tariff_unconfirmed": "Taryfa niepotwierdzona",
    "tariff_authority_unavailable": "Brak dostępu do taryfy",
    "outside_validity": "Poza okresem ważności",
    "nonaligned_window": "Niepełne godziny okresu",
    "invalid_root_sources": "Niepoprawne źródła główne",
    "invalid_measurement": "Niepoprawny pomiar",
    "ambiguous_rules": "Niejednoznaczne reguły",
    "Compare previous local-calendar period": "Porównaj poprzedni okres kalendarza lokalnego",
    "Previous period comparison": "Porównanie z poprzednim okresem",
    "Comparison details": "Szczegóły porównania",
    "Current period": "Bieżący okres",
    "Previous period": "Poprzedni okres",
    "Missing energy days": "Dni z brakami energii",
    "Missing cost days": "Dni z brakami kosztu",
    "Role": "Rola",
    "Change in measured energy": "Zmiana zmierzonej energii",
    "Change in energy cost": "Zmiana kosztu energii",
    "Daily allocation": "Przypisanie do dnia",
    "Whole reading in this day": "Cały pomiar w tym dniu",
    "device": "urządzenie",
    "priced_energy": "koszt zmierzonej energii",
    "crosses_local_midnight": "Pełna godzina przecina lokalną północ; zachowana w Wszystkie godziny, bez dzielenia pomiaru",
    "Recorded value": "Zarejestrowana wartość",
    "complete_comparable_measurements": "Pełne porównywalne pomiary",
    "ambiguous_local_cutoff": "Niejednoznaczna lokalna godzina odcięcia",
    "nonexistent_local_cutoff": "Lokalna godzina odcięcia nie istnieje",
    "historical_flat_rate_unavailable": "Brak potwierdzonej historycznej stawki stałej",
    "previous_zero": "Poprzednia wartość wynosi zero — procent nieznany",
    "previous_nonpositive": "Poprzednia wartość jest ujemna — procent nieznany",
    "nonfinite_delta": "Zmiana poza zakresem liczbowym",
    "unit_mismatch": "Niezgodne jednostki",

    "Search devices or sources": "Szukaj urządzenia lub źródła",
    "Name or entity/statistic ID": "Nazwa lub identyfikator encji/statystyki",
    "Clear search": "Wyczyść wyszukiwanie",
    "Report totals": "Sumy raportu",
    "Report totals and comparison": "Sumy raportu i porównanie",
    "Report total (not filtered)": "Suma raportu (bez filtra)",
    "Recorded consumption (not filtered)": "Zarejestrowane zużycie (bez filtra)",
    "Shown devices": "Pokazane urządzenia",
    "No matching devices": "Brak pasujących urządzeń",
    "Parent device": "Urządzenie nadrzędne",
    "Export includes all devices and sources in this report, including those hidden by search.": "Eksport obejmuje wszystkie urządzenia i źródła w raporcie, także ukryte przez wyszukiwanie.",
    "Energy report views": "Widoki raportu energii",
    "Summary": "Podsumowanie",
    "Devices": "Urządzenia",
    "Costs": "Koszty",
    "Partial history — recorded values only.": "Niepełna historia — tylko zarejestrowane wartości.",
    "Today starts reporting after its first completed hour.": "Raport dzisiejszy pojawi się po pierwszej zakończonej godzinie.",
    "Recorded energy by device": "Zarejestrowana energia urządzeń",
    "Recorded consumption by day": "Zarejestrowane zużycie po dniach",
    "source hours": "godzin źródeł",
    "Striped days have incomplete history; empty days are not measured zero.": "Dni w paski mają niepełną historię; puste dni nie oznaczają zmierzonego zera.",
    "Device values have their own coverage; nested devices are included in their parent.": "Urządzenia mają własny zakres danych; urządzenie podrzędne jest zawarte w nadrzędnym.",
    "See all devices": "Zobacz wszystkie urządzenia",
    "Cost history": "Historia kosztów",
    "Explicit flat-rate estimate": "Szacunek z jawnej stałej taryfy",
    "Cost samples have their own history; the current tariff is not applied to past energy.": "Próbki kosztów mają własną historię; bieżąca taryfa nie jest stosowana do wcześniejszego zużycia.",
    "No recorded cost source is configured.": "Nie skonfigurowano źródła zarejestrowanych kosztów.",
    "Current entities by domain": "Bieżące encje według domen",
    "Current state snapshot, not historical energy.": "Bieżący stan systemu, bez historii energii.",
    "Source mode": "Tryb źródeł",
    "Energy Dashboard": "Panel energii",
    "Explicit statistics": "Wybrane statystyki",
    "Total statistic IDs": "Identyfikatory statystyk zużycia",
    "Device statistic IDs": "Identyfikatory statystyk urządzeń",
    "Cost statistic IDs": "Identyfikatory statystyk kosztów",
    "One statistic ID per line. Advanced labels and parent relationships can be configured in YAML.": "Jeden identyfikator statystyki na wiersz. Własne etykiety i powiązania nadrzędne można skonfigurować w YAML.",
    "Recorder-backed": "Na podstawie danych rejestratora",
    "Report sections": "Sekcje raportu",
    "Energy": "Energia",
    "Automations": "Automatyzacje",
    "System": "System",
    "Period": "Okres",
    "Energy report period": "Okres raportu energii",
    "Today": "Dzisiaj",
    "7 days": "7 dni",
    "30 days": "30 dni",
    "Export CSV": "Eksport CSV",
    "Export JSON": "Eksport JSON",
    "Optional support for HA Tools": "Dobrowolne wsparcie HA Tools",
    "Dismiss support link": "Ukryj odnośnik wsparcia",
    "Enable at least one report section.": "Włącz co najmniej jedną sekcję raportu.",
    "Turn on Energy, Automations, or System in the card configuration.": "Włącz Energię, Automatyzacje lub System w konfiguracji karty.",
    "Loading recorder statistics…": "Wczytywanie statystyk rejestratora…",
    "This report uses recorded changes for the selected local-calendar period.": "Raport wykorzystuje zarejestrowane zmiany z wybranego okresu według lokalnego kalendarza.",
    "Configure Energy Dashboard or select explicit statistics.": "Skonfiguruj panel energii lub wybierz statystyki.",
    "Smart Reports does not discover sensors by substring and does not use live entity states.": "Smart Reports nie wyszukuje czujników po fragmencie nazwy i nie korzysta z bieżących stanów encji.",
    "Open Energy configuration": "Otwórz konfigurację energii",
    "Recorder statistics are unavailable on this Home Assistant instance.": "Statystyki rejestratora są niedostępne w tej instancji Home Assistant.",
    "Check recorder support and the selected statistic metadata.": "Sprawdź obsługę rejestratora i metadane wybranych statystyk.",
    "Your account cannot read the selected statistics.": "Twoje konto nie może odczytać wybranych statystyk.",
    "Use an account with recorder statistics access.": "Użyj konta z dostępem do statystyk rejestratora.",
    "Couldn’t load energy statistics.": "Nie udało się wczytać statystyk energii.",
    "The previous period is not shown as current data.": "Dane z poprzedniego okresu nie są wyświetlane jako bieżące.",
    "Technical details": "Szczegóły techniczne",
    "Details": "Szczegóły",
    "No change": "Bez zmiany",
    "Scroll to see all days": "Przewiń, aby zobaczyć wszystkie dni",
    "source complete": "źródło z pełną historią",
    "sources complete": "źródeł z pełną historią",
    "Retry": "Ponów",
    "No recorded energy change in this period.": "Brak zarejestrowanych zmian energii w tym okresie.",
    "Measured zero is rendered separately; this state means no recorder samples were available.": "Zmierzone zero jest wyświetlane osobno; ten stan oznacza brak próbek rejestratora.",
    "Partial data — totals and cost are withheld.": "Dane częściowe — suma i koszt nie są wyświetlane.",
    "At least one required statistic was missing, invalid, incomplete, or used an incompatible currency.": "Co najmniej jedna wymagana statystyka była brakująca, nieprawidłowa, niepełna lub używała niezgodnej waluty.",
    "Time zone": "Strefa czasowa",
    "Sources": "Źródła",
    "total": "suma",
    "cost": "koszt",
    "Exact recorder window": "Dokładny zakres rejestratora",
    "Grid import": "Pobór z sieci",
    "Recorded consumption": "Zarejestrowane zużycie",
    "Recorded cost": "Zarejestrowany koszt",
    "Sources with data": "Źródła z danymi",
    "Complete sources": "Źródła z pełną historią",
    "Recorded values cover available samples only; gaps are not zero.": "Zarejestrowane wartości obejmują tylko dostępne próbki; braki nie oznaczają zera.",
    "Actual cost": "Rzeczywisty koszt",
    "Estimated cost": "Szacowany koszt",
    "Cost unavailable": "Koszt niedostępny",
    "Device breakdown unavailable": "Zestawienie urządzeń niedostępne",
    "Reported devices — partial": "Urządzenia w raporcie — dane częściowe",
    "Device breakdown": "Zestawienie urządzeń",
    "No device statistics are configured.": "Nie skonfigurowano statystyk urządzeń.",
    "Source evidence": "Dane źródłowe",
    "day_suffix": " dn.",
    "Never": "Nigdy",
    "now": "teraz",
    "Total automations": "Wszystkie automatyzacje",
    "Active": "Aktywne",
    "Disabled": "Wyłączone",
    "Triggered today": "Uruchomione dzisiaj",
    "Recent activity": "Ostatnia aktywność",
    "No automation entities are available.": "Brak dostępnych encji automatyzacji.",
    "System overview": "Przegląd systemu",
    "Entities": "Encje",
    "Unavailable": "Niedostępne",
    "Unknown": "Nieznane",
    "Domains": "Domeny",
    "Health check": "Stan systemu",
    "Entity availability": "Dostępność encji",
    "Known states": "Znane stany",
    "Total entities": "Wszystkie encje",
    "Title": "Tytuł",
    "Currency": "Waluta",
    "on": "włączona",
    "off": "wyłączona",
    "unknown": "nieznany",
    "unavailable": "niedostępny",
    "ready": "gotowe",
    "partial": "częściowe",
    "no_data": "brak danych",
    "invalid": "nieprawidłowe",
    "unsupported_unit": "nieobsługiwana jednostka",
    "missing_statistics": "brak statystyk",
    "incomplete_period": "niepełny okres",
    "missing_metadata": "brak metadanych",
    "missing_rate": "brak stawki",
    "unsupported": "nieobsługiwane",
    "incompatible_energy_metadata": "niezgodne metadane energii",
    "incompatible_currency_metadata": "niezgodne metadane waluty",
    "invalid_bucket": "nieprawidłowy przedział",
    "outside_requested_window": "poza wybranym zakresem",
    "missing_change": "brak danych zmiany",
    "incomplete_coverage": "niepełne pokrycie okresu",
    "Boundary intervals without a complete hourly measurement": "Przedziały graniczne bez pełnego pomiaru godzinowego",
    "invalid_relationship": "nieprawidłowe powiązanie urządzeń",
    "nested_parent_missing": "brak nadrzędnego źródła urządzenia",
    "currency_mismatch": "niezgodna waluta",
    "partial_cost": "niepełne dane kosztu",
    "partial_energy": "niepełne dane energii",
    "missing_currency": "brak waluty",
    "energy_data_unavailable": "dane energii niedostępne",
    "included_in_stat is only valid for device sources: ": "included_in_stat jest dozwolone tylko dla źródeł urządzeń: "
});

  function languageOf(hass) {
    return (hass && hass.locale && hass.locale.language) || (hass && hass.language) || navigator.language || 'en';
  }

  function translate(hass, text) {
    const language = languageOf(hass);
    if (/^pl(?:[-_]|$)/i.test(language) && Object.prototype.hasOwnProperty.call(PL, text)) return PL[text];
    return ({ missing_measurement: 'Missing measurement', shared_backend: 'Shared tariff settings', card_config: 'Card settings',
      gross: 'Gross', net: 'Net', nonaligned_window: 'Window does not cover complete hours',
      tariff_authority_unavailable: 'Tariff settings unavailable', tariff_unconfirmed: 'Tariff settings unconfirmed',
      invalid_profile: 'Invalid tariff', mixed_rate_bucket: 'Rate changes within this interval',
      priced_energy: 'Priced energy', crosses_local_midnight: 'Whole hour crosses local midnight; retained in All hours without splitting the reading',
      complete_comparable_measurements: 'Complete comparable measurements', ambiguous_local_cutoff: 'Ambiguous local cutoff time',
      nonexistent_local_cutoff: 'Local cutoff time does not exist', historical_flat_rate_unavailable: 'Confirmed historical flat rate unavailable',
      previous_zero: 'Previous value is zero; percentage unavailable', previous_nonpositive: 'Previous value is negative; percentage unavailable',
      nonfinite_delta: 'Change exceeds numeric range', unit_mismatch: 'Incompatible units',
      incomplete_coverage: 'Incomplete coverage', partial_cost: 'Incomplete cost history', partial_energy: 'Incomplete energy history', missing_rate: 'Missing rate', currency_mismatch: 'Incompatible currency' })[text] || (text === 'day_suffix' ? 'd' : text);
  }

  function uniqueById(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item.statistic_id || seen.has(item.statistic_id)) return false;
      seen.add(item.statistic_id);
      return true;
    });
  }

  function normalizeConfiguredSource(value, role, provenance) {
    if (typeof value === 'string') {
      const statisticId = value.trim();
      return statisticId ? {
        statistic_id: statisticId,
        label: null,
        role,
        provenance,
        included_in_stat: null,
      } : null;
    }
    if (!value || typeof value !== 'object') return null;
    const rawId = value.statistic_id || value.stat_consumption || value.stat_energy_from || value.stat_cost;
    const statisticId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!statisticId) return null;
    const included = typeof value.included_in_stat === 'string' && value.included_in_stat.trim()
      ? value.included_in_stat.trim()
      : null;
    return {
      statistic_id: statisticId,
      label: typeof value.label === 'string' && value.label.trim()
        ? value.label.trim()
        : (typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null),
      role,
      provenance,
      included_in_stat: included,
    };
  }

  function normalizeList(value, role, provenance) {
    const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return uniqueById(list.map((item) => normalizeConfiguredSource(item, role, provenance)).filter(Boolean));
  }

  function asDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function numericTime(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const date = asDate(value);
    return date ? date.getTime() : null;
  }

  // BEGIN HA TOOLS EXPORT V3 source-sha256=bae4197cb254a7e24affbf90f029833127c5ba09b5b96f876a6fd8112f816a3d
/**
 * W6 export dialog. Pure ES module; vendor this factory INSIDE each consumer's
 * own IIFE (remove only the `export` keyword). Never attach it to window.
 * Construction is inert. open() appends only its own container to root.
 *
 * Required dependency injection:
 * root: Element/ShadowRoot; getLanguage(): 'pl'|'en'; createUiV3: existing W4 factory.
 * getContext(): {role,userId,connectionId,datasetId,revision,connected,canExport,
 *                sourceConfirmed}. Identities/revision are nonempty scalar values;
 * bump revision monotonically for source/filter/selection/identity changes,
 * including a restored source; never reuse an old revision. Never return tokens or data.
 * policy: {id,allowlistedFields:string[],neverInclude:[tokens,users,addresses,raw_config]}.
 * formats: explicit subset of ['json','csv','txt']; defaults must be explicit valid choices.
 * buildPayload({context,draft,policy,signal}): read-only, Promise or sync result:
 * {serialized:string,confirmed:true,sourceConfirmed:true,status:'success'|'partial',
 *  included:string[],excluded:string[],sourceLimit:string}.
 * Included/Excluded/sourceLimit describe the REVIEWED CONSUMER policy and actual
 * source limitations in the current language. The consumer MUST explicitly select
 * allowed fields, exclude tokens/users/addresses/raw configuration under EVERY
 * private opt-in, and sanitize CSV formula cells where applicable. A generic
 * recursive export/redactor of arbitrary raw state/config is NOT a valid consumer.
 * This factory cannot inspect or truthfully sanitize an unknown arbitrary schema.
 * For partial reports the consumer also encodes the partial status, inclusion
 * scope and source limitations IN its allowlisted file schema, not only UI text.
 * performDownload({serialized,blob,filename,format,context,signal}): explicit Save
 * only. Return {outcome:'initiated'|'saved'|'unknown'}; 'saved' requires actual
 * adapter confirmation, never infer disk persistence from an anchor click.
 * Optional clock(): monotonic milliseconds; setTimer(fn,ms), clearTimer(handle).
 *
 * Returned API: open({opener}), cancel(), contextChanged(), destroy(). Every open
 * resets private consent. contextChanged() discards bytes/consent immediately;
 * owner also calls cancel/destroy on disconnect. Save ALWAYS rechecks context.
 * One preview on open, explicit Refresh thereafter; bounded 10s, no automatic
 * retries/downloads/persistence. AbortSignal is advisory; late results are ignored.
 */
function createExportDialog(options) {
  const { root, getContext, getLanguage, createUiV3, buildPayload, performDownload,
    clock = () => globalThis.performance.now(), setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = id => globalThis.clearTimeout(id), defaultFormat, defaultFilename } = options || {};
  const allowedFormats = ['json', 'csv', 'txt', 'yaml'];
  const excludedCategories = ['tokens', 'users', 'addresses', 'raw_config'];
  const strings = value => Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v.trim());
  if (!root?.append || !root.ownerDocument || [getContext, getLanguage, createUiV3, buildPayload, performDownload, clock, setTimer, clearTimer].some(fn => typeof fn !== 'function')) {
    throw new TypeError('root and injected getContext/getLanguage/createUiV3/buildPayload/performDownload/clock/timers are required');
  }
  const suppliedPolicy = options.policy;
  if (!suppliedPolicy || typeof suppliedPolicy.id !== 'string' || !suppliedPolicy.id.trim() || !strings(suppliedPolicy.allowlistedFields) || !strings(suppliedPolicy.neverInclude) || excludedCategories.some(key => !suppliedPolicy.neverInclude.includes(key))) {
    throw new TypeError('Explicit reviewed consumer policy with allowlistedFields and neverInclude is required');
  }
  const policy = Object.freeze({ id: suppliedPolicy.id, allowlistedFields: Object.freeze([...suppliedPolicy.allowlistedFields]), neverInclude: Object.freeze([...suppliedPolicy.neverInclude]) });
  if (!strings(options.formats) || options.formats.some(f => !allowedFormats.includes(f)) || new Set(options.formats).size !== options.formats.length || !options.formats.includes(defaultFormat) || typeof defaultFilename !== 'string') {
    throw new TypeError('Explicit formats/defaultFormat/defaultFilename are required');
  }
  const formats = Object.freeze([...options.formats]);
  const doc = root.ownerDocument;
  const mime = { json: 'application/json;charset=utf-8', csv: 'text/csv;charset=utf-8', txt: 'text/plain;charset=utf-8', yaml: 'application/yaml;charset=utf-8' };
  const copy = {
    en: { title: 'Export', filename: 'Filename', format: 'Format', private: 'Include reviewed private fields (this export only)', included: 'Included in the file', excluded: 'Excluded from the file', source: 'Source and limits', preview: 'Exact file content', save: 'Save', refresh: 'Refresh preview', cancel: 'Cancel', busy: 'Building preview… Save waits for confirmed bytes.', changed: 'Choices changed. Refresh preview before Save.', context: 'Source or access changed. Review the source and refresh preview.', unavailable: 'Source unavailable or unconfirmed. Reconnect or confirm the source, then refresh.', invalidFormat: 'Choose an allowed format: JSON, CSV, TXT or YAML as offered.', invalidName: 'Use a basename of 1–128 characters: no paths, control characters, reserved names or leading/trailing spaces.', extension: 'Filename must end with the selected extension. Edit the filename, then refresh.', timeout: 'Preview exceeded 10 seconds. Check the source and explicitly refresh.', buildError: 'Could not build a confirmed preview. Check the source and refresh.', unconfirmed: 'Bytes or source metadata are unconfirmed. Confirm the source and refresh.', noData: 'No confirmed file content. Select available data and refresh.', saving: 'Handing off the confirmed preview… Wait for the adapter result.', initiated: 'Download initiated. Saving to the filesystem is not confirmed. Refresh only for a new export intent.', saved: 'Save confirmed by the download adapter.', unknown: 'Download result unconfirmed. Check the previous attempt before explicitly refreshing for a new export intent.' },
    pl: { title: 'Eksport', filename: 'Nazwa pliku', format: 'Format', private: 'Dołącz sprawdzone pola prywatne (tylko ten eksport)', included: 'W pliku jest', excluded: 'W pliku nie ma', source: 'Źródło i ograniczenia', preview: 'Dokładna zawartość pliku', save: 'Zapisz', refresh: 'Odśwież podgląd', cancel: 'Anuluj', busy: 'Przygotowywanie podglądu… Zapis wymaga potwierdzonej zawartości.', changed: 'Wybór zmieniony. Odśwież podgląd przed zapisem.', context: 'Źródło lub uprawnienia zmienione. Sprawdź źródło i odśwież podgląd.', unavailable: 'Źródło niedostępne lub niepotwierdzone. Połącz lub potwierdź źródło i odśwież.', invalidFormat: 'Wybierz dostępny format: JSON, CSV, TXT lub YAML z listy.', invalidName: 'Użyj nazwy pliku o długości 1–128 znaków: bez ścieżek, znaków sterujących, nazw zastrzeżonych i skrajnych spacji.', extension: 'Nazwa pliku musi mieć rozszerzenie wybranego formatu. Popraw nazwę i odśwież.', timeout: 'Podgląd przekroczył 10 sekund. Sprawdź źródło i jawnie odśwież.', buildError: 'Nie udało się przygotować potwierdzonego podglądu. Sprawdź źródło i odśwież.', unconfirmed: 'Zawartość lub opis źródła niepotwierdzony. Potwierdź źródło i odśwież.', noData: 'Brak potwierdzonej zawartości pliku. Wybierz dostępne dane i odśwież.', saving: 'Przekazywanie potwierdzonego podglądu… Poczekaj na wynik zapisu.', initiated: 'Pobieranie rozpoczęte. Zapis na dysku nie jest potwierdzony. Odśwież tylko dla nowej próby eksportu.', saved: 'Adapter pobierania potwierdził zapis.', unknown: 'Wynik pobierania niepotwierdzony. Sprawdź poprzednią próbę przed jawnym odświeżeniem dla nowego eksportu.' },
  };
  const css = `
[data-ha-tools-export] { min-width:0;max-width:100%;color:var(--primary-text-color,#1e293b);font:inherit; }
[data-ha-tools-export] * { box-sizing:border-box; }
[data-ha-tools-export] dialog { width:min(520px,calc(100vw - 32px));max-width:none;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);min-width:0;margin:auto;padding:0;border:1px solid var(--divider-color,#e2e8f0);border-radius:18px;background:var(--card-background-color,#fff);color:inherit;font:inherit;box-shadow:0 24px 64px #0f172a33;overflow:hidden; }
[data-ha-tools-export] dialog[open] { display:flex;flex-direction:column; }
[data-ha-tools-export] dialog::backdrop { background:#0f172a66; }
[data-ha-tools-export] .ht-export-body { min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px; }
[data-ha-tools-export] h2,[data-ha-tools-export] h3,[data-ha-tools-export] p,[data-ha-tools-export] li { overflow-wrap:anywhere;white-space:normal; }
[data-ha-tools-export] h2 { margin:0 0 16px;font-size:1.25em;line-height:1.4; }
[data-ha-tools-export] h3 { margin:16px 0 6px;font-size:1em;line-height:1.5; }
[data-ha-tools-export] p { line-height:1.5; }
[data-ha-tools-export] .ht-export-fields { display:grid;grid-template-columns:minmax(0,1fr);gap:12px; }
[data-ha-tools-export] label { display:flex;flex-direction:column;gap:6px;min-width:0;overflow-wrap:anywhere; }
[data-ha-tools-export] .ht-export-format { margin-top:16px; }
[data-ha-tools-export] .ht-export-private { flex-direction:row;align-items:center;min-height:44px;margin-top:12px; }
[data-ha-tools-export] input:not([type=checkbox]),[data-ha-tools-export] select,[data-ha-tools-export] button { font:inherit;min-width:44px;min-height:44px;max-width:100%; }
[data-ha-tools-export] input:not([type=checkbox]),[data-ha-tools-export] select { width:100%;color:inherit;background:var(--ht-export-field-bg,#f8fafc);border:1px solid var(--divider-color,#cbd5e1);border-radius:8px;padding:8px 12px; }
[data-ha-tools-export] input[type=checkbox] { width:24px;height:24px;flex:none;margin:10px; }
[data-ha-tools-export] [data-export-scope] { padding:12px 14px;border-radius:10px;margin-top:14px; }
[data-ha-tools-export] [data-export-scope] h3 { margin:0 0 6px; }
[data-ha-tools-export] [data-export-scope=included] { background:var(--ht-export-included-bg,#ecfdf3);color:var(--ht-export-included-text,#166534); }
[data-ha-tools-export] [data-export-scope=excluded] { background:var(--ht-export-excluded-bg,#fff1f2);color:var(--ht-export-excluded-text,#9f1239); }
[data-ha-tools-export] ul { padding:0;margin:0;list-style:none; }
[data-ha-tools-export] li { display:flex;gap:6px;line-height:1.5; }
[data-ha-tools-export] li + li { margin-top:4px; }
[data-ha-tools-export] [data-export-scope=included] li::before { content:'✓';flex:none; }
[data-ha-tools-export] [data-export-scope=excluded] li::before { content:'×';flex:none; }
[data-ha-tools-export] button { padding:8px 12px;white-space:normal;overflow-wrap:anywhere;cursor:pointer;border:1px solid transparent;border-radius:8px;color:var(--ht-export-accent,#0369a1);background:transparent; }
[data-ha-tools-export] [data-export=save] { color:var(--ht-export-save-text,#fff);background:var(--ht-export-accent,#0369a1); }
[data-ha-tools-export] :focus-visible { outline:3px solid var(--ht-export-accent,#0369a1);outline-offset:2px; }
[data-ha-tools-export] button:disabled { cursor:default;opacity:.6; }
[data-ha-tools-export] .ht-export-actions { display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;flex:none;padding:12px 24px;border-top:1px solid var(--divider-color,#e2e8f0);background:var(--card-background-color,#fff); }
[data-ha-tools-export] pre { max-width:100%;min-width:0;max-height:260px;overflow:auto;white-space:pre;margin:0;padding:12px;border:1px solid var(--divider-color,#cbd5e1);border-radius:8px;background:var(--ht-export-field-bg,#f8fafc); }
:host(.bento-dark) { --ht-export-field-bg:#0f172a;--ht-export-included-bg:#103827;--ht-export-included-text:#bbf7d0;--ht-export-excluded-bg:#43212a;--ht-export-excluded-text:#fda4af;--ht-export-accent:#7dd3fc;--ht-export-save-text:#0f172a; }
@media (max-width:399px) { [data-ha-tools-export] .ht-export-body { padding:16px; } [data-ha-tools-export] .ht-export-actions { padding:12px 16px;gap:6px; } }
@media (max-width:319px) { [data-ha-tools-export] dialog { width:calc(100vw - 16px); } [data-ha-tools-export] .ht-export-actions button { flex:1 1 auto; } }
`;  let container, nodes, L, ui, opener, alive = false, destroyed = false, serial = 0;
  let pending = null, handoff = null, ready = null, observed = null;
  const listeners = [];
  const on = (target, event, handler, capture = false) => {
    target.addEventListener(event, handler, capture);
    listeners.push(() => target.removeEventListener(event, handler, capture));
  };
  const contextKeys = ['role', 'userId', 'connectionId', 'datasetId', 'revision'];
  function readContext() {
    try {
      const value = getContext();
      if (!value || contextKeys.some(k => !['string', 'number'].includes(typeof value[k]) || String(value[k]).trim() === '' || (typeof value[k] === 'number' && !Number.isFinite(value[k])))) return null;
      return Object.freeze(Object.fromEntries([...contextKeys, 'connected', 'canExport', 'sourceConfirmed'].map(k => [k, value[k]])));
    } catch { return null; }
  }
  const same = (a, b) => !!a && !!b && [...contextKeys, 'connected', 'canExport', 'sourceConfirmed'].every(k => a[k] === b[k]);
  const available = c => !!c && c.connected === true && c.canExport === true && c.sourceConfirmed === true;
  const draft = () => Object.freeze({ filename: nodes.filename.value, format: nodes.format.value, includePrivate: nodes.private.checked });
  const sameDraft = (a, b) => a.filename === b.filename && a.format === b.format && a.includePrivate === b.includePrivate;
  function validation(value) {
    if (!formats.includes(value.format)) return 'invalidFormat';
    const name = value.filename;
    if (!name || [...name].length > 128 || name !== name.trim() || /[\p{Cc}\p{Cf}/\\<>:"|?*]/u.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) return 'invalidName';
    if (!name.endsWith(`.${value.format}`) || name.length <= value.format.length + 1) return 'extension';
    return null;
  }
  function status(code, message) {
    if (!alive) return;
    const result = ui.status(code); // exact existing W4 labels/icons/codes
    nodes.status.className = `ht-result-state ht-result-state--${result.code}`;
    nodes.status.dataset.resultState = result.code;
    nodes.status.replaceChildren();
    const icon = doc.createElement('span'); icon.setAttribute('aria-hidden', 'true'); icon.textContent = result.icon;
    nodes.status.append(icon, doc.createTextNode(` ${result.label}`));
    nodes.message.textContent = ` ${L[message]}`;
    nodes.save.disabled = !ready || !!pending || !!handoff;
    nodes.refresh.disabled = !!pending || !!handoff;
  }
  function stop(job) {
    if (!job) return;
    if (job.timer !== null) clearTimer(job.timer);
    job.timer = null; job.controller.abort();
  }
  function discard(resetPrivate = false) {
    serial++; stop(pending); pending = null; ready = null;
    if (alive) {
      nodes.preview.textContent = ''; nodes.included.replaceChildren(); nodes.excluded.replaceChildren(); nodes['source-limit'].textContent = '';
      if (resetPrivate) nodes.private.checked = false;
    }
  }
  function contextChanged() {
    if (!alive) return;
    observed = readContext(); discard(true);
    // Once a handoff began we cannot retract a browser download. Ignore its late
    // callback and retain the prohibition on a second write until it settles.
    if (handoff) handoff.controller.abort();
    status(root.isConnected && available(observed) ? 'unconfirmed' : 'no_data', 'context');
  }
  function validContext(original) {
    const current = readContext();
    if (!root.isConnected || !same(original, current) || !available(current)) { contextChanged(); return false; }
    return true;
  }
  function changeDraft() {
    if (!alive) return;
    if (!same(observed, readContext())) { contextChanged(); return; }
    discard();
    const error = validation(draft()); status(error ? 'error' : 'not_checked', error || 'changed');
  }
  function fillList(node, items) {
    node.replaceChildren(...items.map(text => { const li = doc.createElement('li'); li.textContent = text; return li; }));
  }
  async function refresh() {
    if (!alive || pending || handoff) return;
    const current = readContext();
    if (!same(observed, current)) { observed = current; discard(true); }
    const value = draft(), error = validation(value);
    discard();
    if (error) { status('error', error); return; }
    if (!root.isConnected || !available(current)) { status(!root.isConnected || current?.connected === false ? 'no_data' : 'unconfirmed', 'unavailable'); return; }
    observed = current;
    const job = { id: serial, context: current, draft: value, started: clock(), controller: new globalThis.AbortController(), timer: null };
    pending = job; status('not_checked', 'busy');
    const timeout = () => {
      if (!alive || pending !== job) return;
      discard(); status('unconfirmed', 'timeout');
    };
    job.timer = setTimer(timeout, 10000);
    try {
      const payload = await buildPayload(Object.freeze({ context: current, draft: value, policy, signal: job.controller.signal }));
      if (!alive || pending !== job || job.id !== serial) return;
      if (clock() - job.started >= 10000) { timeout(); return; }
      if (!validContext(current)) return;
      clearTimer(job.timer); job.timer = null;
      if (!sameDraft(value, draft())) { changeDraft(); return; }
      const { serialized, confirmed, sourceConfirmed, status: resultState, included, excluded, sourceLimit } = payload || {};
      if (resultState === 'no_data' || serialized === '') { pending = null; status('no_data', 'noData'); return; }
      if (confirmed !== true || sourceConfirmed !== true || !['success', 'partial'].includes(resultState) || typeof serialized !== 'string' || !strings(included) || !strings(excluded) || typeof sourceLimit !== 'string' || !sourceLimit.trim()) {
        pending = null; status('unconfirmed', 'unconfirmed'); return;
      }
      // Freeze the only serialized bytes and build the only Blob NOW; Save never
      // re-runs serialization or builds a second payload from potentially newer data.
      ready = Object.freeze({ serialized, blob: new globalThis.Blob([serialized], { type: mime[value.format] }), context: current, draft: value });
      nodes.preview.textContent = ready.serialized;
      fillList(nodes.included, [...included]); fillList(nodes.excluded, [...excluded]);
      nodes['source-limit'].textContent = sourceLimit;
      pending = null; status(resultState, 'changed'); nodes.message.textContent = '';
    } catch {
      if (!alive || pending !== job || job.id !== serial) return;
      if (clock() - job.started >= 10000) { timeout(); return; }
      if (!validContext(current)) return;
      discard(); status('error', 'buildError');
    }
  }
  async function save() {
    if (!alive || !ready || pending || handoff) return;
    if (!validContext(ready.context)) return;
    const value = draft(), error = validation(value);
    if (error || !sameDraft(value, ready.draft) || nodes.preview.textContent !== ready.serialized) {
      discard(); status(error ? 'error' : 'unconfirmed', error || 'changed'); return;
    }
    const snapshot = ready; ready = null; // consume intent BEFORE invoking adapter
    const job = { id: serial, context: snapshot.context, controller: new globalThis.AbortController() };
    handoff = job; status('unconfirmed', 'saving');
    // choices cannot initiate another preview while the adapter result is unknown
    for (const key of ['filename', 'format', 'private']) nodes[key].disabled = true;
    try {
      const result = await performDownload(Object.freeze({ serialized: snapshot.serialized, blob: snapshot.blob, filename: snapshot.draft.filename, format: snapshot.draft.format, context: snapshot.context, signal: job.controller.signal }));
      if (!alive || handoff !== job || job.id !== serial || !validContext(job.context)) return;
      status(result?.outcome === 'saved' ? 'success' : 'unconfirmed', result?.outcome === 'saved' ? 'saved' : result?.outcome === 'initiated' ? 'initiated' : 'unknown');
    } catch {
      if (alive && handoff === job && job.id === serial && validContext(job.context)) status('unconfirmed', 'unknown');
    } finally {
      if (handoff === job) {
        handoff = null;
        if (alive) {
          for (const key of ['filename', 'format', 'private']) nodes[key].disabled = false;
          nodes.refresh.disabled = false; nodes.save.disabled = true;
          if (job.id !== serial) status('unconfirmed', 'unknown');
        }
      }
    }
  }
  function focusable() {
    return Array.from(nodes.dialog.querySelectorAll('input,select,button,[tabindex="0"]')).filter(el => !el.disabled);
  }
  function keydown(event) {
    if (!alive) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    if (event.key === 'Tab') {
      const items = focusable(), first = items[0], last = items.at(-1);
      const active = nodes.dialog.getRootNode().activeElement || root.activeElement || doc.activeElement;
      if (event.shiftKey && (active === first || !nodes.dialog.contains(active))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (active === last || !nodes.dialog.contains(active))) { event.preventDefault(); first?.focus(); }
    }
  }
  function cancel() {
    if (!alive) return;
    discard(true); if (handoff) handoff.controller.abort();
    alive = false; listeners.splice(0).forEach(off => off());
    if (nodes.dialog.open) nodes.dialog.close();
    container.remove();
    container = null; nodes = null; observed = null;
    // A pending handoff remains latched until settled: reopening never repeats it.
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
    opener = null;
  }
  function open({ opener: target } = {}) {
    if (destroyed) throw new Error('Export dialog destroyed');
    if (alive) return;
    const language = String(getLanguage());
    L = copy[language.startsWith('pl') ? 'pl' : 'en'];
    ui = createUiV3({ language });
    opener = target || root.activeElement || doc.activeElement;
    container = doc.createElement('div'); container.setAttribute('data-ha-tools-export', '');
    // The own shadow boundary contains CSS and local IDs; adjacent W4 status
    // elements retain their existing styling. Consumers can query this open root.
    const shadow = container.attachShadow({ mode: 'open' });
    if (root.host?.classList.contains('bento-dark')) container.classList.add('bento-dark');
    const style = doc.createElement('style'); style.textContent = ':host{display:block;min-width:0;max-width:100%;}' + css + '\n' + ui.css;
    shadow.append(style);
    const shell = doc.createElement('div'); shell.setAttribute('data-ha-tools-export', ''); shadow.append(shell);
    nodes = {};
    const make = (tag, key, parent, text) => { const node = doc.createElement(tag); if (key) { node.dataset.export = key; nodes[key] = node; } if (text) node.textContent = text; parent.append(node); return node; };
    const dialog = make('dialog', 'dialog', shell); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    const body = make('div', null, dialog); body.className = 'ht-export-body';
    const title = make('h2', 'title', body, L.title);
    // Locally unique IDs, no random or global counters/persistent state.
    const prefix = `ht-export-${String(clock()).replace(/\W/g, '')}`;
    title.id = prefix + '-title'; dialog.setAttribute('aria-labelledby', title.id);
    const fields = make('div', null, body); fields.className = 'ht-export-fields';
    const filenameLabel = make('label', null, fields); make('span', null, filenameLabel, L.filename);
    const filename = make('input', 'filename', filenameLabel); filename.type = 'text'; filename.value = defaultFilename; filename.autocomplete = 'off';
    for (const key of ['included', 'excluded']) {
      const scope = make('section', null, body); scope.dataset.exportScope = key;
      make('h3', null, scope, L[key]); make('ul', key, scope);
    }
    const formatLabel = make('label', null, body); formatLabel.className = 'ht-export-format'; make('span', null, formatLabel, L.format);
    const format = make('select', 'format', formatLabel);
    formats.forEach(value => { const option = make('option', null, format, value.toUpperCase()); option.value = value; }); format.value = defaultFormat;
    const privateLabel = make('label', null, body); privateLabel.className = 'ht-export-private';
    const privateInput = make('input', 'private', privateLabel); privateInput.type = 'checkbox'; privateInput.checked = false; make('span', null, privateLabel, L.private);
    const statusLine = make('p', null, body); statusLine.setAttribute('role', 'status'); statusLine.setAttribute('aria-live', 'polite');
    make('span', 'status', statusLine); make('span', 'message', statusLine);
    make('h3', null, body, L.source); make('p', 'source-limit', body);
    const previewHeading = make('h3', null, body, L.preview); previewHeading.id = prefix + '-preview';
    const preview = make('pre', 'preview', body); preview.tabIndex = 0; preview.setAttribute('aria-labelledby', previewHeading.id);
    const actions = make('div', null, dialog); actions.className = 'ht-export-actions';
    for (const key of ['refresh', 'save', 'cancel']) { const button = make('button', key, actions, L[key]); button.type = 'button'; }
    root.append(container); alive = true; observed = readContext();
    for (const [key, event] of [['filename', 'input'], ['format', 'change'], ['private', 'change']]) on(nodes[key], event, changeDraft);
    on(nodes.refresh, 'click', refresh); on(nodes.save, 'click', save); on(nodes.cancel, 'click', cancel);
    on(dialog, 'keydown', keydown);
    on(dialog, 'cancel', event => { event.preventDefault(); cancel(); });
    on(dialog, 'close', () => { if (alive && nodes?.dialog === dialog) cancel(); });
    try {
      if (typeof dialog.showModal !== 'function') throw new Error('Native export dialog is unavailable');
      dialog.showModal();
    } catch (error) {
      cancel();
      throw error;
    }
    // The consumer supplies exact opener even when its shadow DOM hides activeElement.
    filename.focus();
    if (handoff) {
      for (const key of ['filename', 'format', 'private']) nodes[key].disabled = true;
      preview.focus();
      status('unconfirmed', 'saving');
    } else { status('not_checked', 'changed'); void refresh(); }
  }
  function destroy() { cancel(); destroyed = true; }
  return Object.freeze({ open, cancel, contextChanged, destroy });
}
// END HA TOOLS EXPORT V3

  // BEGIN SMART REPORTS EXPORT V3 source-sha256=570a233a9854b836d86500788946f6c3c4a2dbe6601cd5d2393e9e9f6fcfb1c1
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
// END SMART REPORTS EXPORT V3

// BEGIN SMART CALENDAR ha-tools-format.js
// Localized presentation; raw values remain available to callers for details/export.
function createFormatUi(language = 'en', timeZone = 'UTC', preferences = {}) {
  const hourCycle = preferences.hourCycle || 'h23';
  const dateLanguage = preferences.dateLanguage || language;
  const clockLanguage = preferences.clockLanguage || language;
  const stamp = value => typeof value === 'number' ? (Number.isFinite(value) ? value : NaN) : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  const localized = (value, options, locale = language) => {
    const time = stamp(value);
    if (!Number.isFinite(time)) return null;
    try { return new Intl.DateTimeFormat(locale, {timeZone, ...options}).format(time); } catch (_) { return null; }
  };
  const clock = (value, withOffset = false) => localized(value, {hour:'2-digit', minute:'2-digit', hourCycle, ...(withOffset ? {timeZoneName:'shortOffset'} : {})}, clockLanguage);
  const date = (value, short = false) => localized(value, {day:'numeric', month:'short', ...(short ? {} : {year:'numeric'})}, dateLanguage);
  // A calendar date has no instant or display zone. Use the selected date
  // locale but preserve its literal day, including historical tariff validity.
  const calendarDate = (value, short = false) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const instant = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) return null;
    try { return new Intl.DateTimeFormat(dateLanguage, {timeZone:'UTC', day:'numeric', month:'short', ...(short ? {} : {year:'numeric'})}).format(instant); }
    catch (_) { return null; }
  };
  const pointLabel = value => localized(value, {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle, timeZoneName:'shortOffset'}, dateLanguage);
  const chartLabels = (values, resolution = 'hour') => {
    const showDate = resolution === 'day' || values.length > 1 && stamp(values.at(-1)) - stamp(values[0]) >= 86400000;
    const labels = values.map(value => resolution === 'day' ? date(value, true) : `${showDate ? date(value, true) + ' ' : ''}${clock(value)}`);
    const counts = new Map();
    for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
    return labels.map((label, index) => counts.get(label) < 2 ? label : resolution === 'day' ? pointLabel(values[index])
      : `${showDate ? date(values[index], true) + ' ' : ''}${clock(values[index], true)}`);
  };
  // Compact 24-hour axis notation follows the display zone; full point labels
  // keep the user's clock/date preferences. Never move or discard measurements.
  const chartTicks = (values, resolution = 'hour') => {
    const labels = chartLabels(values, resolution);
    const shortHourly = resolution === 'hour' && values.length > 1 && stamp(values.at(-1)) - stamp(values[0]) <= 26 * 3600000;
    if (!shortHourly) return [...new Set([0, Math.floor((values.length-1)/2), values.length-1])]
      .filter(index => index >= 0 && index < values.length).map(index => ({index, label:labels[index]}));
    const parts = new Intl.DateTimeFormat('en-GB-u-nu-latn', {timeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
    const ticks = [];
    values.forEach((value, index) => {
      const time = stamp(value);
      if (!Number.isFinite(time)) return;
      const fields = Object.fromEntries(parts.formatToParts(time).map(part => [part.type, part.value]));
      if (Number(fields.hour) % 3 !== 0) return;
      const label = localized(value, {hour:'2-digit', ...(fields.minute === '00' ? {} : {minute:'2-digit'}), hourCycle:'h23'});
      ticks.push({index, label});
    });
    if (!ticks.length) return values.length ? [{index:0, label:labels[0]}] : [];
    const counts = new Map();
    for (const tick of ticks) counts.set(tick.label, (counts.get(tick.label) || 0) + 1);
    return ticks.map(tick => counts.get(tick.label) === 1 ? tick : {...tick, label:clock(values[tick.index], true)});
  };
  const key = JSON.stringify([language, timeZone, hourCycle, dateLanguage, clockLanguage]);
  const numbers = new Intl.NumberFormat(language);
  // Producer Decimal strings carry exact measurement/pricing precision. Keep
  // that precision in Data/details instead of Intl's default three places.
  // Explicit display options and older numeric projections retain their rules.
  const decimals = new Intl.NumberFormat(language, {maximumFractionDigits:100});
  const plurals = new Intl.PluralRules(language);
  const count = (value, forms) => `${numbers.format(value)} ${forms[plurals.select(value)] || forms.other}`;
  // Build1 R12 display roles. The ordinary number() remains exact for Data/history.
  const reportNumber=(value,places=1,signed=false)=>{
    if (typeof value==='boolean' || value===null || !['string','number'].includes(typeof value) || typeof value==='string'&&!value.trim() || !Number.isInteger(places) || places<0 || places>6) return null;
    const parsed=Number(value);if(!Number.isFinite(parsed))return null;
    const normalized=Number(parsed.toFixed(6)),n=Object.is(normalized,-0)?0:normalized;
    const text=new Intl.NumberFormat(language,{minimumFractionDigits:places,maximumFractionDigits:places,roundingMode:'halfExpand',useGrouping:'always'}).format(Math.abs(n));
    const zero=new Intl.NumberFormat(language,{minimumFractionDigits:places,maximumFractionDigits:places,useGrouping:'always'}).format(0);
    return (text===zero?signed?'±':'':n<0?'−':signed?'+':'')+text;
  };
  const reportUnknown=()=>String(language).startsWith('pl')?'Brak danych':'No data';
  const reportEnergy=(value,{role='tile',period='day'}={})=>{const n=reportNumber(value,role==='table'&&period==='day'?2:1);return n===null?reportUnknown():n+' kWh';};
  const reportMoney=(value,currency)=>{const n=reportNumber(value,2),unit=String(language).startsWith('pl')&&currency==='PLN'?'zł':currency;return n===null||typeof unit!=='string'||!unit?reportUnknown():n+' '+unit;};
  const reportRate=(value,currency)=>{const n=reportMoney(value,currency);return n===reportUnknown()?n:n+'/kWh';};
  const reportPercent=(value,{role='share'}={})=>{const n=reportNumber(value,role==='change'?1:0,role==='change');return n===null?reportUnknown():n+'%';};
  const reportPlural=(value,forms)=>{const n=Math.abs(Number(value)),key=String(language).startsWith('pl')&&Number.isFinite(n)&&!Number.isInteger(n)?'few':plurals.select(n);return forms[key]||forms.other||forms.many;};
  const dateTime = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return null;
    try { return new Intl.DateTimeFormat(dateLanguage, {timeZone, dateStyle:'medium', timeStyle:'short', hourCycle}).format(new Date(time)); }
    catch (_) { return null; }
  };
  const range = (from, to) => {
    const first = Date.parse(from), last = Date.parse(to);
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
    try {
      const day = new Intl.DateTimeFormat(dateLanguage, {timeZone, dateStyle:'medium'});
      const clock = new Intl.DateTimeFormat(clockLanguage, {timeZone, hour:'2-digit', minute:'2-digit', hourCycle});
      return day.format(first) === day.format(last)
        ? `${day.format(first)} (${clock.format(first)}–${clock.format(last)})`
        : `${dateTime(from)} – ${dateTime(to)}`;
    } catch (_) { return null; }
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const periodMarkup = ({start, end, label, source, measured, expected, unit, details = '', sourceTimeZone = ''}) => {
    const local = range(start, end);
    if (!local) return '';
    const coverage = typeof measured === 'number' && Number.isFinite(measured) && typeof expected === 'number' && Number.isFinite(expected)
      ? `${numbers.format(measured)}/${numbers.format(expected)} ${unit}` : '';
    const pl = String(language).startsWith('pl');
    return `<div class="energy-period-v4" style="overflow-wrap:anywhere"><p data-energy-period-summary>${[source, label, local, coverage, timeZone].filter(Boolean).map(escape).join(' · ')}</p><details data-energy-period-details data-energy-period-key="${escape(start + '|' + end)}"><summary style="min-height:44px;box-sizing:border-box;padding:12px 0;display:list-item;list-style-position:inside;cursor:pointer">${pl ? 'Źródło i szczegóły czasu' : 'Source and time details'}</summary><p>${escape(details)}</p>${sourceTimeZone && sourceTimeZone !== timeZone ? `<p>${escape(pl ? 'Strefa pomiarów i granic okresu' : 'Measurement calendar time zone')}: ${escape(sourceTimeZone)}</p>` : ''}<p>UTC: ${escape(start)} — ${escape(end)}</p></details></div>`;
  };
  const capturePeriods = (root, previous, current) => {
    if (!previous || ['epoch','connection','user'].some(key => previous[key] !== current[key])) return [];
    return [...root.querySelectorAll('[data-energy-period-key]')].map(element => ({
      key:element.dataset.energyPeriodKey, open:element.open, focused:root.activeElement === element.querySelector('summary')
    }));
  };
  const restorePeriods = (root, records) => {
    for (const element of root.querySelectorAll('[data-energy-period-key]')) {
      const record = records.find(row => row.key === element.dataset.energyPeriodKey);
      if (!record) continue;
      element.open = record.open;
      if (record.focused) element.querySelector('summary')?.focus({preventScroll:true});
    }
  };
  return {reportNumber, reportEnergy, reportMoney, reportRate, reportPercent, reportPlural, language, dateLanguage, clockLanguage, hourCycle, timeZone, key, clock, date, calendarDate, pointLabel, chartLabels, chartTicks, number:(value, options)=>options ? new Intl.NumberFormat(language, options).format(value) : (typeof value === 'string' ? decimals : numbers).format(value), count, dateTime, range, periodMarkup, capturePeriods, restorePeriods};
}
// Presentation follows the HA profile; measurement and tariff calendars remain separate.
createFormatUi.forHass = hass => {
  const locale = hass?.locale || {};
  const systemLanguage = typeof navigator !== 'undefined' ? navigator.language : undefined;
  const language = locale.language || hass?.language || systemLanguage || 'en';
  const validZone = value => {
    if (typeof value !== 'string' || !(value === 'UTC' || value.includes('/')) || /^[+-]/.test(value)) return null;
    try { new Intl.DateTimeFormat('en', {timeZone:value}).format(0); return value; } catch (_) { return null; }
  };
  let systemZone, systemLocale;
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    systemZone = validZone(resolved.timeZone);
    // Device region can differ from navigator's preferred content language.
    systemLocale = resolved.locale;
  } catch (_) {}
  const systemRegion = systemLocale || systemLanguage || language;
  const serverZone = validZone(hass?.config?.time_zone);
  const timeZone = (locale.time_zone === 'server' ? serverZone : systemZone) || serverZone || 'UTC';
  const clockLanguage = locale.time_format === 'system' ? systemRegion : language;
  const hourCycle = locale.time_format === '12' ? 'h12' : locale.time_format === '24' ? 'h23'
    : new Intl.DateTimeFormat(clockLanguage, {hour:'numeric'}).resolvedOptions().hourCycle;
  return createFormatUi(language, timeZone, {hourCycle, clockLanguage, dateLanguage:locale.date_format === 'system' ? systemRegion : language});
};
// Node tests use the canonical factory; vendored cards keep it local.
if (typeof module !== 'undefined') module.exports = {createFormatUi};

// END SMART CALENDAR ha-tools-format.js
// BEGIN SMART CALENDAR ha-tools-energy-analysis.js
"use strict";

// Read-only schema2 transport. The card owns event invalidation and visible refresh.
function createEnergyAnalysisV53({card, onChange = () => {}, refreshMs = 300000}) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const decimal = value => value === null || typeof value === 'number' && Number.isFinite(value) ||
    typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
  const stamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  const ttl = Number.isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 300000;
  let mounted = false, epoch = 0, identity = null, raw = null, queued = null, cache = null;
  let view = {status:'idle', selection:null, snapshot:null, error:null};
  const emit = () => { try { onChange(copy(view)); } catch (_) { /* Consumer failures do not poison the wire. */ } };
  const set = (status, selection = null, snapshot = null, error = null) => {
    view = {status, selection:selection && copy(selection), snapshot, error}; emit();
  };
  const context = () => {
    const h = card?._hass;
    return {connection:h?.connection, user:h?.user?.id, active:h?.user?.is_active, admin:h?.user?.is_admin, online:h?.connected, zone:h?.config?.time_zone,
      available:mounted && card?.isConnected !== false && !!h?.user?.id && h.user.is_active !== false &&
        h.connected !== false && !!h.connection && h.connection.connected !== false && typeof h.callWS === 'function'};
  };
  const equal = (a,b) => a && b && a.connection === b.connection && a.user === b.user &&
    a.zone === b.zone && a.active === b.active && a.admin === b.admin && a.online === b.online && a.available === b.available;
  const clear = () => {
    epoch++; cache = null;
    const abandoned = queued; queued = null;
    view = {status:'idle',selection:null,snapshot:null,error:null};
    if (abandoned) abandoned.resolve(copy(view));
  };
  const observe = () => {
    const next = context();
    if (!equal(identity,next)) { clear(); identity = next; }
    return next;
  };
  const state = () => { observe(); return copy(view); };
  const normalize = (selection, ctx) => {
    if(object(selection)&&selection.kind==='patterns'){
      if(!Number.isInteger(selection.days)||![7,30].includes(selection.days))throw Error('invalid_patterns_selection');
      return {kind:'patterns',days:selection.days};
    }
    if(object(selection)&&Object.hasOwn(selection,'kind'))throw Error('invalid_analysis_selection');
    if (!object(selection) || !['day','week','month','year'].includes(selection.period)) throw Error('invalid_analysis_selection');
    const result = {period:selection.period};
    if (Object.hasOwn(selection,'anchor')) {
      const a = selection.anchor;
      if (typeof a !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a) || !Number.isFinite(Date.parse(a)) ||
        new Date(a).toISOString().slice(0,10) !== a || a.slice(0,4) === '0000') throw Error('invalid_analysis_anchor');
      let today;
      try {
        const parts = new Intl.DateTimeFormat('en-US',{timeZone:ctx.zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
        const fields = Object.fromEntries(parts.map(p=>[p.type,p.value]));
        today = `${fields.year.padStart(4,'0')}-${fields.month}-${fields.day}`;
      } catch (_) { throw Error('measurement_timezone_unavailable'); }
      if (a > today) throw Error('future_analysis_anchor');
      result.anchor = a;
    }
    if (Object.hasOwn(selection,'comparison')) {
      const allowed = result.period === 'day' ? ['previous','same_weekday','mean7'] : ['previous','year_ago'];
      if (!allowed.includes(selection.comparison)) throw Error('invalid_analysis_comparison');
      result.comparison = selection.comparison;
    }
    return result;
  };
  // Additive HA facts are separate from tariff-book totals. Reject malformed facts
  // before caching: neither a current price nor a partial amount is a period bill.
  const validateNativePricing = native => {
    if (native === null || native === undefined) return true;
    const keys = (v, allowed) => object(v) && Object.keys(v).every(k=>allowed.includes(k));
    const text = v => typeof v === 'string' && v.length > 0 && v.length <= 256;
    const reason = v => v === null || text(v);
    const amount = v => v === null || typeof v === 'string' && v.length <= 1024 && decimal(v);
    const currency = v => v === null || typeof v === 'string' && /^[A-Z]{3}$/.test(v);
    const integer = v => Number.isSafeInteger(v) && v >= 0;
    if (!keys(native,['schema','source','period_cost','current_prices','provenance']) || native.schema !== 1 || native.source !== 'ha_energy' ||
      !Array.isArray(native.current_prices) || native.current_prices.length > 512 || !Array.isArray(native.provenance) || native.provenance.length > 512) return false;
    const p=native.period_cost, c=p?.coverage;
    if (!keys(p,['status','amount','recorded_amount','currency','scope','coverage','components_status','fixed_fees_status','reason']) ||
      !['ready','partial','unavailable','not_configured'].includes(p.status) || !amount(p.amount) || !amount(p.recorded_amount) || !currency(p.currency) ||
      p.scope !== 'grid_import_recorded_cost' || p.components_status !== 'unknown' || p.fixed_fees_status !== 'unknown' || !reason(p.reason) ||
      !keys(c,['complete','expected_source_hours','measured_source_hours']) || typeof c.complete !== 'boolean' || !integer(c.expected_source_hours) ||
      !integer(c.measured_source_hours) || c.measured_source_hours > c.expected_source_hours ||
      c.complete !== (c.expected_source_hours > 0 && c.measured_source_hours === c.expected_source_hours)) return false;
    if (p.status === 'ready' ? !c.complete || p.amount === null || p.recorded_amount === null || p.currency === null || p.reason !== null : p.amount !== null || c.complete) return false;
    if (p.status === 'partial' && (p.recorded_amount === null || p.currency === null) ||
      ['unavailable','not_configured'].includes(p.status) && p.recorded_amount !== null) return false;
    return native.current_prices.every(row=>keys(row,['source_id','origin','price','currency','energy_unit','observed_at','historical','status','reason']) &&
      text(row.source_id) && ['number_energy_price','entity_energy_price'].includes(row.origin) && amount(row.price) && currency(row.currency) &&
      row.energy_unit === 'kWh' && Number.isFinite(stamp(row.observed_at)) && row.historical === false && reason(row.reason) &&
      (row.status === 'ready' ? row.price !== null && row.currency !== null && row.reason === null : row.status === 'unavailable' && row.price === null)) &&
      native.provenance.every(row=>keys(row,['energy_source_id','cost_statistic_id']) && text(row.energy_source_id) && (row.cost_statistic_id === null || text(row.cost_statistic_id)));
  };
  const validate = (dto, selection, ctx) => {
    if (!object(dto) || dto.schema !== 2 || !hash(dto.snapshot_id) || !hash(dto.measurement_fingerprint) ||
      !Number.isFinite(stamp(dto.generated_at)) || !object(dto.context) || dto.context.measurement_timezone !== ctx.zone ||
      dto.context.period_kind !== selection.period || !object(dto.period) || dto.period.kind !== selection.period ||
      dto.period.timezone !== ctx.zone || !Number.isFinite(stamp(dto.period.start)) ||
      !Number.isFinite(stamp(dto.period.end)) || stamp(dto.period.end) <= stamp(dto.period.start) ||
      stamp(dto.period.end) > stamp(dto.generated_at) || !object(dto.totals) ||
      !['ready','partial'].includes(dto.status) || !object(dto.chart) || !Array.isArray(dto.chart.bins) ||
      dto.chart.timezone !== ctx.zone || !['ready','unknown'].includes(dto.chart.status) ||
      dto.chart.grain !== ({day:'hour',week:'day',month:'day',year:'month'})[selection.period] ||
      !dto.chart.bins.every(bin=>object(bin) && Number.isFinite(bin.from) && Number.isFinite(bin.to) && bin.to > bin.from &&
        Number.isFinite(stamp(bin.start)) && Number.isFinite(stamp(bin.end))) ||
      !object(dto.groups) || !['devices','areas','floors','unassigned','unmeasured'].every(k=>object(dto.groups[k]))) return false;
    if (selection.anchor && (!Number.isFinite(stamp(dto.period.local_start)) ||
      // Weekly/monthly/yearly anchors may be normalized to the period start by HA.
      dto.period.local_start.slice(0,10) > selection.anchor ||
      !Number.isFinite(stamp(dto.period.calendar_local_end)) ||
      selection.anchor >= dto.period.calendar_local_end.slice(0,10) ||
      dto.context.period_anchor !== dto.period.local_start.slice(0,10))) return false;
    if (selection.comparison && (dto.context.comparison_kind !== selection.comparison ||
      !object(dto.comparisons) || !object(dto.comparisons[selection.comparison]))) return false;
    if (!['kwh','energy_cost','variable_cost','usage_cost','fixed_cost','total_cost','effective_price'].every(k=>Object.hasOwn(dto.totals,k) && decimal(dto.totals[k]))) return false;
    // Validate finite numeric leaves, including money nested in groups/comparisons,
    // without converting or rounding any server value. Bound traversal as well.
    // Supported annual hours plus 512 consumers and their room/floor comparison
    // rows exceed 200k leaves; leave room for the bounded 32-version tariff DTO.
    let count = 0;
    const walk = (value, key = '', depth = 0) => {
      if (++count > 2000000 || depth > 40) return false;
      // Producer reconciliation evidence is boolean metadata, not a kWh amount.
      if (key === 'reconciles_recorded_kwh') return typeof value === 'boolean';
      if (value === null) return true;
      if (typeof value === 'number') return Number.isFinite(value);
      const money = /(?:^|_)(?:kwh|cost|rate|price)$/.test(key) || /^(?:energyRate|variableRate|fixedMonthly|fixed_monthly|legacy_combined_monthly)$/.test(key);
      if (money && !object(value) && !Array.isArray(value)) return decimal(value);
      if (Array.isArray(value)) return value.every(v=>walk(v,'',depth+1));
      if (object(value)) return Object.entries(value).every(([k,v])=>walk(v,k,depth+1));
      return ['string','boolean'].includes(typeof value);
    };
    return validateNativePricing(dto.native_pricing) && walk(dto);
  };
  const validatePatterns = (dto, selection, ctx) => {
    const hour=3600000,calendarDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
      Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
    const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
    const localDate=value=>{
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:ctx.zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
      const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${fields.year.padStart(4,'0')}-${fields.month}-${fields.day}`;
    };
    if(!object(dto)||dto.schema!==2||dto.kind!=='patterns'||!hash(dto.snapshot_id)||!hash(dto.measurement_fingerprint)||
      !Number.isFinite(stamp(dto.generated_at))||!['ready','partial'].includes(dto.status)||
      ['period','groups','buckets','alternatives'].some(k=>Object.hasOwn(dto,k))||!object(dto.context)||!object(dto.window)||!object(dto.patterns))return false;
    const c=dto.context,w=dto.window,p=dto.patterns,start=stamp(w.start),end=stamp(w.end),generated=stamp(dto.generated_at);
    if(c.request_kind!=='patterns'||c.access_purpose!=='analysis'||c.patterns_days!==selection.days||c.measurement_timezone!==ctx.zone||
      !hash(c.window_signature)||!hash(c.source_signature)||!hash(c.grid_source_signature)||
      !['entry_id','service_generation'].every(k=>typeof c[k]==='string'&&c[k].length>0&&c[k].length<=256)||
      !['tariff_revision','feature_access_revision','registry_revision'].every(k=>integer(c[k]))||
      w.status!=='ready'||w.reason!==null||w.kind!=='rolling_local_dates'||w.days!==selection.days||w.timezone!==ctx.zone||
      !calendarDate(w.first_date)||!calendarDate(w.last_date)||Number(w.first_date.slice(0,4))<1900||Number(w.last_date.slice(0,4))>2200||typeof w.boundary_complete!=='boolean'||
      !Number.isFinite(start)||!Number.isFinite(end)||end<=start||start%hour!==0||end%hour!==0||
      stamp(w.query_start)!==start||stamp(w.query_end)!==end||Math.floor(generated/hour)*hour!==end||
      !integer(w.hours,768)||w.hours<=0||(end-start)/hour!==w.hours||!Number.isFinite(stamp(w.requested_local_start))||
      Math.ceil(stamp(w.requested_local_start)/hour)*hour!==start||w.boundary_complete!==(stamp(w.requested_local_start)===start)||w.requested_local_start.slice(0,10)!==w.first_date||
      !Array.isArray(p.days)||p.days.length<1||p.days.length>selection.days||!Array.isArray(p.hours)||p.hours.length!==w.hours||
      !Array.isArray(p.weekdays)||p.weekdays.length!==7||p.rounding_stage!=='period_components_then_day_then_hour'||
      p.fixed_fee_scope!=='household_period_only'||typeof p.partial_window!=='boolean'||
      !Array.isArray(dto.rates)||dto.rates.length>32||!object(dto.fees)||dto.fees.scope!=='household_period_only'||
      !object(dto.totals)||!object(dto.coverage)||!Array.isArray(dto.issues))return false;
    try{
      if(localDate(end-hour)!==w.last_date||new Date(Date.parse(w.last_date)-(selection.days-1)*86400000).toISOString().slice(0,10)!==w.first_date)return false;
      const dates=new Map(),ids=new Set();
      const numeric=['kwh','recorded_kwh','energy_cost','variable_cost','legacy_combined_cost','usage_cost'];
      const costs=known=>object(known)&&['energy_cost','variable_cost','legacy_combined_cost'].every(k=>Object.hasOwn(known,k)&&decimal(known[k]));
      const rowBase=row=>object(row)&&Number.isSafeInteger(row.from)&&Number.isSafeInteger(row.to)&&row.to>row.from&&row.from>=start&&row.to<=end&&
        stamp(row.start)===row.from&&stamp(row.end)===row.to&&stamp(row.local_start)===row.from&&stamp(row.local_end)===row.to&&
        row.timezone===ctx.zone&&calendarDate(row.local_date)&&localDate(row.from)===row.local_date&&
        (row.fold===0||row.fold===1)&&typeof row.complete==='boolean'&&numeric.every(k=>Object.hasOwn(row,k)&&decimal(row[k]))&&
        costs(row.known_costs)&&(row.currency===null||typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency))&&(row.price_basis===null||['gross','net'].includes(row.price_basis))&&
        !Object.hasOwn(row,'fixed_cost')&&!Object.hasOwn(row,'total_cost');
      let previous=null;
      for(const row of p.days){
        if(!rowBase(row)||row.id!==row.local_date||row.id<w.first_date||row.id>w.last_date||dates.has(row.id)||
          previous!==null&&row.from<previous||!Number.isSafeInteger(row.calendar_from)||!Number.isSafeInteger(row.calendar_to)||row.calendar_to<=row.calendar_from||
          row.from<row.calendar_from-hour||row.to>row.calendar_to+hour||typeof row.calendar_complete!=='boolean'||
          !integer(row.expected_seconds,172800)||row.expected_seconds!==(row.calendar_to-row.calendar_from)/1000||
          !integer(row.measured_seconds,172800)||row.measured_seconds>row.expected_seconds+3600||
          row.complete&&(row.kwh===null||!row.calendar_complete||row.from!==row.calendar_from||row.to!==row.calendar_to||row.status!=='ready')||
          !row.complete&&(row.kwh!==null||row.status!=='partial'||['energy_cost','variable_cost','legacy_combined_cost','usage_cost'].some(k=>row[k]!==null)))return false;
        dates.set(row.id,{row,first:null,last:null});previous=row.to;
      }
      let cursor=start;
      for(const row of p.hours){
        if(!rowBase(row)||row.id!==String(row.from)||ids.has(row.id)||row.from!==cursor||row.to-row.from!==hour||
          row.expected_seconds!==3600||row.measured_seconds!==(row.complete?3600:0)||!dates.has(row.local_date)||
          row.complete&&(row.kwh===null||row.status!=='ready')||!row.complete&&(row.kwh!==null||row.status!=='unknown')||
          !object(row.raw_costs)||!costs(row.raw_costs)||typeof row.crosses_local_date!=='boolean'||!Array.isArray(row.tariff_zones))return false;
        ids.add(row.id);cursor=row.to;const day=dates.get(row.local_date);if(day.first===null)day.first=row.from;day.last=row.to;
      }
      if(cursor!==end||[...dates.values()].some(d=>d.first!==d.row.from||d.last!==d.row.to)||
        p.represented_days!==p.days.length||p.measured_days!==p.days.filter(d=>d.recorded_kwh!==null).length||
        p.complete_days!==p.days.filter(d=>d.complete).length)return false;
      const weekdays=new Set();
      for(const row of p.weekdays){if(!object(row)||!integer(row.weekday,6)||weekdays.has(row.weekday)||!integer(row.count,selection.days)||
        !decimal(row.kwh)||row.count===0&&row.kwh!==null||row.count>0&&row.kwh===null)return false;weekdays.add(row.weekday);}
    }catch(_){return false;}
    let count=0;
    const walk=(value,key='',depth=0)=>{
      if(++count>500000||depth>24)return false;
      if(value===null)return true;
      if(typeof value==='number')return Number.isFinite(value);
      if((/(?:^|_)(?:kwh|cost|rate|price)$/.test(key)||['energyRate','variableRate','subscription','capacity','distribution','other','legacy_combined_monthly','fixedMonthly'].includes(key))&&!object(value)&&!Array.isArray(value))return decimal(value)&&String(value).length<=1024;
      if(Array.isArray(value))return value.length<=10000&&value.every(v=>walk(v,'',depth+1));
      if(object(value))return Object.entries(value).every(([k,v])=>k.length<=256&&walk(v,k,depth+1));
      return typeof value==='boolean'||typeof value==='string'&&value.length<=16384;
    };
    return ['kwh','energy_cost','variable_cost','usage_cost','fixed_cost','total_cost','effective_price'].every(k=>Object.hasOwn(dto.totals,k)&&decimal(dto.totals[k]))&&walk(dto);
  };
  const current = job => mounted && job.epoch === epoch && equal(job.context, observe());
  const pump = () => {
    if (raw || !queued) return;
    const job = queued; queued = null;
    if (!current(job)) { job.resolve(state()); return; }
    raw = job;
    const h = card._hass;
    let request;
    try { request = Promise.resolve(h.callWS(job.selection.kind==='patterns'?{type:'ha_tools_email/energy_patterns',days:job.selection.days}:{type:'ha_tools_email/energy_analysis',...job.selection})); }
    catch (error) { request = Promise.reject(error); }
    // Both settlement branches are attached immediately; stale errors never escape.
    request.then(dto => {
      if (!current(job)) return;
      if (!(job.selection.kind==='patterns'?validatePatterns(dto,job.selection,job.context):validate(dto,job.selection,job.context))) throw Error(job.selection.kind==='patterns'?'invalid_patterns_response':'invalid_analysis_response');
      const snapshot = copy(dto);
      cache = {key:job.key,at:Date.now(),snapshot};
      set('ready',job.selection,snapshot);
    }).catch(error => {
      if (current(job)) { cache = null; set('error',job.selection,null,
        typeof error?.code === 'string' ? error.code : ['invalid_analysis_response','invalid_patterns_response'].includes(error?.message) ? error.message : 'energy_analysis_unavailable'); }
    }).then(() => {
      if (raw === job) raw = null;
      job.resolve(state()); pump();
    });
  };
  const read = selection => {
    const ctx = observe();
    let selected;
    try { selected = normalize(selection,ctx); }
    catch (error) { clear(); set('error',null,null,error.message); return Promise.resolve(state()); }
    if (!ctx.available || typeof ctx.zone !== 'string' || !ctx.zone) return Promise.resolve(state());
    const key = JSON.stringify(selected);
    if (cache?.key === key && Date.now() >= cache.at && Date.now()-cache.at < ttl) return Promise.resolve(state());
    if (queued?.key === key && queued.epoch === epoch) return queued.promise.then(copy);
    if (raw?.key === key && raw.epoch === epoch) return raw.promise.then(copy);
    clear();
    let resolve;
    const promise = new Promise(done=>{resolve=done;});
    queued = {selection:selected,key,context:ctx,epoch,promise,resolve};
    set('loading',selected); pump(); return promise.then(copy);
  };
  const invalidate = () => { clear(); observe(); emit(); };
  const connect = () => { if (!mounted) { mounted = true; observe(); } };
  const disconnect = () => { mounted = false; clear(); identity = context(); emit(); };
  return {read,invalidate,connect,disconnect,state};
}
if (typeof module !== 'undefined' && module.exports) module.exports = {createEnergyAnalysisV53};

// END SMART CALENDAR ha-tools-energy-analysis.js
// BEGIN SMART CALENDAR ha-tools-energy-analysis-binding.js
'use strict';
// Only an active analysis view owns these subscriptions; never auto-load cards.
function createEnergyAnalysisBindingV53({card, controller, onInvalidate = () => {}}) {
  let generation=0, intent=0, identity=null, activation=null, enabled=false, failure=null, access='pending', probe=null;
  const subscriptions=new Set();
  const context=()=>({connection:card?._hass?.connection,user:card?._hass?.user?.id,
    active:card?._hass?.user?.is_active,admin:card?._hass?.user?.is_admin,online:card?._hass?.connected,zone:card?._hass?.config?.time_zone,available:card?.isConnected!==false &&
    card?._hass?.connected!==false && card?._hass?.connection?.connected!==false && card?._hass?.user?.is_active!==false && !!card?._hass?.user?.id});
  const same=(a,b)=>a && b && a.connection===b.connection && a.user===b.user &&
    a.zone===b.zone && a.active===b.active && a.admin===b.admin && a.online===b.online && a.available===b.available;
  const stop=()=>{
    generation++;intent++;enabled=false;identity=null;activation=null;failure=null;access='pending';probe=null;
    for(const unsubscribe of subscriptions) {try{unsubscribe();}catch(_){} }
    subscriptions.clear();controller.disconnect();
  };
  const start=()=>{
    const next=context();
    if(enabled && same(identity,next))return activation;
    stop();
    if(!next.available)return Promise.resolve(false);
    if(typeof next.connection?.subscribeMessage!=='function') {failure='analysis_subscription_unavailable';return Promise.resolve(false);}
    enabled=true;identity=next;controller.connect();
    const token=generation;
    const current=()=>enabled && token===generation && same(next,context());
    activation=Promise.resolve().then(()=>{
      if(!current())return null;
      return next.connection.subscribeMessage(()=>{
        if(!current() || access!=='ack')return;
        controller.invalidate();onInvalidate();
      },{type:'ha_tools_email/subscribe_analysis_updates'});
    }).then(unsubscribe=>{
      if(typeof unsubscribe!=='function') {if(current())throw Error('analysis_subscription_unavailable');return false;}
      if(!current()){try{unsubscribe();}catch(_){}return false;}
      subscriptions.add(unsubscribe);access='ack';return true;
    }).catch(error=>{
      if(current() && error?.code==='unknown_command') {access='probe';return true;}
      if(current()){stop();failure='analysis_subscription_unavailable';}return false;
    });
    return activation;
  };
  const read=async selection=>{
    const ready=start(), selected=++intent;
    if(await ready && enabled && selected===intent && same(identity,context())) {
      if(access==='ack')return controller.read(selection);
      if(selection?.kind==='patterns'){stop();failure='patterns_backend_upgrade_required';return observe();}
      if(access==='legacy')return observe();
      if(access==='probe' || access==='probing') {
        // Share the single controller probe across selection changes. Observe
        // masks synchronous controller onChange until classification finishes.
        if(!probe) {
          access='probing';
          const token=generation;
          probe=(async()=>{
            const result=await controller.read(selection);
            if(token!==generation || !enabled || !same(identity,context()))return;
            if(result.status==='error' && result.error==='unknown_command') {
              access='legacy';return;
            }
            stop();failure='analysis_subscription_unavailable';
          })();
        }
        await probe;
      }
    }
    return observe();
  };
  const observe=()=>{
    if(enabled && !same(identity,context()))stop();
    if(enabled && access!=='ack' && access!=='legacy')return {status:'loading',selection:null,snapshot:null,error:null};
    return failure ? {status:'error',selection:null,snapshot:null,error:failure} : controller.state();
  };
  // A confirmed tariff revision or existing guard invalidation uses this path.
  const invalidate=()=>{controller.invalidate();if(enabled)onInvalidate();};
  return {read,observe,stop,invalidate};
}
if(typeof module!=='undefined' && module.exports)module.exports={createEnergyAnalysisBindingV53};

// END SMART CALENDAR ha-tools-energy-analysis-binding.js
// BEGIN SMART CALENDAR ha-tools-energy-analysis-view.js
// Pure schema-2 presentation. The owner supplies snapshots and binds data-analysis-action.
if (typeof module !== 'undefined' && module.exports) var {createFormatUi} = require('./ha-tools-format.js');
var energyAnalysisFlowIdV53 = 0;
function createEnergyAnalysisViewV53({card, format} = {}) {
  const flowHatchId='analysis-flow-hatch-'+(++energyAnalysisFlowIdV53);
  const ui = format || createFormatUi.forHass(card?._hass);
  const language = card?._hass?.locale?.language || card?._hass?.language || 'en';
  const pl = String(language).startsWith('pl');
  const t = (en, polish) => pl ? polish : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const unknown = () => t('No data', 'Brak danych');
  const valid = value => typeof value === 'string' ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value)) : typeof value === 'number' && Number.isFinite(value);
  // Pass Decimal strings directly to the shared Intl formatter. Never reprice or round a bill here.
  const number = (value, options) => valid(value) ? ui.number(value, options) : unknown();
  const quantity = (value, unit = 'kWh', signed = false) => valid(value)
    ? `${signed && !String(value).startsWith('-') && /[1-9]/.test(String(value).split(/[eE]/)[0]) ? '+' : ''}${number(value)}${unit === '%' ? '' : ' '}${unit}` : unknown();
  const money = (value, currency, signed = false) => quantity(value, currency || t('currency unknown','waluta nieznana'), signed);
  // Presentation only: exact server values remain in Data and named details.
  const briefNumber=(value,places,minimum=places,signed=false)=>{
    if(!valid(value))return unknown();
    const options={minimumFractionDigits:minimum,maximumFractionDigits:places};
    const shown=number(value,options),direction=compare(value,'0');
    if(direction && shown.replace(/^[-+−]/,'')===number('0',options))
      return (direction<0?'>−':'<')+number(places===0?'1':'0.'+'0'.repeat(places-1)+'1',options);
    return (signed&&direction>0?'+':'')+shown;
  };
  const briefEnergy=(value,signed=false)=>valid(value)?`${briefNumber(value,1,1,signed)} kWh`:unknown();
  const briefMoney=(value,currency,signed=false)=>valid(value)?`${briefNumber(value,2,2,signed)} ${pl&&currency==='PLN'?'zł':currency||t('currency unknown','waluta nieznana')}`:unknown();
  const briefRate=(value,currency)=>valid(value)?`${briefNumber(value,4,2)} ${pl&&currency==='PLN'?'zł':currency||t('currency unknown','waluta nieznana')}`:unknown();
  const briefPercent=value=>valid(value)?ui.number(value,{style:'percent',maximumFractionDigits:0}).replace(/\s+(?=%)/g,''):unknown();
  const dateTime = value => {
    // Dynamic tariffs allow epoch milliseconds as well as ISO instants.
    if (typeof value === 'number') {
      const instant = new Date(value);
      value = Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
    }
    return ui.dateTime(value) || unknown();
  };
  const range = period => ui.range(period?.start, period?.end) || unknown();
  // Calendar-only dates retain their day while following the user's date locale.
  const date = (value, short = false) => {
    if (typeof value !== 'string') return unknown();
    return (/^\d{4}-\d{2}-\d{2}$/.test(value) ? ui.calendarDate(value, short) : ui.date(value, short)) || unknown();
  };
  const basis = value => value === 'gross' ? t('gross','brutto') : value === 'net' ? t('net','netto') : unknown();
  const percentage = value => valid(value) ? ui.number(value, {style:'percent',maximumFractionDigits:1}) : unknown();
  const coverage = value => {
    if (valid(value)) return percentage(value);
    if (!value) return unknown();
    if (valid(value.ratio)) return percentage(value.ratio);
    if (valid(value.observed_hours) && valid(value.expected_hours)) return `${number(value.observed_hours)} / ${number(value.expected_hours)} ${t('hours','godzin')}`;
    if (valid(value.measured_source_seconds) && valid(value.expected_source_seconds)) return `${number(value.measured_source_seconds)} / ${number(value.expected_source_seconds)} s`;
    return unknown();
  };
  const table = (caption, columns, rows, attrs = '', rowAttribute = '') => `<div class="analysis-table-wrap"><table ${attrs}><caption>${esc(caption)}</caption><thead><tr>${columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row,rowIndex)=>`<tr${rowAttribute ? ` ${rowAttribute}="${rowIndex}"` : ''}>${row.map((cell,i)=>`<${i ? 'td' : 'th scope="row"'}>${cell}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}">${esc(unknown())}</td></tr>`}</tbody></table></div>`;
  const button = (action, value, label, selected) => `<button type="button" data-analysis-action="${action}" data-analysis-value="${esc(value)}"${selected === undefined ? '' : ` aria-pressed="${selected}"`}>${esc(label)}</button>`;
  const select = (action, label, choices, selected) => `<label>${esc(label)}<select data-analysis-action="${action}" data-analysis-value="${esc(selected)}">${choices.map(([value,text])=>`<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const periods = [['day',t('Day','Dzień')],['week',t('Week','Tydzień')],['month',t('Month','Miesiąc')],['year',t('Year','Rok')]];
  const comparisons = {previous:t('Previous period','Poprzedni okres'),same_weekday:t('Same weekday','Ten sam dzień tygodnia'),mean7:t('Mean of 7 previous days','Średnia z 7 poprzednich dni'),year_ago:t('Same period last year','Ten sam okres rok temu')};
  const groupLabel = (groups, level, id) => {
    const devices = groups?.devices || {};
    if (level === 'devices') return devices[id]?.name || t('Unnamed device','Urządzenie bez nazwy');
    if (id === '__no_floor__') return t('No floor','Bez piętra');
    const key = level === 'areas' ? 'area' : 'floor';
    return Object.values(devices).find(row=>row[key+'_id'] === id && row[key+'_name'])?.[key+'_name'] || t('Unnamed group','Grupa bez nazwy');
  };
  // Exact ordering of server decimal values; Number conversion is reserved for bar geometry below.
  const parts = value => {
    const text=String(value), match=/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
    const digits=(match[2]+(match[3] || '')).replace(/^0+/,'');
    return {sign:!digits?0:match[1]==='-'?-1:1,digits,
      magnitude:digits.length+Number(match[4] || 0)-(match[3] || '').length};
  };
  const compare = (a,b) => {
    const x=parts(a),y=parts(b);
    if(x.sign!==y.sign)return x.sign-y.sign;
    if(!x.sign)return 0;
    const size=Math.max(x.digits.length,y.digits.length);
    const xd=x.digits.padEnd(size,'0'),yd=y.digits.padEnd(size,'0');
    return x.sign*(x.magnitude-y.magnitude || (xd>yd?1:xd<yd?-1:0));
  };
  const rowsFor = (groups, level, metadata = groups) => {
    const rows = Object.entries(groups?.[level] || {}).map(([id,row])=>({id,label:groupLabel(metadata,level,id),row}));
    rows.sort((a,b)=> valid(a.row.kwh) && valid(b.row.kwh) ? compare(b.row.kwh,a.row.kwh) : valid(a.row.kwh) ? -1 : valid(b.row.kwh) ? 1 : 0);
    if (level === 'areas' && groups?.unassigned) rows.push({id:'unassigned',label:t('No room','Bez pokoju'),row:groups.unassigned});
    if (groups?.unmeasured) rows.push({id:'unmeasured',label:t('Unmeasured','Niezmierzone'),row:groups.unmeasured});
    return rows;
  };
  const width = (value, max) => valid(value) && Number.isFinite(Number(value)) && max > 0 ? Math.min(100,Math.abs(Number(value))/max*100) : 0;
  const maximum = values => Math.max(0,...values.filter(valid).map(value=>Math.abs(Number(value))).filter(Number.isFinite));
  const nativeCostLabel = () => t('Cost recorded in HA','Koszt zapisany w HA');
  const nativeDisclaimer = () => t('Source: Home Assistant Energy, recorded grid-import cost. Cost breakdown and fixed fees are unknown; this is not a complete bill.',
    'Źródło: Home Assistant Energy, zapisany koszt poboru z sieci. Rozbicie kosztu i opłaty stałe są nieznane; to nie jest pełny rachunek.');
  const nativeFacts = snapshot => !snapshot.active_tariff_id && snapshot.native_pricing?.schema === 1 && snapshot.native_pricing.source === 'ha_energy' ? snapshot.native_pricing : null;
  const nativeComplete = snapshot => {
    const p=nativeFacts(snapshot)?.period_cost;
    return p?.status === 'ready' && p.coverage?.complete === true && valid(p.amount) && /^[A-Z]{3}$/.test(p.currency || '') ? p : null;
  };
  const nativeMoney = p => `${number(p.amount,{minimumFractionDigits:2,maximumFractionDigits:2})} ${p.currency}`;
  const nativeDetails = snapshot => {
    const native=nativeFacts(snapshot); if (!native) return '';
    const p=native.period_cost, complete=nativeComplete(snapshot), c=p.coverage;
    const label=complete?nativeCostLabel():p.status==='partial'?t('Partial cost recorded in HA','Niepełny koszt zapisany w HA'):t('HA recorded cost unavailable','Zapisany koszt HA niedostępny');
    const value=complete?nativeMoney(complete):p.status==='partial'?money(p.recorded_amount,p.currency):unknown();
    const prices=native.current_prices.map(row=>[esc(row.source_id),esc(row.status==='ready'?money(row.price,row.currency)+'/kWh':unknown()),esc(dateTime(row.observed_at))]);
    return `<section data-analysis-native-pricing><h4>${esc(label)}</h4><p><strong>${esc(value)}</strong>${p.status==='partial'?' · '+esc(t('Recorded subset only; full-period cost unavailable','Tylko zapisany podzbiór; koszt całego okresu niedostępny')):''}</p><p class="analysis-note">${esc(nativeDisclaimer())}</p>
      <details data-analysis-native-details><summary>${esc(t('Exact HA cost and source details','Dokładny koszt HA i źródło'))}</summary><p>${esc(label)}: ${esc(p.amount ?? p.recorded_amount ?? unknown())} ${esc(p.currency || '')}</p><p>${esc(t('Source hours measured / expected','Godziny źródeł zmierzone / oczekiwane'))}: ${esc(c.measured_source_hours)} / ${esc(c.expected_source_hours)}</p>${p.reason?`<p>${esc(p.reason)}</p>`:''}<ul>${native.provenance.map(row=>`<li>${esc(row.energy_source_id)} · ${esc(row.cost_statistic_id || unknown())}</li>`).join('')}</ul></details>
      ${prices.length?`<h4>${esc(t('Current prices · now','Bieżące ceny · teraz'))}</h4><p class="analysis-note">${esc(t('Observed now; not a price for the selected period. No historical cost is calculated from these prices.','Odczytane teraz; nie są cenami za wybrany okres. Nie obliczamy z nich kosztu historycznego.'))}</p>${table(t('Current prices · now','Bieżące ceny · teraz'),[t('Source','Źródło'),t('Price now','Cena teraz'),t('Observed at','Czas odczytu')],prices)}<details data-analysis-native-price-details><summary>${esc(t('Exact current price values','Dokładne wartości bieżących cen'))}</summary><ul>${native.current_prices.map(row=>`<li>${esc(row.source_id)}: ${esc(row.price ?? unknown())} ${esc(row.currency || '')}/kWh · ${esc(row.origin)} · ${esc(row.observed_at)}</li>`).join('')}</ul></details>`:''}</section>`;
  };
  // Describe the displayed household total only with a matching producer delta.
  // Paired/common measurements may be useful in Comparison, but are a different total.
  const kpiComparison = (snapshot,data=false) => {
    const kind=snapshot.context?.comparison_kind || 'previous', c=snapshot.comparisons?.[kind];
    if (!comparisons[kind] || c?.status!=='ready' || c.reason!=null || c.comparison_scope!=='calendar_totals' ||
        snapshot.coverage?.complete!==true || snapshot.totals?.measurement_complete!==true ||
        !valid(c.current_kwh) || !valid(snapshot.totals.kwh) || compare(c.current_kwh,snapshot.totals.kwh)!==0 || !valid(c.delta_kwh))
      return t('No comparable baseline — incomplete or unavailable data','Brak porównywalnego odniesienia — dane niepełne lub niedostępne');
    const direction=compare(c.delta_kwh,'0'), text=direction<0?t('Decrease','Spadek'):direction>0?t('Increase','Wzrost'):t('No change','Bez zmian');
    return `${comparisons[kind]} · ${text} ${data?quantity(c.delta_kwh,'kWh',true):briefEnergy(c.delta_kwh,true)}${valid(c.percent)?' · '+(data?quantity(c.percent,'%',true):briefNumber(c.percent,0,0,true)+'%'):''}`;
  };
  const peakClock = (snapshot,peak) => {
    const plain=ui.clock(peak.start), start=Date.parse(peak.start);
    // Repeated local hours still require the offset, including the first fold.
    const repeated=[-120,-90,-60,-30,30,60,90,120].some(minutes=>{
      const other=new Date(start+minutes*60000).toISOString();
      return ui.clock(other)===plain && ui.date(other)===ui.date(peak.start);
    });
    return ui.clock(peak.start,ui.timeZone!==snapshot.period?.timezone || repeated);
  };
  const tiles = (snapshot, overview=false, data=false) => {
    const total=snapshot.totals || {}, supplied=overview&&Object.hasOwn(snapshot,'period_summary'), native=nativeComplete(snapshot);
    const base=[
      [t('Consumption','Zużycie'),data?quantity(total.kwh):briefEnergy(total.kwh)], [native?nativeCostLabel():t('Cost','Koszt'),native?nativeMoney(native):data?money(total.total_cost,total.currency):briefMoney(total.total_cost,total.currency)],
      native ? [t('Source','Źródło'),'Home Assistant Energy'] : [t('Effective price','Cena efektywna'),(data?money(total.effective_price,total.currency):briefRate(total.effective_price,total.currency)) + (valid(total.effective_price) ? '/kWh' : '')],
      [t('Measurement coverage','Pokrycie pomiarów'),coverage(snapshot.coverage)]
    ];
    if(!supplied)return `<div class="analysis-tiles">${base.map(([label,value],index)=>`<div class="analysis-tile ${index<2?'analysis-tile-primary':'analysis-tile-secondary'}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${index===0?`<span data-analysis-kpi-comparison>${esc(kpiComparison(snapshot,data))}</span>`:''}</div>`).join('')}</div>`;
    const frame=periodWindow(snapshot),share=shareProof(snapshot,frame),peak=peakProof(snapshot,frame);
    const knownPeak=peak&&peak.kwh!==null,localPeak=knownPeak&&peak.reason!=='measurement_timezone_unavailable',partialPeak=peak&&(peak.status==='partial'||knownPeak&&!snapshot.totals?.measurement_complete);
    const shareNote=share?.reason==='zero_total_kwh'?t('No share for a zero energy total','Brak udziału przy zerowym zużyciu'):share?.status==='ready'?(data?quantity(share.known_cheap_kwh):briefEnergy(share.known_cheap_kwh)):t('Full-period share unavailable','Brak udziału za cały okres');
    return `<div class="analysis-tiles">${base.slice(0,2).map(([label,value],index)=>`<div class="analysis-tile analysis-tile-primary"><span>${esc(label)}</span><strong>${esc(value)}</strong>${index===0?`<span data-analysis-kpi-comparison>${esc(kpiComparison(snapshot,data))}</span>`:''}${index===1?`<span>${esc(base[2][0])}: ${esc(base[2][1])}</span>`:''}</div>`).join('')}
      <div class="analysis-tile analysis-tile-secondary" data-analysis-cheap-share><span>${esc(t('Cheap-zone share','Udział taniej strefy'))}</span><strong>${esc(share?.status==='ready'?(data?percentage(share.ratio):briefPercent(share.ratio)):unknown())}</strong><span>${esc(shareNote)}</span></div>
      <div class="analysis-tile analysis-tile-secondary" data-analysis-peak${knownPeak?` data-analysis-peak-id="${esc(peak.id)}"`:''}><span>${esc(partialPeak?t('Highest observed hour','Najwyższe zarejestrowane zużycie'):t('Highest hour','Godzina szczytu'))}</span><strong>${esc(localPeak?peakClock(snapshot,peak)||unknown():unknown())}</strong><span>${esc(knownPeak?(data?quantity(peak.kwh):briefEnergy(peak.kwh))+(localPeak?' · '+date(peak.start):''):unknown())}</span>${partialPeak?`<span>${esc(t('Incomplete period','Niepełny okres'))}</span>`:''}${peak?.reason==='measurement_timezone_unavailable'?`<span>${esc(t('Measurement time zone unavailable','Brak strefy czasu pomiarów'))}</span>`:''}</div></div>`;
  };
  const baselineNote = () => `<p data-analysis-baseline="unknown">${esc(t('No matching comparison is available for these intervals.','Brak dopasowanego porównania dla tych przedziałów.'))}</p>`;
  const instant = value => {
    if(typeof value==='number')return Number.isSafeInteger(value)?value:null;
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
    const stamp=Date.parse(value);return Number.isSafeInteger(stamp)?stamp:null;
  };
  const bounds=(from,to)=>{const a=instant(from),b=instant(to);return a!==null&&b!==null&&b>a?{from:a,to:b,key:a+'|'+b}:null;};
  const intervalText=value=>value?`${ui.pointLabel(new Date(value.from).toISOString())||unknown()} – ${ui.pointLabel(new Date(value.to).toISOString())||unknown()}`:unknown();
  const seconds=value=>Number.isSafeInteger(value)&&value>=0;
  // A producer marker is usable only with its complete projection contract.
  // No local-calendar reconstruction, array zipping, amount arithmetic or mean.
  const markerSeries=(snapshot,kind)=>{
    const comparison=snapshot.comparisons?.[kind],source=comparison?.chart,main=snapshot.chart;
    const empty={accepted:false,markers:new Map(),reconciles:false,mean:kind==='mean7',common:false};
    if(comparison?.status!=='ready'||!['ready','partial'].includes(source?.status)||!['ready','partial'].includes(main?.status)||
      !['hour','day','month'].includes(main.grain)||source.grain!==main.grain||source.timezone!==main.timezone||
      typeof source.timezone!=='string'||!source.timezone||source.coverage_kind!=='selected_household_comparison_mask'||
      source.fixed_fee_scope!=='household_period_only'||typeof source.reconciles_comparison_energy!=='boolean'||
      !['calendar_totals','common_measurements'].includes(source.comparison_scope)||source.comparison_scope!==comparison.comparison_scope||
      !Array.isArray(source.markers)||source.status==='ready'&&source.reason!==null)return empty;
    const mean=kind==='mean7',common=source.comparison_scope==='common_measurements';
    const periods=mean&&Array.isArray(source.baseline_periods)?source.baseline_periods.map(p=>bounds(p?.from,p?.to)):[];
    if(mean&&(source.baseline_aggregation!=='mean7'||periods.length!==7||periods.some(p=>!p)||new Set(periods.map(p=>p.key)).size!==7||periods.some((p,i)=>periods.some((q,j)=>i!==j&&p.from<q.to&&q.from<p.to))))return empty;
    const mainKeys=new Map(),currentKeys=new Map(),baselineKeys=new Map();
    const count=(map,key)=>{if(key)map.set(key,(map.get(key)||0)+1);};
    for(const row of main.bins||[])count(mainKeys,bounds(row.start,row.end)?.key);
    for(const marker of source.markers){
      if(!marker||typeof marker!=='object')continue;
      count(currentKeys,bounds(marker.current_from,marker.current_to)?.key);
      if(mean){for(const [i,p] of (Array.isArray(marker.baseline_ranges)?marker.baseline_ranges:[]).entries())count(baselineKeys,i+'|'+(bounds(p?.from,p?.to)?.key||''));}
      else count(baselineKeys,bounds(marker.baseline_from,marker.baseline_to)?.key);
    }
    const markers=new Map();
    for(const marker of source.markers){
      if(!marker||typeof marker!=='object')continue;
      const current=bounds(marker.current_from,marker.current_to);
      if(!current||mainKeys.get(current.key)!==1||currentKeys.get(current.key)!==1||marker.status!=='ready'||marker.reason!==null||
        !valid(marker.current_kwh)||!valid(marker.baseline_kwh)||!seconds(marker.expected_current_source_seconds)||
        !seconds(marker.selected_current_source_seconds)||marker.selected_current_source_seconds<=0||
        marker.selected_current_source_seconds>marker.expected_current_source_seconds)continue;
      const mapping=mean?(common?'mean7_common_source_frame_intersection':'mean7_calendar_frames'):(common?'common_source_frame_intersection':'calendar_frame_bijection');
      if(marker.mapping!==mapping||!common&&marker.selected_current_source_seconds!==marker.expected_current_source_seconds)continue;
      let ranges;
      if(mean){
        if(marker.baseline_aggregation!=='mean7'||marker.baseline_from!==null||marker.baseline_to!==null||
          !Array.isArray(marker.baseline_ranges)||marker.baseline_ranges.length!==7||
          !Array.isArray(marker.expected_baseline_source_seconds)||marker.expected_baseline_source_seconds.length!==7||
          !Array.isArray(marker.selected_baseline_source_seconds)||marker.selected_baseline_source_seconds.length!==7)continue;
        ranges=marker.baseline_ranges.map(p=>bounds(p?.from,p?.to));
        if(ranges.some((p,i)=>!p||p.from<periods[i].from||p.to>periods[i].to||baselineKeys.get(i+'|'+p.key)!==1)||new Set(ranges.filter(Boolean).map(p=>p.key)).size!==7||
          marker.expected_baseline_source_seconds.some((v,i)=>!seconds(v)||!seconds(marker.selected_baseline_source_seconds[i])||
            marker.selected_baseline_source_seconds[i]<=0||marker.selected_baseline_source_seconds[i]>v||
            marker.selected_baseline_source_seconds[i]!==marker.selected_current_source_seconds||(!common&&marker.selected_baseline_source_seconds[i]!==v)))continue;
      }else{
        const baseline=bounds(marker.baseline_from,marker.baseline_to);
        if(!baseline||baselineKeys.get(baseline.key)!==1||!seconds(marker.expected_baseline_source_seconds)||!seconds(marker.selected_baseline_source_seconds)||
          marker.selected_baseline_source_seconds<=0||marker.selected_baseline_source_seconds>marker.expected_baseline_source_seconds||
          marker.selected_baseline_source_seconds!==marker.selected_current_source_seconds||(!common&&marker.selected_baseline_source_seconds!==marker.expected_baseline_source_seconds))continue;
        ranges=[baseline];
      }
      markers.set(current.key,{current:marker.current_kwh,baseline:marker.baseline_kwh,ranges});
    }
    return {accepted:true,markers,mean,common,reconciles:source.status==='ready'&&source.reconciles_comparison_energy&&markers.size===(main.bins||[]).length&&source.markers.length===markers.size&&markers.size>0};
  };
  const zoneProof=(row,options)=>{
    const z=row?.zone_breakdown;
    if(!z||!(options?.period===true?['ready','partial','unknown']:['ready','partial']).includes(z.status)||z.scope!=='complete_household_hours'||z.fixed_fee_scope!=='household_period_only'||
      typeof z.reconciles_recorded_kwh!=='boolean'||typeof z.reconciles_known_costs!=='boolean'||
      !Array.isArray(z.zones)||!z.unattributed||typeof z.unattributed!=='object'||z.status==='ready'&&z.reason!==null)return null;
    const keys=new Set();
    for(const zone of z.zones){
      if(!zone||typeof zone.version_id!=='string'||!zone.version_id||typeof zone.zone_id!=='string'||!zone.zone_id||typeof zone.complete!=='boolean'||
        z.status==='ready'&&!zone.complete)return null;
      const key=JSON.stringify([zone.version_id,zone.zone_id]);if(keys.has(key))return null;keys.add(key);
    }
    return z;
  };
  // Explicit server classification gets a semantic color; other zones use identity colors.
  // Labels, rates and amounts never infer a classification.
  const zoneColor=(version,zone,snapshot)=>{
    const rates=(snapshot?.rates||[]).filter(rate=>rate.version_id===version);
    const matches=rates.length===1?rates[0].profile?.zones?.filter(row=>row.id===zone)||[]:[];
    if(matches.length===1&&matches[0].classification==='cheap')return 'var(--analysis-zone-cheap,var(--hat-zone-cheap, var(--_hat-zone-cheap)))';
    if(matches.length===1&&matches[0].classification==='expensive')return 'var(--analysis-zone-expensive,var(--hat-zone-exp, var(--_hat-zone-exp)))';
    let hash=0;for(const char of JSON.stringify([version,zone]))hash=(hash*31+char.charCodeAt(0))>>>0;
    return ['var(--hat-s1, var(--_hat-s1))','var(--hat-d2, var(--_hat-d2))','var(--hat-s2, var(--_hat-s2))','var(--hat-s5, var(--_hat-s5))','var(--hat-s3, var(--_hat-s3))','var(--hat-s4, var(--_hat-s4))','var(--hat-unmeasured, var(--_hat-unmeasured))','var(--hat-crit, var(--_hat-crit))'][hash%8];
  };
  const zoneEntries=(snapshot,row,{period=false}={})=>{
    const proof=zoneProof(row,{period});if(!proof)return null;
    const currency=typeof proof.currency==='string'&&/^[A-Z]{3}$/.test(proof.currency)&&['gross','net'].includes(proof.price_basis)?proof.currency:null;
    const amount=value=>currency?money(value,currency):unknown();
    const components=known=>[
      [t('Known energy cost','Znany koszt energii'),known?.energy_cost],
      [t('Known distribution cost','Znany koszt dystrybucji'),known?.variable_cost],
      [t('Known legacy usage cost','Znany dawny koszt zużycia'),known?.legacy_combined_cost]
    ].map(([label,value])=>`${label}: ${amount(value)}`).join(' · ');
    const entries=proof.zones.filter(zone=>zone&&typeof zone.version_id==='string'&&typeof zone.zone_id==='string').map(zone=>{
      const rate=(snapshot.rates||[]).find(r=>r.version_id===zone.version_id);
      const label=typeof zone.label==='string'&&zone.label&&zone.label!==zone.zone_id?zone.label:t('Unnamed tariff zone','Strefa taryfy bez nazwy');
      const version=rate?`${t('Rates from','Stawki od')} ${date(rate.valid_from)}${rate.valid_to?' – '+date(rate.valid_to):''}`:t('Rate version unavailable','Wersja stawek niedostępna');
      const complete=proof.status==='ready'&&zone.complete===true;
      const value=complete?quantity(zone.kwh):`${t('Recorded','Zarejestrowano')}: ${quantity(zone.recorded_kwh)}`;
      return {key:zone.version_id+'|'+zone.zone_id,color:zoneColor(zone.version_id,zone.zone_id,snapshot),text:`${label} · ${version} · ${value} · ${t('Usage cost','Koszt zużycia')}: ${amount(complete?zone.usage_cost:null)} · ${components(zone.known_costs)} · ${t('Measured time','Czas pomiaru')}: ${quantity(zone.measured_seconds,'s')}`};
    });
    const u=proof.unattributed;
    // Missing, measured-but-unattributed, and a genuine recorded zero remain distinct.
    entries.push({key:null,color:null,text:`${t('Unattributed','Bez przypisania do strefy')} · ${t('Recorded','Zarejestrowano')}: ${quantity(u.recorded_kwh)} · ${components(u.known_costs)} · ${t('Measured time','Czas pomiaru')}: ${quantity(u.measured_seconds,'s')} · ${t('Missing time','Brakujący czas')}: ${quantity(u.missing_seconds,'s')}`});
    return {entries,note:`${currency||t('Currency unavailable','Waluta niedostępna')} · ${basis(proof.price_basis)} · ${proof.status==='ready'&&proof.reconciles_recorded_kwh?(period?t('Complete selected-period breakdown','Pełne rozbicie wybranego okresu'):t('Complete interval breakdown','Pełne rozbicie przedziału')):(period?t('Selected period; known recorded amounts only','Wybrany okres; tylko znane zarejestrowane kwoty'):t('Partial interval; known amounts only','Niepełny przedział; tylko znane kwoty'))}${proof.reconciles_recorded_kwh?'':' · '+(period?t('Selected-period energy is not reconciled','Energia wybranego okresu nie jest uzgodniona'):t('Interval energy is not reconciled','Energia przedziału nie jest uzgodniona'))}${proof.reconciles_known_costs?'':' · '+t('Known costs are not fully reconciled','Znane koszty nie są w pełni uzgodnione')}`};
  };
  const zonesMarkup=(snapshot,row)=>{
    const result=zoneEntries(snapshot,row);
    return result?`<div data-analysis-zone-values><p>${esc(result.note)}</p><ul>${result.entries.map(entry=>`<li${entry.key!==null?` data-analysis-zone-key="${esc(entry.key)}" style="border-inline-start:6px solid ${entry.color};padding-inline-start:8px"`:' data-analysis-zone-unattributed'}>${esc(entry.text)}</li>`).join('')}</ul></div>`:`<span data-analysis-zone-values>${esc(t('No tariff-zone breakdown for this interval','Brak rozbicia stref dla tego przedziału'))}</span>`;
  };
  // Whole-period facts are independent server proofs. Never total chart bins,
  // derive a share, choose a peak or allocate fixed fees in this presentation.
  const decimal=(value,plain=false)=>typeof value==='string'&&(plain?/^[+-]?\d+(?:\.\d+)?$/:/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/).test(value)&&valid(value);
  const nonnegative=(value,plain=false)=>decimal(value,plain)&&compare(value,'0')>=0;
  const moneyFields=['energy_cost','variable_cost','legacy_combined_cost'];
  const periodWindow=snapshot=>{
    const p=snapshot.period,w=snapshot.period_summary?.window,frame=bounds(p?.start,p?.end);
    if(!frame||!w||typeof p.start!=='string'||typeof p.end!=='string'||typeof p.timezone!=='string'||!p.timezone||
      w.start!==p.start||w.end!==p.end||w.timezone!==p.timezone)return null;
    let timezoneKnown=true;try {new Intl.DateTimeFormat('en',{timeZone:p.timezone});}catch(_){timezoneKnown=false;}
    return {...frame,timezone:p.timezone,timezoneKnown};
  };
  const shareProof=(snapshot,frame)=>{
    const value=snapshot.period_summary?.cheap_zone_share,complete=snapshot.totals?.measurement_complete;
    if(!frame||!value||!['ready','partial','unknown'].includes(value.status)||value.scope!=='complete_household_hours'||
      value.classification_source!=='explicit_tariff_classification'||typeof complete!=='boolean'||snapshot.coverage?.complete!==complete)return null;
    const known=nonnegative(value.known_cheap_kwh,true)&&nonnegative(value.classified_kwh,true)&&compare(value.known_cheap_kwh,value.classified_kwh)<=0;
    const total=nonnegative(value.total_kwh,true)&&decimal(snapshot.totals.kwh)&&compare(value.total_kwh,snapshot.totals.kwh)===0;
    if(value.status==='ready')return value.reason===null&&complete&&known&&total&&compare(value.total_kwh,'0')>0&&compare(value.classified_kwh,value.total_kwh)===0&&
      nonnegative(value.ratio,true)&&compare(value.ratio,'1')<=0?value:null;
    if(value.ratio!==null)return null;
    if(value.status==='partial')return known&&(
      value.reason==='incomplete_household_measurements'&&!complete&&value.total_kwh===null||
      value.reason==='incomplete_classification'&&complete&&total&&compare(value.total_kwh,'0')>0&&compare(value.classified_kwh,value.total_kwh)<=0)?value:null;
    if(value.reason==='no_recorded_hours')return !complete&&value.known_cheap_kwh===null&&value.classified_kwh===null&&value.total_kwh===null?value:null;
    if(value.reason==='zero_total_kwh')return complete&&known&&total&&compare(value.total_kwh,'0')===0&&compare(value.classified_kwh,'0')===0?value:null;
    return ['tariff_unavailable','classification_unavailable'].includes(value.reason)&&complete&&known&&total&&compare(value.total_kwh,'0')>0&&compare(value.classified_kwh,'0')===0?value:null;
  };
  const localProof=(literal,stamp,zone)=>{
    if(typeof literal!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/.test(literal)||instant(literal)!==stamp)return false;
    try {
      const fields=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp)).map(part=>[part.type,part.value]));
      return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}`===literal.slice(0,19);
    }catch(_){return false;}
  };
  const peakProof=(snapshot,frame)=>{
    const p=snapshot.period_summary?.peak_hour,complete=snapshot.totals?.measurement_complete;
    if(!frame||!p||!['ready','partial','unknown'].includes(p.status)||p.scope!=='complete_household_hours'||typeof complete!=='boolean'||snapshot.coverage?.complete!==complete)return null;
    if(p.status==='unknown'&&p.reason==='no_recorded_hours')return !complete&&p.tied_count===0&&['id','from','to','start','end','local_start','local_end','fold','end_fold','kwh'].every(key=>p[key]===null)?p:null;
    if(!Number.isSafeInteger(p.from)||!Number.isSafeInteger(p.to)||p.to-p.from!==3600000||p.from<frame.from||p.to>frame.to||
      p.id!==p.from+':'+p.to||instant(p.start)!==p.from||instant(p.end)!==p.to||
      !Number.isSafeInteger(p.tied_count)||p.tied_count<1||p.tied_count>(frame.to-frame.from)/3600000||!nonnegative(p.kwh,true))return null;
    if(p.status==='unknown')return p.reason==='measurement_timezone_unavailable'&&!frame.timezoneKnown&&['local_start','local_end','fold','end_fold'].every(key=>p[key]===null)?p:null;
    if(p.status==='ready'?(p.reason!==null||!complete):(p.reason!=='incomplete_period'||complete))return null;
    return frame.timezoneKnown&&[0,1].includes(p.fold)&&[0,1].includes(p.end_fold)&&localProof(p.local_start,p.from,frame.timezone)&&localProof(p.local_end,p.to,frame.timezone)?p:null;
  };
  const periodZoneProof=(snapshot,frame)=>{
    const z=zoneProof(snapshot.period_summary,{period:true});if(!frame||!z)return null;
    const complete=snapshot.totals?.measurement_complete,secondsInWindow=(frame.to-frame.from)/1000;
    const calendar=value=>value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&ui.calendarDate(value)!==null;
    const duration=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=secondsInWindow;
    const known=value=>value&&typeof value==='object'&&moneyFields.every(key=>value[key]===null||decimal(value[key]));
    const currency=typeof z.currency==='string'&&/^[A-Z]{3}$/.test(z.currency)&&['gross','net'].includes(z.price_basis);
    if(!currency&&!(z.currency===null&&z.price_basis===null&&['currency_or_basis_mismatch','tariff_unavailable'].includes(z.reason)))return null;
    if(currency&&(z.currency!==snapshot.totals?.currency||z.price_basis!==snapshot.totals?.price_basis))return null;
    if(currency&&(z.status==='unknown'||z.reason==='currency_or_basis_mismatch'))return null;
    if(z.status==='ready'&&(!complete||snapshot.coverage?.complete!==true||!z.reconciles_recorded_kwh||!z.reconciles_known_costs)||
      z.status==='partial'&&(typeof z.reason!=='string'||!z.reason||z.reason.length>128)||
      z.status==='unknown'&&(z.reason!=='tariff_unavailable'||z.zones.length!==0)||!currency&&z.reconciles_known_costs)return null;
    const u=z.unattributed;
    if(!(u.recorded_kwh===null||nonnegative(u.recorded_kwh))||!duration(u.measured_seconds)||!duration(u.missing_seconds)||!known(u.known_costs)||
      !Array.isArray(u.reasons)||u.reasons.some(reason=>typeof reason!=='string'||!reason||reason.length>128)||
      z.status==='ready'&&(u.reasons.length||u.missing_seconds!==0||u.measured_seconds!==0||u.recorded_kwh!==null))return null;
    if(!currency&&moneyFields.some(key=>u.known_costs[key]!==null))return null;
    for(const zone of z.zones) {
      const rates=(snapshot.rates||[]).filter(rate=>rate.version_id===zone.version_id),rate=rates[0];
      const matches=rate?.profile?.zones?.filter(row=>row.id===zone.zone_id)||[];
      if(rates.length!==1||matches.length!==1||zone.tariff_id!==snapshot.active_tariff_id||typeof snapshot.active_tariff_id!=='string'||
        typeof zone.label!=='string'||zone.label!==matches[0].label||!calendar(rate.valid_from)||!calendar(rate.valid_to)||
        !/^[A-Z]{3}$/.test(rate.currency)||!['gross','net'].includes(rate.price_basis)||currency&&(rate.currency!==z.currency||rate.price_basis!==z.price_basis)||
        !nonnegative(zone.recorded_kwh)||!duration(zone.measured_seconds)||!known(zone.known_costs)||
        moneyFields.some(key=>!(zone[key]===null||decimal(zone[key])))||!(zone.usage_cost===null||decimal(zone.usage_cost))||
        (zone.complete?(!nonnegative(zone.kwh)||compare(zone.kwh,zone.recorded_kwh)!==0):zone.kwh!==null)||
        !currency&&(zone.usage_cost!==null||moneyFields.some(key=>zone[key]!==null||zone.known_costs[key]!==null)))return null;
    }
    return z;
  };
  const periodZonesMarkup=snapshot=>{
    if(!Object.hasOwn(snapshot,'period_summary'))return `<p data-analysis-zone-note class="analysis-note">${esc((snapshot.chart?.bins||[]).some(zoneProof)?t('Select a chart interval or open Data for tariff-zone details. No whole-period zone total is supplied.','Wybierz przedział na wykresie lub otwórz Dane, aby odczytać strefy taryfy. Serwer nie podał sumy stref za cały okres.'):t('Energy by tariff zone: no server breakdown.','Energia według stref taryfy: brak rozbicia z serwera.'))}</p>`;
    const frame=periodWindow(snapshot),proof=periodZoneProof(snapshot,frame),share=shareProof(snapshot,frame),peak=peakProof(snapshot,frame);
    const none=t('No data: a matching breakdown for this selected period is unavailable.','Brak danych: rozbicie dla wybranego okresu jest niedostępne.');
    const title=`<h4>${esc(t('Energy by tariff zone','Energia według stref taryfy'))}</h4>`;
    const details=proof?zoneEntries(snapshot,snapshot.period_summary,{period:true}):null;
    const rows=proof?.zones.map(zone=>{
      const ready=proof.status==='ready'&&zone.complete,label=zone.label&&zone.label!==zone.zone_id?zone.label:t('Unnamed tariff zone','Strefa taryfy bez nazwy');
      return `<li data-analysis-period-zone style="border-inline-start:6px solid ${zoneColor(zone.version_id,zone.zone_id,snapshot)}"><strong>${esc(label)}</strong><span>${esc((ready?'':t('Recorded','Zarejestrowano')+': ')+quantity(ready?zone.kwh:zone.recorded_kwh))}</span><span>${esc(t('Usage cost','Koszt zużycia'))}: ${esc(money(ready?zone.usage_cost:null,proof.currency))}</span></li>`;
    }).join('')||'';
    const u=proof?.unattributed;
    const unknownRow=u&&(u.recorded_kwh!==null||u.missing_seconds>0||u.reasons.length)?`<li data-analysis-period-unattributed><strong>${esc(t('Unattributed to a tariff zone','Bez przypisania do strefy taryfy'))}</strong><span>${esc(t('Recorded','Zarejestrowano'))}: ${esc(quantity(u.recorded_kwh))}</span></li>`:'';
    const note=proof?proof.status==='ready'?t('Entire selected period · usage costs exclude household fixed fees.','Cały wybrany okres · koszty zużycia nie obejmują opłat stałych gospodarstwa.'):proof.status==='unknown'?t('Tariff-zone assignment is unavailable. Recorded energy, if any, is shown separately.','Przypisanie do stref taryfy jest niedostępne. Zarejestrowaną energię, jeśli istnieje, pokazano osobno.'):proof.reason==='currency_or_basis_mismatch'?t('Recorded energy is shown. Costs cannot be combined across different currencies or price bases.','Pokazano zarejestrowaną energię. Nie można łączyć kosztów w różnych walutach lub podstawach cen.'):t('Partial breakdown · recorded energy and known amounts only.','Niepełne rozbicie · tylko zarejestrowana energia i znane kwoty.'):none;
    const shareDetail=share?`${t('Known cheap-zone energy','Znana energia w strefie taniej')}: ${quantity(share.known_cheap_kwh)} · ${t('Energy with known zone type','Energia ze znanym rodzajem strefy')}: ${quantity(share.classified_kwh)} · ${t('Full-period energy','Energia całego okresu')}: ${quantity(share.total_kwh)} · ${t('Full precision share','Udział z pełną precyzją')}: ${share.status==='ready'?ui.number(share.ratio,{style:'percent',maximumFractionDigits:100}):unknown()}`:t('Cheap-zone energy share is unavailable.','Udział energii w strefie taniej jest niedostępny.');
    const peakDetail=peak&&peak.kwh!==null?`${intervalText({from:peak.from,to:peak.to})} · ${quantity(peak.kwh)} · ${t('Hours tied at this value','Godziny z taką samą wartością')}: ${number(peak.tied_count)} · ${t('Measurement calendar','Kalendarz pomiarów')}: ${frame.timezone} · ${peak.reason==='measurement_timezone_unavailable'?t('Local measurement time is unavailable; absolute hour only.','Lokalny czas pomiaru jest niedostępny; znana jest tylko godzina bezwzględna.'):peak.local_start.slice(11,16)+' UTC'+peak.local_start.slice(-6)+' – '+peak.local_end.slice(11,16)+' UTC'+peak.local_end.slice(-6)}${peak.fold===1?' · '+t('Second occurrence of the local hour','Drugie wystąpienie lokalnej godziny'):''}${peak.status==='partial'||!snapshot.totals?.measurement_complete?' · '+t('Highest observed hour; the period is incomplete','Najwyższa zarejestrowana godzina; okres jest niepełny'):''}`:t('Highest hour is unavailable.','Najwyższa godzina jest niedostępna.');
    return `<section data-analysis-period-zone-total>${title}<p data-analysis-zone-note class="analysis-note">${esc(note)}</p>${proof?`<ul class="analysis-period-zones">${rows}${unknownRow}</ul>`:''}<details data-analysis-period-summary-details><summary>${esc(t('Selected-period values and measurement time','Wartości okresu i czas pomiarów'))}</summary>${frame?`<p>${esc(range(snapshot.period))} · ${esc(ui.timeZone)} · ${esc(t('Measurement calendar','Kalendarz pomiarów'))}: ${esc(frame.timezone)}</p>`:''}${details?`<p>${esc(details.note)}</p><ul>${details.entries.map(entry=>`<li>${esc(entry.text)}</li>`).join('')}</ul>`:`<p>${esc(none)}</p>`}<p>${esc(shareDetail)}</p><p>${esc(peakDetail)}</p></details></section>`;
  };
  // Only validate energy conservation here. Money stays in server literals.
  // Bounded integer scaling rejects mismatches below Number precision.
  const energyPartition=(values,total)=>{
    if(!nonnegative(total)||values.some(value=>!nonnegative(value)))return false;
    const all=[...values,total].map(parts),scales=all.map(value=>value.magnitude-value.digits.length),base=Math.min(...scales);
    if(all.some((value,i)=>value.digits.length>4096||scales[i]-base>4096))return false;
    const ints=all.map((value,i)=>BigInt(value.digits||'0')*10n**BigInt(scales[i]-base));
    return ints.slice(0,-1).reduce((sum,value)=>sum+value,0n)===ints.at(-1);
  };
  const groupPartition=(snapshot,rows)=>{
    const g=snapshot.groups,total=snapshot.totals;
    return g?.energy_domain==='grid_import'&&g.partition_complete===true&&g.membership_mode==='current_snapshot'&&
      Number.isSafeInteger(g.revision)&&g.registry_revision===g.revision&&total?.measurement_complete===true&&snapshot.coverage?.complete===true&&
      nonnegative(total.kwh)&&nonnegative(total.recorded_household_kwh)&&compare(total.kwh,total.recorded_household_kwh)===0&&
      rows.length>0&&rows.every(({row})=>row?.measurement_complete===true&&nonnegative(row.kwh)&&nonnegative(row.recorded_kwh)&&compare(row.kwh,row.recorded_kwh)===0)&&energyPartition(rows.map(({row})=>row.kwh),total.kwh);
  };
  const sourcePartition=snapshot=>{
    if(snapshot.groups?.energy_domain!=='grid_import')return null;
    const proof=periodZoneProof(snapshot,periodWindow(snapshot));
    return proof?.status==='ready'&&energyPartition(proof.zones.map(zone=>zone.kwh),snapshot.totals?.kwh)?proof:null;
  };
  const columnZone=(snapshot,row,visual)=>{
    const frame=bounds(row?.start,row?.end),period=bounds(snapshot.period?.start,snapshot.period?.end);
    if(!frame||!period||frame.from<period.from||frame.to>period.to||row.from!==frame.from||row.to!==frame.to||
      snapshot.chart?.timezone!==snapshot.period?.timezone||snapshot.chart?.coverage_kind!=='complete_household_hours'||
      snapshot.chart?.fixed_fee_scope!=='household_period_only'||!['ready','partial'].includes(snapshot.chart?.status)||
      row.complete!==true||row.currency!==snapshot.totals?.currency||row.price_basis!==snapshot.totals?.price_basis||
      !nonnegative(row.kwh)||!nonnegative(row.recorded_kwh)||compare(row.kwh,row.recorded_kwh)!==0||!valid(visual)||compare(row.kwh,visual)!==0||
      row.expected_seconds!==(frame.to-frame.from)/1000||row.measured_seconds!==row.expected_seconds)return null;
    // Interval completeness is independent of other missing hours in the selected period.
    const proof=periodZoneProof({...snapshot,totals:{...snapshot.totals,measurement_complete:true},coverage:{...snapshot.coverage,complete:true},period_summary:{zone_breakdown:row.zone_breakdown}},frame);
    if(proof?.status!=='ready'||proof.zones.length!==1||!energyPartition(proof.zones.map(z=>z.kwh),row.kwh))return null;
    const zone=proof.zones[0];if(zone.measured_seconds!==row.measured_seconds)return null;
    return {key:zone.version_id+'|'+zone.zone_id,label:zone.label,color:zoneColor(zone.version_id,zone.zone_id,snapshot)};
  };
  // Ratios only draw marks/labels. They never feed proof, prices, or money.
  const shareGeometry=(value,total)=>nonnegative(value)&&nonnegative(total)&&compare(total,'0')>0&&Number(total)>0?
    Math.max(0,Math.min(1,Number(value)/Number(total))):null;
  const flowMarkup=(snapshot,rows,colors)=>{
    const total=snapshot.totals?.kwh,groupReady=groupPartition(snapshot,rows),source=sourcePartition(snapshot);
    const positive=nonnegative(total)&&compare(total,'0')>0&&Number(total)>0;
    const destinations=groupReady?rows.filter(({row})=>compare(row.kwh,'0')>0).map(({id,label,row})=>({id,label,kwh:row.kwh,color:id==='unmeasured'?null:`var(--analysis-rank-${colors.get(id)??4})`})):[];
    const sources=source?source.zones.filter(zone=>compare(zone.kwh,'0')>0).map(zone=>({id:zone.version_id+'|'+zone.zone_id,label:zone.label,kwh:zone.kwh,color:zoneColor(zone.version_id,zone.zone_id,snapshot)})):[];
    const swatch=item=>`<i class="analysis-flow-swatch${item.color?'':' analysis-hatched'}" aria-hidden="true"${item.color?` style="background:${item.color}"`:''}></i>`;
    const legend=items=>`<ul class="analysis-flow-labels">${items.map(item=>`<li>${swatch(item)}<span>${esc(item.label)} · ${esc(briefEnergy(item.kwh))} · ${esc(briefPercent(shareGeometry(item.kwh,total)))}</span></li>`).join('')}</ul>`;
    const bar=(side,items,ready)=>ready&&positive?`<div class="analysis-composition" data-analysis-composition="${side}" aria-hidden="true">${items.map(item=>`<span data-analysis-segment class="${item.color?'':'analysis-hatched'}" style="width:${shareGeometry(item.kwh,total)*100}%;${item.color?'background:'+item.color:''}"></span>`).join('')}</div>`:`<p class="analysis-note">${esc(positive?unknown():nonnegative(total)&&compare(total,'0')===0?t('No energy recorded in this period.','W tym okresie zarejestrowano zerowe zużycie.'):unknown())}</p>`;
    let diagram='';
    if(groupReady&&source&&positive){
      const count=Math.max(sources.length,destinations.length),height=Math.max(220,count*34),gap=24,top=12,span=height-24-gap*(count-1),trunkTop=top+gap*(count-1)/2;
      const paths=(items,side)=>{let offset=0;return items.map((item,index)=>{
        const h=shareGeometry(item.kwh,total)*span,nodeY=top+offset+index*gap+(count-items.length)*gap/2,trunkY=trunkTop+offset;offset+=h;
        const y0=side==='source'?nodeY:trunkY,y1=side==='source'?trunkY:nodeY,x0=side==='source'?16:208,x1=side==='source'?192:384,m=(x0+x1)/2;
        const d=`M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1} L${x1},${y1+h} C${m},${y1+h} ${m},${y0+h} ${x0},${y0+h} Z`;
        return `<g data-analysis-flow-side="${side}" data-analysis-flow-id="${esc(item.id)}"><path d="${d}" fill="${item.color||'url(#'+flowHatchId+')'}" fill-opacity="0.28"/><rect data-analysis-flow-node x="${side==='source'?4:384}" y="${nodeY}" width="12" height="${h}" rx="2" fill="${item.color||'url(#'+flowHatchId+')'}"/><title>${esc(item.label+' · '+briefEnergy(item.kwh))}</title></g>`;
      }).join('');};
      diagram=`<div class="analysis-sankey-wrap">${legend(sources)}<div><p class="analysis-household">${esc(t('Household','Dom'))} · ${esc(briefEnergy(total))}</p><svg class="analysis-sankey" data-analysis-sankey style="height:${height}px" viewBox="0 0 400 ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><pattern id="${flowHatchId}" patternUnits="userSpaceOnUse" width="7" height="7"><path d="M-1 1 L1 -1 M0 7 L7 0 M6 8 L8 6" stroke="currentColor" stroke-width="1.5"/></pattern></defs>${paths(sources,'source')}<rect x="192" y="${trunkTop}" width="16" height="${span}" fill="currentColor"/>${paths(destinations,'destination')}</svg></div>${legend(destinations)}</div>`;
    }
    const note=!groupReady||!source?t('Complete flow unavailable: the source or destination breakdown is incomplete or does not match this period. Known values remain below.','Pełny przepływ niedostępny: rozbicie źródeł lub odbiorców jest niepełne albo nie pasuje do okresu. Znane wartości pozostają poniżej.'):t('Tariff zones → household → selected groups. Each side describes the same imported energy; links do not assign a device to a specific tariff zone.','Strefy taryfy → dom → wybrane grupy. Obie strony opisują ten sam import; połączenia nie przypisują urządzenia do konkretnej strefy taryfy.');
    return {groupReady,markup:`<p class="analysis-flow-heading">${esc(snapshot.groups?.energy_domain==='grid_import'?t('Grid import','Import z sieci'):t('Measured energy','Zmierzona energia'))} · ${esc(briefEnergy(total))}</p>${diagram}<div class="analysis-mobile-composition"><h4>${esc(t('From','Skąd'))}</h4>${bar('source',sources,!!source)}${source?legend(sources):`<p>${esc(t('Tariff-zone breakdown unavailable','Brak rozbicia stref taryfy'))}</p>`}<h4>${esc(t('To','Dokąd'))}</h4>${bar('destination',destinations,groupReady)}</div>${groupReady&&source?`<details data-analysis-flow-details><summary>${esc(t('How to read the flow','Jak czytać przepływ'))}</summary>`:''}<p class="analysis-note" data-analysis-flow-note>${esc(note)}</p>${groupReady&&source?'</details>':''}`};
  };
  const chart = (snapshot, options) => {
    const bins=snapshot.chart?.bins || [],currency=snapshot.totals?.currency;
    const allowed=snapshot.period?.kind==='day'?['previous','same_weekday','mean7']:['previous','year_ago'];
    const requested=options.comparison||snapshot.context?.comparison_kind,kind=allowed.includes(requested)?requested:'previous';
    const series=markerSeries(snapshot,kind);
    const axisTicks=ui.chartTicks(bins.map(row=>row.start),snapshot.chart?.grain==='hour'?'hour':'day');
    const axisLabels=new Map(axisTicks.map(tick=>[tick.index,tick.label]));
    const majorTicks=new Set([axisTicks[0]?.index,axisTicks[Math.floor((axisTicks.length-1)/2)]?.index,axisTicks.at(-1)?.index].filter(index=>index!==undefined));
    const points=bins.map((row,index)=>{
      const key=bounds(row.start,row.end)?.key,marker=series.markers.get(key);
      return {row,index,marker,label:ui.pointLabel(row.start)||unknown(),current:series.common?marker?.current??null:marker?.current??row.kwh,visualCurrent:marker?.current??row.kwh};
    });
    const max=maximum(points.flatMap(p=>[p.visualCurrent,p.marker?.baseline]));
    const rangeMarkup=marker=>marker?marker.ranges.map(p=>`<span data-analysis-baseline-range>${esc(intervalText(p))}</span>`).join('<br>'):esc(unknown());
    const currentLabel=series.common?t('Current · common measurements','Bieżący · wspólne pomiary'):t('Current','Bieżący');
    const baselineLabel=series.mean?t('Baseline · mean of 7 days','Odniesienie · średnia z 7 dni'):t('Baseline','Odniesienie');
    const pointText=p=>`${p.label} · ${currentLabel}: ${quantity(p.current)} · ${baselineLabel}: ${quantity(p.marker?.baseline)} · ${t('Baseline interval','Przedział odniesienia')}: ${p.marker?p.marker.ranges.map(intervalText).join('; '):unknown()} · ${t('Whole household','Całe gospodarstwo')}: ${quantity(p.row.kwh)} · ${t('Household usage cost','Koszt zużycia gospodarstwa')}: ${money(p.row.usage_cost,currency)}`;
    const hasZones=bins.some(zoneProof);
    const columnZones=new Map(points.map(point=>[point.index,options.section==='comparison'?null:columnZone(snapshot,point.row,point.visualCurrent)]));
    const colorKeys=new Map([...columnZones.values()].filter(Boolean).map(zone=>[zone.key,zone]));
    const zoneLegend=colorKeys.size?`<p data-analysis-chart-zones class="analysis-zone-legend">${[...colorKeys.values()].map(zone=>`<span><i class="analysis-flow-swatch" aria-hidden="true" style="background:${zone.color}"></i>${esc(zone.label)}</span>`).join('')}${[...columnZones.values()].some(zone=>!zone)?`<span>${esc(t('Other bars: zone unavailable or mixed','Pozostałe słupki: strefa nieznana lub mieszana'))}</span>`:''}</p>`:'';
    const rows=points.map(p=>[
      button('point',p.index,p.label,String(options.selected)===String(p.index)),
      `<span data-analysis-current-value>${esc(quantity(p.current))}</span>`,esc(money(p.row.usage_cost,currency)),
      `<span data-analysis-baseline-value${p.marker?' data-analysis-marker aria-label="'+esc(pointText(p))+'"':''}>${esc(quantity(p.marker?.baseline))}</span>`,rangeMarkup(p.marker),
      ...(series.common?[`<span data-analysis-household-value>${esc(quantity(p.row.kwh))}</span>`]:[]),...(hasZones?[zonesMarkup(snapshot,p.row)]:[])
    ]);
    const selected=points.find(point=>String(point.index)===String(options.selected));
    const selection=selected?`<div data-analysis-point-detail><p role="status">${esc(pointText(selected))}</p>${selected.marker?`<p>${rangeMarkup(selected.marker)}</p>`:''}${zonesMarkup(snapshot,selected.row)}</div>`:'';
    const note=series.markers.size?`<p data-analysis-baseline="${series.reconciles?'ready':'partial'}">${esc(series.reconciles?t('Comparison covers the displayed intervals.','Porównanie obejmuje wyświetlone przedziały.'):t('Comparison is available for selected intervals only; it does not cover the whole period.','Porównanie obejmuje wybrane przedziały, ale nie cały okres.'))}</p>`:baselineNote();
    return `<section data-analysis-chart><div class="analysis-section-title"><h3>${esc(t('Consumption over time','Zużycie w czasie'))}</h3><div class="analysis-switch">${button('view','chart',t('Chart','Wykres'),options.view !== 'data')}${button('view','data',t('Data','Dane'),options.view === 'data')}</div></div>
      <p data-analysis-series-legend><span class="analysis-series-current">${esc(currentLabel)}</span> · <span class="analysis-series-baseline">${esc(baselineLabel)}</span>${series.common?' · '+esc(t('Selected amounts can differ from whole-household energy. Unmatched intervals retain household bars; their common comparison value is unavailable.','Wybrane ilości mogą różnić się od energii całego gospodarstwa. Bez dopasowania pozostaje słupek gospodarstwa; brak wartości wspólnego porównania.')):''}</p>
      ${zoneLegend}${options.view === 'data'?table(t('Measured intervals · usage cost without fixed fees','Przedziały pomiarowe · koszt zużycia bez opłat stałych'),[t('Period','Okres'),currentLabel+' kWh',t('Household usage cost','Koszt zużycia gospodarstwa'),baselineLabel+' kWh',t('Real baseline intervals','Rzeczywiste przedziały odniesienia'),...(series.common?[t('Whole household kWh','Całe gospodarstwo kWh')]:[]),...(hasZones?[t('Tariff zones in this interval','Strefy taryfy w przedziale')]:[])],rows,'','data-analysis-bin'):`<div class="analysis-chart-scroll"><div class="analysis-chart" style="--analysis-point-count:${Math.max(1,points.length)}" role="group" aria-label="${esc(t('Current and baseline consumption, select a point for values','Bieżące zużycie i odniesienie, wybierz punkt, aby odczytać wartości'))}">${points.map(p=>`<button type="button" class="analysis-point${p.visualCurrent==null?' analysis-missing':''}" data-analysis-action="point" data-analysis-value="${p.index}" aria-pressed="${String(options.selected)===String(p.index)}" aria-label="${esc(pointText(p))}"><span class="analysis-column analysis-series-current" aria-hidden="true" ${columnZones.get(p.index)?` data-analysis-column-zone="${esc(columnZones.get(p.index).key)}"`:''} style="height:${width(p.visualCurrent,max)*1.68}px${columnZones.get(p.index)?';background:'+columnZones.get(p.index).color:options.section==='comparison'?'':';background:var(--secondary-text-color,var(--hat-unmeasured, var(--_hat-unmeasured)))'}"></span>${p.marker?`<span data-analysis-marker class="analysis-baseline-line analysis-series-baseline" aria-label="${esc(pointText(p))}" style="bottom:${40+width(p.marker.baseline,max)*1.68}px"></span>`:''}<span class="analysis-point-label"${axisLabels.has(p.index)&&!majorTicks.has(p.index)?' data-analysis-axis-minor':''} aria-hidden="true">${esc(axisLabels.get(p.index)||'')}</span></button>`).join('')}</div></div>`}
      ${!points.length?`<p role="status">${esc(unknown())}</p>`:''}${selection}${note}<p class="analysis-note">${esc(t('Fixed fees apply once to the household period. Missing measurements are not zero.','Opłaty stałe dotyczą jednokrotnie całego okresu gospodarstwa. Brak pomiaru nie oznacza zera.'))}</p></section>`;
  };
  const groupsView = (snapshot,level,options={}) => {
    const groups=snapshot.groups, rows=rowsFor(groups,level);
    if(!groups?.unmeasured)rows.push({id:'unmeasured',label:t('Unmeasured','Niezmierzone'),row:{kwh:null,usage_cost:null}});
    const max=maximum(rows.map(x=>x.row.kwh));
    const colors=new Map(Object.keys(groups?.[level] || {}).sort().map((id,index)=>[id,Math.min(index,4)]));
    const flow=flowMarkup(snapshot,rows,colors);
    const groupCurrency=typeof groups?.currency==='string'&&/^[A-Z]{3}$/.test(groups.currency)&&
      groups.currency===snapshot.totals?.currency&&['gross','net'].includes(groups.price_basis)&&groups.price_basis===snapshot.totals?.price_basis?groups.currency:null;
    const groupMoney=(value,brief=false)=>groupCurrency?(brief?briefMoney(value,groupCurrency):money(value,groupCurrency)):unknown();
    const details=table(t('Group measurements and usage costs','Pomiary grup i koszty zużycia'),[t('Group','Grupa'),'kWh',t('Usage cost','Koszt zużycia'),t('Coverage','Pokrycie')],rows.map(({label,row})=>[esc(label),esc(quantity(row.kwh)),esc(groupMoney(row.usage_cost)),esc(coverage(row.coverage))]))+
      `<p class="analysis-note">${esc(t('Assignments follow the current Home Assistant registry. No room and unmeasured energy are separate. Group costs exclude household fixed fees.','Przypisania pochodzą z aktualnego rejestru Home Assistant. Bez pokoju i Niezmierzone są osobnymi pozycjami. Koszty grup nie obejmują opłat stałych gospodarstwa.'))}</p>`;
    return `<section data-analysis-groups><h3>${esc(t('Energy flow — from and to','Przepływ energii — skąd i dokąd'))}</h3>${options.view==='data'?'':flow.markup}<div${options.view==='data'?'':' class="analysis-group-summary"'}><div><h4>${esc(t('Selected groups · share of household energy','Wybrane grupy · udział energii gospodarstwa'))}</h4>
      <ol class="analysis-ranking" data-analysis-ranking>${rows.map(({id,label,row})=>`<li data-analysis-rank-id="${esc(id)}" class="${id==='unmeasured'?'analysis-unmeasured':''}"><div><strong><i class="analysis-flow-swatch ${id==='unmeasured'?'analysis-hatched':'rank-'+(colors.get(id)??4)}" aria-hidden="true"></i>${esc(label)}</strong><span>${esc(options.view==='data'?quantity(row.kwh):briefEnergy(row.kwh))} · <span data-analysis-rank-share>${esc(flow.groupReady?(options.view==='data'?percentage(shareGeometry(row.kwh,snapshot.totals?.kwh)):briefPercent(shareGeometry(row.kwh,snapshot.totals?.kwh))):unknown())}</span> · ${esc(groupMoney(row.usage_cost,options.view!=='data'))}</span></div><div class="analysis-track" aria-hidden="true"><span class="analysis-rank rank-${colors.get(id)??4}" style="width:${width(row.kwh,max)}%"></span></div></li>`).join('')}</ol>
      ${!rows.length?`<p>${esc(unknown())}</p>`:''}${options.view==='data'?'':`<details data-analysis-unmeasured-details><summary>${esc(t('Unmeasured energy explained','Co oznacza energia niezmierzona'))}</summary>`}<p class="analysis-note" data-analysis-unmeasured-explanation>${esc(groups?.energy_domain==='grid_import'?t('Unmeasured = grid import − sum of disjoint measured device amounts. Parent residuals and children are counted once. This is not the same as devices with no room. Fixed fees belong only to the household.','Niezmierzone = import z sieci − suma rozłącznych ilości zmierzonych urządzeń. Reszty urządzeń nadrzędnych i dzieci liczone są raz. To osobna pozycja od urządzeń bez pokoju. Opłaty stałe dotyczą tylko gospodarstwa.'):t('Unmeasured energy is separate from devices with no room. An import remainder is unavailable for this energy source.','Energia niezmierzona jest osobna od urządzeń bez pokoju. Dla tego źródła nie można podać reszty importu.'))}</p>
      ${options.view==='data'?'':'</details>'}</div>
      ${periodZonesMarkup(snapshot)}</div>
      ${options.view==='data'?details:`<details data-analysis-group-details><summary>${esc(t('Group measurements and costs','Pomiary i koszty grup'))}</summary>${details}</details>`}</section>`;
  };
  const costLabels = {energy_cost:t('Energy','Energia'),variable_cost:t('Variable distribution','Dystrybucja zmienna'),legacy_combined_cost:t('Legacy combined usage','Dawny łączny koszt zużycia'),fixed_cost:t('Fixed fees for period','Opłaty stałe za okres'),total_cost:t('Total','Razem')};
  const feeLabels = {subscription:t('Subscription','Abonament'),capacity:t('Capacity','Opłata mocowa'),distribution:t('Fixed distribution','Dystrybucja stała'),other:t('Other','Pozostałe')};
  const weekdays = pl ? ['pon','wt','śr','czw','pt','sob','nd'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const ruleText = rule => [
    rule.weekdays ? rule.weekdays.map(day=>weekdays[(day+6)%7] || unknown()).join(', ') : t('Every day','Codziennie'),
    ...(rule.dates || []).map(value=>date(value)), rule.season ? `${date('2000-'+rule.season.from,true)} – ${date('2000-'+rule.season.to,true)}` : '',
    (rule.intervals || []).map(interval=>`${interval.from}–${interval.to}`).join(', '),
    rule.priority == null ? '' : `${t('priority','priorytet')} ${number(rule.priority)}`
  ].filter(Boolean).join(' · ');
  const ratesView = (snapshot,options={}) => {
    const total=snapshot.totals || {}, groups=snapshot.groups || {}, data=options.view==='data';
    const summaryMoney=(value,currency,signed=false)=>data?money(value,currency,signed):briefMoney(value,currency,signed);
    const summaryRate=(value,currency)=>data?money(value,currency):briefRate(value,currency);
    const summaryEnergy=value=>data?quantity(value):briefEnergy(value);
    if (nativeFacts(snapshot)) return `<section class="analysis-rate76" data-analysis-rates><h3>${esc(t('Rates and costs','Stawki i koszty'))}</h3>${nativeDetails(snapshot)}</section>`;
    const currencyKnown=typeof total.currency==='string'&&/^[A-Z]{3}$/.test(total.currency)&&['gross','net'].includes(total.price_basis);
    const positive=value=>valid(value)&&compare(value,'0')>=0;
    const componentKeys=['energy_cost','variable_cost','legacy_combined_cost','fixed_cost'];
    // Only geometry uses Number. Amounts, rates, deltas and monthly fees remain
    // producer values passed directly to the shared formatter, never added here.
    const costReady=currencyKnown&&total.measurement_complete===true&&total.pricing_complete===true&&total.components_complete===true&&
      positive(total.total_cost)&&componentKeys.every(key=>positive(total[key])&&compare(total[key],total.total_cost)<=0);
    const componentLegend=componentKeys.map(key=>`<li><span class="analysis-rate76-swatch analysis-rate76-${key}" aria-hidden="true"></span><span>${esc(costLabels[key])}: <strong>${esc(summaryMoney(total[key],total.currency))}</strong></span></li>`).join('');
    const costGraphic=!data&&costReady?`<div class="analysis-rate76-track" aria-hidden="true">${componentKeys.map(key=>`<span class="analysis-rate76-${key}" data-analysis-rate76-bar style="width:${width(total[key],Number(total.total_cost))}%" title="${esc(costLabels[key]+': '+summaryMoney(total[key],total.currency))}"></span>`).join('')}</div>`:'';
    const visibleRates=(snapshot.rates || []).map(rate=>{
      const profile=rate.profile || {},zones=profile.zones || [],legacy=rate.rate_semantics==='legacy_combined';
      // Optional rates78 producer contract. Reject the whole projection on any
      // duplicate/foreign/missing zone or non-Decimal value; never synthesize it.
      const combined=rate.zone_usage_rates,zoneIds=zones.map(zone=>zone.id);
      const combinedValid=Array.isArray(combined)&&combined.length===zones.length&&new Set(zoneIds).size===zones.length&&zoneIds.every(id=>typeof id==='string'&&id.length>0)&&
        typeof rate.currency==='string'&&/^[A-Z]{3}$/.test(rate.currency)&&['gross','net'].includes(rate.price_basis)&&
        combined.every(row=>row&&typeof row.zone_id==='string'&&zoneIds.includes(row.zone_id)&&(row.usage_rate===null||typeof row.usage_rate==='string'&&valid(row.usage_rate)))&&
        new Set(combined.map(row=>row.zone_id)).size===zones.length;
      const combinedRates=new Map(combinedValid?combined.map(row=>[row.zone_id,row.usage_rate]):[]);
      const clock=profile.clock?.mode==='fixed'?t('Fixed UTC offset','Stałe przesunięcie UTC')+': '+quantity(profile.clock.offsetMinutes,'min',true):profile.clock?.mode==='civil'?t('Civil tariff clock','Czas lokalny taryfy'):unknown();
      const monthly=Object.entries(feeLabels).filter(([key])=>Object.hasOwn(rate.fixed_monthly || {},key)).map(([key,label])=>`<li>${esc(label)}: <strong>${esc(summaryMoney(rate.fixed_monthly[key],rate.currency))}</strong> / ${esc(t('month','miesiąc'))}</li>`);
      if(rate.legacy_combined_monthly!=null)monthly.push(`<li>${esc(t('Legacy combined monthly fee','Dawna łączna opłata miesięczna'))}: <strong>${esc(summaryMoney(rate.legacy_combined_monthly,rate.currency))}</strong> / ${esc(t('month','miesiąc'))}</li>`);
      const dynamic=(profile.dynamic?.intervals || []).map(row=>[esc(`${dateTime(row.from)} – ${dateTime(row.to)}`),esc(summaryRate(row.energyRate,rate.currency)),esc(summaryRate(row.variableRate,rate.currency))]);
      return `<article class="analysis-rate76-card" data-analysis-rate76-version="${esc(rate.version_id)}"><h4>${esc(t('Rates effective from','Stawki obowiązujące od'))} ${esc(date(rate.valid_from))}${rate.valid_to?' – '+esc(date(rate.valid_to)):''}</h4>
        <p class="analysis-rate76-meta">${esc(rate.currency || unknown())} · ${esc(basis(rate.price_basis))} · ${esc(profile.timezone || unknown())} · ${esc(clock)}</p>
        <ul class="analysis-rate76-rate-list">${zones.map(zone=>{
          const rules=[...(profile.rules || []).filter(rule=>rule.zone===zone.id).map(rule=>ruleText(rule)),...(profile.exceptions || []).filter(rule=>rule.zone===zone.id).map(rule=>t('Exception','Wyjątek')+': '+ruleText(rule))];
          if(zone.id===profile.defaultZone)rules.push(t('Default outside matching rules','Domyślna poza pasującymi regułami'));
          return `<li><strong>${esc(zone.label || t('Unnamed zone','Strefa bez nazwy'))}</strong><div class="analysis-rate76-schedule">${rules.length?rules.map(rule=>`<p>${esc(rule)}</p>`).join(''):esc(unknown())}</div><dl class="analysis-rate76-rate-values"><div><dt>${esc(legacy?t('Combined usage / kWh','Łączna stawka zużycia / kWh'):t('Energy / kWh','Energia / kWh'))}</dt><dd>${esc(summaryRate(zone.energyRate,rate.currency))}</dd></div><div><dt>${esc(t('Distribution / kWh','Dystrybucja / kWh'))}</dt><dd>${esc(legacy?unknown():summaryRate(zone.variableRate,rate.currency))}</dd></div><div><dt>${esc(t('Total / kWh','Razem / kWh'))}</dt><dd data-analysis-rate76-total="${esc(zone.id)}">${esc(summaryRate(combinedRates.get(zone.id),rate.currency))}</dd></div></dl></li>`;
        }).join('')}</ul>
        ${!zones.length?`<p>${esc(unknown())}</p>`:''}
        ${dynamic.length?table(t('Dynamic rate intervals','Przedziały stawek dynamicznych'),[t('Period','Okres'),t('Energy / kWh','Energia / kWh'),t('Distribution / kWh','Dystrybucja / kWh')],dynamic,'class="analysis-rate76-table"'):''}
        <p class="analysis-rate76-meta">${esc(t('Monthly fees · metadata, not another period charge','Opłaty miesięczne · metadane, bez ponownego naliczania'))}</p><ul class="analysis-rate76-monthly">${monthly.join('') || `<li>${esc(unknown())}</li>`}</ul></article>`;
    }).join('');
    const versions=(snapshot.rates || []).map(rate=>{
      const profile=rate.profile || {},zones=profile.zones || [],label=id=>zones.find(zone=>zone.id===id)?.label || t('Unnamed zone','Strefa bez nazwy');
      const rateRows=zones.map(zone=>[esc(zone.label || t('Unnamed zone','Strefa bez nazwy')),esc(money(zone.energyRate,rate.currency)),esc(money(zone.variableRate,rate.currency)),esc(zone.id === profile.defaultZone ? t('Default outside matching rules','Domyślna poza pasującymi regułami') : '')]);
      const ruleRows=[...(profile.rules || []).map(rule=>[esc(t('Rule','Reguła')),esc(label(rule.zone)),esc(ruleText(rule))]),...(profile.exceptions || []).map(rule=>[esc(t('Exception','Wyjątek')),esc(label(rule.zone)),esc(ruleText(rule))])];
      const dynamic=(profile.dynamic?.intervals || []).map(row=>[esc(`${dateTime(row.from)} – ${dateTime(row.to)}`),esc(money(row.energyRate,rate.currency)),esc(money(row.variableRate,rate.currency))]);
      const fees=Object.entries(feeLabels).filter(([key])=>Object.hasOwn(rate.fixed_monthly || {},key)).map(([key,label])=>[esc(label),`<span data-analysis-monthly="${key}">${esc(money(rate.fixed_monthly[key],rate.currency))}</span>`]);
      if (rate.legacy_combined_monthly != null) fees.push([esc(t('Legacy combined monthly fee','Dawna łączna opłata miesięczna')),esc(money(rate.legacy_combined_monthly,rate.currency))]);
      return `<section class="analysis-rate-version"><h4>${esc(t('Rates effective from','Stawki obowiązujące od'))} ${esc(date(rate.valid_from))}${rate.valid_to ? ' – '+esc(date(rate.valid_to)) : ''}</h4><p>${esc(rate.currency || unknown())} · ${esc(basis(rate.price_basis))} · ${esc(profile.timezone || unknown())} · ${esc(profile.clock?.mode === 'fixed' ? t('Fixed UTC offset','Stałe przesunięcie UTC')+': '+quantity(profile.clock.offsetMinutes,'min',true) : profile.clock?.mode === 'civil' ? t('Civil tariff clock','Czas lokalny taryfy') : unknown())}</p>
        ${table(t('Tariff rates per kWh','Stawki taryfy za kWh'),[t('Zone','Strefa'),rate.rate_semantics === 'legacy_combined' ? t('Combined usage / kWh','Łączna stawka zużycia / kWh') : t('Energy / kWh','Energia / kWh'),t('Distribution / kWh','Dystrybucja / kWh'),t('Application','Stosowanie')],rateRows)}
        ${ruleRows.length ? table(t('Schedules and exceptions','Godziny i wyjątki'),[t('Type','Rodzaj'),t('Zone','Strefa'),t('Calendar rules','Reguły kalendarza')],ruleRows) : ''}
        ${dynamic.length ? table(t('Dynamic rate intervals','Przedziały stawek dynamicznych'),[t('Period','Okres'),t('Energy / kWh','Energia / kWh'),t('Distribution / kWh','Dystrybucja / kWh')],dynamic) : ''}
        ${table(t('Monthly fees · metadata, not another period charge','Opłaty miesięczne · metadane, bez ponownego naliczania'),[t('Component','Składnik'),t('Amount / month','Kwota / miesiąc')],fees)}
        <details><summary>${esc(t('Rate provenance','Pochodzenie stawek'))}</summary><p>${esc(rate.provenance || unknown())}</p><p>${esc(rate.version_id)}</p><p>UTC / ${esc(t('source validity','ważność źródłowa'))}: ${esc(rate.valid_from)} – ${esc(rate.valid_to)}</p></details></section>`;
    }).join('');
    const proof=periodZoneProof(snapshot,periodWindow(snapshot));
    const zoneReady=proof?.status==='ready'&&currencyKnown&&positive(total.usage_cost)&&proof.zones.every(zone=>zone.complete&&positive(zone.usage_cost)&&compare(zone.usage_cost,total.usage_cost)<=0);
    const zoneDetails=proof?zoneEntries(snapshot,snapshot.period_summary,{period:true}):null;
    const zoneGraphic=!data&&zoneReady?`<div class="analysis-rate76-track" aria-hidden="true">${proof.zones.map(zone=>`<span data-analysis-rate76-bar style="background:${zoneColor(zone.version_id,zone.zone_id,snapshot)};width:${width(zone.usage_cost,Number(total.usage_cost))}%" title="${esc(zone.label+': '+summaryMoney(zone.usage_cost,proof.currency))}"></span>`).join('')}</div>`:'';
    const zoneRows=proof?.zones.map(zone=>{
      const rate=(snapshot.rates || []).find(row=>row.version_id===zone.version_id),complete=proof.status==='ready'&&zone.complete;
      const known=[[t('Known energy cost','Znany koszt energii'),'energy_cost'],[t('Known distribution cost','Znany koszt dystrybucji'),'variable_cost'],[t('Known legacy usage cost','Znany dawny koszt zużycia'),'legacy_combined_cost']].map(([label,key])=>`${label}: ${summaryMoney(zone.known_costs[key],proof.currency)}`).join(' · ');
      return `<li data-analysis-rate76-zone="${esc(zone.version_id+'|'+zone.zone_id)}"><span class="analysis-rate76-swatch" style="background:${zoneColor(zone.version_id,zone.zone_id,snapshot)}" aria-hidden="true"></span><div><strong>${esc(zone.label)}</strong><span class="analysis-rate76-meta"> · ${esc(t('Rates from','Stawki od'))} ${esc(rate?date(rate.valid_from):unknown())}</span><p>${esc(complete?summaryEnergy(zone.kwh):t('Recorded','Zarejestrowano')+': '+summaryEnergy(zone.recorded_kwh))} · <strong>${esc(summaryMoney(complete?zone.usage_cost:null,proof.currency))}</strong></p>${!complete?`<p class="analysis-rate76-meta">${esc(known)}</p>`:''}</div></li>`;
    }).join('') || '';
    const level=['areas','floors','devices'].includes(options.level)?options.level:'areas';
    const groupRows=rowsFor(groups,level).sort((a,b)=>valid(a.row.usage_cost)&&valid(b.row.usage_cost)?compare(b.row.usage_cost,a.row.usage_cost):valid(a.row.usage_cost)?-1:valid(b.row.usage_cost)?1:0);
    const groupCurrency=currencyKnown&&groups.currency===total.currency&&groups.price_basis===total.price_basis;
    const groupMax=maximum(groupRows.filter(({row})=>positive(row.usage_cost)).map(({row})=>row.usage_cost));
    const groupTitle=level==='devices'?t('Cost by device','Koszt według urządzeń'):level==='floors'?t('Cost by floor','Koszt według pięter'):t('Cost by room','Koszt według pokoi');
    const ranked=groupRows.map(({id,label,row})=>`<li data-analysis-rate76-group="${esc(id)}"${id==='unmeasured'?' class="analysis-rate76-unmeasured"':''}><div class="analysis-rate76-rank-value"><strong>${esc(label)}</strong><strong>${esc(summaryMoney(row.usage_cost,groups.currency))}</strong></div>${!data&&groupCurrency&&row.measurement_complete===true&&positive(row.usage_cost)?`<div class="analysis-rate76-track" aria-hidden="true"><span data-analysis-rate76-bar style="background:${zoneColor('group-'+level,id)};width:${width(row.usage_cost,groupMax)}%"></span></div>`:''}<p class="analysis-rate76-meta">${esc(data?quantity(row.kwh):briefEnergy(row.kwh))} · ${esc(coverage(row.coverage))}</p></li>`).join('');
    const groupValues=table(t('Group measurements and usage costs','Pomiary grup i koszty zużycia'),[t('Group','Grupa'),'kWh',t('Usage cost','Koszt zużycia')],groupRows.map(({label,row})=>[esc(label),esc(quantity(row.kwh)),esc(money(row.usage_cost,groups.currency))]));
    const alternativeRows=(snapshot.alternatives || []).filter(row=>row.tariff_id!==snapshot.active_tariff_id);
    const comparable=row=>row.comparable===true&&currencyKnown&&row.currency===total.currency&&row.price_basis===total.price_basis;
    const alternatives=alternativeRows.map(row=>[esc(row.tariff_name || t('Unnamed tariff','Taryfa bez nazwy')),esc(quantity(row.kwh)),esc(money(row.total_cost,row.currency)),esc(comparable(row)?money(row.delta_cost,row.currency,true):unknown())]);
    const costTable=table(t('Household cost for selected period','Koszt gospodarstwa za wybrany okres'),[t('Component','Składnik'),t('Cost','Koszt')],Object.entries(costLabels).map(([key,label])=>[esc(label),esc(money(total[key],total.currency))]),'data-analysis-cost-components class="analysis-rate76-table"');
    return `<section class="analysis-rate76" data-analysis-rates><div class="analysis-rate76-heading"><h3>${esc(t('Rates and costs','Stawki i koszty'))}</h3><div class="analysis-switch">${button('view','chart',t('Chart','Wykres'),!data)}${button('view','data',t('Data','Dane'),data)}</div></div>
      <div class="analysis-rate76-current" data-analysis-rate76-current>${visibleRates || `<p>${esc(unknown())}</p>`}</div>
      <div class="analysis-rate76-layout"><div><section class="analysis-rate76-card" data-analysis-rate76-cost><h4>${esc(t('Household cost for selected period','Koszt gospodarstwa za wybrany okres'))}</h4><p><strong>${esc(summaryMoney(total.total_cost,total.currency))}</strong> · ${esc(t('Effective price','Cena efektywna'))}: ${esc(summaryRate(total.effective_price,total.currency))}${valid(total.effective_price)?'/kWh':''}</p>
        ${costGraphic}<ul class="analysis-rate76-legend">${componentLegend}</ul>
        ${!costReady?`<p class="analysis-rate76-meta">${esc(t('A complete positive cost breakdown is unavailable. Available amounts retain their signs.','Pełne dodatnie rozbicie kosztu jest niedostępne. Dostępne kwoty zachowują swój znak.'))}</p>`:compare(total.total_cost,'0')===0?`<p class="analysis-rate76-meta">${esc(t('Zero cost','Koszt zerowy'))}</p>`:''}
        ${data?costTable:`<details class="analysis-rate76-history"><summary>${esc(t('Exact cost components','Dokładne składniki kosztu'))}</summary>${costTable}</details>`}
        ${snapshot.fees?.components?`<details class="analysis-rate76-history" data-analysis-fee-details><summary>${esc(t('Fixed fee components for period','Składniki opłat stałych za okres'))}</summary>${table(t('Fixed fee components for period','Składniki opłat stałych za okres'),[t('Component','Składnik'),t('Cost','Koszt')],Object.entries(snapshot.fees.components).map(([key,value])=>[esc(feeLabels[key]||t('Legacy combined fee','Dawna opłata łączna')),esc(money(value,total.currency))]))}</details>`:''}</section>
      <section class="analysis-rate76-card" data-analysis-rate76-zones><h4>${esc(t('Cost by tariff zone','Koszt według stref taryfy'))}</h4><p class="analysis-rate76-meta">${esc(t('Whole selected period · usage cost without fixed fees','Cały wybrany okres · koszt zużycia bez opłat stałych'))}</p>${zoneGraphic}
        ${proof?`<ul class="analysis-rate76-zone-list">${zoneRows}</ul>${proof.status!=='ready'?`<p class="analysis-rate76-meta">${esc(proof.status==='partial'?t('Incomplete period · recorded energy and known costs only','Niepełny okres · tylko zarejestrowana energia i znane koszty'):t('No tariff cost data for this period','Brak kosztów taryfy za ten okres'))}</p>`:''}`:`<p>${esc(t('No data: matching whole-period zone costs are unavailable.','Brak danych: brak zgodnych kosztów stref za cały okres.'))}</p>`}
        ${zoneDetails?`<details class="analysis-rate76-history"><summary>${esc(t('Zone coverage and provenance','Pokrycie i pochodzenie stref'))}</summary><p>${esc(zoneDetails.note)}</p><ul>${zoneDetails.entries.map(entry=>`<li>${esc(entry.text)}</li>`).join('')}</ul></details>`:''}</section></div>
      <section class="analysis-rate76-card" data-analysis-rate76-groups><h4>${esc(groupTitle)}</h4><p class="analysis-rate76-meta">${esc(groups.currency || unknown())} · ${esc(basis(groups.price_basis))}</p><ol class="analysis-rate76-rank-list">${ranked}</ol>${data?'':`<details data-analysis-rate76-group-values><summary>${esc(t('Group measurements and costs','Pomiary i koszty grup'))}</summary>${groupValues}</details>`}${!groupRows.length?`<p>${esc(unknown())}</p>`:''}<p class="analysis-rate76-meta">${esc(t('Group costs exclude household fixed fees. No room and unmeasured energy are separate. Bars rank known nonnegative costs in the same currency and basis.','Koszty grup nie obejmują opłat stałych gospodarstwa. Bez pokoju i Niezmierzone to osobne pozycje. Paski porównują znane nieujemne koszty w tej samej walucie i podstawie.'))}</p></section></div>
      <section><h4>${esc(t('Same measured energy in alternative tariffs · no activation','Ta sama zmierzona energia w innych taryfach · bez aktywacji'))}</h4><div class="analysis-rate76-alternatives">${alternativeRows.map(row=>`<article class="analysis-rate76-card" data-analysis-rate76-alternative><strong>${esc(row.tariff_name || t('Unnamed tariff','Taryfa bez nazwy'))}</strong><p>${esc(summaryEnergy(row.kwh))} · <strong>${esc(summaryMoney(row.total_cost,row.currency))}</strong> · ${esc(basis(row.price_basis))}</p><p>${esc(comparable(row)?t('Difference','Różnica')+': '+summaryMoney(row.delta_cost,row.currency,true):t('No comparable difference','Brak porównywalnej różnicy'))}</p><p class="analysis-rate76-meta">${esc(t('Same measured energy · no activation','Ta sama zmierzona energia · bez aktywacji'))}</p></article>`).join('') || `<p>${esc(t('No alternative tariff comparison available','Brak porównania alternatywnej taryfy'))}</p>`}</div>
      ${alternativeRows.length?`<details class="analysis-rate76-history"><summary>${esc(t('Alternative tariff values','Wartości alternatywnych taryf'))}</summary>${table(t('Same measured energy in alternative tariffs · no activation','Ta sama zmierzona energia w innych taryfach · bez aktywacji'),[t('Tariff','Taryfa'),'kWh',t('Total cost','Koszt całkowity'),t('Delta','Różnica')],alternatives)}</details>`:''}</section>
      <details class="analysis-rate76-history" data-analysis-rate-history><summary>${esc(t('Rates, schedules and history','Stawki, godziny i historia'))}</summary>${versions || `<p>${esc(unknown())}</p>`}</details>
      <p class="analysis-rate76-meta">${esc(t('Fixed fees apply once to the household period. Alternatives use the same measurements.','Opłaty stałe dotyczą jednokrotnie całego okresu gospodarstwa. Alternatywy korzystają z tych samych pomiarów.'))}</p></section>`;
  };
  const comparisonView = (snapshot,options,kind) => {
    const comparison=snapshot.comparisons?.[kind] || {}, ready=comparison.status === 'ready', costs=comparison.costs || {}, currency=costs.current?.currency || snapshot.totals?.currency, baselineCurrency=costs.baseline?.currency;
    const groups=comparison.groups || {}, rows=rowsFor(groups,options.level,snapshot.groups), max=maximum(rows.map(({row})=>row.delta_kwh));
    const signedValue=row=>row.status === 'ready' ? quantity(row.delta_kwh,'kWh',true) : unknown();
    return `<section><h3>${esc(t('Period comparison','Porównanie okresów'))}</h3><p>${esc(comparisons[kind])} · ${esc(ready ? comparison.comparison_scope === 'common_measurements' ? t('Common measurements only','Tylko wspólne pomiary') : t('Calendar totals','Sumy kalendarzowe') : unknown())}</p>
      ${chart(snapshot,options)}
      ${table(t('Household comparison','Porównanie gospodarstwa'),[t('Measurement','Pomiar'),t('Current','Bieżący'),t('Baseline','Odniesienie'),t('Delta','Różnica')],[
        [esc(t('Energy','Energia')),esc(quantity(comparison.current_kwh)),esc(quantity(comparison.baseline_kwh)),esc(ready ? quantity(comparison.delta_kwh,'kWh',true) : unknown())],
        [esc(t('Percentage change','Zmiana procentowa')),'','',esc(ready ? quantity(comparison.percent,'%',true) : unknown())],
        [esc(t('Usage cost without fixed fees','Koszt zużycia bez opłat stałych')),esc(money(costs.current?.usage_cost,currency)),esc(money(costs.baseline?.usage_cost,baselineCurrency)),esc(costs.status === 'ready' ? money(costs.delta_cost,currency,true) : unknown())],
        [esc(t('Household total cost','Całkowity koszt gospodarstwa')),esc(money(costs.current?.total_cost,currency)),esc(money(costs.baseline?.total_cost,baselineCurrency)),esc(costs.status === 'ready' ? money(costs.delta_total_cost,currency,true) : unknown())],
        [esc(t('Coverage','Pokrycie')),esc(coverage(comparison.coverage?.current)),esc(comparison.coverage?.baseline != null ? coverage(comparison.coverage.baseline) : (comparison.coverage?.baselines || []).map(coverage).join(' · ') || unknown()),'']
      ])}
      ${(comparison.baseline_periods||[]).length?`${options.view==='data'?'':`<details data-analysis-baseline-period-details><summary>${esc(t('Comparison dates','Daty porównania'))}</summary>`}${(comparison.baseline_periods||[]).map(period=>`<p>${esc(t('Baseline period','Okres odniesienia'))}: ${esc(range(period))}</p>`).join('')}${options.view==='data'?'':'</details>'}`:''}
      <section data-analysis-comparison-groups><h4>${esc(t('Change by group','Zmiana według grup'))}</h4>
      ${options.view === 'data' ? '' : `<ul class="analysis-deltas">${rows.map(({id,label,row})=>`<li class="${id === 'unmeasured' ? 'analysis-unmeasured' : ''}"><div>${esc(label)} <strong>${esc(signedValue(row))}</strong></div><div class="analysis-delta-track" aria-hidden="true"><span class="${String(row.delta_kwh).startsWith('-') ? 'analysis-decrease' : 'analysis-increase'}" style="width:${width(row.status === 'ready' ? row.delta_kwh : null,max)/2}%"></span></div></li>`).join('')}</ul>`}
      ${options.view==='data'?'':`<details data-analysis-comparison-details><summary>${esc(t('Group comparison values','Wartości porównania grup'))}</summary>`}${table(t('Group comparison · server deltas','Porównanie grup · różnice z serwera'),[t('Group','Grupa'),t('Energy delta','Różnica energii'),t('Usage cost delta','Różnica kosztu zużycia'),t('Change','Zmiana'),t('Current coverage','Pokrycie bieżące'),t('Baseline coverage','Pokrycie odniesienia')],rows.map(({label,row})=>[esc(label),esc(signedValue(row)),esc(row.status === 'ready' ? money(row.delta_usage_cost,groups.currency,true) : unknown()),esc(row.status === 'ready' ? quantity(row.percent,'%',true) : unknown()),esc(coverage(row.coverage?.current)),esc(row.coverage?.baseline != null ? coverage(row.coverage.baseline) : (row.coverage?.baselines || []).map(coverage).join(' · ') || unknown())]))}
      <p class="analysis-note">${esc(t('Group coverage and calendar masks may differ from household coverage. Unknown deltas are not zero.','Pokrycie i maski kalendarzowe grup mogą różnić się od pokrycia gospodarstwa. Nieznana różnica nie oznacza zera.'))}</p>${options.view==='data'?'':'</details>'}</section></section>`;
  };
  const markup = (snapshot, options = {}) => {
    const section=['overview','rates','comparison'].includes(options.section) ? options.section : 'overview';
    const level=['areas','floors','devices'].includes(options.level) ? options.level : 'areas';
    options={...options,level};
    if (!snapshot || snapshot.schema !== 2) return `<div class="energy-analysis-v53"><p role="status">${esc(unknown())}</p></div>`;
    const period=snapshot.period || {},allowed=period.kind === 'day' ? ['previous','same_weekday','mean7'] : ['previous','year_ago'];
    const requested=options.comparison || snapshot.context?.comparison_kind,kind=allowed.includes(requested) ? requested : 'previous';
    const anchor=/^\d{4}-\d{2}-\d{2}$/.test(options.anchor || '') ? options.anchor : /^\d{4}-\d{2}-\d{2}$/.test(snapshot.context?.period_anchor || '') ? snapshot.context.period_anchor : '';
    const filters=`<div class="analysis-controls" data-analysis-filters>
      ${select('level',t('Group by','Grupuj według'),[['areas',t('Rooms','Pokoje')],...(snapshot.groups?.floor_supported===true?[['floors',t('Floors','Piętra')]]:[]),['devices',t('Devices','Urządzenia')]],level)}
      <details data-analysis-calendar-options><summary>${esc(t('Date and comparison','Data i porównanie'))}</summary><div class="analysis-calendar-fields">
      <label>${esc(t('Calendar date','Data kalendarzowa'))}<input type="date" data-analysis-action="anchor" data-analysis-value="${esc(anchor)}" value="${esc(anchor)}"></label>
      ${select('comparison',t('Compare with','Porównaj z'),allowed.map(key=>[key,comparisons[key]]),kind)}</div></details></div>`;
    return `<div class="energy-analysis-v53"><div class="analysis-period-controls"><div class="analysis-switch" role="group" aria-label="${esc(t('Period','Okres'))}">${periods.map(([value,label])=>button('period',value,label,period.kind===value)).join('')}</div><p class="analysis-period">${esc(range(period))} · ${esc(ui.timeZone)} · ${esc(coverage(snapshot.coverage))}</p></div>
      ${section==='overview'?tiles(snapshot,true,options.view==='data')+nativeDetails(snapshot):''}${section==='rates'?filters+ratesView(snapshot,options):section==='comparison'?comparisonView(snapshot,options,kind)+filters:chart(snapshot,options)+filters+groupsView(snapshot,level,options)}
      <details data-analysis-source-details><summary>${esc(t('Source and time details','Źródło i szczegóły czasu'))}</summary><p>${esc(t('Measurement calendar','Kalendarz pomiarów'))}: ${esc(period.timezone||unknown())}</p><p>UTC: ${esc(period.start)} – ${esc(period.end)}</p></details></div>`;
  };
  const styles = () => `

.energy-analysis-v53 .analysis-rate76{font-size:14px;line-height:20px;min-width:0;--analysis-rate76-energy:var(--hat-s1, var(--_hat-s1));--analysis-rate76-distribution:var(--hat-d2, var(--_hat-d2));--analysis-rate76-fixed:var(--hat-text-2, var(--_hat-text-2));--analysis-rate76-legacy:var(--hat-s3, var(--_hat-s3))}
.energy-analysis-v53 .analysis-rate76-meta{font-size:12px;color:var(--hat-text-2, var(--_hat-text-2));overflow-wrap:anywhere}
.energy-analysis-v53 .analysis-rate76-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.energy-analysis-v53 .analysis-rate76-card{min-width:0;border:1px solid var(--hat-border, var(--_hat-border));border-radius:var(--hat-radius, var(--_hat-radius));background:var(--hat-card, var(--_hat-card));padding:12px;overflow-wrap:anywhere}
.energy-analysis-v53 .analysis-rate76-card h4{margin-top:0}
.energy-analysis-v53 .analysis-rate76-current{display:grid;gap:12px}
.energy-analysis-v53 .analysis-rate76-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}
.energy-analysis-v53 .analysis-rate76-layout>div{min-width:0}
.energy-analysis-v53 .analysis-rate76-rate-list,.energy-analysis-v53 .analysis-rate76-monthly,.energy-analysis-v53 .analysis-rate76-legend,.energy-analysis-v53 .analysis-rate76-zone-list,.energy-analysis-v53 .analysis-rate76-rank-list{list-style:none;padding:0;margin:8px 0}
.energy-analysis-v53 .analysis-rate76-rate-list>li{display:grid;grid-template-columns:minmax(80px,.6fr) minmax(0,1.2fr) minmax(0,1.2fr);gap:12px;align-items:start;padding:12px 0;border-top:1px solid var(--hat-border, var(--_hat-border))}
.energy-analysis-v53 .analysis-rate76-schedule p{margin:0 0 4px}
.energy-analysis-v53 .analysis-rate76-rate-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0;font-variant-numeric:tabular-nums}
.energy-analysis-v53 .analysis-rate76-rate-values dt{font-size:12px;color:var(--hat-text-2, var(--_hat-text-2))}
.energy-analysis-v53 .analysis-rate76-rate-values dd{font-weight:600;margin:4px 0 0}
.energy-analysis-v53 .analysis-rate76-monthly{display:flex;flex-wrap:wrap;gap:8px 16px}
.energy-analysis-v53 .analysis-rate76-track{display:flex;height:14px;min-width:0;max-width:100%;background:var(--hat-chip, var(--_hat-chip));border-radius:4px;overflow:hidden;margin:10px 0}
.energy-analysis-v53 .analysis-rate76-track>span{display:block;min-width:0;height:100%;flex-shrink:0}
.energy-analysis-v53 .analysis-rate76-energy_cost{background:var(--analysis-rate76-energy)}
.energy-analysis-v53 .analysis-rate76-variable_cost{background:var(--analysis-rate76-distribution)}
.energy-analysis-v53 .analysis-rate76-fixed_cost{background:var(--analysis-rate76-fixed)}
.energy-analysis-v53 .analysis-rate76-legacy_combined_cost{background:var(--analysis-rate76-legacy)}
.energy-analysis-v53 .analysis-rate76-legend{display:flex;flex-wrap:wrap;gap:8px 16px}
.energy-analysis-v53 .analysis-rate76-legend>li,.energy-analysis-v53 .analysis-rate76-zone-list>li{display:flex;align-items:baseline;gap:6px;min-width:0}
.energy-analysis-v53 .analysis-rate76-zone-list>li{padding:8px 0;border-bottom:1px solid var(--hat-border, var(--_hat-border))}
.energy-analysis-v53 .analysis-rate76-swatch{display:inline-block;width:10px;height:10px;flex:0 0 10px;border-radius:2px}
.energy-analysis-v53 .analysis-rate76-rank-list>li{padding:12px 0;border-bottom:1px solid var(--hat-border, var(--_hat-border))}
.energy-analysis-v53 .analysis-rate76-rank-value{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;font-variant-numeric:tabular-nums}
.energy-analysis-v53 .analysis-rate76-unmeasured .analysis-rate76-track>span{background:repeating-linear-gradient(135deg,transparent,transparent 3px,var(--hat-unmeasured, var(--_hat-unmeasured)) 3px,var(--hat-unmeasured, var(--_hat-unmeasured)) 4px)!important;border:1px solid var(--hat-unmeasured, var(--_hat-unmeasured))}
.energy-analysis-v53 .analysis-rate76-alternatives{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}
.energy-analysis-v53 .analysis-rate76-history{border-top:1px solid var(--hat-border, var(--_hat-border));margin-top:12px}
.energy-analysis-v53 .analysis-rate76-history .analysis-table-wrap{overflow:visible}
.energy-analysis-v53 .analysis-rate76-history table,.energy-analysis-v53 .analysis-rate76-table{table-layout:fixed;width:100%;overflow-wrap:anywhere}
@container energy-analysis (max-width:600px){.energy-analysis-v53 .analysis-rate76-layout{grid-template-columns:minmax(0,1fr);gap:0}.energy-analysis-v53 .analysis-rate76-rate-list>li{grid-template-columns:minmax(0,1fr);gap:6px}.energy-analysis-v53 .analysis-rate76-card{padding:12px}.energy-analysis-v53 .analysis-rate76-rate-values{gap:8px}.energy-analysis-v53 .analysis-rate76-history th,.energy-analysis-v53 .analysis-rate76-history td{padding:8px 4px}}
.energy-analysis-v53{font-family:var(--hat-font, var(--_hat-font));font-size:14px;line-height:20px;color:var(--hat-text, var(--_hat-text));min-width:0;max-width:100%;width:100%;overflow-wrap:anywhere;container-type:inline-size;container-name:energy-analysis}
.energy-analysis-v53 *{box-sizing:border-box}
.energy-analysis-v53 h3,.energy-analysis-v53 h4{font-size:1em;margin:12px 0 8px}
.energy-analysis-v53 p{margin:8px 0}
.energy-analysis-v53 section{min-width:0;margin-block:12px}
.energy-analysis-v53 .analysis-switch,.energy-analysis-v53 .analysis-section-title,.energy-analysis-v53 .analysis-period-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.energy-analysis-v53 .analysis-period-controls{justify-content:space-between}
.energy-analysis-v53 .analysis-period{font-size:12px;color:var(--hat-text-2, var(--_hat-text-2));margin:4px 0}
.energy-analysis-v53 .analysis-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:12px;align-items:end;margin-block:16px}
.energy-analysis-v53 .analysis-section-title{justify-content:space-between}
.energy-analysis-v53 .analysis-calendar-fields{display:grid;gap:12px;padding-block:8px}
.energy-analysis-v53 [data-analysis-calendar-options]{margin:0;min-width:0}
.energy-analysis-v53 [data-analysis-calendar-options] summary{min-height:44px}
.energy-analysis-v53 label{display:flex;flex-direction:column;gap:4px;max-width:100%;min-width:0;font-size:12px}
.energy-analysis-v53 .analysis-controls select,.energy-analysis-v53 .analysis-controls input{width:100%;min-width:0;font-size:14px}
.energy-analysis-v53 button,.energy-analysis-v53 select,.energy-analysis-v53 input{font:inherit;color:var(--hat-text, var(--_hat-text));background:var(--hat-card, var(--_hat-card));border:1px solid var(--hat-border, var(--_hat-border));border-radius:8px;min-height:44px;min-width:44px;padding:8px;max-width:100%}
.energy-analysis-v53 button{cursor:pointer;white-space:normal}
.energy-analysis-v53 button[aria-pressed="true"]{border-color:var(--hat-primary, var(--_hat-primary));box-shadow:inset 0 0 0 1px var(--hat-primary, var(--_hat-primary))}
.energy-analysis-v53 button:focus-visible,.energy-analysis-v53 select:focus-visible,.energy-analysis-v53 input:focus-visible,.energy-analysis-v53 summary:focus-visible{outline:2px solid var(--hat-primary, var(--_hat-primary));outline-offset:2px}
.energy-analysis-v53 summary{min-height:44px;padding:12px 0;cursor:pointer}
.energy-analysis-v53 .analysis-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}
.energy-analysis-v53 .analysis-tile{min-width:0;border:1px solid var(--hat-border, var(--_hat-border));border-radius:var(--hat-radius, var(--_hat-radius));padding:12px 16px;background:var(--hat-card, var(--_hat-card));box-shadow:none}
.energy-analysis-v53 .analysis-tile span,.energy-analysis-v53 .analysis-tile strong{display:block}
.energy-analysis-v53 .analysis-tile span{font-size:12px;color:var(--hat-text-2, var(--_hat-text-2))}
.energy-analysis-v53 .analysis-tile strong{font-size:1.35em;margin-top:4px;font-variant-numeric:tabular-nums}
.energy-analysis-v53 .analysis-period-zones{list-style:none;margin:8px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:8px}
.energy-analysis-v53 .analysis-period-zones li{min-width:0;display:grid;gap:4px;padding:8px 10px;border:1px solid var(--hat-border, var(--_hat-border));border-radius:8px}
.energy-analysis-v53 .analysis-period-zones li>span:last-child{font-size:12px;color:var(--hat-text-2, var(--_hat-text-2))}
.energy-analysis-v53 [data-analysis-period-summary-details]{border-top:1px solid var(--hat-border, var(--_hat-border));margin-top:8px}
.energy-analysis-v53 .analysis-note{color:var(--hat-text-2, var(--_hat-text-2))}
.energy-analysis-v53 .analysis-table-wrap{overflow:auto;max-width:100%}
.energy-analysis-v53 table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;text-align:start}
.energy-analysis-v53 caption{text-align:start;font-weight:600;padding:8px 0}
.energy-analysis-v53 th,.energy-analysis-v53 td{padding:12px 8px;border-bottom:1px solid var(--hat-border, var(--_hat-border));vertical-align:top;text-align:start}
.energy-analysis-v53 th{font-weight:600}
.energy-analysis-v53 .analysis-chart-scroll{min-width:0;max-width:100%;width:100%;overflow:visible;padding:4px 2px}
.energy-analysis-v53 .analysis-chart{display:grid;grid-template-columns:repeat(var(--analysis-point-count),minmax(0,1fr));align-items:stretch;height:212px;min-width:0;max-width:100%;width:100%;gap:2px}
.energy-analysis-v53 .analysis-point{position:relative;display:flex;align-items:flex-end;justify-content:center;min-width:0;max-width:100%;width:100%;height:212px;padding:0 0 40px;border:0;border-radius:0;background:transparent;touch-action:manipulation}
.energy-analysis-v53 .analysis-point:focus-visible{outline-offset:0;z-index:1}
.energy-analysis-v53 .analysis-point[aria-pressed="true"]{box-shadow:inset 0 0 0 1px var(--hat-primary, var(--_hat-primary))}
.energy-analysis-v53 .analysis-column{display:block;width:100%;max-height:168px;background:var(--energy-grid-consumption-color,var(--hat-s1, var(--_hat-s1)));border-radius:3px 3px 0 0;min-height:1px}
.energy-analysis-v53 .analysis-baseline-line{display:block;position:absolute;inset-inline:0;height:0;border-top:3px dashed var(--hat-d2, var(--_hat-d2));pointer-events:none}\n.energy-analysis-v53 [data-analysis-series-legend] .analysis-series-current:before{content:"● ";color:var(--secondary-text-color,var(--hat-unmeasured, var(--_hat-unmeasured)))}\n.energy-analysis-v53 [data-analysis-series-legend] .analysis-series-baseline:before{content:"━ ";color:var(--hat-d2, var(--_hat-d2))}\n.energy-analysis-v53 [data-analysis-baseline-range]{display:inline-block}\n.energy-analysis-v53 .analysis-point-label{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);width:max-content;font-size:12px;line-height:16px}
.energy-analysis-v53 .analysis-point:first-child .analysis-point-label{left:0;transform:none}
.energy-analysis-v53 .analysis-point:last-child .analysis-point-label{left:auto;right:0;transform:none}
.energy-analysis-v53 .analysis-missing{background:repeating-linear-gradient(135deg,transparent,transparent 5px,var(--hat-border, var(--_hat-border)) 5px,var(--hat-border, var(--_hat-border)) 6px)}
.energy-analysis-v53 .analysis-flow{display:grid;grid-template-columns:minmax(120px,.3fr) minmax(0,1fr);gap:16px;align-items:start}
.energy-analysis-v53 .analysis-flow-source{display:flex;flex-direction:column;gap:4px;padding:12px;border-inline-start:4px solid var(--energy-grid-consumption-color,var(--hat-s1, var(--_hat-s1)));background:var(--hat-chip, var(--_hat-chip));border-radius:8px;min-width:0}
.energy-analysis-v53 .analysis-flow-source>span:first-child{font-size:12px;color:var(--hat-text-2, var(--_hat-text-2))}
.energy-analysis-v53 .analysis-flow-destination{min-width:0}
.energy-analysis-v53 .analysis-flow-destination h4{margin-top:0}
.energy-analysis-v53 [data-analysis-group-details],.energy-analysis-v53 [data-analysis-rate-history],.energy-analysis-v53 [data-analysis-fee-details],.energy-analysis-v53 [data-analysis-source-details]{border-top:1px solid var(--hat-border, var(--_hat-border));margin-top:12px}
.energy-analysis-v53 .analysis-ranking,.energy-analysis-v53 .analysis-deltas{list-style:none;margin:0;padding:0}
.energy-analysis-v53 .analysis-ranking li,.energy-analysis-v53 .analysis-deltas li{padding:8px 0;border-bottom:1px solid var(--hat-border, var(--_hat-border))}
.energy-analysis-v53 .analysis-ranking li>div:first-child,.energy-analysis-v53 .analysis-deltas li>div:first-child{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
.energy-analysis-v53 .analysis-track,.energy-analysis-v53 .analysis-delta-track{height:8px;background:var(--hat-chip, var(--_hat-chip));border-radius:999px;margin-top:8px;position:relative}
.energy-analysis-v53 .analysis-rank{display:block;height:100%;background:var(--energy-device-consumption-color,var(--hat-d1, var(--_hat-d1)))}
.energy-analysis-v53 .rank-0{background:var(--analysis-rank-0,var(--hat-d1, var(--_hat-d1)))}.energy-analysis-v53 .rank-1{background:var(--analysis-rank-1,var(--hat-d2, var(--_hat-d2)))}.energy-analysis-v53 .rank-2{background:var(--analysis-rank-2,var(--hat-d3, var(--_hat-d3)))}.energy-analysis-v53 .rank-3{background:var(--analysis-rank-3,var(--hat-d4, var(--_hat-d4)))}.energy-analysis-v53 .rank-4{background:var(--analysis-rank-4,var(--hat-unmeasured, var(--_hat-unmeasured)))}
.energy-analysis-v53 .analysis-unmeasured .analysis-rank{background:repeating-linear-gradient(135deg,transparent,transparent 3px,var(--hat-unmeasured, var(--_hat-unmeasured)) 3px,var(--hat-unmeasured, var(--_hat-unmeasured)) 4px);border:1px solid var(--hat-unmeasured, var(--_hat-unmeasured))}
.energy-analysis-v53 .analysis-delta-track:before{content:'';position:absolute;left:50%;height:100%;border-left:1px solid var(--hat-text-2, var(--_hat-text-2))}
.energy-analysis-v53 .analysis-decrease{position:absolute;right:50%;height:100%;background:var(--hat-s1, var(--_hat-s1))}
.energy-analysis-v53 .analysis-increase{position:absolute;left:50%;height:100%;background:var(--hat-crit, var(--_hat-crit))}

.energy-analysis-v53{--analysis-zone-cheap:var(--hat-zone-cheap, var(--_hat-zone-cheap));--analysis-zone-expensive:var(--hat-zone-exp, var(--_hat-zone-exp));--analysis-rank-0:var(--hat-d1, var(--_hat-d1));--analysis-rank-1:var(--hat-d2, var(--_hat-d2));--analysis-rank-2:var(--hat-d3, var(--_hat-d3));--analysis-rank-3:var(--hat-d4, var(--_hat-d4));--analysis-rank-4:var(--hat-unmeasured, var(--_hat-unmeasured))}
.energy-analysis-v53 .analysis-group-summary{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px;align-items:start}
.energy-analysis-v53 .analysis-group-summary>div{min-width:0}
.energy-analysis-v53 .analysis-sankey-wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1fr);align-items:center;gap:12px}
.energy-analysis-v53 .analysis-sankey{display:block;width:100%;height:250px;color:var(--hat-text, var(--_hat-text))}
.energy-analysis-v53 [data-analysis-flow-side]>path{stroke:var(--hat-text, var(--_hat-text));stroke-width:.3}
.energy-analysis-v53 .analysis-household{text-align:center;font-weight:600}
.energy-analysis-v53 .analysis-flow-labels{list-style:none;padding:0;margin:0;min-width:0;display:grid;gap:12px}
.energy-analysis-v53 .analysis-flow-labels li{min-width:0;display:flex;align-items:baseline;gap:6px}
.energy-analysis-v53 .analysis-flow-swatch{display:inline-block;flex:none;width:12px;height:12px;margin-inline-end:5px;border:1px solid var(--hat-text, var(--_hat-text));border-radius:2px;vertical-align:baseline}
.energy-analysis-v53 .analysis-composition{display:flex;height:16px;max-width:100%;border:1px solid var(--hat-text, var(--_hat-text));border-radius:4px;overflow:hidden}
.energy-analysis-v53 .analysis-composition>span{height:100%;min-width:0;border-inline-end:1px solid var(--hat-text, var(--_hat-text))}
.energy-analysis-v53 .analysis-hatched{background:repeating-linear-gradient(135deg,transparent,transparent 3px,var(--hat-text, var(--_hat-text)) 3px,var(--hat-text, var(--_hat-text)) 4px)}
.energy-analysis-v53 .analysis-zone-legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px}
.energy-analysis-v53 .analysis-mobile-composition{display:none}
@container energy-analysis (max-width:600px){.energy-analysis-v53 .analysis-group-summary{grid-template-columns:minmax(0,1fr);gap:8px}.energy-analysis-v53 .analysis-sankey{display:none}.energy-analysis-v53 .analysis-sankey-wrap{display:none}.energy-analysis-v53 .analysis-mobile-composition{display:block}.energy-analysis-v53 .analysis-flow-labels{display:flex;flex-wrap:wrap;gap:6px 12px;margin-block:8px}}
@container energy-analysis (max-width:480px){.energy-analysis-v53 [data-analysis-axis-minor]{visibility:hidden}.energy-analysis-v53 .analysis-flow{grid-template-columns:minmax(0,1fr);gap:12px}.energy-analysis-v53 .analysis-flow-source{flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:6px 12px}.energy-analysis-v53 .analysis-period-controls{align-items:flex-start}.energy-analysis-v53 th,.energy-analysis-v53 td{padding:8px 4px}.energy-analysis-v53 .analysis-switch{gap:4px}}
@container energy-analysis (max-width:360px){.energy-analysis-v53 .analysis-controls{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.energy-analysis-v53 .analysis-controls>label:last-child{grid-column:1/-1}.energy-analysis-v53 .analysis-chart{gap:1px}.energy-analysis-v53 .analysis-tile{padding:12px}.energy-analysis-v53 .analysis-ranking li>div:first-child{display:grid;gap:2px}.energy-analysis-v53 .analysis-tile strong{font-size:1.2em}}
/* Mobile keeps two primary readings and a compact secondary pair. No values are hidden. */
@container energy-analysis (max-width:480px){.energy-analysis-v53 .analysis-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.energy-analysis-v53 .analysis-tile-secondary{padding:6px 10px;border:0;border-radius:0;background:transparent}.energy-analysis-v53 .analysis-tile-secondary strong{font-size:14px;margin-top:2px}.energy-analysis-v53 .analysis-tile-secondary span{font-size:12px}}

.energy-analysis-v53 :is(button,select,input){font:14px/20px var(--hat-font, var(--_hat-font))}
.energy-analysis-v53 :is(label,.analysis-period,.analysis-rate76-meta,.analysis-zone-legend,.analysis-point-label){font-size:12px;line-height:16px}
`;
  return {markup,styles};
}
if (typeof module !== 'undefined') module.exports = {createEnergyAnalysisViewV53};

// END SMART CALENDAR ha-tools-energy-analysis-view.js
// BEGIN SMART CALENDAR ha-smart-reports-analysis-host.js
// Smart owns only the selected HA Energy calendar snapshot. No Recorder fallback.
function createSmartAnalysisHostV53({card}) {
 let root=null,started=false,ticket=0,section='overview',identity=null,calendarOpen=false;
 let selection={period:'day',comparison:'previous'},options={level:'areas',view:'chart',selected:null};
 const context=()=>[card._hass?.connection,card._hass?.user?.id,card._hass?.user?.is_active,card._hass?.user?.is_admin,card._hass?.connected,card._hass?.config?.time_zone,card._hass?.connection?.connected];
 const same=(a,b)=>a&&b&&a.every((v,i)=>v===b[i]);
 const active=()=>card.isConnected&&root?.isConnected&&card._analysisMode==='calendar'&&card._activeTab==='energy';
 const text=(en,pl)=>String(card._hass?.locale?.language||card._hass?.language||'en').startsWith('pl')?pl:en;
 const controller=createEnergyAnalysisV53({card,onChange:()=>paint()});
 const binding=createEnergyAnalysisBindingV53({card,controller,onInvalidate:()=>{started=false;ticket++;root?.replaceChildren();if(active())void read();}});
 function observe(){const next=context(),changed=!same(identity,next);if(changed){calendarOpen=false;started=false;ticket++;root?.replaceChildren();binding.stop();identity=next;}binding.observe();return changed;}
 function paint(){
  if(!active())return;
  const state=binding.observe(),view=createEnergyAnalysisViewV53({card});
  const calendar=root.querySelector('[data-analysis-calendar-options]');if(calendar)calendarOpen=calendar.open;
  const focused=root.getRootNode().activeElement,saved=root.contains(focused)?{action:focused.dataset.analysisAction,value:focused.dataset.analysisValue,draft:focused.matches('input')?focused.value:null}:null;
  root.innerHTML=`<style>${view.styles()}</style>`;
  const nav=root.ownerDocument.createElement('nav');nav.setAttribute('aria-label',text('Calendar report views','Widoki raportu kalendarzowego'));
  for(const [key,en,pl]of [['overview','Summary','Podsumowanie'],['comparison','Comparison','Porównanie'],['rates','Rates and costs','Stawki i koszty']]){const b=root.ownerDocument.createElement('button');b.type='button';b.className='action';b.dataset.analysisAction='section';b.dataset.analysisValue=key;b.setAttribute('aria-pressed',String(section===key));b.textContent=text(en,pl);nav.append(b);}root.append(nav);
  const body=root.ownerDocument.createElement('div');
  if(state.status==='ready')body.innerHTML=view.markup(state.snapshot,{...selection,...options,section});
  else{const p=root.ownerDocument.createElement('p');p.setAttribute('role','status');p.textContent=state.status==='error'?(state.error==='unknown_command'?text('Install or update HA Tools Email to use calendar analysis. Your standalone reports remain available.','Zainstaluj lub zaktualizuj HA Tools Email, aby korzystać z analizy kalendarzowej. Samodzielne raporty pozostają dostępne.'):text('Calendar analysis unavailable. Access or the server response could not be confirmed.','Analiza kalendarzowa niedostępna. Nie potwierdzono dostępu lub odpowiedzi serwera.')):text('Loading calendar analysis…','Ładowanie analizy kalendarzowej…');body.append(p);}root.append(body);
  const retry=root.ownerDocument.createElement('button');retry.type='button';retry.className='action';retry.dataset.analysisAction='retry';retry.textContent=text('Retry','Ponów');root.append(retry);
  const nextCalendar=root.querySelector('[data-analysis-calendar-options]');if(nextCalendar)nextCalendar.open=calendarOpen;
  if(saved){const next=[...root.querySelectorAll('[data-analysis-action]')].find(e=>e.dataset.analysisAction===saved.action&&e.dataset.analysisValue===saved.value);if(next){if(saved.draft!==null&&next.matches('input'))next.value=saved.draft;next.focus({preventScroll:true});}}
 }
 async function read(){if(!active())return;const token=++ticket;started=true;await binding.read(selection);if(token===ticket&&active())paint();}
 function action(event){
  const el=event.target.closest('[data-analysis-action]');if(!el||!root?.contains(el))return;
  if(event.type==='click'&&el.matches('select,input')||event.type==='change'&&!el.matches('select,input'))return;
  const key=el.dataset.analysisAction,value=el.matches('select,input')?el.value:el.dataset.analysisValue;
  if(key==='retry'){binding.invalidate();started=false;void read();return;}
  if(key==='section'&&['overview','comparison','rates'].includes(value))section=value;
  else if(key==='period'&&['day','week','month','year'].includes(value)){selection.period=value;if(value!=='day'&&['same_weekday','mean7'].includes(selection.comparison))selection.comparison='previous';}
  else if(key==='anchor'){if(value)selection.anchor=value;else delete selection.anchor;}
  else if(key==='comparison')selection.comparison=value;
  else if(key==='level'&&['areas','floors','devices'].includes(value))options.level=value;
  else if(key==='view'&&['chart','data'].includes(value))options.view=value;
  else if(key==='point')options.selected=value;
  else return;
  if(['period','anchor','comparison'].includes(key)){options.selected=null;void read();}else paint();
 }
 function mount(next){observe();if(!next?.isConnected){stop();return;}if(root!==next){if(root){root.removeEventListener('click',action);root.removeEventListener('change',action);}root=next;root.addEventListener('click',action);root.addEventListener('change',action);}paint();if(!started)void read();}
 function refresh(){observe();if(!active())return;const focused=root.getRootNode().activeElement;if(root.contains(focused)&&focused.matches('input,select'))return;void read();}
 function stop(){calendarOpen=false;started=false;ticket++;if(root){root.removeEventListener('click',action);root.removeEventListener('change',action);root.replaceChildren();root=null;}binding.stop();identity=null;}
 return {mount,stop,observe,refresh,state:binding.observe};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createSmartAnalysisHostV53};

// END SMART CALENDAR ha-smart-reports-analysis-host.js

  class HASmartReports extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._hass = null;
      this._config = {
        energy_cost_mode: 'auto',
        title: 'Smart Reports',
        show_energy: true,
        show_automations: true,
        show_system: true,
        energy_source_mode: 'dashboard',
        energy_total_statistics: [],
        energy_device_statistics: [],
        energy_cost_statistics: [],
        energy_entity: null,
        energy_price: null,
        currency: null,
      };
      this._activeTab = 'energy';
      this._energyView = 'summary';
      this._analysisMode = 'recorded';
      this._deviceQuery = '';
      this._period = '7d';
      this._connected = false;
      this._scaffoldRendered = false;
      this._refreshTimer = null;
      this._refreshThrottleMs = 10000;
      this._lastRefreshStartedAt = 0;
      this._energyRequestGeneration = 0;
      this._energyViewState = { status: 'idle' };
      this._now = () => new Date();
    }

    connectedCallback() {
      this._connected = true;
      this._bindReviewedExportEvents();
      this._observeReviewedExportSource();
      this._tariffGuard?.resume();
      this._tariffGuard?.observe();
      this._renderScaffold();
      this._syncTheme();
      this._syncTabs();
      if (this._hass) this._scheduleRefresh(true);
    }

    disconnectedCallback() {
      this._connected = false;
      this._calendarHost?.stop();
      this._navigationObserver?.disconnect(); this._navigationObserver = null;
      this._pendingReportFocus = null;
      this._exportDialog?.destroy(); this._exportDialog = null;
      this._unbindReviewedExportEvents();
      this._observeReviewedExportSource();
      this._tariffGuard?.suspend();
      this._tariffGuard?.observe();
      if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
      this._invalidateEnergyRequest();
    }

    set hass(hass) {
      // Capture scalar values: HA can mutate the same user/config/hass object.
      const measurementBinding = { present: !!hass, connection: hass?.connection ?? null,
        user: hass?.user?.id ?? null, zone: hass?.config?.time_zone ?? null };
      const previousBinding = this._measurementBinding;
      const measurementsChanged = !!previousBinding && Object.keys(measurementBinding).some(key => previousBinding[key] !== measurementBinding[key]);
      this._measurementBinding = measurementBinding;
      if (measurementsChanged) this._clearMeasuredEnergySource(true);
      const language = languageOf(hass);
      const languageChanged = language !== this._language;
      this._language = language;
      this._hass = hass;
      const calendarChanged=this._calendarHost?.observe();
      if(this._analysisMode==='calendar'&&this._connected&&this._activeTab==='energy'&&(calendarChanged||languageChanged))this._renderEnergyState();
      if (this._connected) this._bindReviewedExportEvents();
      this._observeReviewedExportSource();
      if (languageChanged) this._exportDialog?.cancel();
      if (this._config.energy_cost_mode === 'configured_tariff') this._tariffController().reset();
      else this._tariffGuard?.observe();
      this._syncTheme();
      this._syncSupport();
      if (languageChanged && this._scaffoldRendered) {
        this._syncLabels();
        this._syncTabs();
      }
      if (this._connected && hass) this._scheduleRefresh(false);
    }

    _clearMeasuredEnergySource(allViews = false) {
      this._energyReportConfig = null;
      this._tariffPricingContext = null;
      this._deviceQuery = '';
      this._costSelectedDay = null;
      this._costDataPage = 0;
      this._costChartPage = 0;
      this._comparisonSelectedDay = null;
      this._comparisonDataPage = 0;
      this._comparisonChartPage = 0;
      this._tariffSettingsSection?.replaceChildren();
      this._tariffSettingsSection = null;
      this._energyViewState = { status: 'idle' };
      // Clear accepted source DOM before a throttled/new-session read starts.
      // Request/export association and any occupied tariff wire keep their fences.
      if (this._scaffoldRendered && (allViews || this._activeTab === 'energy')) this.shadowRoot.getElementById('content')?.replaceChildren();
    }

    get hass() {
      return this._hass;
    }

    setConfig(config) {
      this._calendarHost?.stop();
      this._analysisMode='recorded';
      this._deviceQuery = '';
      const next = config && typeof config === 'object' ? config : {};
      const hasRate = Object.prototype.hasOwnProperty.call(next, 'energy_price');
      const currency = typeof next.currency === 'string' && next.currency.trim() ? next.currency.trim() : null;
      this._config = {
        ...next,
        energy_cost_mode: ['cost_statistics','flat_rate_estimate','configured_tariff'].includes(next.energy_cost_mode) ? next.energy_cost_mode : 'auto',
        title: typeof next.title === 'string' && next.title.trim() ? next.title.trim() : 'Smart Reports',
        show_energy: next.show_energy !== false,
        show_automations: next.show_automations !== false,
        show_system: next.show_system !== false,
        show_support: next.show_support !== false,
        energy_source_mode: next.energy_source_mode === 'explicit' ? 'explicit' : 'dashboard',
        energy_total_statistics: Array.isArray(next.energy_total_statistics) ? next.energy_total_statistics : [],
        energy_device_statistics: Array.isArray(next.energy_device_statistics) ? next.energy_device_statistics : [],
        energy_cost_statistics: Array.isArray(next.energy_cost_statistics) ? next.energy_cost_statistics : [],
        energy_entity: typeof next.energy_entity === 'string' && next.energy_entity.trim() ? next.energy_entity.trim() : null,
        energy_price: hasRate && typeof next.energy_price === 'number' && Number.isFinite(next.energy_price) && next.energy_price >= 0
          ? next.energy_price
          : null,
        currency,
        compare_previous_period: next.compare_previous_period === true,
      };
      this._observeReviewedExportSource();
      this._tariffGuard?.observe();
      if (this._scaffoldRendered) {
        this._syncSupport();
        this._invalidateEnergyRequest();
        this._syncTabs();
        this._scheduleRefresh(true);
      }
    }

    getCardSize() { return 5; }

    getGridOptions() { return { columns: 12, min_rows: 3, min_columns: 6 }; }

    static getStubConfig() { return { title: 'Smart Reports', energy_source_mode: 'dashboard' }; }

    static getConfigElement() { return document.createElement('ha-smart-reports-editor'); }

    _renderScaffold() {
      if (this._scaffoldRendered) return;
      this.shadowRoot.innerHTML = `
        <style>
          ${createUiV3({ language: languageOf(this._hass) }).css}
          :host{--sr-primary:var(--primary-color,#3b82f6);--sr-card:var(--card-background-color,var(--ha-card-background,#fff));--sr-text:var(--primary-text-color,#172033);--sr-muted:var(--secondary-text-color,#667085);--sr-border:var(--divider-color,#d9e0ea);--sr-good:#15803d;--sr-warn:#b45309;--sr-bad:#b42318;display:block;color:var(--sr-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}.card{background:var(--sr-card);border:1px solid var(--sr-border);border-radius:16px;overflow:hidden}.header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 12px}h2,h3,p{margin:0}h2{font-size:20px}h3{font-size:15px}.tabs{display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--sr-border);overflow-x:auto}button,select{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}.tab{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--sr-muted);padding:10px 12px}.tab.active{color:var(--sr-primary);border-bottom-color:var(--sr-primary);font-weight:650}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px 0}.toolbar-actions{display:flex;flex-wrap:wrap;gap:8px}.control,.action{min-height:44px;min-width:44px;max-width:100%;border:1px solid var(--sr-border);border-radius:9px;background:var(--sr-card);color:var(--sr-text);padding:8px 11px}.action.primary{background:var(--hat-primary-fill-computed,var(--_hat-primary-fill));border-color:var(--hat-primary-fill-computed,var(--_hat-primary-fill));color:var(--hat-on-primary-computed,var(--_hat-on-primary))}.action:disabled{cursor:not-allowed;opacity:.45}.pane{padding:20px;min-height:220px}.state{display:grid;gap:12px;place-items:start;padding:22px;border:1px solid var(--sr-border);border-radius:12px}.state[role="status"]{border-left:4px solid var(--sr-primary)}.state.partial{border-left-color:var(--sr-warn)}.state.error{border-left-color:var(--sr-bad)}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.metric{border:1px solid var(--sr-border);border-radius:12px;padding:14px}.metric-label,.muted{color:var(--sr-muted);font-size:14px}.metric-value{margin-top:5px;font-size:23px;font-weight:720}.section{margin-top:18px}.list{display:grid;gap:8px;margin-top:10px}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;border-bottom:1px solid var(--sr-border);padding:9px 2px}.row.child{padding-left:24px}.row-name{overflow-wrap:anywhere}.status-ready{color:var(--sr-good)}.warning{color:var(--sr-warn)}.fixed-link{color:var(--sr-primary)}.donate-section{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;border-top:1px solid var(--sr-border);padding:13px 18px;color:var(--sr-muted);font-size:12px}.donate-section a{color:var(--sr-primary);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}[hidden]{display:none!important}@media(max-width:520px){.header,.toolbar{align-items:stretch;flex-direction:column}.toolbar-actions{width:100%}.action{flex:1}}
          :host{container-type:inline-size;container-name:smart-report}.report-body{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;min-width:0;margin-top:18px}.report-body>.section{margin-top:0}.device-breakdown{min-width:0}.device-breakdown>.muted{margin-top:10px}@container smart-report (min-width:760px){.report-body{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}}
          .report-views{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.report-views [aria-selected="true"]{border-color:var(--sr-primary);color:var(--sr-primary);font-weight:650}.bar-chart{display:grid;gap:12px}.chart-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px}.chart-row.child{margin-left:20px}.bar-track{grid-column:1/-1;height:9px;background:var(--sr-border);border-radius:5px;overflow:hidden}.bar-fill{background:var(--sr-primary);height:100%;border-radius:4px}.chart-row small{grid-column:1/-1}.daily-history{display:grid;gap:12px;min-width:0;margin-top:14px}.daily-history h3,.daily-history p{overflow-wrap:anywhere}.daily-list{display:grid;gap:8px}.daily-day{display:grid;gap:6px;width:100%;text-align:left;line-height:1.4}.daily-day[aria-pressed="true"]{border-color:var(--sr-primary);box-shadow:inset 3px 0 var(--sr-primary)}.daily-label{font-size:12px;color:var(--sr-muted)}.daily-value{font-size:16px;font-variant-numeric:tabular-nums}.daily-coverage{font-size:12px;color:var(--sr-muted)}.daily-track{display:block;height:9px;background:var(--sr-border);border-radius:4px;overflow:hidden}.daily-track .bar-fill{display:block;min-width:0}.daily-day[data-availability="partial"] .bar-fill{background:repeating-linear-gradient(135deg,var(--sr-primary) 0 4px,var(--sr-border) 4px 7px)}.daily-day[data-availability="no_data"] .daily-track{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--sr-border) 4px 7px)}.daily-detail{border:1px solid var(--sr-border);border-left:3px solid var(--sr-primary);border-radius:10px;padding:12px;display:grid;gap:8px;overflow-wrap:anywhere;line-height:1.5}.daily-detail h4{margin:0}.daily-detail p{font-size:14px}.cost-source{font-size:14px;line-height:1.6;margin-top:8px;overflow-wrap:anywhere}.report-context{margin-bottom:0;line-height:1.6;font-size:14px;overflow-wrap:anywhere}.report-context-details{margin-bottom:14px}.report-context-details summary{font-size:14px}.report-context-details p{font-size:12px;line-height:1.6;overflow-wrap:anywhere}summary{cursor:pointer;overflow-wrap:anywhere;min-height:44px;display:flex;align-items:center;padding:8px 0}.daily-history:focus-visible,summary:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}
          .tariff-evidence{display:grid;gap:12px;min-width:0}.tariff-evidence p,.tariff-evidence h4{overflow-wrap:anywhere}.tariff-day-chart{display:grid;gap:8px;margin-top:12px}.tariff-day-chart h4{margin:0;font-size:14px}.tariff-day{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;min-height:64px;min-width:44px;max-width:100%;padding:10px 12px;border:1px solid var(--sr-border);border-radius:10px;background:var(--sr-card);color:var(--sr-text);text-align:left;font:inherit}.tariff-day[aria-pressed=true]{border-color:var(--sr-primary);outline:1px solid var(--sr-primary)}.tariff-day strong{overflow-wrap:anywhere}.tariff-day small{grid-column:1/-1;color:var(--sr-muted);font-size:12px}.tariff-day-track{grid-column:1/-1;position:relative;height:8px;background:var(--sr-border);border-radius:4px;overflow:hidden}.tariff-day-track.signed{background:linear-gradient(to right,var(--sr-border) calc(50% - 1px),var(--sr-text) 50%,var(--sr-border) calc(50% + 1px))}.tariff-day-fill{position:absolute;top:0;height:100%;background:var(--sr-primary);border-radius:3px}.tariff-day[data-availability=partial] .tariff-day-fill{background:repeating-linear-gradient(135deg,var(--sr-primary) 0 4px,var(--sr-border) 4px 7px)}.tariff-day[data-availability=gap] .tariff-day-track{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--sr-border) 4px 7px)}.tariff-pagination{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.tariff-pagination span{flex:1;min-width:0}.tariff-evidence button{min-height:44px;min-width:44px;white-space:normal;overflow-wrap:anywhere}.tariff-data-row{border:1px solid var(--sr-border);border-radius:10px;padding:12px;margin-top:8px;min-width:0;overflow-wrap:anywhere}.tariff-data-row h4{font-size:14px;margin:0 0 8px}.tariff-data-row dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:6px 12px;margin:0;font-size:14px}.tariff-data-row dt{color:var(--sr-muted)}.tariff-data-row dd{margin:0}.tariff-day:focus-visible{outline:3px solid var(--sr-primary);outline-offset:2px}
          .device-report-details>summary:before{content:'▸';margin-right:8px}.device-report-details[open]>summary:before{content:'▾'}.device-total-note{border:1px solid var(--sr-border);border-radius:10px;padding:10px;overflow-wrap:anywhere}
          .device-search-form{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:14px 0}.device-search-form label{flex:1;min-width:min(100%,180px);display:grid;gap:6px;font-size:14px}.device-search{width:100%;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--sr-border);border-radius:9px;background:var(--sr-card);color:var(--sr-text);font:inherit}.device-search-clear{min-height:44px;min-width:44px}.device-search:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}.device-search-count,.device-export-note{overflow-wrap:anywhere;line-height:1.5}.chart-row small{overflow-wrap:anywhere}
          button,select,input:not([type="checkbox"]),summary,.fixed-link,.donate-section a{min-height:44px!important;min-width:44px;max-width:100%;box-sizing:border-box}
          button,select{font:inherit;white-space:normal;overflow-wrap:anywhere}summary,.fixed-link,.donate-section a{display:flex;align-items:center}
          button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid var(--sr-primary)!important;outline-offset:2px}
          .tabs{flex-wrap:wrap;overflow:visible}.tab{flex:1 1 auto}.header{flex-wrap:wrap}.header h2{overflow-wrap:anywhere;min-width:0}
          .report-picker{display:block;width:100%;min-width:0;padding:10px;border:1px solid var(--sr-border);border-radius:8px;background:var(--sr-card);color:var(--sr-text);margin:0 0 12px}
          .report-picker[data-report-picker="main"]{width:calc(100% - 32px);margin:0 16px 12px}[hidden]{display:none!important}
          :host(.bento-dark){--sr-good:#4ade80;--sr-warn:#fbbf24;--sr-bad:#f87171}
        </style>
        <ha-card class="card">
          <div class="header"><h2 id="title"></h2><span class="muted" id="recorderLabel">${this._t("Recorder-backed")}</span></div>
          <nav class="tabs" id="tabs" data-report-nav="main" role="tablist" aria-label="${this._t("Report sections")}">
            <button class="tab" type="button" data-tab="energy">${this._t("Energy")}</button>
            <button class="tab" type="button" data-tab="automations">${this._t("Automations")}</button>
            <button class="tab" type="button" data-tab="system">${this._t("System")}</button>
          </nav>
          <div class="toolbar" id="energyToolbar">
            <label><span id="periodLabel">${this._t("Period")}</span> <select class="control" id="periodSelect" aria-label="${this._t("Energy report period")}"><option value="1d">${this._t("Today")}</option><option value="7d">${this._t("7 days")}</option><option value="30d">${this._t("30 days")}</option></select></label>
            <div class="toolbar-actions"><button class="action" type="button" id="exportCsvBtn" disabled>${this._t("Export CSV")}</button><button class="action primary" type="button" id="exportJsonBtn" disabled>${this._t("Export JSON")}</button></div>
          </div>
          <main class="pane" id="content"></main>
          <footer class="donate-section" data-source="own-card" style="margin:8px 0 0;padding:4px 0;background:none;border:0;box-shadow:none;min-height:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex-direction:row;justify-content:flex-start;text-align:left"><a href="https://buymeacoffee.com/macsiem" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:var(--secondary-text-color,#64748b);font-weight:400;text-decoration:underline">${this._t("Optional support for HA Tools")}</a><button type="button" class="support-dismiss" aria-label="${this._t("Dismiss support link")}" style="margin-left:auto;padding:2px 6px;min-height:0;line-height:1;border:0;background:none;color:var(--secondary-text-color,#64748b);cursor:pointer">×</button></footer>
        </ha-card>`;
      this._scaffoldRendered = true;
      this.shadowRoot.querySelector('.support-dismiss').addEventListener('click', () => {
        try { localStorage.setItem('ha-smart-reports-support-dismissed', '1'); } catch (_) {}
        this._syncSupport();
      });
      this._syncSupport();
      this.shadowRoot.getElementById('periodSelect').value = this._period;
      this.shadowRoot.getElementById('periodSelect').addEventListener('change', (event) => {
        const period = VALID_PERIODS.has(event.target.value) ? event.target.value : '7d';
        if (period === this._period) return;
        this._period = period;
        this._tariffGuard?.observe();
        this._invalidateEnergyRequest();
        this._scheduleRefresh(true);
      });
      for (const button of this.shadowRoot.querySelectorAll('[data-tab]')) button.addEventListener('click', () => this._selectTab(button.dataset.tab));
      this.shadowRoot.getElementById('exportJsonBtn').addEventListener('click', () => this._downloadExport('json'));
      this.shadowRoot.getElementById('exportCsvBtn').addEventListener('click', () => this._downloadExport('csv'));
    }

    _t(text) { return translate(this._hass, text); }

    _warningText(text) {
      const prefix = 'included_in_stat is only valid for device sources: ';
      return typeof text === 'string' && text.startsWith(prefix)
        ? this._t(prefix) + text.slice(prefix.length) : this._t(text);
    }

    _syncLabels() {
      const root = this.shadowRoot;
      root.getElementById('recorderLabel').textContent = this._t('Recorder-backed');
      root.getElementById('tabs').setAttribute('aria-label', this._t('Report sections'));
      for (const button of root.querySelectorAll('[data-tab]')) {
        button.textContent = this._t({ energy: 'Energy', automations: 'Automations', system: 'System' }[button.dataset.tab]);
      }
      root.getElementById('periodLabel').textContent = this._t('Period');
      const select = root.getElementById('periodSelect');
      select.setAttribute('aria-label', this._t('Energy report period'));
      for (const option of select.options) option.textContent = this._t({ '1d': 'Today', '7d': '7 days', '30d': '30 days' }[option.value]);
      root.getElementById('exportCsvBtn').textContent = this._t('Export CSV');
      root.getElementById('exportJsonBtn').textContent = this._t('Export JSON');
      root.querySelector('.donate-section a').textContent = this._t('Optional support for HA Tools');
      root.querySelector('.support-dismiss').setAttribute('aria-label', this._t('Dismiss support link'));
    }

    _syncTheme() {
      let dark = Boolean(this._hass && this._hass.themes && this._hass.themes.darkMode);
      const surface = this.shadowRoot.querySelector('.card');
      if (this.isConnected && surface) {
        // HA custom themes can be dark while themes.darkMode remains false.
        // Reading the rendered surface also resolves aliases and CSS color syntax.
        const background = getComputedStyle(surface).backgroundColor;
        const rgb = background.match(/^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/);
        if (rgb && (rgb[4] === undefined || Number(rgb[4]) === 1)) {
          const brightness = (0.2126 * Number(rgb[1]) + 0.7152 * Number(rgb[2]) + 0.0722 * Number(rgb[3])) / 255;
          dark = brightness < 0.5;
        }
      }
      this.classList.toggle('bento-dark', dark);
      createUiV3({ language: languageOf(this._hass) }).applyTheme(this);
      this.shadowRoot.querySelector('[data-ha-tools-export]')?.classList.toggle('bento-dark',dark);
    }

    _syncSupport() {
      if (!this._scaffoldRendered) return;
      let dismissed = false;
      try { dismissed = localStorage.getItem('ha-smart-reports-support-dismissed') === '1'; } catch (_) {}
      this.shadowRoot.querySelector('.donate-section[data-source="own-card"]').hidden = !this._hass?.user?.is_admin || this._config.show_support === false || dismissed;
    }

    _availableTabs() {
      const result = [];
      if (this._config.show_energy) result.push('energy');
      if (this._config.show_automations) result.push('automations');
      if (this._config.show_system) result.push('system');
      return result;
    }

    _syncNavigation() {
      if (!this._scaffoldRendered) return;
      if (!this._navigationObserver && typeof ResizeObserver === 'function' && this._connected) {
        this._navigationObserver = new ResizeObserver(() => this._syncNavigation());
        this._navigationObserver.observe(this);
      }
      const width = this.getBoundingClientRect().width;
      const compact = width > 0 && width < 280;
      for (const group of this.shadowRoot.querySelectorAll('[data-report-nav]')) {
        const key = group.dataset.reportNav;
        const buttons = Array.from(group.querySelectorAll('button')).filter(button => !button.hidden);
        let picker = group.previousElementSibling;
        if (picker?.dataset.reportPicker !== key) {
          picker = document.createElement('select'); picker.className = 'report-picker'; picker.dataset.reportPicker = key;
          group.before(picker);
          picker.addEventListener('change', () => {
            const chosen = Array.from(group.querySelectorAll('button')).filter(button => !button.hidden)[Number(picker.selectedIndex)];
            chosen?.click();
            const current = this.shadowRoot.querySelector(`[data-report-picker="${key}"]`);
            if (current && !current.hidden) current.focus({ preventScroll: true });
          });
        }
        picker.setAttribute('aria-label', group.getAttribute('aria-label') || this._t('Report sections'));
        const choices = buttons.map(button => ({value:button.dataset.tab || button.dataset.energyView || button.dataset.costView || button.dataset.comparisonView || button.dataset.dailyView,label:button.textContent}));
        const signature = JSON.stringify(choices);
        if (picker.dataset.choices !== signature) {
          picker.replaceChildren(...choices.map(choice => { const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; return option; }));
          picker.dataset.choices = signature;
        }
        const selected = buttons.find(button => button.getAttribute('aria-selected') === 'true') || buttons[0];
        picker.selectedIndex = buttons.indexOf(selected);
        const active = this.shadowRoot.activeElement;
        const inGroup = group.contains(active);
        // Reveal the destination before moving focus; hide the old representation last.
        if (compact && buttons.length) {
          picker.hidden = false;
          if (inGroup) picker.focus({ preventScroll: true });
          group.hidden = true;
        } else {
          group.hidden = buttons.length === 0;
          if (active === picker || (inGroup && active.hidden)) selected?.focus({ preventScroll: true });
          picker.hidden = true;
        }
      }
    }

    _focusReportControl(target) {
      if (!target || target.disabled) return null;
      const group = target.closest('[data-report-nav]');
      if (group?.hidden) target = this.shadowRoot.querySelector(`[data-report-picker="${group.dataset.reportNav}"]`);
      if (!target || target.closest('[hidden]')) return null;
      target.focus({ preventScroll: true });
      return target;
    }

    _rememberReportFocus(target) {
      if (!target || !this.shadowRoot.getElementById('content')?.contains(target)) return null;
      if (target.classList.contains('device-search')) return {search:true,start:target.selectionStart,end:target.selectionEnd,direction:target.selectionDirection};
      const names = ['data-daily-view','data-daily-day','data-daily-page','data-daily-clear','data-report-picker','data-report-control','data-energy-view','data-cost-view','data-cost-day','data-cost-metric','data-cost-page','data-cost-chart-page','data-cost-clear-day','data-comparison-view','data-comparison-day','data-comparison-metric','data-side','data-comparison-data-page','data-comparison-chart-page','data-comparison-clear','data-compare-previous-period'];
      const attributes = names.filter(name => target.hasAttribute(name)).map(name => [name,target.getAttribute(name)]);
      return attributes.length ? {tag:target.localName,attributes} : null;
    }

    _restoreReportFocus(snapshot, status) {
      const root = this.shadowRoot;
      let target = snapshot.search ? root.querySelector('.device-search') : Array.from(root.querySelectorAll(snapshot.tag)).find(node => snapshot.attributes.every(([name,value]) => node.getAttribute(name) === value));
      if (target?.disabled) target = null;
      if (target?.matches('[data-report-picker]') && target.hidden) {
        target = root.querySelector(`[data-report-nav="${target.dataset.reportPicker}"] [aria-selected="true"]`);
      }
      const restored = this._focusReportControl(target);
      if (restored) {
        if (snapshot.search && snapshot.start != null) restored.setSelectionRange(snapshot.start,snapshot.end,snapshot.direction);
        return;
      }
      const fallback = this._focusReportControl(root.querySelector('[data-energy-view][aria-selected="true"]')) || this._focusReportControl(root.getElementById('periodSelect'));
      // Keep only control identity through loading. A user focus move cancels restoration.
      if (status === 'loading' && fallback) this._pendingReportFocus = {snapshot,anchor:fallback};
    }

    _syncTabs() {
      if (!this._scaffoldRendered) return;
      const available = this._availableTabs();
      if (!available.includes(this._activeTab)) this._activeTab = available[0] || null;
      this.shadowRoot.getElementById('title').textContent = this._config.title;
      this.shadowRoot.getElementById('tabs').hidden = available.length === 0;
      for (const button of this.shadowRoot.querySelectorAll('[data-tab]')) {
        const tab = button.dataset.tab;
        button.hidden = !available.includes(tab);
        button.setAttribute('role', 'tab');
        button.classList.toggle('active', tab === this._activeTab);
        button.setAttribute('aria-selected', String(tab === this._activeTab));
      }
      this.shadowRoot.getElementById('energyToolbar').hidden = this._activeTab !== 'energy' || this._analysisMode === 'calendar';
      if (this._activeTab === null) {
        const container = this.shadowRoot.getElementById('content');
        container.replaceChildren(this._stateBlock('Enable at least one report section.', 'Turn on Energy, Automations, or System in the card configuration.', '', 'status'));
      } else if (this._activeTab === 'energy') this._renderEnergyState();
      else if (this._activeTab === 'automations') this._renderAutomations();
      else this._renderSystem();
      this._syncNavigation();
    }

    _selectTab(tab) {
      if (!this._availableTabs().includes(tab) || tab === this._activeTab) return;
      if (this._activeTab === 'energy') { this._invalidateEnergyRequest(); this._calendarHost?.stop(); }
      this._activeTab = tab;
      this._tariffGuard?.observe();
      this._syncTabs();
      this._scheduleRefresh(true);
    }

    _scheduleRefresh(immediate) {
      if (!this._connected || !this._hass) return;
      if (immediate && this._refreshTimer !== null) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (this._refreshTimer !== null) return;
      const elapsed = Date.now() - this._lastRefreshStartedAt;
      const delay = immediate ? 0 : Math.max(0, this._refreshThrottleMs - elapsed);
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this._runRefresh();
      }, delay);
    }

    async _runRefresh() {
      if (!this._connected || !this._hass) return;
      this._lastRefreshStartedAt = Date.now();
      try {
        if (this._activeTab === null) return;
        if (this._activeTab === 'energy') { if(this._analysisMode==='calendar')this._calendarHost?.refresh();else await this._loadEnergy(); }
        else if (this._activeTab === 'automations') this._renderAutomations();
        else this._renderSystem();
      } catch (error) {
        if (this._activeTab === 'energy' && this._connected) this._setEnergyViewState(this._errorState(error, this._periodDescriptor()));
      }
    }

    _errorState(error, period) {
      return {
        status: this._classifyError(error),
        code: error && error.code != null ? String(error.code) : 'unknown_error',
        period,
        source_mode: this._config.energy_source_mode === 'explicit' ? 'explicit' : 'energy_dashboard',
        total: { value: null, unit: 'kWh', source_statistic_ids: [] },
        cost: { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'request_failed' },
        devices: [], total_sources: [], cost_sources: [], warnings: [],
      };
    }

    _invalidateEnergyRequest() { this._energyRequestGeneration += 1; this._invalidateReviewedExport(true); }

    _isCurrentEnergyRequest(generation) { return this._connected && this.isConnected && this._activeTab === 'energy' && this._analysisMode !== 'calendar' && generation === this._energyRequestGeneration; }

    _classifyError(error) {
      const code = error && error.code != null ? String(error.code).toLowerCase() : '';
      const message = error && error.message ? String(error.message).toLowerCase() : '';
      if (code === '401' || code === '403' || code.includes('unauthorized') || message.includes('unauthorized') || message.includes('forbidden')) return 'permission_denied';
      if (code === '404' || code === 'unknown_command' || message.includes('unknown command')) return 'unsupported';
      return 'error';
    }

    _timeZone() {
      const configured = this._hass && this._hass.config && this._hass.config.time_zone;
      if (typeof configured === 'string' && configured) return configured;
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_error) { return 'UTC'; }
    }

    _partsInZone(date, timeZone) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const result = {};
      for (const part of parts) if (part.type !== 'literal') result[part.type] = Number(part.value);
      return result;
    }

    _zonedDateTimeToUtc(parts, timeZone) {
      const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, 0);
      let guess = target;
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const actual = this._partsInZone(new Date(guess), timeZone);
        const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, 0);
        const delta = target - represented;
        guess += delta;
        if (delta === 0) break;
      }
      return new Date(guess);
    }

    _addCalendarDays(parts, days) {
      const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
      return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
    }

    _zonedDayBounds(parts, timeZone) {
      const next = this._addCalendarDays(parts, 1);
      return { start: this._zonedDateTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone), end: this._zonedDateTimeToUtc({ ...next, hour: 0, minute: 0, second: 0 }, timeZone) };
    }

    _calendarWindow(key, nowValue, timeZone) {
      const now = asDate(nowValue) || new Date();
      const safeKey = VALID_PERIODS.has(key) ? key : '7d';
      const local = this._partsInZone(now, timeZone);
      const daysBack = safeKey === '1d' ? 0 : (safeKey === '30d' ? 29 : 6);
      const startDate = this._addCalendarDays(local, -daysBack);
      const start = this._zonedDateTimeToUtc({ ...startDate, hour: 0, minute: 0, second: 0 }, timeZone);
      const end = new Date(Math.max(start.getTime(), Math.floor(now.getTime() / 3600000) * 3600000));
      return { key: safeKey, start, end, time_zone: timeZone };
    }

    _periodDescriptor() {
      const window = this._calendarWindow(this._period, this._now(), this._timeZone());
      return { key: window.key, start: window.start.toISOString(), end: window.end.toISOString(), time_zone: window.time_zone };
    }

    _strictLocalInstant(parts, timeZone) {
      // Reuse the calendar converter, then verify all offsets observed around it.
      // An iterative converter alone can silently choose one side of a DST fold.
      const initial = this._zonedDateTimeToUtc(parts, timeZone).getTime();
      const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const offsets = new Set();
      for (let minutes = -2160; minutes <= 2160; minutes += 30) {
        const stamp = initial + minutes * 60000;
        const local = this._partsInZone(new Date(stamp), timeZone);
        offsets.add(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - stamp);
      }
      const matches = [...offsets].map(offset => target - offset).filter(stamp => {
        const actual = this._partsInZone(new Date(stamp), timeZone);
        return ['year','month','day','hour','minute','second'].every(key => actual[key] === parts[key]);
      });
      return matches.length === 1 ? { value: new Date(matches[0]).toISOString(), reason: null }
        : { value: null, reason: matches.length ? 'ambiguous_local_cutoff' : 'nonexistent_local_cutoff' };
    }

    _comparisonPeriod(period) {
      return { ...period, actual_hours: (Date.parse(period.end) - Date.parse(period.start)) / 3600000,
        local_start: this._partsInZone(new Date(period.start), period.time_zone),
        local_cutoff: this._partsInZone(new Date(period.end), period.time_zone) };
    }

    _previousPeriodDescriptor(period) {
      const days = period.key === '1d' ? 1 : period.key === '30d' ? 30 : 7;
      const shift = parts => ({ ...parts, ...this._addCalendarDays(parts, -days) });
      const first = this._partsInZone(new Date(period.start), period.time_zone);
      const last = this._partsInZone(new Date(period.end), period.time_zone);
      const endpoints = [first, last, shift(first), shift(last)].map(parts => this._strictLocalInstant(parts, period.time_zone));
      const failed = endpoints.find(endpoint => endpoint.reason);
      if (failed) return { period: null, reason: failed.reason, shift_days: days,
        requested_local_start: shift(first), requested_local_cutoff: shift(last) };
      return { period: this._comparisonPeriod({ key: period.key, start: endpoints[2].value, end: endpoints[3].value, time_zone: period.time_zone }), reason: null, shift_days: days };
    }

    _freezeComparison(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) this._freezeComparison(child);
        Object.freeze(value);
      }
      return value;
    }

    _comparisonDelta(current, previous, unit, previousUnit, complete, reason) {
      const finite = value => typeof value === 'number' && Number.isFinite(value);
      const comparable = complete && unit && unit === previousUnit && finite(current) && finite(previous);
      let delta = comparable ? current - previous : null;
      if (!finite(delta)) delta = null;
      let percent = comparable && delta !== null && previous > 0 ? (delta / previous) * 100 : null;
      if (!finite(percent)) percent = null;
      return { current: finite(current) ? current : null, previous: finite(previous) ? previous : null, unit: unit || null,
        delta, percent, comparable: !!comparable && delta !== null,
        reason: !comparable ? reason || (unit !== previousUnit ? 'unit_mismatch' : 'incomplete_coverage') : delta === null ? 'nonfinite_delta' : previous === 0 ? 'previous_zero' : previous < 0 ? 'previous_nonpositive' : percent === null ? 'nonfinite_delta' : null,
        provenance: comparable && delta !== null ? 'complete_comparable_measurements' : 'unavailable' };
    }

    _comparisonSnapshot(state, selection, statistics, metadata, side) {
      const period = this._comparisonPeriod(state.period);
      const energyDays = state.daily || [];
      const costDays = state.cost.method === 'configured_tariff' ? (state.cost.daily || []).map(day => ({
        start: day.from, end: day.to, value: day.energyCost, recorded_value: day.recorded_energy_cost,
        unit: state.cost.currency, status: day.available ? 'ready' : day.status,
        observed_source_hours: day.observed_hours, expected_source_hours: day.expected_hours,
      })) : this._dailyEnergySeries(period, this._config.energy_cost_mode === 'flat_rate_estimate' ? [] : state.cost_sources, statistics, metadata, 'cost', this._hass.config?.currency);
      const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
      const daily = energyDays.map((energy, index) => ({ index, start: energy.start, end: energy.end,
        energy: { ...energy, value: finite(energy.value), recorded_value: finite(energy.recorded_value) },
        cost: costDays.find(day => day.start === energy.start) || { start: energy.start, end: energy.end, value: null, recorded_value: null,
          unit: state.cost.currency, status: 'no_data', observed_source_hours: 0, expected_source_hours: (Date.parse(energy.end)-Date.parse(energy.start))/3600000 },
      }));
      const records = [];
      // Daily charts retain only whole readings contained in one local day.
      // Crossing measurements remain intact in All hours and full exports.
      const dayAllocation = (from, to) => {
        const day_index = daily.findIndex(day => Date.parse(day.start) <= from && Date.parse(day.end) >= to);
        return { day_index, day_allocation_reason: day_index < 0 ? 'crosses_local_midnight' : null };
      };
      const references = state.status === 'error' ? [] : [...selection.totals, ...selection.costs, ...selection.devices];
      const summaries = new Map([...state.total_sources, ...state.cost_sources, ...state.devices].map(source => [`${source.role}:${source.statistic_id}`, source]));
      for (const source of references) {
        const summary = summaries.get(`${source.role}:${source.statistic_id}`);
        const buckets = Array.isArray(statistics[source.statistic_id]) ? statistics[source.statistic_id] : [];
        for (let from = Date.parse(period.start); from < Date.parse(period.end);) {
          const to = Math.min(Date.parse(period.end), (Math.floor(from / 3600000) + 1) * 3600000);
          const samples = buckets.filter(bucket => numericTime(bucket.end) > from && numericTime(bucket.start) < to);
          const measured = this._summarizeSeries(samples, metadata[source.statistic_id], { start: new Date(from), end: new Date(to) }, source.role, this._hass.config?.currency);
          const parts = this._partsInZone(new Date(from), period.time_zone);
          records.push({ side, ...dayAllocation(from, to),
            local_date: `${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`,
            from: new Date(from).toISOString(), to: new Date(to).toISOString(), statistic_id: source.statistic_id, role: source.role,
            source_statistic_ids: [source.statistic_id], label: summary?.label || source.statistic_id,
            value: finite(measured.value), recorded_value: finite(measured.recorded_value), unit: measured.unit,
            status: measured.status, reason: measured.reason || (measured.status !== 'ready' ? 'incomplete_coverage' : null),
            coverage: measured.coverage, provenance: source.provenance, included_in_stat: source.included_in_stat || null });
          from = to;
        }
      }
      if (state.cost.method === 'configured_tariff') for (const record of state.cost.records || []) {
        records.push({ side, role: 'priced_energy', statistic_id: null, ...record,
          ...dayAllocation(Date.parse(record.from), Date.parse(record.to)) });
      }
      // Safe allowlisted export snapshots, never profile, draft, config or tickets.
      const safeCost = { value: finite(state.cost.value), currency: state.cost.currency || null, method: state.cost.method,
        reason: state.cost.reason || null, rate: finite(state.cost.rate), source_statistic_ids: [...(state.cost.source_statistic_ids || [])],
        ...(state.cost.method === 'configured_tariff' ? { records: state.cost.records, daily: (state.cost.daily || []).map(({ records, ...day }) => day),
          coverage: state.cost.coverage, revision: state.cost.revision, provenance: state.cost.provenance,
          price_basis: state.cost.price_basis, tariff_timezone: state.cost.tariff_timezone, tariff_clock: state.cost.tariff_clock,
          measured_energy_cost: state.cost.measured_energy_cost, variable_cost: state.cost.variable_cost, usage_cost: state.cost.usage_cost,
          fixed_monthly: state.cost.fixed_monthly, current_profile_validity: state.cost.current_profile_validity } : {}) };
      return { period, source_mode: state.source_mode, status: state.status,
        total: { ...state.total, value: finite(state.total.value) }, cost: safeCost,
        recorded_total: state.recorded_total, recorded_cost: state.recorded_cost,
        total_sources: state.total_sources.map(source => this._exportSource(source)), cost_sources: state.cost_sources.map(source => this._exportSource(source)),
        devices: state.devices.map(source => this._exportSource(source)), warnings: [...state.warnings], daily, records,
        coverage: { missing_energy_days: daily.filter(day => day.energy.status !== 'ready').length,
          missing_cost_days: daily.filter(day => day.cost.status !== 'ready' || day.cost.value === null).length,
          observed_energy_source_hours: state.total_sources.reduce((sum, source) => sum + (source.coverage?.observed_hours || 0), 0),
          expected_energy_source_hours: state.total_sources.length * period.actual_hours,
          observed_cost_source_hours: state.cost.coverage?.observed_hours ?? state.cost_sources.reduce((sum, source) => sum + (source.coverage?.observed_hours || 0), 0),
          expected_cost_source_hours: state.cost.coverage?.expected_hours ?? state.cost_sources.length * period.actual_hours } };
    }

    _buildPeriodComparison(state, descriptor, selection, statistics, previousStatistics, metadata, snapshot) {
      const current = this._comparisonSnapshot(state, selection, statistics, metadata, 'current');
      const previousState = descriptor.period ? (descriptor.readStatus === 'error' ? this._errorState({ code: 'read_failed' }, descriptor.period) : this._materializeEnergyPeriod(descriptor.period, selection, previousStatistics || {}, metadata, snapshot, true)) : null;
      const previous = previousState ? this._comparisonSnapshot(previousState, selection, previousStatistics || {}, metadata, 'previous') : null;
      const scope = [...selection.totals, ...selection.costs, ...selection.devices].map(source => ({ statistic_id: source.statistic_id, role: source.role,
        unit: this._metadataUnit(metadata[source.statistic_id]), provenance: source.provenance, included_in_stat: source.included_in_stat || null,
        energy_statistic_ids: [...(source.energy_statistic_ids || [])], metadata: {
          has_sum: metadata[source.statistic_id]?.has_sum === true,
          unit_class: typeof metadata[source.statistic_id]?.unit_class === 'string' ? metadata[source.statistic_id].unit_class : null,
          name: typeof metadata[source.statistic_id]?.name === 'string' ? metadata[source.statistic_id].name : null,
        } }));
      const sameScope = !!previous && current.source_mode === previous.source_mode && ['total_sources','cost_sources','devices'].every(key =>
        JSON.stringify(current[key].map(source => [source.statistic_id,source.role,source.unit,source.included_in_stat]).sort()) ===
        JSON.stringify(previous[key].map(source => [source.statistic_id,source.role,source.unit,source.included_in_stat]).sort()));
      const energyComplete = sameScope && current.total_sources.every(source => source.status === 'ready') && previous.total_sources.every(source => source.status === 'ready')
        && current.coverage.missing_energy_days === 0 && previous.coverage.missing_energy_days === 0;
      const costComplete = sameScope && current.cost.method === previous.cost.method && ['cost_statistics','configured_tariff'].includes(current.cost.method)
        && current.coverage.missing_energy_days === 0 && previous.coverage.missing_energy_days === 0
        && current.coverage.missing_cost_days === 0 && previous.coverage.missing_cost_days === 0
        && (current.cost.method !== 'configured_tariff' || (current.cost.coverage?.complete && previous.cost.coverage?.complete
          && current.cost.price_basis === previous.cost.price_basis && current.cost.revision === previous.cost.revision
          && current.cost.tariff_timezone === previous.cost.tariff_timezone && JSON.stringify(current.cost.tariff_clock) === JSON.stringify(previous.cost.tariff_clock)));
      // An unavailable amount does not invalidate a currency confirmed by every
      // selected cost source. Keep the legacy cost snapshot itself unchanged.
      const comparisonCurrency = snapshot => {
        if (snapshot?.cost.currency) return snapshot.cost.currency;
        const expected = this._hass.config?.currency;
        return snapshot && snapshot.cost.reason !== 'currency_mismatch' && typeof expected === 'string' && expected
          && snapshot.cost_sources.length > 0 && snapshot.cost_sources.every(source => source.unit === expected && source.reason !== 'incompatible_currency_metadata')
          ? expected : null;
      };
      const currentCurrency = comparisonCurrency(current), previousCurrency = comparisonCurrency(previous);
      const costReason = descriptor.reason || (currentCurrency && previousCurrency && currentCurrency !== previousCurrency ? 'currency_mismatch'
        : previous?.cost.reason || current.cost.reason || 'incomplete_coverage');
      const metrics = {
        energy: this._comparisonDelta(current.total.value, previous?.total.value, current.total.unit, previous?.total.unit, energyComplete, descriptor.reason),
        cost: this._comparisonDelta(current.cost.value, previous?.cost.value, currentCurrency, previousCurrency, costComplete,
          costComplete ? descriptor.reason : costReason),
      };
      return this._freezeComparison({ status: descriptor.reason ? 'noncomparable' : metrics.energy.comparable && metrics.cost.comparable ? 'ready' : 'partial',
        reason: descriptor.reason || null, shift_days: descriptor.shift_days,
        requested_local_start: descriptor.requested_local_start || null, requested_local_cutoff: descriptor.requested_local_cutoff || null,
        scope, current, previous, metrics, daily: current.daily.map((day, index) => ({ index, current: day, previous: previous?.daily[index] || null })),
        records: [...current.records, ...(previous?.records || [])].sort((a,b) => a.day_index - b.day_index
          || a.role.localeCompare(b.role) || String(a.statistic_id || '').localeCompare(String(b.statistic_id || ''))
          || (Date.parse(a.from) - Date.parse(a.side === 'current' ? current.period.start : previous.period.start))
            - (Date.parse(b.from) - Date.parse(b.side === 'current' ? current.period.start : previous.period.start))
          || a.side.localeCompare(b.side)) });
    }

    async _dashboardSources(generation, read = payload => this._hass.callWS(payload)) {
      let prefs;
      try {
        prefs = await read({ type: 'energy/get_prefs' });
      } catch (error) {
        // Core reports an unconfigured Energy Dashboard as not_found / No prefs.
        // This applies only to preference discovery, never Recorder failures.
        if (!error || error.code !== 'not_found') throw error;
        prefs = null;
      }
      if (!this._isCurrentEnergyRequest(generation)) return null;
      const totals = []; const costs = []; const devices = []; const costCoverage = new Map();
      const costParents = new Map();
      const linkCost = (cost, total) => {
        if (!cost) return;
        if (!costParents.has(cost.statistic_id)) costParents.set(cost.statistic_id, new Set());
        costParents.get(cost.statistic_id).add(total.statistic_id);
      };
      const add = (target, value, role) => {
        const normalized = normalizeConfiguredSource(value, role, 'energy_dashboard');
        if (normalized) target.push(normalized);
        return normalized;
      };
      const addGridFlow = (totalValue, costValue) => {
        const total = add(totals, totalValue, 'total');
        if (!total) return;
        const cost = add(costs, costValue, 'cost');
        linkCost(cost, total);
        costCoverage.set(total.statistic_id, Boolean(cost) || costCoverage.get(total.statistic_id) === true);
      };
      const energySources = prefs && Array.isArray(prefs.energy_sources) ? prefs.energy_sources : [];
      for (const source of energySources) {
        if (!source || source.type !== 'grid') continue;
        const hasDirectImport = typeof source.stat_energy_from === 'string' && source.stat_energy_from.trim();
        if (hasDirectImport) addGridFlow(source.stat_energy_from, source.stat_cost);
        else if (Array.isArray(source.flow_from)) for (const flow of source.flow_from) {
          addGridFlow(flow && (flow.stat_energy_from || flow.stat_energy), flow && flow.stat_cost);
        }
      }
      const consumption = prefs && Array.isArray(prefs.device_consumption) ? prefs.device_consumption : [];
      for (const device of consumption) {
        const normalized = normalizeConfiguredSource(device, 'device', 'energy_dashboard');
        if (normalized) devices.push(normalized);
      }
      let uniqueCosts = uniqueById(costs);
      const uniqueTotals = uniqueById(totals);
      if (uniqueTotals.some((total) => costCoverage.get(total.statistic_id) !== true)) {
        try {
          const info = await read({ type: 'energy/info' });
          if (!this._isCurrentEnergyRequest(generation)) return null;
          const mapping = info && info.cost_sensors && typeof info.cost_sensors === 'object' ? info.cost_sensors : {};
          const discovered = [...uniqueCosts];
          for (const total of uniqueTotals) {
            if (costCoverage.get(total.statistic_id) === true) continue;
            const exact = mapping[total.statistic_id];
            const mapped = add(discovered, exact && (exact.statistic_id || exact.entity_id || exact), 'cost');
            linkCost(mapped, total);
            costCoverage.set(total.statistic_id, Boolean(mapped));
          }
          uniqueCosts = uniqueById(discovered);
        } catch (error) {
          if (!this._isCurrentEnergyRequest(generation)) return null;
          if (this._classifyError(error) === 'permission_denied') throw error;
        }
      }
      const uniqueDevices = uniqueById(devices);
      const hasAnyMappedCost = [...costCoverage.values()].some(Boolean);
      const costConfigurationIncomplete = hasAnyMappedCost && [...costCoverage.values()].some((covered) => !covered);
      const linkedCosts = uniqueCosts.map(cost => ({ ...cost, energy_statistic_ids: Array.from(costParents.get(cost.statistic_id) || []) }));
      return { source_mode: 'energy_dashboard', totals: uniqueTotals, devices: uniqueDevices, costs: linkedCosts, cost_configuration_incomplete: costConfigurationIncomplete, warnings: [], ordered: uniqueById([...uniqueTotals, ...linkedCosts, ...uniqueDevices]) };
    }

    _explicitSources() {
      let totals = normalizeList(this._config.energy_total_statistics, 'total', 'explicit');
      if (totals.length === 0 && this._config.energy_entity) totals = normalizeList([this._config.energy_entity], 'total', 'legacy_energy_entity');
      const invalidTotals = totals.filter((source) => source.included_in_stat);
      totals = totals.filter((source) => !source.included_in_stat);
      const devices = normalizeList(this._config.energy_device_statistics, 'device', 'explicit');
      const costs = normalizeList(this._config.energy_cost_statistics, 'cost', 'explicit');
      return { source_mode: 'explicit', totals, devices, costs, warnings: invalidTotals.map((source) => `included_in_stat is only valid for device sources: ${source.statistic_id}`), ordered: uniqueById([...totals, ...devices, ...costs]) };
    }

    _metadataMap(response) {
      if (Array.isArray(response)) {
        const result = {};
        for (const entry of response) if (entry && typeof entry.statistic_id === 'string') result[entry.statistic_id] = entry;
        return result;
      }
      return response && typeof response === 'object' ? response : {};
    }

    _metadataUnit(metadata) {
      if (!metadata || typeof metadata !== 'object') return null;
      const unit = metadata.statistics_unit_of_measurement != null ? metadata.statistics_unit_of_measurement : metadata.unit_of_measurement;
      return typeof unit === 'string' && unit ? unit : null;
    }

    _summarizeSeries(series, metadata, window, role, expectedCurrency) {
      const complete = this._summarizeCompleteSeries(series, metadata, window, role, expectedCurrency);
      const result = { ...complete, recorded_value: null, coverage: null };
      if (!['ready', 'partial', 'no_data'].includes(complete.status)) return result;
      const start = numericTime(window && window.start); const end = numericTime(window && window.end);
      if (start === null || end === null || end < start) return result;
      const buckets = (Array.isArray(series) ? series : []).map(bucket => ({ start: numericTime(bucket.start), end: numericTime(bucket.end), change: bucket.change })).sort((a, b) => a.start - b.start);
      if (buckets.some((bucket, index) => bucket.start === null || bucket.end === null || bucket.end <= bucket.start || (index > 0 && bucket.start < buckets[index - 1].end) || (bucket.change != null && (typeof bucket.change !== 'number' || !Number.isFinite(bucket.change) || (role !== 'cost' && bucket.change < 0))))) return result;
      const observed = buckets.filter(bucket => bucket.start >= start && bucket.end <= end && typeof bucket.change === 'number');
      let value = observed.reduce((sum, bucket) => sum + bucket.change, 0);
      const unit = this._metadataUnit(metadata);
      if (role !== 'cost') value *= unit === 'Wh' ? 0.001 : (unit === 'MWh' ? 1000 : 1);
      result.recorded_value = observed.length > 0 && Number.isFinite(value) ? value : null;
      result.coverage = { observed_hours: observed.reduce((hours, bucket) => hours + (bucket.end - bucket.start) / 3600000, 0), expected_hours: (end - start) / 3600000, first_sample: observed.length ? new Date(observed[0].start).toISOString() : null, last_sample: observed.length ? new Date(observed[observed.length - 1].end).toISOString() : null };
      return result;
    }

    _summarizeCompleteSeries(series, metadata, window, role, expectedCurrency) {
      const unit = this._metadataUnit(metadata);
      if (!metadata || metadata.has_sum !== true) return { status: 'unsupported', value: null, unit };
      const unitClass = metadata.unit_class == null ? null : String(metadata.unit_class);
      if (role !== 'cost' && (!ENERGY_UNITS.has(unit) || (unitClass !== null && unitClass !== 'energy'))) return { status: 'unsupported', value: null, unit, reason: 'incompatible_energy_metadata' };
      if (role === 'cost' && (!unit || (unitClass !== null && unitClass !== 'currency') || typeof expectedCurrency !== 'string' || unit !== expectedCurrency)) return { status: 'unsupported', value: null, unit, reason: 'incompatible_currency_metadata' };
      const normalizedUnit = role === 'cost' ? unit : 'kWh';
      if (!Array.isArray(series) || series.length === 0) return { status: 'no_data', value: null, unit: normalizedUnit, reason: 'no_data' };
      const buckets = series.map((bucket) => ({ start: numericTime(bucket && bucket.start), end: numericTime(bucket && bucket.end), change: bucket && bucket.change }));
      if (buckets.some((bucket) => bucket.start === null || bucket.end === null || bucket.end <= bucket.start)) return { status: 'invalid', value: null, unit: normalizedUnit, reason: 'invalid_bucket' };
      buckets.sort((left, right) => left.start - right.start);
      const windowStart = window && asDate(window.start); const windowEnd = window && asDate(window.end);
      let effectiveBuckets = buckets;
      let startMs = null; let endMs = null;
      if (windowStart && windowEnd && windowEnd > windowStart) {
        startMs = windowStart.getTime(); endMs = windowEnd.getTime();
        if (buckets.some((bucket) => bucket.end < startMs || bucket.start > endMs)) return { status: 'invalid', value: null, unit: normalizedUnit, reason: 'outside_requested_window' };
        effectiveBuckets = buckets.filter((bucket) => bucket.end > startMs && bucket.start < endMs);
        if (effectiveBuckets.length === 0) return { status: 'no_data', value: null, unit: normalizedUnit, reason: 'no_data' };
      }
      if (effectiveBuckets.some((bucket) => bucket.change === undefined || bucket.change === null)) return { status: 'partial', value: null, unit: normalizedUnit, reason: 'missing_change' };
      if (effectiveBuckets.some((bucket) => typeof bucket.change !== 'number' || !Number.isFinite(bucket.change))) return { status: 'invalid', value: null, unit: normalizedUnit };
      if (role !== 'cost' && effectiveBuckets.some((bucket) => bucket.change < 0)) return { status: 'invalid', value: null, unit: normalizedUnit };
      for (let index = 1; index < effectiveBuckets.length; index += 1) {
        if (effectiveBuckets[index].start < effectiveBuckets[index - 1].end) return { status: 'invalid', value: null, unit: normalizedUnit };
        if (effectiveBuckets[index].start - effectiveBuckets[index - 1].end > 1000) return { status: 'partial', value: null, unit: normalizedUnit };
      }
      if (startMs !== null && endMs !== null) {
        // A boundary gap or a straddling bucket cannot represent the requested total.
        if (Math.abs(effectiveBuckets[0].start - startMs) > 1000 || Math.abs(endMs - effectiveBuckets[effectiveBuckets.length - 1].end) > 1000) return { status: 'partial', value: null, unit: normalizedUnit, reason: 'incomplete_coverage' };
      }
      let value = effectiveBuckets.reduce((sum, bucket) => sum + bucket.change, 0);
      if (role !== 'cost') {
        if (unit === 'Wh') value /= 1000;
        else if (unit === 'MWh') value *= 1000;
      }
      return Number.isFinite(value) ? { status: 'ready', value, unit: normalizedUnit } : { status: 'invalid', value: null, unit: normalizedUnit };
    }

    _buildDeviceRows(sources) {
      const byId = new Map(sources.map((source) => [source.statistic_id, source]));
      const missingParentIds = new Set(sources.filter((source) => source.included_in_stat && !byId.has(source.included_in_stat)).map((source) => source.statistic_id));
      let relationshipStatus = missingParentIds.size > 0 ? 'nested_parent_missing' : 'valid';
      const visitState = new Map();
      const visit = (source) => {
        const current = visitState.get(source.statistic_id) || 0;
        if (current === 1) return false;
        if (current === 2) return true;
        visitState.set(source.statistic_id, 1);
        if (source.included_in_stat) {
          const parent = byId.get(source.included_in_stat);
          if (parent && !visit(parent)) return false;
        }
        visitState.set(source.statistic_id, 2);
        return true;
      };
      if (sources.some((source) => !visit(source))) relationshipStatus = 'invalid_relationship';
      if (relationshipStatus === 'invalid_relationship') return { rows: sources.map((source) => ({ ...source, relationship_status: 'invalid_relationship', depth: 0 })), relationship_status: relationshipStatus, top_ranking_available: false };
      if (relationshipStatus === 'nested_parent_missing') return {
        rows: sources.map((source) => ({ ...source, relationship_status: missingParentIds.has(source.statistic_id) ? 'nested_parent_missing' : 'valid', depth: missingParentIds.has(source.statistic_id) ? 1 : 0 })),
        relationship_status: relationshipStatus,
        top_ranking_available: false,
      };
      const children = new Map();
      for (const source of sources) if (source.included_in_stat) {
        if (!children.has(source.included_in_stat)) children.set(source.included_in_stat, []);
        children.get(source.included_in_stat).push(source);
      }
      const valueOrder = (left, right) => (right.status === 'ready' ? right.value : Number.NEGATIVE_INFINITY) - (left.status === 'ready' ? left.value : Number.NEGATIVE_INFINITY) || left.statistic_id.localeCompare(right.statistic_id);
      const roots = sources.filter((source) => !source.included_in_stat).sort(valueOrder); const rows = [];
      const append = (source, depth) => { rows.push({ ...source, depth }); for (const child of (children.get(source.statistic_id) || []).sort(valueOrder)) append(child, depth + 1); };
      for (const root of roots) append(root, 0);
      return { rows, relationship_status: 'valid', top_ranking_available: true };
    }

    _calculateCost(total, costSources, config) {
      const configured = config.energy_cost_mode === 'flat_rate_estimate' ? [] : (Array.isArray(costSources) ? costSources : []);
      if (configured.length > 0) {
        if (configured.some((source) => source.reason === 'incompatible_currency_metadata')) return { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: 'currency_mismatch' };
        if (configured.some((source) => source.status !== 'ready')) return { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: 'partial_cost' };
        const currencies = [...new Set(configured.map((source) => source.unit))];
        if (currencies.length !== 1) return { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: 'currency_mismatch' };
        return { value: configured.reduce((sum, source) => sum + source.value, 0), currency: currencies[0], method: 'cost_statistics', rate: null, source_statistic_ids: configured.map((source) => source.statistic_id), reason: null };
      }
      if (config.energy_cost_mode === 'cost_statistics') return { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'missing_statistics' };
      if (typeof config.energy_price !== 'number' || !Number.isFinite(config.energy_price) || config.energy_price < 0) return { value: null, currency: config.currency || null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'missing_rate' };
      if (typeof config.currency !== 'string' || !config.currency.trim()) return { value: null, currency: null, method: 'unavailable', rate: config.energy_price, source_statistic_ids: [], reason: 'missing_currency' };
      if (!total || typeof total.value !== 'number' || !Number.isFinite(total.value)) return { value: null, currency: config.currency, method: 'unavailable', rate: config.energy_price, source_statistic_ids: [], reason: 'energy_data_unavailable' };
      return { value: total.value * config.energy_price, currency: config.currency, method: 'flat_rate_estimate', rate: config.energy_price, source_statistic_ids: Array.isArray(total.source_statistic_ids) ? [...total.source_statistic_ids] : [], reason: null };
    }

    async _loadEnergy() {
      const exportAssociation = this._observeReviewedExportSource();
      const requestHass = this._hass, requestCall = requestHass?.callWS;
      if (this._config.energy_cost_mode === 'configured_tariff') this._tariffController().reset();
      const compare = this._config.compare_previous_period === true;
      if (compare) this._tariffController();
      const ticket = compare ? this._tariffGuard.snapshot() : null;
      const generation = ++this._energyRequestGeneration;
      const period = this._periodDescriptor();
      const pairedPeriod = compare ? this._previousPeriodDescriptor(period) : null;
      const current = () => this._isCurrentEnergyRequest(generation) && exportAssociation === this._observeReviewedExportSource() && (!compare || this._tariffGuard.current(ticket));
      const read = payload => compare ? this._tariffGuard.call(ticket, payload) : requestCall.call(requestHass,payload);
      const mode = this._config.energy_source_mode === 'explicit' ? 'explicit' : 'energy_dashboard';
      const previous = this._energyViewState;
      const reportConfig = JSON.stringify([this._config.energy_source_mode, this._config.energy_total_statistics, this._config.energy_device_statistics, this._config.energy_cost_statistics, this._config.energy_entity, this._config.energy_price, this._config.currency, this._config.energy_cost_mode, this._config.tariff_profile, compare]);
      const sameWindow = this._energyReportConfig === reportConfig && previous && ['ready', 'partial', 'no_data'].includes(previous.status) && previous.source_mode === mode && previous.period && previous.period.key === period.key && previous.period.start === period.start && previous.period.end === period.end && previous.period.time_zone === period.time_zone;
      if (!sameWindow) this._setEnergyViewState({ status: 'loading', period, source_mode: mode, total: { value: null, unit: 'kWh', source_statistic_ids: [] }, cost: { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'loading' }, devices: [], warnings: [] });
      try {
        const selection = mode === 'explicit' ? this._explicitSources() : await this._dashboardSources(generation, read);
        if (!selection || !current()) return;
        if (selection.totals.length === 0) {
          this._setEnergyViewState({ status: 'not_configured', period, source_mode: selection.source_mode, total: { value: null, unit: 'kWh', source_statistic_ids: [] }, cost: { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'not_configured' }, devices: [], total_sources: [], cost_sources: [], warnings: [...(selection.warnings || [])] });
          return;
        }
        const ids = selection.ordered.map((source) => source.statistic_id);
        const metadataResponse = await read({ type: 'recorder/get_statistics_metadata', statistic_ids: ids });
        if (!current()) return;
        const statisticsResponse = new Date(period.end) <= new Date(period.start) ? {} : await read({ type: 'recorder/statistics_during_period', start_time: period.start, end_time: period.end, statistic_ids: ids, period: 'hour', types: ['change'] });
        if (!current()) return;
        const metadataById = this._metadataMap(metadataResponse); const statisticsById = statisticsResponse && typeof statisticsResponse === 'object' ? statisticsResponse : {};
        let priorStatistics = null;
        let comparisonDescriptor = pairedPeriod;
        if (pairedPeriod?.period) {
          const prior = pairedPeriod.period;
          try {
            priorStatistics = new Date(prior.end) <= new Date(prior.start) ? {} : await read({ type: 'recorder/statistics_during_period', start_time: prior.start, end_time: prior.end, statistic_ids: ids, period: 'hour', types: ['change'] });
          } catch (error) {
            if (!current()) return;
            // Permission failures remain fail-closed. An optional historical read
            // failure must not erase the separately confirmed current readings.
            if (this._classifyError(error) === 'permission_denied') throw error;
            comparisonDescriptor = { ...pairedPeriod, readStatus: 'error', reason: 'read_failed' };
          }
          if (!current()) return;
        }
        let tariffSnapshot = null;
        if (this._config.energy_cost_mode === 'configured_tariff') {
          const host = this._tariffController();
          if (!Object.hasOwn(this._config,'tariff_profile')) await host.load();
          if (!current()) return;
          tariffSnapshot = host.snapshot();
        }
        const state = this._materializeEnergyPeriod(period, selection, statisticsById, metadataById, tariffSnapshot);
        if (compare) state.comparison = this._buildPeriodComparison(state, comparisonDescriptor, selection, statisticsById, priorStatistics, metadataById, tariffSnapshot);
        if (!current()) return;
        this._tariffPricingContext = this._config.energy_cost_mode === 'configured_tariff' ? { generation, period, roots: selection.totals, statistics: statisticsById, metadata: metadataById,
          ...(compare ? { selection, pairedPeriod: comparisonDescriptor, priorStatistics } : {}) } : null;
        this._energyReportConfig = reportConfig;
        this._setEnergyViewState(state);
      } catch (error) {
        if (current()) this._setEnergyViewState(this._errorState(error, period));
      }
    }

    _materializeEnergyPeriod(period, selection, statisticsById, metadataById, tariffSnapshot, historical = false) {
        const window = { start: new Date(period.start), end: new Date(period.end) };
        const expectedCurrency = this._hass && this._hass.config && this._hass.config.currency;
        const roleReferences = [...selection.totals, ...selection.costs, ...selection.devices];
        const summaryByRole = new Map(roleReferences.map((source) => [`${source.role}:${source.statistic_id}`, this._summarizeSeries(statisticsById[source.statistic_id], metadataById[source.statistic_id], window, source.role, expectedCurrency)]));
        const materialize = (source) => {
          const entity = this._hass.states && this._hass.states[source.statistic_id];
          const friendlyName = entity && entity.attributes && entity.attributes.friendly_name;
          const metadataName = metadataById[source.statistic_id] && metadataById[source.statistic_id].name;
          const relatedNames = (source.energy_statistic_ids || []).map(id => this._hass.states?.[id]?.attributes?.friendly_name || metadataById[id]?.name || id);
          const label = [source.label, friendlyName, metadataName, relatedNames.length ? relatedNames.join(' / ') : null].find(value => typeof value === 'string' && value.trim());
          return { ...source, ...summaryByRole.get(`${source.role}:${source.statistic_id}`), label: label || source.statistic_id };
        };
        const totalSources = selection.totals.map(materialize);
        const costSources = selection.costs.map(materialize);
        const deviceSources = selection.devices.map(materialize);
        let status = 'ready';
        if (totalSources.every((source) => source.status === 'no_data')) status = 'no_data';
        else if (totalSources.every((source) => source.status === 'unsupported')) status = 'unsupported';
        else if (totalSources.some((source) => source.status !== 'ready')) status = 'partial';
        const completeTotal = status === 'ready'
          ? { status: 'ready', value: totalSources.reduce((sum, source) => sum + source.value, 0), unit: 'kWh', source_statistic_ids: totalSources.map((source) => source.statistic_id) }
          : { status, value: null, unit: 'kWh', source_statistic_ids: totalSources.map((source) => source.statistic_id) };
        let cost = this._calculateCost(completeTotal, costSources, this._config);
        if (this._config.energy_cost_mode !== 'configured_tariff' && this._config.energy_cost_mode !== 'flat_rate_estimate' && selection.cost_configuration_incomplete) cost = { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: costSources.map((source) => source.statistic_id), reason: 'partial_cost' };
        if (status !== 'ready') {
          const reason = status === 'no_data' ? 'no_data' : (status === 'unsupported' ? 'unsupported_source' : 'partial_energy');
          cost = { ...cost, value: null, method: 'unavailable', reason };
        }
        if (this._config.energy_cost_mode === 'configured_tariff') {
          cost = this._priceConfiguredTariff(period, selection.totals, statisticsById, metadataById, tariffSnapshot);
        } else if (historical && cost.method === 'flat_rate_estimate') {
          cost = { value: null, currency: cost.currency, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'historical_flat_rate_unavailable' };
        }
        const deviceModel = this._buildDeviceRows(deviceSources);
        const deviceDataStatus = deviceSources.some((source) => source.status !== 'ready') ? 'partial' : 'ready';
        const warnings = [...(selection.warnings || [])];
        if (deviceModel.relationship_status !== 'valid') warnings.push(deviceModel.relationship_status);
        const recordedTotal = this._recordedSubtotal(totalSources, 'kWh');
        const recordedCost = this._recordedSubtotal(costSources, expectedCurrency);
        const daily = this._dailyEnergySeries(period, totalSources, statisticsById, metadataById);
        return { status, period, source_mode: selection.source_mode, total: completeTotal, cost, recorded_total: recordedTotal, recorded_cost: recordedCost, daily, devices: deviceModel.rows, total_sources: totalSources, cost_sources: costSources, device_data_status: deviceDataStatus, device_relationship_status: deviceModel.relationship_status, top_ranking_available: deviceModel.top_ranking_available, warnings };
    }

    _priceConfiguredTariff(period, roots, statistics, metadata, snapshot) {
      const unavailable = reason => ({ method: 'configured_tariff', value: null, currency: null, rate: null,
        source_statistic_ids: roots.map(s => s.statistic_id), reason, records: Object.freeze([]), daily: Object.freeze([]), measured_energy_cost: null,
        coverage: { observed_hours: 0, expected_hours: 0, observed_source_hours: 0, expected_source_hours: 0 } });
      const profile = snapshot?.profile, model = createEnergyTariffV3(profile);
      if (!model.valid) return unavailable(snapshot?.reason || 'invalid_profile');
      const start = numericTime(period.start), end = numericTime(period.end), hour = 3600000;
      if (!roots.length || new Set(roots.map(s => s.statistic_id)).size !== roots.length || roots.some(s => s.role !== 'total' || s.included_in_stat)) return unavailable('invalid_root_sources');
      if (start === null || end === null || end <= start || (end - start) / hour > 744) return unavailable('nonaligned_window');
      const firstHour = Math.ceil(start / hour) * hour, lastHour = Math.floor(end / hour) * hour;
      // Recorder measures complete UTC hours. Non-hour local midnight boundaries
      // stay unknown; neither prorate a reading nor shorten the requested period.
      const unmeasuredIntervals = [];
      const boundary = (from, to) => Object.freeze({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), reason: 'nonaligned_boundary' });
      if (firstHour >= lastHour && (start % hour || end % hour)) unmeasuredIntervals.push(boundary(start, end));
      else {
        if (firstHour > start) unmeasuredIntervals.push(boundary(start, firstHour));
        if (lastHour < end) unmeasuredIntervals.push(boundary(lastHour, end));
      }
      const common = new Map(), fatal = new Map(), ids = roots.map(s => s.statistic_id);
      for (const source of roots) {
        const id = source.statistic_id, md = metadata[id], unit = this._metadataUnit(md);
        if (!md || md.has_sum !== true || !ENERGY_UNITS.has(unit) || (md.unit_class != null && md.unit_class !== 'energy')) { fatal.set(id, 'incompatible_energy_metadata'); continue; }
        const series = statistics[id];
        if (series != null && !Array.isArray(series)) { fatal.set(id, 'invalid_measurement'); continue; }
        const sorted = (series || []).map(b => ({ from: numericTime(b?.start), to: numericTime(b?.end), change: b?.change })).sort((a,b) => a.from - b.from);
        if (sorted.some((b,i) => b.from === null || b.to === null || b.to - b.from !== hour || b.from % hour || b.from < Math.floor(start / hour) * hour || b.to > Math.ceil(end / hour) * hour ||
          (i && b.from < sorted[i-1].to) || (b.change != null && (typeof b.change !== 'number' || !Number.isFinite(b.change) || b.change < 0)))) { fatal.set(id, 'invalid_measurement'); continue; }
        const factor = unit === 'Wh' ? 0.001 : unit === 'MWh' ? 1000 : 1;
        for (const b of sorted) if (b.from >= firstHour && b.to <= lastHour && typeof b.change === 'number') {
          const kwh = b.change * factor;
          if (!Number.isFinite(kwh)) { fatal.set(id, 'nonfinite_measurement'); break; }
          if (!common.has(b.from)) common.set(b.from, new Map()); common.get(b.from).set(id, kwh);
        }
      }
      // No root overlap assumption is inferred from devices or residual values.
      // Each complete common hour is measured once across the explicitly selected roots.
      const measured = [];
      if (!fatal.size) for (let from = firstHour; from < lastHour; from += hour) {
        const contributions = common.get(from);
        if (contributions?.size === roots.length) measured.push({ from, to: from + hour, kwh: [...contributions.values()].reduce((a,b) => a+b,0) });
      }
      const priced = model.priceBuckets(measured, { from: start, to: end });
      const byHour = new Map(priced.rows.map(row => [row.from, row])), measuredByHour = new Map(measured.map(row => [row.from,row]));
      const records = [];
      for (let from = firstHour; from < lastHour; from += hour) {
        const p = byHour.get(from), available = p?.available === true;
        const contributions = common.get(from), reason = available ? null : p?.reason || (fatal.size ? [...fatal.values()][0] : 'missing_measurement');
        records.push(Object.freeze({ from: new Date(from).toISOString(), to: new Date(from + hour).toISOString(),
          source_statistic_ids: Object.freeze([...ids]), source_kwh: Object.freeze(measuredByHour.has(from) ? Object.fromEntries(contributions) : {}),
          available, measurement_available: measuredByHour.has(from), reason, kwh: measuredByHour.get(from)?.kwh ?? null, zone: p?.zone ?? null, zones: Object.freeze(p?.zones || []),
          energyRate: p?.energyRate ?? null, variableRate: p?.variableRate ?? null,
          energyCost: available ? p.energyCost : null, variableCost: available ? p.variableCost : null, usageCost: available ? p.usageCost : null,
          currency: profile.currency, price_basis: profile.priceBasis, revision: snapshot.revision ?? null }));
      }
      const ready = records.filter(r => r.available), sum = field => { const n = ready.reduce((a,b) => a+b[field],0); return ready.length && Number.isFinite(n) ? n : null; };
      const current = model.rateAt(this._now().toISOString());
      const observedSourceHours = !fatal.size ? [...common.values()].reduce((n,c) => n+c.size,0) : 0;
      return Object.freeze({ method: 'configured_tariff', value: priced.complete ? priced.energyCost : null,
        currency: profile.currency, rate: null, source_statistic_ids: Object.freeze([...ids]),
        reason: priced.complete ? null : (fatal.size ? [...fatal.values()][0] : priced.issues[0]?.reason || 'missing_measurement'),
        records: Object.freeze(records), daily: this._tariffDailyRecords(period, records), measured_energy_cost: sum('energyCost'), measured_kwh: sum('kwh'),
        variable_cost: priced.complete ? priced.variableCost : null, usage_cost: priced.complete ? priced.usageCost : null,
        fixed_monthly: priced.fixedMonthly, price_basis: profile.priceBasis, tariff_timezone: profile.timezone,
        tariff_clock: Object.freeze({ ...profile.clock }), revision: snapshot.revision ?? null, provenance: snapshot.provenance || null,
        current_profile_validity: Object.freeze({ available: current.available, reason: current.reason || null, checked_at: this._now().toISOString() }),
        coverage: Object.freeze({ observed_hours: ready.length, expected_hours: (end-start)/hour,
          observed_source_hours: observedSourceHours, expected_source_hours: roots.length * (end-start)/hour,
          complete: priced.complete, measured_subset: !priced.complete && ready.length > 0,
          unmeasured_intervals: Object.freeze(unmeasuredIntervals) }) });
    }

    _tariffDailyRecords(period, records) {
      const start = asDate(period.start), end = asDate(period.end);
      if (!start || !end || end <= start || !records.length) return Object.freeze([]);
      const days = []; let parts = this._partsInZone(start, period.time_zone);
      const sum = (rows, field) => {
        const value = rows.reduce((total, row) => total + row[field], 0);
        return rows.length && Number.isFinite(value) ? value : null;
      };
      for (let index = 0; index < 31; index++) {
        const bounds = this._zonedDayBounds(parts, period.time_zone);
        const from = Math.max(start.getTime(), bounds.start.getTime()), to = Math.min(end.getTime(), bounds.end.getTime());
        if (to <= from) break;
        // Never split an hourly meter reading across a local midnight. A fractional
        // boundary stays incomplete instead of inventing within-hour consumption.
        const hours = records.filter(row => Date.parse(row.from) >= from && Date.parse(row.to) <= to);
        const measured = hours.filter(row => row.measurement_available), priced = hours.filter(row => row.available);
        const expected = (to - from) / 3600000;
        const energyComplete = Number.isInteger(expected) && measured.length === expected;
        const costComplete = Number.isInteger(expected) && priced.length === expected;
        const kwh = sum(measured, 'kwh'), money = sum(priced, 'energyCost');
        const complete = energyComplete && costComplete && kwh !== null && money !== null;
        days.push(Object.freeze({ from: new Date(from).toISOString(), to: new Date(to).toISOString(),
          kwh: energyComplete ? kwh : null, energyCost: costComplete ? money : null,
          recorded_kwh: kwh, recorded_energy_cost: money,
          measurement_available: energyComplete && kwh !== null, available: costComplete && money !== null,
          expected_hours: expected, measured_hours: measured.length, observed_hours: priced.length,
          status: complete ? 'ready' : measured.length ? 'partial' : 'no_data', records: Object.freeze(hours) }));
        if (bounds.end >= end) break;
        parts = this._addCalendarDays(parts, 1);
      }
      return Object.freeze(days);
    }

    _tariffController() {
      if (this._tariffHost) return this._tariffHost;
      this._tariffGuard ||= createTariffGuardV3({ getHass: () => this._hass,
        getContext: () => ({ config: this._config, period: this._period, tab: this._activeTab, connected: this._connected }) });
      this._tariffGuard.subscribe(() => {
        this._invalidateEnergyRequest();
        this._clearMeasuredEnergySource();
      });
      this._tariffHost = createTariffHostV3({ card: this, kind: 'smart', createModel: createEnergyTariffV3,
        legacyProfile: config => Object.hasOwn(config, 'tariff_profile') ? config.tariff_profile : null,
        createSettings: createTariffSettingsV3, createUi: createUiV3, guard: this._tariffGuard,
        onRefresh: () => {
          // Settings readback updates the settled snapshot without another recorder request.
          const context = this._tariffPricingContext;
          if (context && context.generation === this._energyRequestGeneration) {
            const snapshot = this._tariffHost.snapshot();
            const cost = this._priceConfiguredTariff(context.period, context.roots, context.statistics, context.metadata, snapshot);
            const state = { ...this._energyViewState, cost };
            if (context.selection) state.comparison = this._buildPeriodComparison(state, context.pairedPeriod, context.selection, context.statistics, context.priorStatistics, context.metadata, snapshot);
            this._setEnergyViewState(state);
          } else this._renderEnergyState();
        } });
      return this._tariffHost;
    }

    _renderTariffSettings(container, markup) {
      if (this._config.energy_cost_mode !== 'configured_tariff') return;
      const host = this._tariffController(), block = document.createElement('section');
      const existingMount = this._tariffSettingsSection?.querySelector('[data-tariff-mount]');
      block.innerHTML = markup ?? host.markup();
      // Keep the editor and its in-flight operation across ordinary report renders.
      // The strong guard separately erases this mount on any authority/context edge.
      if (existingMount) block.querySelector('[data-tariff-mount]').replaceWith(existingMount);
      this._tariffSettingsSection = block; container.appendChild(block); host.bind();
    }

    _renderTariffEvidence(container, cost) {
      const section = document.createElement('section'); section.className = 'tariff-evidence section';
      const heading = document.createElement('h3'); heading.textContent = this._t('Configured tariff energy cost'); section.appendChild(heading);
      const text = document.createElement('p'); text.className = 'muted';
      text.textContent = `${this._t('Measured hours')}: ${cost.coverage.observed_hours}/${cost.coverage.expected_hours} · ${cost.currency || '—'} · ${this._t(cost.price_basis || '—')} · ${cost.tariff_timezone || '—'} · ${this._t('Revision')}: ${cost.revision ?? '—'} · ${this._t(cost.provenance || 'unavailable')} · ${this._t('Current profile validity')}: ${this._t(cost.current_profile_validity?.available ? 'ready' : cost.current_profile_validity?.reason || cost.reason || 'unavailable')}`;
      section.appendChild(text);
      for (const interval of cost.coverage.unmeasured_intervals || []) {
        const gap = document.createElement('p'); gap.className = 'warning'; gap.dataset.tariffBoundary = '';
        gap.textContent = `${this._t('Boundary intervals without a complete hourly measurement')}: ${this._formatPeriodDate(interval.from, this._energyViewState.period.time_zone)} – ${this._formatPeriodDate(interval.to, this._energyViewState.period.time_zone)}`;
        section.appendChild(gap);
      }
      const note = document.createElement('p'); note.textContent = this._t('Energy cost only; variable and fixed fees are separate. This is not a complete electricity bill.'); section.appendChild(note);
      if (cost.value === null) {
        const subset = document.createElement('p'); subset.setAttribute('role','status');
        subset.textContent = `${this._t('Measured subset only')}: ${cost.measured_energy_cost == null ? '—' : this._formatNumber(cost.measured_energy_cost,2)} ${cost.currency || ''} · ${this._t(cost.reason || 'unavailable')}`; section.appendChild(subset);
      }
      for (const [key,label,unit] of [['variable_cost','Variable fees',cost.currency],['usage_cost','Energy and variable fees',cost.currency],['fixed_monthly','Fixed monthly fee (separate)',`${cost.currency || ''}/${this._t('month')}`]]) {
        const line = document.createElement('p');line.textContent = `${this._t(label)}: ${cost[key] == null ? '—' : this._formatNumber(cost[key],2)} ${unit || ''}`;section.appendChild(line);
      }
      const views = document.createElement('div'); views.dataset.reportNav='cost'; views.className='report-views';views.setAttribute('role','tablist');views.setAttribute('aria-label',this._t('Cost evidence'));
      for (const [key,label] of [['chart','Chart'],['data','Data']]) {
        const button=document.createElement('button');button.type='button';button.className='action';button.dataset.costView=key;button.setAttribute('role','tab');button.setAttribute('aria-selected',String((this._costEvidenceView || 'chart')===key));button.textContent=this._t(label);
        button.addEventListener('click',()=>{this._costEvidenceView=key;this._renderEnergyState();this._focusReportControl(this.shadowRoot.querySelector(`[data-cost-view="${key}"]`));});views.appendChild(button);
      }section.appendChild(views);
      const panel = document.createElement('div'); panel.setAttribute('role','tabpanel');
      const records = cost.records, daily = cost.daily || [];
      const selected = daily.find(day => day.from === this._costSelectedDay);
      if (!selected) this._costSelectedDay = null;
      const rerender = (selector, fallback) => {
        this._renderEnergyState();
        const target = this.shadowRoot.querySelector(selector);
        this._focusReportControl(target && !target.disabled ? target : this.shadowRoot.querySelector(fallback || '[data-cost-view][aria-selected="true"]'));
      };
      if (selected) {
        const detail = document.createElement('p'); detail.dataset.costSelectedDay = selected.from; detail.setAttribute('role','status');
        detail.textContent = `${this._formatPeriodDate(selected.from,this._energyViewState.period.time_zone)} · ${selected.measured_hours}/${selected.expected_hours} ${this._t('Measured hours')} · ${this._t(selected.status)} · ${this._formatNumber(selected.recorded_kwh,2)} kWh · ${this._formatNumber(selected.recorded_energy_cost,2)} ${cost.currency || '—'}`;
        panel.appendChild(detail);
        const clear = document.createElement('button'); clear.type='button'; clear.className='action'; clear.dataset.costClearDay=''; clear.textContent=this._t('All hours');
        clear.addEventListener('click',()=>{this._costSelectedDay=null;this._costDataPage=0;rerender('[data-cost-view][aria-selected="true"]');}); panel.appendChild(clear);
      }
      const paginate = (count, size, property, attribute) => {
        const pages=Math.max(1,Math.ceil(count/size));
        this[property]=Math.max(0,Math.min(pages-1,this[property] || 0));
        const nav=document.createElement('nav'); nav.className='tariff-pagination'; nav.setAttribute('aria-label',this._t(attribute==='costPage'?'Hourly records':'Daily overview'));
        const status=document.createElement('span'); status.textContent=`${this._t('Page')} ${this[property]+1}/${pages}`; nav.appendChild(status);
        for (const [direction,label,offset] of [['previous','Previous',-1],['next','Next',1]]) {
          const button=document.createElement('button');button.type='button';button.className='action';button.dataset[attribute]=direction;button.textContent=this._t(label);
          button.disabled=offset<0?this[property]===0:this[property]===pages-1;
          button.addEventListener('click',()=>{this[property]+=offset;rerender(`[data-${attribute==='costPage'?'cost-page':'cost-chart-page'}="${direction}"]`,`[data-${attribute==='costPage'?'cost-page':'cost-chart-page'}]:not([disabled])`);});nav.appendChild(button);
        }
        panel.appendChild(nav); return this[property]*size;
      };
      if ((this._costEvidenceView || 'chart') === 'data') {
        const rows = selected ? selected.records : records;
        const offset = paginate(rows.length,50,'_costDataPage','costPage');
        for (const record of rows.slice(offset,offset+50)) {
          const row=document.createElement('article');row.className='tariff-data-row';row.dataset.pricedRow=record.from;
          const title=document.createElement('h4');title.textContent=`${this._formatPeriodDate(record.from,this._energyViewState.period.time_zone)} → ${this._formatPeriodDate(record.to,this._energyViewState.period.time_zone)}`;row.appendChild(title);
          const data=document.createElement('dl');
          for(const [label,value] of [
            ['Measured energy',`${this._formatNumber(record.kwh,2)} kWh`],
            ['Priced energy',`${this._formatNumber(record.energyCost,2)} ${cost.currency || '—'}`],
            ['Energy / kWh',`${this._formatNumber(record.energyRate,4)} ${cost.currency || '—'}/kWh`],
            ['Zone',record.zones.join(', ') || '—'],['Status',this._t(record.reason || 'ready')],
            ['Source evidence',record.source_statistic_ids.join(', ')],['UTC interval',`${record.from} → ${record.to}`]]) {
            const term=document.createElement('dt');term.textContent=this._t(label);const valueNode=document.createElement('dd');valueNode.textContent=value;data.append(term,valueNode);
          }row.appendChild(data);panel.appendChild(row);
        }
      } else {
        const offset=paginate(daily.length,7,'_costChartPage','costChartPage');
        const note=document.createElement('p');note.className='muted';note.textContent=this._t('Select a day to inspect its hours. Stripes show measured subsets; gaps are not zero.');panel.appendChild(note);
        for (const [key,subset,unit,label] of [['kwh','recorded_kwh','kWh','Measured energy'],['energyCost','recorded_energy_cost',cost.currency || '—','Priced energy']]) {
          const chart=document.createElement('section');chart.className='tariff-day-chart';chart.setAttribute('aria-label',`${this._t(label)} (${unit})`);
          const axis=document.createElement('h4');axis.textContent=`${this._t(label)} · ${unit}`;chart.appendChild(axis);
          const signed = daily.some(day => day[subset] < 0);
          const scale=Math.max(0,...daily.map(day=>Math.abs(day[subset] || 0)));
          for (const day of daily.slice(offset,offset+7)) {
            const value=day[subset], complete=key==='kwh'?day.measurement_available:day.available;
            const button=document.createElement('button');button.type='button';button.className='tariff-day';button.dataset.costDay=day.from;button.dataset.costMetric=key;button.dataset.availability=value===null?'gap':complete?'ready':'partial';button.setAttribute('aria-pressed',String(selected?.from===day.from));
            const date=document.createElement('span');date.textContent=new Intl.DateTimeFormat(languageOf(this._hass),{day:'numeric',month:'short',timeZone:this._energyViewState.period.time_zone}).format(new Date(day.from));
            const amount=document.createElement('strong');amount.textContent=`${this._formatNumber(value,2)} ${unit}`;
            const status=document.createElement('small');status.textContent=this._t(complete?'ready':day.status);
            const track=document.createElement('span');track.className=`tariff-day-track${signed?' signed':''}`;track.setAttribute('aria-hidden','true');
            if(value!==null){const fill=document.createElement('span');fill.className='tariff-day-fill';const width=scale?Math.abs(value)/scale*(signed?50:100):0;fill.style.width=`${width}%`;fill.style.left=`${signed?(value<0?50-width:50):0}%`;track.appendChild(fill);}
            button.title=`${day.from} → ${day.to} · ${day.measured_hours}/${day.expected_hours} ${this._t('Measured hours')} · ${this._t(day.status)}`;
            button.append(date,amount,status,track);
            button.addEventListener('click',()=>{this._costSelectedDay=day.from;this._costDataPage=0;rerender(`[data-cost-day="${day.from}"][data-cost-metric="${key}"]`);});chart.appendChild(button);
          }panel.appendChild(chart);
        }
      }
      section.appendChild(panel);container.appendChild(section);
    }

    _dailyEnergySeries(period, sources, statistics, metadata, role = 'total', expectedCurrency = null) {
      const start = asDate(period.start); const end = asDate(period.end);
      if (!start || !end || end <= start) return [];
      const days = []; let parts = this._partsInZone(start, period.time_zone);
      for (let count = 0; count < 31; count += 1) {
        const bounds = this._zonedDayBounds(parts, period.time_zone);
        const dayStart = new Date(Math.max(start.getTime(), bounds.start.getTime()));
        const dayEnd = new Date(Math.min(end.getTime(), bounds.end.getTime()));
        if (dayEnd <= dayStart) break;
        const summaries = sources.map(source => {
          if (!['ready', 'partial', 'no_data'].includes(source.status)) return { status: source.status, recorded_value: null, coverage: null };
          const buckets = (statistics[source.statistic_id] || []).filter(bucket => numericTime(bucket.start) >= dayStart.getTime() && numericTime(bucket.end) <= dayEnd.getTime());
          return this._summarizeSeries(buckets, metadata[source.statistic_id], { start: dayStart, end: dayEnd }, role, expectedCurrency);
        });
        const measured = summaries.filter(source => typeof source.recorded_value === 'number' && Number.isFinite(source.recorded_value));
        const value = measured.reduce((sum, source) => sum + source.recorded_value, 0);
        const complete = sources.length > 0 && summaries.every(source => source.status === 'ready');
        days.push({ start: dayStart.toISOString(), end: dayEnd.toISOString(), value: complete && Number.isFinite(value) ? value : null, recorded_value: measured.length && Number.isFinite(value) ? value : null, unit: role === 'cost' ? expectedCurrency : 'kWh', status: complete && Number.isFinite(value) ? 'ready' : (measured.length ? 'partial' : 'no_data'), observed_source_hours: summaries.reduce((sum, source) => sum + (source.coverage ? source.coverage.observed_hours : 0), 0), expected_source_hours: sources.length * (dayEnd - dayStart) / 3600000 });
        if (bounds.end >= end) break;
        parts = this._addCalendarDays(parts, 1);
      }
      return days;
    }

    _renderEnergyViews(container) {
      const nav = document.createElement('nav'); nav.dataset.reportNav='energy'; nav.className = 'report-views'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', this._t('Energy report views'));
      for (const [key, label] of [['summary', 'Summary'], ['devices', 'Devices'], ['costs', 'Costs']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'action'; button.textContent = this._t(label); button.dataset.energyView = key; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(this._energyView === key));
        button.addEventListener('click', () => { this._energyView = key; this._renderEnergyState(); this._focusReportControl(this.shadowRoot.querySelector('[data-energy-view][aria-selected="true"]')); });
        nav.appendChild(button);
      }
      container.appendChild(nav);
    }

    _renderComparisonToggle(container) {
      const style = document.createElement('style'); style.textContent = `.comparison-toggle{display:flex;gap:10px;align-items:center;min-height:44px;cursor:pointer;overflow-wrap:anywhere}.comparison-toggle input{flex-shrink:0;width:20px;height:20px;accent-color:var(--sr-primary)}`;
      container.appendChild(style);
      const label = document.createElement('label'); label.className = 'comparison-toggle section';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = this._config.compare_previous_period === true;
      checkbox.dataset.comparePreviousPeriod = '';
      const text = document.createElement('span'); text.textContent = this._t('Compare previous local-calendar period');
      checkbox.addEventListener('change', () => {
        this._config = { ...this._config, compare_previous_period: checkbox.checked };
        this._comparisonSelectedDay = null; this._comparisonDataPage = 0; this._comparisonChartPage = 0;
        this._invalidateEnergyRequest(); this._energyReportConfig = null; this._tariffGuard?.observe(); this._scheduleRefresh(true);
      });
      label.append(checkbox, text); container.appendChild(label);
    }

    _comparisonHint(metric, pair, key) {
      const note = document.createElement('div'); note.className = 'muted comparison-hint';
      if (key === 'sources' || key === 'complete') {
        const evidence = pair.previous?.recorded_total;
        note.textContent = `${this._t('Previous period')}: ${evidence ? `${key === 'sources' ? evidence.sources_with_data : evidence.complete_sources} / ${evidence.configured_sources}` : '—'}`;
      } else {
        const delta = pair.metrics[key];
        note.textContent = `${this._t('Previous period')}: ${this._formatNumber(delta.previous,2)} ${key === 'cost' ? pair.previous?.cost.currency || (pair.previous?.cost_sources.length && pair.previous.cost_sources.every(source => source.unit === delta.unit) ? delta.unit : '') : delta.unit || ''}`;
        const hasDelta = Number.isFinite(delta.delta), hasPercent = Number.isFinite(delta.percent);
        if (hasDelta && delta.delta === 0 && hasPercent && delta.percent === 0) {
          note.textContent += ` · ${this._t('No change')}`;
        } else if (hasDelta) {
          note.textContent += ` · ${this._formatReportChange(delta.delta)} ${delta.unit || ''}`;
          if (hasPercent) note.textContent += ` (${this._formatReportChange(delta.percent)}%)`;
        }
        if (!hasDelta || !hasPercent) note.textContent += ` · ${this._t(delta.reason || pair.reason || 'unavailable')}`;
      }
      metric.appendChild(note);
    }

    _renderComparisonOverview(container, pair) {
      const section=document.createElement('section');section.className='section comparison-overview';
      const style=document.createElement('style');style.textContent=`
        .comparison-hint{font-size:14px;line-height:1.6;overflow-wrap:anywhere;margin-top:6px}
        .comparison-overview{min-width:0;container-type:inline-size;container-name:smart-overview}.comparison-overview p{overflow-wrap:anywhere}
        .comparison-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;margin-top:8px}.comparison-legend span{display:inline-flex;align-items:center;gap:5px}.comparison-legend i{display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--sr-primary)}.comparison-legend .previous i{background:var(--sr-text);opacity:.25}\n        .comparison-days{display:grid;grid-template-columns:repeat(7,minmax(44px,1fr));gap:6px;overflow-x:auto;overscroll-behavior-x:contain;padding:3px;scroll-padding:3px}.comparison-scroll-note{display:none}@container smart-overview (max-width:350px){.comparison-scroll-note{display:block;margin-top:6px}}
        .comparison-mini-day{border:0;background:none;color:var(--sr-text);font:inherit;min-width:0;min-height:44px;padding:4px;cursor:pointer}
        .comparison-mini-bars{height:160px;display:flex;align-items:flex-end;gap:3px;border-bottom:1px solid var(--sr-border)}
        .comparison-mini-bar{flex:1;background:var(--sr-primary);min-height:2px}.comparison-mini-bar.previous{background:var(--sr-text);opacity:.25}.comparison-mini-bar.gap{background:transparent;border:1px dashed var(--sr-border);box-sizing:border-box;min-height:6px}.comparison-mini-bar.partial{background-image:repeating-linear-gradient(45deg,transparent,transparent 3px,var(--sr-card) 3px,var(--sr-card) 5px)}
        .comparison-mini-day small{display:block;font-size:12px;overflow-wrap:anywhere;margin-top:5px}
        .comparison-details>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px}.comparison-details>summary:before{content:'▸'}.comparison-details[open]>summary:before{content:'▾'}
        .comparison-mini-day:focus-visible,.comparison-details>summary:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}`;
      section.appendChild(style);
      if(this._energyView==='summary') {
        const title=document.createElement('h3');title.textContent=this._t('Recorded consumption by day');section.appendChild(title);
        const days=document.createElement('div');days.className='comparison-days';days.setAttribute('role','group');days.setAttribute('aria-label',this._t('Previous period comparison'));
        const shown=pair.daily.slice(0,7),scale=Math.max(0,...shown.flatMap(d=>[d.current.energy.recorded_value,d.previous?.energy.recorded_value]).filter(Number.isFinite));
        for(const day of shown){
          const button=document.createElement('button');button.type='button';button.className='comparison-mini-day';
          const bars=document.createElement('span');bars.className='comparison-mini-bars';bars.setAttribute('aria-hidden','true');const labels=[];
          for(const side of ['previous','current']){
            const metric=day[side]?.energy,value=metric?.recorded_value ?? null,bar=document.createElement('span');bar.className=`comparison-mini-bar ${side} ${value===null?'gap':metric.status==='ready'?'':'partial'}`;
            bar.style.height=`${value===null?100:scale?Math.max(0,value)/scale*100:0}%`;bars.appendChild(bar);
            labels.push(`${this._t(side==='current'?'Current period':'Previous period')}: ${this._formatNumber(value,2)} kWh · ${this._t(metric?.status || 'no_data')}`);
          }
          const date=document.createElement('small');date.textContent=new Intl.DateTimeFormat(languageOf(this._hass),{month:'numeric',day:'numeric',timeZone:pair.current.period.time_zone}).format(new Date(day.current.start));
          const label=`${this._formatPeriodDate(day.current.start,pair.current.period.time_zone)} · ${labels.join(' · ')}`;button.setAttribute('aria-label',label);button.title=label;button.append(bars,date);
          button.addEventListener('click',()=>{this._comparisonSelectedDay=day.current.start;this._comparisonDetailsOpen=true;this._renderEnergyState();this._focusReportControl(this.shadowRoot.querySelector('[data-comparison-view][aria-selected="true"]'));});days.appendChild(button);
        }section.appendChild(days);
        const legend=document.createElement('div');legend.className='comparison-legend';
        for(const [side,label]of [['current','Current period'],['previous','Previous period']]){const item=document.createElement('span');item.className=side;const swatch=document.createElement('i');swatch.setAttribute('aria-hidden','true');item.append(swatch,document.createTextNode(this._t(label)));legend.appendChild(item);}section.appendChild(legend);
        if(pair.daily.length>7){const more=document.createElement('p');more.className='muted';more.textContent=this._t('Comparison details');section.appendChild(more);}
      }
      if(this._energyView==='summary') { const scrollNote=document.createElement('p');scrollNote.className='muted comparison-scroll-note';scrollNote.textContent=this._t('Scroll to see all days');section.appendChild(scrollNote); }
      const detail=document.createElement('details');detail.className='comparison-details';detail.open=this._comparisonDetailsOpen===true;
      const summary=document.createElement('summary');summary.textContent=this._t('Comparison details');summary.dataset.reportControl='comparison-details';detail.appendChild(summary);
      detail.addEventListener('toggle',()=>{if(detail.isConnected)this._comparisonDetailsOpen=detail.open;});
      this._renderPeriodComparison(detail,pair);section.appendChild(detail);container.appendChild(section);
    }

    _renderPeriodComparison(container, pair) {
      const section = document.createElement('section'); section.className = 'comparison section'; section.dataset.comparison = '';
      // Scoped styles keep the existing Smart19 settings and chart CSS intact.
      const style = document.createElement('style'); style.textContent = `
        .comparison{container-type:inline-size;container-name:smart-comparison;border:1px solid var(--sr-border);border-radius:12px;padding:16px;min-width:0}.comparison p,.comparison dd{overflow-wrap:anywhere}.comparison-context{font-size:12px;line-height:1.6}.comparison .summary{grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))}
        .comparison-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}.comparison-day{font:inherit;background:var(--sr-card);color:var(--sr-text);border:1px solid var(--sr-border);border-radius:8px;padding:10px;text-align:left;display:grid;gap:6px;min-width:0;min-height:44px;cursor:pointer}.comparison-day[aria-pressed=true]{outline:2px solid var(--sr-primary);outline-offset:1px}.comparison-day strong,.comparison-day small{overflow-wrap:anywhere}.comparison-day[data-availability=partial]{border-style:dashed}.comparison-day[data-availability=gap]{opacity:.8}
        .comparison-track{height:10px;position:relative;border-radius:4px;background:var(--sr-border);overflow:hidden;display:block}.comparison-track.signed:after{content:'';position:absolute;left:50%;height:100%;border-left:1px solid var(--sr-text)}.comparison-fill{position:absolute;top:0;height:100%;background:var(--sr-primary);max-width:100%}.comparison-day[data-side=previous] .comparison-fill{background:var(--sr-text);opacity:.65}.comparison-day[data-availability=partial] .comparison-fill{background-image:repeating-linear-gradient(45deg,transparent,transparent 4px,var(--sr-card) 4px,var(--sr-card) 6px)}
        .comparison-record{border-bottom:1px solid var(--sr-border);padding:12px 0}.comparison-record dl{display:grid;grid-template-columns:minmax(90px,1fr) minmax(0,3fr);gap:6px}.comparison-record dd{margin:0}.comparison button:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}@container smart-comparison (max-width:500px){.comparison-pair{grid-template-columns:minmax(0,1fr)}.comparison-record dl{grid-template-columns:minmax(0,1fr)}}`;
      section.appendChild(style);
      const heading = document.createElement('h3'); heading.textContent = this._t('Previous period comparison'); section.appendChild(heading);
      for (const [side,snapshot] of [['current',pair.current],['previous',pair.previous]]) {
        const context = document.createElement('p'); context.className = 'muted comparison-context'; context.dataset.comparisonPeriod = side;
        context.textContent = snapshot ? `${this._t(side === 'current' ? 'Current period' : 'Previous period')}: ${this._formatPeriodDate(snapshot.period.start,snapshot.period.time_zone)} → ${this._formatPeriodDate(snapshot.period.end,snapshot.period.time_zone)} · ${snapshot.period.time_zone} · ${this._formatNumber(snapshot.period.actual_hours,2)} h · UTC ${snapshot.period.start} → ${snapshot.period.end} · ${this._t('Missing energy days')}: ${snapshot.coverage.missing_energy_days} · ${this._t('Missing cost days')}: ${snapshot.coverage.missing_cost_days} · ${this._t('source hours')}: ${this._formatNumber(snapshot.coverage.observed_energy_source_hours,2)}/${this._formatNumber(snapshot.coverage.expected_energy_source_hours,2)}`
          : `${this._t('Previous period')}: — · ${this._t(pair.reason || 'unavailable')} · ${JSON.stringify(pair.requested_local_cutoff)}`;
        if (snapshot?.status === 'error') context.textContent = `${this._t('Previous period could not be loaded.')} · ${snapshot.period.start} → ${snapshot.period.end} · ${snapshot.period.time_zone}`;
        section.appendChild(context);
      }
      const scope = document.createElement('p'); scope.className = 'muted comparison-context'; scope.textContent = `${this._t('Source evidence')}: ${pair.scope.map(source => `${this._t(source.role)}: ${source.statistic_id} (${source.unit || '—'})`).join(' · ')}`; section.appendChild(scope);
      const metrics = document.createElement('div'); metrics.className = 'summary';
      for (const [key,label] of [['energy','Change in measured energy'],['cost','Change in energy cost']]) {
        const metric = pair.metrics[key];
        metrics.appendChild(this._metric(label, `${this._formatNumber(metric.delta,2)} ${metric.unit || ''} · ${this._formatNumber(metric.percent,2)}%`));
        const reason = document.createElement('p'); reason.className = 'muted comparison-context'; reason.dataset.comparisonReason = key;
        reason.textContent = `${this._t(label)}: ${this._t(metric.reason || 'ready')} · ${this._t(metric.provenance)}`; metrics.appendChild(reason);
      }
      section.appendChild(metrics);
      const note = document.createElement('p'); note.className = 'muted'; note.textContent = this._t('Recorded values cover available samples only; gaps are not zero.'); section.appendChild(note);
      const nav = document.createElement('nav'); nav.dataset.reportNav='comparison'; nav.className = 'report-views'; nav.setAttribute('role','tablist'); nav.setAttribute('aria-label',this._t('Previous period comparison'));
      const rerender = selector => { this._renderEnergyState(); this._focusReportControl(this.shadowRoot.querySelector(selector)); };
      for (const [key,label] of [['chart','Chart'],['data','Data']]) {
        const button = document.createElement('button'); button.type='button'; button.className='action'; button.dataset.comparisonView=key;
        button.textContent=this._t(label); button.setAttribute('role','tab'); button.setAttribute('aria-selected',String((this._comparisonView || 'chart')===key));
        button.addEventListener('click',()=>{this._comparisonView=key;rerender(`[data-comparison-view="${key}"]`);}); nav.appendChild(button);
      } section.appendChild(nav);
      const panel=document.createElement('div'); panel.setAttribute('role','tabpanel');
      const selected=pair.daily.find(day=>day.current.start===this._comparisonSelectedDay);
      if(!selected)this._comparisonSelectedDay=null;
      if(selected){const detail=document.createElement('p');detail.dataset.comparisonSelectedDay=selected.current.start;
        detail.textContent=`${this._t('Current period')}: ${selected.current.start} → ${selected.current.end} · ${this._t('Previous period')}: ${selected.previous?.start || '—'} → ${selected.previous?.end || '—'}`;panel.appendChild(detail);
        const clear=document.createElement('button');clear.type='button';clear.className='action';clear.dataset.comparisonClear='';clear.textContent=this._t('All hours');
        clear.addEventListener('click',()=>{this._comparisonSelectedDay=null;this._comparisonDataPage=0;rerender('[data-comparison-view][aria-selected="true"]');});panel.appendChild(clear);}
      const paginate=(count,size,property,attribute)=>{
        const pages=Math.max(1,Math.ceil(count/size));this[property]=Math.max(0,Math.min(pages-1,this[property] || 0));
        const controls=document.createElement('nav');controls.className='tariff-pagination';controls.setAttribute('aria-label',this._t(attribute==='comparisonDataPage'?'Hourly records':'Daily overview'));
        const status=document.createElement('span');status.textContent=`${this._t('Page')} ${this[property]+1}/${pages}`;controls.appendChild(status);
        for(const [direction,label,offset] of [['previous','Previous',-1],['next','Next',1]]){const button=document.createElement('button');button.type='button';button.className='action';button.dataset[attribute]=direction;button.textContent=this._t(label);button.disabled=offset<0?this[property]===0:this[property]===pages-1;
          button.addEventListener('click',()=>{this[property]+=offset;rerender(`[data-${attribute==='comparisonDataPage'?'comparison-data-page':'comparison-chart-page'}="${direction}"]:not([disabled]),[data-comparison-view][aria-selected="true"]`);});controls.appendChild(button);}
        panel.appendChild(controls);return this[property]*size;
      };
      if((this._comparisonView || 'chart')==='data'){
        const records=selected?pair.records.filter(record=>record.day_index===selected.index):pair.records;
        const offset=paginate(records.length,50,'_comparisonDataPage','comparisonDataPage');
        for(const record of records.slice(offset,offset+50)){
          const row=document.createElement('article');row.className='comparison-record';row.dataset.comparisonRecord=record.from;row.dataset.comparisonDay=pair.daily[record.day_index]?.current.start || '';row.dataset.side=record.side;
          const title=document.createElement('h4');title.textContent=`${this._t(record.side==='current'?'Current period':'Previous period')} · ${this._formatPeriodDate(record.from,pair.current.period.time_zone)} → ${this._formatPeriodDate(record.to,pair.current.period.time_zone)}`;row.appendChild(title);
          const dl=document.createElement('dl');const priced=record.role==='priced_energy';
          const fields = [['Sources',(record.source_statistic_ids || []).join(', ')],['Role',this._t(record.role)],['Recorded value',`${this._formatNumber(priced?record.energyCost:record.recorded_value,2)} ${priced?record.currency:record.unit || ''}`],['Status',this._t(record.reason || record.status || (record.available?'ready':'partial'))],['Daily allocation',this._t(record.day_allocation_reason || 'Whole reading in this day')],['source hours',record.coverage?`${record.coverage.observed_hours}/${record.coverage.expected_hours}`:priced?`${record.available?1:0}/1`:'—'],['UTC interval',`${record.from} → ${record.to}`]];
          if(priced)fields.push(['Measured energy',`${this._formatNumber(record.kwh,2)} kWh`],['Energy / kWh',`${this._formatNumber(record.energyRate,4)} ${record.currency || '—'}/kWh`],['Zone',(record.zones || []).join(', ') || '—'],['Revision',String(record.revision ?? '—')]);
          for(const [label,value] of fields){const dt=document.createElement('dt');dt.textContent=this._t(label);const dd=document.createElement('dd');dd.textContent=value;dl.append(dt,dd);}row.appendChild(dl);panel.appendChild(row);
        }
      }else{
        const offset=paginate(pair.daily.length,7,'_comparisonChartPage','comparisonChartPage');
        for(const [key,label] of [['energy','Measured energy'],['cost','Priced energy']]){
          const chart=document.createElement('section');chart.className='comparison-chart';const unit=key==='energy'?'kWh':pair.current.cost.currency || pair.previous?.cost.currency || '—';
          chart.setAttribute('aria-label',`${this._t(label)} (${unit})`);const axis=document.createElement('h4');axis.textContent=`${this._t(label)} · ${unit}`;chart.appendChild(axis);
          const values=pair.daily.flatMap(day=>[day.current[key].recorded_value,day.previous?.[key].recorded_value]).filter(value=>typeof value==='number'&&Number.isFinite(value));
          const scale=values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);const signed=values.some(value=>value<0);
          for(const day of pair.daily.slice(offset,offset+7)){
            const group=document.createElement('div');group.className='comparison-pair';
            for(const side of ['current','previous']){
              const snapshot=day[side],metric=snapshot?.[key],value=metric?.recorded_value ?? null;
              const button=document.createElement('button');button.type='button';button.className='comparison-day';button.dataset.comparisonDay=day.current.start;button.dataset.comparisonMetric=key;button.dataset.side=side;
              button.dataset.availability=value===null?'gap':metric.status==='ready'?'ready':'partial';button.setAttribute('aria-pressed',String(selected?.index===day.index));
              const date=document.createElement('span');date.textContent=`${this._t(side==='current'?'Current period':'Previous period')} · ${snapshot?this._formatPeriodDate(snapshot.start,pair.current.period.time_zone):'—'}`;
              const amount=document.createElement('strong');amount.textContent=`${this._formatNumber(value,2)} ${metric?.unit || unit}`;
              const status=document.createElement('small');status.textContent=`${this._t(metric?.status || 'no_data')} · ${this._formatNumber(metric?.observed_source_hours,2)}/${this._formatNumber(metric?.expected_source_hours,2)} ${this._t('source hours')}`;
              const track=document.createElement('span');track.className=`comparison-track${signed?' signed':''}`;track.setAttribute('aria-hidden','true');
              if(typeof value==='number'&&Number.isFinite(value)){const fill=document.createElement('span');fill.className='comparison-fill';const width=scale?Math.min(signed?50:100,Math.abs(value)/scale*(signed?50:100)):0;fill.style.width=`${width}%`;fill.style.left=`${signed?(value<0?50-width:50):0}%`;track.appendChild(fill);}
              button.title=snapshot?`${snapshot.start} → ${snapshot.end}`:this._t(pair.reason || 'unavailable');button.append(date,amount,status,track);
              button.addEventListener('click',()=>{this._comparisonSelectedDay=day.current.start;this._comparisonDataPage=0;rerender(`[data-comparison-day="${day.current.start}"][data-comparison-metric="${key}"][data-side="${side}"]`);});group.appendChild(button);
            }chart.appendChild(group);
          }panel.appendChild(chart);
        }
      }section.appendChild(panel);container.appendChild(section);
    }

    _filteredDevices(devices) {
      const query = String(this._deviceQuery || '').trim().toLocaleLowerCase();
      return query ? devices.filter(row => [row.label, row.statistic_id].some(value => String(value || '').toLocaleLowerCase().includes(query))) : devices;
    }

    _renderDeviceSearch(container, devices) {
      const controls = document.createElement('div'); controls.className = 'device-search-form';
      const label = document.createElement('label'); label.textContent = this._t('Search devices or sources');
      const input = document.createElement('input'); input.type = 'search'; input.className = 'device-search'; input.maxLength = 256;
      input.value = this._deviceQuery || ''; input.placeholder = this._t('Name or entity/statistic ID');
      input.addEventListener('input', () => { this._deviceQuery = input.value.slice(0,256); this._renderEnergyState(); });
      input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); this._deviceQuery = ''; this._renderEnergyState(); } });
      label.appendChild(input);
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'action device-search-clear'; clear.textContent = this._t('Clear search');
      clear.addEventListener('click', () => { this._deviceQuery = ''; this._renderEnergyState(); this.shadowRoot.querySelector('.device-search')?.focus(); });
      controls.append(label,clear); container.appendChild(controls);
      const count = document.createElement('p'); count.className = 'muted device-search-count'; count.setAttribute('role','status'); count.setAttribute('aria-live','polite');
      count.textContent = `${this._t('Shown devices')}: ${this._filteredDevices(devices).length} / ${devices.length}`; container.appendChild(count);
    }

    _coverageText(source) {
      const coverage = source.coverage;
      const hours = value => this._formatNumber(value, Number.isInteger(value) ? 0 : 2);
      return coverage ? `${hours(coverage.observed_hours)} / ${hours(coverage.expected_hours)} h · ${this._t(source.status)}` : this._t(source.status || 'no_data');
    }

    _barChart(rows, label, unit, {scaleRows = rows, deviceContext = null} = {}) {
      const chart = document.createElement('section'); chart.className = 'bar-chart section'; chart.setAttribute('aria-label', this._t(label));
      const finite = row => typeof row.recorded_value === 'number' && Number.isFinite(row.recorded_value) ? row.recorded_value : (row.status === 'ready' && typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null);
      const maximum = Math.max(0, ...scaleRows.map(row => finite(row) || 0));
      for (const source of rows) {
        const row = document.createElement('div'); row.className = `chart-row${source.depth > 0 ? ' child' : ''}`;
        if (deviceContext) row.dataset.deviceStatistic = source.statistic_id;
        const name = document.createElement('span'); name.className = 'row-name'; name.textContent = source.label || source.statistic_id;
        const measured = finite(source); const value = document.createElement('span'); value.textContent = `${this._formatNumber(measured, unit ? 2 : 0)}${unit ? ` ${unit}` : ''}`;
        const track = document.createElement('div'); track.className = 'bar-track';
        const bar = document.createElement('div'); bar.className = 'bar-fill'; bar.style.width = `${maximum > 0 && measured !== null ? Math.max(0, Math.min(100, measured / maximum * 100)) : 0}%`;
        if (measured !== null) { track.setAttribute('role', 'meter'); track.setAttribute('aria-label', name.textContent); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', String(Math.max(maximum, measured))); track.setAttribute('aria-valuenow', String(measured)); track.setAttribute('aria-valuetext', `${value.textContent} · ${this._coverageText(source)}`); }
        track.appendChild(bar); row.append(name, value, track);
        if (unit) { const coverage = document.createElement('small'); coverage.className = source.status === 'ready' ? 'muted' : 'warning'; coverage.textContent = this._coverageText(source); row.appendChild(coverage); }
        if (deviceContext && source.included_in_stat) {
          const parent = deviceContext.get(source.included_in_stat);
          const context = document.createElement('small'); context.className = 'muted';
          context.textContent = `${this._t('Parent device')}: ${parent?.label || source.included_in_stat}${parent?.label && parent.label !== source.included_in_stat ? ` (${source.included_in_stat})` : ''}`;
          row.appendChild(context);
        }
        chart.appendChild(row);
      }
      return chart;
    }

    _renderDailyChart(container, state) {
      const days = state.daily || [];
      if (!days.length) return;
      const zone = state.period.time_zone;
      const windowKey = JSON.stringify([state.period.start, state.period.end, zone]);
      if (this._dailyWindow !== windowKey) {
        this._dailyWindow = windowKey;
        this._dailySelectedDay = null;
        this._dailyPage = 0;
      }
      const selected = days.find(day => day.start === this._dailySelectedDay);
      if (!selected) this._dailySelectedDay = null;
      const view = this._dailyView || 'chart';
      const pages = Math.max(1, Math.ceil(days.length / 7));
      this._dailyPage = Math.max(0, Math.min(pages - 1, this._dailyPage || 0));
      const section = document.createElement('section'); section.className = 'daily-history section';
      section.setAttribute('aria-label', this._t('Recorded consumption by day'));
      const heading = document.createElement('h3'); heading.textContent = this._t('Recorded consumption by day'); section.appendChild(heading);
      const note = document.createElement('p'); note.className = 'muted';
      note.textContent = `${this._t('Select a day for its interval and measurement coverage.')} ${this._t('Striped days have incomplete history; empty days are not measured zero.')}`; section.appendChild(note);
      const rerender = selector => {
        this._renderEnergyState();
        const target = this.shadowRoot.querySelector(selector);
        this._focusReportControl(target && !target.disabled ? target : this.shadowRoot.querySelector('[data-daily-view][aria-selected="true"]'));
      };
      const views = document.createElement('div'); views.className = 'report-views'; views.dataset.reportNav = 'daily';
      views.setAttribute('role', 'tablist'); views.setAttribute('aria-label', this._t('Daily consumption views'));
      for (const [key, label] of [['chart', 'Chart'], ['data', 'Data']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'action'; button.dataset.dailyView = key;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(view === key)); button.textContent = this._t(label);
        button.addEventListener('click', () => { this._dailyView = key; rerender(`[data-daily-view="${key}"]`); }); views.appendChild(button);
      }
      section.appendChild(views);
      const panel = document.createElement('div'); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-label', this._t(view === 'chart' ? 'Chart' : 'Data'));
      const list = document.createElement('div'); list.className = 'daily-list';
      const maximum = Math.max(0, ...days.map(day => day.recorded_value || 0));
      const energy = day => `${this._formatNumber(day.recorded_value, 2)} ${day.unit}`;
      const coverage = day => `${this._t(day.status === 'ready' ? 'Complete history' : day.status === 'partial' ? 'Partial history' : 'No measurements')} · ${this._formatNumber(day.observed_source_hours, Number.isInteger(day.observed_source_hours) ? 0 : 2)} / ${this._formatNumber(day.expected_source_hours, Number.isInteger(day.expected_source_hours) ? 0 : 2)} ${this._t('source hours')}`;
      for (const day of days.slice(this._dailyPage * 7, (this._dailyPage + 1) * 7)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'action daily-day';
        button.dataset.dailyDay = day.start; button.dataset.availability = day.status; button.setAttribute('aria-pressed', String(day === selected));
        const date = document.createElement('span'); date.className = 'daily-label';
        date.textContent = new Intl.DateTimeFormat(languageOf(this._hass), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }).format(new Date(day.start));
        const value = document.createElement('strong'); value.className = 'daily-value'; value.textContent = energy(day);
        const status = document.createElement('span'); status.className = 'daily-coverage'; status.textContent = coverage(day);
        button.append(date, value, status);
        if (view === 'chart') {
          const track = document.createElement('span'); track.className = 'daily-track'; track.setAttribute('aria-hidden', 'true');
          const fill = document.createElement('span'); fill.className = 'bar-fill';
          fill.style.width = `${maximum > 0 && day.recorded_value != null ? Math.max(0, Math.min(100, day.recorded_value / maximum * 100)) : 0}%`;
          track.appendChild(fill); button.appendChild(track);
        }
        button.addEventListener('click', () => { this._dailySelectedDay = day.start; rerender(`[data-daily-day="${day.start}"]`); });
        list.appendChild(button);
      }
      panel.appendChild(list);
      const nav = document.createElement('nav'); nav.className = 'tariff-pagination'; nav.setAttribute('aria-label', this._t('Daily overview'));
      const page = document.createElement('span'); page.textContent = `${this._t('Page')} ${this._dailyPage + 1}/${pages}`; nav.appendChild(page);
      for (const [key, label, offset] of [['previous', 'Previous', -1], ['next', 'Next', 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'action'; button.dataset.dailyPage = key; button.textContent = this._t(label);
        button.disabled = this._dailyPage + offset < 0 || this._dailyPage + offset >= pages;
        button.addEventListener('click', () => { this._dailyPage += offset; rerender(`[data-daily-page="${key}"]`); }); nav.appendChild(button);
      }
      panel.appendChild(nav);
      if (selected) {
        const detail = document.createElement('section'); detail.className = 'daily-detail'; detail.dataset.dailyDetail = selected.start; detail.setAttribute('role', 'status');
        const title = document.createElement('h4'); title.textContent = this._t('Day details'); detail.appendChild(title);
        for (const text of [
          `${this._formatPeriodDate(selected.start, zone)} – ${this._formatPeriodDate(selected.end, zone)} · ${zone}`,
          `${energy(selected)} · ${coverage(selected)}`,
          `${this._t('UTC interval')}: ${selected.start} → ${selected.end}`,
        ]) { const line = document.createElement('p'); line.textContent = text; detail.appendChild(line); }
        const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'action'; clear.dataset.dailyClear = ''; clear.textContent = this._t('Clear day selection');
        clear.addEventListener('click', () => { this._dailySelectedDay = null; rerender(`[data-daily-day="${selected.start}"]`); }); detail.appendChild(clear);
        const selectedButton = Array.from(list.querySelectorAll('[data-daily-day]')).find(button => button.dataset.dailyDay === selected.start);
        if (selectedButton) selectedButton.after(detail); else panel.appendChild(detail);
      }
      section.appendChild(panel); container.appendChild(section);
    }

    _renderCostCoverage(container, state) {
      const section = document.createElement('section'); section.className = 'cost-coverage section';
      const heading = document.createElement('h3'); heading.textContent = this._t('Cost history'); section.appendChild(heading);
      const note = document.createElement('p'); note.className = 'muted'; note.textContent = state.cost && state.cost.method === 'flat_rate_estimate' ? `${this._t('Explicit flat-rate estimate')}: ${this._formatNumber(state.cost.rate, 4)} ${state.cost.currency}/kWh` : this._t('Cost samples have their own history; the current tariff is not applied to past energy.'); section.appendChild(note);
      for (const source of state.cost_sources || []) {
        const row = document.createElement('p'); row.className = 'cost-source';
        const value = source.recorded_value == null ? source.value : source.recorded_value;
        row.textContent = `${source.label || source.statistic_id}: ${this._formatNumber(value, 2)} ${source.unit || ''} · ${this._coverageText(source)}`;
        if (source.coverage && source.coverage.first_sample) row.textContent += ` · ${this._formatPeriodDate(source.coverage.first_sample, state.period.time_zone)} – ${this._formatPeriodDate(source.coverage.last_sample, state.period.time_zone)}`;
        section.appendChild(row);
      }
      if (!(state.cost_sources || []).length && (!state.cost || state.cost.method !== 'flat_rate_estimate')) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = this._t('No recorded cost source is configured.'); section.appendChild(empty); }
      container.appendChild(section);
    }


    _recordedSubtotal(sources, unit) {
      const measured = sources.filter(source => source.unit === unit && typeof source.recorded_value === 'number' && Number.isFinite(source.recorded_value));
      const value = measured.reduce((sum, source) => sum + source.recorded_value, 0);
      return { value: measured.length > 0 && Number.isFinite(value) ? value : null, unit: unit || null, status: sources.length === 0 ? 'no_data' : (sources.every(source => source.status === 'ready') ? 'ready' : 'partial'), sources_with_data: measured.length, complete_sources: sources.filter(source => source.status === 'ready').length, configured_sources: sources.length, source_statistic_ids: measured.map(source => source.statistic_id) };
    }

    _setEnergyViewState(state) {
      const association = this._observeReviewedExportSource();
      const sameSource = this._exportSourceAssociation === association;
      this._exportSourceAssociation = association;
      if (JSON.stringify(state) === JSON.stringify(this._energyViewState)) {
        if (!sameSource) this._invalidateReviewedExport();
        return; // Identical measurements preserve the live DOM and focus.
      }
      this._energyViewState = state;
      this._invalidateReviewedExport();
      if (this._scaffoldRendered && this._activeTab === 'energy') this._renderEnergyState();
    }

    _stateBlock(title, detail, className, role, result = className || 'not_checked') {
      const block = document.createElement('section'); block.className = `state ${className || ''}`.trim(); if (role) block.setAttribute('role', role);
      const badge = document.createElement('div');
      badge.innerHTML = createUiV3({ language: languageOf(this._hass) }).statusHtml(result);
      block.appendChild(badge);
      const heading = document.createElement('h3'); heading.textContent = this._t(title); block.appendChild(heading);
      if (detail) { const paragraph = document.createElement('p'); paragraph.className = 'muted'; paragraph.textContent = this._t(detail); block.appendChild(paragraph); }
      return block;
    }

    _renderAnalysisEntry(container) {
      const nav=document.createElement('nav');nav.setAttribute('aria-label',String(languageOf(this._hass)).startsWith('pl')?'Źródło raportu':'Report source');nav.className='toolbar-actions';
      const pl=String(languageOf(this._hass)).startsWith('pl');
      for(const [key,label]of [['recorded',pl?'Wybrane statystyki':'Selected statistics'],['calendar',pl?'Kalendarz · Energia HA':'Calendar · HA Energy']]) {
        const b=document.createElement('button');b.type='button';b.className='action';b.dataset.smartAnalysis=key;b.textContent=label;b.setAttribute('aria-pressed',String(this._analysisMode===key));
        b.addEventListener('click',()=>{if(this._analysisMode===key)return;this._invalidateEnergyRequest();this._calendarHost?.stop();this._analysisMode=key;this._syncTabs();if(key==='recorded')this._scheduleRefresh(true);});nav.append(b);
      }container.append(nav);
    }

    _renderEnergyState() {
      this._tariffGuard?.observe();
      if (!this._scaffoldRendered) return;
      const container = this.shadowRoot.getElementById('content'); const state = this._energyViewState || { status: 'idle' };
      if(this._analysisMode==='calendar') {
        container.replaceChildren();this._renderAnalysisEntry(container);
        const note=document.createElement('p');note.className='muted';note.textContent=String(languageOf(this._hass)).startsWith('pl')?'Źródła: konfiguracja Energia HA. Dostęp i obliczenia potwierdza HA Tools Email. Wybrane ręcznie statystyki należą do osobnego raportu.':'Sources: HA Energy configuration. HA Tools Email authorizes access and calculates this report. Manually selected statistics belong to the separate report.';container.append(note);
        const mount=document.createElement('section');mount.dataset.smartCalendar='';container.append(mount);
        this._calendarHost ||= createSmartAnalysisHostV53({card:this});this._calendarHost.mount(mount);return;
      }
      const exportable = ['ready', 'partial', 'no_data'].includes(state.status);
      const focused = this.shadowRoot.activeElement;
      const remembered = this._rememberReportFocus(focused);
      const focus = remembered || (focused === this._pendingReportFocus?.anchor ? this._pendingReportFocus.snapshot : null);
      this._pendingReportFocus = null;
      try {
      const tariffMarkup = this._config.energy_cost_mode === 'configured_tariff' ? this._tariffController().markup() : null;
      this.shadowRoot.getElementById('exportJsonBtn').disabled = !exportable; this.shadowRoot.getElementById('exportCsvBtn').disabled = !exportable; container.replaceChildren();
      this._renderAnalysisEntry(container);
      this._renderTariffSettings(container, tariffMarkup);
      this._renderComparisonToggle(container);
      if (state.status === 'loading' || state.status === 'idle') { container.appendChild(this._stateBlock('Loading recorder statistics…', 'This report uses recorded changes for the selected local-calendar period.', '', 'status')); return; }
      if (state.status === 'not_configured') {
        const block = this._stateBlock('Configure Energy Dashboard or select explicit statistics.', 'Smart Reports does not discover sensors by substring and does not use live entity states.', '', 'status');
        for (const warningText of state.warnings || []) { const warning = document.createElement('p'); warning.className = 'warning'; warning.textContent = this._warningText(warningText); block.appendChild(warning); }
        const link = document.createElement('a'); link.className = 'fixed-link'; link.href = '/config/energy'; link.textContent = this._t('Open Energy configuration'); block.appendChild(link); container.appendChild(block); return;
      }
      if (state.status === 'unsupported') { container.appendChild(this._stateBlock('Recorder statistics are unavailable on this Home Assistant instance.', 'Check recorder support and the selected statistic metadata.', 'error', 'alert')); return; }
      if (state.status === 'permission_denied') { container.appendChild(this._stateBlock('Your account cannot read the selected statistics.', 'Use an account with recorder statistics access.', 'error', 'alert')); return; }
      if (state.status === 'error') {
        const block = this._stateBlock('Couldn’t load energy statistics.', 'The previous period is not shown as current data.', 'error', 'alert');
        const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = this._t('Technical details'); const code = document.createElement('code'); code.textContent = state.code == null ? 'unknown_error' : String(state.code); details.append(summary, code); block.appendChild(details);
        const retry = document.createElement('button'); retry.type = 'button'; retry.dataset.reportControl = 'retry'; retry.className = 'action'; retry.textContent = this._t('Retry'); retry.addEventListener('click', () => this._scheduleRefresh(true), { once: true }); block.appendChild(retry); container.appendChild(block); return;
      }
      if (!['ready', 'partial', 'no_data'].includes(state.status)) return;
      const period = state.period || {}; const context = document.createElement('p'); context.className = 'muted report-context';
      const timeZone = period.time_zone || this._timeZone();
      const periodLabel = this._t(period.key === '1d' ? 'Today' : (period.key === '30d' ? '30 days' : (period.key === '7d' ? '7 days' : (period.key || '—'))));
      const sources = state.total_sources || [], complete = sources.filter(source => source.status === 'ready').length;
      const start = asDate(period.start), end = asDate(period.end);
      let range = '—';
      if (start && end && end >= start) {
        const dates = new Intl.DateTimeFormat(languageOf(this._hass), { dateStyle: 'medium', timeZone });
        // Recorder windows end exclusively; midnight is not another measured day.
        range = dates.formatRange(start, end > start ? new Date(end.getTime() - 1) : end);
      }
      context.textContent = `${range} · ${periodLabel} · ${complete}/${sources.length} ${this._t(sources.length === 1 ? 'source complete' : 'sources complete')}`;
      context.dataset.periodStart = period.start || '';
      context.dataset.periodEnd = period.end || '';
      context.title = `${this._t('Exact recorder window')}: ${period.start || '—'} → ${period.end || '—'}`;
      container.appendChild(context);
      const periodDetails = document.createElement('details'); periodDetails.className = 'report-context-details';
      periodDetails.open = this._reportContextDetailsOpen === true;
      const periodSummary = document.createElement('summary'); periodSummary.textContent = this._t('Details'); periodSummary.dataset.reportControl = 'period-details';
      periodDetails.appendChild(periodSummary);
      const exact = document.createElement('p');
      exact.textContent = `${this._t('Period')}: ${periodLabel} · ${this._formatPeriodDate(period.start, timeZone)} – ${this._formatPeriodDate(period.end, timeZone)} · ${this._t('Time zone')}: ${timeZone} · ${this._t('Sources')}: ${sources.length} ${this._t('total')}, ${(state.cost_sources || []).length} ${this._t('cost')}`;
      const exactWindow = document.createElement('p'); exactWindow.textContent = context.title;
      periodDetails.append(exact, exactWindow);
      periodDetails.addEventListener('toggle', () => { if (periodDetails.isConnected) this._reportContextDetailsOpen = periodDetails.open; });
      container.appendChild(periodDetails);
      if (state.status === 'no_data') {
        if(state.comparison)this._renderComparisonOverview(container,state.comparison);
        container.appendChild(this._stateBlock('No recorded energy change in this period.', 'Measured zero is rendered separately; this state means no recorder samples were available.', '', 'status', 'no_data'));
        this._renderDailyChart(container, state);
        if (period.start === period.end) { const note = document.createElement('p'); note.className = 'muted section'; note.textContent = this._t('Today starts reporting after its first completed hour.'); container.appendChild(note); }
        return;
      }
      this._renderEnergyViews(container);
      const reportDetails = this._energyView === 'devices' ? document.createElement('details') : null;
      const reportTarget = reportDetails || container;
      if (reportDetails) {
        reportDetails.className = 'section device-report-details'; reportDetails.open = this._deviceReportOpen === true;
        const toggle = document.createElement('summary'); toggle.dataset.reportControl = 'device-report';
        toggle.textContent = this._t(state.comparison ? 'Report totals and comparison' : 'Report totals');
        reportDetails.addEventListener('toggle', () => { this._deviceReportOpen = reportDetails.open; });
        reportDetails.appendChild(toggle);
      }
      if (state.status === 'partial') reportTarget.appendChild(this._stateBlock('Partial history — recorded values only.', 'At least one required statistic was missing, invalid, incomplete, or used an incompatible currency.', 'partial', 'status'));
      const summary = document.createElement('section'); summary.className = 'summary';
      const recordedTotal = state.recorded_total || {};
      const recordedCost = state.cost?.method === 'configured_tariff' ? {} : state.recorded_cost || {};
      summary.appendChild(this._metric(state.status === 'partial' ? 'Recorded consumption' : 'Grid import', `${this._formatNumber(state.status === 'partial' ? recordedTotal.value : state.total.value, 2)} ${state.total.unit || 'kWh'}`));
      const costLabel = state.cost && state.cost.method === 'configured_tariff' ? 'Configured tariff energy cost' : state.cost && state.cost.method === 'cost_statistics' ? 'Actual cost' : (state.cost && state.cost.method === 'flat_rate_estimate' ? 'Estimated cost' : 'Cost unavailable');
      const costValue = state.cost && typeof state.cost.value === 'number' ? `${this._formatNumber(state.cost.value, 2)} ${state.cost.currency || ''}`.trim() : '—';
      summary.appendChild(this._metric(state.cost && state.cost.value == null && recordedCost.value != null ? 'Recorded cost' : costLabel, state.cost && state.cost.value == null && recordedCost.value != null ? `${this._formatNumber(recordedCost.value, 2)} ${recordedCost.unit || ''}` : costValue));
      summary.appendChild(this._metric('Sources with data', `${recordedTotal.sources_with_data || 0} / ${(state.total_sources || []).length}`));
      summary.appendChild(this._metric('Complete sources', `${recordedTotal.complete_sources || 0} / ${(state.total_sources || []).length}`));
      if(state.comparison){
        [...summary.children].forEach((metric,index)=>this._comparisonHint(metric,state.comparison,['energy','cost','sources','complete'][index]));
      }
      reportTarget.appendChild(summary);
      if (state.status === 'partial' || recordedCost.status === 'partial') { const note = document.createElement('p'); note.className = 'muted section'; note.textContent = this._t('Recorded values cover available samples only; gaps are not zero.'); reportTarget.appendChild(note); }
      const reportBody = this._energyView === 'summary' ? document.createElement('div') : null;
      if (reportBody) { reportBody.className = 'report-body'; container.appendChild(reportBody); }
      if(state.comparison)this._renderComparisonOverview(reportBody || reportTarget,state.comparison);
      if (this._energyView === 'summary' && !state.comparison) this._renderDailyChart(reportBody, state);
      if (this._energyView !== 'costs') {
        const devices = state.devices || [];
        if (this._energyView === 'devices') this._renderDeviceSearch(container, devices);
        const deviceSection = document.createElement('section'); deviceSection.className = 'section device-breakdown';
        const heading = document.createElement('h3'); heading.textContent = this._t(state.top_ranking_available === false ? 'Device breakdown unavailable' : (state.device_data_status === 'partial' ? 'Reported devices — partial' : 'Device breakdown')); deviceSection.appendChild(heading);
        const shown = this._energyView === 'devices' ? this._filteredDevices(devices) : devices.slice(0, 6);
        if (shown.length) {
          deviceSection.appendChild(this._barChart(shown, 'Recorded energy by device', 'kWh', {scaleRows:this._energyView === 'devices' ? devices : shown,deviceContext:new Map(devices.map(row=>[row.statistic_id,row]))}));
          const note = document.createElement('p'); note.className = 'muted'; note.textContent = this._t('Device values have their own coverage; nested devices are included in their parent.'); deviceSection.appendChild(note);
          if (this._energyView === 'summary' && devices.length > 6) { const all = document.createElement('button'); all.type = 'button'; all.dataset.reportControl = 'all-devices'; all.className = 'action section'; all.textContent = this._t('See all devices'); all.addEventListener('click', () => { this._energyView = 'devices'; this._renderEnergyState(); }); deviceSection.appendChild(all); }
        } else { const empty = document.createElement('p'); empty.className = 'muted section'; empty.textContent = this._t(devices.length ? 'No matching devices' : 'No device statistics are configured.'); deviceSection.appendChild(empty); }
        (reportBody || container).appendChild(deviceSection);
      }
      if (reportDetails) {
        const total = document.createElement('p'); total.className = 'muted section device-total-note';
        total.textContent = `${this._t(state.status === 'partial' ? 'Recorded consumption (not filtered)' : 'Report total (not filtered)')}: ${this._formatNumber(state.status === 'partial' ? recordedTotal.value : state.total.value,2)} ${state.total.unit || 'kWh'}`;
        container.appendChild(total);
        const note = document.createElement('p'); note.className = 'muted device-export-note';
        note.textContent = this._t('Export includes all devices and sources in this report, including those hidden by search.');
        container.append(note, reportDetails);
      }
      if (this._energyView !== 'devices') {
        if (state.cost?.method === 'configured_tariff') this._renderTariffEvidence(reportBody || container,state.cost);
        else this._renderCostCoverage(reportBody || container, state);
      }
      const evidence = document.createElement('details'); evidence.className = 'section source-evidence';
      const evidenceHeading = document.createElement('summary'); evidenceHeading.dataset.reportControl = 'source-evidence'; evidenceHeading.textContent = this._t('Source evidence'); evidence.appendChild(evidenceHeading);
      const evidenceList = document.createElement('div'); evidenceList.className = 'list';
      const evidenceSources = [...(state.total_sources || []), ...(state.cost_sources || [])];
      if (this._energyView === 'devices' && String(this._deviceQuery || '').trim()) evidence.open = true;
      for (const source of (this._energyView === 'devices' ? this._filteredDevices(evidenceSources) : evidenceSources)) {
        const row = document.createElement('div'); row.className = 'row'; row.dataset.energySource = source.statistic_id;
        const name = document.createElement('span'); name.className = 'row-name'; const sourceLabel = source.label || source.statistic_id; name.textContent = sourceLabel === source.statistic_id ? source.statistic_id : `${sourceLabel} (${source.statistic_id})`;
        const detail = document.createElement('span'); detail.className = source.status === 'ready' ? 'status-ready' : 'warning'; detail.textContent = source.reason ? `${this._t(source.status)}: ${this._t(source.reason)}` : this._t(source.status);
        row.append(name, detail); evidenceList.appendChild(row);
      }
      for (const warningText of state.warnings || []) { const warning = document.createElement('p'); warning.className = 'warning'; warning.textContent = this._warningText(warningText); evidenceList.appendChild(warning); }
      evidence.appendChild(evidenceList); container.appendChild(evidence);
      } finally {
        this._syncNavigation();
        if (focus) this._restoreReportFocus(focus, state.status);
      }
    }

    _metric(labelText, valueText) {
      const metric = document.createElement('div'); metric.className = 'metric'; const label = document.createElement('div'); label.className = 'metric-label'; label.textContent = this._t(labelText); const value = document.createElement('div'); value.className = 'metric-value'; value.textContent = valueText; metric.append(label, value); return metric;
    }

    _formatReportChange(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      const magnitude = Math.abs(value), places = magnitude > 0 && magnitude < 0.01 ? 6 : 2;
      const format = new Intl.NumberFormat(languageOf(this._hass), { minimumFractionDigits: 0, maximumFractionDigits: places });
      const shown = format.format(magnitude);
      // As in Energy's briefNumber, a nonzero value never becomes a zero label.
      if (magnitude > 0 && shown === format.format(0)) {
        const threshold = format.format(10 ** -places);
        return value < 0 ? `>−${threshold}` : `<${threshold}`;
      }
      return (value < 0 ? '−' : value > 0 ? '+' : '') + shown;
    }

    _formatNumber(value, digits) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      try { return new Intl.NumberFormat(languageOf(this._hass), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); } catch (_error) { return value.toFixed(digits); }
    }

    _formatPeriodDate(value, timeZone) {
      const date = asDate(value);
      if (!date) return '—';
      const language = languageOf(this._hass);
      try { return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date); } catch (_error) { return date.toISOString().slice(0, 10); }
    }

    _timeAgo(value) {
      if (value == null) return this._t('Never');
      const date = asDate(value);
      if (!date) return this._t('Never');
      const now = asDate(this._now()) || new Date();
      const difference = Math.max(0, now.getTime() - date.getTime());
      if (difference < 60000) return this._t('now');
      if (difference < 3600000) return `${Math.floor(difference / 60000)}m`;
      if (difference < 86400000) return `${Math.floor(difference / 3600000)}h`;
      return `${Math.floor(difference / 86400000)}${this._t('day_suffix')}`;
    }

    _renderAutomations() {
      if (!this._scaffoldRendered || this._activeTab !== 'automations') return;
      const container = this.shadowRoot.getElementById('content'); container.replaceChildren(); const states = this._hass && this._hass.states ? this._hass.states : {};
      const automations = Object.entries(states).filter(([entityId]) => entityId.startsWith('automation.')).map(([entityId, state]) => ({ entity_id: entityId, label: state && state.attributes && state.attributes.friendly_name ? String(state.attributes.friendly_name) : entityId, state: state && state.state != null ? String(state.state) : 'unknown', last_triggered: state && state.attributes ? state.attributes.last_triggered : null })).sort((left, right) => {
        const leftTime = asDate(left.last_triggered); const rightTime = asDate(right.last_triggered);
        if (leftTime && rightTime) return rightTime - leftTime;
        if (leftTime) return -1;
        if (rightTime) return 1;
        return left.label.localeCompare(right.label);
      });
      const now = asDate(this._now()) || new Date();
      const timeZone = this._timeZone();
      const todayStart = this._zonedDayBounds(this._partsInZone(now, timeZone), timeZone).start;
      const active = automations.filter((automation) => automation.state === 'on').length;
      const disabled = automations.filter((automation) => automation.state === 'off').length;
      const triggeredToday = automations.filter((automation) => {
        const triggered = asDate(automation.last_triggered);
        return triggered && triggered >= todayStart && triggered <= now;
      }).length;
      const summary = document.createElement('div'); summary.className = 'summary'; summary.append(this._metric('Total automations', String(automations.length)), this._metric('Active', String(active)), this._metric('Disabled', String(disabled)), this._metric('Triggered today', String(triggeredToday))); container.appendChild(summary);
      const heading = document.createElement('h3'); heading.className = 'section'; heading.textContent = this._t('Recent activity'); container.appendChild(heading); const list = document.createElement('div'); list.className = 'list';
      for (const automation of automations.slice(0, 10)) { const row = document.createElement('div'); row.className = 'row'; const name = document.createElement('span'); name.className = 'row-name'; name.textContent = automation.label; const status = document.createElement('span'); status.textContent = `${this._timeAgo(automation.last_triggered)} · ${this._t(automation.state)}`; row.append(name, status); list.appendChild(row); }
      if (automations.length === 0) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = this._t('No automation entities are available.'); list.appendChild(empty); }
      container.appendChild(list);
    }

    _renderSystem() {
      if (!this._scaffoldRendered || this._activeTab !== 'system') return;
      const container = this.shadowRoot.getElementById('content'); container.replaceChildren(); const states = this._hass && this._hass.states ? this._hass.states : {}; const entries = Object.entries(states);
      const unavailable = entries.filter(([, state]) => state && state.state === 'unavailable').length; const unknown = entries.filter(([, state]) => state && state.state === 'unknown').length; const domains = new Map();
      for (const [entityId] of entries) { const domain = entityId.split('.')[0]; domains.set(domain, (domains.get(domain) || 0) + 1); }
      const heading = document.createElement('h3'); heading.textContent = this._t('System overview'); container.appendChild(heading); const summary = document.createElement('div'); summary.className = 'summary section';
      for (const [label, value] of [['Entities', entries.length], ['Unavailable', unavailable], ['Unknown', unknown], ['Domains', domains.size]]) summary.appendChild(this._metric(label, String(value)));
      container.appendChild(summary); const list = document.createElement('div'); list.className = 'list section';
      for (const [domain, count] of [...domains.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) { const row = document.createElement('div'); row.className = 'row'; const label = document.createElement('span'); label.textContent = domain; const value = document.createElement('span'); value.textContent = String(count); row.append(label, value); list.appendChild(row); }
      container.appendChild(this._barChart([...domains.entries()].sort((a,b) => b[1] - a[1]).map(([label, value]) => ({ label, value, status: 'ready' })), 'Current entities by domain', ''));
      const snapshotNote = document.createElement('p'); snapshotNote.className = 'muted section'; snapshotNote.textContent = this._t('Current state snapshot, not historical energy.'); container.appendChild(snapshotNote);
      const healthHeading = document.createElement('h3'); healthHeading.className = 'section'; healthHeading.textContent = this._t('Health check'); container.appendChild(healthHeading);
      const health = document.createElement('div'); health.className = 'list'; const divisor = Math.max(entries.length, 1);
      for (const [labelText, valueText] of [
        ['Entity availability', `${(((entries.length - unavailable) / divisor) * 100).toFixed(1)}%`],
        ['Known states', `${(((entries.length - unknown) / divisor) * 100).toFixed(1)}%`],
        ['Total entities', String(entries.length)],
        ['Unavailable', String(unavailable)],
        ['Unknown', String(unknown)],
      ]) {
        const row = document.createElement('div'); row.className = 'row'; const label = document.createElement('span'); label.textContent = this._t(labelText); const value = document.createElement('span'); value.textContent = valueText; row.append(label, value); health.appendChild(row);
      }
      container.appendChild(health);
    }

    _buildExportDocument(nowValue) {
      this._tariffGuard?.observe();
      const state = this._energyViewState || {}; const period = state.period || this._periodDescriptor(); const total = state.total || {}; const cost = state.cost || {}; const generated = asDate(nowValue) || new Date();
      return {
        schema_version: state.comparison && this._config.compare_previous_period === true ? 3 : 2,
        ...(state.comparison && this._config.compare_previous_period === true ? { comparison: state.comparison } : {}),
        generated_at: generated.toISOString(),
        period: { key: period.key || this._period, start: period.start || null, end: period.end || null, time_zone: period.time_zone || this._timeZone() },
        source_mode: state.source_mode || (this._config.energy_source_mode === 'explicit' ? 'explicit' : 'energy_dashboard'),
        energy: {
          status: state.status || 'error',
          total: { label: 'Grid import', value: typeof total.value === 'number' && Number.isFinite(total.value) ? total.value : null, unit: total.unit || 'kWh', source_statistic_ids: Array.isArray(total.source_statistic_ids) ? [...total.source_statistic_ids] : [] },
          cost: { value: typeof cost.value === 'number' && Number.isFinite(cost.value) ? cost.value : null, currency: cost.currency || null, method: cost.method || 'unavailable', rate: typeof cost.rate === 'number' && Number.isFinite(cost.rate) ? cost.rate : null, source_statistic_ids: Array.isArray(cost.source_statistic_ids) ? [...cost.source_statistic_ids] : [], reason: cost.reason || null },
          ...(cost.method === 'configured_tariff' ? { tariff: { records: cost.records, daily: (cost.daily || []).map(({records, ...day}) => day), coverage: cost.coverage, revision: cost.revision ?? null, provenance: cost.provenance || null, currency: cost.currency, price_basis: cost.price_basis, tariff_timezone: cost.tariff_timezone, tariff_clock: cost.tariff_clock, fixed_monthly: cost.fixed_monthly ?? null, variable_cost: cost.variable_cost ?? null, usage_cost: cost.usage_cost ?? null, measured_energy_cost: cost.measured_energy_cost ?? null, current_profile_validity: cost.current_profile_validity || null } } : {}),
          recorded_total: state.recorded_total || null,
          recorded_cost: state.recorded_cost || null,
          daily: state.daily || [],
          total_sources: (state.total_sources || []).map((source) => this._exportSource(source)),
          cost_sources: (state.cost_sources || []).map((source) => this._exportSource(source)),
          devices: (state.devices || []).map((device) => ({ recorded_value: device.recorded_value == null ? null : device.recorded_value, coverage: device.coverage || null, statistic_id: device.statistic_id, label: device.label || device.statistic_id, value: typeof device.value === 'number' && Number.isFinite(device.value) ? device.value : null, unit: device.unit || 'kWh', status: device.status || 'invalid', provenance: device.provenance || 'unknown', included_in_stat: device.included_in_stat || null })),
          warnings: Array.isArray(state.warnings) ? state.warnings.map(String) : [],
        },
      };
    }

    _exportSource(source) {
      return { statistic_id: source.statistic_id, label: source.label || source.statistic_id, role: source.role, value: typeof source.value === 'number' && Number.isFinite(source.value) ? source.value : null, recorded_value: typeof source.recorded_value === 'number' && Number.isFinite(source.recorded_value) ? source.recorded_value : null, coverage: source.coverage || null, unit: source.unit || null, status: source.status || 'invalid', provenance: source.provenance || 'unknown', included_in_stat: source.included_in_stat || null, reason: source.reason || null };
    }

    _csvCell(value) {
      let text = value == null ? '' : String(value); let forceQuote = false;
      if (typeof value === 'string' && /^(?:[\t\r\n]|[\u0000-\u0020]*[=+\-@])/.test(text)) { text = `'${text}`; forceQuote = true; }
      return forceQuote || /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    _buildCsv(documentValue) {
      const report = documentValue || this._buildExportDocument(this._now());
      const header = ['schema_version', 'generated_at', 'period_key', 'period_start', 'period_end', 'time_zone', 'section', 'metric', 'statistic_id', 'label', 'value', 'unit', 'status', 'provenance', 'included_in_stat', 'reason'];
      const base = [report.schema_version, report.generated_at, report.period.key, report.period.start, report.period.end, report.period.time_zone]; const rows = [header];
      rows.push([...base, 'energy', 'total', report.energy.total.source_statistic_ids.join('|'), report.energy.total.label, report.energy.total.value, report.energy.total.unit, report.energy.status, report.source_mode, '', '']);
      rows.push([...base, 'energy', 'cost', report.energy.cost.source_statistic_ids.join('|'), report.energy.cost.method, report.energy.cost.value, report.energy.cost.currency, report.energy.cost.value == null ? (report.energy.cost.reason || 'unavailable') : 'ready', report.energy.cost.method, '', report.energy.cost.reason]);
      for (const record of report.energy.tariff?.records || []) {
        for (const [key,kind,unit] of [['kwh','tariff_hour_energy','kWh'],['energyCost','tariff_hour_cost',record.currency],['energyRate','tariff_hour_rate',`${record.currency}/kWh`]]) rows.push([...base,'energy',kind,record.source_statistic_ids.join('|'),`${record.from} / ${record.to}`,record[key],unit,record.available?'ready':'partial','configured_tariff','',JSON.stringify({zones:record.zones,revision:record.revision,price_basis:record.price_basis,reason:record.reason})]);
      }
      for (const metric of ['recorded_total', 'recorded_cost']) {
        const value = report.energy[metric];
        if (value && value.status === 'partial' && value.value != null) rows.push([...base, 'energy', metric, value.source_statistic_ids.join('|'), metric, value.value, value.unit, 'partial', 'recorder_available_samples', '', 'incomplete_coverage']);
      }
      for (const source of report.energy.total_sources || []) rows.push([...base, 'energy', 'total_source', source.statistic_id, source.label, source.value, source.unit, source.status, source.provenance, source.included_in_stat, source.reason]);
      for (const source of report.energy.cost_sources || []) rows.push([...base, 'energy', 'cost_source', source.statistic_id, source.label, source.value, source.unit, source.status, source.provenance, source.included_in_stat, source.reason]);
      for (const [kind, sources] of [['total_source', report.energy.total_sources], ['cost_source', report.energy.cost_sources], ['device', report.energy.devices]]) {
        for (const source of sources || []) {
          if (source.status !== 'ready' && source.recorded_value != null) rows.push([...base, 'energy', `recorded_${kind}`, source.statistic_id, source.label, source.recorded_value, source.unit, source.status, 'recorder_available_samples', source.included_in_stat, source.reason || 'incomplete_coverage']);
          if (source.coverage) for (const [key, unit] of [['observed_hours', 'h'], ['expected_hours', 'h'], ['first_sample', 'UTC'], ['last_sample', 'UTC']]) rows.push([...base, 'energy', `${kind}_${key}`, source.statistic_id, source.label, source.coverage[key], unit, source.status, 'recorder_available_samples', source.included_in_stat, source.reason || '']);
        }
      }
      for (const day of report.energy.daily || []) rows.push([...base, 'energy', 'recorded_day', '', `${day.start} / ${day.end}`, day.recorded_value, 'kWh', day.status, 'recorder_available_samples', '', `${day.observed_source_hours}/${day.expected_source_hours} source hours`]);
      for (const device of report.energy.devices) rows.push([...base, 'energy', 'device', device.statistic_id, device.label, device.value, device.unit, device.status, device.provenance, device.included_in_stat, '']);
      if (report.comparison) {
        const pair = report.comparison;
        for (const [side, snapshot] of [['current', pair.current], ['previous', pair.previous]]) {
          const pairedBase = [report.schema_version, report.generated_at, snapshot?.period.key || report.period.key,
            snapshot?.period.start || null, snapshot?.period.end || null, snapshot?.period.time_zone || report.period.time_zone];
          rows.push([...pairedBase, 'comparison', 'comparison_snapshot', '', side, JSON.stringify(snapshot), '', snapshot?.status || pair.status, snapshot?.source_mode || '', '', pair.reason || '']);
        }
        for (const [key, metric] of Object.entries(pair.metrics)) rows.push([...base, 'comparison', 'comparison_metric', '', key, JSON.stringify(metric), metric.unit, metric.comparable ? 'ready' : 'partial', metric.provenance, '', metric.reason]);
        rows.push([...base, 'comparison', 'comparison_scope', '', '', JSON.stringify(pair.scope), '', pair.status, '', '', JSON.stringify({ reason: pair.reason, shift_days: pair.shift_days, requested_local_start: pair.requested_local_start, requested_local_cutoff: pair.requested_local_cutoff })]);
        for (const record of pair.records) {
          const p = (record.side === 'current' ? pair.current : pair.previous).period;
          rows.push([report.schema_version, report.generated_at, p.key, p.start, p.end, p.time_zone, 'comparison', 'comparison_record', record.statistic_id || (record.source_statistic_ids || []).join('|'), record.side, JSON.stringify(record), record.unit || record.currency, record.status || (record.available ? 'ready' : 'partial'), record.provenance || pair[record.side].cost.provenance, record.included_in_stat || '', record.reason || '']);
        }
      }
      return `${rows.map((row) => row.map((value) => this._csvCell(value)).join(',')).join('\n')}\n`;
    }


    _exportObjectIdentity(value) {
      if (!value || !['object','function'].includes(typeof value)) return 'none';
      this._exportObjects ||= new WeakMap();
      if (!this._exportObjects.has(value)) this._exportObjects.set(value, String(this._exportObjectSequence = (this._exportObjectSequence || 0) + 1));
      return this._exportObjects.get(value);
    }

    _readExportAssociation() {
      const h = this._hass;
      // Association stays local. Never put config, user, groups or connection data in a file.
      return JSON.stringify([h?.user?.id, h?.user?.is_admin, h?.user?.is_owner, h?.user?.is_active,
        h?.user?.groups, h?.user?.group_ids, this._exportObjectIdentity(h?.connection), this._exportObjectIdentity(h?.callWS),
        h?.connection?.connected, this._exportConnectionOffline, this._exportBrowserOffline, navigator.onLine,
        this._connected, this._activeTab, this._period, this._config, h?.language, h?.locale, h?.config]);
    }

    _invalidateReviewedExport(unavailable = false) {
      this._exportRevision = (this._exportRevision || 0) + 1;
      if (unavailable) this._exportSourceAssociation = null;
      this._exportDialog?.contextChanged();
    }

    _observeReviewedExportSource() {
      const association = this._readExportAssociation();
      if (this._exportObservedAssociation !== association) {
        this._exportObservedAssociation = association;
        this._energyRequestGeneration += 1;
        this._invalidateReviewedExport(true);
      }
      return association;
    }

    _bindReviewedExportEvents() {
      const next = this._hass?.connection;
      if (!this._exportBrowserEvent) {
        this._exportBrowserOffline = navigator.onLine === false;
        this._exportBrowserEvent = event => {
          this._exportBrowserOffline = event.type === 'offline';
          this._observeReviewedExportSource();
        };
        window.addEventListener('offline', this._exportBrowserEvent);
        window.addEventListener('online', this._exportBrowserEvent);
      }
      if (this._exportConnection !== next) {
        for (const type of ['ready','disconnected','reconnect-error']) this._exportConnection?.removeEventListener?.(type,this._exportConnectionEvent);
        this._exportConnection = next;
        this._exportConnectionOffline = next?.connected === false;
        this._exportConnectionEvent = event => {
          this._exportConnectionOffline = event.type !== 'ready';
          // An event is an epoch boundary even when the transport reuses its object.
          this._energyRequestGeneration += 1;
          this._invalidateReviewedExport(true);
          this._observeReviewedExportSource();
        };
        for (const type of ['ready','disconnected','reconnect-error']) next?.addEventListener?.(type,this._exportConnectionEvent);
      }
    }

    _unbindReviewedExportEvents() {
      window.removeEventListener('offline',this._exportBrowserEvent);
      window.removeEventListener('online',this._exportBrowserEvent);
      for (const type of ['ready','disconnected','reconnect-error']) this._exportConnection?.removeEventListener?.(type,this._exportConnectionEvent);
      this._exportBrowserEvent = null; this._exportConnection = null;
    }

    _reviewedExportContext() {
      const association = this._observeReviewedExportSource();
      const source = JSON.stringify(this._energyViewState);
      if (source !== this._exportObservedData) {
        this._exportObservedData = source;
        this._exportRevision = (this._exportRevision || 0) + 1;
      }
      const h = this._hass;
      const connected = this._connected && this.isConnected && navigator.onLine !== false && !this._exportBrowserOffline
        && !this._exportConnectionOffline && h?.connection?.connected !== false;
      // Smart Reports already grants household users read access. Export adds no admin gate.
      const canExport = !!h?.user?.id && h.user.is_active !== false && typeof h.callWS === 'function' && this._activeTab === 'energy';
      return { role: JSON.stringify([h?.user?.is_admin === true,h?.user?.is_owner === true,h?.user?.groups || [],h?.user?.group_ids || []]),
        userId: h?.user?.id || 'unavailable', connectionId:this._exportObjectIdentity(h?.connection || h?.callWS),
        datasetId:'smart-energy', revision:this._exportRevision || 1, connected, canExport,
        sourceConfirmed:this._exportSourceAssociation === association && ['ready','partial','no_data'].includes(this._energyViewState?.status) };
    }

    _projectReviewedExport(report, includePrivate) {
      return projectSmartReportV3(report, includePrivate === true);
    }

    _buildReviewedExport({draft,signal}) {
      if (signal.aborted || !this._reviewedExportContext().sourceConfirmed) return {status:'no_data'};
      // No new backend reads: project only the materialized current report.
      const report = this._projectReviewedExport(this._buildExportDocument(this._now()),draft.includePrivate);
      if (signal.aborted || !this._reviewedExportContext().sourceConfirmed) return {status:'no_data'};
      const pl = languageOf(this._hass).startsWith('pl');
      const included = [pl ? 'Pełny raport pomiarów: wszystkie źródła i urządzenia, także ukryte wyszukiwaniem; wartości zero, ujemne i braki null.'
        : 'Full measured report: all sources and devices, including those hidden by search; zero, negative and missing null values.',
        pl ? 'Zachowane zakresy, strefy czasu, pokrycie, taryfy, stawki, opłaty oraz obie migawki porównania, jeśli włączone.'
        : 'Preserved ranges, timezones, coverage, tariffs, rates, fees and both comparison snapshots when enabled.',
        draft.includePrivate ? (pl ? 'Sprawdzone nazwy źródeł/urządzeń i identyfikatory statystyk.' : 'Reviewed source/device names and statistic IDs.')
          : (pl ? 'Spójne aliasy źródeł, urządzeń, nazw i relacji.' : 'Consistent aliases for sources, devices, names and relationships.')];
      const excluded = [pl ? 'Tokeny, użytkownicy, adresy, konfiguracja, profile i szkice taryf oraz surowe błędy.'
        : 'Tokens, users, addresses, configuration, tariff profiles/drafts and raw errors.',
        pl ? 'Nieznane pola spoza jawnych schematów. Identyfikatory stref taryfowych zastąpione aliasami.'
          : 'Unknown fields outside explicit schemas. Tariff zone identifiers are aliased.',
        draft.includePrivate ? (pl ? 'Żadne inne pola prywatne nie są objęte zgodą.' : 'Consent covers no other private fields.')
          : (pl ? 'Prywatne nazwy i identyfikatory statystyk.' : 'Private names and statistic IDs.')];
      const sourceLimit = pl ? 'Tylko wczytany zakres Recorder. Retencja lub braki pomiarów pozostają widoczne; bez ekstrapolacji i bez obcięcia rekordów. Opłata stała jest osobna. CSV zawiera również pełny bezpieczny dokument w wierszu reviewed_full_document.'
        : 'Loaded Recorder range only. Retention or measurement gaps remain explicit; no extrapolation or record truncation. Fixed fee stays separate. CSV also carries the complete safe document in reviewed_full_document.';
      const partial = report.energy.status !== 'ready' || report.energy.cost.value === null || report.energy.devices.some(d => d.status !== 'ready')
        || !!report.energy.warnings.length || (!!report.comparison && report.comparison.status !== 'ready') || report.energy.tariff?.coverage?.complete === false;
      const resultState = report.energy.status === 'no_data' ? 'no_data' : partial ? 'partial' : 'success';
      report.export_scope = {policy:'smart-measured-report-v1',result_state:resultState,include_private:draft.includePrivate === true,
        included,excluded,source_limit:sourceLimit,truncated:false,search_applied:false,
        counts:{total_sources:report.energy.total_sources.length,cost_sources:report.energy.cost_sources.length,devices:report.energy.devices.length,
          tariff_records:report.energy.tariff?.records?.length || 0,comparison_records:report.comparison?.records?.length || 0,
          current_records:report.comparison?.current?.records?.length || 0,previous_records:report.comparison?.previous?.records?.length || 0}};
      const serialized = draft.format === 'json' ? JSON.stringify(report,null,2) + '\n' : this._buildReviewedCsv(report);
      // A confirmed no-data REPORT is a partial document, not a fabricated successful measurement.
      return {serialized,confirmed:true,sourceConfirmed:true,status:resultState === 'success' ? 'success' : 'partial',included,excluded,sourceLimit};
    }

    _buildReviewedCsv(report) {
      const csv = this._buildCsv(report);
      const row = [report.schema_version,report.generated_at,report.period.key,report.period.start,report.period.end,report.period.time_zone,
        'export','reviewed_full_document','','',JSON.stringify(report),'',report.export_scope.result_state,report.source_mode,'',''];
      // The legacy domain rows remain available; this row makes CSV lossless for
      // tariff daily records, fixed fees, coverage and paired data, with no limits.
      return csv + row.map(value => this._csvCell(value)).join(',') + '\n';
    }

    _downloadExport(format) {
      this._tariffGuard?.observe();
      const context = this._reviewedExportContext();
      if (!context.connected || !context.canExport || !context.sourceConfirmed) return;
      if (this.shadowRoot.querySelector('[data-ha-tools-export]')) return;
      this._exportDialog?.destroy();
      this._exportDialog = createExportDialog({root:this.shadowRoot,createUiV3,getLanguage:()=>languageOf(this._hass),
        getContext:()=>this._reviewedExportContext(),formats:['json','csv'],defaultFormat:format,
        defaultFilename:`smart-report-${this._period}.${format}`,
        policy:{id:'smart-measured-report-v1',allowlistedFields:['schema_version','generated_at','period','source_mode','energy','comparison','export_scope'],
          neverInclude:['tokens','users','addresses','raw_config','profiles','drafts','raw_errors']},
        buildPayload:options=>this._buildReviewedExport(options),
        performDownload:({blob,filename,signal})=>{
          if (signal.aborted) return {outcome:'unknown'};
          const url = URL.createObjectURL(blob), anchor = document.createElement('a');
          anchor.href=url;anchor.download=filename;
          try { anchor.click(); } finally { setTimeout(()=>URL.revokeObjectURL(url),1000); }
          return {outcome:'initiated'};
        }});
      this._exportDialog.open({opener:this.shadowRoot.getElementById(format === 'json' ? 'exportJsonBtn' : 'exportCsvBtn')});
    }

  }

  class HASmartReportsEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this._config = {}; }
    setConfig(config) {
      const next = config && typeof config === 'object' ? { ...config } : {};
      const same = JSON.stringify(next) === JSON.stringify(this._config);
      this._config = next;
      if (!same || !this.shadowRoot.firstChild) this._render();
    }
    set hass(hass) {
      const language = languageOf(hass);
      const changed = language !== this._language;
      this._language = language; this._hass = hass;
      if (changed) this._render(true);
    }
    _render(preserveDraft = false) {
      const active = this.shadowRoot.activeElement;
      const focus = active?.id ? {id:active.id,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,value:active.value} : null;
      this.shadowRoot.replaceChildren();
      const style = document.createElement('style'); style.textContent = ':host{display:grid;gap:12px;padding:12px;color:var(--primary-text-color,#172033);font-family:system-ui,sans-serif}label{display:grid;gap:5px}input,select,textarea{min-height:44px;max-width:100%;min-width:0;box-sizing:border-box;font:inherit;padding:9px;border:1px solid var(--divider-color,#d9e0ea);border-radius:8px;background:var(--card-background-color,#fff);color:inherit}input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--primary-color,#3b82f6);outline-offset:2px}[hidden]{display:none!important}';
      const field = (id, labelText, key) => { const label = document.createElement('label'); label.textContent = translate(this._hass, labelText); const input = document.createElement('input'); input.id = id; input.value = typeof this._config[key] === 'string' ? this._config[key] : ''; input.addEventListener('input', () => { this._config = { ...this._config, [key]: input.value }; this._dispatch(); }); label.appendChild(input); return label; };
      this.shadowRoot.append(style, field('cf_title', 'Title', 'title'), field('cf_currency', 'Currency', 'currency'));
      const modeLabel = document.createElement('label'); modeLabel.textContent = translate(this._hass, 'Source mode');
      const mode = document.createElement('select'); mode.id = 'cf_source_mode'; mode.style.cssText = 'font:inherit;padding:9px;background:var(--card-background-color,#fff);color:inherit;border:1px solid var(--divider-color,#d9e0ea);border-radius:8px';
      for (const [value, text] of [['dashboard', 'Energy Dashboard'], ['explicit', 'Explicit statistics']]) { const option = document.createElement('option'); option.value = value; option.textContent = translate(this._hass, text); mode.appendChild(option); }
      mode.value = this._config.energy_source_mode === 'explicit' ? 'explicit' : 'dashboard'; modeLabel.appendChild(mode); this.shadowRoot.appendChild(modeLabel);
      const sources = document.createElement('section'); sources.style.cssText = 'display:grid;gap:12px'; sources.hidden = mode.value !== 'explicit';
      for (const [key, title] of [['energy_total_statistics', 'Total statistic IDs'], ['energy_device_statistics', 'Device statistic IDs'], ['energy_cost_statistics', 'Cost statistic IDs']]) {
        const label = document.createElement('label'); label.textContent = translate(this._hass, title);
        const input = document.createElement('textarea'); input.id = `cf_${key}`; input.rows = 3; input.style.cssText = 'font:inherit;width:100%;box-sizing:border-box;padding:9px;background:var(--card-background-color,#fff);color:inherit;border:1px solid var(--divider-color,#d9e0ea);border-radius:8px';
        input.value = (Array.isArray(this._config[key]) ? this._config[key] : []).map(value => typeof value === 'string' ? value : value && value.statistic_id).filter(value => typeof value === 'string').join('\n');
        input.addEventListener('change', () => {
          const previous = new Map((Array.isArray(this._config[key]) ? this._config[key] : []).filter(Boolean).map(value => [typeof value === 'string' ? value : value.statistic_id, value]));
          const ids = [...new Set(input.value.split(/[\n,]/).map(value => value.trim()).filter(Boolean))];
          this._config = { ...this._config, [key]: ids.map(id => previous.get(id) || id) }; this._dispatch();
        }); label.appendChild(input); sources.appendChild(label);
      }
      const note = document.createElement('p'); note.textContent = translate(this._hass, 'One statistic ID per line. Advanced labels and parent relationships can be configured in YAML.'); note.style.fontSize = '12px'; sources.appendChild(note); this.shadowRoot.appendChild(sources);
      const rateLabel = document.createElement('label');rateLabel.textContent=translate(this._hass,'Flat rate per kWh');
      const rate=document.createElement('input');rate.type='number';rate.min='0';rate.step='any';rate.id='cf_energy_price';rate.value=typeof this._config.energy_price==='number'?String(this._config.energy_price):'';
      rate.addEventListener('change',()=>{const value=rate.value.trim()===''?null:Number(rate.value);this._config={...this._config,energy_price:typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null};this._dispatch();});rateLabel.appendChild(rate);
      const costLabel=document.createElement('label');costLabel.textContent=translate(this._hass,'Cost mode');const costMode=document.createElement('select');costMode.id='cf_cost_mode';
      for(const [value,label] of [['auto','Recorded costs, then explicit flat estimate'],['cost_statistics','Recorded monetary statistics'],['flat_rate_estimate','Explicit flat-rate estimate'],['configured_tariff','Configured tariff from measured hours']]){const option=document.createElement('option');option.value=value;option.textContent=translate(this._hass,label);costMode.appendChild(option);}
      costMode.value=['cost_statistics','flat_rate_estimate','configured_tariff'].includes(this._config.energy_cost_mode)?this._config.energy_cost_mode:'auto';costMode.addEventListener('change',()=>{this._config={...this._config,energy_cost_mode:costMode.value};this._dispatch();});costLabel.appendChild(costMode);
      this.shadowRoot.append(costLabel,rateLabel);
      mode.addEventListener('change', () => { this._config = { ...this._config, energy_source_mode: mode.value }; sources.hidden = mode.value !== 'explicit'; this._dispatch(); });
      if (focus) {
        const target = this.shadowRoot.getElementById(focus.id);
        if (target && !target.closest('[hidden]')) {
          if (preserveDraft) target.value = focus.value;
          target.focus({preventScroll:true});
          if (focus.start != null && typeof target.setSelectionRange === 'function') target.setSelectionRange(focus.start,focus.end,focus.direction);
        }
      }
    }
    _dispatch() { this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { ...this._config } }, bubbles: true, composed: true })); }
  }

  customElements.define('ha-smart-reports', HASmartReports);
  customElements.define('ha-smart-reports-editor', HASmartReportsEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === 'ha-smart-reports')) window.customCards.push({ type: 'ha-smart-reports', name: 'Smart Reports', description: 'Recorder-backed energy, automation, and system reports', preview: true, documentationURL: 'https://github.com/MacSiem/ha-smart-reports' });
  console.info(`%c HA-SMART-REPORTS %c v${VERSION} `, 'color: white; background: #2563eb; font-weight: 700;', 'color: #2563eb; background: #dbeafe;');
})();
