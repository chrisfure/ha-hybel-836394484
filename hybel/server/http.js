// Små HTTP-hjelpere: statiske filer, JSON og Server-Sent Events.
import { readFile } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

export async function serveStatic(req, res, roots, headers = {}, onMissing = null) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  for (const root of roots) {
    const file = join(root, rel);
    if (!file.startsWith(root)) continue;
    try {
      const body = await readFile(file);
      const ext = extname(file);
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
        ...(rel === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
        ...headers
      });
      return res.end(body);
    } catch {}
  }
  if (onMissing) return onMissing(path);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Ikke funnet');
}

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Bildet er for stort'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function servePhoto(res, file, headers = {}) {
  try {
    if (!file) throw new Error();
    const st = statSync(file);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400', ...headers });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Ikke funnet');
  }
}

export function sendPdf(res, checklists, id, headers = {}) {
  try {
    const c = checklists.find(id);
    const buf = checklists.pdf(id);
    const name = checklists.filename(c);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': buf.length,
      'Content-Disposition': `inline; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
      ...headers
    });
    res.end(buf);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: err.message });
  }
}

export function sendInvoice(res, lease, month, headers = {}) {
  try {
    const buf = lease.invoicePdf(month);
    const name = `Faktura-${lease.invoiceNo(month)}.pdf`;
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store', ...headers });
    res.end(buf);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: err.message });
  }
}

export function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('For stor forespørsel'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Ugyldig JSON'));
      }
    });
    req.on('error', reject);
  });
}

export class EventHub {
  constructor() {
    this.clients = new Set();
    setInterval(() => {
      for (const res of this.clients) res.write(': ping\n\n');
    }, 25000).unref();
  }

  get size() {
    return this.clients.size;
  }

  add(req, res, first) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    if (first !== undefined) res.write(`data: ${JSON.stringify(first)}\n\n`);
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  broadcast(obj) {
    const msg = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of this.clients) res.write(msg);
  }
}
