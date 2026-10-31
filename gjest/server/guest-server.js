// Gjestesiden. Kun gjestefunksjoner – oppsett finnes ikke på denne porten.
import http from 'node:http';
import { join } from 'node:path';
import { serveStatic, sendJson, readJson, EventHub } from './http.js';
import { log } from './log.js';

const SECURITY = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

// Enkel bremse per IP-adresse, så en feil eller et skript ikke kan hamre løs på huset.
class RateLimit {
  constructor({ perSecond = 15, burst = 40 } = {}) {
    this.perSecond = perSecond;
    this.burst = burst;
    this.buckets = new Map();
    setInterval(() => {
      const old = Date.now() - 60000;
      for (const [ip, b] of this.buckets) if (b.t < old) this.buckets.delete(ip);
    }, 60000).unref();
  }

  take(ip) {
    const now = Date.now();
    const b = this.buckets.get(ip) || { tokens: this.burst, t: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.t) / 1000) * this.perSecond);
    b.t = now;
    this.buckets.set(ip, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

export function startGuestServer({ engine, webRoot, port }) {
  const hub = new EventHub();
  const limit = new RateLimit();
  engine.on('update', () => hub.broadcast(engine.guestView()));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });

      if (url.pathname === '/api/events' && req.method === 'GET') {
        return hub.add(req, res, engine.guestView());
      }
      if (url.pathname === '/api/state' && req.method === 'GET') {
        return sendJson(res, 200, engine.guestView(), SECURITY);
      }
      if (url.pathname === '/api/cmd' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin) {
          let ok = false;
          try { ok = new URL(origin).host === req.headers.host; } catch {}
          if (!ok) return sendJson(res, 403, { ok: false, error: 'Ugyldig opphav' });
        }
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return sendJson(res, 415, { ok: false, error: 'Feil format' });
        const ip = String(req.socket.remoteAddress || '');
        if (!limit.take(ip)) return sendJson(res, 429, { ok: false, error: 'Litt for mange trykk – vent et øyeblikk' });
        try {
          const body = await readJson(req, 8 * 1024);
          await engine.handleGuest(body);
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          log.debug('Avvist gjestekommando:', err.message);
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Ikke funnet' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false });
      return serveStatic(req, res, [join(webRoot, 'guest'), join(webRoot, 'shared')], SECURITY, (path) => {
        if (/\.[a-z0-9]+$/i.test(path)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
          return res.end('Ikke funnet');
        }
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', ...SECURITY });
        res.end();
      });
    } catch (err) {
      log.error('Feil i gjesteserver:', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Intern feil' });
    }
  });
  server.listen(port, () => log.info(`Gjestesiden lytter på port ${port}.`));
  return { server, hub };
}
