// Forretningslogikk: synlige enheter, grenser, egendefinerte scener, automasjoner og høy ventilasjon.
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { defaultData } from './store.js';
import { log } from './log.js';

export const KINDS = ['light', 'heat', 'vent', 'climate', 'button'];
export const VENT_MODES = ['away', 'low', 'normal', 'high'];
export const ICONS = ['home', 'pot', 'drop', 'sofa', 'book', 'moon', 'door', 'sun', 'tv', 'bed', 'star', 'leaf'];
export const CLIMATE_MODES = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];
const MAX_SCENES = 16;
const MAX_AUTOMATIONS = 30;
const RUN_WINDOW_MS = 10 * 60000;
const STATE_COOLDOWN_MS = 10 * 60000;
const REVERT_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 240];

const FAN_ALIASES = {
  low: ['low', 'lav', '1', 'min', 'minimum'],
  normal: ['medium', 'normal', 'mid', 'middle', '2', 'auto'],
  high: ['high', 'høy', '3', 'max', 'maximum', 'boost']
};

export const keyOf = (entityId) => createHash('sha1').update(entityId).digest('hex').slice(0, 10);
const newId = () => randomBytes(5).toString('hex');
const unavailable = (st) => !st || st.state === 'unavailable' || st.state === 'unknown';
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoDay = (d) => ((d.getDay() + 6) % 7) + 1; // man=1 … søn=7
const validTemp = (t) => typeof t === 'number' && t >= 0 && t <= 50;
const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
// Trådløse knapper: bruk trykk og hold (slipp er sjelden nyttig).
const buttonEvents = (st) => (st?.attributes?.event_types || []).filter((t) => !/release/i.test(t));
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));

// Lysområde: leietakeren ser 1–100 %, men lyset bruker bare utleiers område (f.eks. 21–50 % ekte).
const lightRange = (e) => {
  const lo = Math.min(99, Math.max(1, Math.round(Number(e.min_pct) || 1)));
  const hi = Math.min(100, Math.max(lo + 1, Math.round(Number(e.max_pct) || 100)));
  return [lo, hi];
};
export const toReal = (e, shown) => {
  if (shown <= 0) return 0;
  const [lo, hi] = lightRange(e);
  return Math.round(lo + ((Math.min(100, shown) - 1) * (hi - lo)) / 99);
};
export const toShown = (e, real) => {
  if (real <= 0) return 0;
  const [lo, hi] = lightRange(e);
  return Math.min(100, Math.max(1, Math.round(1 + ((real - lo) * 99) / (hi - lo))));
};

export class Engine extends EventEmitter {
  constructor({ ha, store }) {
    super();
    this.ha = ha;
    this.store = store;
    this.updateTimer = null;
    this.lastTemp = new Map();
    this.dimLoops = new Map(); // auto_id -> { timer, until, prefix }
    ha.on('state', (id, n, o) => this.onState(id, n, o));
    ha.on('status', () => this.changed());
    ha.on('ready', () => { this.recordSun(); this.ensureScenes(); });
    setInterval(() => this.tick().catch((e) => log.warn('Tidsstyrt sjekk feilet:', e.message)), 20000);
  }

  get data() {
    return this.store.data;
  }

  enabled() {
    return this.data.entities.filter((e) => e.enabled);
  }

  // Leietakerens egen rekkefølge (faller tilbake til utleiers).
  ordered() {
    const order = this.data.tenant_order || [];
    const idx = (e) => { const i = order.indexOf(e.entity_id); return i < 0 ? 1000 : i; };
    return this.enabled().map((e, i) => [e, i]).sort((a, b) => idx(a[0]) - idx(b[0]) || a[1] - b[1]).map(([e]) => e);
  }

  byKey(key) {
    return this.enabled().find((e) => keyOf(e.entity_id) === key);
  }

  byId(id) {
    return this.enabled().find((e) => e.entity_id === id);
  }

  state(e) {
    return this.ha.states.get(e.entity_id);
  }

  // ---------- verdier og grenser ----------

  tempRange(e) {
    const L = this.data.limits;
    const a = this.state(e)?.attributes || {};
    let lo = Number.isFinite(Number(e.min_temp)) ? Number(e.min_temp) : L.heat_min;
    let hi = Number.isFinite(Number(e.max_temp)) ? Number(e.max_temp) : L.heat_max;
    if (typeof a.min_temp === 'number') lo = Math.max(lo, Math.ceil(a.min_temp));
    if (typeof a.max_temp === 'number') hi = Math.min(hi, Math.floor(a.max_temp));
    return [Math.round(lo), Math.max(Math.round(lo), Math.round(hi))];
  }

  clampTemp(e, v, strict) {
    const [lo, hi] = this.tempRange(e);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Ugyldig temperatur');
    if (strict && (n > hi || n < lo)) throw new Error(`${e.label}: temperaturen må være mellom ${lo}° og ${hi}°`);
    return Math.min(hi, Math.max(lo, Math.round(n))); // hele grader
  }

  ventModes() {
    return this.data.limits.vent_allow_away ? VENT_MODES : VENT_MODES.filter((m) => m !== 'away');
  }

  climateModes(e) {
    const a = this.state(e)?.attributes || {};
    const list = (a.hvac_modes || ['off', 'heat']).filter((m) => CLIMATE_MODES.includes(m));
    return list.includes('off') ? list : ['off', ...list];
  }

  climateFans(e) {
    return (this.state(e)?.attributes?.fan_modes || []).map(String);
  }

  // strict = true for direkte kommandoer (avviser), false for lagrede verdier (justerer).
  sanitize(e, v, strict = false) {
    if (e.kind === 'light') {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) throw new Error('Ugyldig lysstyrke');
      return Math.min(100, Math.max(0, n));
    }
    if (e.kind === 'heat') return this.clampTemp(e, v, strict);
    if (e.kind === 'vent') {
      if (!VENT_MODES.includes(v)) throw new Error('Ugyldig ventilasjonsnivå');
      if (v === 'away' && !this.data.limits.vent_allow_away) {
        if (strict) throw new Error('Bortemodus på ventilasjonen er ikke tillatt');
        return 'low';
      }
      return v;
    }
    if (e.kind === 'climate') {
      const cur = this.currentValue(e) || {};
      const src = typeof v === 'object' && v ? v : {};
      const modes = this.climateModes(e);
      const mode = src.mode ?? cur.mode ?? 'off';
      if (!modes.includes(mode)) {
        if (strict) throw new Error(`${e.label} støtter ikke denne modusen`);
      }
      const out = { mode: modes.includes(mode) ? mode : 'off' };
      const t = src.temp ?? cur.temp;
      if (t != null) out.temp = this.clampTemp(e, t, strict && src.temp != null);
      const fans = this.climateFans(e);
      const fan = src.fan ?? cur.fan;
      if (fan != null && fans.includes(fan)) out.fan = fan;
      return out;
    }
    throw new Error('Kan ikke styres');
  }

  readTemp(e, t) {
    if (validTemp(t)) {
      this.lastTemp.set(e.entity_id, t);
      return t;
    }
    return this.lastTemp.get(e.entity_id) ?? null; // Zigbee-termostater kan rapportere søppel (f.eks. -2713)
  }

  currentValue(e) {
    if (e.kind === 'button') return null;
    const st = this.state(e);
    if (unavailable(st)) return null;
    const a = st.attributes || {};
    if (e.kind === 'light') {
      if (st.state !== 'on') return 0;
      return a.brightness == null ? 100 : toShown(e, Math.max(1, Math.round(a.brightness / 2.55)));
    }
    if (e.kind === 'heat') return this.readTemp(e, a.temperature);
    if (e.kind === 'vent') {
      if (String(a.preset_mode || '').toLowerCase() === 'away') return 'away';
      const fm = String(a.fan_mode || '').toLowerCase();
      for (const [mode, names] of Object.entries(FAN_ALIASES)) if (names.includes(fm)) return mode;
      const list = (a.fan_modes || []).map((m) => String(m).toLowerCase());
      const i = list.indexOf(fm);
      if (i < 0) return null;
      return i === 0 ? 'low' : i === list.length - 1 ? 'high' : 'normal';
    }
    if (e.kind === 'climate') {
      const out = { mode: st.state };
      const t = this.readTemp(e, a.temperature);
      if (t != null) out.temp = t;
      if (a.fan_mode != null) out.fan = String(a.fan_mode);
      return out;
    }
    return null;
  }

  // ---------- styring ----------

  fanModeFor(attrs, mode) {
    const list = attrs.fan_modes || ['low', 'medium', 'high'];
    const lower = list.map((m) => String(m).toLowerCase());
    for (const alias of FAN_ALIASES[mode]) {
      const i = lower.indexOf(alias);
      if (i >= 0) return list[i];
    }
    if (mode === 'low') return list[0];
    if (mode === 'high') return list[list.length - 1];
    return list[Math.floor((list.length - 1) / 2)];
  }

  async setValue(e, v) {
    const id = e.entity_id;
    const st = this.state(e);
    const a = st?.attributes || {};
    if (e.kind === 'light') {
      if (v <= 0) return this.ha.callService('light', 'turn_off', { entity_id: id });
      const modes = a.supported_color_modes || [];
      const dimmable = !(modes.length === 1 && modes[0] === 'onoff');
      return this.ha.callService('light', 'turn_on', dimmable ? { entity_id: id, brightness_pct: toReal(e, v) } : { entity_id: id });
    }
    if (e.kind === 'heat') {
      const data = { entity_id: id, temperature: Math.round(v) };
      if (st?.state === 'off' && (a.hvac_modes || []).includes('heat')) data.hvac_mode = 'heat';
      return this.ha.callService('climate', 'set_temperature', data);
    }
    if (e.kind === 'vent') {
      const presets = (a.preset_modes || []).map((p) => String(p).toLowerCase());
      if (v === 'away') return this.ha.callService('climate', 'set_preset_mode', { entity_id: id, preset_mode: 'away' });
      const cur = String(a.preset_mode || 'none').toLowerCase();
      if (cur !== 'none' && presets.includes('none')) {
        await this.ha.callService('climate', 'set_preset_mode', { entity_id: id, preset_mode: 'none' });
      }
      return this.ha.callService('climate', 'set_fan_mode', { entity_id: id, fan_mode: this.fanModeFor(a, v) });
    }
    if (e.kind === 'climate') {
      if (v.mode === 'off') return this.ha.callService('climate', 'set_hvac_mode', { entity_id: id, hvac_mode: 'off' });
      if (st?.state !== v.mode) await this.ha.callService('climate', 'set_hvac_mode', { entity_id: id, hvac_mode: v.mode });
      if (v.temp != null && Math.round(this.readTemp(e, a.temperature) ?? -99) !== v.temp) {
        await this.ha.callService('climate', 'set_temperature', { entity_id: id, temperature: v.temp });
      }
      if (v.fan != null && String(a.fan_mode) !== v.fan) await this.ha.callService('climate', 'set_fan_mode', { entity_id: id, fan_mode: v.fan });
    }
  }

  // Høy ventilasjon går tilbake av seg selv – også når en scene eller automasjon slår den på.
  noteVent(e, v) {
    const d = this.data;
    const prev = this.currentValue(e);
    if (v === 'high' && prev !== 'high') {
      const minutes = Math.min(d.tenant_prefs.boost_minutes || 30, d.limits.boost_max_minutes);
      d.boost = { entity_id: e.entity_id, until: Date.now() + minutes * 60000, return_to: prev && prev !== 'high' ? prev : 'normal' };
    } else if (v !== 'high' && d.boost?.entity_id === e.entity_id) {
      d.boost = null;
    }
    this.store.save();
  }

  async applyValues(values) {
    const jobs = this.enabled()
      .filter((e) => values[e.entity_id] !== undefined)
      .map((e) => {
        const v = this.sanitize(e, values[e.entity_id]);
        if (e.kind === 'vent') this.noteVent(e, v);
        return this.setValue(e, v).catch((err) => {
          log.warn(`Kunne ikke styre ${e.entity_id}:`, err.message);
          throw err;
        });
      });
    const res = await Promise.allSettled(jobs);
    const failed = res.filter((r) => r.status === 'rejected').length;
    if (failed) throw new Error(failed === jobs.length ? 'Fikk ikke kontakt med enhetene' : 'Noen enheter svarte ikke');
  }

  // ---------- scener ----------

  suggestedScenes() {
    const ents = this.enabled();
    const all = (kind, v) => Object.fromEntries(ents.filter((e) => e.kind === kind).map((e) => [e.entity_id, v]));
    const heat = (v) => Object.fromEntries(ents.filter((e) => e.kind === 'heat').map((e) => [e.entity_id, this.clampTemp(e, v)]));
    const vent = (v) => Object.fromEntries(ents.filter((e) => e.kind === 'vent').map((e) => [e.entity_id, this.sanitize(e, v)]));
    const list = [
      { name: 'Matlaging', icon: 'pot', values: { ...all('light', 90), ...vent('high') } },
      { name: 'Dusj', icon: 'drop', values: { ...heat(24), ...vent('high') } },
      { name: 'Kos', icon: 'sofa', values: all('light', 30) },
      { name: 'Lesestund', icon: 'book', values: all('light', 70) },
      { name: 'Natt', icon: 'moon', values: { ...all('light', 0), ...heat(20), ...vent('low') } },
      { name: 'Borte', icon: 'door', values: { ...all('light', 0), ...heat(18), ...vent('away') } }
    ];
    return list.filter((s) => Object.keys(s.values).length).map((s) => ({ id: newId(), ...s }));
  }

  ensureScenes() {
    if (this.data.scenes === null && this.enabled().length) {
      this.data.scenes = this.suggestedScenes();
      this.store.save();
      log.info(`Laget ${this.data.scenes.length} forslag til scener.`);
    }
    return this.data.scenes || [];
  }

  // Bare enheter som fortsatt er synlige, med verdier innenfor grensene.
  cleanValues(values) {
    const out = {};
    for (const e of this.enabled()) {
      if (values?.[e.entity_id] === undefined) continue;
      try { out[e.entity_id] = this.sanitize(e, values[e.entity_id]); } catch {}
    }
    return out;
  }

  valueMatches(e, cur, want) {
    if (cur === null || cur === undefined) return false;
    if (e.kind === 'light') {
      if ((cur > 0) !== (want > 0)) return false;
      return !(cur > 0 && Math.abs(toReal(e, cur) - toReal(e, want)) > 2);
    }
    if (e.kind === 'heat') return Math.abs(cur - want) <= 0.5;
    if (e.kind === 'climate') {
      if (cur.mode !== want.mode) return false;
      if (want.mode === 'off') return true;
      if (want.temp != null && (cur.temp == null || Math.abs(cur.temp - want.temp) > 0.5)) return false;
      return want.fan == null || cur.fan === want.fan;
    }
    return cur === want;
  }

  sceneMatches(values) {
    if (!Object.keys(values).length) return false;
    for (const e of this.enabled()) {
      if (values[e.entity_id] === undefined) continue;
      if (!this.valueMatches(e, this.currentValue(e), values[e.entity_id])) return false;
    }
    return true;
  }

  async activateScene(id) {
    const sc = this.ensureScenes().find((s) => s.id === id);
    if (!sc) throw new Error('Scenen finnes ikke');
    log.info('Scene:', sc.name);
    this.changed();
    await this.applyValues(this.cleanValues(sc.values));
  }

  // Verdier fra leietaker (nøkler) → entity_id, med streng kontroll.
  valuesFromKeys(input) {
    const values = {};
    for (const [key, v] of Object.entries(input || {})) {
      const e = this.byKey(key);
      if (e) values[e.entity_id] = this.sanitize(e, v, true);
    }
    return values;
  }

  toKeys(values) {
    return Object.fromEntries(Object.entries(this.cleanValues(values)).map(([id, v]) => [keyOf(id), v]));
  }

  saveScene(input) {
    const d = this.data;
    const scenes = this.ensureScenes();
    const name = String(input?.name || '').trim().slice(0, 30);
    if (!name) throw new Error('Scenen må ha et navn');
    const icon = ICONS.includes(input.icon) ? input.icon : 'star';
    const values = this.valuesFromKeys(input.values);
    if (!Object.keys(values).length) throw new Error('Velg minst én ting scenen skal styre');
    const existing = scenes.find((s) => s.id === input.id);
    if (existing) Object.assign(existing, { name, icon, values });
    else {
      if (scenes.length >= MAX_SCENES) throw new Error(`Du kan ha maks ${MAX_SCENES} scener`);
      scenes.push({ id: newId(), name, icon, values });
    }
    d.scenes = scenes;
    this.store.save();
  }

  deleteScene(id) {
    const d = this.data;
    d.scenes = this.ensureScenes().filter((s) => s.id !== id);
    for (const a of d.automations) if (a.action?.type === 'scene' && a.action.scene_id === id) a.enabled = false;
    this.store.save();
  }

  moveScene(id, dir) {
    const list = this.ensureScenes();
    const i = list.findIndex((s) => s.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.store.save();
  }

  moveEntity(key, dir) {
    const list = this.ordered().map((e) => e.entity_id);
    const e = this.byKey(key);
    if (!e) return;
    const i = list.indexOf(e.entity_id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.data.tenant_order = list;
    this.store.save();
  }

  // ---------- automasjoner ----------

  validateAutomation(input) {
    const t = input?.trigger || {};
    let trigger;
    if (t.type === 'time') {
      if (!isTime(t.at)) throw new Error('Ugyldig klokkeslett');
      trigger = { type: 'time', at: t.at };
    } else if (t.type === 'sunset' || t.type === 'sunrise') {
      const off = Math.round(Number(t.offset) || 0);
      if (off < -180 || off > 180) throw new Error('Forskyvningen må være innenfor ±3 timer');
      trigger = { type: t.type, offset: off };
    } else if (t.type === 'light') {
      const e = this.byKey(t.entity);
      if (!e || e.kind !== 'light') throw new Error('Velg et lys');
      if (!['on', 'off'].includes(t.to)) throw new Error('Velg på eller av');
      trigger = { type: 'light', entity_id: e.entity_id, to: t.to };
    } else if (t.type === 'humidity') {
      const e = this.byKey(t.entity);
      if (!e || e.kind !== 'vent') throw new Error('Velg ventilasjonen');
      const above = Math.round(Number(t.above));
      if (!(above >= 30 && above <= 95)) throw new Error('Luftfuktigheten må være mellom 30 og 95 %');
      trigger = { type: 'humidity', entity_id: e.entity_id, above };
    } else if (t.type === 'button') {
      const e = this.byKey(t.entity);
      if (!e || e.kind !== 'button') throw new Error('Velg en knapp');
      if (!buttonEvents(this.state(e)).includes(t.event)) throw new Error('Velg hvilket trykk');
      trigger = { type: 'button', entity_id: e.entity_id, event: t.event };
    } else throw new Error('Velg når automasjonen skal kjøre');

    let window = null;
    if (input.window && ['light', 'humidity', 'button'].includes(trigger.type)) {
      if (!isTime(input.window.from) || !isTime(input.window.to)) throw new Error('Ugyldig tidsrom');
      window = { from: input.window.from, to: input.window.to };
    }
    const days = [...new Set((input.days || []).map(Number).filter((n) => n >= 1 && n <= 7))].sort();
    if (!days.length) throw new Error('Velg minst én dag');

    const a = input.action || {};
    let action;
    if (a.type === 'scene') {
      if (!this.ensureScenes().some((s) => s.id === a.scene_id)) throw new Error('Velg en scene');
      action = { type: 'scene', scene_id: a.scene_id };
    } else if (a.type === 'lights_off') action = { type: 'lights_off' };
    else if (a.type === 'dim') {
      const ids = [...new Set((a.entities || []).map((k) => this.byKey(k)).filter((e) => e && e.kind === 'light').map((e) => e.entity_id))];
      if (!ids.length) throw new Error('Velg minst ett lys å dimme');
      if (!['up', 'down'].includes(a.dir)) throw new Error('Velg lysere eller mørkere');
      const step = Number(a.step);
      if (![5, 10, 20].includes(step)) throw new Error('Ugyldig trinn');
      action = { type: 'dim', entities: ids, dir: a.dir, step };
    } else if (a.type === 'set') {
      const values = this.valuesFromKeys(a.values);
      if (!Object.keys(values).length) throw new Error('Velg minst én enhet automasjonen skal styre');
      action = { type: 'set', values };
    } else throw new Error('Velg hva som skal skje');

    const revert = Math.round(Number(input.revert_after) || 0);
    if (!REVERT_OPTIONS.includes(revert)) throw new Error('Ugyldig tid for å gjøre om');
    return { trigger, window, days, action, revert_after: revert };
  }

  saveAutomation(input) {
    const d = this.data;
    const clean = this.validateAutomation(input);
    let auto = d.automations.find((x) => x.id === input.id);
    if (auto) Object.assign(auto, clean);
    else {
      if (d.automations.length >= MAX_AUTOMATIONS) throw new Error(`Du kan ha maks ${MAX_AUTOMATIONS} automasjoner`);
      auto = { id: newId(), enabled: true, ...clean };
      d.automations.push(auto);
    }
    this.markIfPassed(auto);
    this.store.save();
  }

  // Ikke kjør med en gang hvis tidspunktet i dag allerede har passert.
  markIfPassed(auto) {
    const d = this.data;
    const due = this.dueToday(auto, new Date());
    if (due && due <= Date.now()) d.auto_runs[auto.id] = dateKey(new Date());
    else delete d.auto_runs[auto.id];
  }

  recordSun() {
    const sun = this.ha.states.get('sun.sun')?.attributes;
    if (!sun) return;
    const cache = this.data.sun_cache;
    for (const [field, kind] of [['next_rising', 'sunrise'], ['next_setting', 'sunset']]) {
      if (!sun[field]) continue;
      const t = new Date(sun[field]);
      if (Number.isNaN(t.getTime())) continue;
      const k = dateKey(t);
      cache[k] = { ...(cache[k] || {}), [kind]: t.getTime() };
    }
    const keys = Object.keys(cache).sort();
    while (keys.length > 5) delete cache[keys.shift()];
    this.store.save();
  }

  dueToday(auto, now) {
    const t = auto.trigger;
    if (t.type === 'time') {
      const [h, m] = t.at.split(':').map(Number);
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    }
    if (t.type === 'sunset' || t.type === 'sunrise') {
      const base = this.data.sun_cache[dateKey(now)]?.[t.type];
      return base ? base + (t.offset || 0) * 60000 : null;
    }
    return null;
  }

  inWindow(auto, now) {
    if (!auto.window) return true;
    const m = now.getHours() * 60 + now.getMinutes();
    const from = minutesOf(auto.window.from);
    const to = minutesOf(auto.window.to);
    return from <= to ? m >= from && m < to : m >= from || m < to; // over midnatt
  }

  actionEntities(action) {
    if (action.type === 'scene') return Object.keys(this.ensureScenes().find((s) => s.id === action.scene_id)?.values || {});
    if (action.type === 'lights_off') return this.enabled().filter((e) => e.kind === 'light').map((e) => e.entity_id);
    if (action.type === 'set') return Object.keys(action.values || {});
    if (action.type === 'dim') return action.entities || [];
    if (action.type === 'heat') return this.enabled().filter((e) => e.kind === 'heat').map((e) => e.entity_id);
    return [];
  }

  async runAutomation(auto) {
    const a = auto.action;
    log.info('Automasjon kjører:', this.describeAutomation(auto));
    if (auto.revert_after) {
      const snapshot = {};
      for (const id of this.actionEntities(a)) {
        const e = this.byId(id);
        const v = e ? this.currentValue(e) : null;
        if (v !== null && v !== undefined) snapshot[id] = v;
      }
      if (Object.keys(snapshot).length) {
        this.data.reverts = (this.data.reverts || []).filter((r) => r.auto_id !== auto.id);
        this.data.reverts.push({ auto_id: auto.id, at: Date.now() + auto.revert_after * 60000, values: snapshot });
        this.store.save();
      }
    }
    if (a.type === 'scene') return this.activateScene(a.scene_id);
    if (a.type === 'lights_off') return this.applyValues(Object.fromEntries(this.actionEntities(a).map((id) => [id, 0])));
    if (a.type === 'set') return this.applyValues(this.cleanValues(a.values));
    if (a.type === 'dim') return this.startDim(auto);
    if (a.type === 'heat') return this.applyValues(Object.fromEntries(this.actionEntities(a).map((id) => [id, a.value])));
  }

  describeAutomation(auto) {
    const t = auto.trigger;
    const label = (id) => this.data.entities.find((e) => e.entity_id === id)?.label || id;
    let when;
    if (t.type === 'time') when = `kl. ${t.at}`;
    else if (t.type === 'sunset' || t.type === 'sunrise') when = `${t.type === 'sunset' ? 'solnedgang' : 'soloppgang'}${t.offset ? ` ${t.offset > 0 ? '+' : ''}${t.offset} min` : ''}`;
    else if (t.type === 'light') when = `${label(t.entity_id)} slås ${t.to === 'on' ? 'på' : 'av'}`;
    else if (t.type === 'button') when = `${label(t.entity_id)}: ${t.event}`;
    else when = `luftfuktighet over ${t.above} %`;
    const a = auto.action;
    const what = a.type === 'scene' ? `scene ${this.ensureScenes().find((s) => s.id === a.scene_id)?.name || '(slettet)'}`
      : a.type === 'lights_off' ? 'slå av alle lys'
      : a.type === 'set' ? `styr ${Object.keys(a.values).map(label).join(', ')}`
      : a.type === 'dim' ? `dim ${a.entities.map(label).join(', ')} ${a.dir === 'up' ? 'opp' : 'ned'}`
      : `varme ${a.value}°`;
    return `${when}: ${what}${auto.revert_after ? ` (gjør om etter ${auto.revert_after} min)` : ''}`;
  }

  // Ett dimmetrinn for hvert lys. Holdes knappen inne, gjentas trinnet til knappen slippes (maks 8 sek).
  async startDim(auto) {
    const a = auto.action;
    const t = auto.trigger;
    this.stopDim(auto.id);
    const levels = new Map();
    for (const id of a.entities) {
      const e = this.byId(id);
      if (e) levels.set(id, this.currentValue(e) ?? 0);
    }
    const step = async () => {
      const values = {};
      for (const [id, cur] of levels) {
        if (a.dir === 'down' && cur <= 0) continue; // ikke slå på et lys som er av ved nedtrinn
        const next = a.dir === 'up' ? Math.min(100, (cur || 0) + a.step) : Math.max(1, cur - a.step);
        levels.set(id, next);
        values[id] = next;
      }
      if (Object.keys(values).length) await this.applyValues(values).catch(() => {});
    };
    await step();
    const hold = t.type === 'button' && /hold|long/i.test(t.event || '');
    if (!hold) return;
    const prefix = t.event.replace(/_?(hold|long_press|long)$/i, '');
    const loop = { entity: t.entity_id, prefix, until: Date.now() + 8000, busy: false };
    loop.timer = setInterval(async () => {
      if (Date.now() > loop.until) return this.stopDim(auto.id);
      if (loop.busy) return;
      loop.busy = true;
      await step();
      loop.busy = false;
    }, 450);
    this.dimLoops.set(auto.id, loop);
  }

  stopDim(id) {
    const loop = this.dimLoops.get(id);
    if (!loop) return;
    clearInterval(loop.timer);
    this.dimLoops.delete(id);
  }

  async fire(auto, reason) {
    const d = this.data;
    d.auto_last[auto.id] = Date.now();
    this.store.save();
    try {
      await this.runAutomation(auto);
    } catch (err) {
      log.warn(`Automasjon feilet (${reason}):`, err.message);
    }
    this.changed();
  }

  async checkAutomations() {
    const d = this.data;
    const now = new Date();
    const today = dateKey(now);
    for (const auto of d.automations) {
      if (!auto.enabled || !auto.days.includes(isoDay(now)) || d.auto_runs[auto.id] === today) continue;
      const due = this.dueToday(auto, now);
      if (due == null || now.getTime() < due || now.getTime() - due > RUN_WINDOW_MS) continue;
      d.auto_runs[auto.id] = today;
      await this.fire(auto, 'tid');
    }
  }

  // Hendelsesstyrte automasjoner (lys på/av, luftfuktighet).
  checkStateTriggers(entityId, newState, oldState) {
    const d = this.data;
    const now = new Date();
    // Slipp av en knapp stopper pågående dimming fra samme knapp.
    const ev = newState?.attributes?.event_type;
    if (ev && /release/i.test(ev) && newState.state !== oldState?.state) {
      const prefix = ev.replace(/_?(short_|long_)?release$/i, '');
      for (const [id, loop] of this.dimLoops) if (loop.entity === entityId && loop.prefix === prefix) this.stopDim(id);
    }
    for (const auto of d.automations) {
      const t = auto.trigger;
      if (!auto.enabled || t.entity_id !== entityId) continue;
      if (!auto.days.includes(isoDay(now)) || !this.inWindow(auto, now)) continue;
      const cooldown = t.type === 'button' ? 800 : t.type === 'light' ? 3000 : STATE_COOLDOWN_MS;
      if (Date.now() - (d.auto_last[auto.id] || 0) < cooldown) continue;
      let hit = false;
      if (t.type === 'button') {
        // En hendelse gir ny tidsstempel-tilstand. Ikke reager når HA starter (forrige tilstand mangler/utilgjengelig).
        hit = Boolean(newState && oldState && !unavailable(oldState) && !unavailable(newState) && newState.state !== oldState.state && newState.attributes?.event_type === t.event);
      }
      if (t.type === 'light') {
        const was = oldState?.state;
        const is = newState?.state;
        hit = was && is && was !== is && is === t.to && ['on', 'off'].includes(was);
      } else if (t.type === 'humidity') {
        const before = oldState?.attributes?.current_humidity;
        const after = newState?.attributes?.current_humidity;
        hit = typeof after === 'number' && after > t.above && (typeof before !== 'number' || before <= t.above);
      }
      if (hit) this.fire(auto, t.type);
    }
  }

  async runReverts() {
    const d = this.data;
    const due = (d.reverts || []).filter((r) => Date.now() >= r.at);
    if (!due.length) return;
    d.reverts = d.reverts.filter((r) => Date.now() < r.at);
    this.store.save();
    for (const r of due) {
      log.info('Gjør om automasjon');
      try { await this.applyValues(this.cleanValues(r.values)); } catch (err) { log.warn('Kunne ikke gjøre om:', err.message); }
    }
    this.changed();
  }

  // ---------- leietaker ----------

  touch() {
    this.data.last_tenant_activity = new Date().toISOString();
    this.store.save();
  }

  requireEdit() {
    if (!this.data.tenant_can_edit_scenes) throw new Error('Utleier har låst scener og automasjoner');
  }

  async handleTenant(cmd) {
    this.touch();
    const d = this.data;
    switch (cmd?.type) {
      case 'set': {
        const e = this.byKey(cmd.key);
        if (!e) throw new Error('Ukjent enhet');
        if (unavailable(this.state(e))) throw new Error(`${e.label} svarer ikke akkurat nå`);
        const v = this.sanitize(e, cmd.value, true);
        if (e.kind === 'vent') this.noteVent(e, v);
        await this.setValue(e, v);
        break;
      }
      case 'all_off':
        await this.applyValues(Object.fromEntries(this.enabled().filter((e) => e.kind === 'light').map((e) => [e.entity_id, 0])));
        break;
      case 'scene':
        await this.activateScene(cmd.id);
        break;
      case 'scene_save':
        this.requireEdit();
        this.saveScene(cmd.scene);
        break;
      case 'scene_delete':
        this.requireEdit();
        this.deleteScene(cmd.id);
        break;
      case 'scene_move':
        this.moveScene(cmd.id, Number(cmd.dir));
        break;
      case 'entity_move':
        this.moveEntity(cmd.key, Number(cmd.dir));
        break;
      case 'auto_save':
        this.requireEdit();
        this.saveAutomation(cmd.automation);
        break;
      case 'auto_delete':
        this.requireEdit();
        d.automations = d.automations.filter((a) => a.id !== cmd.id);
        delete d.auto_runs[cmd.id];
        d.reverts = (d.reverts || []).filter((r) => r.auto_id !== cmd.id);
        this.store.save();
        break;
      case 'auto_toggle': {
        this.requireEdit();
        const a = d.automations.find((x) => x.id === cmd.id);
        if (!a) throw new Error('Automasjonen finnes ikke');
        a.enabled = Boolean(cmd.enabled);
        if (a.enabled) this.markIfPassed(a);
        this.store.save();
        break;
      }
      case 'auto_run': {
        this.requireEdit();
        const a = d.automations.find((x) => x.id === cmd.id);
        if (!a) throw new Error('Automasjonen finnes ikke');
        await this.fire(a, 'test');
        break;
      }
      case 'prefs': {
        if (cmd.boost_minutes !== undefined) {
          const m = Number(cmd.boost_minutes);
          if (![15, 30, 60, 90, 120].includes(m) || m > d.limits.boost_max_minutes) throw new Error('Ugyldig varighet');
          d.tenant_prefs.boost_minutes = m;
        }
        this.store.save();
        break;
      }
      default:
        throw new Error('Ukjent kommando');
    }
    this.changed();
  }

  publicAutomation(a) {
    const t = { ...a.trigger };
    if (t.entity_id) { t.entity = keyOf(t.entity_id); delete t.entity_id; }
    const action = a.action.type === 'dim' ? { ...a.action, entities: a.action.entities.map(keyOf) }
      : a.action.type === 'set' ? { type: 'set', values: this.toKeys(a.action.values) } : a.action.type === 'heat'
      ? { type: 'set', values: this.toKeys(Object.fromEntries(this.actionEntities(a.action).map((id) => [id, a.action.value]))) }
      : { ...a.action };
    return { id: a.id, enabled: a.enabled, trigger: t, window: a.window || null, days: a.days, action, revert_after: a.revert_after || 0 };
  }

  tenantView() {
    const d = this.data;
    const sunToday = d.sun_cache[dateKey(new Date())] || {};
    return {
      connected: this.ha.connected,
      can_edit: d.tenant_can_edit_scenes,
      icons: ICONS,
      revert_options: REVERT_OPTIONS,
      scenes: this.ensureScenes().map((s) => {
        const values = this.cleanValues(s.values);
        return { id: s.id, name: s.name, icon: s.icon, values: this.toKeys(values), active: this.sceneMatches(values) };
      }),
      automations: d.automations.map((a) => this.publicAutomation(a)),
      sun: { sunrise: sunToday.sunrise || null, sunset: sunToday.sunset || null },
      limits: { boost_max_minutes: d.limits.boost_max_minutes, vent_allow_away: d.limits.vent_allow_away },
      prefs: { boost_minutes: Math.min(d.tenant_prefs.boost_minutes || 30, d.limits.boost_max_minutes) },
      boost_options: [15, 30, 60, 90, 120].filter((m) => m <= d.limits.boost_max_minutes),
      boost: d.boost ? { key: keyOf(d.boost.entity_id), until: d.boost.until, return_to: d.boost.return_to } : null,
      entities: this.ordered().map((e) => {
        const st = this.state(e);
        const a = st?.attributes || {};
        const base = { key: keyOf(e.entity_id), kind: e.kind, label: e.label, available: !unavailable(st), value: this.currentValue(e) };
        const cur = typeof a.current_temperature === 'number' && a.current_temperature > -30 && a.current_temperature < 60 ? a.current_temperature : null;
        if (e.kind === 'light') {
          const modes = a.supported_color_modes || [];
          base.dimmable = !(modes.length === 1 && modes[0] === 'onoff');
        } else if (e.kind === 'heat') {
          [base.min, base.max] = this.tempRange(e);
          base.current = cur;
          base.heating = a.hvac_action === 'heating';
        } else if (e.kind === 'vent') {
          base.modes = this.ventModes();
          base.humidity = typeof a.current_humidity === 'number' ? a.current_humidity : null;
          base.temperature = typeof a.current_temperature === 'number' ? a.current_temperature : null;
        } else if (e.kind === 'button') {
          base.value = null;
          base.events = buttonEvents(st);
        } else if (e.kind === 'climate') {
          [base.min, base.max] = this.tempRange(e);
          base.current = cur;
          base.modes = this.climateModes(e);
          base.fans = this.climateFans(e);
          base.action = a.hvac_action || null;
        }
        return base;
      })
    };
  }

  // ---------- utleier ----------

  adminView(extra = {}) {
    const d = this.data;
    const labels = new Map(d.entities.map((e) => [e.entity_id, e.label]));
    return {
      entities: d.entities.map((e) => {
        const st = this.state(e);
        return { ...e, available: !unavailable(st), value: e.enabled ? this.currentValue(e) : null, friendly_name: st?.attributes?.friendly_name || e.entity_id };
      }),
      limits: d.limits,
      tenant_can_edit_scenes: d.tenant_can_edit_scenes,
      scenes: this.ensureScenes().map((s) => ({ id: s.id, name: s.name, icon: s.icon, parts: Object.keys(this.cleanValues(s.values)).map((id) => labels.get(id) || id) })),
      automations: d.automations.map((a) => ({ id: a.id, enabled: a.enabled, label: this.describeAutomation(a), days: a.days })),
      alerts: d.alerts,
      status: {
        ha_connected: this.ha.connected,
        active_scenes: this.ensureScenes().filter((s) => this.sceneMatches(this.cleanValues(s.values))).map((s) => s.name),
        boost: d.boost,
        last_tenant_activity: d.last_tenant_activity,
        ...extra
      }
    };
  }

  saveAdmin(body) {
    const d = this.data;
    const errors = [];
    if (Array.isArray(body.entities)) {
      const seen = new Set();
      const ents = [];
      for (const e of body.entities) {
        const id = String(e.entity_id || '');
        if (!/^(light|climate|event)\.[a-z0-9_]+$/.test(id) || seen.has(id)) { errors.push(`Ugyldig enhet: ${id}`); continue; }
        const kind = id.startsWith('light.') ? 'light' : id.startsWith('event.') ? 'button' : ['vent', 'climate'].includes(e.kind) ? e.kind : 'heat';
        seen.add(id);
        const ent = { entity_id: id, label: String(e.label || '').trim().slice(0, 40) || id, kind, enabled: e.enabled !== false };
        if (kind === 'light') {
          const lo = Math.round(Number(e.min_pct ?? 1));
          const hi = Math.round(Number(e.max_pct ?? 100));
          if (!(lo >= 1 && lo <= 99 && hi >= 2 && hi <= 100 && hi > lo)) errors.push(`${ent.label}: laveste må være lavere enn høyeste (1–100 %)`);
          else if (lo !== 1 || hi !== 100) Object.assign(ent, { min_pct: lo, max_pct: hi });
        }
        if (kind === 'heat' || kind === 'climate') {
          const lo = Math.round(Number(e.min_temp ?? d.limits.heat_min));
          const hi = Math.round(Number(e.max_temp ?? d.limits.heat_max));
          if (!(lo >= 5 && hi <= 35 && hi > lo)) errors.push(`${ent.label}: laveste temperatur må være lavere enn høyeste (5–35°)`);
          else Object.assign(ent, { min_temp: lo, max_temp: hi });
        }
        ents.push(ent);
      }
      d.entities = ents;
    }
    if (body.limits) {
      const L = body.limits;
      const boost = Math.round(Number(L.boost_max_minutes));
      if ([15, 30, 60, 90, 120].includes(boost)) d.limits.boost_max_minutes = boost;
      else errors.push('Ugyldig maks tid for høy ventilasjon');
      d.limits.vent_allow_away = L.vent_allow_away !== false;
    }
    if (typeof body.tenant_can_edit_scenes === 'boolean') d.tenant_can_edit_scenes = body.tenant_can_edit_scenes;
    if (body.alerts) {
      const svc = String(body.alerts.notify_service || '').trim();
      if (svc && !/^notify\.[a-z0-9_]+$/.test(svc)) errors.push('Varslingstjenesten må se ut som notify.mobile_app_telefon');
      else d.alerts.notify_service = svc;
      if (Array.isArray(body.alerts.entities)) {
        d.alerts.entities = [...new Set(body.alerts.entities.map(String).filter((id) => /^binary_sensor\.[a-z0-9_]+$/.test(id)))];
      }
    }
    if (body.reset_scenes === true) {
      d.scenes = null;
      d.automations = d.automations.filter((a) => a.action.type !== 'scene');
    }
    if (d.boost && !d.entities.some((e) => e.enabled && e.entity_id === d.boost.entity_id)) d.boost = null;
    this.ensureScenes();
    this.store.save();
    this.changed();
    return errors;
  }

  resetTenant() {
    const base = defaultData();
    const d = this.data;
    d.scenes = null;
    d.automations = [];
    d.auto_runs = {};
    d.auto_last = {};
    d.reverts = [];
    d.tenant_order = [];
    d.tenant_prefs = base.tenant_prefs;
    d.boost = null;
    d.last_tenant_activity = null;
    this.ensureScenes();
    this.store.save();
    this.changed();
  }

  // ---------- hendelser og tidsstyring ----------

  onState(entityId, newState, oldState) {
    if (entityId === 'sun.sun') this.recordSun();
    if (this.data.entities.some((e) => e.enabled && e.entity_id === entityId)) {
      this.changed();
      this.checkStateTriggers(entityId, newState, oldState);
    }
    if (this.data.alerts.entities.includes(entityId) && newState?.state === 'on' && oldState && oldState.state !== 'on' && !unavailable(oldState)) {
      this.notify(`${newState.attributes?.friendly_name || entityId} er aktiv`).catch((e) => log.warn('Varsling feilet:', e.message));
    }
  }

  async notify(message) {
    const svc = this.data.alerts.notify_service;
    log.info('Varsel:', message);
    if (svc) {
      const [domain, service] = svc.split('.');
      return this.ha.callService(domain, service, { title: 'Hybel', message });
    }
    return this.ha.callService('persistent_notification', 'create', { title: 'Hybel', message });
  }

  async tick() {
    if (!this.ha.connected) return;
    const d = this.data;
    if (d.boost && Date.now() >= d.boost.until) {
      const b = d.boost;
      d.boost = null;
      this.store.save();
      const e = this.enabled().find((x) => x.entity_id === b.entity_id);
      if (e && this.currentValue(e) === 'high') {
        log.info('Høy ventilasjon er ferdig – går tilbake til', b.return_to);
        await this.setValue(e, this.sanitize(e, b.return_to));
      }
      this.changed();
    }
    await this.runReverts();
    await this.checkAutomations();
  }

  changed() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.emit('update');
    }, 40);
  }
}
