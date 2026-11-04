// Web Push (RFC 8030/8291/8292) uten eksterne pakker: VAPID-signering og aes128gcm-kryptering.
// Nøklene lages første gang og lagres i /data – aldri i koden.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, createCipheriv, sign } from 'node:crypto';
import { log } from './log.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

export function loadVapid(dir) {
  const file = join(dir, 'vapid.json');
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    if (v.publicKey && v.privateJwk) return v;
  } catch {}
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const v = { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), privateJwk: jwk };
  writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
  log.info('Laget nye nøkler for pushvarsler.');
  return v;
}

function vapidHeader(vapid, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const data = `${header}.${claims}`;
  const key = createPrivateKey({ key: vapid.privateJwk, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// aes128gcm-kryptering av meldingen til én mottaker (RFC 8291).
export function encrypt(payload, keys, fixed = {}) {
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Ugyldige abonnementsnøkler');
  const ecdh = createECDH('prime256v1');
  let asPublic;
  if (fixed.asPrivate) { ecdh.setPrivateKey(fixed.asPrivate); asPublic = ecdh.getPublicKey(); } else asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = fixed.salt || randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head.writeUInt8(65, 20);
  return Buffer.concat([head, asPublic, body]);
}

// Sender til ett abonnement. Returnerer 'ok', 'gone' (abonnementet finnes ikke lenger) eller 'error'.
export async function sendPush(vapid, sub, message, subject, opts = {}) {
  try {
    const body = encrypt(JSON.stringify(message), sub.keys);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidHeader(vapid, sub.endpoint, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl ?? 86400),
        Urgency: opts.urgency || 'normal',
        ...(opts.topic ? { Topic: opts.topic } : {})
      },
      body,
      signal: AbortSignal.timeout(15000)
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      log.warn(`Pushvarsel avvist (${res.status}):`, (await res.text().catch(() => '')).slice(0, 200));
      return 'error';
    }
    return 'ok';
  } catch (err) {
    log.warn('Pushvarsel feilet:', err.message);
    return 'error';
  }
}
