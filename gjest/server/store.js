// Lagring av oppsettet i /data (aldri i koden).
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.js';

export function defaultData() {
  return {
    version: 1,
    texts: { kicker: 'Velkommen' },
    rooms: [],
    radio: { player: '', max_volume: 50, stations: [] },
    limits: { heat_min: 16, heat_max: 24 },
    import_hash: null,
    last_guest_activity: null
  };
}

export class Store {
  constructor(dir) {
    this.file = join(dir, 'gjest.json');
    mkdirSync(dir, { recursive: true });
    const base = defaultData();
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = {
        ...base,
        ...raw,
        texts: { ...base.texts, ...(raw.texts || {}) },
        radio: { ...base.radio, ...(raw.radio || {}) },
        limits: { ...base.limits, ...(raw.limits || {}) }
      };
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('Kunne ikke lese lagret oppsett, starter med standard:', err.message);
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
      log.error('Kunne ikke lagre oppsettet:', err.message);
    }
  }
}
