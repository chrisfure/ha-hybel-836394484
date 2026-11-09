// Falsk Home Assistant for lokal utvikling og testing (brukes ikke i appen).
// Start: node tools/mock-ha.mjs  → ws://127.0.0.1:8123/api/websocket, token "dev"
import http from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 8123);
const now = () => new Date().toISOString();
const st = (entity_id, state, attributes) => ({ entity_id, state, attributes, last_changed: now(), last_updated: now(), context: { id: 'x' } });

const HYBEL = [
    st('light.demo_stue', 'on', { friendly_name: 'Demo stue', brightness: 178, supported_color_modes: ['brightness'] }),
    st('light.demo_gang', 'off', { friendly_name: 'Demo gang', supported_color_modes: ['brightness'] }),
    st('light.demo_bad', 'off', { friendly_name: 'Demo bad', supported_color_modes: ['brightness'] }),
    st('light.demo_ute', 'on', { friendly_name: 'Demo inngang ute', brightness: 89, supported_color_modes: ['brightness'] }),
    st('climate.demo_gulvvarme', 'heat', { friendly_name: 'Demo gulvvarme', hvac_modes: ['off', 'heat'], min_temp: 5, max_temp: 35, temperature: 21, current_temperature: 20.5, hvac_action: 'idle', preset_modes: ['none', 'away'] }),
    st('climate.demo_ventilasjon', 'fan_only', { friendly_name: 'Demo ventilasjon', hvac_modes: ['auto', 'fan_only'], fan_modes: ['low', 'medium', 'high'], fan_mode: 'medium', preset_modes: ['none', 'away', 'boost'], preset_mode: 'none', current_temperature: 19.5, current_humidity: 45 }),
    st('climate.demo_hybel_varmepumpe', 'heat', { friendly_name: 'Demo hybel varmepumpe', hvac_modes: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'], fan_modes: ['auto', 'low', 'medium', 'high'], fan_mode: 'auto', min_temp: 16, max_temp: 30, temperature: 21, current_temperature: 19.5, hvac_action: 'heating', target_temp_step: 1 }),
    st('binary_sensor.demo_filter_alarm', 'off', { friendly_name: 'Demo filteralarm' }),
    st('light.demo_kjokken_hovedhus', 'on', { friendly_name: 'Demo kjøkken (hovedhus)', brightness: 255, supported_color_modes: ['brightness'] })
];
// Demo for Gjestesiden (MOCK_SET=gjest): fargelys, hvittoner, termostat, føler og høyttaler.
const GJEST = [
    st('light.demo_benk', 'on', { friendly_name: 'Demo benk', brightness: 178, supported_color_modes: ['rgbw'], color_mode: 'rgbw', rgbw_color: [0, 0, 0, 255], rgb_color: [255, 255, 255] }),
    st('light.demo_vindu', 'on', { friendly_name: 'Demo vindu', brightness: 115, supported_color_modes: ['color_temp', 'xy'], color_mode: 'color_temp', color_temp_kelvin: 2700, rgb_color: [255, 167, 87], min_color_temp_kelvin: 1801, max_color_temp_kelvin: 6535 }),
    st('light.demo_spot', 'off', { friendly_name: 'Demo spot', supported_color_modes: ['brightness'] }),
    st('light.demo_lampe', 'off', { friendly_name: 'Demo lampe', supported_color_modes: ['color_temp'], min_color_temp_kelvin: 2202, max_color_temp_kelvin: 4000 }),
    st('light.demo_stripe', 'off', { friendly_name: 'Demo stripe', supported_color_modes: ['color_temp', 'xy'], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6535 }),
    st('climate.demo_varmepumpe', 'heat', { friendly_name: 'Demo varmepumpe', hvac_modes: ['off', 'heat', 'cool'], min_temp: 16, max_temp: 30, target_temp_step: 1, temperature: 22, current_temperature: 21.5, hvac_action: 'idle' }),
    st('climate.demo_panelovn', 'heat', { friendly_name: 'Demo panelovn', hvac_modes: ['off', 'heat'], min_temp: 5, max_temp: 30, temperature: 20, current_temperature: 19.8, hvac_action: 'heating' }),
    st('sensor.demo_temperatur', '20.4', { friendly_name: 'Demo temperatur', device_class: 'temperature', unit_of_measurement: '°C' }),
    st('media_player.demo_hoyttaler', 'idle', { friendly_name: 'Demo høyttaler', volume_level: 0.2 })
];
const states = new Map((process.env.MOCK_SET === 'gjest' ? GJEST : HYBEL).map((s) => [s.entity_id, s]));
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
  const cur = states.get([].concat(id)[0]);
  const delay = 40;
  setTimeout(() => {
    if (domain === 'light' && service === 'turn_on') {
      const extra = {};
      if (data.color_temp_kelvin) Object.assign(extra, { color_mode: 'color_temp', color_temp_kelvin: data.color_temp_kelvin, rgb_color: [255, 200, 150] });
      if (data.rgb_color) Object.assign(extra, { color_mode: 'xy', rgb_color: data.rgb_color });
      if (data.rgbw_color) Object.assign(extra, { color_mode: 'rgbw', rgbw_color: data.rgbw_color, rgb_color: [255, 255, 255] });
      setState(id, 'on', { brightness: data.brightness_pct != null ? Math.round(data.brightness_pct * 2.55) : cur?.attributes.brightness ?? 255, ...extra });
    }
    else if (domain === 'light' && service === 'turn_off') for (const one of [].concat(id)) setState(one, 'off', { brightness: null });
    else if (domain === 'music_assistant' && service === 'play_media') setState(id, 'playing', { media_title: data.media_id });
    else if (domain === 'media_player' && service === 'media_stop') setState(id, 'idle', { media_title: null });
    else if (domain === 'media_player' && service === 'volume_set') setState(id, states.get(id).state, { volume_level: data.volume_level });
    else if (domain === 'climate' && service === 'set_temperature') setState(id, data.hvac_mode || states.get(id).state, { temperature: data.temperature });
    else if (domain === 'climate' && service === 'set_hvac_mode') setState(id, data.hvac_mode, {});
    else if (domain === 'climate' && service === 'set_fan_mode') setState(id, states.get(id).state, { fan_mode: data.fan_mode });
    else if (domain === 'climate' && service === 'set_preset_mode') setState(id, states.get(id).state, { preset_mode: data.preset_mode });
    else if (domain === 'test' && service === 'set') setState(id, data.state, data.attributes || {});
  }, delay);
}

function handle(c, msg) {
  if (msg.type === 'auth') {
    return c.send(msg.access_token === 'dev' ? { type: 'auth_ok', ha_version: 'mock' } : { type: 'auth_invalid', message: 'bad token' });
  }
  const ok = (result = null) => c.send({ id: msg.id, type: 'result', success: true, result });
  switch (msg.type) {
    case 'ping': return c.send({ id: msg.id, type: 'pong' });
    case 'get_states': return ok([...states.values()]);
    case 'subscribe_events': c.subId = msg.id; return ok();
    case 'fire_event': console.log('[mock] event', msg.event_type, JSON.stringify(msg.event_data)); return ok();
    case 'call_service': if (msg.domain === 'persistent_notification' || msg.domain === 'notify') console.log('[mock]', msg.domain + '.' + msg.service, JSON.stringify(msg.service_data)); callService(msg.domain, msg.service, msg.service_data || {}); return ok({ context: {} });
    case 'config/area_registry/list': return ok([{ area_id: 'hybel', name: 'Hybel' }, { area_id: 'kjokken', name: 'Kjøkken' }]);
    case 'config/device_registry/list': return ok([]);
    case 'config/entity_registry/list': return ok([...states.keys()].map((id) => ({ entity_id: id, device_id: id.includes('ventilasjon') ? 'dev-vent' : null, area_id: id.includes('hovedhus') || id.includes('benk') ? 'kjokken' : 'hybel' })));
    case 'history/history_during_period': {
      // Syntetisk historikk: døgnvariasjon hvert 10. minutt.
      const out = {};
      const t0 = Date.parse(msg.start_time), t1 = Date.parse(msg.end_time);
      for (const id of msg.entity_ids) {
        const rows = [];
        let k = 0;
        for (let t = t0 - 600e3; t <= t1; t += 600e3, k++) {
          const h = (t / 3600e3) % 24;
          const base = id.includes('bad') ? 23 : 21;
          const temp = Math.round((base + 1.5 * Math.sin((h - 9) / 24 * 2 * Math.PI) + (Math.random() - .5) * .4) * 10) / 10;
          const hum = Math.round(42 + 12 * Math.max(0, Math.sin((h - 6) / 24 * 4 * Math.PI)) + (Math.random() - .5) * 3);
          rows.push(id.startsWith('sensor.') ? { s: String(temp), lu: t / 1000 } : { s: 'heat', a: { current_temperature: temp, current_humidity: hum }, lu: t / 1000 });
        }
        out[id] = rows;
      }
      return ok(out);
    }
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
  const sm = req.url.match(/^\/api\/states\/([a-z_]+\.[a-z0-9_]+)$/);
  if (sm && req.method === 'POST') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { const j = JSON.parse(b); console.log('[mock] state', sm[1], j.state, JSON.stringify(j.attributes)); setState(sm[1], j.state, j.attributes || {}); res.writeHead(201); res.end('{}'); });
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
