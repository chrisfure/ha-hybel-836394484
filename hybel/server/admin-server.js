// Utleiersiden. Nås kun via Home Assistant ingress (Supervisor-proxyen), aldri via Cloudflare.
import http from 'node:http';
import { join } from 'node:path';
import { serveStatic, sendJson, readJson, servePhoto, sendPdf, sendInvoice } from './http.js';
import { log } from './log.js';

const INGRESS_IP = '172.30.32.2';

export function startAdminServer({ engine, ha, webRoot, port, tenantHub, devOpen }) {
  const allowed = (req) => {
    if (devOpen) return true;
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    return ip === INGRESS_IP;
  };

  let registry = { at: 0, areas: new Map(), entityArea: new Map(), deviceArea: new Map() };
  async function loadRegistry() {
    if (Date.now() - registry.at < 60000) return registry;
    const next = { at: Date.now(), areas: new Map(), entityArea: new Map(), deviceArea: new Map() };
    try {
      const [areas, devices, entities] = await Promise.all([
        ha.send({ type: 'config/area_registry/list' }),
        ha.send({ type: 'config/device_registry/list' }),
        ha.send({ type: 'config/entity_registry/list' })
      ]);
      for (const a of areas) next.areas.set(a.area_id, a.name);
      for (const d of devices) if (d.area_id) next.deviceArea.set(d.id, d.area_id);
      for (const e of entities) {
        const area = e.area_id || next.deviceArea.get(e.device_id);
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
    const list = [];
    for (const [id, st] of ha.states) {
      const domain = id.split('.')[0];
      if (!['light', 'climate', 'binary_sensor', 'event'].includes(domain)) continue;
      if (domain === 'event' && !(st.attributes?.event_types || []).some((t) => /press|click|single|double/i.test(t))) continue;
      const a = st.attributes || {};
      let kind = null;
      if (domain === 'light') kind = 'light';
      else if (domain === 'event') kind = 'button';
      else if (domain === 'climate') {
        const hv = a.hvac_modes || [];
        // Varmepumpe/aircondition: kan kjøle. Ventilasjon: viftenivåer uten egen varmemodus. Ellers: varme (termostat).
        kind = hv.includes('cool') || hv.includes('heat_cool') ? 'climate' : Array.isArray(a.fan_modes) && a.fan_modes.length && !hv.includes('heat') ? 'vent' : 'heat';
      }
      const areaId = reg.entityArea.get(id);
      list.push({ entity_id: id, name: a.friendly_name || id, domain, kind, area: areaId ? reg.areas.get(areaId) || areaId : '' });
    }
    list.sort((x, y) => (x.area || 'zzz').localeCompare(y.area || 'zzz', 'nb') || x.name.localeCompare(y.name, 'nb'));
    let notify = [];
    try {
      const services = await ha.send({ type: 'get_services' });
      notify = Object.keys(services.notify || {}).map((s) => `notify.${s}`).sort();
    } catch {}
    // Temperaturfølere som kan brukes for «Nå» (f.eks. gulvføler).
    const temp_sensors = [];
    for (const [id, st] of ha.states) {
      if (!id.startsWith('sensor.')) continue;
      const a = st.attributes || {};
      if (a.device_class !== 'temperature' && !['°C', '°F'].includes(a.unit_of_measurement)) continue;
      temp_sensors.push({ entity_id: id, name: a.friendly_name || id, state: st.state });
    }
    temp_sensors.sort((x, y) => x.name.localeCompare(y.name, 'nb'));
    // Sikkerhet: røykvarslere, lekkasje, batterinivå o.l.
    const safety = [];
    for (const [id, st] of ha.states) {
      const a = st.attributes || {};
      const ok = (id.startsWith('binary_sensor.') && ['smoke', 'moisture', 'gas', 'carbon_monoxide', 'safety', 'problem', 'heat'].includes(a.device_class))
        || (id.startsWith('sensor.') && a.device_class === 'battery')
        || /røyk|smoke|lekk|leak/i.test(id + ' ' + (a.friendly_name || ''));
      if (ok && /^(binary_sensor|sensor)\./.test(id)) safety.push({ entity_id: id, name: a.friendly_name || id, state: st.state });
    }
    safety.sort((x, y) => x.name.localeCompare(y.name, 'nb'));
    // Strømmålere (kWh totalt) for automatisk avlesning.
    const meters = [];
    for (const [id, st] of ha.states) {
      const a = st.attributes || {};
      if (id.startsWith('sensor.') && a.device_class === 'energy' && ['kWh', 'Wh', 'MWh'].includes(a.unit_of_measurement) && a.state_class !== 'measurement') {
        meters.push({ entity_id: id, name: a.friendly_name || id, state: `${st.state} ${a.unit_of_measurement}` });
      }
    }
    meters.sort((x, y) => x.name.localeCompare(y.name, 'nb'));
    return { entities: list, notify_services: notify, temp_sensors, safety, meters };
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
        return sendJson(res, 200, engine.adminView({ tenant_clients: tenantHub.size }));
      }
      if (p === '/api/admin/candidates' && req.method === 'GET') {
        return sendJson(res, 200, await candidates());
      }
      if (p === '/api/admin/config' && req.method === 'PUT') {
        const body = await readJson(req, 256 * 1024);
        const errors = engine.saveAdmin(body);
        return sendJson(res, errors.length ? 400 : 200, { ok: !errors.length, errors, state: engine.adminView({ tenant_clients: tenantHub.size }) });
      }
      if (p === '/api/admin/report' && req.method === 'POST') {
        const body = await readJson(req);
        try {
          engine.extras.adminUpdateReport(body);
          engine.changed();
          return sendJson(res, 200, { ok: true, state: engine.adminView({ tenant_clients: tenantHub.size }) });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      if (p === '/api/admin/test-notify' && req.method === 'POST') {
        const results = await engine.notify('Dette er en test fra Hybelstyring. Kommer denne fram, virker varslene.', { title: 'Testvarsel fra hybel', inbox: true, id: 'test' });
        return sendJson(res, 200, { ok: results.every((r) => r.ok), results });
      }
      if (p === '/api/admin/payment' && req.method === 'POST') {
        const body = await readJson(req);
        try {
          engine.extras.lease.setPaid(body.month, body.paid);
          engine.changed();
          return sendJson(res, 200, { ok: true, state: engine.adminView({ tenant_clients: tenantHub.size }) });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      if (p === '/api/admin/message' && req.method === 'POST') {
        const body = await readJson(req);
        try {
          engine.extras.adminMessage(body);
          engine.changed();
          return sendJson(res, 200, { ok: true, state: engine.adminView({ tenant_clients: tenantHub.size }) });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      if (p === '/api/admin/checklist' && req.method === 'POST') {
        const body = await readJson(req);
        try {
          const c = engine.extras.checklists;
          if (body.action === 'create') c.create(body.type);
          else if (body.action === 'approve') c.approve(body.id, body.comment);
          else if (body.action === 'reopen') c.reopen(body.id);
          else if (body.action === 'delete') c.remove(body.id);
          else throw new Error('Ukjent handling');
          engine.changed();
          return sendJson(res, 200, { ok: true, state: engine.adminView({ tenant_clients: tenantHub.size }) });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      const im = p.match(/^\/api\/admin\/invoice\/(\d{4}-\d{2})\.pdf$/);
      if (im && req.method === 'GET') return sendInvoice(res, engine.extras.lease, im[1]);
      const cm = p.match(/^\/api\/admin\/checklist\/([a-f0-9]{10})\.pdf$/);
      if (cm && req.method === 'GET') return sendPdf(res, engine.extras.checklists, cm[1]);
      const pm = p.match(/^\/api\/admin\/photo\/([a-f0-9]{16})$/);
      if (pm && req.method === 'GET') return servePhoto(res, engine.extras.photoFile(pm[1]));
      if (p === '/api/admin/reading' && req.method === 'POST') {
        const body = await readJson(req);
        try {
          if (body.add) engine.extras.addReading(body.add, 'landlord');
          else if (body.delete) engine.extras.deleteLastReading(body.id, true);
          else engine.extras.setPaid(body.id, body.paid);
          engine.changed();
          return sendJson(res, 200, { ok: true, state: engine.adminView({ tenant_clients: tenantHub.size }) });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      if (p === '/api/admin/tenant-reset' && req.method === 'POST') {
        engine.resetTenant();
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/admin/apply-scene' && req.method === 'POST') {
        const body = await readJson(req);
        try {
          await engine.activateScene(body.id);
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      if (p.startsWith('/api/')) return sendJson(res, 404, { ok: false });
      return serveStatic(req, res, [join(webRoot, 'admin'), join(webRoot, 'shared')]);
    } catch (err) {
      log.error('Feil i utleierserver:', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: err.message });
    }
  });
  server.listen(port, () => log.info(`Utleierside (ingress) lytter på port ${port}.`));
  return server;
}
