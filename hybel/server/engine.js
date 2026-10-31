// Forretningslogikk: hvilke enheter leietakeren ser, scener, grenser, boost og nattlig nullstilling.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { SCENE_NAMES, defaultData } from './store.js';
import { log } from './log.js';

export const KINDS = ['light', 'heat', 'vent'];
export const VENT_MODES = ['away', 'low', 'normal', 'high'];
const VENT_LABEL = { away: 'borte', low: 'lav', normal: 'normal', high: 'høy' };

const DEFAULTS = {
  light: { Hjemme: 80, Kveld: 35, Natt: 0, Borte: 0 },
  heat: { Hjemme: 21, Kveld: 22, Natt: 20, Borte: 18 },
  vent: { Hjemme: 'normal', Kveld: 'low', Natt: 'low', Borte: 'away' }
};

const FAN_ALIASES = {
  low: ['low', 'lav', '1', 'min', 'minimum'],
  normal: ['medium', 'normal', 'mid', 'middle', '2', 'auto'],
  high: ['high', 'høy', '3', 'max', 'maximum', 'boost']
};

export const keyOf = (entityId) => createHash('sha1').update(entityId).digest('hex').slice(0, 10);
const unavailable = (st) => !st || st.state === 'unavailable' || st.state === 'unknown';

export class Engine extends EventEmitter {
  constructor({ ha, store }) {
    super();
    this.ha = ha;
    this.store = store;
    this.updateTimer = null;
    ha.on('state', (id, n, o) => this.onState(id, n, o));
    ha.on('status', () => this.changed());
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
    const n = Math.round(Number(v) * 2) / 2;
    if (!Number.isFinite(n)) return heat_min;
    return Math.min(heat_max, Math.max(heat_min, n));
  }

  ventModes() {
    return this.data.limits.vent_allow_away ? VENT_MODES : VENT_MODES.filter((m) => m !== 'away');
  }

  // strict = true for direkte kommandoer fra leietaker (avviser), false for lagrede scener (justerer).
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
      if (strict && (n > heat_max || n < heat_min)) {
        throw new Error(`Temperaturen må være mellom ${heat_min}° og ${heat_max}°`);
      }
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

  factoryScene(name) {
    const saved = this.data.factory_scenes[name] || {};
    const out = {};
    for (const e of this.enabled()) {
      const v = saved[e.entity_id] ?? DEFAULTS[e.kind][name];
      try { out[e.entity_id] = this.sanitize(e, v); } catch { out[e.entity_id] = this.sanitize(e, DEFAULTS[e.kind][name]); }
    }
    return out;
  }

  tenantSceneRaw(name) {
    return this.data.tenant_can_edit_scenes ? this.data.tenant_scenes?.[name] || null : null;
  }

  effectiveScene(name) {
    const out = this.factoryScene(name);
    const t = this.tenantSceneRaw(name);
    if (!t) return out;
    for (const e of this.enabled()) {
      if (t[e.entity_id] === undefined) continue;
      try { out[e.entity_id] = this.sanitize(e, t[e.entity_id]); } catch {}
    }
    return out;
  }

  currentValue(e) {
    const st = this.state(e);
    if (unavailable(st)) return null;
    const a = st.attributes || {};
    if (e.kind === 'light') {
      if (st.state !== 'on') return 0;
      return a.brightness == null ? 100 : Math.max(1, Math.round(a.brightness / 2.55));
    }
    if (e.kind === 'heat') {
      return typeof a.temperature === 'number' ? a.temperature : null;
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

  matches(values) {
    for (const e of this.enabled()) {
      const cur = this.currentValue(e);
      const want = values[e.entity_id];
      if (cur === null || want === undefined) continue;
      if (e.kind === 'light') {
        if ((cur > 0) !== (want > 0)) return false;
        if (cur > 0 && Math.abs(cur - want) > 3) return false;
      } else if (e.kind === 'heat') {
        if (Math.abs(cur - want) > 0.25) return false;
      } else if (cur !== want) {
        return false;
      }
    }
    return true;
  }

  currentValues() {
    const out = {};
    for (const e of this.enabled()) {
      const v = this.currentValue(e);
      if (v !== null) out[e.entity_id] = v;
    }
    return out;
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
      return this.ha.callService('light', 'turn_on', dimmable ? { entity_id: id, brightness_pct: v } : { entity_id: id });
    }
    if (e.kind === 'heat') {
      const data = { entity_id: id, temperature: v };
      if (st?.state === 'off' && (a.hvac_modes || []).includes('heat')) data.hvac_mode = 'heat';
      return this.ha.callService('climate', 'set_temperature', data);
    }
    if (e.kind === 'vent') {
      const presets = (a.preset_modes || []).map((p) => String(p).toLowerCase());
      if (v === 'away') {
        return this.ha.callService('climate', 'set_preset_mode', { entity_id: id, preset_mode: 'away' });
      }
      const cur = String(a.preset_mode || 'none').toLowerCase();
      if (cur !== 'none' && presets.includes('none')) {
        await this.ha.callService('climate', 'set_preset_mode', { entity_id: id, preset_mode: 'none' });
      }
      return this.ha.callService('climate', 'set_fan_mode', { entity_id: id, fan_mode: this.fanModeFor(a, v) });
    }
  }

  async applyValues(values) {
    const jobs = this.enabled()
      .filter((e) => values[e.entity_id] !== undefined)
      .map((e) => this.setValue(e, values[e.entity_id]).catch((err) => {
        log.warn(`Kunne ikke styre ${e.entity_id}:`, err.message);
        throw err;
      }));
    const res = await Promise.allSettled(jobs);
    const failed = res.filter((r) => r.status === 'rejected').length;
    if (failed) throw new Error(failed === jobs.length ? 'Fikk ikke kontakt med enhetene' : 'Noen enheter svarte ikke');
  }

  async applyScene(name) {
    if (!SCENE_NAMES.includes(name)) throw new Error('Ukjent scene');
    this.data.active_scene = name;
    this.data.boost = null;
    this.store.save();
    this.changed();
    await this.applyValues(this.effectiveScene(name));
  }

  // ---------- leietaker ----------

  touch() {
    this.data.last_tenant_activity = new Date().toISOString();
    this.store.save();
  }

  boostMinutes() {
    return Math.min(this.data.tenant_prefs.boost_minutes || 30, this.data.limits.boost_max_minutes);
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
        if (e.kind === 'vent') {
          const prev = this.currentValue(e);
          if (v === 'high' && prev !== 'high') {
            d.boost = { entity_id: e.entity_id, until: Date.now() + this.boostMinutes() * 60000, return_to: prev && prev !== 'high' ? prev : 'normal' };
          } else if (v !== 'high' && d.boost?.entity_id === e.entity_id) {
            d.boost = null;
          }
          this.store.save();
        }
        await this.setValue(e, v);
        break;
      }
      case 'all_off':
        await this.applyValues(Object.fromEntries(this.enabled().filter((e) => e.kind === 'light').map((e) => [e.entity_id, 0])));
        break;
      case 'scene':
        await this.applyScene(cmd.name);
        break;
      case 'revert':
        if (!d.active_scene) throw new Error('Ingen scene er valgt');
        await this.applyScene(d.active_scene);
        break;
      case 'save_current': {
        if (!d.tenant_can_edit_scenes) throw new Error('Scenene er låst av utleier');
        if (!d.active_scene) throw new Error('Ingen scene er valgt');
        d.tenant_scenes[d.active_scene] = { ...this.effectiveScene(d.active_scene), ...this.currentValues() };
        this.store.save();
        break;
      }
      case 'save_scene': {
        if (!d.tenant_can_edit_scenes) throw new Error('Scenene er låst av utleier');
        if (!SCENE_NAMES.includes(cmd.name)) throw new Error('Ukjent scene');
        const out = {};
        for (const [key, v] of Object.entries(cmd.values || {})) {
          const e = this.byKey(key);
          if (e) out[e.entity_id] = this.sanitize(e, v, true);
        }
        d.tenant_scenes[cmd.name] = out;
        this.store.save();
        if (d.active_scene === cmd.name) await this.applyScene(cmd.name);
        break;
      }
      case 'reset_scene':
        if (!SCENE_NAMES.includes(cmd.name)) throw new Error('Ukjent scene');
        delete d.tenant_scenes[cmd.name];
        this.store.save();
        break;
      case 'prefs': {
        const p = d.tenant_prefs;
        if (cmd.boost_minutes !== undefined) {
          const m = Number(cmd.boost_minutes);
          if (![15, 30, 60, 90, 120].includes(m) || m > d.limits.boost_max_minutes) throw new Error('Ugyldig varighet');
          p.boost_minutes = m;
        }
        if (cmd.night_reset !== undefined) p.night_reset = Boolean(cmd.night_reset);
        this.store.save();
        break;
      }
      default:
        throw new Error('Ukjent kommando');
    }
    this.changed();
  }

  tenantView() {
    const d = this.data;
    const ents = this.enabled();
    const toKeys = (vals) => Object.fromEntries(Object.entries(vals).map(([id, v]) => [keyOf(id), v]));
    const scenes = {};
    const factory = {};
    for (const n of SCENE_NAMES) {
      scenes[n] = toKeys(this.effectiveScene(n));
      factory[n] = toKeys(this.factoryScene(n));
    }
    const active = d.active_scene && SCENE_NAMES.includes(d.active_scene) ? d.active_scene : null;
    return {
      connected: this.ha.connected,
      scene_names: SCENE_NAMES,
      active_scene: active,
      matches: active ? this.matches(this.effectiveScene(active)) : true,
      scenes,
      factory,
      can_edit: d.tenant_can_edit_scenes,
      limits: { heat_min: d.limits.heat_min, heat_max: d.limits.heat_max, boost_max_minutes: d.limits.boost_max_minutes, vent_allow_away: d.limits.vent_allow_away },
      prefs: { boost_minutes: this.boostMinutes(), night_reset: d.tenant_prefs.night_reset },
      boost_options: [15, 30, 60, 90, 120].filter((m) => m <= d.limits.boost_max_minutes),
      boost: d.boost ? { key: keyOf(d.boost.entity_id), until: d.boost.until, return_to: d.boost.return_to } : null,
      entities: ents.map((e) => {
        const st = this.state(e);
        const a = st?.attributes || {};
        const base = { key: keyOf(e.entity_id), kind: e.kind, label: e.label, available: !unavailable(st), value: this.currentValue(e) };
        if (e.kind === 'light') {
          const modes = a.supported_color_modes || [];
          base.dimmable = !(modes.length === 1 && modes[0] === 'onoff');
        } else if (e.kind === 'heat') {
          base.current = typeof a.current_temperature === 'number' ? a.current_temperature : null;
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
    const factory = {};
    for (const n of SCENE_NAMES) factory[n] = this.factoryScene(n);
    const active = d.active_scene;
    return {
      entities: d.entities.map((e) => {
        const st = this.state(e);
        return { ...e, available: !unavailable(st), value: e.enabled ? this.currentValue(e) : null, friendly_name: st?.attributes?.friendly_name || e.entity_id };
      }),
      limits: d.limits,
      tenant_can_edit_scenes: d.tenant_can_edit_scenes,
      factory_scenes: factory,
      tenant_customized: SCENE_NAMES.filter((n) => d.tenant_scenes?.[n]),
      alerts: d.alerts,
      scene_names: SCENE_NAMES,
      status: {
        ha_connected: this.ha.connected,
        active_scene: active,
        matches: active ? this.matches(this.effectiveScene(active)) : true,
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
        ents.push({ entity_id: id, label: String(e.label || '').trim().slice(0, 40) || id, kind, enabled: e.enabled !== false });
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
    if (body.factory_scenes && typeof body.factory_scenes === 'object') {
      const out = {};
      for (const n of SCENE_NAMES) {
        const src = body.factory_scenes[n] || {};
        out[n] = {};
        for (const e of d.entities) {
          if (src[e.entity_id] === undefined) continue;
          try { out[n][e.entity_id] = this.sanitize(e, src[e.entity_id]); } catch {}
        }
      }
      d.factory_scenes = out;
    }
    if (body.alerts) {
      const svc = String(body.alerts.notify_service || '').trim();
      if (svc && !/^notify\.[a-z0-9_]+$/.test(svc)) errors.push('Varslingstjenesten må se ut som notify.mobile_app_telefon');
      else d.alerts.notify_service = svc;
      if (Array.isArray(body.alerts.entities)) {
        d.alerts.entities = [...new Set(body.alerts.entities.map(String).filter((id) => /^binary_sensor\.[a-z0-9_]+$/.test(id)))];
      }
    }
    if (Array.isArray(body.reset_tenant_scenes)) {
      for (const n of body.reset_tenant_scenes) if (SCENE_NAMES.includes(n)) delete d.tenant_scenes[n];
    }
    if (d.boost && !d.entities.some((e) => e.enabled && e.entity_id === d.boost.entity_id)) d.boost = null;
    this.store.save();
    this.changed();
    return errors;
  }

  resetTenant() {
    const base = defaultData();
    const d = this.data;
    d.tenant_scenes = {};
    d.tenant_prefs = base.tenant_prefs;
    d.active_scene = 'Hjemme';
    d.boost = null;
    d.last_tenant_activity = null;
    this.store.save();
    this.changed();
  }

  // ---------- hendelser og tidsstyring ----------

  onState(entityId, newState, oldState) {
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
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (d.tenant_prefs.night_reset && now.getHours() === 3 && d.last_night_reset !== today) {
      d.last_night_reset = today;
      this.store.save();
      if (d.active_scene && !this.matches(this.effectiveScene(d.active_scene))) {
        log.info('Nattlig nullstilling til', d.active_scene);
        await this.applyScene(d.active_scene);
      }
    }
  }

  changed() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.emit('update');
    }, 40);
  }
}

export { SCENE_NAMES, VENT_LABEL };
