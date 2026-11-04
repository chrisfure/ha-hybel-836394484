// Lagring av appens innstillinger i /data (aldri i koden).
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.js';
import { defaultExtras } from './extras.js';

export function defaultData() {
  return {
    version: 2,
    entities: [],
    limits: { heat_min: 15, heat_max: 28, boost_max_minutes: 60, vent_allow_away: true },
    tenant_can_edit_scenes: true,
    scenes: null,          // null = ikke laget ennå → forslag lages når enhetene er satt opp
    automations: [],
    tenant_prefs: { boost_minutes: 30 },
    boost: null,
    alerts: { notify_service: '', entities: [] },
    last_tenant_activity: null,
    auto_runs: {},
    auto_last: {},
    reverts: [],
    tenant_order: [],
    sun_cache: {},
    ...defaultExtras()
  };
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = join(dir, 'hybel.json');
    mkdirSync(dir, { recursive: true });
    const base = defaultData();
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      const migrated = raw.version === 2 ? raw : { entities: raw.entities, limits: raw.limits, alerts: raw.alerts, tenant_can_edit_scenes: raw.tenant_can_edit_scenes, last_tenant_activity: raw.last_tenant_activity };
      if (raw.version !== 2) log.info('Oppgraderer lagrede innstillinger: faste scener erstattes av egendefinerte scener.');
      this.data = {
        ...base,
        ...migrated,
        version: 2,
        limits: { ...base.limits, ...(migrated.limits || {}) },
        tenant_prefs: { ...base.tenant_prefs, ...(migrated.tenant_prefs || {}) },
        alerts: { ...base.alerts, ...(migrated.alerts || {}) },
        entities: migrated.entities || [],
        automations: migrated.automations || [],
        auto_runs: migrated.auto_runs || {},
        auto_last: migrated.auto_last || {},
        reverts: migrated.reverts || [],
        tenant_order: migrated.tenant_order || [],
        sun_cache: migrated.sun_cache || {},
        info: { ...base.info, ...(migrated.info || {}) },
        electricity: { ...base.electricity, ...(migrated.electricity || {}) },
        reports: migrated.reports || [],
        readings: migrated.readings || []
      };
      if (raw.version !== 2) this.save();
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
