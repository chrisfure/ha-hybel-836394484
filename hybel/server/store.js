// Lagring av appens innstillinger i /data (aldri i koden).
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.js';

export const SCENE_NAMES = ['Hjemme', 'Kveld', 'Natt', 'Borte'];

export function defaultData() {
  return {
    version: 1,
    entities: [],
    limits: { heat_min: 15, heat_max: 28, boost_max_minutes: 60, vent_allow_away: true },
    tenant_can_edit_scenes: true,
    factory_scenes: {},
    tenant_scenes: {},
    tenant_prefs: { boost_minutes: 30, night_reset: true },
    active_scene: 'Hjemme',
    boost: null,
    alerts: { notify_service: '', entities: [] },
    last_tenant_activity: null,
    last_night_reset: null
  };
}

export class Store {
  constructor(dir) {
    this.file = join(dir, 'hybel.json');
    mkdirSync(dir, { recursive: true });
    const base = defaultData();
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = {
        ...base,
        ...raw,
        limits: { ...base.limits, ...(raw.limits || {}) },
        tenant_prefs: { ...base.tenant_prefs, ...(raw.tenant_prefs || {}) },
        alerts: { ...base.alerts, ...(raw.alerts || {}) }
      };
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('Kunne ikke lese lagrede innstillinger, starter med standard:', err.message);
      this.data = base;
    }
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.file);
    } catch (err) {
      log.error('Kunne ikke lagre innstillinger:', err.message);
    }
  }
}
