// Leietakerens side. Har KUN leietakerfunksjoner – ingen utleier-API finnes her.
import http from 'node:http';
import { join } from 'node:path';
import { serveStatic, sendJson, readJson, readBody, servePhoto, EventHub } from './http.js';
import { AccessVerifier } from './cfaccess.js';
import { log } from './log.js';

const SECURITY = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

const notConfiguredPage = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hybel</title><body style="font-family:system-ui;background:#F4EFE7;color:#24201B;padding:40px 20px;max-width:520px;margin:auto">
<h1>Ikke satt opp ennå</h1><p>Siden er ikke ferdig konfigurert. Ta kontakt med utleier.</p></body>`;

export function startTenantServer({ engine, options, webRoot, port }) {
  const verifier = new AccessVerifier({ teamDomain: options.cloudflare_team_domain, aud: options.cloudflare_aud });
  const required = options.require_cloudflare_access !== false;
  const hub = new EventHub();
  engine.on('update', () => hub.broadcast(engine.tenantView()));

  if (required && !verifier.configured) {
    log.warn('Cloudflare Access er påkrevd, men team-domene eller AUD mangler. Leietakersiden er stengt til dette er satt.');
  } else if (!required) {
    log.warn('Cloudflare Access-sjekk er SLÅTT AV. Bruk bare dette til testing på hjemmenettet.');
  }

  async function authorized(req) {
    if (!required) return true;
    if (!verifier.configured) return false;
    return Boolean(await verifier.verify(AccessVerifier.tokenFrom(req)));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });

      if (required && !verifier.configured) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY });
        return res.end(notConfiguredPage);
      }
      if (!(await authorized(req))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
        return res.end('Ingen tilgang');
      }

      if (url.pathname === '/api/events' && req.method === 'GET') {
        return hub.add(req, res, engine.tenantView());
      }
      if (url.pathname === '/api/state' && req.method === 'GET') {
        return sendJson(res, 200, engine.tenantView(), SECURITY);
      }
      if (url.pathname === '/api/cmd' && req.method === 'POST') {
        // Beskyttelse mot forespørsler fra andre nettsteder.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return sendJson(res, 403, { ok: false, error: 'Ugyldig opphav' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return sendJson(res, 415, { ok: false, error: 'Feil format' });
        try {
          const body = await readJson(req);
          const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
          await engine.handleTenant(body, { origin: `${proto === 'http' ? 'http' : 'https'}://${String(req.headers.host || '').replace(/[^a-z0-9.:-]/gi, '')}` });
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      if (url.pathname === '/api/photo' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return sendJson(res, 403, { ok: false, error: 'Ugyldig opphav' });
        if (!String(req.headers['content-type'] || '').startsWith('image/jpeg')) return sendJson(res, 415, { ok: false, error: 'Bildet må være JPEG' });
        try {
          const buf = await readBody(req, 6 * 1024 * 1024);
          const id = engine.extras.savePhoto(buf);
          return sendJson(res, 200, { ok: true, id });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      const pm = url.pathname.match(/^\/api\/photo\/([a-f0-9]{16})$/);
      if (pm && req.method === 'GET') return servePhoto(res, engine.extras.photoFile(pm[1]), SECURITY);
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Ikke funnet' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false });
      return serveStatic(req, res, [join(webRoot, 'tenant'), join(webRoot, 'shared')], SECURITY, (path) => {
        // Gamle bokmerker og ukjente sider sendes til forsiden.
        if (/\.[a-z0-9]+$/i.test(path)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY });
          return res.end('Ikke funnet');
        }
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', ...SECURITY });
        res.end();
      });
    } catch (err) {
      log.error('Feil i leietakerserver:', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Intern feil' });
    }
  });
  server.listen(port, () => log.info(`Leietakerside lytter på port ${port}.`));
  return { server, hub };
}
