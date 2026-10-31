// Forretningslogikk: hva gjestene ser, og hva de får lov til å styre.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { log } from './log.js';

export const keyOf = (entityId) => createHash('sha1').update(String(entityId)).digest('hex').slice(0, 10);
const unavailable = (st) => !st || st.state === 'unavailable' || st.state === 'unknown';
const RGB_MODES = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww']);
const HEX = /^#[0-9a-f]{6}$/i;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

const toHex = (rgb) => '#' + rgb.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const validTemp = (t) => typeof t === 'number' && Number.isFinite(t) && t > -40 && t < 60;
const str = (v, max = 60) => String(v ?? '').trim().slice(0, max);

export class Engine extends EventEmitter {
  constructor({ ha, store }) {
    super();
    this.ha = ha;
    this.store = store;
    this.updateTimer = null;
    this.lightCache = new Map();
    this.lastTarget = new Map();
    this.lastStation = null;
    this.relevant = new Set();
    this.rebuildRelevant();
    ha.on('state', (id) => {
      if (this.relevant.has(id)) this.changed();
    });
    ha.on('status', () => this.changed());
    ha.on('ready', () => this.changed());
  }

  get data() {
    return this.store.data;
  }

  rebuildRelevant() {
    const s = new Set();
    for (const r of this.data.rooms) {
      for (const l of r.lights) s.add(l.entity_id);
      if (r.heat) s.add(r.heat.entity_id);
      if (r.temp_sensor) s.add(r.temp_sensor);
    }
    if (this.data.radio.player) s.add(this.data.radio.player);
    this.relevant = s;
  }

  changed() {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.emit('update'), 40);
  }

  // ---------- visning for gjestene ----------

  lightView(cfg) {
    const id = cfg.entity_id;
    const st = this.ha.states.get(id);
    const a = st?.attributes || {};
    const modes = a.supported_color_modes || [];
    const rgb = modes.some((m) => RGB_MODES.has(m));
    const rgbw = modes.includes('rgbw') || modes.includes('rgbww');
    const temp = modes.includes('color_temp')
      ? [Math.round(a.min_color_temp_kelvin || 2000), Math.round(a.max_color_temp_kelvin || 6500)]
      : null;
    const dim = modes.length ? !(modes.length === 1 && modes[0] === 'onoff') : true;
    const c = this.lightCache.get(id) || { pct: 60, hex: null, kelvin: null, mode: 'none', white: false };
    const on = st?.state === 'on';
    if (on) {
      if (typeof a.brightness === 'number') c.pct = Math.max(1, Math.round(a.brightness / 2.55));
      if (Array.isArray(a.rgb_color)) c.hex = toHex(a.rgb_color);
      if (typeof a.color_temp_kelvin === 'number') c.kelvin = a.color_temp_kelvin;
      c.mode = a.color_mode === 'color_temp' ? 'temp' : RGB_MODES.has(a.color_mode) ? 'color' : 'none';
      const w = Array.isArray(a.rgbw_color) ? a.rgbw_color : Array.isArray(a.rgbww_color) ? a.rgbww_color : null;
      c.white = Boolean(w && w[3] > 200 && Math.max(w[0], w[1], w[2]) < 30);
    }
    this.lightCache.set(id, c);
    return {
      key: keyOf(id),
      name: cfg.name,
      available: !unavailable(st),
      on,
      pct: c.pct,
      dim,
      caps: { rgb, rgbw, temp },
      mode: c.mode,
      kelvin: c.kelvin,
      hex: c.hex,
      white: c.white
    };
  }

  heatRange(st) {
    const a = st?.attributes || {};
    const { heat_min, heat_max } = this.data.limits;
    const min = Math.max(heat_min, typeof a.min_temp === 'number' ? a.min_temp : -Infinity);
    const max = Math.min(heat_max, typeof a.max_temp === 'number' ? a.max_temp : Infinity);
    const step = typeof a.target_temp_step === 'number' && a.target_temp_step > 0 ? a.target_temp_step : 1;
    return { min, max: Math.max(min, max), step };
  }

  heatView(cfg) {
    const id = cfg.entity_id;
    const st = this.ha.states.get(id);
    const a = st?.attributes || {};
    if (validTemp(a.temperature)) this.lastTarget.set(id, a.temperature);
    const { min, max, step } = this.heatRange(st);
    return {
      key: keyOf(id),
      name: cfg.name,
      available: !unavailable(st),
      now: validTemp(a.current_temperature) ? a.current_temperature : null,
      target: this.lastTarget.get(id) ?? null,
      heating: a.hvac_action === 'heating',
      min,
      max,
      step
    };
  }

  tempView(id) {
    const st = this.ha.states.get(id);
    const v = Number(st?.state);
    return { available: !unavailable(st), now: validTemp(v) ? v : null };
  }

  radioView() {
    const r = this.data.radio;
    const st = r.player ? this.ha.states.get(r.player) : null;
    const a = st?.attributes || {};
    const playing = st?.state === 'playing' || st?.state === 'buffering';
    if (!playing && st && ['off', 'idle', 'standby', 'paused'].includes(st.state)) this.lastStation = null;
    let station = null;
    if (playing) {
      if (this.lastStation !== null && this.lastStation < r.stations.length) station = this.lastStation;
      else {
        const hay = `${a.media_title || ''} ${a.media_artist || ''} ${a.media_album_name || ''}`.toLowerCase();
        const i = r.stations.findIndex((s) => hay.includes(s.name.toLowerCase()));
        if (i >= 0) station = i;
      }
    }
    return {
      configured: Boolean(r.player),
      available: Boolean(r.player) && !unavailable(st),
      playing,
      station,
      title: station !== null ? r.stations[station].name : playing ? str(a.media_title || a.media_artist || 'Noe spilles', 80) : '',
      volume: typeof a.volume_level === 'number' ? Math.round(a.volume_level * 100) : null,
      max_volume: r.max_volume,
      stations: r.stations.map((s) => ({ name: s.name, sub: s.sub }))
    };
  }

  guestView() {
    return {
      connected: this.ha.connected,
      kicker: this.data.texts.kicker,
      rooms: this.data.rooms.map((r, i) => ({
        key: 'r' + i,
        name: r.name,
        short: r.short || r.name,
        lights: r.lights.map((l) => this.lightView(l)),
        heat: r.heat ? this.heatView(r.heat) : null,
        temp: r.temp_sensor ? this.tempView(r.temp_sensor) : null
      })),
      radio: this.radioView()
    };
  }

  // ---------- kommandoer fra gjestene ----------

  findLight(key) {
    for (const r of this.data.rooms) for (const l of r.lights) if (keyOf(l.entity_id) === key) return l;
    return null;
  }

  findHeat(key) {
    for (const r of this.data.rooms) if (r.heat && keyOf(r.heat.entity_id) === key) return r.heat;
    return null;
  }

  async handleGuest(cmd) {
    if (!cmd || typeof cmd !== 'object') throw new Error('Ugyldig forespørsel');
    if (!this.ha.connected) throw new Error('Har ikke kontakt med huset akkurat nå');
    this.data.last_guest_activity = new Date().toISOString();
    this.store.save();
    switch (cmd.type) {
      case 'light': return this.setLight(cmd);
      case 'heat': return this.setHeat(cmd);
      case 'room_off': {
        const i = Number(String(cmd.room || '').replace(/^r/, ''));
        const room = Number.isInteger(i) ? this.data.rooms[i] : null;
        if (!room) throw new Error('Ukjent rom');
        return this.lightsOff(room.lights.map((l) => l.entity_id));
      }
      case 'all_off':
        return this.lightsOff(this.data.rooms.flatMap((r) => r.lights.map((l) => l.entity_id)));
      case 'radio_play': return this.playStation(cmd.index);
      case 'radio_stop': {
        const p = this.data.radio.player;
        if (!p) throw new Error('Radio er ikke satt opp');
        this.lastStation = null;
        return this.ha.callService('media_player', 'media_stop', { entity_id: p });
      }
      case 'volume': return this.setVolume(cmd.value);
      default: throw new Error('Ukjent kommando');
    }
  }

  async lightsOff(ids) {
    const on = ids.filter((id) => this.ha.states.get(id)?.state === 'on');
    if (!on.length) return;
    return this.ha.callService('light', 'turn_off', { entity_id: on });
  }

  async setLight(cmd) {
    const cfg = this.findLight(cmd.key);
    if (!cfg) throw new Error('Ukjent lys');
    const id = cfg.entity_id;
    const v = this.lightView(cfg);
    if (!v.available) throw new Error(`${cfg.name} svarer ikke`);
    if (cmd.pct !== undefined) {
      const n = Math.round(Number(cmd.pct));
      if (!Number.isFinite(n)) throw new Error('Ugyldig lysstyrke');
      const pct = Math.max(0, Math.min(100, n));
      if (pct === 0) return this.ha.callService('light', 'turn_off', { entity_id: id });
      return this.ha.callService('light', 'turn_on', v.dim ? { entity_id: id, brightness_pct: pct } : { entity_id: id });
    }
    if (cmd.kelvin !== undefined) {
      if (!v.caps.temp) throw new Error('Dette lyset har ikke hvittoner');
      const k = Math.round(Number(cmd.kelvin));
      if (!Number.isFinite(k)) throw new Error('Ugyldig fargetemperatur');
      const kelvin = Math.max(v.caps.temp[0], Math.min(v.caps.temp[1], k));
      return this.ha.callService('light', 'turn_on', { entity_id: id, color_temp_kelvin: kelvin });
    }
    if (cmd.white === true) {
      if (v.caps.rgbw) return this.ha.callService('light', 'turn_on', { entity_id: id, rgbw_color: [0, 0, 0, 255] });
      if (v.caps.temp) return this.ha.callService('light', 'turn_on', { entity_id: id, color_temp_kelvin: Math.max(v.caps.temp[0], Math.min(v.caps.temp[1], 3500)) });
      if (v.caps.rgb) return this.ha.callService('light', 'turn_on', { entity_id: id, rgb_color: [255, 244, 229] });
      throw new Error('Dette lyset kan ikke endre farge');
    }
    if (cmd.color !== undefined) {
      if (!v.caps.rgb) throw new Error('Dette lyset kan ikke endre farge');
      if (!HEX.test(String(cmd.color))) throw new Error('Ugyldig farge');
      return this.ha.callService('light', 'turn_on', { entity_id: id, rgb_color: fromHex(cmd.color) });
    }
    if (typeof cmd.on === 'boolean') {
      return this.ha.callService('light', cmd.on ? 'turn_on' : 'turn_off', { entity_id: id });
    }
    throw new Error('Ugyldig lyskommando');
  }

  async setHeat(cmd) {
    const cfg = this.findHeat(cmd.key);
    if (!cfg) throw new Error('Ukjent termostat');
    const st = this.ha.states.get(cfg.entity_id);
    if (unavailable(st)) throw new Error(`${cfg.name} svarer ikke`);
    const n = Number(cmd.target);
    if (!Number.isFinite(n)) throw new Error('Ugyldig temperatur');
    const { min, max, step } = this.heatRange(st);
    if (n > max + 1e-9 || n < min - 1e-9) throw new Error(`Temperaturen kan stilles mellom ${min}° og ${max}°`);
    const t = Math.round(n / step) * step;
    const data = { entity_id: cfg.entity_id, temperature: Math.round(t * 10) / 10 };
    if (st.state === 'off' && (st.attributes?.hvac_modes || []).includes('heat')) data.hvac_mode = 'heat';
    this.lastTarget.set(cfg.entity_id, data.temperature);
    return this.ha.callService('climate', 'set_temperature', data);
  }

  async playStation(index) {
    const r = this.data.radio;
    if (!r.player) throw new Error('Radio er ikke satt opp');
    const i = Number(index);
    const s = Number.isInteger(i) ? r.stations[i] : null;
    if (!s) throw new Error('Ukjent kanal');
    this.lastStation = i;
    this.changed();
    await this.ha.callService('music_assistant', 'play_media', { entity_id: r.player, media_id: s.media_id, enqueue: 'replace' });
    const vol = this.ha.states.get(r.player)?.attributes?.volume_level;
    if (typeof vol === 'number' && vol * 100 > r.max_volume) {
      await this.ha.callService('media_player', 'volume_set', { entity_id: r.player, volume_level: r.max_volume / 100 });
    }
  }

  async setVolume(value) {
    const r = this.data.radio;
    if (!r.player) throw new Error('Radio er ikke satt opp');
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) throw new Error('Ugyldig volum');
    const v = Math.max(0, Math.min(r.max_volume, n));
    return this.ha.callService('media_player', 'volume_set', { entity_id: r.player, volume_level: v / 100 });
  }

  // ---------- oppsett (kun fra Home Assistant) ----------

  adminView(extra = {}) {
    const { import_hash, ...cfg } = this.data;
    return { ...cfg, status: { ha_connected: this.ha.connected, ...extra } };
  }

  sanitizeConfig(body) {
    const errors = [];
    const ent = (v, domain, label) => {
      const s = str(v, 120);
      if (!s) return '';
      if (!ENTITY.test(s) || (domain && !domain.includes(s.split('.')[0]))) {
        errors.push(`${label}: «${s}» er ikke en gyldig enhet`);
        return '';
      }
      return s;
    };
    const rooms = [];
    for (const [ri, r] of (Array.isArray(body.rooms) ? body.rooms : []).slice(0, 12).entries()) {
      const name = str(r?.name, 40) || `Rom ${ri + 1}`;
      const lights = [];
      for (const l of (Array.isArray(r?.lights) ? r.lights : []).slice(0, 24)) {
        const id = ent(l?.entity_id, ['light'], `${name} – lys`);
        if (id) lights.push({ entity_id: id, name: str(l?.name, 40) || id });
      }
      const heatId = ent(r?.heat?.entity_id, ['climate'], `${name} – varme`);
      rooms.push({
        name,
        short: str(r?.short, 12) || name.slice(0, 12),
        lights,
        heat: heatId ? { entity_id: heatId, name: str(r.heat.name, 40) || 'Varme' } : null,
        temp_sensor: heatId ? '' : ent(r?.temp_sensor, ['sensor'], `${name} – temperatur`)
      });
    }
    const rb = body.radio || {};
    const stations = [];
    for (const s of (Array.isArray(rb.stations) ? rb.stations : []).slice(0, 12)) {
      const nm = str(s?.name, 30);
      const media = str(s?.media_id, 200);
      if (nm && media) stations.push({ name: nm, sub: str(s?.sub, 30), media_id: media });
      else if (nm || media) errors.push(`Radiokanal «${nm || media}» mangler navn eller kanal-ID`);
    }
    const maxVol = Math.round(Number(rb.max_volume ?? 50));
    const lim = body.limits || {};
    let hmin = Number(lim.heat_min ?? 16);
    let hmax = Number(lim.heat_max ?? 24);
    if (!Number.isFinite(hmin) || !Number.isFinite(hmax) || hmin < 5 || hmax > 35 || hmin >= hmax) {
      errors.push('Grensene for varme må være mellom 5° og 35°, og minimum lavere enn maksimum');
      hmin = 16;
      hmax = 24;
    }
    return {
      errors,
      data: {
        texts: { kicker: str(body.texts?.kicker, 40) || 'Velkommen' },
        rooms,
        radio: {
          player: ent(rb.player, ['media_player'], 'Radio – høyttaler'),
          max_volume: Number.isFinite(maxVol) ? Math.max(5, Math.min(100, maxVol)) : 50,
          stations
        },
        limits: { heat_min: hmin, heat_max: hmax }
      }
    };
  }

  saveAdmin(body) {
    const { errors, data } = this.sanitizeConfig(body || {});
    if (errors.length) return errors;
    Object.assign(this.data, data);
    this.store.save();
    this.rebuildRelevant();
    this.changed();
    log.info(`Oppsett lagret: ${data.rooms.length} rom, ${data.radio.stations.length} radiokanaler.`);
    return [];
  }

  importConfig(text) {
    const raw = String(text || '').trim();
    if (!raw) return;
    const hash = createHash('sha1').update(raw).digest('hex');
    if (hash === this.data.import_hash) return;
    let body;
    try {
      body = JSON.parse(raw);
    } catch (err) {
      log.error('Importert oppsett er ikke gyldig JSON:', err.message);
      return;
    }
    const errors = this.saveAdmin(body);
    if (errors.length) {
      log.error('Importert oppsett ble ikke lagret:', errors.join('; '));
      return;
    }
    this.data.import_hash = hash;
    this.store.save();
    log.info('Importerte oppsett fra appens konfigurasjon.');
  }
}
