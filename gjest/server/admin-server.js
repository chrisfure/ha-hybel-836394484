// Oppsettsiden. Nås kun via Home Assistant ingress (Supervisor-proxyen).
import http from 'node:http';
import { join } from 'node:path';
import { serveStatic, sendJson, readJson } from './http.js';
import { log } from './log.js';

const INGRESS_IP = '172.30.32.2';

export function startAdminServer({ engine, ha, webRoot, port, guestHub, devOpen }) {
  const allowed = (req) => {
    if (devOpen) return true;
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    return ip === INGRESS_IP;
  };

  let registry = { at: 0, areas: new Map(), entityArea: new Map() };
  async function loadRegistry() {
    if (Date.now() - registry.at < 60000) return registry;
    const next = { at: Date.now(), areas: new Map(), entityArea: new Map() };
    try {
      const [areas, devices, entities] = await Promise.all([
        ha.send({ type: 'config/area_registry/list' }),
        ha.send({ type: 'config/device_registry/list' }),
        ha.send({ type: 'config/entity_registry/list' })
      ]);
      const deviceArea = new Map();
      for (const a of areas) next.areas.set(a.area_id, a.name);
      for (const d of devices) if (d.area_id) deviceArea.set(d.id, d.area_id);
      for (const e of entities) {
        const area = e.area_id || deviceArea.get(e.device_id);
        if (area) next.entityArea.set(e.entity_id, area);
      }
    } catch (err) {
      log.debug('Kunne ikke hente områder:', err.message);
    }
    registry = next;
    return registry;
  }

  async function candidates() {
    const reg = await loadRegistry();
    const out = { light: [], climate: [], sensor: [], media_player: [] };
    for (const [id, st] of ha.states) {
      const domain = id.split('.')[0];
      if (!(domain in out)) continue;
      const a = st.attributes || {};
      if (domain === 'sensor' && a.device_class !== 'temperature') continue;
      const areaId = reg.entityArea.get(id);
      const item = { entity_id: id, name: a.friendly_name || id, area: areaId ? reg.areas.get(areaId) || areaId : '' };
      if (domain === 'light') {
        const modes = a.supported_color_modes || [];
        item.caps = [modes.some((m) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m)) ? 'farge' : '', modes.includes('color_temp') ? 'hvittoner' : ''].filter(Boolean);
      }
      out[domain].push(item);
    }
    for (const list of Object.values(out)) {
      list.sort((x, y) => (x.area || 'zzz').localeCompare(y.area || 'zzz', 'nb') || x.name.localeCompare(y.name, 'nb'));
    }
    return out;
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowed(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Kun tilgjengelig via Home Assistant');
      }
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/api/admin/state' && req.method === 'GET') {
        return sendJson(res, 200, engine.adminView({ guest_clients: guestHub.size }));
      }
      if (p === '/api/admin/candidates' && req.method === 'GET') {
        return sendJson(res, 200, await candidates());
      }
      if (p === '/api/admin/config' && req.method === 'PUT') {
        const body = await readJson(req, 256 * 1024);
        const errors = engine.saveAdmin(body);
        return sendJson(res, errors.length ? 400 : 200, { ok: !errors.length, errors, state: engine.adminView({ guest_clients: guestHub.size }) });
      }
      if (p.startsWith('/api/')) return sendJson(res, 404, { ok: false });
      return serveStatic(req, res, [join(webRoot, 'admin'), join(webRoot, 'shared')]);
    } catch (err) {
      log.error('Feil i oppsettserver:', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: err.message });
    }
  });
  server.listen(port, () => log.info(`Oppsettside (ingress) lytter på port ${port}.`));
  return server;
}
