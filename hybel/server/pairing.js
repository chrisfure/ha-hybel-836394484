// Koble et lys til Zigbee-nettet på nytt: leietaker kan åpne for tilkobling (permit join) en stund
// når et av hybelens lys har falt ut. Zigbee2MQTT lukker selv etter ca. 4 minutter, så appen holder
// den åpen ved å slå den på igjen til tiden er ute eller leietaker trykker «Ferdig».
//
// NB: Lyset blir ofte «tilgjengelig» et øyeblikk når det får strøm eller under tilbakestillingen,
// før det faktisk er koblet til på nytt. Derfor lukkes ikke tilkoblingen bare fordi lyset svarer.
import { log } from './log.js';

const OPEN_MS = 10 * 60000;
const REARM_MS = 3 * 60000;

export class Pairing {
  constructor(engine) {
    this.engine = engine;
    this.timer = null;
    this.rearm = null;
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

  async open() {
    const sw = this.switchId();
    if (sw) await this.engine.ha.callService('switch', 'turn_on', { entity_id: sw });
  }

  schedule() {
    clearTimeout(this.timer);
    clearInterval(this.rearm);
    const p = this.d.pairing_state;
    if (!p) return;
    this.timer = setTimeout(() => this.stop('tiden gikk ut'), Math.max(0, p.until - Date.now()) + 1000);
    this.rearm = setInterval(() => { if (this.openUntil) this.open().catch((err) => log.warn('Kunne ikke holde Zigbee-tilkobling åpen:', err.message)); }, REARM_MS);
  }

  async start(key) {
    if (!this.allowed) throw new Error('Tilkobling av lys er ikke slått på av utleier');
    const e = this.engine.byKey(key);
    if (!e || e.kind !== 'light') throw new Error('Ukjent lys');
    if (this.openUntil && this.d.pairing_state.key !== key) throw new Error('Et annet lys holder på å kobles til');
    await this.open();
    this.d.pairing_state = { key, entity_id: e.entity_id, started: Date.now(), until: Date.now() + OPEN_MS, seen_ok: null };
    this.d.pairing_done = null;
    this.engine.store.save();
    this.schedule();
    log.info(`Leietaker åpnet for Zigbee-tilkobling av ${e.label} i ${OPEN_MS / 60000} min.`);
    this.engine.changed();
  }

  async stop(reason = 'avsluttet') {
    clearTimeout(this.timer);
    clearInterval(this.rearm);
    const p = this.d.pairing_state;
    if (!p) return;
    this.d.pairing_state = null;
    const st = this.engine.ha.states.get(p.entity_id);
    const ok = st && !['unavailable', 'unknown'].includes(st.state);
    if (ok) this.d.pairing_done = { key: p.key, at: Date.now() };
    this.engine.store.save();
    const sw = this.switchId();
    if (sw) {
      try { await this.engine.ha.callService('switch', 'turn_off', { entity_id: sw }); } catch (err) { log.warn('Kunne ikke lukke Zigbee-tilkobling:', err.message); }
    }
    log.info(`Zigbee-tilkobling lukket (${reason}). Lyset ${ok ? 'svarer' : 'svarer fortsatt ikke'}.`);
    const e = this.engine.data.entities.find((x) => x.entity_id === p.entity_id);
    this.engine.notify(ok ? `${e?.label || p.entity_id} er koblet til Zigbee-nettet igjen av leietaker.` : `Leietaker prøvde å koble til ${e?.label || p.entity_id} på nytt, men lyset svarer fortsatt ikke.`,
      { title: ok ? 'Lys tilkoblet på nytt' : 'Lys fortsatt ikke tilkoblet', inbox: true, id: 'zigbee' }).catch(() => {});
    this.engine.changed();
  }

  onState(entityId, newState) {
    const p = this.d.pairing_state;
    if (!p) return;
    // Zigbee2MQTT lukket selv før tiden – åpne igjen.
    if (entityId === this.switchId() && newState?.state === 'off' && this.openUntil) {
      this.open().catch(() => {});
      return;
    }
    if (p.entity_id !== entityId) return;
    const ok = newState && !['unavailable', 'unknown'].includes(newState.state);
    p.seen_ok = ok ? p.seen_ok || Date.now() : null;
    this.engine.changed();
  }

  resume() {
    const p = this.d.pairing_state;
    if (!p) return;
    if (p.until <= Date.now()) this.stop('tiden gikk ut mens appen var nede');
    else this.schedule();
  }

  view() {
    const p = this.d.pairing_state;
    const done = this.d.pairing_done && Date.now() - this.d.pairing_done.at < 5 * 60000 ? this.d.pairing_done.key : null;
    return { allowed: this.allowed, open_until: this.openUntil || null, key: this.openUntil ? p.key : null, responding: Boolean(this.openUntil && p.seen_ok), done };
  }
}
