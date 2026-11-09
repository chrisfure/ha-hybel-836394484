// Koble et lys til Zigbee-nettet på nytt: leietaker kan åpne for tilkobling (permit join) en kort stund
// når et av hybelens lys har falt ut. Lukkes automatisk etter tiden, eller når lyset er tilbake.
import { log } from './log.js';

const OPEN_MS = 4 * 60000;

export class Pairing {
  constructor(engine) {
    this.engine = engine;
    this.timer = null;
  }

  get d() {
    return this.engine.data;
  }

  switchId() {
    const set = this.d.pairing_switch;
    if (set && this.engine.ha.states.has(set)) return set;
    for (const id of this.engine.ha.states.keys()) if (/^switch\..*permit_join$/.test(id)) return id;
    return null;
  }

  get allowed() {
    return this.d.pairing_enabled !== false && Boolean(this.switchId());
  }

  get openUntil() {
    const p = this.d.pairing_state;
    return p && p.until > Date.now() ? p.until : 0;
  }

  async start(key) {
    if (!this.allowed) throw new Error('Tilkobling av lys er ikke slått på av utleier');
    const e = this.engine.byKey(key);
    if (!e || e.kind !== 'light') throw new Error('Ukjent lys');
    const st = this.engine.state(e);
    if (st && !['unavailable', 'unknown'].includes(st.state)) throw new Error(`${e.label} er allerede tilkoblet`);
    const last = this.d.pairing_state?.started || 0;
    if (Date.now() - last < 20000 && this.openUntil) return; // allerede åpen
    const sw = this.switchId();
    await this.engine.ha.callService('switch', 'turn_on', { entity_id: sw });
    this.d.pairing_state = { key, entity_id: e.entity_id, started: Date.now(), until: Date.now() + OPEN_MS };
    this.engine.store.save();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop('tiden gikk ut'), OPEN_MS + 1000);
    log.info(`Leietaker åpnet for Zigbee-tilkobling av ${e.label} (${sw}).`);
    this.engine.changed();
  }

  async stop(reason = 'avsluttet') {
    clearTimeout(this.timer);
    const p = this.d.pairing_state;
    if (!p) return;
    this.d.pairing_state = null;
    this.engine.store.save();
    const sw = this.switchId();
    if (sw) {
      try { await this.engine.ha.callService('switch', 'turn_off', { entity_id: sw }); } catch (err) { log.warn('Kunne ikke lukke Zigbee-tilkobling:', err.message); }
    }
    log.info(`Zigbee-tilkobling lukket (${reason}).`);
    this.engine.changed();
  }

  // Kalles ved tilstandsendringer: lyset er tilbake → lukk tilkoblingen og si fra.
  onState(entityId, newState) {
    const p = this.d.pairing_state;
    if (!p || p.entity_id !== entityId) return;
    if (newState && !['unavailable', 'unknown'].includes(newState.state)) {
      const e = this.engine.data.entities.find((x) => x.entity_id === entityId);
      this.d.pairing_done = { key: p.key, at: Date.now() };
      this.stop('lyset er tilkoblet');
      this.engine.notify(`${e?.label || entityId} er koblet til Zigbee-nettet igjen av leietaker.`, { title: 'Lys tilkoblet på nytt', inbox: true, id: 'zigbee' }).catch(() => {});
    }
  }

  resume() {
    const p = this.d.pairing_state;
    if (!p) return;
    if (p.until <= Date.now()) this.stop('tiden gikk ut mens appen var nede');
    else this.timer = setTimeout(() => this.stop('tiden gikk ut'), p.until - Date.now() + 1000);
  }

  view() {
    const done = this.d.pairing_done && Date.now() - this.d.pairing_done.at < 5 * 60000 ? this.d.pairing_done.key : null;
    return { allowed: this.allowed, open_until: this.openUntil || null, key: this.openUntil ? this.d.pairing_state.key : null, done };
  }
}
