// Statistikk for inneklima: temperatur og luftfuktighet fra Home Assistants historikk,
// slått sammen til jevne tidsbøtter som er lette å tegne på mobil.
import { log } from './log.js';

const RANGES = {
  '24h': { ms: 24 * 3600e3, bucket: 15 * 60e3 },
  '7d': { ms: 7 * 24 * 3600e3, bucket: 2 * 3600e3 }
};

export class Stats {
  constructor(engine) {
    this.engine = engine;
    this.cache = new Map();
  }

  // Sensorer på samme enhet (device) som en gitt entitet, f.eks. fuktføleren i ventilasjonsaggregatet.
  async deviceSensors(entityId) {
    if (!this.reg || Date.now() - this.reg.at > 10 * 60e3) {
      try {
        const list = await this.engine.ha.send({ type: 'config/entity_registry/list' });
        const byDev = new Map();
        const devOf = new Map();
        for (const r of list) {
          if (!r.device_id) continue;
          devOf.set(r.entity_id, r.device_id);
          if (!byDev.has(r.device_id)) byDev.set(r.device_id, []);
          byDev.get(r.device_id).push(r.entity_id);
        }
        this.reg = { at: Date.now(), byDev, devOf };
      } catch {
        this.reg = { at: Date.now(), byDev: new Map(), devOf: new Map() };
      }
    }
    const dev = this.reg.devOf.get(entityId);
    return dev ? this.reg.byDev.get(dev).filter((id) => id.startsWith('sensor.')) : [];
  }

  // Synkron variant for visningen: bruker registeret hvis det er hentet (hentes ellers i bakgrunnen).
  ventHumidity(entityId) {
    if (!this.reg) { this.deviceSensors(entityId).then(() => this.engine.changed()).catch(() => {}); return null; }
    const dev = this.reg.devOf.get(entityId);
    const id = dev && this.reg.byDev.get(dev).find((x) => x.startsWith('sensor.') && this.engine.ha.states.get(x)?.attributes?.device_class === 'humidity');
    const v = id ? Number(this.engine.ha.states.get(id)?.state) : NaN;
    return Number.isFinite(v) ? Math.round(v) : null;
  }

  // Hvilke måleserier finnes: temperatur fra termostater/varmepumpe (egen føler hvis valgt) og ventilasjonsaggregat.
  async series() {
    const out = [];
    for (const e of this.engine.enabled()) {
      if (e.kind === 'heat' || e.kind === 'climate') {
        if (e.now_sensor) out.push({ id: `t-${e.entity_id}`, label: e.label, sub: 'Temperatur', unit: '°', type: 'temp', entity_id: e.now_sensor, attr: null });
        else out.push({ id: `t-${e.entity_id}`, label: e.label, sub: 'Temperatur', unit: '°', type: 'temp', entity_id: e.entity_id, attr: 'current_temperature' });
      } else if (e.kind === 'vent') {
        const a = this.engine.ha.states.get(e.entity_id)?.attributes || {};
        if (typeof a.current_humidity === 'number') out.push({ id: `h-${e.entity_id}`, label: 'Luftfuktighet', sub: e.label, unit: '%', type: 'hum', entity_id: e.entity_id, attr: 'current_humidity' });
        else {
          // Ventilasjonen har ofte fuktføleren som egen sensor på samme enhet.
          const hum = (await this.deviceSensors(e.entity_id)).find((id) => this.engine.ha.states.get(id)?.attributes?.device_class === 'humidity');
          if (hum) out.push({ id: `h-${e.entity_id}`, label: 'Luftfuktighet', sub: e.label, unit: '%', type: 'hum', entity_id: hum, attr: null });
        }
        if (typeof a.current_temperature === 'number') out.push({ id: `v-${e.entity_id}`, label: 'Inneluft', sub: `${e.label} · temperatur`, unit: '°', type: 'temp', entity_id: e.entity_id, attr: 'current_temperature' });
      }
    }
    return out;
  }

  async get(range = '24h') {
    const R = RANGES[range] || RANGES['24h'];
    const key = `${range}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 120e3) return hit.data;
    const defs = await this.series();
    const end = Date.now();
    const start = end - R.ms;
    let hist = {};
    if (defs.length) {
      try {
        hist = await this.engine.ha.send({
          type: 'history/history_during_period',
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          entity_ids: [...new Set(defs.map((d) => d.entity_id))],
          minimal_response: false,
          no_attributes: false,
          significant_changes_only: false
        });
      } catch (err) {
        log.warn('Kunne ikke hente historikk:', err.message);
        throw new Error('Fikk ikke hentet historikk fra Home Assistant');
      }
    }
    const n = Math.ceil(R.ms / R.bucket);
    const series = defs.map((d) => {
      const rows = hist[d.entity_id] || [];
      // Rådata: [tid, verdi]
      const raw = [];
      let lastAttrs = null;
      for (const r of rows) {
        const t = (r.lu ?? r.lc ?? 0) * 1000 || Date.parse(r.last_updated || r.last_changed);
        if (r.a) lastAttrs = r.a;
        const v = d.attr ? Number((r.a || lastAttrs || {})[d.attr]) : Number(r.s ?? r.state);
        if (!Number.isFinite(v)) continue;
        if (d.type === 'temp' && (v < -30 || v > 60)) continue;
        if (d.type === 'hum' && (v < 0 || v > 100)) continue;
        raw.push([t, v]);
      }
      raw.sort((a, b) => a[0] - b[0]);
      // Tidsvektet snitt per bøtte, med siste kjente verdi videreført.
      const pts = [];
      let i = 0;
      let carry = null;
      while (i < raw.length && raw[i][0] < start) carry = raw[i++][1];
      for (let b = 0; b < n; b++) {
        const b0 = start + b * R.bucket;
        const b1 = Math.min(end, b0 + R.bucket);
        let sum = 0, w = 0, t = b0, v = carry;
        while (i < raw.length && raw[i][0] < b1) {
          if (v !== null) { sum += v * (raw[i][0] - t); w += raw[i][0] - t; }
          t = raw[i][0];
          v = raw[i][1];
          i++;
        }
        if (v !== null) { sum += v * (b1 - t); w += b1 - t; }
        carry = v;
        pts.push(w > 0 ? Math.round((sum / w) * 10) / 10 : null);
      }
      const vals = raw.filter(([t]) => t >= start).map(([, v]) => v);
      const st = this.engine.ha.states.get(d.entity_id);
      const nowV = d.attr ? Number(st?.attributes?.[d.attr]) : Number(st?.state);
      const valid = pts.filter((p) => p !== null);
      return {
        id: d.id, label: d.label, sub: d.sub, unit: d.unit, type: d.type,
        now: Number.isFinite(nowV) ? Math.round(nowV * 10) / 10 : null,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        avg: valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null,
        points: pts
      };
    });
    const data = { range, start, end, bucket: R.bucket, series };
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }
}
