// Falsk Home Assistant for lokal utvikling og testing (brukes ikke i appen).
// Start: node tools/mock-ha.mjs  → ws://127.0.0.1:8123/api/websocket, token "dev"
import http from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 8123);
const now = () => new Date().toISOString();
const st = (entity_id, state, attributes) => ({ entity_id, state, attributes, last_changed: now(), last_updated: now(), context: { id: 'x' } });

const states = new Map(
  [
    st('light.demo_stue', 'on', { friendly_name: 'Demo stue', brightness: 178, supported_color_modes: ['brightness'] }),
    st('light.demo_gang', 'off', { friendly_name: 'Demo gang', supported_color_modes: ['brightness'] }),
    st('light.demo_bad', 'off', { friendly_name: 'Demo bad', supported_color_modes: ['brightness'] }),
    st('light.demo_ute', 'on', { friendly_name: 'Demo inngang ute', brightness: 89, supported_color_modes: ['brightness'] }),
    st('climate.demo_gulvvarme', 'heat', { friendly_name: 'Demo gulvvarme', hvac_modes: ['off', 'heat'], min_temp: 5, max_temp: 35, temperature: 21, current_temperature: 20.5, hvac_action: 'idle', preset_modes: ['none', 'away'] }),
    st('climate.demo_ventilasjon', 'fan_only', { friendly_name: 'Demo ventilasjon', hvac_modes: ['auto', 'fan_only'], fan_modes: ['low', 'medium', 'high'], fan_mode: 'medium', preset_modes: ['none', 'away', 'boost'], preset_mode: 'none', current_temperature: 19.5, current_humidity: 45 }),
    st('binary_sensor.demo_filter_alarm', 'off', { friendly_name: 'Demo filteralarm' }),
    st('light.demo_kjokken_hovedhus', 'on', { friendly_name: 'Demo kjøkken (hovedhus)', brightness: 255, supported_color_modes: ['brightness'] })
  ].map((s) => [s.entity_id, s])
);
export const calls = [];

const clients = new Set();

function frame(str) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

function setState(id, state, attrs) {
  const old = states.get(id);
  const next = st(id, state, { ...(old?.attributes || {}), ...attrs });
  states.set(id, next);
  for (const c of clients) {
    if (c.subId) c.send({ id: c.subId, type: 'event', event: { event_type: 'state_changed', data: { entity_id: id, old_state: old, new_state: next } } });
  }
}

function callService(domain, service, data) {
  calls.push({ domain, service, data, at: Date.now() });
  console.log('[mock] call', `${domain}.${service}`, JSON.stringify(data));
  const id = data.entity_id;
  const cur = states.get(id);
  const delay = 40;
  setTimeout(() => {
    if (domain === 'light' && service === 'turn_on') setState(id, 'on', { brightness: data.brightness_pct != null ? Math.round(data.brightness_pct * 2.55) : cur?.attributes.brightness ?? 255 });
    else if (domain === 'light' && service === 'turn_off') setState(id, 'off', { brightness: null });
    else if (domain === 'climate' && service === 'set_temperature') setState(id, data.hvac_mode || cur.state, { temperature: data.temperature });
    else if (domain === 'climate' && service === 'set_fan_mode') setState(id, cur.state, { fan_mode: data.fan_mode });
    else if (domain === 'climate' && service === 'set_preset_mode') setState(id, cur.state, { preset_mode: data.preset_mode });
    else if (domain === 'test' && service === 'set') setState(id, data.state, data.attributes || {});
  }, delay);
}

function handle(c, msg) {
  if (msg.type === 'auth') {
    return c.send(msg.access_token === 'dev' ? { type: 'auth_ok', ha_version: 'mock' } : { type: 'auth_invalid', message: 'bad token' });
  }
  const ok = (result = null) => c.send({ id: msg.id, type: 'result', success: true, result });
  switch (msg.type) {
    case 'get_states': return ok([...states.values()]);
    case 'subscribe_events': c.subId = msg.id; return ok();
    case 'call_service': callService(msg.domain, msg.service, msg.service_data || {}); return ok({ context: {} });
    case 'config/area_registry/list': return ok([{ area_id: 'hybel', name: 'Hybel' }, { area_id: 'kjokken', name: 'Kjøkken' }]);
    case 'config/device_registry/list': return ok([]);
    case 'config/entity_registry/list': return ok([...states.keys()].map((id) => ({ entity_id: id, area_id: id.includes('hovedhus') ? 'kjokken' : 'hybel' })));
    case 'get_services': return ok({ notify: { mobile_app_demo: {}, notify: {} } });
    default: return c.send({ id: msg.id, type: 'result', success: false, error: { message: 'unknown' } });
  }
}

const server = http.createServer((req, res) => {
  // Testkrok: POST /set {entity_id, state, attributes} og GET /calls
  if (req.url === '/calls') { res.end(JSON.stringify(calls)); return; }
  if (req.url === '/states') { res.end(JSON.stringify([...states.values()])); return; }
  if (req.url === '/set' && req.method === 'POST') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { const j = JSON.parse(b); setState(j.entity_id, j.state, j.attributes || {}); res.end('ok'); });
    return;
  }
  res.writeHead(404); res.end();
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const c = { send: (o) => socket.write(frame(JSON.stringify(o))), subId: null };
  clients.add(c);
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = buf[1] & 0x80;
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), total);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }
      buf = buf.subarray(total);
      if (op === 8) { socket.end(); return; }
      if (op === 9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 1) handle(c, JSON.parse(payload.toString('utf8')));
    }
  });
  socket.on('close', () => clients.delete(c));
  socket.on('error', () => clients.delete(c));
  c.send({ type: 'auth_required', ha_version: 'mock' });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[mock] HA på ws://127.0.0.1:${PORT}/api/websocket`));
