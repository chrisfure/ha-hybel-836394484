// Leietakersiden – ren JavaScript, ingen rammeverk.
import { qrSvg, wifiString } from './qr.js';

const $app = document.getElementById('app');

// Språk: norsk eller engelsk. Standard følger telefonen; valget huskes. Bytte laster siden på nytt.
const LANG = (() => {
  let v = null;
  try { v = localStorage.getItem('hybel-lang'); } catch {}
  if (v === 'no' || v === 'en') return v;
  const nav = (navigator.languages || [navigator.language || 'nb']).map((x) => String(x).toLowerCase());
  return nav.some((x) => /^(nb|nn|no|da|sv)/.test(x)) ? 'no' : 'en';
})();
const EN = LANG === 'en';
const L = (no, en) => (EN ? en : no);
const LOC = EN ? 'en-GB' : 'nb-NO';
document.documentElement.lang = EN ? 'en' : 'nb';

// Sperr zoom (iOS Safari ignorerer user-scalable=no). Knapper og felt beskyttes med touch-action i CSS.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350 && !e.target.closest('button, input, select, a, label')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

const S = {
  m: null,             // siste tilstand fra serveren
  tab: (() => { const t = store.get('hybel-tab'); return !t || t === 'scener' ? 'lys' : t; })(),
  view: 'tabs',        // tabs | settings | scene | auto
  draft: null,         // sceneutkast { id, name, icon, include, values }
  adraft: null,        // automasjonsutkast
  pending: {},         // key -> { v, t } (optimistisk visning mens HA svarer)
  lastBri: {},
  lastMode: {},
  toast: null,
  conn: 'connecting',  // connecting | ok | lost | relogin
  fails: 0,
  dragging: null,
  deferred: false,
  confirmDelete: false,
  infoSub: 'info',      // info | strom | meld | sjekk
  report: { category: null, text: '', urgent: false, photos: [] },
  push: { supported: false, ios: false, standalone: false, permission: 'default', sub: null, busy: false },
  uploading: null,     // nøkkel for punkt som laster opp bilde
  photo: null,         // bilde som vises i stort format
  pdf: null,           // { key, file } – ferdig hentet PDF av sjekklisten
  meldHelp: store.get('hybel-meld-help') !== '0',
  autoOpen: (() => { try { return JSON.parse(localStorage.getItem('hybel-auto-open') || '{}'); } catch { return {}; } })(),
  reply: {},
  reading: { date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(), value: '' }
};
const TYPING = 'input[type="text"], input[type="time"], input[type="number"], input[type="date"], textarea';

const ICON = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  pot: 'M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  sofa: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2zM5 18v2M19 18v2',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  door: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  tv: 'M3 6h18v11H3zM8 21h8M12 17v4',
  bed: 'M3 18V7M3 12h18v6M21 18v-4a3 3 0 0 0-3-3h-7v4M7 11a2 2 0 1 0 0-.1',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  leaf: 'M5 19c0-8 5-14 15-15 0 10-6 15-14 15zM5 19l7-7'
};
const UI = {
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
  flame: 'M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.5 1.5 1.5 2.5 3 2.5-1-2-1-4.5 0-7z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  gear: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5 9-10',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  snow: 'M12 2v20M4 6l16 12M20 6L4 18',
  power: 'M12 3v9M6.3 7a8 8 0 1 0 11.4 0'
};
const VENT_LABEL = EN ? { away: 'Away', low: 'Low', normal: 'Normal', high: 'High' } : { away: 'Borte', low: 'Lav', normal: 'Normal', high: 'Høy' };
const VENT_LEVEL = { away: 0, low: 1, normal: 2, high: 3 };
const MODE_LABEL = EN ? { off: 'Off', heat: 'Heat', cool: 'Cool', heat_cool: 'Auto', auto: 'Auto', dry: 'Dry', fan_only: 'Fan' } : { off: 'Av', heat: 'Varme', cool: 'Kjøling', heat_cool: 'Auto', auto: 'Auto', dry: 'Tørk', fan_only: 'Vifte' };
const FAN_LABEL = EN ? { auto: 'Auto', low: 'Low', medium: 'Medium', mid: 'Medium', high: 'High', quiet: 'Quiet', silent: 'Silent', turbo: 'Turbo', powerful: 'Powerful' } : { auto: 'Auto', low: 'Lav', medium: 'Middels', mid: 'Middels', high: 'Høy', quiet: 'Stille', silent: 'Stille', turbo: 'Turbo', powerful: 'Kraftig' };
const fanLabel = (f) => FAN_LABEL[String(f).toLowerCase()] || String(f).charAt(0).toUpperCase() + String(f).slice(1);
const DAYS = EN ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] : ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];
const TABS = [
  { id: 'lys', label: L('Lys', 'Lights'), icon: UI.bulb },
  { id: 'klima', label: L('Klima', 'Climate'), icon: UI.flame },
  { id: 'auto', label: L('Automasjoner', 'Automations'), short: 'Auto', icon: UI.clock },
  { id: 'stat', label: L('Statistikk', 'Statistics'), short: L('Statistikk', 'Stats'), icon: 'M4 19h16M7 15l3-4 3 2 4-6' },
  { id: 'info', label: 'Info', icon: 'M12 8h.01M11 12h1v4h1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' }
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deg = (t) => (t == null || !Number.isFinite(Number(t)) ? '–' : String(Math.round(Number(t) * 10) / 10).replace('.', EN ? '.' : ',') + '°');
const svg = (d, size = 22, sw = 1.8) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const clock = (ms) => new Date(ms).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- tilkobling ----------

function connect() {
  // Kommer ingen data innen 15 sek, vis en knapp i stedet for å vente for alltid.
  setTimeout(() => {
    if (!S.m) { S.conn = 'relogin'; render(); }
  }, 15000);
  const es = new EventSource('api/events');
  es.onmessage = (e) => {
    S.fails = 0;
    S.conn = 'ok';
    const next = JSON.parse(e.data);
    // Appen er oppdatert på serveren: last inn ny versjon (vent hvis noen skriver).
    if (S.m && S.m.build && next.build && next.build !== S.m.build) {
      const ae = document.activeElement;
      if (!(ae && ae.matches?.(TYPING))) { location.reload(); return; }
    }
    S.m = next;
    prunePending();
    render();
  };
  es.onerror = () => {
    S.fails++;
    S.conn = S.fails >= 6 ? 'relogin' : 'lost';
    if (S.conn === 'relogin') es.close();
    render();
  };
}

async function cmd(body) {
  try {
    const r = await fetch('api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    if (r.status === 403) {
      S.conn = 'relogin';
      render();
      return { ok: false };
    }
    const j = await r.json().catch(() => ({ ok: false, error: L('Uventet svar', 'Unexpected response') }));
    if (!j.ok) showToast(serverText(j.error) || L('Noe gikk galt', 'Something went wrong'), true);
    return j;
  } catch {
    showToast(L('Fikk ikke kontakt med huset. Prøv igjen.', 'Could not reach the house. Please try again.'), true);
    return { ok: false };
  }
}

// Én forespørsel om gangen per enhet – den nyeste verdien vinner alltid.
const queue = {};
function sendSet(key, value) {
  const q = (queue[key] ||= { busy: false, next: undefined });
  q.next = value;
  if (!q.busy) pump(key);
}
async function pump(key) {
  const q = queue[key];
  if (q.next === undefined) return;
  const v = q.next;
  q.next = undefined;
  q.busy = true;
  const started = Date.now();
  await cmd({ type: 'set', key, value: v });
  const wait = 70 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  q.busy = false;
  if (q.next !== undefined) pump(key);
}

const debouncers = {};
function sendLater(key, value, ms = 400) {
  clearTimeout(debouncers[key]);
  debouncers[key] = setTimeout(() => sendSet(key, value), ms);
}

function setPending(key, v) {
  S.pending[key] = { v, t: Date.now() };
}
function prunePending() {
  const now = Date.now();
  for (const [key, p] of Object.entries(S.pending)) {
    const ent = S.m.entities.find((e) => e.key === key);
    let ok = false;
    if (ent) {
      if (ent.kind === 'light') ok = Math.abs((ent.value ?? -99) - p.v) <= 2 || (p.v === 0 && ent.value === 0);
      else if (ent.kind === 'climate') ok = ent.value && ent.value.mode === p.v.mode && (p.v.mode === 'off' || ((p.v.temp == null || ent.value.temp === p.v.temp) && (p.v.fan == null || ent.value.fan === p.v.fan)));
      else ok = same(ent.value, p.v);
    }
    if (!ent || (ok && now - p.t > 300) || now - p.t > 5000) delete S.pending[key];
  }
}
function valueOf(ent) {
  const p = S.pending[ent.key];
  return p ? p.v : ent.value;
}
const entity = (key) => S.m.entities.find((e) => e.key === key);
const sceneById = (id) => S.m.scenes.find((s) => s.id === id);
const target = () => (S.view === 'scene' ? S.draft : S.adraft?.set);

let toastTimer;
function showToast(msg, error = false) {
  S.toast = { msg, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.toast = null;
    render();
  }, error ? 5000 : 2500);
  render();
}

// ---------- tekst ----------

function valuesSummary(values) {
  const parts = [];
  const ents = S.m.entities;
  const lights = ents.filter((e) => e.kind === 'light' && values[e.key] !== undefined);
  if (lights.length) {
    const on = lights.filter((l) => values[l.key] > 0);
    parts.push(on.length ? (on.length === lights.length && lights.length > 1 ? L('lys', 'lights') : `${on.length} ${L('lys', on.length === 1 ? 'light' : 'lights')}`) : L('lys av', 'lights off'));
  }
  for (const e of ents) {
    const v = values[e.key];
    if (v === undefined || e.kind === 'light') continue;
    if (e.kind === 'heat') parts.push(`${e.label.toLowerCase()} ${deg(v)}`);
    else if (e.kind === 'vent') parts.push(`${L('luft', 'air')} ${VENT_LABEL[v].toLowerCase()}`);
    else if (e.kind === 'climate') parts.push(v.mode === 'off' ? `${e.label.toLowerCase()} ${L('av', 'off')}` : `${e.label.toLowerCase()} ${MODE_LABEL[v.mode].toLowerCase()}${v.temp != null && v.mode !== 'fan_only' ? ` ${deg(v.temp)}` : ''}`);
  }
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function autoWhen(t, w) {
  let s;
  if (t.type === 'time') s = L(`Kl. ${t.at}`, `At ${t.at}`);
  else if (t.type === 'sunset' || t.type === 'sunrise') {
    const base = t.type === 'sunset' ? L('Solnedgang', 'Sunset') : L('Soloppgang', 'Sunrise');
    if (!t.offset) s = base;
    else {
      const abs = Math.abs(t.offset);
      s = `${abs % 60 === 0 ? `${abs / 60} ${L('t', 'h')}` : `${abs} min`} ${t.offset < 0 ? L('før', 'before') : L('etter', 'after')} ${base.toLowerCase()}`;
    }
  } else if (t.type === 'light') s = L(`Når ${(entity(t.entity)?.label || 'lyset').toLowerCase()} slås ${t.to === 'on' ? 'på' : 'av'}`, `When ${(entity(t.entity)?.label || 'the light').toLowerCase()} turns ${t.to === 'on' ? 'on' : 'off'}`);
  else if (t.type === 'humidity') s = L(`Når luftfuktigheten er over ${t.above} %`, `When humidity is above ${t.above} %`);
  else if (t.type === 'button') s = `${entity(t.entity)?.label || L('Knapp', 'Button')}: ${eventLabel(t.event).toLowerCase()}`;
  else s = '';
  if (w) s += ` (${w.from}–${w.to})`;
  return s;
}
function autoDays(days) {
  if (days.length === 7) return L('hver dag', 'every day');
  if (days.join() === '1,2,3,4,5') return L('hverdager', 'weekdays');
  if (days.join() === '6,7') return L('helg', 'weekends');
  return days.map((d) => DAYS[d - 1].toLowerCase()).join(', ');
}
function autoWhat(a) {
  if (a.type === 'scene') return sceneById(a.scene_id)?.name || L('(slettet scene)', '(deleted scene)');
  if (a.type === 'lights_off') return L('Slå av alle lys', 'Turn off all lights');
  if (a.type === 'set') return valuesSummary(a.values) || L('Styr enheter', 'Control devices');
  const names = (a.entities || []).map((k) => entity(k)?.label || '').filter(Boolean).join(', ').toLowerCase();
  if (a.type === 'dim') return L(`Dim ${names} ${a.dir === 'up' ? 'opp' : 'ned'}`, `Dim ${names} ${a.dir === 'up' ? 'up' : 'down'}`);
  if (a.type === 'light_on' || a.type === 'light_off') return L(`Slå ${a.type === 'light_on' ? 'på' : 'av'} ${names}`, `Turn ${a.type === 'light_on' ? 'on' : 'off'} ${names}`);
  return '';
}
// «button_2_up_press» → «Knapp 2 opp – trykk»
function eventLabel(ev) {
  const m = String(ev).match(/button_(\d+)_(up|down|on|off)_(press|hold|release|short_release|long_press)/i);
  if (m) {
    const dir = { up: '▲', on: '▲', down: '▼', off: '▼' }[m[2].toLowerCase()];
    const how = /hold|long/i.test(m[3]) ? 'hold' : L('trykk', 'press');
    return `${L('Knapp', 'Button')} ${m[1]} ${dir} ${how}`;
  }
  const map = EN ? { single: 'Single press', double: 'Double press', long: 'Long press', press: 'Press', hold: 'Hold' } : { single: 'Ett trykk', double: 'Dobbeltrykk', long: 'Langt trykk', press: 'Trykk', hold: 'Hold' };
  return map[String(ev).toLowerCase()] || String(ev).replace(/_/g, ' ');
}
const revertLabel = (m) => (m === 0 ? L('Aldri', 'Never') : m < 60 ? `${m} min` : `${m / 60} ${L('t', 'h')}`);

// ---------- byggeklosser ----------

function kicker() {
  if (S.conn !== 'ok') return ['warn', L('Kobler til …', 'Connecting …')];
  if (!S.m.connected) return ['bad', L('Mistet kontakt med huset', 'Lost contact with the house')];
  return ['', L('Tilkoblet', 'Connected')];
}

function tabs() {
  const m = S.m;
  return TABS.filter((t) => {
    if (t.id === 'lys') return m.entities.some((e) => e.kind === 'light');
    if (t.id === 'klima') return m.entities.some((e) => ['heat', 'vent', 'climate'].includes(e.kind));
    if (t.id === 'auto') return m.can_edit || m.automations.length;
    if (t.id === 'stat') return m.entities.some((e) => ['heat', 'vent', 'climate'].includes(e.kind));
    if (t.id === 'info') return true;
    return true;
  });
}

function topHTML(title) {
  const [cls, text] = kicker();
  const active = S.m.scenes.filter((s) => s.active).map((s) => s.name);
  return `<header class="top">
    <div>
      <span class="kicker ${cls}"><span class="dot ${cls}"></span>${text}</span>
      <h1>${esc(title)}</h1>
      ${active.length && S.tab === 'scener' ? `<span class="active-line">${esc(active.join(' · '))}</span>` : ''}
    </div>
    <button class="icon-btn" data-act="settings" data-fid="settings" aria-label="${L('Innstillinger', 'Settings')}">${svg(UI.gear)}</button>
  </header>`;
}

function subHTML(kick, title) {
  return `<header class="sub">
    <button class="icon-btn" data-act="back" data-fid="back" aria-label="${L('Tilbake', 'Back')}">${svg(UI.back, 22, 2)}</button>
    <div><span class="kicker">${esc(kick)}</span><h1>${esc(title)}</h1></div>
  </header>`;
}

function navHTML() {
  const list = tabs();
  return `<nav class="tabbar" style="grid-template-columns: repeat(${list.length}, minmax(0, 1fr))" aria-label="${L('Faner', 'Tabs')}">
    ${list.map((t) => `<button class="tab" aria-current="${S.tab === t.id ? 'page' : 'false'}" data-act="tab" data-id="${t.id}" data-fid="tab-${t.id}">${svg(t.icon, 22)}<span>${t.short || t.label}</span>${t.id === 'info' && infoBadge() ? `<i class="badge-dot" aria-label="${L('Nytt', 'New')}"></i>` : ''}</button>`).join('')}
  </nav>`;
}

function toastHTML() {
  if (!S.toast) return '';
  return `<div class="toast ${S.toast.error ? 'error' : ''}" role="status">${S.toast.error ? '' : svg(UI.check, 18, 2.2)}<span>${esc(S.toast.msg)}</span></div>`;
}

function lightRow(e, v, mode) {
  const on = v > 0;
  const live = mode === 'draft' || e.available;
  const P = S.m.pairing || {};
  const helpable = !live && mode === 'live' && P.allowed;
  const pairing = mode === 'live' && P.open_until && P.key === e.key;
  const status = !live ? (helpable ? L('Ikke tilkoblet', 'Not connected') : L('Svarer ikke', 'Not responding')) : on ? (e.dimmable ? `${L('På', 'On')} · ${v} %` : L('På', 'On')) : L('Av', 'Off');
  if (helpable || pairing) return pairRow(e, pairing && P.responding ? L('Svarer – fullfør tilkoblingen', 'Responding – finish connecting') : L('Ikke tilkoblet', 'Not connected'));
  return `<div class="light ${live ? '' : 'unavail'}">
    <div class="row">
      ${mode === 'draft' ? `<span class="status" data-status="${e.key}">${status}</span>` : `<span><span class="name">${esc(e.label)}</span><span class="status" data-status="${e.key}">${status}</span>${P.done === e.key ? `<span class="pair-ok">${L('Tilkoblet igjen ✓', 'Connected again ✓')}</span>` : ''}</span>`}
      <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(e.label)}" data-act="toggle" data-key="${e.key}" data-mode="${mode}" data-fid="t-${mode}-${e.key}" ${live ? '' : 'disabled'}></button>
    </div>
    ${on && e.dimmable && live ? `<input class="range" type="range" min="1" max="100" step="1" value="${v}" aria-label="${L('Lysstyrke', 'Brightness')} ${esc(e.label)}" data-key="${e.key}" data-mode="${mode}" data-fid="r-${mode}-${e.key}">` : ''}
  </div>`;
}

// Lys som har falt ut av Zigbee-nettet: infoknapp og veiledning for å koble det til igjen.
function pairRow(e, status) {
  const P = S.m.pairing;
  const open = S.pairHelp === e.key;
  const active = P.open_until && P.key === e.key;
  let h = `<div class="light pair ${open ? 'open' : ''}">
    <div class="row">
      <span><span class="name">${esc(e.label)}</span><span class="status warn-s">${status}</span></span>
      <button class="info-btn ${active ? 'busy' : ''}" data-act="pair-help" data-key="${e.key}" aria-expanded="${open}" aria-label="${L('Hjelp til å koble til', 'Help connecting')} ${esc(e.label)}">${active ? L('Kobler til …', 'Connecting …') : 'i'}</button>
    </div>`;
  if (open || active) {
    h += `<div class="pair-help">
      ${EN ? `<p class="note">The light has lost contact with the smart home system (Zigbee). Here's how to reconnect it:</p>
      <ol class="steps">
        <li><strong>Turn the light on</strong> with the wall switch so it has power.</li>
        <li>Tap <strong>Start connecting</strong> below. The system will look for the light for 10 minutes.</li>
        <li><strong>Switch the wall switch off and on 7 times quickly</strong> (about once per second). The light blinks when it has been reset.</li>
        <li>Leave the light on and wait 1–2 minutes. It may briefly show up here along the way – that's normal.</li>
        <li>When the light can be switched on and off from the app again, tap <strong>Done</strong>.</li>
      </ol>` : `<p class="note">Lyset har mistet kontakten med smarthuset (Zigbee). Slik kobler du det til igjen:</p>
      <ol class="steps">
        <li><strong>Slå på lyset</strong> med lysbryteren på veggen, så det får strøm.</li>
        <li>Trykk <strong>Start tilkobling</strong> under. Da er smarthuset klart til å finne lyset i 10 minutter.</li>
        <li><strong>Slå bryteren av og på 7 ganger raskt</strong> (ca. ett trykk i sekundet). Lyset blinker når det er tilbakestilt.</li>
        <li>La lyset stå på og vent 1–2 minutter. Det kan dukke opp her et øyeblikk underveis – det er normalt.</li>
        <li>Når lyset kan slås av og på fra appen igjen, trykk <strong>Ferdig</strong>.</li>
      </ol>`}
      ${active
        ? `<div class="pair-live">${P.responding ? `<span class="dot-ok"></span><span>${L('<strong>Lyset svarer!</strong> Prøv å slå det av og på i appen før du trykker Ferdig.', '<strong>The light is responding!</strong> Try switching it off and on in the app before tapping Done.')}` : `<span class="dot-pulse"></span><span>${L('Venter på lyset …', 'Waiting for the light …')}`} <strong data-countdown="${P.open_until}">${fmtLeft(P.open_until)}</strong> ${L('igjen', 'left')}</span></div>
           ${P.responding ? `<button class="switch" role="switch" aria-checked="${(valueOf(e) ?? 0) > 0}" aria-label="${L('Test', 'Test')} ${esc(e.label)}" data-act="toggle" data-key="${e.key}" data-mode="live"></button>` : ''}
           <button class="btn ${P.responding ? 'primary big' : 'ghost'}" data-act="pair-stop">${P.responding ? L('Ferdig – lyset virker', 'Done – the light works') : L('Avbryt', 'Cancel')}</button>`
        : P.open_until
          ? `<p class="note">${L('Et annet lys holder på å kobles til. Prøv igjen om litt.', 'Another light is being connected. Try again in a moment.')}</p>`
          : `<button class="btn primary big" data-act="pair-start" data-key="${e.key}">${L('Start tilkobling', 'Start connecting')}</button>`}
      <p class="note">${L('Virker det ikke etter to forsøk, send en melding til utleier under Info.', "If it still doesn't work after two tries, send the landlord a message under Info.")}</p>
    </div>`;
  }
  return h + `</div>`;
}

function fmtLeft(until) {
  const s = Math.max(0, Math.round((until - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(() => {
  for (const el of document.querySelectorAll('[data-countdown]')) el.textContent = fmtLeft(Number(el.dataset.countdown));
}, 1000);

function stepper(e, v, mode, act = 'heat') {
  const live = mode === 'draft' || e.available;
  const atMax = v != null && v >= e.max;
  const atMin = v != null && v <= e.min;
  return `<span class="stepper">
    <button data-act="${act}" data-dir="-1" data-key="${e.key}" data-mode="${mode}" data-fid="hd-${mode}-${e.key}" aria-label="${L('Senk temperatur', 'Lower temperature')}" ${!live || atMin ? 'disabled' : ''}>−</button>
    <output aria-live="polite">${deg(v)}</output>
    <button data-act="${act}" data-dir="1" data-key="${e.key}" data-mode="${mode}" data-fid="hu-${mode}-${e.key}" aria-label="${L('Øk temperatur', 'Raise temperature')}" ${!live || atMax ? 'disabled' : ''}>+</button>
  </span>`;
}

function limitLine(e, v) {
  const atMax = v != null && v >= e.max;
  const atMin = v != null && v <= e.min;
  const text = !e.available ? L('Svarer ikke akkurat nå', 'Not responding right now') : atMax ? `${L('Maks', 'Max')} ${e.max}°` : atMin ? `Min ${e.min}°` : '';
  return text ? `<div class="limit ${atMax || atMin ? 'hit' : ''}">${text}</div>` : '';
}

function ventButtons(e, v, mode) {
  const live = mode === 'draft' || e.available;
  return `<div class="fans" style="grid-template-columns: repeat(${e.modes.length}, minmax(0, 1fr))">
    ${e.modes.map((mo) => {
      const lvl = VENT_LEVEL[mo];
      const bars = [8, 14, 20].map((h, i) => `<i class="${i < lvl ? 'on' : ''}" style="height:${h}px"></i>`).join('');
      return `<button class="fan" aria-pressed="${v === mo}" data-act="fan" data-key="${e.key}" data-v="${mo}" data-mode="${mode}" data-fid="f-${mode}-${e.key}-${mo}" ${live ? '' : 'disabled'}><span class="bars">${bars}</span>${VENT_LABEL[mo]}</button>`;
    }).join('')}
  </div>`;
}

function climateControls(e, v, mode) {
  v = v || { mode: 'off' };
  const live = mode === 'draft' || e.available;
  const on = v.mode !== 'off';
  const modes = e.modes.filter((m) => m !== 'off');
  let h = `<div class="row climate-power">
      <span class="status">${on ? MODE_LABEL[v.mode] : L('Av', 'Off')}${!on || mode === 'draft' || S.pending[e.key] || !e.action || e.action === 'idle' || e.action === 'off' ? '' : e.action === 'heating' ? L(' · varmer', ' · heating') : e.action === 'cooling' ? L(' · kjøler', ' · cooling') : ''}</span>
      <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(e.label)} ${L('på eller av', 'on or off')}" data-act="cl-power" data-key="${e.key}" data-mode="${mode}" data-fid="cp-${mode}-${e.key}" ${live ? '' : 'disabled'}></button>
    </div>`;
  if (on) {
    if (modes.length > 1) {
      h += `<div class="seg" style="grid-template-columns: repeat(${modes.length}, minmax(0, 1fr))">${modes.map((mo) => `<button aria-pressed="${v.mode === mo}" data-act="cl-mode" data-key="${e.key}" data-v="${mo}" data-mode="${mode}" ${live ? '' : 'disabled'}>${MODE_LABEL[mo]}</button>`).join('')}</div>`;
    }
    if (v.mode !== 'fan_only') h += `<div class="row climate-temp"><span class="status">${L('Temperatur', 'Temperature')}</span>${stepper(e, v.temp, mode, 'cl-temp')}</div>`;
    if (e.fans.length) {
      h += `<span class="field-label">${L('Vifte', 'Fan')}</span><div class="seg fans-seg" style="grid-template-columns: repeat(${Math.min(e.fans.length, 5)}, minmax(0, 1fr))">${e.fans.map((f) => `<button aria-pressed="${v.fan === f}" data-act="cl-fan" data-key="${e.key}" data-v="${esc(f)}" data-mode="${mode}" ${live ? '' : 'disabled'}>${esc(fanLabel(f))}</button>`).join('')}</div>`;
    }
  }
  return h;
}

// ---------- faner ----------

function scenesTab() {
  const m = S.m;
  let h = '';
  if (S.sceneEdit && m.can_edit) {
    h += `<section class="card section scene-list">`;
    for (const sc of m.scenes) {
      h += `<div class="scene-row"><button class="scene-main" data-act="scene-edit" data-id="${sc.id}">
          <span class="ic">${svg(ICON[sc.icon] || ICON.star, 18)}</span>
          <span class="txt"><span class="name">${esc(sc.name)}</span><span class="sum">${esc(valuesSummary(sc.values))}</span></span>
          ${svg(UI.pencil, 15, 2)}
        </button></div>`;
    }
    h += `</section><div class="scene-tools"><button class="btn ghost" data-act="scene-new" data-fid="s-new">${svg(UI.plus, 18, 2)} ${L('Ny scene', 'New scene')}</button><button class="btn primary" data-act="scene-edit-mode">${L('Ferdig', 'Done')}</button></div>`;
    return h;
  }
  if (m.scenes.length) {
    h += `<div class="scene-head"><span class="group-title">${L('Scener', 'Scenes')}</span>${m.can_edit ? `<button class="link-btn" data-act="scene-edit-mode">${L('Endre', 'Edit')}</button>` : ''}</div>`;
    h += `<div class="scene-chips">${m.scenes.map((sc) => `<button class="scene-chip ${sc.active ? 'active' : ''}" data-act="scene" data-id="${sc.id}" data-fid="s-${sc.id}" aria-pressed="${sc.active}">
        ${svg(ICON[sc.icon] || ICON.star, 16)}<span>${esc(sc.name)}</span></button>`).join('')}</div>`;
  } else if (m.can_edit) h += `<button class="chip-btn scene-edit-btn" data-act="scene-edit-mode">${L('+ Lag en scene', '+ Create a scene')}</button>`;
  return h;
}

function lightsTab() {
  const lights = S.m.entities.filter((e) => e.kind === 'light');
  return `<section class="card section"><div class="section-head"><h2>${L('Alle lys', 'All lights')}</h2>
      <button class="chip-btn" data-act="all-off" data-fid="alloff">${L('Slå av alle', 'Turn all off')}</button></div>
      ${lights.map((e) => lightRow(e, valueOf(e) ?? 0, 'live')).join('')}</section>`;
}

function climateTab() {
  const m = S.m;
  let h = '';
  for (const e of m.entities.filter((x) => ['heat', 'vent', 'climate'].includes(x.kind))) {
    const v = valueOf(e);
    if (e.kind === 'heat') {
      const now = e.current != null ? `${L('Nå', 'Now')} ${deg(e.current)}${e.heating ? L(' · varmer', ' · heating') : ''}` : '';
      h += `<section class="card heat ${e.available ? '' : 'unavail'}">
        <div class="row"><span><span class="title">${esc(e.label)}</span><span class="muted" style="font-size:13px">${now}</span></span>${stepper(e, v, 'live')}</div>
        ${limitLine(e, v)}
      </section>`;
    } else if (e.kind === 'climate') {
      h += `<section class="card heat climate ${e.available ? '' : 'unavail'}">
        <div class="row"><span><span class="title">${esc(e.label)}</span><span class="muted" style="font-size:13px">${e.current != null ? `${L('Nå', 'Now')} ${deg(e.current)}` : ''}</span></span></div>
        ${climateControls(e, v, 'live')}
        ${v && v.mode !== 'off' && v.mode !== 'fan_only' ? limitLine(e, v.temp) : ''}
      </section>`;
    } else if (e.kind === 'vent') {
      const meta = [e.humidity != null ? `${L('Luftfukt', 'Humidity')} ${Math.round(e.humidity)} %` : '', e.temperature != null ? deg(e.temperature) : ''].filter(Boolean).join(' · ');
      h += `<section class="vent ${e.available ? '' : 'unavail'}">
        <div class="section-head"><h2>${esc(e.label)}</h2><span class="meta">${e.available ? meta : L('Svarer ikke', 'Not responding')}</span></div>
        ${ventButtons(e, v, 'live')}
        ${v === 'high' && m.boost && m.boost.key === e.key ? `<div class="boost">${svg(UI.clock, 18, 2)}<span>${L(`Høy til kl. ${clock(m.boost.until)}, så tilbake til ${VENT_LABEL[m.boost.return_to].toLowerCase()}`, `High until ${clock(m.boost.until)}, then back to ${VENT_LABEL[m.boost.return_to].toLowerCase()}`)}</span></div>` : ''}
      </section>`;
    }
  }
  return h;
}

// Automasjoner samlet i grupper: knapper (per knapp), tidspunkter (sortert på klokkeslett) og hendelser.
function autoSortKey(a) {
  const t = a.trigger;
  if (t.type === 'time') return t.at;
  if (t.type === 'sunrise') return `06:00+${String(1000 + (t.offset || 0)).padStart(5, '0')}`;
  if (t.type === 'sunset') return `18:00+${String(1000 + (t.offset || 0)).padStart(5, '0')}`;
  return '';
}

function autoRow(a, title, sub, tag = '') {
  const m = S.m;
  if (a.fixed) {
    return `<div class="list-row auto-row fixed">
      <span class="grow">${tag ? `<span class="auto-tag">${esc(tag)}</span>` : ''}<span class="t">${esc(title)}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</span>
      <span class="fixed-tag">${L('Fast', 'Fixed')}</span>
    </div>`;
  }
  return `<div class="list-row auto-row ${a.enabled ? '' : 'off'}">
    <button class="grow plain" data-act="auto-edit" data-id="${a.id}" data-fid="a-${a.id}" ${m.can_edit ? '' : 'disabled'}>
      ${tag ? `<span class="auto-tag">${esc(tag)}</span>` : ''}
      <span class="t">${esc(title)}</span>
      ${sub ? `<span class="s">${esc(sub)}</span>` : ''}
    </button>
    ${m.can_edit ? `<button class="switch teal" role="switch" aria-checked="${a.enabled}" aria-label="${L('Automasjon på', 'Automation on')}" data-act="auto-toggle" data-id="${a.id}" data-fid="at-${a.id}"></button>` : ''}
  </div>`;
}

function autoGroup(key, title, icon, list, body) {
  const open = S.autoOpen[key] !== false;
  const on = list.filter((a) => a.enabled).length;
  return `<section class="auto-group">
    <button class="auto-head" data-act="auto-group" data-v="${key}" aria-expanded="${open}">
      <span class="row-ic">${svg(icon, 20)}</span>
      <span class="grow"><span class="t">${esc(title)}</span><span class="s">${L(`${list.length} automasjon${list.length === 1 ? '' : 'er'}`, `${list.length} automation${list.length === 1 ? '' : 's'}`)}${on < list.length ? ` · ${on} ${L('på', 'on')}` : ''}</span></span>
      <span class="chev-s ${open ? 'open' : ''}">${svg(UI.down, 18, 2)}</span>
    </button>
    ${open ? `<div class="list">${body}</div>` : ''}
  </section>`;
}

function autoTab() {
  const m = S.m;
  let h = '';
  if (!m.automations.length) h += `<p class="intro">${L('Automasjoner gjør ting av seg selv – f.eks. «Kos 30 min før solnedgang» eller «Slå av lyset kl. 23».', 'Automations do things on their own – e.g. “Cosy 30 min before sunset” or “Turn off the lights at 23:00”.')}</p>`;
  const extra = (a) => [a.window ? `${a.window.from}–${a.window.to}` : '', a.days.length !== 7 ? autoDays(a.days) : '', a.revert_after ? `${L('tilbake etter', 'revert after')} ${revertLabel(a.revert_after)}` : ''].filter(Boolean).join(' · ');

  // 1. Knapper – én gruppe per knapp, sortert på knappenummer og retning.
  const buttons = m.automations.filter((a) => a.trigger.type === 'button');
  const byEntity = new Map();
  for (const a of buttons) {
    if (!byEntity.has(a.trigger.entity)) byEntity.set(a.trigger.entity, []);
    byEntity.get(a.trigger.entity).push(a);
  }
  for (const [ent, list] of byEntity) {
    const parse = (a) => {
      const x = String(a.trigger.event).match(/button_(\d+)_(up|down|on|off)_(press|hold|release|short_release|long_press)/i);
      return x ? { n: Number(x[1]), dir: /up|on/i.test(x[2]) ? '▲' : '▼', how: /hold|long/i.test(x[3]) ? 'Hold' : L('Trykk', 'Press'), key: `${x[1]}${/up|on/i.test(x[2]) ? 0 : 1}${/hold|long/i.test(x[3]) ? 1 : 0}` } : { n: 99, dir: '', how: eventLabel(a.trigger.event), key: `99${a.trigger.event}` };
    };
    const sorted = [...list].sort((a, b) => parse(a).key.localeCompare(parse(b).key));
    let body = '';
    let lastKey = null;
    for (const a of sorted) {
      const p = parse(a);
      const k = `${p.n}${p.dir}`;
      if (p.n !== 99 && k !== lastKey) { body += `<div class="auto-sub">${L('Knapp', 'Button')} ${p.n} ${p.dir}</div>`; lastKey = k; }
      body += autoRow(a, autoWhat(a.action), extra(a), p.how);
    }
    h += autoGroup(`btn-${ent}`, entity(ent)?.label || L('Knapp', 'Button'), 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', list, body);
  }

  // 2. Tidspunkter og sol – sortert gjennom døgnet.
  const timed = m.automations.filter((a) => ['time', 'sunset', 'sunrise'].includes(a.trigger.type)).sort((a, b) => autoSortKey(a).localeCompare(autoSortKey(b)));
  if (timed.length) h += autoGroup('time', L('Til faste tider', 'At set times'), UI.clock, timed, timed.map((a) => autoRow(a, autoWhat(a.action), extra(a), autoWhen(a.trigger))).join(''));

  // 3. Når noe skjer (lys slås på/av, luftfuktighet).
  const events = m.automations.filter((a) => !['time', 'sunset', 'sunrise', 'button'].includes(a.trigger.type));
  if (events.length) h += autoGroup('event', L('Når noe skjer', 'When something happens'), 'M13 2L3 14h9l-1 8 10-12h-9l1-8z', events, events.map((a) => autoRow(a, autoWhat(a.action), extra(a), autoWhen(a.trigger))).join(''));

  if (m.can_edit) h += `<button class="btn ghost scene-add" data-act="auto-new" data-fid="a-new">${svg(UI.plus, 18, 2)} ${L('Ny automasjon', 'New automation')}</button>`;
  return h;
}

// ---------- info, strøm og meldinger ----------

const nok = (n) => (n == null ? '–' : n.toLocaleString(LOC, Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr');
const kwhFmt = (n) => (n == null ? '–' : n.toLocaleString(LOC, { maximumFractionDigits: 1 }) + ' kWh');
function checkFutureReading() {
  const future = S.reading.date > localToday();
  const w = $app.querySelector('.future-warn');
  if (w) w.hidden = !future;
  const b = $app.querySelector('[data-act="reading-add"]');
  if (b) b.disabled = future;
}
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dateFmt = (d) => new Date(d).toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS = { new: [L('Mottatt', 'Received'), 'st-new'], in_progress: [L('Under arbeid', 'In progress'), 'st-work'], done: [L('Løst', 'Resolved'), 'st-done'] };

function infoBadge() {
  const m = S.m;
  return (m.maintenance || []).some((t) => t.due) || (m.reports || []).some((r) => r.unread) || (m.electricity && m.electricity.remind) || (m.checklists || []).some((c) => c.status === 'open' || c.unread);
}

function infoTab() {
  const m = S.m;
  const unread = (m.reports || []).filter((r) => r.unread).length;
  const cls = m.checklists || [];
  const subs = [['info', 'Info'], ['strom', L('Leie', 'Rent')], ['meld', L('Meldinger', 'Messages')]];
  // Sjekklisten får egen fane bare mens den er i bruk; ellers ligger den nederst på Info.
  const clActive = cls.some((c) => c.status !== 'approved' || c.unread);
  if (clActive || S.infoSub === 'sjekk') subs.push(['sjekk', L('Sjekkliste', 'Checklist')]);
  if (S.infoSub === 'sjekk' && !cls.length) S.infoSub = 'info';
  const dot = (k) => (k === 'strom' && (m.electricity.remind || (m.lease && m.lease.overdue.length))) || (k === 'meld' && unread > 0) || (k === 'sjekk' && cls.some((c) => c.status === 'open' || c.unread));
  let h = `<div class="seg subnav ${subs.length > 3 ? 'four' : ''}" style="grid-template-columns: repeat(${subs.length}, minmax(0, 1fr))">${subs.map(([k, l]) => `<button aria-pressed="${S.infoSub === k}" data-act="info-sub" data-v="${k}">${esc(l)}${dot(k) ? ' •' : ''}</button>`).join('')}</div>`;
  if (S.infoSub === 'strom') h += stromHTML();
  else if (S.infoSub === 'meld') h += meldHTML();
  else if (S.infoSub === 'sjekk') h += sjekkHTML();
  else h += infoHTML();
  return h;
}

function textCard(title, text) {
  if (!text) return '';
  return `<section class="card info-card"><h2>${esc(title)}</h2><p class="pre">${esc(text)}</p></section>`;
}

function infoHTML() {
  const i = S.m.info;
  let h = '';
  const openCl = (S.m.checklists || []).find((c) => c.status === 'open');
  for (const t of S.m.maintenance || []) {
    h += `<div class="notice-soft maint ${t.due ? '' : 'info'}"><span><strong>${esc(t.title)}</strong><small>${t.due ? L('Påminnelse fra utleier – nå er det tid', 'Reminder from the landlord – it’s time now') : L(`Påminnelse fra utleier – ${t.days === 1 ? 'i morgen' : `om ${t.days} dager`}`, `Reminder from the landlord – ${t.days === 1 ? 'tomorrow' : `in ${t.days} days`}`)}</small></span>
      <button class="btn ${t.due ? 'primary' : 'ghost'}" data-act="maint-done" data-id="${t.id}">${L('Gjort', 'Done')}</button></div>`;
  }
  if (openCl) h += `<button class="notice-soft notice-btn" data-act="info-sub" data-v="sjekk"><strong>${esc(clTitle(openCl))}</strong><span>${L(`${openCl.done} av ${openCl.total} punkter – trykk for å fortsette`, `${openCl.done} of ${openCl.total} items – tap to continue`)}</span></button>`;
  if (i.wifi_ssid) {
    let qr = '';
    try { qr = qrSvg(wifiString(i.wifi_ssid, i.wifi_password), { label: L('QR-kode for wifi', 'Wi-Fi QR code') }); } catch {}
    h += `<section class="card info-card wifi">
      <h2>Wifi</h2>
      <div class="wifi-row">
        <div class="wifi-text">
          <span class="field-label">${L('Nettverk', 'Network')}</span><span class="big">${esc(i.wifi_ssid)}</span>
          ${i.wifi_password ? `<span class="field-label">${L('Passord', 'Password')}</span><span class="big mono-ish">${esc(i.wifi_password)}</span>
          <button class="chip-btn" data-act="copy" data-v="${esc(i.wifi_password)}" data-msg="${L('Kopiert', 'Copied')}">${L('Kopier passord', 'Copy password')}</button>` : ''}
        </div>
        ${qr ? `<div class="qr">${qr}<span class="note">${L('Skann med kameraet', 'Scan with the camera')}</span></div>` : ''}
      </div>
    </section>`;
  }
  if (i.contact_name || i.contact_phone || i.contact_email) {
    h += `<section class="card info-card"><h2>${L('Kontakt utleier', 'Contact the landlord')}</h2>
      ${i.contact_name ? `<span class="big">${esc(i.contact_name)}</span>` : ''}
      <div class="contact-btns">
        ${i.contact_phone ? `<a class="btn" href="tel:${esc(i.contact_phone.replace(/\s/g, ''))}">${L('Ring', 'Call')} ${esc(i.contact_phone)}</a><a class="btn" href="sms:${esc(i.contact_phone.replace(/\s/g, ''))}">${L('Send SMS', 'Send text')}</a>` : ''}
        ${i.contact_email ? `<a class="btn" href="mailto:${esc(i.contact_email)}">${L('E-post', 'Email')}</a>` : ''}
      </div>
      <button class="btn ghost" data-act="info-sub" data-v="meld" style="margin-top:8px">${L('Send melding til utleier', 'Message the landlord')}</button>
    </section>`;
  }
  if (i.safety && i.safety.length) {
    h += `<section class="card info-card"><h2>${L('Sikkerhet', 'Safety')}</h2><div class="safety">${i.safety.map((s) => `<div class="safety-row"><span>${esc(s.name)}</span><span class="pill lvl-${s.level}">${esc(serverText(s.text))}</span></div>`).join('')}</div></section>`;
  }
  h += textCard(L('Søppel og henting', 'Rubbish and collection'), i.garbage) + textCard(L('Husregler', 'House rules'), i.rules) + textCard(L('Ved nødstilfeller', 'In an emergency'), i.emergency) + textCard(L('Annet', 'Other'), i.other);
  if (EN && (i.garbage || i.rules || i.emergency || i.other)) h += `<p class="note lang-note">Texts written by the landlord are shown as written (in Norwegian).</p>`;
  if (!h) h = `<p class="intro">${L('Utleier har ikke lagt inn informasjon ennå.', "The landlord hasn't added any information yet.")}</p>`;
  const done = (S.m.checklists || []).filter((c) => c.status === 'approved');
  if (done.length && !(S.m.checklists || []).some((c) => c.status !== 'approved' || c.unread)) {
    h += `<button class="card list-row link-row" data-act="info-sub" data-v="sjekk"><span class="grow"><span class="t">${L('Inn- og utflyttingssjekklister', 'Move-in and move-out checklists')}</span><span class="s">${done.map((c) => `${clName(c)} · ${L('godkjent', 'approved')} ${dateFmt(c.approved_at)}`).map(esc).join('<br>')}</span></span>${svg(UI.down, 18, 2).replace('<svg', '<svg style="transform:rotate(-90deg)"')}</button>`;
  }
  return h;
}

function chartHTML(periods) {
  const list = periods.slice(0, 12).reverse();
  if (list.length < 2) return '';
  const max = Math.max(...list.map((p) => p.kwh), 1);
  const w = 100 / list.length;
  const bars = list.map((p, i) => {
    const hgt = Math.max(2, (p.kwh / max) * 100);
    const label = new Date(p.to).toLocaleDateString(LOC, { month: 'short' }).replace('.', '');
    return `<g><rect x="${i * w + w * 0.18}" y="${100 - hgt}" width="${w * 0.64}" height="${hgt}" rx="1.5" class="${p.paid ? 'bar-paid' : 'bar'}"><title>${esc(dateFmt(p.from))}–${esc(dateFmt(p.to))}: ${esc(kwhFmt(p.kwh))}</title></rect>
      <text x="${i * w + w / 2}" y="112" text-anchor="middle" class="bar-label">${esc(label)}</text></g>`;
  }).join('');
  return `<section class="card info-card"><h2>${L('Forbruk per periode', 'Usage per period')}</h2>
    <svg class="chart" viewBox="0 0 100 116" preserveAspectRatio="none" role="img" aria-label="${L('Strømforbruk per periode', 'Electricity usage per period')}">${bars}</svg>
    <span class="note">${L('Høyeste', 'Highest')}: ${esc(kwhFmt(max))}</span></section>`;
}

const LSTAT = { refund: [L('Til gode', 'Owed to you'), 'lvl-ok'], claimed: [L('Meldt betalt', 'Reported paid'), 'lvl-info'], paid: [L('Betalt', 'Paid'), 'lvl-ok'], overdue: [L('Forfalt', 'Overdue'), 'lvl-bad'], soon: [L('Snart', 'Soon'), 'lvl-warn'], upcoming: [L('Kommende', 'Upcoming'), ''] };
const longDate = (d) => new Date(d).toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' });
// «2026-11» → «november 2026» / «November 2026», og bare månedsnavnet.
const monthLabel = (m) => { if (String(m).endsWith('-S')) return L('sluttoppgjør', 'final settlement'); const s = new Date(`${m}-15T12:00:00`).toLocaleDateString(LOC, { month: 'long', year: 'numeric' }); return EN ? s : s.toLowerCase(); };
const monthOnly = (m) => String(m).endsWith('-S') ? L('sluttoppgjøret', 'the final settlement') : new Date(`${m}-15T12:00:00`).toLocaleDateString(LOC, { month: 'long' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clName = (c) => (EN ? (c.type === 'out' ? 'Move-out' : 'Move-in') : c.label);
const clTitle = (c) => (EN ? `${clName(c)} checklist` : `${c.label}ssjekkliste`);
const CAT_EN = { 'Vann og rør': 'Water and pipes', Elektrisk: 'Electrical', 'Varme og ventilasjon': 'Heating and ventilation', Hvitevarer: 'Appliances', 'Dører, vinduer og lås': 'Doors, windows and locks', Annet: 'Other' };
const catName = (c) => (EN ? CAT_EN[c] || c : c);
const ACCOUNT = L('Kontonummer', 'Account number');
const kindName = (k) => (k === 'light' ? L('Lys', 'Light') : k === 'heat' ? L('Varme', 'Heating') : k === 'vent' ? L('Ventilasjon', 'Ventilation') : L('Varmepumpe', 'Heat pump'));
// Ord fra serveren i statistikken (titler og undertitler).
const STAT_EN = { Luftfuktighet: 'Humidity', Inneluft: 'Indoor air', Ute: 'Outdoor', Utetemperatur: 'Outdoor temperature', Temperatur: 'Temperature', temperatur: 'temperature', Strømforbruk: 'Electricity use', Ventilasjon: 'Ventilation' };
const statWord = (s) => (EN ? String(s ?? '').split(' · ').map((w) => STAT_EN[w] || w).join(' · ') : s);
const MON_EN = { jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', mai: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep', okt: 'Oct', nov: 'Nov', des: 'Dec' };
const proNote = (t) => (EN ? String(t).replace(/(\d+)\.–(\d+)\. (\w{3}): (\d+) av (\d+) dager/, (_, a, b, m, d, n) => `${a}–${b} ${MON_EN[m] || m}: ${d} of ${n} days`) : t);
// Feilmeldinger og statustekster fra serveren.
const SERVER_EN = {
  'Ingen kontakt': 'No connection', ALARM: 'ALARM', På: 'On', Av: 'Off',
  'Status: Mottatt': 'Status: Received', 'Status: Under arbeid': 'Status: In progress', 'Status: Løst': 'Status: Resolved',
  'Automasjonen finnes ikke': 'The automation no longer exists',
  'Automasjoner på luftfuktighet er ikke lenger tilgjengelig': 'Humidity automations are no longer available',
  'Avlesningen er markert som betalt': 'The reading is marked as paid',
  'Avlesninger eldre enn en uke kan bare slettes av utleier': 'Readings older than a week can only be deleted by the landlord',
  'Bare siste avlesning kan slettes': 'Only the latest reading can be deleted',
  'Bildet finnes ikke – last opp på nytt': 'The photo is missing – please upload it again',
  'Bildet må være JPEG': 'The photo must be a JPEG',
  'Bortemodus på ventilasjonen er ikke tillatt': 'Away mode for the ventilation is not allowed',
  'Denne fakturaen kan ikke betales ennå': 'This invoice can’t be paid yet',
  'Denne oppgaven gjøres av utleier': 'This task is done by the landlord',
  'Det er mange åpne meldinger – vent til utleier har svart': 'There are many open messages – please wait for the landlord to reply',
  'Det finnes allerede en sjekkliste som ikke er sendt inn': 'There is already a checklist that hasn’t been submitted',
  'Du har sendt mange meldinger på kort tid – vent litt, eller ring utleier hvis det haster': 'You’ve sent many messages in a short time – wait a little, or call the landlord if it’s urgent',
  'Du kan ikke legge inn en avlesning fram i tid – les av måleren på dagen': 'You can’t enter a reading for a future date – read the meter on the day',
  'Et annet lys holder på å kobles til': 'Another light is being connected',
  'Fakturaen er allerede registrert som betalt': 'The invoice is already registered as paid',
  'Fant ikke fakturaen': 'Invoice not found', 'Fant ikke oppgaven': 'Task not found', 'Fant ikke sjekklisten': 'Checklist not found',
  'Finner ikke avlesningen': 'Reading not found',
  'For mange bilder lastet opp – prøv igjen senere': 'Too many photos uploaded – try again later',
  'Forbruket ser urimelig høyt ut – sjekk tallet': 'The usage looks unreasonably high – please check the number',
  'Kan ikke styres': 'Can’t be controlled',
  'Meldingen finnes ikke': 'The message no longer exists',
  'Oppgaven er ikke aktuell ennå': 'The task isn’t due yet',
  'Samtalen er for lang – start en ny melding': 'The conversation is too long – start a new message',
  'Scenen finnes ikke': 'The scene no longer exists', 'Scenen må ha et navn': 'The scene needs a name',
  'Sjekklisten er sendt inn og kan ikke endres': 'The checklist has been submitted and can’t be changed',
  'Sjekklisten har nådd maks antall bilder': 'The checklist has reached the maximum number of photos',
  'Skriv en melding': 'Write a message', 'Skriv et svar': 'Write a reply', 'Skriv litt om hva det gjelder': 'Write a little about what it’s about',
  'Testvarselet kom ikke fram. Prøv å slå varsler av og på igjen.': 'The test notification didn’t arrive. Try turning notifications off and on again.',
  'Tilkobling av lys er ikke slått på av utleier': 'Reconnecting lights hasn’t been enabled by the landlord',
  'Tom fil': 'Empty file', 'Ugyldig abonnement': 'Invalid subscription', 'Ugyldig dato': 'Invalid date', 'Ugyldig klokkeslett': 'Invalid time',
  'Ugyldig lysstyrke': 'Invalid brightness', 'Ugyldig målerstand': 'Invalid meter reading', 'Ugyldig måned': 'Invalid month', 'Ugyldig temperatur': 'Invalid temperature',
  'Ugyldig tid for å gjøre om': 'Invalid undo time', 'Ugyldig tidsrom': 'Invalid time window', 'Ugyldig trinn': 'Invalid step', 'Ugyldig valg': 'Invalid choice',
  'Ugyldig varighet': 'Invalid duration', 'Ugyldig ventilasjonsnivå': 'Invalid ventilation level', 'Ukjent enhet': 'Unknown device', 'Ukjent kommando': 'Unknown command',
  'Ukjent lys': 'Unknown light', 'Ukjent punkt': 'Unknown item', 'Ukjent type': 'Unknown type',
  'Utleier har låst scener og automasjoner': 'The landlord has locked scenes and automations',
  'Varsler er ikke tilgjengelige': 'Notifications are not available',
  'Velg en knapp': 'Choose a button', 'Velg en scene': 'Choose a scene', 'Velg et lys': 'Choose a light', 'Velg hva som skal skje': 'Choose what should happen',
  'Velg hvilket trykk': 'Choose which press', 'Velg lysere eller mørkere': 'Choose brighter or darker', 'Velg minst ett lys scenen skal styre': 'Choose at least one light for the scene',
  'Velg minst ett lys å dimme': 'Choose at least one light to dim', 'Velg minst én dag': 'Choose at least one day',
  'Velg minst én enhet automasjonen skal styre': 'Choose at least one device for the automation', 'Velg når automasjonen skal kjøre': 'Choose when the automation should run',
  'Velg på eller av': 'Choose on or off', 'Velg ventilasjonen': 'Choose the ventilation', 'Forskyvningen må være innenfor ±3 timer': 'The offset must be within ±3 hours',
  'Luftfuktigheten må være mellom 30 og 95 %': 'Humidity must be between 30 and 95 %', 'Ikke funnet': 'Not found', 'Ugyldig opphav': 'Invalid origin', 'Feil format': 'Wrong format'
};
const SERVER_RX = [
  [/^(.+) støtter ikke denne modusen$/, '$1 doesn’t support this mode'],
  [/^(.+) svarer ikke akkurat nå$/, '$1 isn’t responding right now'],
  [/^(.+): temperaturen må være mellom (.+)° og (.+)°$/, '$1: the temperature must be between $2° and $3°'],
  [/^Datoen må være etter forrige avlesning \((.+)\)$/, 'The date must be after the previous reading ($1)'],
  [/^Du kan ha maks (\d+) automasjoner$/, 'You can have at most $1 automations'],
  [/^Du kan ha maks (\d+) scener$/, 'You can have at most $1 scenes'],
  [/^Maks (\d+) bilder per punkt$/, 'At most $1 photos per item'],
  [/^Målerstanden kan ikke være lavere enn forrige \((.+) kWh\)$/, 'The meter reading can’t be lower than the previous one ($1 kWh)']
];
function serverText(t) {
  if (!EN || !t) return t;
  if (SERVER_EN[t]) return SERVER_EN[t];
  for (const [rx, en] of SERVER_RX) if (rx.test(t)) return t.replace(rx, en);
  return t;
}
const elSum = (r) => r.electricity.reduce((s, p) => s + (p.amount || 0), 0);

function claimBtn(o) {
  const confirm = S.confirmClaim === o.month;
  return `<button class="btn ${confirm ? 'primary' : 'ghost'} claim-btn" data-act="pay-claim" data-month="${o.month}">${confirm ? L(`Bekreft: jeg har betalt ${esc(nok(o.total))}`, `Confirm: I have paid ${esc(nok(o.total))}`) : L(`Jeg har betalt ${esc(monthOnly(o.month))}`, `I have paid for ${esc(monthOnly(o.month))}`)}</button>`;
}

function payLines(r) {
  let h = '';
  if (r.rent) h += `<div class="pay-line"><span>${L('Husleie', 'Rent')} ${esc(monthOnly(r.month))}${r.rent_note ? `<small>${L('Avregnet', 'Prorated')} ${esc(proNote(r.rent_note))}</small>` : ''}</span><span>${esc(nok(r.rent))}</span></div>`;
  for (const p of r.electricity) h += `<div class="pay-line"><span>${L('Strøm', 'Electricity')} ${esc(dateFmt(p.from))} – ${esc(dateFmt(p.to))}<small>${esc(kwhFmt(p.kwh))}${p.price != null ? ` × ${esc(nok(p.price))}` : ''}</small></span><span>${esc(nok(p.amount))}</span></div>`;
  for (const c of r.credits || []) h += `<div class="pay-line"><span>${L('Tilbake: husleie', 'Refund: rent')} ${esc(monthOnly(c.month))}${c.note ? `<small>${L('Avregnet', 'Prorated')} ${esc(proNote(c.note))}</small>` : ''}</span><span>${esc(nok(c.amount))}</span></div>`;
  return h;
}

// Si opp / be om å avslutte leieforholdet.
function endHTML() {
  const T = S.m.termination;
  if (!T) return '';
  const t = T.latest;
  const F = S.endForm;
  let h = `<section class="card info-card end-card"><h2>${L('Avslutte leieforholdet', 'Ending your tenancy')}</h2>`;
  if (t && t.status === 'pending') {
    h += `<div class="notice-soft info"><strong>${L('Sendt til utleier', 'Sent to the landlord')} ${esc(dateFmt(t.created))}</strong><br>
      ${L(`Ønsket siste dag: ${esc(longDate(t.requested_end))}.`, `Requested last day: ${esc(longDate(t.requested_end))}.`)} ${t.early ? L('Dette er før oppsigelsestiden er ute, så utleier må godkjenne det.', 'This is before the notice period ends, so the landlord needs to approve it.') : ''} ${L('Venter på svar.', 'Waiting for a reply.')}</div>
      ${t.reason ? `<p class="pre note">${esc(t.reason)}</p>` : ''}
      <button class="btn ghost" data-act="end-withdraw" data-id="${t.id}">${S.confirmDelete === `end-${t.id}` ? L('Trykk igjen for å trekke tilbake', 'Tap again to withdraw') : L('Trekk tilbake', 'Withdraw')}</button>`;
    return h + `</section>`;
  }
  if (t && t.status === 'approved') {
    h += `<div class="notice-soft ok-soft"><strong>${L('Godkjent av utleier', 'Approved by the landlord')}</strong><br>${L(`Leieforholdet avsluttes ${esc(longDate(t.approved_end))}.`, `Your tenancy ends on ${esc(longDate(t.approved_end))}.`)}</div>
      ${t.comment ? `<div class="msg landlord"><span>${esc(t.comment)}</span><small>${L('Utleier', 'Landlord')}</small></div>` : ''}
      <ol class="steps">${EN
        ? '<li>Read the electricity meter on your last day.</li><li>Fill in the move-out checklist when the landlord sends it.</li><li>Rent is calculated per day up to your last day. Anything you have paid too much is paid back in the final settlement.</li>'
        : '<li>Les av strømmåleren på siste dag.</li><li>Fyll ut utflyttingssjekklisten når utleier sender den.</li><li>Husleien regnes per dag fram til siste dag. Har du betalt for mye, betales det tilbake i sluttoppgjøret.</li>'}</ol>`;
    return h + `</section>`;
  }
  if (t && t.status === 'declined') {
    h += `<div class="notice-soft bad"><strong>${L('Ikke godkjent', 'Not approved')} ${esc(dateFmt(t.decided_at))}</strong>${t.comment ? `<br>${esc(t.comment)}` : ''}</div>`;
  }
  const rule = T.fixed_end
    ? L(`Kontrakten varer til ${esc(longDate(T.fixed_end))}.`, `The contract runs until ${esc(longDate(T.fixed_end))}.`)
    : T.notice_months
      ? L(`Oppsigelsestiden er ${T.notice_months} måned${T.notice_months === 1 ? '' : 'er'}, regnet fra utgangen av måneden.`, `The notice period is ${T.notice_months} month${T.notice_months === 1 ? '' : 's'}, counted from the end of the month.`)
      : '';
  if (!F) {
    h += `<p class="note">${rule} ${T.earliest ? L(`Sier du opp i dag, er siste dag <strong>${esc(longDate(T.earliest))}</strong>.`, `If you give notice today, your last day is <strong>${esc(longDate(T.earliest))}</strong>.`) : ''} ${L('Vil du flytte tidligere, kan du søke om det.', 'If you want to move out earlier, you can ask for it.')}</p>
      <button class="btn ghost" data-act="end-open">${L('Si opp eller be om å avslutte', 'Give notice or ask to end')}</button>`;
    return h + `</section>`;
  }
  const early = T.earliest && F.date && F.date < T.earliest;
  h += `<p class="note">${rule}</p>
    <label class="field"><span class="field-label">${L('Ønsket siste dag', 'Requested last day')}</span><input class="input" type="date" min="${localToday()}" value="${esc(F.date)}" data-field="end-date"></label>
    <div class="notice-soft end-early" ${early ? '' : 'hidden'}>${L(`Datoen er før oppsigelsestiden er ute (${esc(T.earliest ? longDate(T.earliest) : '')}). Da blir det en søknad som utleier må godkjenne.`, `This date is before the notice period ends (${esc(T.earliest ? longDate(T.earliest) : '')}). It becomes a request the landlord has to approve.`)}</div>
    <label class="field"><span class="field-label">${L('Begrunnelse eller kommentar (valgfritt)', 'Reason or comment (optional)')}</span><textarea class="input area" rows="3" maxlength="1000" placeholder="${L('F.eks. ny jobb i en annen by', 'E.g. new job in another city')}" data-field="end-reason">${esc(F.reason)}</textarea></label>
    <button class="btn primary big" data-act="end-send">${S.confirmDelete === 'end-send' ? L('Trykk igjen for å sende', 'Tap again to send') : L('Send til utleier', 'Send to the landlord')}</button>
    <button class="btn ghost" data-act="end-cancel">${L('Avbryt', 'Cancel')}</button>
    <p class="note">${L('Utleier får varsel og svarer i appen. Du får beskjed når det er svart.', 'The landlord is notified and replies in the app. You’ll be notified when they reply.')}</p>`;
  return h + `</section>`;
}

function contractHTML(c) {
  const rows = [];
  if (c.start) rows.push([L('Innflytting', 'Move-in'), longDate(c.start)]);
  rows.push([L('Kontrakt til', 'Contract until'), c.end ? longDate(c.end) : L('Tidsubestemt', 'Open-ended')]);
  if (c.notice_months) rows.push([L('Oppsigelsestid', 'Notice period'), L(`${c.notice_months} måned${c.notice_months === 1 ? '' : 'er'}`, `${c.notice_months} month${c.notice_months === 1 ? '' : 's'}`)]);
  if (c.rent) rows.push([L('Husleie', 'Rent'), L(`${nok(c.rent)} per måned, forfall den ${c.due_day}.`, `${nok(c.rent)} per month, due on day ${c.due_day}`)]);
  if (c.rent && (c.start || c.end)) rows.push([L('Delvis måned', 'Part month'), L('Avregnes per dag', 'Charged per day')]);
  if (c.deposit) rows.push([L('Depositum', 'Deposit'), `${nok(c.deposit)}${c.deposit_note ? ` – ${c.deposit_note}` : ''}`]);
  if (c.account) rows.push([ACCOUNT, c.account]);
  let h = `<section class="card info-card"><h2>${L('Leieforholdet', 'Your tenancy')}</h2>`;
  if (c.end && c.days_left != null) {
    const total = c.start ? Math.max(1, c.days_in + c.days_left) : null;
    const pct = total ? Math.min(100, Math.round((c.days_in / total) * 100)) : null;
    h += `<div class="lease-left ${c.days_left <= 90 ? 'warn' : ''}"><span class="big">${c.days_left >= 0 ? L(`${c.days_left} dager igjen`, `${c.days_left} days left`) : L('Kontrakten er utløpt', 'The contract has expired')}</span>
      ${pct != null ? `<div class="progress"><span style="width:${pct}%"></span></div>` : ''}
      ${c.notice_by && c.days_left >= 0 ? `<span class="note">${L(`Si fra innen ${esc(longDate(c.notice_by))} om du vil flytte eller forlenge (${c.notice_months} mnd oppsigelse).`, `Let the landlord know by ${esc(longDate(c.notice_by))} if you want to move out or extend (${c.notice_months} months' notice).`)}</span>` : ''}</div>`;
  }
  h += `<div class="kv">${rows.map(([k, v]) => `<div class="kv-row"><span>${esc(k)}</span><span>${esc(v)}${k === ACCOUNT ? ` <button class="chip-btn" data-act="copy" data-v="${esc(v.replace(/\s/g, ''))}" data-msg="${L('Kontonummeret er kopiert', 'Account number copied')}">${L('Kopier', 'Copy')}</button>` : ''}</span></div>`).join('')}</div>`;
  const docs = S.m.docs || [];
  if (docs.length) h += `<div class="docs">${docs.map((d) => `<a class="doc-link" href="api/doc/${d.id}" target="_blank" rel="noopener"><span class="doc-ic">${d.ext === 'pdf' ? 'PDF' : L('BILDE', 'IMAGE')}</span><span class="grow"><span class="t">${esc(d.name)}</span><span class="s">${L('Lagt ut', 'Added')} ${esc(dateFmt(d.at))}</span></span></a>`).join('')}</div>`;
  if (c.includes) h += `<span class="field-label">${L('Inkludert i leien', 'Included in the rent')}</span><p class="pre">${esc(c.includes)}</p>`;
  if (c.note) h += `<p class="pre note">${esc(c.note)}</p>`;
  return h + `</section>`;
}

function stromHTML() {
  const e = S.m.electricity;
  const LS = S.m.lease;
  const c = LS && LS.contract;
  let h = '';
  if (LS && LS.overdue.length) h += `<div class="notice-soft bad claim-box"><span>${L('Ikke registrert betalt', 'Not registered as paid')}: ${LS.overdue.map((o) => `${esc(monthLabel(o.month))} (${esc(nok(o.total))})`).join(', ')}.</span>
    ${LS.overdue.map((o) => claimBtn(o)).join('')}</div>`;
  const claimedOld = LS ? (LS.claimed || []).filter((o) => !LS.next || o.month !== LS.next.month) : [];
  if (claimedOld.length) h += `<div class="notice-soft info">${claimedOld.map((o) => L(`Du meldte ${esc(monthLabel(o.month))} som betalt ${esc(dateFmt(o.claimed_at))}.`, `You reported ${esc(monthLabel(o.month))} as paid on ${esc(dateFmt(o.claimed_at))}.`)).join(' ')} ${L('Venter på at utleier bekrefter.', 'Waiting for the landlord to confirm.')}</div>`;
  if (LS && LS.refund) {
    const rf = LS.refund;
    h += `<section class="card info-card next-pay"><span class="field-label">${L('Sluttoppgjør', 'Final settlement')} · ${L('til gode', 'owed to you')}</span>
      <span class="pay-total">${esc(nok(-rf.total))}</span>
      <p class="note">${L(`Utleier betaler tilbake beløpet til deg innen ${esc(longDate(rf.due))}. Husleien er avregnet per dag fram til utflytting. Strøm fram til siste avlesning er trukket fra, og avlesningen på siste dag kommer med her.`, `The landlord will pay this amount back to you by ${esc(longDate(rf.due))}. Rent is calculated per day up to moving out. Electricity up to the latest reading has been deducted, and the reading on your last day is included here.`)}</p>
      <a class="btn ghost inv-btn" href="api/invoice/${rf.month}.pdf" target="_blank" rel="noopener">${L('Se sluttoppgjøret (PDF)', 'View the final settlement (PDF)')}</a>
    </section>`;
  }
  if (e.remind && !(c && c.auto_meter)) h += `<div class="notice-soft">${L('Det er snart månedsslutt – husk å lese av strømmåleren.', "It's almost the end of the month – remember to read the electricity meter.")}</div>`;
  if (LS && LS.next) {
    const n = LS.next;
    const days = Math.round((new Date(n.due) - new Date(new Date().toDateString())) / 86400000);
    h += `<section class="card info-card next-pay"><span class="field-label">${L('Neste betaling', 'Next payment')} · ${esc(longDate(n.due))}${days >= 0 ? ` (${days === 0 ? L('i dag', 'today') : L(`om ${days} dag${days === 1 ? '' : 'er'}`, `in ${days} day${days === 1 ? '' : 's'}`)})` : ''}</span>
      <span class="pay-total">${esc(nok(n.total))}</span>
      <div class="pay-lines">${payLines(n)}</div>
      ${c.rent && !n.electricity.length && e.price != null ? `<p class="note">${L('Strøm for siste periode kommer i tillegg når måleren er lest av.', 'Electricity for the latest period is added once the meter has been read.')}</p>` : ''}
      ${c.account ? `<div class="mail-to"><span>${L('Kontonr.', 'Account')} <strong>${esc(c.account)}</strong></span><button class="chip-btn" data-act="copy" data-v="${esc(c.account.replace(/\s/g, ''))}" data-msg="${L('Kontonummeret er kopiert', 'Account number copied')}">${L('Kopier', 'Copy')}</button></div>` : ''}
      ${n.claimed_at
        ? `<div class="claim-done"><span>${L(`✓ Du meldte betalt ${esc(dateFmt(n.claimed_at))}. Venter på at utleier bekrefter.`, `✓ You reported this as paid on ${esc(dateFmt(n.claimed_at))}. Waiting for the landlord to confirm.`)}</span><button class="chip-btn" data-act="pay-unclaim" data-month="${n.month}">${L('Angre', 'Undo')}</button></div>`
        : claimBtn(n)}
      <a class="btn ghost inv-btn" href="api/invoice/${n.month}.pdf" target="_blank" rel="noopener">${L('Se faktura (PDF)', 'View invoice (PDF)')}</a>
    </section>`;
  }
  if (c && c.auto_meter) {
    h += `<section class="card info-card"><h2>${L('Strømmåler', 'Electricity meter')}</h2><p class="note">${L('Måleren leses av automatisk siste dag i hver måned.', 'The meter is read automatically on the last day of each month.')}${e.last ? L(` Siste avlesning: ${esc(kwhFmt(e.last.value))} den ${esc(dateFmt(e.last.date))}.`, ` Last reading: ${esc(kwhFmt(e.last.value))} on ${esc(dateFmt(e.last.date))}.`) : ''}</p>${e.note ? `<p class="note pre">${esc(e.note)}</p>` : ''}</section>`;
  } else {
    h += `<section class="card info-card"><h2>${L('Les av måleren', 'Read the meter')}</h2>
      ${e.last ? `<span class="note">${e.last.by === 'landlord' ? L('Startavlesning (lagt inn av utleier)', 'Starting reading (added by the landlord)') : L('Forrige', 'Previous')}: ${esc(kwhFmt(e.last.value))} ${L('den', 'on')} ${esc(dateFmt(e.last.date))}</span>` : `<span class="note">${L('Første avlesning blir startpunktet.', 'The first reading becomes the starting point.')}</span>`}
      <div class="reading-form">
        <label class="field"><span class="field-label">${L('Målerstand (kWh)', 'Meter reading (kWh)')}</span><input class="input" type="number" inputmode="decimal" step="0.1" min="0" placeholder="${L('F.eks. 12345', 'E.g. 12345')}" value="${esc(S.reading.value)}" data-field="reading-value"></label>
        <label class="field"><span class="field-label">${L('Dato', 'Date')}</span><input class="input" type="date" value="${esc(S.reading.date)}" data-field="reading-date"></label>
      </div>
      <div class="notice-soft bad future-warn" ${S.reading.date > localToday() ? '' : 'hidden'}>${L('Du kan ikke legge inn strømmen på forhånd. Les av måleren på dagen og velg dagens dato eller en tidligere dato.', "You can't enter a reading in advance. Read the meter on the day and choose today's date or an earlier one.")}</div>
      <button class="btn primary big" data-act="reading-add" ${S.reading.date > localToday() ? 'disabled' : ''}>${L('Lagre avlesning', 'Save reading')}</button>
      ${e.last && e.last.deletable ? `<button class="btn ghost" data-act="reading-delete" data-id="${e.last.id}">${S.confirmDelete ? L('Trykk igjen for å slette siste', 'Tap again to delete the latest') : L('Slett siste avlesning', 'Delete latest reading')}</button>` : ''}
      ${e.note ? `<p class="note pre">${esc(e.note)}</p>` : ''}
    </section>`;
  }
  if (c && (c.start || c.end || c.rent || c.deposit || (S.m.docs || []).length)) h += contractHTML(c);
  if (c && (c.start || c.rent)) h += endHTML();
  if (LS && LS.ledger.length && c.rent) {
    h += `<section><h2 class="group-title">${L('Betalinger', 'Payments')}${LS.year_total ? ` <span class="gt-count">${L('Betalt i år', 'Paid this year')}: ${esc(nok(LS.year_total))}</span>` : ''}</h2><div class="list">${LS.ledger.map((r) => {
      const [lab, cls] = LSTAT[r.status];
      const el = elSum(r);
      return `<a class="list-row period inv-row" href="api/invoice/${r.month}.pdf" target="_blank" rel="noopener">
        <span class="grow"><span class="t">${esc(cap(monthLabel(r.month)))}</span><span class="s">${L('Forfall', 'Due')} ${esc(dateFmt(r.due))}${r.rent ? ` · ${L('leie', 'rent')} ${esc(nok(r.rent))}${r.rent_note ? L(' (avregnet)', ' (prorated)') : ''}` : ''}${el ? ` · ${L('strøm', 'electricity')} ${esc(nok(el))}` : ''}</span></span>
        <span class="amt"><span class="t">${esc(nok(r.total))}</span><span class="pill ${cls}">${lab}</span></span>
      </a>`;
    }).join('')}</div><p class="note" style="margin:6px 4px 0">${L('Trykk på en måned for å se fakturaen.', 'Tap a month to see the invoice (in Norwegian).')}</p></section>`;
  } else {
    h += `<div class="stat-row">
      <div class="card stat"><span class="field-label">${L('Til betaling', 'To pay')}</span><span class="big">${esc(nok(e.unpaid))}</span></div>
      <div class="card stat"><span class="field-label">${L('Pris', 'Price')}</span><span class="big">${e.price != null ? esc(nok(e.price)) + '<small>/kWh</small>' : L('Ikke satt', 'Not set')}</span></div>
    </div>`;
  }
  h += chartHTML(e.periods);
  if (e.periods.length) {
    h += `<section><h2 class="group-title">${L('Strømforbruk', 'Electricity usage')}</h2><div class="list">${e.periods.map((p) => `<div class="list-row period">
      <span class="grow"><span class="t">${esc(dateFmt(p.from))} – ${esc(dateFmt(p.to))}</span><span class="s">${esc(kwhFmt(p.kwh))} · ${p.days} ${L('dager', 'days')} · ${esc(kwhFmt(p.per_day))}/${L('dag', 'day')}</span></span>
      <span class="amt"><span class="t">${esc(nok(p.amount))}</span>${c && c.rent ? '' : `<span class="pill ${p.paid ? 'lvl-ok' : 'lvl-warn'}">${p.paid ? L('Betalt', 'Paid') : L('Ikke betalt', 'Unpaid')}</span>`}</span>
    </div>`).join('')}</div></section>`;
  }
  return h;
}

const photoThumbs = (ids, rm = null) => (ids && ids.length ? `<div class="thumbs">${ids.map((id) => `<span class="thumb-w"><button class="thumb" data-act="photo-view" data-id="${id}" aria-label="${L('Vis bilde', 'Show photo')}"><img src="api/photo/${id}" alt="" loading="lazy"></button>${rm ? `<button class="thumb-x" data-act="${rm.act}" data-photo="${id}" ${rm.attrs} aria-label="${L('Fjern bilde', 'Remove photo')}">×</button>` : ''}</span>`).join('')}</div>` : '');

function pushCardHTML(where) {
  const P = S.push;
  const m = S.m;
  if (!m.push || !m.push.key) return '';
  const on = P.sub && P.permission === 'granted';
  if (where === 'meld' && on) return '';
  let body;
  if (on) {
    body = `<p class="note">${L('Varsler er på for denne enheten. Du får beskjed når utleier sender en melding eller svarer deg.', 'Notifications are on for this device. You’ll be notified when the landlord sends you a message or replies.')}</p>
      <div class="contact-btns"><button class="btn" data-act="push-test" ${P.busy ? 'disabled' : ''}>${L('Send testvarsel', 'Send test notification')}</button><button class="btn ghost" data-act="push-off" ${P.busy ? 'disabled' : ''}>${L('Slå av', 'Turn off')}</button></div>`;
  } else if (P.ios && !P.standalone) {
    body = EN ? `<p class="note">On iPhone the app must be on the Home Screen to send notifications:</p>
      <ol class="steps"><li>Tap the <strong>Share</strong> button in Safari</li><li>Choose <strong>Add to Home Screen</strong></li><li>Open Hybel from the Home Screen and turn on notifications here</li></ol>` : `<p class="note">På iPhone må appen ligge på Hjem-skjermen for å kunne gi varsler:</p>
      <ol class="steps"><li>Trykk på <strong>Del</strong>-knappen i Safari</li><li>Velg <strong>Legg til på Hjem-skjerm</strong></li><li>Åpne Hybel fra Hjem-skjermen og slå på varsler her</li></ol>`;
  } else if (!P.supported) {
    body = `<p class="note">${L('Denne nettleseren støtter ikke varsler. Prøv Chrome eller Safari, eller legg appen på Hjem-skjermen.', "This browser doesn't support notifications. Try Chrome or Safari, or add the app to your Home Screen.")}</p>`;
  } else if (P.permission === 'denied') {
    body = `<p class="note">${L('Varsler er blokkert for denne siden. Slå dem på i innstillingene til nettleseren/telefonen, og prøv igjen.', 'Notifications are blocked for this site. Turn them on in your browser/phone settings and try again.')}</p>`;
  } else {
    body = `<p class="note">${L('Få beskjed på telefonen når utleier svarer eller sender deg en melding.', 'Get notified on your phone when the landlord replies or sends you a message.')}</p>
      <button class="btn primary big" data-act="push-on" ${P.busy ? 'disabled' : ''}>${P.busy ? L('Slår på …', 'Turning on …') : L('Slå på varsler', 'Turn on notifications')}</button>`;
  }
  return `<section class="card info-card push-card"><h2>${L('Varsler', 'Notifications')}</h2>${body}</section>`;
}

// Kontaktinfo til utleier fra Info (telefon brukes til «ring» og «SMS»).
function landlordPhone() {
  const p = (S.m.info && S.m.info.contact_phone) || '';
  return p.replace(/[^\d+]/g, '');
}

function smsHref(text) {
  const p = landlordPhone();
  return p ? `sms:${p}?&body=${encodeURIComponent(text)}` : '';
}

function meldHelpHTML() {
  const p = landlordPhone();
  const open = S.meldHelp !== false;
  return `<section class="card info-card meld-help">
    <button class="meld-help-head" data-act="meld-help"><span class="t">${L('Slik fungerer meldinger', 'How messages work')}</span><span class="chev-s ${open ? 'open' : ''}">${svg(UI.down, 18, 2)}</span></button>
    ${open ? `${EN ? `<ol class="steps">
      <li>The landlord gets a <strong>notification on their phone</strong> as soon as you send.</li>
      <li>Under your message you’ll see <strong>“Seen by landlord ✓”</strong> once it has been read.</li>
      <li>If the landlord hasn’t seen the message after <strong>12 hours</strong>${p ? ', a button appears to send a text message' : ', send a text message'} – so you know it gets through.</li>
    </ol>
    <div class="notice-soft bad"><strong>Urgent?</strong> Water leak, power cut or anything that could cause damage: ${p ? 'call the landlord straight away – don’t wait for a reply in the app.' : 'contact the landlord directly straight away.'}</div>` : `<ol class="steps">
      <li>Utleier får <strong>varsel på telefonen</strong> med en gang du sender.</li>
      <li>Under meldingen ser du <strong>«Sett av utleier ✓»</strong> når den er lest.</li>
      <li>Har utleier ikke sett meldingen etter <strong>12 timer</strong>${p ? ', dukker det opp en knapp for å sende SMS' : ', send en SMS'} – så vet du at beskjeden kommer fram.</li>
    </ol>
    <div class="notice-soft bad"><strong>Haster det?</strong> Vannlekkasje, strømbrudd eller noe som kan gi skade: ${p ? 'ring utleier med en gang – ikke vent på svar i appen.' : 'ta kontakt med utleier direkte med en gang.'}</div>`}
    ${p ? `<div class="contact-btns"><a class="btn primary" href="tel:${p}">${L('Ring utleier', 'Call the landlord')}</a><a class="btn ghost" href="${smsHref(L('Hei! ', 'Hi! '))}">${L('Send SMS', 'Send text')}</a></div>` : ''}` : ''}
  </section>`;
}

// «Sendt / Sett av utleier» – og påminnelse om SMS hvis det tar tid.
function seenHTML(r) {
  if (r.seen) return `<span class="seen ok">${L('Sett av utleier ✓', 'Seen by landlord ✓')}</span>`;
  const since = r.waiting_since ? Date.now() - new Date(r.waiting_since).getTime() : 0;
  const late = r.urgent ? since > 30 * 60e3 : since > 12 * 3600e3;
  let h = `<span class="seen">${L('Sendt – utleier har fått varsel, men har ikke åpnet den ennå', 'Sent – the landlord has been notified but hasn’t opened it yet')}</span>`;
  if (late && landlordPhone()) {
    const quote = `${r.text.slice(0, 80)}${r.text.length > 80 ? '…' : ''}`;
    const sms = smsHref(L(`Hei! Jeg har sendt en melding i hybel-appen${r.urgent ? ' som haster' : ''}: «${quote}». Kan du se på den?`, `Hi! I've sent ${r.urgent ? 'an urgent' : 'a'} message in the Hybel app: “${quote}”. Could you take a look?`));
    h += `<div class="notice-soft"><span>${r.urgent ? L('Det haster og utleier har ikke sett meldingen.', 'It’s urgent and the landlord hasn’t seen the message.') : L('Utleier har ikke sett meldingen ennå.', 'The landlord hasn’t seen the message yet.')} ${L('Send en SMS så du er sikker på at den kommer fram.', 'Send a text message to make sure it gets through.')}</span>
      <div class="contact-btns"><a class="btn primary" href="${sms}">${L('Send SMS', 'Send text')}</a>${r.urgent ? `<a class="btn ghost" href="tel:${landlordPhone()}">${L('Ring', 'Call')}</a>` : ''}</div></div>`;
  }
  return h;
}

function meldHTML() {
  const m = S.m;
  const f = S.report;
  let h = pushCardHTML('meld');
  h += meldHelpHTML();
  h += `<section class="card info-card"><h2>${L('Ny melding til utleier', 'New message to the landlord')}</h2>
    <span class="field-label">${L('Hva gjelder det?', 'What is it about?')}</span>
    <div class="chips">${m.report_categories.map((c) => `<button class="chip" aria-pressed="${f.category === c}" data-act="report-cat" data-v="${esc(c)}">${esc(catName(c))}</button>`).join('')}</div>
    <label class="field"><span class="field-label">${L('Beskriv problemet', 'Describe the problem')}</span><textarea class="input area" rows="4" maxlength="2000" placeholder="${L('F.eks. vasken på badet renner sakte unna', 'E.g. the bathroom sink drains slowly')}" data-field="report-text">${esc(f.text)}</textarea></label>
    ${photoThumbs(f.photos, { act: 'report-photo-rm', attrs: '' })}
    ${f.photos.length < 3 ? `<button class="chip-btn add-photo" data-act="report-photo" ${S.uploading === 'report' ? 'disabled' : ''}>${S.uploading === 'report' ? L('Laster opp …', 'Uploading …') : L('+ Legg ved bilde', '+ Attach photo')}</button>` : ''}
    <div class="row between"><span class="status">${L('Haster', 'Urgent')}</span><button class="switch" role="switch" aria-checked="${f.urgent}" aria-label="${L('Haster', 'Urgent')}" data-act="report-urgent"></button></div>
    ${f.urgent && landlordPhone() ? `<p class="note">${L(`Haster det veldig? <a href="tel:${landlordPhone()}">Ring utleier</a> i tillegg.`, `Very urgent? <a href="tel:${landlordPhone()}">Call the landlord</a> as well.`)}</p>` : ''}
    <button class="btn primary big" data-act="report-send" ${S.uploading ? 'disabled' : ''}>${L('Send til utleier', 'Send to the landlord')}</button>
  </section>`;
  if (m.reports.length) {
    h += `<section><h2 class="group-title">${L('Meldinger', 'Messages')}</h2>`;
    for (const r of m.reports) {
      const mine = r.origin !== 'landlord';
      const [label, cls] = STATUS[r.status] || [L('Fra utleier', 'From the landlord'), 'st-info'];
      h += `<article class="card report ${r.unread ? 'unread' : ''} ${mine ? '' : 'from-landlord'}">
        <div class="row between"><span class="t">${mine ? esc(catName(r.category)) : L('Fra utleier', 'From the landlord')}${r.urgent ? ` · <span class="urgent">${L('haster', 'urgent')}</span>` : ''}</span>${mine ? `<span class="pill ${cls}">${label}</span>` : ''}</div>
        <span class="note">${esc(dateFmt(r.created))}</span>
        <p class="pre">${esc(r.text)}</p>
        ${photoThumbs(r.photos)}
        ${mine || r.updates.some((u) => u.from === 'tenant') ? seenHTML(r) : ''}
        ${r.updates.length ? `<div class="thread">${r.updates.map((u) => `<div class="msg ${u.from} ${u.status ? 'sys' : ''}"><span>${esc(u.status ? serverText(u.text) : u.text)}</span><small>${u.from === 'landlord' ? L('Utleier', 'Landlord') : L('Deg', 'You')} · ${esc(dateFmt(u.at))}</small></div>`).join('')}</div>` : ''}
        ${r.status !== 'done' ? `<div class="reply"><textarea class="input area" rows="2" maxlength="1000" placeholder="${L('Skriv et svar …', 'Write a reply …')}" data-field="reply" data-id="${r.id}">${esc(S.reply[r.id] || '')}</textarea><button class="chip-btn" data-act="report-reply" data-id="${r.id}">${L('Send', 'Send')}</button></div>` : ''}
      </article>`;
    }
    h += `</section>`;
  }
  return h;
}

function currentChecklist() {
  const list = S.m.checklists || [];
  return list.find((c) => c.id === S.clSel) || list.find((c) => c.status === 'open') || list[0] || null;
}

function sjekkHTML() {
  const c = currentChecklist();
  if (!c) return '';
  const pct = Math.round((c.done / Math.max(1, c.total)) * 100);
  const rooms = [...new Set(c.rows.map((r) => r.room))];
  const editable = c.status === 'open';
  const all = S.m.checklists || [];
  let h = all.length > 1 ? `<div class="chips cl-pick">${all.map((x) => `<button class="chip" aria-pressed="${x.id === c.id}" data-act="cl-sel" data-id="${x.id}">${esc(clName(x))} · ${esc(dateFmt(x.created))}</button>`).join('')}</div>` : '';
  h += `<section class="card info-card cl-top"><h2>${esc(clTitle(c))}</h2>`;
  if (editable) {
    h += `<p class="note">${L('Gå gjennom hybelen og trykk <strong>OK</strong> når noe er i orden, eller <strong>Merknad</strong> hvis du ser riper, flekker, skader eller noe som ikke virker. Ta gjerne bilder – det gjør det enklere for begge senere.', 'Go through the flat and tap <strong>OK</strong> when something is fine, or <strong>Note</strong> if you see scratches, stains, damage or something that doesn’t work. Feel free to take photos – it makes things easier for both of you later.')}</p>
      ${EN ? '<p class="note lang-note">The rooms and items are written by the landlord and shown in Norwegian.</p>' : ''}
      <div class="progress"><span style="width:${pct}%"></span></div><span class="note">${L(`${c.done} av ${c.total} punkter`, `${c.done} of ${c.total} items`)}${(() => { const cl = c.rows.filter((r) => r.kind === 'clean'); return cl.length ? L(` · vask ${cl.filter((r) => r.status === 'ok').length} av ${cl.length}`, ` · cleaning ${cl.filter((r) => r.status === 'ok').length} of ${cl.length}`) : ''; })()}</span>
      ${c.rows.some((r) => r.kind === 'clean') ? `<p class="note">${L('Under hvert rom står også det som skal vaskes. Kryss av når det er gjort – ta gjerne et bilde av kjøleskap, ovn og bad når det er ferdig.', 'Each room also lists what needs cleaning. Tick it off when done – feel free to photograph the fridge, oven and bathroom when finished.')}</p>` : ''}`;
  } else {
    h += `<p class="note">${c.status === 'approved' ? L(`Godkjent av utleier ${esc(dateFmt(c.approved_at))}.`, `Approved by the landlord on ${esc(dateFmt(c.approved_at))}.`) : L(`Sendt inn ${esc(dateFmt(c.submitted_at))}. Utleier går gjennom den.`, `Submitted on ${esc(dateFmt(c.submitted_at))}. The landlord is reviewing it.`)}</p>
      ${c.landlord_comment ? `<div class="msg landlord"><span>${esc(c.landlord_comment)}</span><small>${L('Utleier', 'Landlord')}</small></div>` : ''}`;
  }
  if (!editable) {
    const notes = c.rows.filter((r) => r.status === 'note');
    const ok = c.rows.filter((r) => r.status === 'ok').length;
    h += `<div class="cl-summary"><span><strong>${ok}</strong> OK</span><span><strong>${notes.length}</strong> ${L(`merknad${notes.length === 1 ? '' : 'er'}`, `note${notes.length === 1 ? '' : 's'}`)}</span><span><strong>${c.rows.reduce((a, r) => a + r.photos.length, 0)}</strong> ${L('bilder', 'photos')}</span></div>`;
    if (notes.length) h += `<div class="cl-notes">${notes.map((r) => `<div class="cl-note-t"><span class="t">${esc(r.room)} – ${esc(r.item)}</span>${r.note ? `<span class="s">${esc(r.note)}</span>` : ''}${photoThumbs(r.photos)}</div>`).join('')}</div>`;
    h += `<button class="btn ghost" data-act="cl-full" data-id="${c.id}">${S.clFull === c.id ? L('Skjul hele listen', 'Hide the full list') : L('Vis hele listen', 'Show the full list')}</button>`;
  }
  h += `</section>`;
  if (!editable) h += mailCardHTML(c);
  if (!editable && S.clFull !== c.id) return h;
  rooms.forEach((room) => {
    const rows = c.rows.map((r, i) => ({ ...r, i })).filter((r) => r.room === room);
    const done = rows.filter((r) => r.status).length;
    h += `<section><h2 class="group-title">${esc(room)} <span class="gt-count">${done}/${rows.length}</span></h2><div class="card cl-list">`;
    let cleanHead = false;
    for (const r of rows) {
      const key = `${c.id}-${r.i}`;
      const clean = r.kind === 'clean';
      if (clean && !cleanHead) {
        cleanHead = true;
        h += `<div class="cl-sub">${svg('M3 21h18M6 21V10l6-6 6 6v11', 14, 2)} ${L('Vask før utflytting', 'Cleaning before moving out')}</div>`;
      }
      const okLbl = clean ? L('Vasket', 'Cleaned') : 'OK', noteLbl = clean ? L('Ikke gjort', 'Not done') : L('Merknad', 'Note');
      h += `<div class="cl-row ${r.status || ''} ${clean ? 'clean' : ''}">
        <div class="cl-line">${clean && editable
            ? `<button class="cl-check" role="checkbox" aria-checked="${r.status === 'ok'}" data-act="cl-status" data-id="${c.id}" data-i="${r.i}" data-v="ok"><span class="box"></span><span class="t">${esc(r.item)}</span></button>`
            : `<span class="t">${esc(r.item)}</span>`}
          ${editable ? `<span class="cl-btns">
            ${clean ? '' : `<button class="cl-b ok" aria-pressed="${r.status === 'ok'}" data-act="cl-status" data-id="${c.id}" data-i="${r.i}" data-v="ok">${okLbl}</button>`}
            <button class="cl-b note ${clean ? 'small' : ''}" aria-pressed="${r.status === 'note'}" data-act="cl-status" data-id="${c.id}" data-i="${r.i}" data-v="note">${noteLbl}</button></span>`
            : `<span class="pill ${r.status === 'ok' ? 'st-done' : r.status === 'note' ? 'st-new' : ''}">${r.status === 'ok' ? okLbl : r.status === 'note' ? noteLbl : '–'}</span>`}
        </div>
        ${r.status === 'note' ? (editable
          ? `<textarea class="input area" rows="2" maxlength="1000" placeholder="${clean ? L('Hvorfor ikke? F.eks. avtalt med utleier', 'Why not? E.g. agreed with the landlord') : L('Hva ser du? F.eks. ripe i gulvet ved døra', 'What do you see? E.g. scratch in the floor by the door')}" data-field="cl-note" data-id="${c.id}" data-i="${r.i}">${esc(r.note)}</textarea>
             ${photoThumbs(r.photos, { act: 'cl-photo-rm', attrs: `data-id="${c.id}" data-i="${r.i}"` })}
             ${r.photos.length < 4 ? `<button class="chip-btn add-photo" data-act="cl-photo" data-id="${c.id}" data-i="${r.i}" ${S.uploading ? 'disabled' : ''}>${S.uploading === key ? L('Laster opp …', 'Uploading …') : L('+ Ta bilde', '+ Take photo')}</button>` : ''}`
          : `${r.note ? `<p class="pre note">${esc(r.note)}</p>` : ''}${photoThumbs(r.photos)}`) : ''}
      </div>`;
    }
    h += `</div></section>`;
  });
  if (editable) {
    const missing = c.total - c.done;
    h += `<section class="card info-card">
      <label class="field"><span class="field-label">${L('Annet du vil nevne (valgfritt)', 'Anything else to mention (optional)')}</span><textarea class="input area" rows="3" maxlength="2000" placeholder="${L('F.eks. antall nøkler, ting som mangler', 'E.g. number of keys, things missing')}" data-field="cl-comment" data-id="${c.id}">${esc(c.comment)}</textarea></label>
      <button class="btn primary big" data-act="cl-submit" data-id="${c.id}" ${missing ? 'disabled' : ''}>${missing ? L(`${missing} punkt${missing === 1 ? '' : 'er'} gjenstår`, `${missing} item${missing === 1 ? '' : 's'} left`) : S.confirmDelete ? L('Trykk igjen for å sende', 'Tap again to send') : L('Send til utleier', 'Send to the landlord')}</button>
      <p class="note">${L('Når listen er sendt kan den ikke endres. Utleier får beskjed og kan åpne den igjen ved behov.', 'Once sent, the list can’t be changed. The landlord is notified and can reopen it if needed.')}</p>
    </section>`;
  } else if (c.comment) {
    h += textCard(L('Din kommentar', 'Your comment'), c.comment);
  }
  return h;
}

// ---------- PDF på e-post ----------

const pdfKey = (c) => `${c.id}-${c.status}-${c.approved_at || ''}-${c.landlord_comment || ''}`;
const pdfName = (c) => `${c.label}ssjekkliste-${(c.submitted_at || c.created).slice(0, 10)}.pdf`;

function ensurePdf(c) {
  const key = pdfKey(c);
  if (S.pdf && (S.pdf.key === key)) return;
  S.pdf = { key, file: null };
  fetch(`api/checklist/${c.id}.pdf`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('PDF feilet'))))
    .then((b) => { if (S.pdf.key === key) { S.pdf.file = new File([b], pdfName(c), { type: 'application/pdf' }); render(); } })
    .catch(() => { if (S.pdf.key === key) S.pdf = null; });
}

function mailCardHTML(c) {
  ensurePdf(c);
  const email = S.m.info.contact_email;
  const ready = S.pdf && S.pdf.file;
  return `<section class="card info-card mail-card"><h2>${L('Send kopi på e-post', 'Send a copy by email')}</h2>
    <p class="note">${L(`Send sjekklisten som PDF fra din egen e-post${email ? ' til utleier' : ''}. Da har dere begge en datert kopi med alle merknader og bilder.`, `Send the checklist as a PDF from your own email${email ? ' to the landlord' : ''}. That way you both have a dated copy with all notes and photos.`)}</p>
    ${email ? `<div class="mail-to"><span>${L('Til', 'To')}: <strong>${esc(email)}</strong></span><button class="chip-btn" data-act="copy" data-v="${esc(email)}" data-msg="${L('E-postadressen er kopiert', 'Email address copied')}">${L('Kopier', 'Copy')}</button></div>` : ''}
    <button class="btn primary big" data-act="cl-mail" data-id="${c.id}" ${ready ? '' : 'disabled'}>${ready ? L('Send PDF på e-post', 'Email the PDF') : L('Lager PDF …', 'Creating PDF …')}</button>
    <a class="btn ghost" href="api/checklist/${c.id}.pdf" download="${esc(pdfName(c))}">${L('Last ned PDF', 'Download PDF')}</a>
  </section>`;
}

function mailChecklist(c) {
  const email = S.m.info.contact_email || '';
  const file = S.pdf && S.pdf.file;
  if (!file) return;
  const subject = `${clTitle(c)} ${dateFmt(c.submitted_at || c.created)}`;
  const body = L(`Hei!\n\nVedlagt er ${c.label.toLowerCase()}ssjekklisten for hybelen, sendt inn i appen ${dateFmt(c.submitted_at || c.created)}.\n`, `Hi!\n\nAttached is the ${clName(c).toLowerCase()} checklist for the flat, submitted in the app on ${dateFmt(c.submitted_at || c.created)}.\n`);
  // Mobil: del filen direkte til e-postappen.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: subject, text: body })
      .then(() => showToast(L('Delt', 'Shared')), (err) => { if (err && err.name !== 'AbortError') showToast(L('Kunne ikke dele filen', 'Could not share the file'), true); });
    if (email) showToast(L(`Velg e-post og send til ${email}`, `Choose email and send to ${email}`));
    return;
  }
  // PC: last ned PDF-en og åpne e-postprogrammet med mottaker og emne.
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  setTimeout(() => {
    location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + L('\n(Legg ved PDF-filen som nettopp ble lastet ned.)', '\n(Attach the PDF file that was just downloaded.)'))}`;
  }, 400);
  showToast(L('PDF lastet ned – legg den ved i e-posten', 'PDF downloaded – attach it to the email'));
}

function photoViewHTML() {
  return S.photo ? `<div class="lightbox" data-act="photo-close"><img src="api/photo/${S.photo}" alt="${L('Bilde', 'Photo')}"></div>` : '';
}

function tabsHTML() {
  const list = tabs();
  if (!list.some((t) => t.id === S.tab)) S.tab = list[0].id;
  const t = TABS.find((x) => x.id === S.tab);
  const title = t.label;
  let body = '';
  if (!S.m.entities.length) body = `<section class="card section"><p class="intro" style="padding:18px 0">${L('Ingen enheter er satt opp ennå. Ta kontakt med utleier.', 'No devices have been set up yet. Please contact the landlord.')}</p></section>`;
  else if (S.tab === 'lys') body = scenesTab() + lightsTab();
  else if (S.tab === 'stat') body = statsTab();
  else if (S.tab === 'klima') body = climateTab();
  else if (S.tab === 'info') body = infoTab();
  else body = autoTab();
  if (S.tab === 'info' && !S.m.entities.length) body = infoTab();
  return topHTML(title) + toastHTML() + body + navHTML() + photoViewHTML();
}

// ---------- statistikk ----------

S.stats = { range: store.get('hybel-stat-range') === '7d' ? '7d' : '24h', data: null, loading: false, error: null };

async function loadStats() {
  const range = S.stats.range;
  S.stats.loading = true;
  S.stats.error = null;
  try {
    const r = await fetch(`api/stats?range=${range}`, { credentials: 'same-origin' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Feil');
    if (S.stats.range === range) S.stats.data = j;
  } catch (err) {
    S.stats.error = L('Kunne ikke hente statistikk', 'Could not load statistics');
  }
  S.stats.loading = false;
  if (S.tab === 'stat' && S.view === 'tabs') render();
}

const num1 = (v) => (v == null ? '–' : v.toLocaleString(LOC, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const fmtVal = (v, unit) => (v == null ? '–' : unit === '%' ? `${Math.round(v)} %` : unit === '°' ? `${num1(v)}°` : `${Math.abs(v) >= 100 ? Math.round(v).toLocaleString(LOC) : num1(v)} ${unit}`);

function tickLabel(t, range) {
  const d = new Date(t);
  if (range === '24h') return `${String(d.getHours()).padStart(2, '0')}`;
  if (range === '7d') return d.toLocaleDateString(LOC, { weekday: 'short' }).replace('.', '');
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

function chartSVG(sr, data) {
  const W = 320, H = 132, LM = 30, R = 6, T = 8, B = 20;
  const pts = sr.points;
  const vals = pts.filter((p) => p != null);
  if (vals.length < 2) return `<p class="note">${L('Ikke nok data ennå.', 'Not enough data yet.')}</p>`;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = sr.unit === '%' ? 4 : sr.unit === '°' ? 0.6 : Math.max(1, (hi - lo) * 0.1);
  lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
  if (sr.unit === '%') { lo = Math.max(0, lo); hi = Math.min(100, hi); }
  const x = (i) => LM + (i / (pts.length - 1)) * (W - LM - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  let line = '', area = '', started = false, firstX = 0, lastX = 0;
  pts.forEach((p, i) => {
    if (p == null) return;
    line += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`;
    if (!started) firstX = x(i);
    lastX = x(i);
    started = true;
  });
  area = `${line}L${lastX.toFixed(1)},${H - B}L${firstX.toFixed(1)},${H - B}Z`;
  const grid = [lo, (lo + hi) / 2, hi].map((g) => `<line x1="${LM}" x2="${W - R}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="gl"/><text x="${LM - 6}" y="${(y(g) + 3.5).toFixed(1)}" class="yl">${sr.unit === '°' ? Math.round(g * 10) / 10 : Math.round(g)}</text>`).join('');
  const ticks = [];
  const nT = 4;
  for (let k = 0; k <= nT; k++) {
    const i = Math.round((k / nT) * (pts.length - 1));
    const t = data.start + i * data.bucket;
    ticks.push(`<text x="${x(i).toFixed(1)}" y="${H - 5}" class="xl" text-anchor="${k === 0 ? 'start' : k === nT ? 'end' : 'middle'}">${tickLabel(t, data.range)}</text>`);
  }
  const band = sr.type === 'hum' ? `<rect x="${LM}" width="${W - LM - R}" y="${y(Math.min(hi, 60)).toFixed(1)}" height="${Math.max(0, y(Math.max(lo, 30)) - y(Math.min(hi, 60))).toFixed(1)}" class="band"/>` : '';
  return `<svg class="chart-svg ${sr.type}" viewBox="0 0 ${W} ${H}" data-chart="${sr.id}" role="img" aria-label="${esc(statWord(sr.label))}">
    ${band}${grid}<path d="${area}" class="ar"/><path d="${line}" class="ln"/>${ticks.join('')}
    <line class="cur" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/><circle class="dot" r="4" style="display:none"/>
  </svg>`;
}

const kwhStr = (v) => `${(v ?? 0).toLocaleString(LOC, { minimumFractionDigits: v >= 10 ? 1 : 2, maximumFractionDigits: v >= 10 ? 1 : 2 })} kWh`;

function barLabel(t, range) {
  const d = new Date(t);
  return range === '7d' ? d.toLocaleDateString(LOC, { weekday: 'short' }).replace('.', '') : String(d.getHours()).padStart(2, '0');
}

function barsSVG(en, range) {
  const W = 320, H = 132, LM = 30, R = 6, T = 8, B = 20;
  const n = en.points.length;
  const mx = Math.max(...en.points, 0);
  const step = mx <= 0.5 ? 0.1 : mx <= 2 ? 0.5 : mx <= 5 ? 1 : mx <= 20 ? 5 : 10;
  const hi = Math.max(step, Math.ceil(mx / step) * step);
  const bw = (W - LM - R) / n;
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  const grid = [0, hi / 2, hi].map((g) => `<line x1="${LM}" x2="${W - R}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="gl"/><text x="${LM - 6}" y="${(y(g) + 3.5).toFixed(1)}" class="yl">${String(Math.round(g * 10) / 10).replace('.', ',')}</text>`).join('');
  const bars = en.points.map((v, i) => `<rect class="bar${i === n - 1 ? ' cur-b' : ''}" data-i="${i}" x="${(LM + i * bw + bw * 0.15).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(0, H - B - y(v)).toFixed(1)}" rx="${Math.min(3, bw * 0.2).toFixed(1)}"/>`).join('');
  const every = range === '7d' ? 1 : 6;
  const labels = en.times.map((t, i) => (i % every === 0 || (range !== '7d' && i === n - 1) ? `<text x="${(LM + i * bw + bw / 2).toFixed(1)}" y="${H - 5}" class="xl" text-anchor="middle">${range !== '7d' && i === n - 1 ? L('nå', 'now') : barLabel(t, range)}</text>` : '')).join('');
  return `<svg class="chart-svg energy" viewBox="0 0 ${W} ${H}" data-bars="${esc(en.id)}" role="img" aria-label="${esc(en.label)}">${grid}${bars}${labels}</svg>`;
}

function energyCard(en, d) {
  const per = d.range === '7d' ? L('dag', 'day') : L('time', 'hour');
  const price = d.price;
  const top = Math.max(...en.points);
  const avg = en.total / Math.max(1, en.points.length);
  return `<section class="card stat-card energy">
    <div class="stat-top"><span><span class="t">${esc(en.label)}</span><span class="s">${d.range === '7d' ? L('Siste 7 dager', 'Last 7 days') : L('Siste døgn', 'Last 24 hours')}${en.power != null ? L(` · bruker ${en.power.toLocaleString(LOC)} W nå`, ` · using ${en.power.toLocaleString(LOC)} W now`) : ''}</span></span>
      <span class="stat-now"><span class="v" data-readout="${esc(en.id)}">${kwhStr(en.total)}</span><span class="s" data-readout-t="${esc(en.id)}">${price != null ? `≈ ${nok(Math.round(en.total * price * 100) / 100)}` : L('totalt', 'total')}</span></span></div>
    ${barsSVG(en, d.range)}
    <div class="stat-chips"><span>${L(`Snitt per ${per}`, `Average per ${per}`)} <strong>${kwhStr(avg)}</strong></span><span>${L(`Høyeste ${per}`, `Highest ${per}`)} <strong>${kwhStr(top)}</strong></span><span>${price != null ? L('Kostnad', 'Cost') : L('Totalt', 'Total')} <strong>${price != null ? esc(nok(Math.round(en.total * price))) : kwhStr(en.total)}</strong></span></div>
  </section>`;
}

function lineCard(sr, d) {
  return `<section class="card stat-card ${sr.type}">
      <div class="stat-top"><span><span class="t">${esc(statWord(sr.label))}</span><span class="s">${esc(statWord(sr.sub))}</span></span>
        <span class="stat-now"><span class="v" data-readout="${sr.id}">${fmtVal(sr.now, sr.unit)}</span><span class="s" data-readout-t="${sr.id}">${L('nå', 'now')}</span></span></div>
      ${chartSVG(sr, d)}
      <div class="stat-chips"><span>${L('Laveste', 'Lowest')} <strong>${fmtVal(sr.min, sr.unit)}</strong></span><span>${L('Snitt', 'Average')} <strong>${fmtVal(sr.avg, sr.unit)}</strong></span><span>${L('Høyeste', 'Highest')} <strong>${fmtVal(sr.max, sr.unit)}</strong></span></div>
      ${sr.type === 'hum' ? `<p class="note">${L('Det grønne feltet (30–60 %) er god luftfuktighet innendørs. Over 60 % over tid kan gi fukt og mugg – luft ut eller bruk høy ventilasjon.', 'The green band (30–60 %) is good indoor humidity. Above 60 % for long periods can cause damp and mould – air the room or use high ventilation.')}</p>` : ''}
    </section>`;
}

function statsTab() {
  const st = S.stats;
  if (!st.data && !st.loading && !st.error) loadStats();
  const ranges = [['24h', L('Døgn', '24 hours')], ['7d', L('Uke', 'Week')]];
  let h = `<div class="seg stat-seg" style="grid-template-columns: repeat(2, minmax(0, 1fr))">${ranges.map(([k, l]) => `<button aria-pressed="${st.range === k}" data-act="stat-range" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (st.error) return h + `<div class="notice-soft bad">${esc(st.error)}</div>`;
  const d = st.data && st.data.range === st.range ? st.data : null;
  if (!d) return h + `<p class="intro">${L('Henter statistikk …', 'Loading statistics …')}</p>`;
  const energy = d.energy || [];
  if (!d.series.length && !energy.length) return h + `<p class="intro">${L('Ingen målinger å vise.', 'No measurements to show.')}</p>`;
  // Hurtigoversikt øverst
  const inne = d.series.filter((x) => x.type === 'temp' || x.type === 'hum' || x.type === 'other');
  const ute = d.series.filter((x) => x.type === 'out');
  const totalKwh = energy.reduce((a, e) => a + e.total, 0);
  const tiles = [];
  for (const x of inne.filter((x) => x.type !== 'other').slice(0, energy.length && ute.length ? 2 : 3)) tiles.push([x.type === 'hum' ? L('Fukt', 'Humidity') : statWord(x.label), fmtVal(x.now, x.unit), x.id]);
  if (energy.length) tiles.push([L('Strøm', 'Power'), kwhStr(totalKwh).replace(' kWh', ''), 'stat-strom', 'kWh']);
  for (const x of ute) tiles.push([L('Ute', 'Outdoor'), fmtVal(x.now, x.unit), x.id]);
  if (tiles.length > 1) h += `<div class="stat-tiles">${tiles.slice(0, 4).map(([k, v, id, u]) => `<a class="stat-tile" href="#sec-${esc(id)}"><span>${esc(k)}</span><strong>${esc(v)}${u ? `<small> ${u}</small>` : ''}</strong></a>`).join('')}</div>`;
  if (inne.length) {
    h += `<h2 class="group-title stat-h">${L('Inneklima', 'Indoor climate')}</h2>`;
    for (const sr of inne) h += `<div id="sec-${esc(sr.id)}">${lineCard(sr, d)}</div>`;
  }
  if (energy.length) {
    h += `<h2 class="group-title stat-h" id="sec-stat-strom">${L('Strømforbruk', 'Electricity use')}${energy.length > 1 ? ` <span class="gt-count">${L('Totalt', 'Total')} ${kwhStr(totalKwh)}${d.price != null ? ` ≈ ${esc(nok(Math.round(totalKwh * d.price)))}` : ''}</span>` : ''}</h2>`;
    for (const en of energy) h += energyCard(en, d);
    h += `<p class="note" style="margin:0 4px">${L('Viser forbruket til utstyr som har egen strømmåler. Prisen er utleiers pris per kWh.', 'Shows usage for equipment with its own power meter. The price is the landlord’s price per kWh.')}</p>`;
  }
  if (ute.length) {
    h += `<h2 class="group-title stat-h">${L('Ute', 'Outdoor')}</h2>`;
    for (const sr of ute) h += `<div id="sec-${esc(sr.id)}">${lineCard(sr, d)}</div>`;
  }
  h += `<p class="note" style="margin:0 4px">${L('Trykk eller dra over en graf for å se verdien på et bestemt tidspunkt.', 'Tap or drag across a chart to see the value at a specific time.')}</p>`;
  return h;
}

// Trykk på en stolpe i strømgrafen: vis forbruket den timen/dagen.
function barTap(ev) {
  const r = ev.target.closest && ev.target.closest('svg[data-bars] rect.bar');
  if (!r || !S.stats.data) return;
  const svgEl = r.closest('svg');
  const en = (S.stats.data.energy || []).find((x) => x.id === svgEl.dataset.bars);
  if (!en) return;
  const i = Number(r.dataset.i);
  svgEl.querySelectorAll('rect.bar').forEach((b) => b.classList.toggle('sel', b === r));
  const t = new Date(en.times[i]);
  const ro = document.querySelector(`[data-readout="${en.id}"]`), rt = document.querySelector(`[data-readout-t="${en.id}"]`);
  if (ro) ro.textContent = kwhStr(en.points[i]);
  if (rt) rt.textContent = S.stats.data.range === '7d' ? t.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'short' }) : `${L('kl.', '')} ${String(t.getHours()).padStart(2, '0')}–${String((t.getHours() + 1) % 24).padStart(2, '0')}`.trim();
  clearTimeout(barTap.t);
  barTap.t = setTimeout(() => {
    svgEl.querySelectorAll('rect.bar').forEach((b) => b.classList.remove('sel'));
    if (ro) ro.textContent = kwhStr(en.total);
    if (rt) rt.textContent = S.stats.data.price != null ? `≈ ${nok(Math.round(en.total * S.stats.data.price * 100) / 100)}` : L('totalt', 'total');
  }, 2500);
}
document.addEventListener('pointerdown', barTap);
document.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'mouse') barTap(ev); });

// Dra over grafen: vis verdi og tidspunkt.
function scrub(ev) {
  const svgEl = ev.target.closest && ev.target.closest('svg[data-chart]');
  if (!svgEl || !S.stats.data) return;
  const sr = S.stats.data.series.find((x) => x.id === svgEl.dataset.chart);
  if (!sr) return;
  const rect = svgEl.getBoundingClientRect();
  const W = 320, LM = 30, R = 6, T = 8, B = 20, H = 132;
  const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width * W;
  const n = sr.points.length;
  let i = Math.round(((px - LM) / (W - LM - R)) * (n - 1));
  i = Math.max(0, Math.min(n - 1, i));
  let j = i;
  while (j > 0 && sr.points[j] == null) j--;
  const v = sr.points[j];
  if (v == null) return;
  const vals = sr.points.filter((p) => p != null);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pad = sr.unit === '%' ? 4 : sr.unit === '°' ? 0.6 : Math.max(1, (mx - mn) * 0.1);
  let lo = Math.floor(mn - pad), hi = Math.ceil(mx + pad);
  if (sr.unit === '%') { lo = Math.max(0, lo); hi = Math.min(100, hi); }
  const x = LM + (j / (n - 1)) * (W - LM - R);
  const y = T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const cur = svgEl.querySelector('.cur'), dot = svgEl.querySelector('.dot');
  cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.style.display = '';
  dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.style.display = '';
  const t = new Date(S.stats.data.start + j * S.stats.data.bucket + S.stats.data.bucket / 2);
  const tl = S.stats.data.range === '24h' ? `${L('kl. ', '')}${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : t.toLocaleString(LOC, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ro = document.querySelector(`[data-readout="${sr.id}"]`), rt = document.querySelector(`[data-readout-t="${sr.id}"]`);
  if (ro) ro.textContent = fmtVal(v, sr.unit);
  if (rt) rt.textContent = tl;
  if (ev.cancelable && ev.touches) ev.preventDefault();
}
function scrubEnd(ev) {
  const svgEl = ev.target.closest && ev.target.closest('svg[data-chart]');
  if (!svgEl || !S.stats.data) return;
  const sr = S.stats.data.series.find((x) => x.id === svgEl.dataset.chart);
  setTimeout(() => {
    svgEl.querySelector('.cur').style.display = 'none';
    svgEl.querySelector('.dot').style.display = 'none';
    const ro = document.querySelector(`[data-readout="${sr.id}"]`), rt = document.querySelector(`[data-readout-t="${sr.id}"]`);
    if (ro) ro.textContent = fmtVal(sr.now, sr.unit);
    if (rt) rt.textContent = L('nå', 'now');
  }, 1500);
}
document.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') scrub(ev); });
document.addEventListener('pointerdown', scrub);
document.addEventListener('touchmove', scrub, { passive: false });
document.addEventListener('pointerup', scrubEnd);
document.addEventListener('touchend', scrubEnd);

// ---------- innstillinger og redigering ----------

function settingsHTML() {
  const m = S.m;
  let html = subHTML(L('Hybelen', 'The flat'), L('Innstillinger', 'Settings')) + toastHTML();
  html += pushCardHTML('settings');

  const th = window.hybelTheme ? window.hybelTheme.get() : 'auto';
  html += `<section><h2 class="group-title">${L('Utseende', 'Appearance')}</h2><div class="card" style="border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:12px">
    <div class="seg" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
    ${[['auto', L('Automatisk', 'Automatic')], ['light', L('Lys', 'Light')], ['dark', L('Mørk', 'Dark')]].map(([v, l]) => `<button aria-pressed="${th === v}" data-act="theme" data-v="${v}" data-fid="th-${v}">${l}</button>`).join('')}</div>
    <span class="s" style="font-size:13px;color:var(--muted)">${L('Automatisk følger innstillingen på telefonen.', 'Automatic follows your phone’s setting.')}</span>
  </div></section>`;

  html += `<section><h2 class="group-title">${L('Språk', 'Language')}</h2><div class="card" style="border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:12px">
    <div class="seg" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
    ${[['no', 'Norsk'], ['en', 'English']].map(([v, l]) => `<button aria-pressed="${LANG === v}" data-act="lang" data-v="${v}" data-fid="lang-${v}" lang="${v === 'no' ? 'nb' : 'en'}">${l}</button>`).join('')}</div>
    <span class="s" style="font-size:13px;color:var(--muted)">${L('Tekst som utleier har skrevet, vises slik den er skrevet.', 'Text written by the landlord is shown as written.')}</span>
  </div></section>`;

  html += `<section><h2 class="group-title">${L('Rekkefølge – enheter', 'Order – devices')}</h2><div class="list">`;
  m.entities.filter((e) => e.kind !== 'button').forEach((e, i, arr) => {
    const kind = kindName(e.kind);
    html += `<div class="list-row order-row"><span class="grow"><span class="t">${esc(e.label)}</span><span class="s">${kind}</span></span>
      <button class="tool-btn" data-act="ent-move" data-key="${e.key}" data-dir="-1" aria-label="${L('Flytt opp', 'Move up')}: ${esc(e.label)}" ${i === 0 ? 'disabled' : ''}>${svg(UI.up, 18, 2)}</button>
      <button class="tool-btn" data-act="ent-move" data-key="${e.key}" data-dir="1" aria-label="${L('Flytt ned', 'Move down')}: ${esc(e.label)}" ${i === arr.length - 1 ? 'disabled' : ''}>${svg(UI.down, 18, 2)}</button></div>`;
  });
  html += `</div></section>`;

  if (m.scenes.length > 1) {
    html += `<section><h2 class="group-title">${L('Rekkefølge – scener', 'Order – scenes')}</h2><div class="list">`;
    m.scenes.forEach((s, i) => {
      html += `<div class="list-row order-row"><span class="row-ic">${svg(ICON[s.icon] || ICON.star, 20)}</span><span class="grow"><span class="t">${esc(s.name)}</span></span>
        <button class="tool-btn" data-act="scene-move" data-id="${s.id}" data-dir="-1" aria-label="${L('Flytt opp', 'Move up')}: ${esc(s.name)}" ${i === 0 ? 'disabled' : ''}>${svg(UI.up, 18, 2)}</button>
        <button class="tool-btn" data-act="scene-move" data-id="${s.id}" data-dir="1" aria-label="${L('Flytt ned', 'Move down')}: ${esc(s.name)}" ${i === m.scenes.length - 1 ? 'disabled' : ''}>${svg(UI.down, 18, 2)}</button></div>`;
    });
    html += `</div></section>`;
  }

  const hasVent = m.entities.some((e) => e.kind === 'vent');
  if (hasVent && m.boost_options.length) {
    html += `<section><h2 class="group-title">${L('Høy ventilasjon', 'High ventilation')}</h2><div class="card" style="border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:12px">
      <span style="font-size:15px">${L('Går tilbake av seg selv etter', 'Goes back by itself after')}</span>
      <div class="seg" style="grid-template-columns: repeat(${m.boost_options.length}, minmax(0, 1fr))">
      ${m.boost_options.map((o) => `<button aria-pressed="${m.prefs.boost_minutes === o}" data-act="boost" data-min="${o}" data-fid="b-${o}">${o} min</button>`).join('')}</div>
    </div></section>`;
  }

  return html;
}

// Velg enheter og verdier – brukes både av scener og automasjoner.
function pickerHTML(t, onlyLights = false) {
  let html = '';
  for (const e of S.m.entities.filter((x) => (onlyLights ? x.kind === 'light' : x.kind !== 'button'))) {
    const inc = t.include[e.key];
    const v = t.values[e.key];
    let ctl = '';
    if (inc) {
      if (e.kind === 'light') ctl = lightRow(e, v ?? 0, 'draft');
      else if (e.kind === 'heat') ctl = `<div class="draft-heat"><span class="status">${L('Temperatur', 'Temperature')}</span>${stepper(e, v, 'draft')}</div>`;
      else if (e.kind === 'vent') ctl = ventButtons(e, v, 'draft');
      else ctl = climateControls(e, v, 'draft');
    }
    const kind = kindName(e.kind);
    html += `<section class="card pick ${inc ? 'on' : ''}">
      <div class="row">
        <span><span class="name">${esc(e.label)}</span><span class="status">${kind}${inc ? '' : L(' · ikke med', ' · not included')}</span></span>
        <button class="check" role="checkbox" aria-checked="${!!inc}" aria-label="${L('Ta med', 'Include')} ${esc(e.label)}" data-act="include" data-key="${e.key}" data-fid="inc-${e.key}">${inc ? svg(UI.check, 18, 2.6) : ''}</button>
      </div>
      ${inc ? `<div class="pick-ctl">${ctl}</div>` : ''}
    </section>`;
  }
  return html;
}

function sceneEditorHTML() {
  const m = S.m;
  const d = S.draft;
  let html = subHTML(d.id ? L('Rediger scene', 'Edit scene') : L('Ny scene', 'New scene'), d.name || L('Uten navn', 'Untitled')) + toastHTML();
  html += `<section class="card form">
    <label class="field-label" for="scene-name">${L('Navn', 'Name')}</label>
    <input id="scene-name" class="input" type="text" maxlength="30" placeholder="${L('F.eks. Matlaging', 'E.g. Cooking')}" value="${esc(d.name)}" data-field="scene-name" autocomplete="off">
    <span class="field-label">${L('Ikon', 'Icon')}</span>
    <div class="icons">${m.icons.map((i) => `<button class="icon-pick" aria-pressed="${d.icon === i}" aria-label="${L('Ikon', 'Icon')} ${i}" data-act="icon" data-icon="${i}">${svg(ICON[i], 20)}</button>`).join('')}</div>
  </section>`;
  html += `<p class="intro">${L('Velg hvilke lys scenen skal styre. Lys du ikke tar med, blir som de er.', 'Choose which lights the scene controls. Lights you leave out stay as they are.')}</p>`;
  html += pickerHTML(d, true);
  html += `<button class="btn ghost big" data-act="from-now" style="width:100%">${L('Hent det som er på nå', 'Use what’s on now')}</button>`;
  html += `<div class="actions">
    ${d.id ? `<button class="btn ghost big danger-text" data-act="scene-delete">${S.confirmDelete ? L('Trykk igjen for å slette', 'Tap again to delete') : L('Slett', 'Delete')}</button>` : ''}
    <button class="btn primary big" data-act="scene-save" data-fid="scene-save">${L('Lagre', 'Save')}</button>
  </div>`;
  return html;
}

function autoEditorHTML() {
  const m = S.m;
  const a = S.adraft;
  const t = a.trigger;
  const lights = m.entities.filter((e) => e.kind === 'light');
  const vents = m.entities.filter((e) => e.kind === 'vent' && e.humidity != null);
  const types = [['time', L('Klokke', 'Clock')], ['sunset', L('Sol ned', 'Sunset')], ['sunrise', L('Sol opp', 'Sunrise')]];
  if (lights.length) types.push(['light', L('Lys', 'Light')]);
  const buttons = m.entities.filter((e) => e.kind === 'button' && e.events.length);
  if (buttons.length) types.push(['button', L('Knapp', 'Button')]);
  let html = subHTML(a.id ? L('Rediger automasjon', 'Edit automation') : L('Ny automasjon', 'New automation'), L('Automasjon', 'Automation')) + toastHTML();

  html += `<section class="card form"><span class="field-label">${L('Når', 'When')}</span>
    <div class="seg" style="grid-template-columns: repeat(${types.length}, minmax(0, 1fr))">
      ${types.map(([k, l]) => `<button aria-pressed="${t.type === k}" data-act="trig" data-v="${k}">${l}</button>`).join('')}
    </div>`;
  if (t.type === 'time') {
    html += `<input class="input time" type="time" value="${esc(t.at)}" data-field="auto-time" aria-label="${L('Klokkeslett', 'Time')}">`;
  } else if (t.type === 'sunset' || t.type === 'sunrise') {
    const sunTime = t.type === 'sunset' ? m.sun.sunset : m.sun.sunrise;
    html += `<div class="seg offsets">${(EN ? [[-60, '1 h before'], [-30, '30 min before'], [0, 'Exactly'], [30, '30 min after'], [60, '1 h after']] : [[-60, '1 t før'], [-30, '30 min før'], [0, 'Akkurat'], [30, '30 min etter'], [60, '1 t etter']]).map(([o, l]) => `<button aria-pressed="${(t.offset || 0) === o}" data-act="offset" data-v="${o}">${l}</button>`).join('')}</div>
      ${sunTime ? `<span class="note">${t.type === 'sunset' ? L('Solnedgang', 'Sunset') : L('Soloppgang', 'Sunrise')} ${L('i dag: kl.', 'today:')} ${clock(sunTime)}</span>` : ''}`;
  } else if (t.type === 'light') {
    html += `<div class="chips">${lights.map((e) => `<button class="chip" aria-pressed="${t.entity === e.key}" data-act="trig-entity" data-key="${e.key}">${esc(e.label)}</button>`).join('')}</div>
      <div class="seg" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
        <button aria-pressed="${t.to === 'on'}" data-act="trig-to" data-v="on">${L('slås på', 'turns on')}</button>
        <button aria-pressed="${t.to === 'off'}" data-act="trig-to" data-v="off">${L('slås av', 'turns off')}</button>
      </div>`;
  } else if (t.type === 'humidity') {
    html += `<div class="row between"><span class="status">${L('Luftfuktighet over', 'Humidity above')}</span><span class="stepper">
        <button data-act="hum" data-dir="-5" aria-label="${L('Senk', 'Lower')}" ${t.above <= 30 ? 'disabled' : ''}>−</button><output>${t.above} %</output>
        <button data-act="hum" data-dir="5" aria-label="${L('Øk', 'Raise')}" ${t.above >= 95 ? 'disabled' : ''}>+</button></span></div>
      ${vents[0]?.humidity != null ? `<span class="note">${L('Nå', 'Now')}: ${Math.round(vents[0].humidity)} %</span>` : ''}`;
  }
  if (t.type === 'button') {
    const be = entity(t.entity) || buttons[0];
    if (buttons.length > 1) html += `<div class="chips">${buttons.map((e) => `<button class="chip" aria-pressed="${t.entity === e.key}" data-act="trig-entity" data-key="${e.key}">${esc(e.label)}</button>`).join('')}</div>`;
    html += `<span class="note">${L('Velg trykket som skal starte automasjonen:', 'Choose the press that starts the automation:')}</span><div class="btn-events">${be.events.map((ev) => `<button class="chip" aria-pressed="${t.event === ev}" data-act="trig-event" data-v="${esc(ev)}">${esc(eventLabel(ev))}</button>`).join('')}</div>`;
  }
  if (t.type === 'light' || t.type === 'humidity' || t.type === 'button') {
    html += `<div class="row between"><span class="status">${L('Bare i et tidsrom', 'Only within a time window')}</span>
        <button class="switch teal" role="switch" aria-checked="${!!a.window}" aria-label="${L('Bare i et tidsrom', 'Only within a time window')}" data-act="window"></button></div>
      ${a.window ? `<div class="window"><input class="input time sm" type="time" value="${esc(a.window.from)}" data-field="win-from" aria-label="${L('Fra', 'From')}"><span>${L('til', 'to')}</span><input class="input time sm" type="time" value="${esc(a.window.to)}" data-field="win-to" aria-label="${L('Til', 'To')}"></div>` : ''}`;
  }
  html += `<span class="field-label">${L('Dager', 'Days')}</span>
    <div class="days">${DAYS.map((dn, i) => `<button class="day" aria-pressed="${a.days.includes(i + 1)}" data-act="day" data-v="${i + 1}">${dn}</button>`).join('')}</div>
    <div class="quick">
      <button class="chip-btn" data-act="days" data-v="1,2,3,4,5,6,7">${L('Hver dag', 'Every day')}</button>
      <button class="chip-btn" data-act="days" data-v="1,2,3,4,5">${L('Hverdager', 'Weekdays')}</button>
      <button class="chip-btn" data-act="days" data-v="6,7">${L('Helg', 'Weekends')}</button>
    </div>
  </section>`;

  const act = a.action;
  html += `<section><h2 class="group-title">${L('Gjør dette', 'Do this')}</h2><div class="list">`;
  for (const s of m.scenes) {
    html += `<button class="list-row" role="radio" aria-checked="${act.type === 'scene' && act.scene_id === s.id}" data-act="action" data-type="scene" data-id="${s.id}">
      <span class="row-ic">${svg(ICON[s.icon] || ICON.star, 20)}</span><span class="grow"><span class="t">${esc(s.name)}</span><span class="s">${esc(valuesSummary(s.values))}</span></span><span class="radio"></span></button>`;
  }
  html += `<button class="list-row" role="radio" aria-checked="${act.type === 'lights_off'}" data-act="action" data-type="lights_off">
      <span class="row-ic">${svg(UI.bulb, 20)}</span><span class="grow"><span class="t">${L('Slå av alle lys', 'Turn off all lights')}</span></span><span class="radio"></span></button>
    ${lights.some((e) => e.dimmable) ? `<button class="list-row" role="radio" aria-checked="${act.type === 'dim'}" data-act="action" data-type="dim">
      <span class="row-ic">${svg('M12 3v18M5 10l7-7 7 7M5 14l7 7 7-7', 20)}</span><span class="grow"><span class="t">${L('Dim lys', 'Dim lights')}</span><span class="s">${L('Lysere eller mørkere – fortsetter så lenge knappen holdes', 'Brighter or darker – continues as long as the button is held')}</span></span><span class="radio"></span></button>` : ''}
    <button class="list-row" role="radio" aria-checked="${act.type === 'set'}" data-act="action" data-type="set">
      <span class="row-ic">${svg(UI.spark, 20)}</span><span class="grow"><span class="t">${L('Velg enheter selv', 'Choose devices yourself')}</span><span class="s">${L('Lys, varme, luft – akkurat det du vil', 'Lights, heating, air – exactly what you want')}</span></span><span class="radio"></span></button>`;
  html += `</div></section>`;
  if (act.type === 'set') html += pickerHTML(a.set);
  if (act.type === 'dim') {
    html += `<section class="card form"><span class="field-label">${L('Hvilke lys', 'Which lights')}</span>
      <div class="chips">${lights.filter((e) => e.dimmable).map((e) => `<button class="chip" aria-pressed="${(act.entities || []).includes(e.key)}" data-act="dim-light" data-key="${e.key}">${esc(e.label)}</button>`).join('')}</div>
      <span class="field-label">${L('Retning', 'Direction')}</span>
      <div class="seg" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
        <button aria-pressed="${act.dir === 'up'}" data-act="dim-dir" data-v="up">${L('Lysere', 'Brighter')}</button>
        <button aria-pressed="${act.dir === 'down'}" data-act="dim-dir" data-v="down">${L('Mørkere', 'Darker')}</button>
      </div>
      <span class="field-label">${L('Trinn', 'Step')}</span>
      <div class="seg" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
        ${[5, 10, 20].map((n) => `<button aria-pressed="${act.step === n}" data-act="dim-step" data-v="${n}">${n} %</button>`).join('')}
      </div>
      ${t.type === 'button' && /hold|long/i.test(t.event || '') ? `<span class="note">${L('Dimmer videre så lenge knappen holdes inne.', 'Keeps dimming as long as the button is held.')}</span>` : `<span class="note">${L('Tips: koble til «hold» på en knapp, så dimmer den så lenge du holder.', 'Tip: link it to “hold” on a button so it dims as long as you hold.')}</span>`}
    </section>`;
  }

  html += `<section class="card form"><span class="field-label">${L('Gjør om etter', 'Undo after')}</span>
    <div class="seg" style="grid-template-columns: repeat(4, minmax(0, 1fr))">
      ${m.revert_options.map((o) => `<button aria-pressed="${a.revert_after === o}" data-act="revert" data-v="${o}">${revertLabel(o)}</button>`).join('')}
    </div>
    <span class="note">${L('Setter enhetene tilbake slik de var før automasjonen kjørte.', 'Puts the devices back the way they were before the automation ran.')}</span>
  </section>`;

  html += `<div class="actions">
    ${a.id ? `<button class="btn ghost big danger-text" data-act="auto-delete">${S.confirmDelete ? L('Trykk igjen', 'Tap again') : L('Slett', 'Delete')}</button>` : ''}
    ${a.id ? `<button class="btn ghost big" data-act="auto-run">${L('Test nå', 'Test now')}</button>` : ''}
    <button class="btn primary big" data-act="auto-save">${L('Lagre', 'Save')}</button>
  </div>`;
  return html;
}

function reloginHTML() {
  return `<div class="loading"><p>${L('Fikk ikke kontakt. Du kan være logget ut, eller forbindelsen ble brutt.', 'Couldn’t connect. You may have been logged out, or the connection was lost.')}</p>
    <button class="btn primary big relogin" data-act="relogin">${L('Logg inn på nytt', 'Log in again')}</button></div>`;
}

function render() {
  if (S.dragging) {
    S.deferred = true;
    return;
  }
  if (S.conn === 'relogin') {
    $app.innerHTML = reloginHTML();
    return;
  }
  if (!S.m) return;
  const ae = document.activeElement;
  if (ae && ae.matches?.(TYPING) && $app.contains(ae)) return;
  if (S.view === 'scene' && !S.draft) S.view = 'settings';
  if (S.view === 'auto' && !S.adraft) S.view = 'tabs';
  const fid = ae?.dataset?.fid;
  let html;
  try {
    html = S.view === 'settings' ? settingsHTML() : S.view === 'scene' ? sceneEditorHTML() : S.view === 'auto' ? autoEditorHTML() : tabsHTML();
  } catch (err) {
    console.error(err);
    if (S.view !== 'tabs') { S.view = 'tabs'; S.draft = null; S.adraft = null; return render(); }
    $app.innerHTML = `<div class="loading"><p>${L('Noe gikk galt ved visning av siden.', 'Something went wrong showing the page.')}</p><p class="note">${esc(err.message)}</p>
      <button class="btn primary big relogin" data-act="relogin">${L('Last inn på nytt', 'Reload')}</button></div>`;
    return;
  }
  $app.classList.toggle('has-tabs', S.view === 'tabs');
  $app.innerHTML = html;
  if (fid) $app.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
}

// ---------- handlinger ----------

function go(view) {
  S.view = view;
  S.confirmDelete = false;
  S.toast = null;
  window.scrollTo(0, 0);
  render();
}

function defaultValue(e) {
  const v = valueOf(e);
  if (e.kind === 'light') return v > 0 ? v : 60;
  if (e.kind === 'heat') return v != null ? Math.round(v) : Math.round((e.min + e.max) / 2);
  if (e.kind === 'vent') return v || 'normal';
  if (e.kind === 'climate') {
    const on = v && v.mode !== 'off' ? v : { mode: e.modes.find((x) => x !== 'off') || 'heat', temp: v?.temp ?? Math.round((e.min + e.max) / 2), fan: v?.fan ?? e.fans[0] };
    return { ...on, temp: on.temp != null ? Math.round(on.temp) : undefined };
  }
  return v;
}

function newSet(values) {
  const include = {};
  const vals = {};
  for (const e of S.m.entities) vals[e.key] = defaultValue(e);
  for (const [k, v] of Object.entries(values || {})) { include[k] = true; vals[k] = v; }
  return { include, values: vals };
}

function openScene(id) {
  const s = id ? sceneById(id) : null;
  S.draft = { id: s?.id || null, name: s?.name || '', icon: s?.icon || 'star', ...newSet(s?.values) };
  go('scene');
}

function openAuto(id) {
  const a = id ? S.m.automations.find((x) => x.id === id) : null;
  const firstScene = S.m.scenes[0];
  if (a) {
    S.adraft = JSON.parse(JSON.stringify({ id: a.id, trigger: a.trigger, window: a.window, days: a.days, action: a.action, revert_after: a.revert_after || 0 }));
  } else {
    S.adraft = { id: null, trigger: { type: 'time', at: '22:00', offset: 0 }, window: null, days: [1, 2, 3, 4, 5, 6, 7], action: firstScene ? { type: 'scene', scene_id: firstScene.id } : { type: 'lights_off' }, revert_after: 0 };
  }
  S.adraft.set = newSet(S.adraft.action.type === 'set' ? S.adraft.action.values : null);
  go('auto');
}

function setValueFor(e, next, draft, later = false) {
  if (draft) target().values[e.key] = next;
  else {
    setPending(e.key, next);
    (later ? sendLater : sendSet)(e.key, next);
  }
}

function act(a, ds) {
  const m = S.m;
  const draft = ds.mode === 'draft';
  if (!['scene-delete', 'auto-delete', 'reading-delete', 'cl-status', 'cl-submit', 'end-send', 'end-withdraw'].includes(a)) S.confirmDelete = false;
  if (a === 'cl-status' && S.confirmDelete && S.confirmDelete !== `${ds.id}-${ds.i}`) S.confirmDelete = false;
  if (a !== 'pay-claim') S.confirmClaim = null;
  switch (a) {
    case 'relogin':
      location.reload();
      return;
    case 'photo-view': S.photo = ds.id; return render();
    case 'photo-close': S.photo = null; return render();
    case 'push-on': return pushOn();
    case 'theme': if (window.hybelTheme) window.hybelTheme.set(ds.v); return render();
    case 'lang':
      if (ds.v === LANG) return;
      store.set('hybel-lang', ds.v);
      if (S.push.sub) cmd({ type: 'push_lang', endpoint: S.push.sub.endpoint, lang: ds.v }).finally(() => location.reload());
      else location.reload();
      return;
    case 'push-off': return pushOff();
    case 'push-test':
      if (!S.push.sub) return;
      S.push.busy = true; render();
      cmd({ type: 'push_test', endpoint: S.push.sub.endpoint }).then((r) => { S.push.busy = false; if (r.ok) showToast(L('Testvarsel sendt', 'Test notification sent')); render(); });
      return;
    case 'report-photo':
      pickPhoto('report', (id) => { S.report.photos.push(id); });
      return;
    case 'report-photo-rm':
      S.report.photos = S.report.photos.filter((x) => x !== ds.photo);
      return render();
    case 'cl-status': {
      const c = (m.checklists || []).find((x) => x.id === ds.id);
      const r = c && c.rows[Number(ds.i)];
      if (!r) return;
      const next = r.status === ds.v && ds.v === 'ok' ? null : ds.v;
      if (r.status === 'note' && next !== 'note' && (r.note || r.photos.length)) {
        if (!S.confirmDelete) { S.confirmDelete = `${ds.id}-${ds.i}`; showToast(L('Trykk OK igjen for å fjerne merknaden', 'Tap OK again to remove the note')); return; }
      }
      if (!r.status && next) c.done++;
      if (r.status && !next) c.done--;
      r.status = next;
      if (next !== 'note' && (r.note || r.photos.length)) { r.note = ''; r.photos = []; }
      cmd({ type: 'checklist_set', id: ds.id, i: Number(ds.i), status: next, ...(next !== 'note' ? { note: '' } : {}) });
      return render();
    }
    case 'cl-photo':
      pickPhoto(`${ds.id}-${ds.i}`, (id) => cmd({ type: 'checklist_photo_add', id: ds.id, i: Number(ds.i), photo: id }));
      return;
    case 'cl-photo-rm':
      cmd({ type: 'checklist_photo_remove', id: ds.id, i: Number(ds.i), photo: ds.photo });
      return;
    case 'scene-edit-mode': S.sceneEdit = !S.sceneEdit; return render();
    case 'pair-help': S.pairHelp = S.pairHelp === ds.key ? null : ds.key; return render();
    case 'pair-start':
      S.pairHelp = ds.key;
      cmd({ type: 'pair_start', key: ds.key }).then((r) => { if (r.ok) showToast(L('Tilkobling åpen i 10 min – slå bryteren av og på 7 ganger', 'Connecting for 10 min – switch the wall switch off and on 7 times')); });
      return;
    case 'pair-stop': cmd({ type: 'pair_stop' }); return;
    case 'meld-help': S.meldHelp = S.meldHelp === false; store.set('hybel-meld-help', S.meldHelp ? '1' : '0'); return render();
    case 'cl-full': S.clFull = S.clFull === ds.id ? null : ds.id; return render();
    case 'cl-sel': S.clSel = ds.id; window.scrollTo(0, 0); return render();
    case 'cl-mail': {
      const c = (m.checklists || []).find((x) => x.id === ds.id);
      if (c) mailChecklist(c);
      return;
    }
    case 'cl-submit':
      if (!S.confirmDelete) { S.confirmDelete = 'submit'; return render(); }
      S.confirmDelete = false;
      cmd({ type: 'checklist_submit', id: ds.id }).then((r) => { if (r.ok) { showToast(L('Sendt! Send gjerne en kopi på e-post.', 'Sent! Feel free to email yourself a copy.')); window.scrollTo(0, 0); } });
      return;
    case 'info-sub':
      S.infoSub = ds.v;
      if (ds.v === 'sjekk' && (S.m.checklists || []).some((c) => c.unread)) {
        S.m.checklists.forEach((c) => { c.unread = false; });
        cmd({ type: 'checklist_seen' });
      }
      if (ds.v === 'meld' && (S.m.reports || []).some((r) => r.unread)) {
        S.m.reports.forEach((r) => { r.unread = false; });
        cmd({ type: 'report_seen' });
      }
      if (S.tab !== 'info') { S.tab = 'info'; store.set('hybel-tab', 'info'); }
      window.scrollTo(0, 0);
      return render();
    case 'copy':
      try { navigator.clipboard.writeText(ds.v).then(() => showToast(ds.msg || L('Passordet er kopiert', 'Password copied')), () => showToast(L('Kunne ikke kopiere', 'Could not copy'), true)); } catch { showToast(L('Kunne ikke kopiere', 'Could not copy'), true); }
      return;
    case 'report-cat':
      S.report.category = ds.v;
      return render();
    case 'report-urgent':
      S.report.urgent = !S.report.urgent;
      return render();
    case 'report-send': {
      const f = S.report;
      if (!f.category) return showToast(L('Velg hva det gjelder', "Choose what it's about"), true);
      cmd({ type: 'report_create', category: f.category, text: f.text, urgent: f.urgent, photos: f.photos }).then((r) => {
        if (!r.ok) return;
        S.report = { category: null, text: '', urgent: false, photos: [] };
        showToast(L('Meldingen er sendt til utleier', 'Your message has been sent to the landlord'));
      });
      return;
    }
    case 'report-reply': {
      const text = (S.reply[ds.id] || '').trim();
      if (!text) return;
      cmd({ type: 'report_reply', id: ds.id, text }).then((r) => { if (r.ok) { S.reply[ds.id] = ''; showToast(L('Svaret er sendt', 'Reply sent')); } });
      return;
    }
    case 'reading-add':
      if (S.reading.date > localToday()) return showToast(L('Du kan ikke legge inn en avlesning fram i tid', "You can't enter a reading for a future date"), true);
      cmd({ type: 'reading_add', date: S.reading.date, value: S.reading.value }).then((r) => {
        if (!r.ok) return;
        S.reading = { date: localToday(), value: '' };
        showToast(L('Avlesningen er lagret', 'Reading saved'));
      });
      return;
    case 'maint-done':
      cmd({ type: 'maint_done', id: ds.id }).then((r) => r.ok && showToast(L('Takk! Utleier har fått beskjed.', 'Thanks! The landlord has been notified.')));
      return;
    case 'end-open': S.endForm = { date: S.m.termination?.earliest || '', reason: '' }; return render();
    case 'end-cancel': S.endForm = null; return render();
    case 'end-send':
      if (!S.endForm?.date) return showToast(L('Velg ønsket siste dag', 'Choose the requested last day'), true);
      if (S.confirmDelete !== 'end-send') { S.confirmDelete = 'end-send'; return render(); }
      S.confirmDelete = false;
      cmd({ type: 'end_request', date: S.endForm.date, reason: S.endForm.reason }).then((r) => { if (r.ok) { S.endForm = null; showToast(L('Sendt til utleier', 'Sent to the landlord')); } });
      return render();
    case 'end-withdraw':
      if (S.confirmDelete !== `end-${ds.id}`) { S.confirmDelete = `end-${ds.id}`; return render(); }
      S.confirmDelete = false;
      cmd({ type: 'end_withdraw', id: ds.id }).then((r) => r.ok && showToast(L('Forespørselen er trukket tilbake', 'Request withdrawn')));
      return render();
    case 'pay-claim':
      if (S.confirmClaim !== ds.month) { S.confirmClaim = ds.month; return render(); }
      S.confirmClaim = null;
      cmd({ type: 'pay_claim', month: ds.month }).then((r) => r.ok && showToast(L('Takk! Utleier får beskjed og bekrefter når pengene er kommet.', 'Thanks! The landlord will be notified and confirm when the money arrives.')));
      return render();
    case 'pay-unclaim':
      cmd({ type: 'pay_claim', month: ds.month, on: false }).then((r) => r.ok && showToast(L('Meldingen om betaling er trukket tilbake', 'Payment report withdrawn')));
      return;
    case 'reading-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      S.confirmDelete = false;
      cmd({ type: 'reading_delete', id: ds.id }).then((r) => r.ok && showToast(L('Siste avlesning er slettet', 'Latest reading deleted')));
      return;

    case 'tab':
      S.tab = ds.id;
      store.set('hybel-tab', ds.id);
      window.scrollTo(0, 0);
      if (ds.id === 'stat') loadStats();
      return render();
    case 'stat-range':
      S.stats.range = ds.v;
      store.set('hybel-stat-range', ds.v);
      loadStats();
      return render();
    case 'settings':
      return go('settings');
    case 'back':
      if (S.view === 'scene') { S.draft = null; return go(S.tab === 'lys' ? 'tabs' : 'settings'); }
      if (S.view === 'auto') S.adraft = null;
      return go('tabs');
    case 'scene': {
      const s = sceneById(ds.id);
      if (!s) return;
      for (const [key, v] of Object.entries(s.values)) setPending(key, v);
      for (const x of m.scenes) x.active = x.id === s.id;
      render();
      cmd({ type: 'scene', id: s.id }).then((r) => r.ok && showToast(L(`${s.name} er satt`, `${s.name} is on`)));
      return;
    }
    case 'scene-new':
      return openScene(null);
    case 'scene-edit':
      return openScene(ds.id);
    case 'scene-move':
    case 'ent-move': {
      const list = a === 'scene-move' ? m.scenes : m.entities;
      const i = list.findIndex((x) => (a === 'scene-move' ? x.id === ds.id : x.key === ds.key));
      const j = i + Number(ds.dir);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      render();
      cmd(a === 'scene-move' ? { type: 'scene_move', id: ds.id, dir: Number(ds.dir) } : { type: 'entity_move', key: ds.key, dir: Number(ds.dir) });
      return;
    }
    case 'icon':
      S.draft.icon = ds.icon;
      return render();
    case 'include': {
      const t = target();
      t.include[ds.key] = !t.include[ds.key];
      return render();
    }
    case 'from-now': {
      const t = target();
      for (const e of m.entities) if (t.include[e.key] && valueOf(e) != null) t.values[e.key] = e.kind === 'heat' ? Math.round(valueOf(e)) : JSON.parse(JSON.stringify(valueOf(e)));
      showToast(L('Hentet verdiene som er på nå', 'Copied the current values'));
      return;
    }
    case 'scene-save': {
      const d = S.draft;
      const values = Object.fromEntries(Object.keys(d.include).filter((k) => d.include[k]).map((k) => [k, d.values[k]]));
      cmd({ type: 'scene_save', scene: { id: d.id, name: d.name.trim(), icon: d.icon, values } }).then((r) => {
        if (!r.ok) return;
        S.draft = null;
        S.tab = 'scener';
        go('tabs');
        showToast(L(`${d.name.trim()} er lagret`, `${d.name.trim()} saved`));
      });
      return;
    }
    case 'scene-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      cmd({ type: 'scene_delete', id: S.draft.id }).then((r) => { if (r.ok) { S.draft = null; go('tabs'); showToast(L('Scenen er slettet', 'Scene deleted')); } });
      return;
    case 'auto-new':
      return openAuto(null);
    case 'auto-edit':
      return openAuto(ds.id);
    case 'auto-group':
      S.autoOpen[ds.v] = S.autoOpen[ds.v] === false;
      store.set('hybel-auto-open', JSON.stringify(S.autoOpen));
      return render();
    case 'auto-toggle': {
      const x = m.automations.find((y) => y.id === ds.id);
      if (!x) return;
      x.enabled = !x.enabled;
      render();
      cmd({ type: 'auto_toggle', id: x.id, enabled: x.enabled });
      return;
    }
    case 'trig': {
      const t = S.adraft.trigger;
      t.type = ds.v;
      if (ds.v === 'time' && !t.at) t.at = '22:00';
      if (ds.v === 'light') { t.entity = t.entity && entity(t.entity)?.kind === 'light' ? t.entity : m.entities.find((e) => e.kind === 'light')?.key; t.to = t.to || 'on'; }
      if (ds.v === 'humidity') { t.entity = m.entities.find((e) => e.kind === 'vent')?.key; t.above = t.above || 70; }
      if (ds.v === 'button') { const b = m.entities.find((e) => e.kind === 'button' && e.events.length); t.entity = t.entity && entity(t.entity)?.kind === 'button' ? t.entity : b?.key; t.event = entity(t.entity)?.events.includes(t.event) ? t.event : entity(t.entity)?.events[0]; }
      if (!['light', 'humidity', 'button'].includes(ds.v)) S.adraft.window = null;
      return render();
    }
    case 'trig-entity': {
      const t = S.adraft.trigger;
      t.entity = ds.key;
      if (t.type === 'button' && !entity(ds.key)?.events.includes(t.event)) t.event = entity(ds.key)?.events[0];
      return render();
    }
    case 'trig-event':
      S.adraft.trigger.event = ds.v;
      return render();
    case 'trig-to':
      S.adraft.trigger.to = ds.v;
      return render();
    case 'hum':
      S.adraft.trigger.above = Math.min(95, Math.max(30, (S.adraft.trigger.above || 70) + Number(ds.dir)));
      return render();
    case 'window':
      S.adraft.window = S.adraft.window ? null : { from: '07:00', to: '23:00' };
      return render();
    case 'offset':
      S.adraft.trigger.offset = Number(ds.v);
      return render();
    case 'day': {
      const n = Number(ds.v);
      const days = S.adraft.days;
      S.adraft.days = days.includes(n) ? days.filter((x) => x !== n) : [...days, n].sort();
      return render();
    }
    case 'days':
      S.adraft.days = ds.v.split(',').map(Number);
      return render();
    case 'action': {
      const t = S.adraft.trigger;
      if (ds.type === 'dim') {
        const first = m.entities.find((e) => e.kind === 'light' && e.dimmable);
        const dir = t.type === 'button' && /_down_|_off_/i.test(t.event || '') ? 'down' : 'up';
        S.adraft.action = { type: 'dim', entities: first ? [first.key] : [], dir, step: 10 };
      } else S.adraft.action = ds.type === 'scene' ? { type: 'scene', scene_id: ds.id } : { type: ds.type };
      return render();
    }
    case 'dim-light': {
      const list = S.adraft.action.entities || [];
      S.adraft.action.entities = list.includes(ds.key) ? list.filter((k) => k !== ds.key) : [...list, ds.key];
      return render();
    }
    case 'dim-dir':
      S.adraft.action.dir = ds.v;
      return render();
    case 'dim-step':
      S.adraft.action.step = Number(ds.v);
      return render();
    case 'revert':
      S.adraft.revert_after = Number(ds.v);
      return render();
    case 'auto-save': {
      const ad = S.adraft;
      const t = ad.trigger;
      const trigger = t.type === 'time' ? { type: 'time', at: t.at }
        : t.type === 'light' ? { type: 'light', entity: t.entity, to: t.to }
        : t.type === 'humidity' ? { type: 'humidity', entity: t.entity, above: t.above }
        : t.type === 'button' ? { type: 'button', entity: t.entity, event: t.event }
        : { type: t.type, offset: t.offset || 0 };
      const action = ad.action.type === 'set'
        ? { type: 'set', values: Object.fromEntries(Object.keys(ad.set.include).filter((k) => ad.set.include[k]).map((k) => [k, ad.set.values[k]])) }
        : ad.action;
      cmd({ type: 'auto_save', automation: { id: ad.id, trigger, window: ad.window, days: ad.days, action, revert_after: ad.revert_after } }).then((r) => {
        if (!r.ok) return;
        S.adraft = null;
        S.tab = 'auto';
        go('tabs');
        showToast(L('Automasjonen er lagret', 'Automation saved'));
      });
      return;
    }
    case 'auto-run':
      cmd({ type: 'auto_run', id: S.adraft.id }).then((r) => r.ok && showToast(L('Automasjonen kjørte', 'Automation ran')));
      return;
    case 'auto-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      cmd({ type: 'auto_delete', id: S.adraft.id }).then((r) => { if (r.ok) { S.adraft = null; go('tabs'); showToast(L('Automasjonen er slettet', 'Automation deleted')); } });
      return;
    case 'toggle': {
      const e = entity(ds.key);
      if (!e) return;
      const cur = draft ? target().values[e.key] ?? 0 : valueOf(e) ?? 0;
      const next = cur > 0 ? 0 : S.lastBri[e.key] || (e.dimmable ? 60 : 100);
      if (cur > 0) S.lastBri[e.key] = cur;
      setValueFor(e, next, draft);
      return render();
    }
    case 'all-off':
      for (const e of m.entities.filter((x) => x.kind === 'light' && x.in_all_off !== false)) {
        const cur = valueOf(e);
        if (cur > 0) S.lastBri[e.key] = cur;
        setPending(e.key, 0);
      }
      cmd({ type: 'all_off' });
      return render();
    case 'heat': {
      const e = entity(ds.key);
      if (!e) return;
      const cur = (draft ? target().values[e.key] : valueOf(e)) ?? e.min;
      const base = Math.round(Math.min(e.max, Math.max(e.min, Number(cur) || e.min)));
      setValueFor(e, Math.min(e.max, Math.max(e.min, base + Number(ds.dir))), draft, true);
      return render();
    }
    case 'fan': {
      const e = entity(ds.key);
      if (e) setValueFor(e, ds.v, draft);
      return render();
    }
    case 'cl-power':
    case 'cl-mode':
    case 'cl-temp':
    case 'cl-fan': {
      const e = entity(ds.key);
      if (!e) return;
      const cur = { ...((draft ? target().values[e.key] : valueOf(e)) || { mode: 'off' }) };
      let next = cur;
      if (a === 'cl-power') {
        if (cur.mode !== 'off') { S.lastMode[e.key] = cur.mode; next = { ...cur, mode: 'off' }; }
        else next = { ...cur, mode: S.lastMode[e.key] || e.modes.find((x) => x !== 'off') || 'heat' };
      } else if (a === 'cl-mode') next = { ...cur, mode: ds.v };
      else if (a === 'cl-fan') next = { ...cur, fan: ds.v };
      else {
        const base = Math.round(Math.min(e.max, Math.max(e.min, Number(cur.temp) || e.min)));
        next = { ...cur, temp: Math.min(e.max, Math.max(e.min, base + Number(ds.dir))) };
      }
      if (next.temp != null) next.temp = Math.round(next.temp);
      setValueFor(e, next, draft, a === 'cl-temp');
      return render();
    }
    case 'boost':
      m.prefs.boost_minutes = Number(ds.min);
      render();
      cmd({ type: 'prefs', boost_minutes: Number(ds.min) });
      return;
  }
}

$app.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b || b.disabled || (!S.m && b.dataset.act !== 'relogin')) return;
  act(b.dataset.act, b.dataset);
});

let dragTimer;
function endDrag() {
  clearTimeout(dragTimer);
  if (!S.dragging) return;
  S.dragging = null;
  if (S.deferred) S.deferred = false;
  render();
}

$app.addEventListener('input', (ev) => {
  const t = ev.target;
  const f = t.dataset.field;
  if (f === 'scene-name') { S.draft.name = t.value; return; }
  if (f === 'report-text') { S.report.text = t.value; return; }
  if (f === 'cl-note' || f === 'cl-comment') return;
  if (f === 'reply') { S.reply[t.dataset.id] = t.value; return; }
  if (f === 'reading-value') { S.reading.value = t.value; return; }
  if (f === 'reading-date') { S.reading.date = t.value; checkFutureReading(); return; }
  if (f === 'end-date' && S.endForm) { S.endForm.date = t.value; const w = $app.querySelector('.end-early'); const e = S.m.termination?.earliest; if (w) w.hidden = !(e && t.value && t.value < e); return; }
  if (f === 'end-reason' && S.endForm) { S.endForm.reason = t.value; return; }
  if (f === 'auto-time') { S.adraft.trigger.at = t.value; return; }
  if (f === 'win-from') { S.adraft.window.from = t.value; return; }
  if (f === 'win-to') { S.adraft.window.to = t.value; return; }
  const r = t.closest('input.range[data-key]');
  if (!r) return;
  const key = r.dataset.key;
  const v = Number(r.value);
  S.dragging = key;
  clearTimeout(dragTimer);
  dragTimer = setTimeout(endDrag, 1500);
  S.lastBri[key] = v;
  if (r.dataset.mode === 'draft') target().values[key] = v;
  else {
    setPending(key, v);
    sendSet(key, v);
  }
  const st = $app.querySelector(`[data-status="${CSS.escape(key)}"]`);
  if (st) st.textContent = `${L('På', 'On')} · ${v} %`;
});

$app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.field === 'reading-date') { S.reading.date = t.value; checkFutureReading(); }
  if (t.closest('input.range[data-key]')) endDrag();
  if (t.dataset.field === 'cl-note') {
    const c = (S.m.checklists || []).find((x) => x.id === t.dataset.id);
    if (c && c.rows[Number(t.dataset.i)]) c.rows[Number(t.dataset.i)].note = t.value;
    cmd({ type: 'checklist_set', id: t.dataset.id, i: Number(t.dataset.i), note: t.value });
  }
  if (t.dataset.field === 'cl-comment') {
    const c = (S.m.checklists || []).find((x) => x.id === t.dataset.id);
    if (c) c.comment = t.value;
    cmd({ type: 'checklist_comment', id: t.dataset.id, text: t.value });
  }
});
$app.addEventListener('focusout', (ev) => {
  if (ev.target.matches?.(TYPING)) setTimeout(render, 0);
});

// ---------- bilder ----------

async function shrink(file) {
  const max = 1600;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
  }
  const w = bmp.width, h = bmp.height;
  const k = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * k);
  cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error(L('Kunne ikke lese bildet', 'Could not read the photo')))), 'image/jpeg', 0.82));
}

function pickPhoto(key, done) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    S.uploading = key;
    render();
    try {
      const blob = await shrink(file);
      const r = await fetch('api/photo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({ ok: false, error: L('Uventet svar', 'Unexpected response') }));
      if (!j.ok) throw new Error(serverText(j.error) || L('Opplasting feilet', 'Upload failed'));
      await done(j.id);
    } catch (err) {
      showToast(err.message || L('Kunne ikke laste opp bildet', 'Could not upload the photo'), true);
    }
    S.uploading = null;
    render();
  };
  inp.click();
}

// ---------- pushvarsler ----------

const b64uToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function initPush() {
  const P = S.push;
  P.ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  P.standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  P.supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    if (P.supported) {
      P.permission = Notification.permission;
      P.sub = await reg.pushManager.getSubscription();
    }
  } catch (err) {
    console.warn('Service worker:', err);
  }
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') openFromUrl(e.data.url); });
  render();
}

async function pushOn() {
  const P = S.push;
  if (!S.m.push?.key) return;
  P.busy = true;
  render();
  try {
    const perm = await Notification.requestPermission();
    P.permission = perm;
    if (perm !== 'granted') throw new Error(perm === 'denied' ? L('Varsler ble blokkert', 'Notifications were blocked') : L('Varsler ble ikke slått på', 'Notifications were not turned on'));
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) { try { await sub.unsubscribe(); } catch {} }
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(S.m.push.key) });
    const device = P.ios ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : L('Nettleser', 'Browser');
    const r = await cmd({ type: 'push_subscribe', subscription: sub.toJSON(), device, lang: LANG });
    if (!r.ok) throw new Error(serverText(r.error) || L('Kunne ikke lagre', 'Could not save'));
    P.sub = sub;
    showToast(L('Varsler er slått på', 'Notifications turned on'));
  } catch (err) {
    showToast(err.message || L('Kunne ikke slå på varsler', 'Could not turn on notifications'), true);
  }
  P.busy = false;
  render();
}

async function pushOff() {
  const P = S.push;
  if (!P.sub) return;
  P.busy = true;
  render();
  const endpoint = P.sub.endpoint;
  try { await P.sub.unsubscribe(); } catch {}
  await cmd({ type: 'push_unsubscribe', endpoint });
  P.sub = null;
  P.busy = false;
  showToast(L('Varsler er slått av', 'Notifications turned off'));
  render();
}

// Åpnet fra et varsel: /?vis=meld | strom | sjekk
function openFromUrl(href) {
  let v = null;
  try { v = new URL(href, location.href).searchParams.get('vis'); } catch {}
  if (!['meld', 'strom', 'sjekk', 'info'].includes(v)) return;
  S.view = 'tabs';
  S.tab = 'info';
  store.set('hybel-tab', 'info');
  S.infoSub = v;
  if (location.search) history.replaceState(null, '', location.pathname);
  render();
}

openFromUrl(location.href);
initPush();
connect();
