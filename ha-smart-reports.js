/**
 * Home Assistant Smart Reports Card
 * Recorder-backed energy reports, automation statistics, and system overview.
 * Version: 4.1.2
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

  // BEGIN mirror shared/ha-tools-ui.js
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
  const css = `
.ht-result-state { display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid currentColor;border-radius:6px;font-size:12px;line-height:1.4;white-space:normal; }
.ht-result-state--success { color:#237b3d;background:rgba(35,123,61,.10); }
.ht-result-state--partial { color:#966400;background:rgba(150,100,0,.10); }
.ht-result-state--unconfirmed { color:#ad5200;background:rgba(173,82,0,.10); }
.ht-result-state--error { color:#c32b2b;background:rgba(195,43,43,.10); }
.ht-result-state--not_checked,.ht-result-state--no_data { color:var(--secondary-text-color,#666);background:transparent; }
.ht-result-state--no_data { border-style:dashed; }
:host(.bento-dark) .ht-result-state--success { color:#81cf99; }
:host(.bento-dark) .ht-result-state--partial { color:#efd080; }
:host(.bento-dark) .ht-result-state--unconfirmed { color:#ffb97b; }
:host(.bento-dark) .ht-result-state--error { color:#ff9999; }
`;
  return { status, statusHtml, css };
}
// Node tests use the canonical factory; this line is excluded from runtime copies.
  // END mirror shared/ha-tools-ui.js

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

  const VERSION = '4.1.2';
  const VALID_PERIODS = new Set(['1d', '7d', '30d']);
  const ENERGY_UNITS = new Set(['Wh', 'kWh', 'MWh']);

  const PL = Object.freeze({
    'missing_measurement':'brak pomiaru','shared_backend':'wspólne ustawienia taryfy','card_config':'ustawienia karty',
    'gross':'brutto','net':'netto','nonaligned_window':'okres nie obejmuje pełnych godzin',
    'tariff_authority_unavailable':'ustawienia taryfy niedostępne','tariff_unconfirmed':'ustawienia taryfy niepotwierdzone',
    'invalid_profile':'nieprawidłowa taryfa','mixed_rate_bucket':'zmiana stawki wewnątrz przedziału',

    'All hours':'Wszystkie godziny','Page':'Strona','Previous':'Poprzednia','Next':'Następna',
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
      incomplete_coverage: 'Incomplete coverage', missing_rate: 'Missing rate', currency_mismatch: 'Incompatible currency' })[text] || (text === 'day_suffix' ? 'd' : text);
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
      this._tariffGuard?.resume();
      this._tariffGuard?.observe();
      this._renderScaffold();
      this._syncTheme();
      this._syncTabs();
      if (this._hass) this._scheduleRefresh(true);
    }

    disconnectedCallback() {
      this._connected = false;
      this._tariffGuard?.suspend();
      this._tariffGuard?.observe();
      if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
      this._invalidateEnergyRequest();
    }

    set hass(hass) {
      const language = languageOf(hass);
      const languageChanged = language !== this._language;
      this._language = language;
      if (this._hass && (this._hass.user?.id !== hass?.user?.id || this._hass.connection !== hass?.connection)) this._deviceQuery = '';
      this._hass = hass;
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

    get hass() {
      return this._hass;
    }

    setConfig(config) {
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
          :host{--sr-primary:var(--primary-color,#3b82f6);--sr-card:var(--card-background-color,var(--ha-card-background,#fff));--sr-text:var(--primary-text-color,#172033);--sr-muted:var(--secondary-text-color,#667085);--sr-border:var(--divider-color,#d9e0ea);--sr-good:#15803d;--sr-warn:#b45309;--sr-bad:#b42318;display:block;color:var(--sr-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}.card{background:var(--sr-card);border:1px solid var(--sr-border);border-radius:16px;overflow:hidden}.header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 12px}h2,h3,p{margin:0}h2{font-size:20px}h3{font-size:15px}.tabs{display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--sr-border);overflow-x:auto}button,select{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}.tab{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--sr-muted);padding:10px 12px}.tab.active{color:var(--sr-primary);border-bottom-color:var(--sr-primary);font-weight:650}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px 0}.toolbar-actions{display:flex;flex-wrap:wrap;gap:8px}.control,.action{min-height:44px;min-width:44px;max-width:100%;border:1px solid var(--sr-border);border-radius:9px;background:var(--sr-card);color:var(--sr-text);padding:8px 11px}.action.primary{background:var(--sr-primary);border-color:var(--sr-primary);color:#fff}.action:disabled{cursor:not-allowed;opacity:.45}.pane{padding:20px;min-height:220px}.state{display:grid;gap:12px;place-items:start;padding:22px;border:1px solid var(--sr-border);border-radius:12px}.state[role="status"]{border-left:4px solid var(--sr-primary)}.state.partial{border-left-color:var(--sr-warn)}.state.error{border-left-color:var(--sr-bad)}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.metric{border:1px solid var(--sr-border);border-radius:12px;padding:14px}.metric-label,.muted{color:var(--sr-muted);font-size:12px}.metric-value{margin-top:5px;font-size:23px;font-weight:720}.section{margin-top:18px}.list{display:grid;gap:8px;margin-top:10px}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;border-bottom:1px solid var(--sr-border);padding:9px 2px}.row.child{padding-left:24px}.row-name{overflow-wrap:anywhere}.status-ready{color:var(--sr-good)}.warning{color:var(--sr-warn)}.fixed-link{color:var(--sr-primary)}.donate-section{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;border-top:1px solid var(--sr-border);padding:13px 18px;color:var(--sr-muted);font-size:12px}.donate-section a{color:var(--sr-primary);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}[hidden]{display:none!important}@media(max-width:520px){.header,.toolbar{align-items:stretch;flex-direction:column}.toolbar-actions{width:100%}.action{flex:1}}
          .report-views{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.report-views [aria-selected="true"]{border-color:var(--sr-primary);color:var(--sr-primary);font-weight:650}.bar-chart{display:grid;gap:12px}.chart-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px}.chart-row.child{margin-left:20px}.bar-track{grid-column:1/-1;height:9px;background:var(--sr-border);border-radius:5px;overflow:hidden}.bar-fill{background:var(--sr-primary);height:100%;border-radius:4px}.chart-row small{grid-column:1/-1}.daily-history{display:flex;gap:8px;overflow-x:auto;padding:16px 2px 8px;max-width:100%}.day-column{display:grid;gap:6px;text-align:center;flex:0 0 40px;color:var(--sr-muted);font-size:11px}.day-track{height:100px;display:flex;align-items:flex-end;background:var(--sr-border);border-radius:4px;overflow:hidden}.day-track .bar-fill{width:100%}.day-column.partial .day-track{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--sr-border) 4px 7px)}.day-column.partial .bar-fill{background:repeating-linear-gradient(135deg,var(--sr-primary) 0 4px,var(--sr-border) 4px 7px)}.day-column.no_data .day-track{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--sr-border) 4px 7px)}.cost-source{font-size:12px;line-height:1.6;margin-top:8px;overflow-wrap:anywhere}.report-context{margin-bottom:14px;line-height:1.6}summary{cursor:pointer;overflow-wrap:anywhere;min-height:44px;display:flex;align-items:center;padding:8px 0}.daily-history:focus-visible,summary:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}
          .tariff-evidence{display:grid;gap:12px;min-width:0}.tariff-evidence p,.tariff-evidence h4{overflow-wrap:anywhere}.tariff-day-chart{display:grid;gap:8px;margin-top:12px}.tariff-day-chart h4{margin:0;font-size:14px}.tariff-day{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;min-height:64px;min-width:44px;max-width:100%;padding:10px 12px;border:1px solid var(--sr-border);border-radius:10px;background:var(--sr-card);color:var(--sr-text);text-align:left;font:inherit}.tariff-day[aria-pressed=true]{border-color:var(--sr-primary);outline:1px solid var(--sr-primary)}.tariff-day strong{overflow-wrap:anywhere}.tariff-day small{grid-column:1/-1;color:var(--sr-muted);font-size:11px}.tariff-day-track{grid-column:1/-1;position:relative;height:8px;background:var(--sr-border);border-radius:4px;overflow:hidden}.tariff-day-track.signed{background:linear-gradient(to right,var(--sr-border) calc(50% - 1px),var(--sr-text) 50%,var(--sr-border) calc(50% + 1px))}.tariff-day-fill{position:absolute;top:0;height:100%;background:var(--sr-primary);border-radius:3px}.tariff-day[data-availability=partial] .tariff-day-fill{background:repeating-linear-gradient(135deg,var(--sr-primary) 0 4px,var(--sr-border) 4px 7px)}.tariff-day[data-availability=gap] .tariff-day-track{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--sr-border) 4px 7px)}.tariff-pagination{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.tariff-pagination span{flex:1;min-width:0}.tariff-evidence button{min-height:44px;min-width:44px;white-space:normal;overflow-wrap:anywhere}.tariff-data-row{border:1px solid var(--sr-border);border-radius:10px;padding:12px;margin-top:8px;min-width:0;overflow-wrap:anywhere}.tariff-data-row h4{font-size:13px;margin:0 0 8px}.tariff-data-row dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:6px 12px;margin:0;font-size:12px}.tariff-data-row dt{color:var(--sr-muted)}.tariff-data-row dd{margin:0}.tariff-day:focus-visible{outline:3px solid var(--sr-primary);outline-offset:2px}
          .device-search-form{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:14px 0}.device-search-form label{flex:1;min-width:min(100%,180px);display:grid;gap:6px;font-size:13px}.device-search{width:100%;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--sr-border);border-radius:9px;background:var(--sr-card);color:var(--sr-text);font:inherit}.device-search-clear{min-height:44px;min-width:44px}.device-search:focus-visible{outline:2px solid var(--sr-primary);outline-offset:2px}.device-search-count,.device-export-note{overflow-wrap:anywhere;line-height:1.5}.chart-row small{overflow-wrap:anywhere}
          :host(.bento-dark){--sr-good:#4ade80;--sr-warn:#fbbf24;--sr-bad:#f87171}
        </style>
        <ha-card class="card">
          <div class="header"><h2 id="title"></h2><span class="muted" id="recorderLabel">${this._t("Recorder-backed")}</span></div>
          <nav class="tabs" id="tabs" aria-label="${this._t("Report sections")}">
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

    _syncTabs() {
      if (!this._scaffoldRendered) return;
      const available = this._availableTabs();
      if (!available.includes(this._activeTab)) this._activeTab = available[0] || null;
      this.shadowRoot.getElementById('title').textContent = this._config.title;
      this.shadowRoot.getElementById('tabs').hidden = available.length === 0;
      for (const button of this.shadowRoot.querySelectorAll('[data-tab]')) {
        const tab = button.dataset.tab;
        button.hidden = !available.includes(tab);
        button.classList.toggle('active', tab === this._activeTab);
        button.setAttribute('aria-selected', String(tab === this._activeTab));
      }
      this.shadowRoot.getElementById('energyToolbar').hidden = this._activeTab !== 'energy';
      if (this._activeTab === null) {
        const container = this.shadowRoot.getElementById('content');
        container.replaceChildren(this._stateBlock('Enable at least one report section.', 'Turn on Energy, Automations, or System in the card configuration.', '', 'status'));
      } else if (this._activeTab === 'energy') this._renderEnergyState();
      else if (this._activeTab === 'automations') this._renderAutomations();
      else this._renderSystem();
    }

    _selectTab(tab) {
      if (!this._availableTabs().includes(tab) || tab === this._activeTab) return;
      if (this._activeTab === 'energy') this._invalidateEnergyRequest();
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
        if (this._activeTab === 'energy') await this._loadEnergy();
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

    _invalidateEnergyRequest() { this._energyRequestGeneration += 1; }

    _isCurrentEnergyRequest(generation) { return this._connected && this.isConnected && this._activeTab === 'energy' && generation === this._energyRequestGeneration; }

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
      const references = [...selection.totals, ...selection.costs, ...selection.devices];
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
      const previousState = descriptor.period ? this._materializeEnergyPeriod(descriptor.period, selection, previousStatistics || {}, metadata, snapshot, true) : null;
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
      const metrics = {
        energy: this._comparisonDelta(current.total.value, previous?.total.value, current.total.unit, previous?.total.unit, energyComplete, descriptor.reason),
        cost: this._comparisonDelta(current.cost.value, previous?.cost.value, current.cost.currency, previous?.cost.currency, costComplete,
          descriptor.reason || (current.cost.currency !== previous?.cost.currency ? 'currency_mismatch' : previous?.cost.reason || current.cost.reason)),
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
      if (this._config.energy_cost_mode === 'configured_tariff') this._tariffController().reset();
      const compare = this._config.compare_previous_period === true;
      if (compare) this._tariffController();
      const ticket = compare ? this._tariffGuard.snapshot() : null;
      const generation = ++this._energyRequestGeneration;
      const period = this._periodDescriptor();
      const pairedPeriod = compare ? this._previousPeriodDescriptor(period) : null;
      const current = () => this._isCurrentEnergyRequest(generation) && (!compare || this._tariffGuard.current(ticket));
      const read = payload => compare ? this._tariffGuard.call(ticket, payload) : this._hass.callWS(payload);
      const mode = this._config.energy_source_mode === 'explicit' ? 'explicit' : 'energy_dashboard';
      const previous = this._energyViewState;
      const reportConfig = JSON.stringify([this._config.energy_source_mode, this._config.energy_total_statistics, this._config.energy_device_statistics, this._config.energy_cost_statistics, this._config.energy_entity, this._config.energy_price, this._config.currency, this._config.energy_cost_mode, this._config.tariff_profile, compare]);
      const sameWindow = this._energyReportConfig === reportConfig && previous && ['ready', 'partial', 'no_data'].includes(previous.status) && previous.source_mode === mode && previous.period && previous.period.key === period.key && previous.period.start === period.start && previous.period.end === period.end && previous.period.time_zone === period.time_zone;
      if (!sameWindow || compare) this._setEnergyViewState({ status: 'loading', period, source_mode: mode, total: { value: null, unit: 'kWh', source_statistic_ids: [] }, cost: { value: null, currency: null, method: 'unavailable', rate: null, source_statistic_ids: [], reason: 'loading' }, devices: [], warnings: [] });
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
        if (pairedPeriod?.period) {
          const prior = pairedPeriod.period;
          priorStatistics = new Date(prior.end) <= new Date(prior.start) ? {} : await read({ type: 'recorder/statistics_during_period', start_time: prior.start, end_time: prior.end, statistic_ids: ids, period: 'hour', types: ['change'] });
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
        if (compare) state.comparison = this._buildPeriodComparison(state, pairedPeriod, selection, statisticsById, priorStatistics, metadataById, tariffSnapshot);
        if (!current()) return;
        this._tariffPricingContext = this._config.energy_cost_mode === 'configured_tariff' ? { generation, period, roots: selection.totals, statistics: statisticsById, metadata: metadataById,
          ...(compare ? { selection, pairedPeriod, priorStatistics } : {}) } : null;
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
        this._invalidateEnergyRequest(); this._energyReportConfig = null; this._tariffPricingContext = null; this._deviceQuery = ''; this._costSelectedDay = null; this._costDataPage = 0; this._costChartPage = 0;
        this._comparisonSelectedDay = null; this._comparisonDataPage = 0; this._comparisonChartPage = 0;
        this._tariffSettingsSection?.replaceChildren(); this._tariffSettingsSection = null;
        this._energyViewState = { status: 'idle' };
        // Clear cached priced/private source DOM immediately; do not dispatch a retry.
        if (this._scaffoldRendered && this._activeTab === 'energy') this.shadowRoot.getElementById('content')?.replaceChildren();
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
      const views = document.createElement('div'); views.className='report-views';views.setAttribute('role','tablist');views.setAttribute('aria-label',this._t('Cost evidence'));
      for (const [key,label] of [['chart','Chart'],['data','Data']]) {
        const button=document.createElement('button');button.type='button';button.className='action';button.dataset.costView=key;button.setAttribute('role','tab');button.setAttribute('aria-selected',String((this._costEvidenceView || 'chart')===key));button.textContent=this._t(label);
        button.addEventListener('click',()=>{this._costEvidenceView=key;this._renderEnergyState();this.shadowRoot.querySelector(`[data-cost-view="${key}"]`)?.focus();});views.appendChild(button);
      }section.appendChild(views);
      const panel = document.createElement('div'); panel.setAttribute('role','tabpanel');
      const records = cost.records, daily = cost.daily || [];
      const selected = daily.find(day => day.from === this._costSelectedDay);
      if (!selected) this._costSelectedDay = null;
      const rerender = (selector, fallback) => {
        this._renderEnergyState();
        const target = this.shadowRoot.querySelector(selector);
        (target && !target.disabled ? target : this.shadowRoot.querySelector(fallback || '[data-cost-view][aria-selected="true"]'))?.focus();
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
      const nav = document.createElement('nav'); nav.className = 'report-views'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', this._t('Energy report views'));
      for (const [key, label] of [['summary', 'Summary'], ['devices', 'Devices'], ['costs', 'Costs']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'action'; button.textContent = this._t(label); button.dataset.energyView = key; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(this._energyView === key));
        button.addEventListener('click', () => { this._energyView = key; this._renderEnergyState(); this.shadowRoot.querySelector('[data-energy-view][aria-selected="true"]')?.focus(); });
        nav.appendChild(button);
      }
      container.appendChild(nav);
      if (this._focusedEnergyView) nav.querySelector(`[data-energy-view="${this._focusedEnergyView}"]`)?.focus();
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
      const nav = document.createElement('nav'); nav.className = 'report-views'; nav.setAttribute('role','tablist'); nav.setAttribute('aria-label',this._t('Previous period comparison'));
      const rerender = selector => { this._renderEnergyState(); this.shadowRoot.querySelector(selector)?.focus(); };
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
      const note = document.createElement('p'); note.className = 'muted device-export-note'; note.textContent = this._t('Export includes all devices and sources in this report, including those hidden by search.'); container.appendChild(note);
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
      const heading = document.createElement('h3'); heading.className = 'section'; heading.textContent = this._t('Recorded consumption by day'); container.appendChild(heading);
      const chart = document.createElement('section'); chart.className = 'daily-history'; chart.setAttribute('role', 'region'); chart.setAttribute('aria-label', this._t('Recorded consumption by day')); chart.tabIndex = 0;
      const max = Math.max(0, ...days.map(day => day.recorded_value || 0));
      for (const day of days) {
        const item = document.createElement('div'); item.className = `day-column ${day.status}`;
        const text = `${this._formatPeriodDate(day.start, state.period.time_zone)} · ${this._formatNumber(day.recorded_value, 2)} kWh · ${this._t(day.status)} · ${this._formatNumber(day.observed_source_hours, Number.isInteger(day.observed_source_hours) ? 0 : 2)} / ${this._formatNumber(day.expected_source_hours, Number.isInteger(day.expected_source_hours) ? 0 : 2)} ${this._t('source hours')}`;
        item.setAttribute('role', 'img'); item.setAttribute('aria-label', text); item.title = text;
        const value = document.createElement('small'); value.textContent = this._formatNumber(day.recorded_value, 2);
        const track = document.createElement('div'); track.className = 'day-track'; const bar = document.createElement('div'); bar.className = 'bar-fill'; bar.style.height = `${max > 0 && day.recorded_value != null ? Math.max(0, Math.min(100, day.recorded_value / max * 100)) : 0}%`; track.appendChild(bar);
        const label = document.createElement('small'); label.textContent = new Intl.DateTimeFormat(languageOf(this._hass), { day: 'numeric', month: 'numeric', timeZone: state.period.time_zone }).format(new Date(day.start));
        item.append(value, track, label); chart.appendChild(item);
      }
      container.appendChild(chart);
      const note = document.createElement('p'); note.className = 'muted'; note.textContent = this._t('Striped days have incomplete history; empty days are not measured zero.'); container.appendChild(note);
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
      if (JSON.stringify(state) === JSON.stringify(this._energyViewState)) return;
      this._energyViewState = state;
      if (this._scaffoldRendered && this._activeTab === 'energy') this._renderEnergyState();
    }

    _stateBlock(title, detail, className, role) {
      const block = document.createElement('section'); block.className = `state ${className || ''}`.trim(); if (role) block.setAttribute('role', role);
      const heading = document.createElement('h3'); heading.textContent = this._t(title); block.appendChild(heading);
      if (detail) { const paragraph = document.createElement('p'); paragraph.className = 'muted'; paragraph.textContent = this._t(detail); block.appendChild(paragraph); }
      return block;
    }

    _renderEnergyState() {
      this._tariffGuard?.observe();
      if (!this._scaffoldRendered) return;
      const container = this.shadowRoot.getElementById('content'); const state = this._energyViewState || { status: 'idle' };
      const exportable = ['ready', 'partial', 'no_data'].includes(state.status);
      const search = this.shadowRoot.activeElement;
      const searchFocus = search?.classList.contains('device-search') ? {start:search.selectionStart,end:search.selectionEnd} : null;
      this._focusedEnergyView = this.shadowRoot.activeElement && this.shadowRoot.activeElement.dataset.energyView;
      const tariffMarkup = this._config.energy_cost_mode === 'configured_tariff' ? this._tariffController().markup() : null;
      this.shadowRoot.getElementById('exportJsonBtn').disabled = !exportable; this.shadowRoot.getElementById('exportCsvBtn').disabled = !exportable; container.replaceChildren();
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
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'action'; retry.textContent = this._t('Retry'); retry.addEventListener('click', () => this._scheduleRefresh(true), { once: true }); block.appendChild(retry); container.appendChild(block); return;
      }
      if (!['ready', 'partial', 'no_data'].includes(state.status)) return;
      const period = state.period || {}; const context = document.createElement('p'); context.className = 'muted report-context';
      const timeZone = period.time_zone || this._timeZone();
      const periodLabel = this._t(period.key === '1d' ? 'Today' : (period.key === '30d' ? '30 days' : (period.key === '7d' ? '7 days' : (period.key || '—'))));
      context.textContent = `${this._t('Period')}: ${periodLabel} · ${this._formatPeriodDate(period.start, timeZone)} – ${this._formatPeriodDate(period.end, timeZone)} · ${this._t('Time zone')}: ${timeZone} · ${this._t('Sources')}: ${(state.total_sources || []).length} ${this._t('total')}, ${(state.cost_sources || []).length} ${this._t('cost')}`;
      context.dataset.periodStart = period.start || '';
      context.dataset.periodEnd = period.end || '';
      context.title = `${this._t('Exact recorder window')}: ${period.start || '—'} → ${period.end || '—'}`;
      container.appendChild(context);
      if (state.comparison) this._renderPeriodComparison(container, state.comparison);
      if (state.status === 'no_data') {
        container.appendChild(this._stateBlock('No recorded energy change in this period.', 'Measured zero is rendered separately; this state means no recorder samples were available.', '', 'status'));
        if (period.start === period.end) { const note = document.createElement('p'); note.className = 'muted section'; note.textContent = this._t('Today starts reporting after its first completed hour.'); container.appendChild(note); }
        return;
      }
      this._renderEnergyViews(container);
      if (state.status === 'partial') container.appendChild(this._stateBlock('Partial history — recorded values only.', 'At least one required statistic was missing, invalid, incomplete, or used an incompatible currency.', 'partial', 'status'));
      const summary = document.createElement('section'); summary.className = 'summary';
      const recordedTotal = state.recorded_total || {};
      const recordedCost = state.cost?.method === 'configured_tariff' ? {} : state.recorded_cost || {};
      summary.appendChild(this._metric(state.status === 'partial' ? 'Recorded consumption' : 'Grid import', `${this._formatNumber(state.status === 'partial' ? recordedTotal.value : state.total.value, 2)} ${state.total.unit || 'kWh'}`));
      const costLabel = state.cost && state.cost.method === 'configured_tariff' ? 'Configured tariff energy cost' : state.cost && state.cost.method === 'cost_statistics' ? 'Actual cost' : (state.cost && state.cost.method === 'flat_rate_estimate' ? 'Estimated cost' : 'Cost unavailable');
      const costValue = state.cost && typeof state.cost.value === 'number' ? `${this._formatNumber(state.cost.value, 2)} ${state.cost.currency || ''}`.trim() : '—';
      summary.appendChild(this._metric(state.cost && state.cost.value == null && recordedCost.value != null ? 'Recorded cost' : costLabel, state.cost && state.cost.value == null && recordedCost.value != null ? `${this._formatNumber(recordedCost.value, 2)} ${recordedCost.unit || ''}` : costValue));
      summary.appendChild(this._metric('Sources with data', `${recordedTotal.sources_with_data || 0} / ${(state.total_sources || []).length}`));
      summary.appendChild(this._metric('Complete sources', `${recordedTotal.complete_sources || 0} / ${(state.total_sources || []).length}`));
      container.appendChild(summary);
      if (state.status === 'partial' || recordedCost.status === 'partial') { const note = document.createElement('p'); note.className = 'muted section'; note.textContent = this._t('Recorded values cover available samples only; gaps are not zero.'); container.appendChild(note); }
      if (this._energyView === 'summary') this._renderDailyChart(container, state);
      if (this._energyView !== 'costs') {
        const heading = document.createElement('h3'); heading.className = 'section'; heading.textContent = this._t(state.top_ranking_available === false ? 'Device breakdown unavailable' : (state.device_data_status === 'partial' ? 'Reported devices — partial' : 'Device breakdown')); container.appendChild(heading);
        const devices = state.devices || [];
        if (this._energyView === 'devices') this._renderDeviceSearch(container, devices);
        const shown = this._energyView === 'devices' ? this._filteredDevices(devices) : devices.slice(0, 6);
        if (shown.length) {
          container.appendChild(this._barChart(shown, 'Recorded energy by device', 'kWh', {scaleRows:this._energyView === 'devices' ? devices : shown,deviceContext:new Map(devices.map(row=>[row.statistic_id,row]))}));
          const note = document.createElement('p'); note.className = 'muted'; note.textContent = this._t('Device values have their own coverage; nested devices are included in their parent.'); container.appendChild(note);
          if (this._energyView === 'summary' && devices.length > 6) { const all = document.createElement('button'); all.type = 'button'; all.className = 'action section'; all.textContent = this._t('See all devices'); all.addEventListener('click', () => { this._energyView = 'devices'; this._renderEnergyState(); }); container.appendChild(all); }
        } else { const empty = document.createElement('p'); empty.className = 'muted section'; empty.textContent = this._t(devices.length ? 'No matching devices' : 'No device statistics are configured.'); container.appendChild(empty); }
      }
      if (this._energyView !== 'devices') {
        if (state.cost?.method === 'configured_tariff') this._renderTariffEvidence(container,state.cost);
        else this._renderCostCoverage(container, state);
      }
      const evidence = document.createElement('details'); evidence.className = 'section source-evidence';
      const evidenceHeading = document.createElement('summary'); evidenceHeading.textContent = this._t('Source evidence'); evidence.appendChild(evidenceHeading);
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
      if (searchFocus) {
        const next = container.querySelector('.device-search'); next?.focus({preventScroll:true});
        if (next && searchFocus.start != null) next.setSelectionRange(searchFocus.start,searchFocus.end);
      }
    }

    _metric(labelText, valueText) {
      const metric = document.createElement('div'); metric.className = 'metric'; const label = document.createElement('div'); label.className = 'metric-label'; label.textContent = this._t(labelText); const value = document.createElement('div'); value.className = 'metric-value'; value.textContent = valueText; metric.append(label, value); return metric;
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
      if (/^[=+\-@]/.test(text)) { text = `'${text}`; forceQuote = true; }
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

    _downloadExport(format) {
      this._tariffGuard?.observe();
      const state = this._energyViewState || {}; if (!['ready', 'partial', 'no_data'].includes(state.status)) return;
      const report = this._buildExportDocument(this._now()); this._lastExportDocument = report; this._lastDownloadedExport = report; const isJson = format === 'json'; const contents = isJson ? `${JSON.stringify(report, null, 2)}\n` : this._buildCsv(report); const blob = new Blob([contents], { type: isJson ? 'application/json' : 'text/csv' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `smart-report-${report.period.key}.${isJson ? 'json' : 'csv'}`; anchor.click(); URL.revokeObjectURL(url);
    }
  }

  class HASmartReportsEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this._config = {}; }
    setConfig(config) { this._config = config && typeof config === 'object' ? { ...config } : {}; this._render(); }
    set hass(hass) {
      const language = languageOf(hass);
      const changed = language !== this._language;
      this._language = language; this._hass = hass;
      if (changed) this._render();
    }
    _render() {
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
        const input = document.createElement('textarea'); input.rows = 3; input.style.cssText = 'font:inherit;width:100%;box-sizing:border-box;padding:9px;background:var(--card-background-color,#fff);color:inherit;border:1px solid var(--divider-color,#d9e0ea);border-radius:8px';
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
    }
    _dispatch() { this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { ...this._config } }, bubbles: true, composed: true })); }
  }

  customElements.define('ha-smart-reports', HASmartReports);
  customElements.define('ha-smart-reports-editor', HASmartReportsEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === 'ha-smart-reports')) window.customCards.push({ type: 'ha-smart-reports', name: 'Smart Reports', description: 'Recorder-backed energy, automation, and system reports', preview: true, documentationURL: 'https://github.com/MacSiem/ha-smart-reports' });
  console.info(`%c HA-SMART-REPORTS %c v${VERSION} `, 'color: white; background: #2563eb; font-weight: 700;', 'color: #2563eb; background: #dbeafe;');
})();
