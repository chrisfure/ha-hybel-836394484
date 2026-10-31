// Verifisering av Cloudflare Access-token (RS256-JWT) uten eksterne biblioteker.
import { createPublicKey, verify } from 'node:crypto';
import { log } from './log.js';

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export class AccessVerifier {
  constructor({ teamDomain, aud }) {
    let team = (teamDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (team && !team.includes('.')) team = `${team}.cloudflareaccess.com`;
    this.team = team;
    this.aud = (aud || '').trim();
    this.keys = new Map();
    this.fetchedAt = 0;
  }

  get configured() {
    return Boolean(this.team && this.aud);
  }

  async loadKeys(force = false) {
    if (!force && Date.now() - this.fetchedAt < 3600_000 && this.keys.size) return;
    const res = await fetch(`https://${this.team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Kunne ikke hente Cloudflare-nøkler (${res.status})`);
    const body = await res.json();
    this.keys.clear();
    for (const jwk of body.keys || []) {
      try {
        this.keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {}
    }
    this.fetchedAt = Date.now();
  }

  static tokenFrom(req) {
    const h = req.headers['cf-access-jwt-assertion'];
    if (h) return String(h);
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Returnerer payload ved gyldig token, ellers null.
  async verify(token) {
    if (!token || !this.configured) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let header, payload;
    try {
      header = JSON.parse(b64url(parts[0]).toString('utf8'));
      payload = JSON.parse(b64url(parts[1]).toString('utf8'));
    } catch {
      return null;
    }
    if (header.alg !== 'RS256') return null;
    try {
      await this.loadKeys();
      if (!this.keys.has(header.kid)) await this.loadKeys(true);
    } catch (err) {
      log.warn(err.message);
      return null;
    }
    const key = this.keys.get(header.kid);
    if (!key) return null;
    const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64url(parts[2]));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(this.aud)) return null;
    if (typeof payload.exp !== 'number' || payload.exp < now - 30) return null;
    if (payload.nbf && payload.nbf > now + 30) return null;
    if (payload.iss && payload.iss !== `https://${this.team}`) return null;
    return payload;
  }
}
