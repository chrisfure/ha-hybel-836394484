// Forretningslogikk: synlige enheter, grenser, egendefinerte scener, automasjoner og høy ventilasjon.
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { defaultData } from './store.js';
import { log } from './log.js';

export const KINDS = ['light', 'heat', 'vent'];
export const VENT_MODES = ['away', 'low', 'normal', 'high'];
export const ICONS = ['home', 'pot', 'drop', 'sofa', 'book', 'moon', 'door', 'sun', 'tv', 'bed', 'star', 'leaf'];
const MAX_SCENES = 12;
const MAX_AUTOMATIONS = 20;
const RUN_WINDOW_MS = 10 * 60000;

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
    this.lastHeat = new Map();
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

  byKey(key) {
    return this.enabled().find((e) => keyOf(e.entity_id) === key);
  }

  state(e) {
    return this.ha.states.get(e.entity_id);
  }

  // ---------- verdier og grenser ----------

  clampHeat(v) {
    const { heat_min, heat_max } = this.data.limits;
    const n = Math.round(Number(v)); // hele grader – termostaten tåler ikke halve
    if (!Number.isFinite(n)) return heat_min;
    return Math.min(heat_max, Math.max(heat_min, n));
  }

  ventModes() {
    return this.data.limits.vent_allow_away ? VENT_MODES : VENT_MODES.filter((m) => m !== 'away');
  }

  // strict = true for direkte kommandoer (avviser), false for lagrede verdier (justerer).
  sanitize(e, v, strict = false) {
    if (e.kind === 'light') {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) throw new Error('Ugyldig lysstyrke');
      return Math.min(100, Math.max(0, n));
    }
    if (e.kind === 'heat') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error('Ugyldig temperatur');
      const { heat_min, heat_max } = this.data.limits;
      if (strict && (n > heat_max || n < heat_min)) throw new Error(`Temperaturen må være mellom ${heat_min}° og ${heat_max}°`);
      return this.clampHeat(n);
    }
    if (e.kind === 'vent') {
      if (!VENT_MODES.includes(v)) throw new Error('Ugyldig ventilasjonsnivå');
      if (v === 'away' && !this.data.limits.vent_allow_away) {
        if (strict) throw new Error('Bortemodus på ventilasjonen er ikke tillatt');
        return 'low';
      }
      return v;
    }
    throw new Error('Ukjent enhetstype');
  }

  currentValue(e) {
    const st = this.state(e);
    if (unavailable(st)) return null;
    const a = st.attributes || {};
    if (e.kind === 'light') {
      if (st.state !== 'on') return 0;
      return a.brightness == null ? 100 : toShown(e, Math.max(1, Math.round(a.brightness / 2.55)));
    }
    if (e.kind === 'heat') {
      // Noen Zigbee-termostater rapporterer kortvarig søppelverdier (f.eks. 3840 eller -2713).
      const t = a.temperature;
      if (typeof t === 'number' && t >= 0 && t <= 50) {
        this.lastHeat.set(e.entity_id, t);
        return t;
      }
      return this.lastHeat.get(e.entity_id) ?? null;
    }
    if (e.kind === 'vent') {
      if (String(a.preset_mode || '').toLowerCase() === 'away') return 'away';
      const fm = String(a.fan_mode || '').toLowerCase();
      for (const [mode, names] of Object.entries(FAN_ALIASES)) if (names.includes(fm)) return mode;
      const list = (a.fan_modes || []).map((m) => String(m).toLowerCase());
      const i = list.indexOf(fm);
      if (i < 0) return null;
      return i === 0 ? 'low' : i === list.length - 1 ? 'high' : 'normal';
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
    const heat = (v) => all('heat', this.clampHeat(v));
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

  sceneMatches(values) {
    const ids = Object.keys(values);
    if (!ids.length) return false;
    for (const e of this.enabled()) {
      if (values[e.entity_id] === undefined) continue;
      const cur = this.currentValue(e);
      const want = values[e.entity_id];
      if (cur === null) return false;
      if (e.kind === 'light') {
        if ((cur > 0) !== (want > 0)) return false;
        if (cur > 0 && Math.abs(toReal(e, cur) - toReal(e, want)) > 2) return false;
      } else if (e.kind === 'heat') {
        if (Math.abs(cur - want) > 0.5) return false;
      } else if (cur !== want) return false;
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

  saveScene(input) {
    const d = this.data;
    const scenes = this.ensureScenes();
    const name = String(input?.name || '').trim().slice(0, 30);
    if (!name) throw new Error('Scenen må ha et navn');
    const icon = ICONS.includes(input.icon) ? input.icon : 'star';
    const values = {};
    for (const [key, v] of Object.entries(input.values || {})) {
      const e = this.byKey(key);
      if (e) values[e.entity_id] = this.sanitize(e, v, true);
    }
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
    // Automasjoner som brukte scenen slås av.
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

  // ---------- automasjoner ----------

  validateAutomation(input) {
    const t = input?.trigger || {};
    let trigger;
    if (t.type === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t.at))) throw new Error('Ugyldig klokkeslett');
      trigger = { type: 'time', at: t.at };
    } else if (t.type === 'sunset' || t.type === 'sunrise') {
      const off = Math.round(Number(t.offset) || 0);
      if (off < -180 || off > 180) throw new Error('Forskyvningen må være innenfor ±3 timer');
      trigger = { type: t.type, offset: off };
    } else throw new Error('Velg når automasjonen skal kjøre');
    const days = [...new Set((input.days || []).map(Number).filter((n) => n >= 1 && n <= 7))].sort();
    if (!days.length) throw new Error('Velg minst én dag');
    const a = input.action || {};
    let action;
    if (a.type === 'scene') {
      if (!this.ensureScenes().some((s) => s.id === a.scene_id)) throw new Error('Velg en scene');
      action = { type: 'scene', scene_id: a.scene_id };
    } else if (a.type === 'lights_off') action = { type: 'lights_off' };
    else if (a.type === 'heat') {
      if (!this.enabled().some((e) => e.kind === 'heat')) throw new Error('Ingen varme å styre');
      action = { type: 'heat', value: this.sanitize({ kind: 'heat' }, a.value, true) };
    } else throw new Error('Velg hva som skal skje');
    return { trigger, days, action };
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
    // Ikke kjør med en gang hvis tidspunktet i dag allerede har passert.
    const due = this.dueToday(auto, new Date());
    if (due && due <= Date.now()) d.auto_runs[auto.id] = dateKey(new Date());
    else delete d.auto_runs[auto.id];
    this.store.save();
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

  // Tidspunkt (ms) automasjonen skal kjøre i dag, eller null.
  dueToday(auto, now) {
    if (auto.trigger.type === 'time') {
      const [h, m] = auto.trigger.at.split(':').map(Number);
      const t = new Date(now);
      t.setHours(h, m, 0, 0);
      return t.getTime();
    }
    const base = this.data.sun_cache[dateKey(now)]?.[auto.trigger.type];
    return base ? base + (auto.trigger.offset || 0) * 60000 : null;
  }

  async runAutomation(auto) {
    const a = auto.action;
    log.info('Automasjon kjører:', this.describeAutomation(auto));
    if (a.type === 'scene') return this.activateScene(a.scene_id);
    if (a.type === 'lights_off') return this.applyValues(Object.fromEntries(this.enabled().filter((e) => e.kind === 'light').map((e) => [e.entity_id, 0])));
    if (a.type === 'heat') return this.applyValues(Object.fromEntries(this.enabled().filter((e) => e.kind === 'heat').map((e) => [e.entity_id, a.value])));
  }

  describeAutomation(auto) {
    const when = auto.trigger.type === 'time' ? `kl. ${auto.trigger.at}` : `${auto.trigger.type === 'sunset' ? 'solnedgang' : 'soloppgang'}${auto.trigger.offset ? ` ${auto.trigger.offset > 0 ? '+' : ''}${auto.trigger.offset} min` : ''}`;
    const sc = auto.action.type === 'scene' ? this.ensureScenes().find((s) => s.id === auto.action.scene_id)?.name || '(slettet scene)' : null;
    const what = sc ? `scene ${sc}` : auto.action.type === 'lights_off' ? 'slå av alle lys' : `varme ${auto.action.value}°`;
    return `${when}: ${what}`;
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
      this.store.save();
      try {
        await this.runAutomation(auto);
      } catch (err) {
        log.warn('Automasjon feilet:', err.message);
      }
    }
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
        this.requireEdit();
        this.moveScene(cmd.id, Number(cmd.dir));
        break;
      case 'auto_save':
        this.requireEdit();
        this.saveAutomation(cmd.automation);
        break;
      case 'auto_delete':
        this.requireEdit();
        d.automations = d.automations.filter((a) => a.id !== cmd.id);
        delete d.auto_runs[cmd.id];
        this.store.save();
        break;
      case 'auto_toggle': {
        this.requireEdit();
        const a = d.automations.find((x) => x.id === cmd.id);
        if (!a) throw new Error('Automasjonen finnes ikke');
        a.enabled = Boolean(cmd.enabled);
        if (a.enabled) {
          const due = this.dueToday(a, new Date());
          if (due && due <= Date.now()) d.auto_runs[a.id] = dateKey(new Date());
        }
        this.store.save();
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

  publicScene(s) {
    const values = Object.fromEntries(Object.entries(this.cleanValues(s.values)).map(([id, v]) => [keyOf(id), v]));
    return { id: s.id, name: s.name, icon: s.icon, values, active: this.sceneMatches(this.cleanValues(s.values)) };
  }

  tenantView() {
    const d = this.data;
    const sunToday = d.sun_cache[dateKey(new Date())] || {};
    return {
      connected: this.ha.connected,
      can_edit: d.tenant_can_edit_scenes,
      icons: ICONS,
      scenes: this.ensureScenes().map((s) => this.publicScene(s)),
      automations: d.automations.map((a) => ({ ...a, label: this.describeAutomation(a) })),
      sun: { sunrise: sunToday.sunrise || null, sunset: sunToday.sunset || null },
      limits: { heat_min: d.limits.heat_min, heat_max: d.limits.heat_max, boost_max_minutes: d.limits.boost_max_minutes, vent_allow_away: d.limits.vent_allow_away },
      prefs: { boost_minutes: Math.min(d.tenant_prefs.boost_minutes || 30, d.limits.boost_max_minutes) },
      boost_options: [15, 30, 60, 90, 120].filter((m) => m <= d.limits.boost_max_minutes),
      boost: d.boost ? { key: keyOf(d.boost.entity_id), until: d.boost.until, return_to: d.boost.return_to } : null,
      entities: this.enabled().map((e) => {
        const st = this.state(e);
        const a = st?.attributes || {};
        const base = { key: keyOf(e.entity_id), kind: e.kind, label: e.label, available: !unavailable(st), value: this.currentValue(e) };
        if (e.kind === 'light') {
          const modes = a.supported_color_modes || [];
          base.dimmable = !(modes.length === 1 && modes[0] === 'onoff');
        } else if (e.kind === 'heat') {
          base.current = typeof a.current_temperature === 'number' && a.current_temperature > -30 && a.current_temperature < 60 ? a.current_temperature : null;
          base.heating = a.hvac_action === 'heating';
        } else if (e.kind === 'vent') {
          base.modes = this.ventModes();
          base.humidity = typeof a.current_humidity === 'number' ? a.current_humidity : null;
          base.temperature = typeof a.current_temperature === 'number' ? a.current_temperature : null;
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
        if (!/^(light|climate)\.[a-z0-9_]+$/.test(id) || seen.has(id)) { errors.push(`Ugyldig enhet: ${id}`); continue; }
        const kind = id.startsWith('light.') ? 'light' : e.kind === 'vent' ? 'vent' : 'heat';
        seen.add(id);
        const ent = { entity_id: id, label: String(e.label || '').trim().slice(0, 40) || id, kind, enabled: e.enabled !== false };
        if (kind === 'light') {
          const lo = Math.round(Number(e.min_pct ?? 1));
          const hi = Math.round(Number(e.max_pct ?? 100));
          if (!(lo >= 1 && lo <= 99 && hi >= 2 && hi <= 100 && hi > lo)) errors.push(`${ent.label}: laveste må være lavere enn høyeste (1–100 %)`);
          else if (lo !== 1 || hi !== 100) Object.assign(ent, { min_pct: lo, max_pct: hi });
        }
        ents.push(ent);
      }
      d.entities = ents;
    }
    if (body.limits) {
      const L = body.limits;
      const min = Math.round(Number(L.heat_min));
      const max = Math.round(Number(L.heat_max));
      const boost = Math.round(Number(L.boost_max_minutes));
      if (!(min >= 5 && min <= 30)) errors.push('Minimum gulvvarme må være mellom 5° og 30°');
      else if (!(max > min && max <= 35)) errors.push('Maks gulvvarme må være høyere enn minimum og maks 35°');
      else { d.limits.heat_min = min; d.limits.heat_max = max; }
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

  async adminActivateScene(id) {
    await this.activateScene(id);
  }

  resetTenant() {
    const base = defaultData();
    const d = this.data;
    d.scenes = null;
    d.automations = [];
    d.auto_runs = {};
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
    if (this.data.entities.some((e) => e.enabled && e.entity_id === entityId)) this.changed();
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
