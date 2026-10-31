// Minimal Home Assistant WebSocket-klient basert på Node sin innebygde WebSocket.
import { EventEmitter } from 'node:events';
import { log } from './log.js';

export class HAClient extends EventEmitter {
  constructor({ url, token }) {
    super();
    this.url = url;
    this.token = token;
    this.states = new Map();
    this.connected = false;
    this.nextId = 1;
    this.pending = new Map();
    this.backoff = 1000;
    this.ws = null;
  }

  start() {
    if (typeof WebSocket !== 'function') {
      throw new Error('Denne Node-versjonen mangler innebygd WebSocket (krever Node 22+).');
    }
    this.connect();
  }

  connect() {
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      log.error('Kunne ikke åpne forbindelse til Home Assistant:', err.message);
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      for (const m of Array.isArray(msg) ? msg : [msg]) this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.connected;
      this.connected = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Forbindelsen til Home Assistant ble brutt'));
      }
      this.pending.clear();
      if (was) {
        log.warn('Mistet forbindelsen til Home Assistant – prøver igjen.');
        this.emit('status', false);
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  scheduleReconnect() {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30000);
    setTimeout(() => this.connect(), delay);
  }

  async onMessage(msg) {
    switch (msg.type) {
      case 'auth_required':
        this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        break;
      case 'auth_invalid':
        log.error('Home Assistant avviste innloggingen:', msg.message || '');
        break;
      case 'auth_ok':
        this.backoff = 1000;
        try {
          const states = await this.send({ type: 'get_states' }, true);
          this.states.clear();
          for (const s of states) this.states.set(s.entity_id, s);
          await this.send({ type: 'subscribe_events', event_type: 'state_changed' }, true);
          this.connected = true;
          log.info(`Koblet til Home Assistant (${this.states.size} entiteter).`);
          this.emit('status', true);
          this.emit('ready');
        } catch (err) {
          log.error('Oppstart mot Home Assistant feilet:', err.message);
          try { this.ws.close(); } catch {}
        }
        break;
      case 'result': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.success) p.resolve(msg.result);
        else p.reject(new Error(msg.error?.message || 'Ukjent feil fra Home Assistant'));
        break;
      }
      case 'event': {
        const ev = msg.event;
        if (ev?.event_type !== 'state_changed') return;
        const { entity_id, new_state, old_state } = ev.data;
        if (new_state) this.states.set(entity_id, new_state);
        else this.states.delete(entity_id);
        this.emit('state', entity_id, new_state, old_state);
        break;
      }
    }
  }

  send(cmd, allowBeforeReady = false) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1 || (!this.connected && !allowBeforeReady)) {
        return reject(new Error('Ikke koblet til Home Assistant'));
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Home Assistant svarte ikke i tide'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, ...cmd }));
    });
  }

  callService(domain, service, data) {
    log.debug('Tjenestekall', `${domain}.${service}`, data);
    return this.send({ type: 'call_service', domain, service, service_data: data });
  }
}
