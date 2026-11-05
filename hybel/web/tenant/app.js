// Leietakersiden – ren JavaScript, ingen rammeverk.
import { qrSvg, wifiString } from './qr.js';

const $app = document.getElementById('app');

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
  tab: store.get('hybel-tab') || 'lys',
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
  autoOpen: (() => { try { return JSON.parse(localStorage.getItem('hybel-auto-open') || '{}'); } catch { return {}; } })(),
  reply: {},
  reading: { date: new Date().toISOString().slice(0, 10), value: '' }
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
const VENT_LABEL = { away: 'Borte', low: 'Lav', normal: 'Normal', high: 'Høy' };
const VENT_LEVEL = { away: 0, low: 1, normal: 2, high: 3 };
const MODE_LABEL = { off: 'Av', heat: 'Varme', cool: 'Kjøling', heat_cool: 'Auto', auto: 'Auto', dry: 'Tørk', fan_only: 'Vifte' };
const FAN_LABEL = { auto: 'Auto', low: 'Lav', medium: 'Middels', mid: 'Middels', high: 'Høy', quiet: 'Stille', silent: 'Stille', turbo: 'Turbo', powerful: 'Kraftig' };
const fanLabel = (f) => FAN_LABEL[String(f).toLowerCase()] || String(f).charAt(0).toUpperCase() + String(f).slice(1);
const DAYS = ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];
const TABS = [
  { id: 'lys', label: 'Lys', icon: UI.bulb },
  { id: 'klima', label: 'Klima', icon: UI.flame },
  { id: 'scener', label: 'Scener', icon: ICON.star },
  { id: 'auto', label: 'Automasjoner', short: 'Auto', icon: UI.clock },
  { id: 'info', label: 'Info', icon: 'M12 8h.01M11 12h1v4h1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' }
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deg = (t) => (t == null || !Number.isFinite(Number(t)) ? '–' : String(Math.round(Number(t) * 10) / 10).replace('.', ',') + '°');
const svg = (d, size = 22, sw = 1.8) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const clock = (ms) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
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
    const j = await r.json().catch(() => ({ ok: false, error: 'Uventet svar' }));
    if (!j.ok) showToast(j.error || 'Noe gikk galt', true);
    return j;
  } catch {
    showToast('Fikk ikke kontakt med huset. Prøv igjen.', true);
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
    parts.push(on.length ? (on.length === lights.length && lights.length > 1 ? 'lys' : `${on.length} lys`) : 'lys av');
  }
  for (const e of ents) {
    const v = values[e.key];
    if (v === undefined || e.kind === 'light') continue;
    if (e.kind === 'heat') parts.push(`${e.label.toLowerCase()} ${deg(v)}`);
    else if (e.kind === 'vent') parts.push(`luft ${VENT_LABEL[v].toLowerCase()}`);
    else if (e.kind === 'climate') parts.push(v.mode === 'off' ? `${e.label.toLowerCase()} av` : `${e.label.toLowerCase()} ${MODE_LABEL[v.mode].toLowerCase()}${v.temp != null && v.mode !== 'fan_only' ? ` ${deg(v.temp)}` : ''}`);
  }
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function autoWhen(t, w) {
  let s;
  if (t.type === 'time') s = `Kl. ${t.at}`;
  else if (t.type === 'sunset' || t.type === 'sunrise') {
    const base = t.type === 'sunset' ? 'Solnedgang' : 'Soloppgang';
    if (!t.offset) s = base;
    else {
      const abs = Math.abs(t.offset);
      s = `${abs % 60 === 0 ? `${abs / 60} t` : `${abs} min`} ${t.offset < 0 ? 'før' : 'etter'} ${base.toLowerCase()}`;
    }
  } else if (t.type === 'light') s = `Når ${(entity(t.entity)?.label || 'lyset').toLowerCase()} slås ${t.to === 'on' ? 'på' : 'av'}`;
  else if (t.type === 'humidity') s = `Når luftfuktigheten er over ${t.above} %`;
  else if (t.type === 'button') s = `${entity(t.entity)?.label || 'Knapp'}: ${eventLabel(t.event).toLowerCase()}`;
  else s = '';
  if (w) s += ` (${w.from}–${w.to})`;
  return s;
}
function autoDays(days) {
  if (days.length === 7) return 'hver dag';
  if (days.join() === '1,2,3,4,5') return 'hverdager';
  if (days.join() === '6,7') return 'helg';
  return days.map((d) => DAYS[d - 1].toLowerCase()).join(', ');
}
function autoWhat(a) {
  if (a.type === 'scene') return sceneById(a.scene_id)?.name || '(slettet scene)';
  if (a.type === 'lights_off') return 'Slå av alle lys';
  if (a.type === 'set') return valuesSummary(a.values) || 'Styr enheter';
  if (a.type === 'dim') return `Dim ${(a.entities || []).map((k) => entity(k)?.label || '').filter(Boolean).join(', ').toLowerCase()} ${a.dir === 'up' ? 'opp' : 'ned'}`;
  return '';
}
// «button_2_up_press» → «Knapp 2 opp – trykk»
function eventLabel(ev) {
  const m = String(ev).match(/button_(\d+)_(up|down|on|off)_(press|hold|release|short_release|long_press)/i);
  if (m) {
    const dir = { up: '▲', on: '▲', down: '▼', off: '▼' }[m[2].toLowerCase()];
    const how = /hold|long/i.test(m[3]) ? 'hold' : 'trykk';
    return `Knapp ${m[1]} ${dir} ${how}`;
  }
  const map = { single: 'Ett trykk', double: 'Dobbeltrykk', long: 'Langt trykk', press: 'Trykk', hold: 'Hold' };
  return map[String(ev).toLowerCase()] || String(ev).replace(/_/g, ' ');
}
const revertLabel = (m) => (m === 0 ? 'Aldri' : m < 60 ? `${m} min` : `${m / 60} t`);

// ---------- byggeklosser ----------

function kicker() {
  if (S.conn !== 'ok') return ['warn', 'Kobler til …'];
  if (!S.m.connected) return ['bad', 'Mistet kontakt med huset'];
  return ['', 'Tilkoblet'];
}

function tabs() {
  const m = S.m;
  return TABS.filter((t) => {
    if (t.id === 'lys') return m.entities.some((e) => e.kind === 'light');
    if (t.id === 'klima') return m.entities.some((e) => ['heat', 'vent', 'climate'].includes(e.kind));
    if (t.id === 'auto') return m.can_edit || m.automations.length;
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
    <button class="icon-btn" data-act="settings" data-fid="settings" aria-label="Innstillinger">${svg(UI.gear)}</button>
  </header>`;
}

function subHTML(kick, title) {
  return `<header class="sub">
    <button class="icon-btn" data-act="back" data-fid="back" aria-label="Tilbake">${svg(UI.back, 22, 2)}</button>
    <div><span class="kicker">${esc(kick)}</span><h1>${esc(title)}</h1></div>
  </header>`;
}

function navHTML() {
  const list = tabs();
  return `<nav class="tabbar" style="grid-template-columns: repeat(${list.length}, minmax(0, 1fr))" aria-label="Faner">
    ${list.map((t) => `<button class="tab" aria-current="${S.tab === t.id ? 'page' : 'false'}" data-act="tab" data-id="${t.id}" data-fid="tab-${t.id}">${svg(t.icon, 22)}<span>${t.short || t.label}</span>${t.id === 'info' && infoBadge() ? '<i class="badge-dot" aria-label="Nytt"></i>' : ''}</button>`).join('')}
  </nav>`;
}

function toastHTML() {
  if (!S.toast) return '';
  return `<div class="toast ${S.toast.error ? 'error' : ''}" role="status">${S.toast.error ? '' : svg(UI.check, 18, 2.2)}<span>${esc(S.toast.msg)}</span></div>`;
}

function lightRow(e, v, mode) {
  const on = v > 0;
  const live = mode === 'draft' || e.available;
  const status = !live ? 'Svarer ikke' : on ? (e.dimmable ? `På · ${v} %` : 'På') : 'Av';
  return `<div class="light ${live ? '' : 'unavail'}">
    <div class="row">
      ${mode === 'draft' ? `<span class="status" data-status="${e.key}">${status}</span>` : `<span><span class="name">${esc(e.label)}</span><span class="status" data-status="${e.key}">${status}</span></span>`}
      <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(e.label)}" data-act="toggle" data-key="${e.key}" data-mode="${mode}" data-fid="t-${mode}-${e.key}" ${live ? '' : 'disabled'}></button>
    </div>
    ${on && e.dimmable && live ? `<input class="range" type="range" min="1" max="100" step="1" value="${v}" aria-label="Lysstyrke ${esc(e.label)}" data-key="${e.key}" data-mode="${mode}" data-fid="r-${mode}-${e.key}">` : ''}
  </div>`;
}

function stepper(e, v, mode, act = 'heat') {
  const live = mode === 'draft' || e.available;
  const atMax = v != null && v >= e.max;
  const atMin = v != null && v <= e.min;
  return `<span class="stepper">
    <button data-act="${act}" data-dir="-1" data-key="${e.key}" data-mode="${mode}" data-fid="hd-${mode}-${e.key}" aria-label="Senk temperatur" ${!live || atMin ? 'disabled' : ''}>−</button>
    <output aria-live="polite">${deg(v)}</output>
    <button data-act="${act}" data-dir="1" data-key="${e.key}" data-mode="${mode}" data-fid="hu-${mode}-${e.key}" aria-label="Øk temperatur" ${!live || atMax ? 'disabled' : ''}>+</button>
  </span>`;
}

function limitLine(e, v) {
  const atMax = v != null && v >= e.max;
  const atMin = v != null && v <= e.min;
  const text = !e.available ? 'Svarer ikke akkurat nå' : atMax ? `Maks ${e.max}° – satt av utleier` : atMin ? `Minimum ${e.min}°` : `Kan stilles mellom ${e.min}° og ${e.max}°`;
  return `<div class="limit ${atMax || atMin ? 'hit' : ''}">${text}</div>`;
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
      <span class="status">${on ? MODE_LABEL[v.mode] : 'Av'}${!on || mode === 'draft' || S.pending[e.key] || !e.action || e.action === 'idle' || e.action === 'off' ? '' : e.action === 'heating' ? ' · varmer' : e.action === 'cooling' ? ' · kjøler' : ''}</span>
      <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(e.label)} på eller av" data-act="cl-power" data-key="${e.key}" data-mode="${mode}" data-fid="cp-${mode}-${e.key}" ${live ? '' : 'disabled'}></button>
    </div>`;
  if (on) {
    if (modes.length > 1) {
      h += `<div class="seg" style="grid-template-columns: repeat(${modes.length}, minmax(0, 1fr))">${modes.map((mo) => `<button aria-pressed="${v.mode === mo}" data-act="cl-mode" data-key="${e.key}" data-v="${mo}" data-mode="${mode}" ${live ? '' : 'disabled'}>${MODE_LABEL[mo]}</button>`).join('')}</div>`;
    }
    if (v.mode !== 'fan_only') h += `<div class="row climate-temp"><span class="status">Temperatur</span>${stepper(e, v.temp, mode, 'cl-temp')}</div>`;
    if (e.fans.length) {
      h += `<span class="field-label">Vifte</span><div class="seg fans-seg" style="grid-template-columns: repeat(${Math.min(e.fans.length, 5)}, minmax(0, 1fr))">${e.fans.map((f) => `<button aria-pressed="${v.fan === f}" data-act="cl-fan" data-key="${e.key}" data-v="${esc(f)}" data-mode="${mode}" ${live ? '' : 'disabled'}>${esc(fanLabel(f))}</button>`).join('')}</div>`;
    }
  }
  return h;
}

// ---------- faner ----------

function scenesTab() {
  const m = S.m;
  let h = '';
  if (m.scenes.length) {
    h += `<section class="card section scene-list">`;
    for (const s of m.scenes) {
      h += `<div class="scene-row ${s.active ? 'active' : ''}">
        <button class="scene-main" data-act="scene" data-id="${s.id}" data-fid="s-${s.id}" aria-pressed="${s.active}">
          <span class="ic">${svg(ICON[s.icon] || ICON.star, 18)}</span>
          <span class="txt"><span class="name">${esc(s.name)}</span><span class="sum">${esc(valuesSummary(s.values))}</span></span>
          ${s.active ? '<span class="pill lvl-ok">På</span>' : ''}
        </button>
        ${m.can_edit ? `<button class="scene-edit" data-act="scene-edit" data-id="${s.id}" aria-label="Rediger ${esc(s.name)}">${svg(UI.pencil, 15, 2)}</button>` : ''}
      </div>`;
    }
    h += `</section>`;
  }
  if (m.can_edit) h += `<button class="btn ghost scene-add" data-act="scene-new" data-fid="s-new">${svg(UI.plus, 18, 2)} Ny scene</button>`;
  if (!m.scenes.length && !m.can_edit) h += `<p class="intro">Ingen scener ennå.</p>`;
  return h;
}

function lightsTab() {
  const lights = S.m.entities.filter((e) => e.kind === 'light');
  return `<section class="card section"><div class="section-head"><h2>Alle lys</h2>
      <button class="chip-btn" data-act="all-off" data-fid="alloff">Slå av alle</button></div>
      ${lights.map((e) => lightRow(e, valueOf(e) ?? 0, 'live')).join('')}</section>`;
}

function climateTab() {
  const m = S.m;
  let h = '';
  for (const e of m.entities.filter((x) => ['heat', 'vent', 'climate'].includes(x.kind))) {
    const v = valueOf(e);
    if (e.kind === 'heat') {
      const now = e.current != null ? `Nå ${deg(e.current)}${e.heating ? ' · varmer' : ''}` : '';
      h += `<section class="card heat ${e.available ? '' : 'unavail'}">
        <div class="row"><span><span class="title">${esc(e.label)}</span><span class="muted" style="font-size:13px">${now}</span></span>${stepper(e, v, 'live')}</div>
        ${limitLine(e, v)}
      </section>`;
    } else if (e.kind === 'climate') {
      h += `<section class="card heat climate ${e.available ? '' : 'unavail'}">
        <div class="row"><span><span class="title">${esc(e.label)}</span><span class="muted" style="font-size:13px">${e.current != null ? `Nå ${deg(e.current)}` : ''}</span></span></div>
        ${climateControls(e, v, 'live')}
        ${v && v.mode !== 'off' && v.mode !== 'fan_only' ? limitLine(e, v.temp) : ''}
      </section>`;
    } else if (e.kind === 'vent') {
      const meta = [e.humidity != null ? `Luftfukt ${Math.round(e.humidity)} %` : '', e.temperature != null ? deg(e.temperature) : ''].filter(Boolean).join(' · ');
      h += `<section class="vent ${e.available ? '' : 'unavail'}">
        <div class="section-head"><h2>${esc(e.label)}</h2><span class="meta">${e.available ? meta : 'Svarer ikke'}</span></div>
        ${ventButtons(e, v, 'live')}
        ${v === 'high' && m.boost && m.boost.key === e.key ? `<div class="boost">${svg(UI.clock, 18, 2)}<span>Høy til kl. ${clock(m.boost.until)}, så tilbake til ${VENT_LABEL[m.boost.return_to].toLowerCase()}</span></div>` : ''}
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
  return `<div class="list-row auto-row ${a.enabled ? '' : 'off'}">
    <button class="grow plain" data-act="auto-edit" data-id="${a.id}" data-fid="a-${a.id}" ${m.can_edit ? '' : 'disabled'}>
      ${tag ? `<span class="auto-tag">${esc(tag)}</span>` : ''}
      <span class="t">${esc(title)}</span>
      ${sub ? `<span class="s">${esc(sub)}</span>` : ''}
    </button>
    ${m.can_edit ? `<button class="switch teal" role="switch" aria-checked="${a.enabled}" aria-label="Automasjon på" data-act="auto-toggle" data-id="${a.id}" data-fid="at-${a.id}"></button>` : ''}
  </div>`;
}

function autoGroup(key, title, icon, list, body) {
  const open = S.autoOpen[key] !== false;
  const on = list.filter((a) => a.enabled).length;
  return `<section class="auto-group">
    <button class="auto-head" data-act="auto-group" data-v="${key}" aria-expanded="${open}">
      <span class="row-ic">${svg(icon, 20)}</span>
      <span class="grow"><span class="t">${esc(title)}</span><span class="s">${list.length} automasjon${list.length === 1 ? '' : 'er'}${on < list.length ? ` · ${on} på` : ''}</span></span>
      <span class="chev-s ${open ? 'open' : ''}">${svg(UI.down, 18, 2)}</span>
    </button>
    ${open ? `<div class="list">${body}</div>` : ''}
  </section>`;
}

function autoTab() {
  const m = S.m;
  let h = '';
  if (!m.automations.length) h += `<p class="intro">Automasjoner gjør ting av seg selv – f.eks. «Kos 30 min før solnedgang» eller «Høy ventilasjon når luftfuktigheten er over 70 %».</p>`;
  const extra = (a) => [a.window ? `${a.window.from}–${a.window.to}` : '', autoDays(a.days) !== 'hver dag' ? autoDays(a.days) : '', a.revert_after ? `tilbake etter ${revertLabel(a.revert_after)}` : ''].filter(Boolean).join(' · ');

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
      return x ? { n: Number(x[1]), dir: /up|on/i.test(x[2]) ? '▲' : '▼', how: /hold|long/i.test(x[3]) ? 'Hold' : 'Trykk', key: `${x[1]}${/up|on/i.test(x[2]) ? 0 : 1}${/hold|long/i.test(x[3]) ? 1 : 0}` } : { n: 99, dir: '', how: eventLabel(a.trigger.event), key: `99${a.trigger.event}` };
    };
    const sorted = [...list].sort((a, b) => parse(a).key.localeCompare(parse(b).key));
    let body = '';
    let lastKey = null;
    for (const a of sorted) {
      const p = parse(a);
      const k = `${p.n}${p.dir}`;
      if (p.n !== 99 && k !== lastKey) { body += `<div class="auto-sub">Knapp ${p.n} ${p.dir}</div>`; lastKey = k; }
      body += autoRow(a, autoWhat(a.action), extra(a), p.how);
    }
    h += autoGroup(`btn-${ent}`, entity(ent)?.label || 'Knapp', 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', list, body);
  }

  // 2. Tidspunkter og sol – sortert gjennom døgnet.
  const timed = m.automations.filter((a) => ['time', 'sunset', 'sunrise'].includes(a.trigger.type)).sort((a, b) => autoSortKey(a).localeCompare(autoSortKey(b)));
  if (timed.length) h += autoGroup('time', 'Til faste tider', UI.clock, timed, timed.map((a) => autoRow(a, autoWhat(a.action), extra(a), autoWhen(a.trigger))).join(''));

  // 3. Når noe skjer (lys slås på/av, luftfuktighet).
  const events = m.automations.filter((a) => !['time', 'sunset', 'sunrise', 'button'].includes(a.trigger.type));
  if (events.length) h += autoGroup('event', 'Når noe skjer', 'M13 2L3 14h9l-1 8 10-12h-9l1-8z', events, events.map((a) => autoRow(a, autoWhat(a.action), extra(a), autoWhen(a.trigger))).join(''));

  if (m.can_edit) h += `<button class="btn ghost scene-add" data-act="auto-new" data-fid="a-new">${svg(UI.plus, 18, 2)} Ny automasjon</button>`;
  return h;
}

// ---------- info, strøm og meldinger ----------

const nok = (n) => (n == null ? '–' : n.toLocaleString('nb-NO', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr');
const kwhFmt = (n) => (n == null ? '–' : n.toLocaleString('nb-NO', { maximumFractionDigits: 1 }) + ' kWh');
const dateFmt = (d) => new Date(d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS = { new: ['Mottatt', 'st-new'], in_progress: ['Under arbeid', 'st-work'], done: ['Løst', 'st-done'] };

function infoBadge() {
  const m = S.m;
  return (m.reports || []).some((r) => r.unread) || (m.electricity && m.electricity.remind) || (m.checklists || []).some((c) => c.status === 'open' || c.unread);
}

function infoTab() {
  const m = S.m;
  const unread = (m.reports || []).filter((r) => r.unread).length;
  const cls = m.checklists || [];
  const subs = [['info', 'Info'], ['strom', 'Leie'], ['meld', 'Meldinger']];
  if (cls.length) subs.push(['sjekk', 'Sjekkliste']);
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
  if (openCl) h += `<button class="notice-soft notice-btn" data-act="info-sub" data-v="sjekk"><strong>${esc(openCl.label)}ssjekkliste</strong><span>${openCl.done} av ${openCl.total} punkter – trykk for å fortsette</span></button>`;
  if (i.wifi_ssid) {
    let qr = '';
    try { qr = qrSvg(wifiString(i.wifi_ssid, i.wifi_password), { label: 'QR-kode for wifi' }); } catch {}
    h += `<section class="card info-card wifi">
      <h2>Wifi</h2>
      <div class="wifi-row">
        <div class="wifi-text">
          <span class="field-label">Nettverk</span><span class="big">${esc(i.wifi_ssid)}</span>
          ${i.wifi_password ? `<span class="field-label">Passord</span><span class="big mono-ish">${esc(i.wifi_password)}</span>
          <button class="chip-btn" data-act="copy" data-v="${esc(i.wifi_password)}">Kopier passord</button>` : ''}
        </div>
        ${qr ? `<div class="qr">${qr}<span class="note">Skann med kameraet</span></div>` : ''}
      </div>
    </section>`;
  }
  if (i.contact_name || i.contact_phone || i.contact_email) {
    h += `<section class="card info-card"><h2>Kontakt utleier</h2>
      ${i.contact_name ? `<span class="big">${esc(i.contact_name)}</span>` : ''}
      <div class="contact-btns">
        ${i.contact_phone ? `<a class="btn" href="tel:${esc(i.contact_phone.replace(/\s/g, ''))}">Ring ${esc(i.contact_phone)}</a><a class="btn" href="sms:${esc(i.contact_phone.replace(/\s/g, ''))}">Send SMS</a>` : ''}
        ${i.contact_email ? `<a class="btn" href="mailto:${esc(i.contact_email)}">E-post</a>` : ''}
      </div>
      <button class="btn ghost" data-act="info-sub" data-v="meld" style="margin-top:8px">Send melding til utleier</button>
    </section>`;
  }
  if (i.safety && i.safety.length) {
    h += `<section class="card info-card"><h2>Sikkerhet</h2><div class="safety">${i.safety.map((s) => `<div class="safety-row"><span>${esc(s.name)}</span><span class="pill lvl-${s.level}">${esc(s.text)}</span></div>`).join('')}</div></section>`;
  }
  h += textCard('Søppel og henting', i.garbage) + textCard('Husregler', i.rules) + textCard('Ved nødstilfeller', i.emergency) + textCard('Annet', i.other);
  if (!h) h = `<p class="intro">Utleier har ikke lagt inn informasjon ennå.</p>`;
  return h;
}

function chartHTML(periods) {
  const list = periods.slice(0, 12).reverse();
  if (list.length < 2) return '';
  const max = Math.max(...list.map((p) => p.kwh), 1);
  const w = 100 / list.length;
  const bars = list.map((p, i) => {
    const hgt = Math.max(2, (p.kwh / max) * 100);
    const label = new Date(p.to).toLocaleDateString('nb-NO', { month: 'short' }).replace('.', '');
    return `<g><rect x="${i * w + w * 0.18}" y="${100 - hgt}" width="${w * 0.64}" height="${hgt}" rx="1.5" class="${p.paid ? 'bar-paid' : 'bar'}"><title>${esc(dateFmt(p.from))}–${esc(dateFmt(p.to))}: ${esc(kwhFmt(p.kwh))}</title></rect>
      <text x="${i * w + w / 2}" y="112" text-anchor="middle" class="bar-label">${esc(label)}</text></g>`;
  }).join('');
  return `<section class="card info-card"><h2>Forbruk per periode</h2>
    <svg class="chart" viewBox="0 0 100 116" preserveAspectRatio="none" role="img" aria-label="Strømforbruk per periode">${bars}</svg>
    <span class="note">Høyeste: ${esc(kwhFmt(max))}</span></section>`;
}

const LSTAT = { paid: ['Betalt', 'lvl-ok'], overdue: ['Forfalt', 'lvl-bad'], soon: ['Snart', 'lvl-warn'], upcoming: ['Kommende', ''] };
const longDate = (d) => new Date(d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
const elSum = (r) => r.electricity.reduce((s, p) => s + (p.amount || 0), 0);

function payLines(r) {
  let h = '';
  if (r.rent) h += `<div class="pay-line"><span>Husleie ${esc(r.label.split(' ')[0])}${r.rent_note ? `<small>Avregnet ${esc(r.rent_note)}</small>` : ''}</span><span>${esc(nok(r.rent))}</span></div>`;
  for (const p of r.electricity) h += `<div class="pay-line"><span>Strøm ${esc(dateFmt(p.from))} – ${esc(dateFmt(p.to))}<small>${esc(kwhFmt(p.kwh))}${p.price != null ? ` × ${esc(nok(p.price))}` : ''}</small></span><span>${esc(nok(p.amount))}</span></div>`;
  return h;
}

function contractHTML(c) {
  const rows = [];
  if (c.start) rows.push(['Innflytting', longDate(c.start)]);
  rows.push(['Kontrakt til', c.end ? longDate(c.end) : 'Tidsubestemt']);
  if (c.notice_months) rows.push(['Oppsigelsestid', `${c.notice_months} måned${c.notice_months === 1 ? '' : 'er'}`]);
  if (c.rent) rows.push(['Husleie', `${nok(c.rent)} per måned, forfall den ${c.due_day}.`]);
  if (c.rent && (c.start || c.end)) rows.push(['Delvis måned', 'Avregnes per dag']);
  if (c.deposit) rows.push(['Depositum', `${nok(c.deposit)}${c.deposit_note ? ` – ${c.deposit_note}` : ''}`]);
  if (c.account) rows.push(['Kontonummer', c.account]);
  let h = `<section class="card info-card"><h2>Leieforholdet</h2>`;
  if (c.end && c.days_left != null) {
    const total = c.start ? Math.max(1, c.days_in + c.days_left) : null;
    const pct = total ? Math.min(100, Math.round((c.days_in / total) * 100)) : null;
    h += `<div class="lease-left ${c.days_left <= 90 ? 'warn' : ''}"><span class="big">${c.days_left >= 0 ? `${c.days_left} dager igjen` : 'Kontrakten er utløpt'}</span>
      ${pct != null ? `<div class="progress"><span style="width:${pct}%"></span></div>` : ''}
      ${c.notice_by && c.days_left >= 0 ? `<span class="note">Si fra innen ${esc(longDate(c.notice_by))} om du vil flytte eller forlenge (${c.notice_months} mnd oppsigelse).</span>` : ''}</div>`;
  }
  h += `<div class="kv">${rows.map(([k, v]) => `<div class="kv-row"><span>${esc(k)}</span><span>${esc(v)}${k === 'Kontonummer' ? ` <button class="chip-btn" data-act="copy" data-v="${esc(v.replace(/\s/g, ''))}" data-msg="Kontonummeret er kopiert">Kopier</button>` : ''}</span></div>`).join('')}</div>`;
  if (c.includes) h += `<span class="field-label">Inkludert i leien</span><p class="pre">${esc(c.includes)}</p>`;
  if (c.note) h += `<p class="pre note">${esc(c.note)}</p>`;
  return h + `</section>`;
}

function stromHTML() {
  const e = S.m.electricity;
  const L = S.m.lease;
  const c = L && L.contract;
  let h = '';
  if (L && L.overdue.length) h += `<div class="notice-soft bad">Ikke registrert betalt: ${L.overdue.map((o) => `${esc(o.label)} (${esc(nok(o.total))})`).join(', ')}. Har du betalt, kan utleier markere det.</div>`;
  if (e.remind && !(c && c.auto_meter)) h += `<div class="notice-soft">Det er snart månedsslutt – husk å lese av strømmåleren.</div>`;
  if (L && L.next) {
    const n = L.next;
    const days = Math.round((new Date(n.due) - new Date(new Date().toDateString())) / 86400000);
    h += `<section class="card info-card next-pay"><span class="field-label">Neste betaling · ${esc(longDate(n.due))}${days >= 0 ? ` (${days === 0 ? 'i dag' : `om ${days} dag${days === 1 ? '' : 'er'}`})` : ''}</span>
      <span class="pay-total">${esc(nok(n.total))}</span>
      <div class="pay-lines">${payLines(n)}</div>
      ${c.rent && !n.electricity.length && e.price != null ? `<p class="note">Strøm for siste periode kommer i tillegg når måleren er lest av.</p>` : ''}
      ${c.account ? `<div class="mail-to"><span>Kontonr. <strong>${esc(c.account)}</strong></span><button class="chip-btn" data-act="copy" data-v="${esc(c.account.replace(/\s/g, ''))}" data-msg="Kontonummeret er kopiert">Kopier</button></div>` : ''}
    </section>`;
  }
  if (c && c.auto_meter) {
    h += `<section class="card info-card"><h2>Strømmåler</h2><p class="note">Måleren leses av automatisk siste dag i hver måned.${e.last ? ` Siste avlesning: ${esc(kwhFmt(e.last.value))} den ${esc(dateFmt(e.last.date))}.` : ''}</p>${e.note ? `<p class="note pre">${esc(e.note)}</p>` : ''}</section>`;
  } else {
    h += `<section class="card info-card"><h2>Les av måleren</h2>
      ${e.last ? `<span class="note">${e.last.by === 'landlord' ? 'Startavlesning (lagt inn av utleier)' : 'Forrige'}: ${esc(kwhFmt(e.last.value))} den ${esc(dateFmt(e.last.date))}</span>` : `<span class="note">Første avlesning blir startpunktet.</span>`}
      <div class="reading-form">
        <label class="field"><span class="field-label">Målerstand (kWh)</span><input class="input" type="number" inputmode="decimal" step="0.1" min="0" placeholder="F.eks. 12345" value="${esc(S.reading.value)}" data-field="reading-value"></label>
        <label class="field"><span class="field-label">Dato</span><input class="input" type="date" value="${esc(S.reading.date)}" data-field="reading-date"></label>
      </div>
      <button class="btn primary big" data-act="reading-add">Lagre avlesning</button>
      ${e.last && e.last.deletable ? `<button class="btn ghost" data-act="reading-delete" data-id="${e.last.id}">${S.confirmDelete ? 'Trykk igjen for å slette siste' : 'Slett siste avlesning'}</button>` : ''}
      ${e.note ? `<p class="note pre">${esc(e.note)}</p>` : ''}
    </section>`;
  }
  if (c && (c.start || c.end || c.rent || c.deposit)) h += contractHTML(c);
  if (L && L.ledger.length && c.rent) {
    h += `<section><h2 class="group-title">Betalinger${L.year_total ? ` <span class="gt-count">Betalt i år: ${esc(nok(L.year_total))}</span>` : ''}</h2><div class="list">${L.ledger.map((r) => {
      const [lab, cls] = LSTAT[r.status];
      const el = elSum(r);
      return `<div class="list-row period">
        <span class="grow"><span class="t">${esc(r.label.charAt(0).toUpperCase() + r.label.slice(1))}</span><span class="s">Forfall ${esc(dateFmt(r.due))}${r.rent ? ` · leie ${esc(nok(r.rent))}${r.rent_note ? ' (avregnet)' : ''}` : ''}${el ? ` · strøm ${esc(nok(el))}` : ''}</span></span>
        <span class="amt"><span class="t">${esc(nok(r.total))}</span><span class="pill ${cls}">${lab}</span></span>
      </div>`;
    }).join('')}</div></section>`;
  } else {
    h += `<div class="stat-row">
      <div class="card stat"><span class="field-label">Til betaling</span><span class="big">${esc(nok(e.unpaid))}</span></div>
      <div class="card stat"><span class="field-label">Pris</span><span class="big">${e.price != null ? esc(nok(e.price)) + '<small>/kWh</small>' : 'Ikke satt'}</span></div>
    </div>`;
  }
  h += chartHTML(e.periods);
  if (e.periods.length) {
    h += `<section><h2 class="group-title">Strømforbruk</h2><div class="list">${e.periods.map((p) => `<div class="list-row period">
      <span class="grow"><span class="t">${esc(dateFmt(p.from))} – ${esc(dateFmt(p.to))}</span><span class="s">${esc(kwhFmt(p.kwh))} · ${p.days} dager · ${esc(kwhFmt(p.per_day))}/dag</span></span>
      <span class="amt"><span class="t">${esc(nok(p.amount))}</span>${c && c.rent ? '' : `<span class="pill ${p.paid ? 'lvl-ok' : 'lvl-warn'}">${p.paid ? 'Betalt' : 'Ikke betalt'}</span>`}</span>
    </div>`).join('')}</div></section>`;
  }
  return h;
}

const photoThumbs = (ids, rm = null) => (ids && ids.length ? `<div class="thumbs">${ids.map((id) => `<span class="thumb-w"><button class="thumb" data-act="photo-view" data-id="${id}" aria-label="Vis bilde"><img src="api/photo/${id}" alt="" loading="lazy"></button>${rm ? `<button class="thumb-x" data-act="${rm.act}" data-photo="${id}" ${rm.attrs} aria-label="Fjern bilde">×</button>` : ''}</span>`).join('')}</div>` : '');

function pushCardHTML(where) {
  const P = S.push;
  const m = S.m;
  if (!m.push || !m.push.key) return '';
  const on = P.sub && P.permission === 'granted';
  if (where === 'meld' && on) return '';
  let body;
  if (on) {
    body = `<p class="note">Varsler er på for denne enheten. Du får beskjed når utleier sender en melding eller svarer deg.</p>
      <div class="contact-btns"><button class="btn" data-act="push-test" ${P.busy ? 'disabled' : ''}>Send testvarsel</button><button class="btn ghost" data-act="push-off" ${P.busy ? 'disabled' : ''}>Slå av</button></div>`;
  } else if (P.ios && !P.standalone) {
    body = `<p class="note">På iPhone må appen ligge på Hjem-skjermen for å kunne gi varsler:</p>
      <ol class="steps"><li>Trykk på <strong>Del</strong>-knappen i Safari</li><li>Velg <strong>Legg til på Hjem-skjerm</strong></li><li>Åpne Hybel fra Hjem-skjermen og slå på varsler her</li></ol>`;
  } else if (!P.supported) {
    body = `<p class="note">Denne nettleseren støtter ikke varsler. Prøv Chrome eller Safari, eller legg appen på Hjem-skjermen.</p>`;
  } else if (P.permission === 'denied') {
    body = `<p class="note">Varsler er blokkert for denne siden. Slå dem på i innstillingene til nettleseren/telefonen, og prøv igjen.</p>`;
  } else {
    body = `<p class="note">Få beskjed på telefonen når utleier svarer eller sender deg en melding.</p>
      <button class="btn primary big" data-act="push-on" ${P.busy ? 'disabled' : ''}>${P.busy ? 'Slår på …' : 'Slå på varsler'}</button>`;
  }
  return `<section class="card info-card push-card"><h2>Varsler</h2>${body}</section>`;
}

function meldHTML() {
  const m = S.m;
  const f = S.report;
  let h = pushCardHTML('meld');
  h += `<section class="card info-card"><h2>Ny melding til utleier</h2>
    <span class="field-label">Hva gjelder det?</span>
    <div class="chips">${m.report_categories.map((c) => `<button class="chip" aria-pressed="${f.category === c}" data-act="report-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <label class="field"><span class="field-label">Beskriv problemet</span><textarea class="input area" rows="4" maxlength="2000" placeholder="F.eks. vasken på badet renner sakte unna" data-field="report-text">${esc(f.text)}</textarea></label>
    ${photoThumbs(f.photos, { act: 'report-photo-rm', attrs: '' })}
    ${f.photos.length < 3 ? `<button class="chip-btn add-photo" data-act="report-photo" ${S.uploading === 'report' ? 'disabled' : ''}>${S.uploading === 'report' ? 'Laster opp …' : '+ Legg ved bilde'}</button>` : ''}
    <div class="row between"><span class="status">Haster</span><button class="switch" role="switch" aria-checked="${f.urgent}" aria-label="Haster" data-act="report-urgent"></button></div>
    <button class="btn primary big" data-act="report-send" ${S.uploading ? 'disabled' : ''}>Send til utleier</button>
  </section>`;
  if (m.reports.length) {
    h += `<section><h2 class="group-title">Meldinger</h2>`;
    for (const r of m.reports) {
      const mine = r.origin !== 'landlord';
      const [label, cls] = STATUS[r.status] || ['Fra utleier', 'st-info'];
      h += `<article class="card report ${r.unread ? 'unread' : ''} ${mine ? '' : 'from-landlord'}">
        <div class="row between"><span class="t">${mine ? esc(r.category) : 'Fra utleier'}${r.urgent ? ' · <span class="urgent">haster</span>' : ''}</span>${mine ? `<span class="pill ${cls}">${label}</span>` : ''}</div>
        <span class="note">${esc(dateFmt(r.created))}</span>
        <p class="pre">${esc(r.text)}</p>
        ${photoThumbs(r.photos)}
        ${r.updates.length ? `<div class="thread">${r.updates.map((u) => `<div class="msg ${u.from} ${u.status ? 'sys' : ''}"><span>${esc(u.text)}</span><small>${u.from === 'landlord' ? 'Utleier' : 'Deg'} · ${esc(dateFmt(u.at))}</small></div>`).join('')}</div>` : ''}
        ${r.status !== 'done' ? `<div class="reply"><textarea class="input area" rows="2" maxlength="1000" placeholder="Skriv et svar …" data-field="reply" data-id="${r.id}">${esc(S.reply[r.id] || '')}</textarea><button class="chip-btn" data-act="report-reply" data-id="${r.id}">Send</button></div>` : ''}
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
  let h = all.length > 1 ? `<div class="chips cl-pick">${all.map((x) => `<button class="chip" aria-pressed="${x.id === c.id}" data-act="cl-sel" data-id="${x.id}">${esc(x.label)} · ${esc(dateFmt(x.created))}</button>`).join('')}</div>` : '';
  h += `<section class="card info-card cl-top"><h2>${esc(c.label)}ssjekkliste</h2>`;
  if (editable) {
    h += `<p class="note">Gå gjennom hybelen og trykk <strong>OK</strong> når noe er i orden, eller <strong>Merknad</strong> hvis du ser riper, flekker, skader eller noe som ikke virker. Ta gjerne bilder – det gjør det enklere for begge senere.</p>
      <div class="progress"><span style="width:${pct}%"></span></div><span class="note">${c.done} av ${c.total} punkter</span>`;
  } else {
    h += `<p class="note">${c.status === 'approved' ? `Godkjent av utleier ${esc(dateFmt(c.approved_at))}.` : `Sendt inn ${esc(dateFmt(c.submitted_at))}. Utleier går gjennom den.`}</p>
      ${c.landlord_comment ? `<div class="msg landlord"><span>${esc(c.landlord_comment)}</span><small>Utleier</small></div>` : ''}`;
  }
  h += `</section>`;
  if (!editable) h += mailCardHTML(c);
  rooms.forEach((room) => {
    const rows = c.rows.map((r, i) => ({ ...r, i })).filter((r) => r.room === room);
    const done = rows.filter((r) => r.status).length;
    h += `<section><h2 class="group-title">${esc(room)} <span class="gt-count">${done}/${rows.length}</span></h2><div class="card cl-list">`;
    for (const r of rows) {
      const key = `${c.id}-${r.i}`;
      h += `<div class="cl-row ${r.status || ''}">
        <div class="cl-line"><span class="t">${esc(r.item)}</span>
          ${editable ? `<span class="cl-btns">
            <button class="cl-b ok" aria-pressed="${r.status === 'ok'}" data-act="cl-status" data-id="${c.id}" data-i="${r.i}" data-v="ok">OK</button>
            <button class="cl-b note" aria-pressed="${r.status === 'note'}" data-act="cl-status" data-id="${c.id}" data-i="${r.i}" data-v="note">Merknad</button></span>`
            : `<span class="pill ${r.status === 'ok' ? 'st-done' : r.status === 'note' ? 'st-new' : ''}">${r.status === 'ok' ? 'OK' : r.status === 'note' ? 'Merknad' : '–'}</span>`}
        </div>
        ${r.status === 'note' ? (editable
          ? `<textarea class="input area" rows="2" maxlength="1000" placeholder="Hva ser du? F.eks. ripe i gulvet ved døra" data-field="cl-note" data-id="${c.id}" data-i="${r.i}">${esc(r.note)}</textarea>
             ${photoThumbs(r.photos, { act: 'cl-photo-rm', attrs: `data-id="${c.id}" data-i="${r.i}"` })}
             ${r.photos.length < 4 ? `<button class="chip-btn add-photo" data-act="cl-photo" data-id="${c.id}" data-i="${r.i}" ${S.uploading ? 'disabled' : ''}>${S.uploading === key ? 'Laster opp …' : '+ Ta bilde'}</button>` : ''}`
          : `${r.note ? `<p class="pre note">${esc(r.note)}</p>` : ''}${photoThumbs(r.photos)}`) : ''}
      </div>`;
    }
    h += `</div></section>`;
  });
  if (editable) {
    const missing = c.total - c.done;
    h += `<section class="card info-card">
      <label class="field"><span class="field-label">Annet du vil nevne (valgfritt)</span><textarea class="input area" rows="3" maxlength="2000" placeholder="F.eks. antall nøkler, ting som mangler" data-field="cl-comment" data-id="${c.id}">${esc(c.comment)}</textarea></label>
      <button class="btn primary big" data-act="cl-submit" data-id="${c.id}" ${missing ? 'disabled' : ''}>${missing ? `${missing} punkt${missing === 1 ? '' : 'er'} gjenstår` : S.confirmDelete ? 'Trykk igjen for å sende' : 'Send til utleier'}</button>
      <p class="note">Når listen er sendt kan den ikke endres. Utleier får beskjed og kan åpne den igjen ved behov.</p>
    </section>`;
  } else if (c.comment) {
    h += textCard('Din kommentar', c.comment);
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
  return `<section class="card info-card mail-card"><h2>Send kopi på e-post</h2>
    <p class="note">Send sjekklisten som PDF fra din egen e-post${email ? ' til utleier' : ''}. Da har dere begge en datert kopi med alle merknader og bilder.</p>
    ${email ? `<div class="mail-to"><span>Til: <strong>${esc(email)}</strong></span><button class="chip-btn" data-act="copy" data-v="${esc(email)}" data-msg="E-postadressen er kopiert">Kopier</button></div>` : ''}
    <button class="btn primary big" data-act="cl-mail" data-id="${c.id}" ${ready ? '' : 'disabled'}>${ready ? 'Send PDF på e-post' : 'Lager PDF …'}</button>
    <a class="btn ghost" href="api/checklist/${c.id}.pdf" download="${esc(pdfName(c))}">Last ned PDF</a>
  </section>`;
}

function mailChecklist(c) {
  const email = S.m.info.contact_email || '';
  const file = S.pdf && S.pdf.file;
  if (!file) return;
  const subject = `${c.label}ssjekkliste ${dateFmt(c.submitted_at || c.created)}`;
  const body = `Hei!\n\nVedlagt er ${c.label.toLowerCase()}ssjekklisten for hybelen, sendt inn i appen ${dateFmt(c.submitted_at || c.created)}.\n`;
  // Mobil: del filen direkte til e-postappen.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: subject, text: body })
      .then(() => showToast('Delt'), (err) => { if (err && err.name !== 'AbortError') showToast('Kunne ikke dele filen', true); });
    if (email) showToast(`Velg e-post og send til ${email}`);
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
    location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n(Legg ved PDF-filen som nettopp ble lastet ned.)')}`;
  }, 400);
  showToast('PDF lastet ned – legg den ved i e-posten');
}

function photoViewHTML() {
  return S.photo ? `<div class="lightbox" data-act="photo-close"><img src="api/photo/${S.photo}" alt="Bilde"></div>` : '';
}

function tabsHTML() {
  const list = tabs();
  if (!list.some((t) => t.id === S.tab)) S.tab = list[0].id;
  const t = TABS.find((x) => x.id === S.tab);
  const title = t.label;
  let body = '';
  if (!S.m.entities.length) body = `<section class="card section"><p class="intro" style="padding:18px 0">Ingen enheter er satt opp ennå. Ta kontakt med utleier.</p></section>`;
  else if (S.tab === 'scener') body = scenesTab();
  else if (S.tab === 'lys') body = lightsTab();
  else if (S.tab === 'klima') body = climateTab();
  else if (S.tab === 'info') body = infoTab();
  else body = autoTab();
  if (S.tab === 'info' && !S.m.entities.length) body = infoTab();
  return topHTML(title) + toastHTML() + body + navHTML() + photoViewHTML();
}

// ---------- innstillinger og redigering ----------

function settingsHTML() {
  const m = S.m;
  let html = subHTML('Hybelen', 'Innstillinger') + toastHTML();
  html += pushCardHTML('settings');

  html += `<section><h2 class="group-title">Rekkefølge – enheter</h2><div class="list">`;
  m.entities.filter((e) => e.kind !== 'button').forEach((e, i, arr) => {
    const kind = e.kind === 'light' ? 'Lys' : e.kind === 'heat' ? 'Varme' : e.kind === 'vent' ? 'Ventilasjon' : 'Varmepumpe';
    html += `<div class="list-row order-row"><span class="grow"><span class="t">${esc(e.label)}</span><span class="s">${kind}</span></span>
      <button class="tool-btn" data-act="ent-move" data-key="${e.key}" data-dir="-1" aria-label="Flytt ${esc(e.label)} opp" ${i === 0 ? 'disabled' : ''}>${svg(UI.up, 18, 2)}</button>
      <button class="tool-btn" data-act="ent-move" data-key="${e.key}" data-dir="1" aria-label="Flytt ${esc(e.label)} ned" ${i === arr.length - 1 ? 'disabled' : ''}>${svg(UI.down, 18, 2)}</button></div>`;
  });
  html += `</div></section>`;

  if (m.scenes.length > 1) {
    html += `<section><h2 class="group-title">Rekkefølge – scener</h2><div class="list">`;
    m.scenes.forEach((s, i) => {
      html += `<div class="list-row order-row"><span class="row-ic">${svg(ICON[s.icon] || ICON.star, 20)}</span><span class="grow"><span class="t">${esc(s.name)}</span></span>
        <button class="tool-btn" data-act="scene-move" data-id="${s.id}" data-dir="-1" aria-label="Flytt ${esc(s.name)} opp" ${i === 0 ? 'disabled' : ''}>${svg(UI.up, 18, 2)}</button>
        <button class="tool-btn" data-act="scene-move" data-id="${s.id}" data-dir="1" aria-label="Flytt ${esc(s.name)} ned" ${i === m.scenes.length - 1 ? 'disabled' : ''}>${svg(UI.down, 18, 2)}</button></div>`;
    });
    html += `</div></section>`;
  }

  const hasVent = m.entities.some((e) => e.kind === 'vent');
  if (hasVent && m.boost_options.length) {
    html += `<section><h2 class="group-title">Høy ventilasjon</h2><div class="card" style="border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:12px">
      <span style="font-size:15px">Går tilbake av seg selv etter</span>
      <div class="seg" style="grid-template-columns: repeat(${m.boost_options.length}, minmax(0, 1fr))">
      ${m.boost_options.map((o) => `<button aria-pressed="${m.prefs.boost_minutes === o}" data-act="boost" data-min="${o}" data-fid="b-${o}">${o} min</button>`).join('')}</div>
    </div></section>`;
  }

  html += `<section><h2 class="group-title">Grenser satt av utleier</h2><div class="list soft">`;
  for (const e of m.entities.filter((x) => x.kind === 'heat' || x.kind === 'climate')) {
    html += `<div class="list-row"><span class="t" style="font-weight:500">${esc(e.label)}</span><span class="t">${e.min}–${e.max}°</span></div>`;
  }
  if (hasVent) {
    html += `<div class="list-row"><span class="t" style="font-weight:500">Høy ventilasjon</span><span class="t">Maks ${m.limits.boost_max_minutes} min</span></div>`;
    html += `<div class="list-row"><span class="t" style="font-weight:500">Bortemodus på ventilasjon</span><span class="t">${m.limits.vent_allow_away ? 'Tillatt' : 'Ikke tillatt'}</span></div>`;
  }
  html += `</div><p class="note" style="margin-top:8px">Grensene beskytter gulv, fukt og inneklima. Ta kontakt med utleier hvis noe ikke passer.</p></section>`;
  return html;
}

// Velg enheter og verdier – brukes både av scener og automasjoner.
function pickerHTML(t) {
  let html = '';
  for (const e of S.m.entities.filter((x) => x.kind !== 'button')) {
    const inc = t.include[e.key];
    const v = t.values[e.key];
    let ctl = '';
    if (inc) {
      if (e.kind === 'light') ctl = lightRow(e, v ?? 0, 'draft');
      else if (e.kind === 'heat') ctl = `<div class="draft-heat"><span class="status">Temperatur</span>${stepper(e, v, 'draft')}</div>`;
      else if (e.kind === 'vent') ctl = ventButtons(e, v, 'draft');
      else ctl = climateControls(e, v, 'draft');
    }
    const kind = e.kind === 'light' ? 'Lys' : e.kind === 'heat' ? 'Varme' : e.kind === 'vent' ? 'Ventilasjon' : 'Varmepumpe';
    html += `<section class="card pick ${inc ? 'on' : ''}">
      <div class="row">
        <span><span class="name">${esc(e.label)}</span><span class="status">${kind}${inc ? '' : ' · ikke med'}</span></span>
        <button class="check" role="checkbox" aria-checked="${!!inc}" aria-label="Ta med ${esc(e.label)}" data-act="include" data-key="${e.key}" data-fid="inc-${e.key}">${inc ? svg(UI.check, 18, 2.6) : ''}</button>
      </div>
      ${inc ? `<div class="pick-ctl">${ctl}</div>` : ''}
    </section>`;
  }
  return html;
}

function sceneEditorHTML() {
  const m = S.m;
  const d = S.draft;
  let html = subHTML(d.id ? 'Rediger scene' : 'Ny scene', d.name || 'Uten navn') + toastHTML();
  html += `<section class="card form">
    <label class="field-label" for="scene-name">Navn</label>
    <input id="scene-name" class="input" type="text" maxlength="30" placeholder="F.eks. Matlaging" value="${esc(d.name)}" data-field="scene-name" autocomplete="off">
    <span class="field-label">Ikon</span>
    <div class="icons">${m.icons.map((i) => `<button class="icon-pick" aria-pressed="${d.icon === i}" aria-label="Ikon ${i}" data-act="icon" data-icon="${i}">${svg(ICON[i], 20)}</button>`).join('')}</div>
  </section>`;
  html += `<p class="intro">Velg hva scenen skal styre. Det du ikke tar med, blir som det er.</p>`;
  html += pickerHTML(d);
  html += `<button class="btn ghost big" data-act="from-now" style="width:100%">Hent det som er på nå</button>`;
  html += `<div class="actions">
    ${d.id ? `<button class="btn ghost big danger-text" data-act="scene-delete">${S.confirmDelete ? 'Trykk igjen for å slette' : 'Slett'}</button>` : ''}
    <button class="btn primary big" data-act="scene-save" data-fid="scene-save">Lagre</button>
  </div>`;
  return html;
}

function autoEditorHTML() {
  const m = S.m;
  const a = S.adraft;
  const t = a.trigger;
  const lights = m.entities.filter((e) => e.kind === 'light');
  const vents = m.entities.filter((e) => e.kind === 'vent' && e.humidity != null);
  const types = [['time', 'Klokke'], ['sunset', 'Sol ned'], ['sunrise', 'Sol opp']];
  if (lights.length) types.push(['light', 'Lys']);
  if (vents.length) types.push(['humidity', 'Fukt']);
  const buttons = m.entities.filter((e) => e.kind === 'button' && e.events.length);
  if (buttons.length) types.push(['button', 'Knapp']);
  let html = subHTML(a.id ? 'Rediger automasjon' : 'Ny automasjon', 'Automasjon') + toastHTML();

  html += `<section class="card form"><span class="field-label">Når</span>
    <div class="seg" style="grid-template-columns: repeat(${types.length}, minmax(0, 1fr))">
      ${types.map(([k, l]) => `<button aria-pressed="${t.type === k}" data-act="trig" data-v="${k}">${l}</button>`).join('')}
    </div>`;
  if (t.type === 'time') {
    html += `<input class="input time" type="time" value="${esc(t.at)}" data-field="auto-time" aria-label="Klokkeslett">`;
  } else if (t.type === 'sunset' || t.type === 'sunrise') {
    const sunTime = t.type === 'sunset' ? m.sun.sunset : m.sun.sunrise;
    html += `<div class="seg offsets">${[[-60, '1 t før'], [-30, '30 min før'], [0, 'Akkurat'], [30, '30 min etter'], [60, '1 t etter']].map(([o, l]) => `<button aria-pressed="${(t.offset || 0) === o}" data-act="offset" data-v="${o}">${l}</button>`).join('')}</div>
      ${sunTime ? `<span class="note">${t.type === 'sunset' ? 'Solnedgang' : 'Soloppgang'} i dag: kl. ${clock(sunTime)}</span>` : ''}`;
  } else if (t.type === 'light') {
    html += `<div class="chips">${lights.map((e) => `<button class="chip" aria-pressed="${t.entity === e.key}" data-act="trig-entity" data-key="${e.key}">${esc(e.label)}</button>`).join('')}</div>
      <div class="seg" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
        <button aria-pressed="${t.to === 'on'}" data-act="trig-to" data-v="on">slås på</button>
        <button aria-pressed="${t.to === 'off'}" data-act="trig-to" data-v="off">slås av</button>
      </div>`;
  } else if (t.type === 'humidity') {
    html += `<div class="row between"><span class="status">Luftfuktighet over</span><span class="stepper">
        <button data-act="hum" data-dir="-5" aria-label="Senk" ${t.above <= 30 ? 'disabled' : ''}>−</button><output>${t.above} %</output>
        <button data-act="hum" data-dir="5" aria-label="Øk" ${t.above >= 95 ? 'disabled' : ''}>+</button></span></div>
      ${vents[0]?.humidity != null ? `<span class="note">Nå: ${Math.round(vents[0].humidity)} %</span>` : ''}`;
  }
  if (t.type === 'button') {
    const be = entity(t.entity) || buttons[0];
    if (buttons.length > 1) html += `<div class="chips">${buttons.map((e) => `<button class="chip" aria-pressed="${t.entity === e.key}" data-act="trig-entity" data-key="${e.key}">${esc(e.label)}</button>`).join('')}</div>`;
    html += `<span class="note">Velg trykket som skal starte automasjonen:</span><div class="btn-events">${be.events.map((ev) => `<button class="chip" aria-pressed="${t.event === ev}" data-act="trig-event" data-v="${esc(ev)}">${esc(eventLabel(ev))}</button>`).join('')}</div>`;
  }
  if (t.type === 'light' || t.type === 'humidity' || t.type === 'button') {
    html += `<div class="row between"><span class="status">Bare i et tidsrom</span>
        <button class="switch teal" role="switch" aria-checked="${!!a.window}" aria-label="Bare i et tidsrom" data-act="window"></button></div>
      ${a.window ? `<div class="window"><input class="input time sm" type="time" value="${esc(a.window.from)}" data-field="win-from" aria-label="Fra"><span>til</span><input class="input time sm" type="time" value="${esc(a.window.to)}" data-field="win-to" aria-label="Til"></div>` : ''}`;
  }
  html += `<span class="field-label">Dager</span>
    <div class="days">${DAYS.map((dn, i) => `<button class="day" aria-pressed="${a.days.includes(i + 1)}" data-act="day" data-v="${i + 1}">${dn}</button>`).join('')}</div>
    <div class="quick">
      <button class="chip-btn" data-act="days" data-v="1,2,3,4,5,6,7">Hver dag</button>
      <button class="chip-btn" data-act="days" data-v="1,2,3,4,5">Hverdager</button>
      <button class="chip-btn" data-act="days" data-v="6,7">Helg</button>
    </div>
  </section>`;

  const act = a.action;
  html += `<section><h2 class="group-title">Gjør dette</h2><div class="list">`;
  for (const s of m.scenes) {
    html += `<button class="list-row" role="radio" aria-checked="${act.type === 'scene' && act.scene_id === s.id}" data-act="action" data-type="scene" data-id="${s.id}">
      <span class="row-ic">${svg(ICON[s.icon] || ICON.star, 20)}</span><span class="grow"><span class="t">${esc(s.name)}</span><span class="s">${esc(valuesSummary(s.values))}</span></span><span class="radio"></span></button>`;
  }
  html += `<button class="list-row" role="radio" aria-checked="${act.type === 'lights_off'}" data-act="action" data-type="lights_off">
      <span class="row-ic">${svg(UI.bulb, 20)}</span><span class="grow"><span class="t">Slå av alle lys</span></span><span class="radio"></span></button>
    ${lights.some((e) => e.dimmable) ? `<button class="list-row" role="radio" aria-checked="${act.type === 'dim'}" data-act="action" data-type="dim">
      <span class="row-ic">${svg('M12 3v18M5 10l7-7 7 7M5 14l7 7 7-7', 20)}</span><span class="grow"><span class="t">Dim lys</span><span class="s">Lysere eller mørkere – fortsetter så lenge knappen holdes</span></span><span class="radio"></span></button>` : ''}
    <button class="list-row" role="radio" aria-checked="${act.type === 'set'}" data-act="action" data-type="set">
      <span class="row-ic">${svg(UI.spark, 20)}</span><span class="grow"><span class="t">Velg enheter selv</span><span class="s">Lys, varme, luft – akkurat det du vil</span></span><span class="radio"></span></button>`;
  html += `</div></section>`;
  if (act.type === 'set') html += pickerHTML(a.set);
  if (act.type === 'dim') {
    html += `<section class="card form"><span class="field-label">Hvilke lys</span>
      <div class="chips">${lights.filter((e) => e.dimmable).map((e) => `<button class="chip" aria-pressed="${(act.entities || []).includes(e.key)}" data-act="dim-light" data-key="${e.key}">${esc(e.label)}</button>`).join('')}</div>
      <span class="field-label">Retning</span>
      <div class="seg" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
        <button aria-pressed="${act.dir === 'up'}" data-act="dim-dir" data-v="up">Lysere</button>
        <button aria-pressed="${act.dir === 'down'}" data-act="dim-dir" data-v="down">Mørkere</button>
      </div>
      <span class="field-label">Trinn</span>
      <div class="seg" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
        ${[5, 10, 20].map((n) => `<button aria-pressed="${act.step === n}" data-act="dim-step" data-v="${n}">${n} %</button>`).join('')}
      </div>
      ${t.type === 'button' && /hold|long/i.test(t.event || '') ? '<span class="note">Dimmer videre så lenge knappen holdes inne.</span>' : '<span class="note">Tips: koble til «hold» på en knapp, så dimmer den så lenge du holder.</span>'}
    </section>`;
  }

  html += `<section class="card form"><span class="field-label">Gjør om etter</span>
    <div class="seg" style="grid-template-columns: repeat(4, minmax(0, 1fr))">
      ${m.revert_options.map((o) => `<button aria-pressed="${a.revert_after === o}" data-act="revert" data-v="${o}">${revertLabel(o)}</button>`).join('')}
    </div>
    <span class="note">Setter enhetene tilbake slik de var før automasjonen kjørte.</span>
  </section>`;

  html += `<div class="actions">
    ${a.id ? `<button class="btn ghost big danger-text" data-act="auto-delete">${S.confirmDelete ? 'Trykk igjen' : 'Slett'}</button>` : ''}
    ${a.id ? `<button class="btn ghost big" data-act="auto-run">Test nå</button>` : ''}
    <button class="btn primary big" data-act="auto-save">Lagre</button>
  </div>`;
  return html;
}

function reloginHTML() {
  return `<div class="loading"><p>Fikk ikke kontakt. Du kan være logget ut, eller forbindelsen ble brutt.</p>
    <button class="btn primary big relogin" data-act="relogin">Logg inn på nytt</button></div>`;
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
    $app.innerHTML = `<div class="loading"><p>Noe gikk galt ved visning av siden.</p><p class="note">${esc(err.message)}</p>
      <button class="btn primary big relogin" data-act="relogin">Last inn på nytt</button></div>`;
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
  if (!['scene-delete', 'auto-delete', 'reading-delete', 'cl-status', 'cl-submit'].includes(a)) S.confirmDelete = false;
  if (a === 'cl-status' && S.confirmDelete && S.confirmDelete !== `${ds.id}-${ds.i}`) S.confirmDelete = false;
  switch (a) {
    case 'relogin':
      location.reload();
      return;
    case 'photo-view': S.photo = ds.id; return render();
    case 'photo-close': S.photo = null; return render();
    case 'push-on': return pushOn();
    case 'push-off': return pushOff();
    case 'push-test':
      if (!S.push.sub) return;
      S.push.busy = true; render();
      cmd({ type: 'push_test', endpoint: S.push.sub.endpoint }).then((r) => { S.push.busy = false; if (r.ok) showToast('Testvarsel sendt'); render(); });
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
        if (!S.confirmDelete) { S.confirmDelete = `${ds.id}-${ds.i}`; showToast('Trykk OK igjen for å fjerne merknaden'); return; }
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
    case 'cl-sel': S.clSel = ds.id; window.scrollTo(0, 0); return render();
    case 'cl-mail': {
      const c = (m.checklists || []).find((x) => x.id === ds.id);
      if (c) mailChecklist(c);
      return;
    }
    case 'cl-submit':
      if (!S.confirmDelete) { S.confirmDelete = 'submit'; return render(); }
      S.confirmDelete = false;
      cmd({ type: 'checklist_submit', id: ds.id }).then((r) => { if (r.ok) { showToast('Sendt! Send gjerne en kopi på e-post.'); window.scrollTo(0, 0); } });
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
      try { navigator.clipboard.writeText(ds.v).then(() => showToast(ds.msg || 'Passordet er kopiert'), () => showToast('Kunne ikke kopiere', true)); } catch { showToast('Kunne ikke kopiere', true); }
      return;
    case 'report-cat':
      S.report.category = ds.v;
      return render();
    case 'report-urgent':
      S.report.urgent = !S.report.urgent;
      return render();
    case 'report-send': {
      const f = S.report;
      if (!f.category) return showToast('Velg hva det gjelder', true);
      cmd({ type: 'report_create', category: f.category, text: f.text, urgent: f.urgent, photos: f.photos }).then((r) => {
        if (!r.ok) return;
        S.report = { category: null, text: '', urgent: false, photos: [] };
        showToast('Meldingen er sendt til utleier');
      });
      return;
    }
    case 'report-reply': {
      const text = (S.reply[ds.id] || '').trim();
      if (!text) return;
      cmd({ type: 'report_reply', id: ds.id, text }).then((r) => { if (r.ok) { S.reply[ds.id] = ''; showToast('Svaret er sendt'); } });
      return;
    }
    case 'reading-add':
      cmd({ type: 'reading_add', date: S.reading.date, value: S.reading.value }).then((r) => {
        if (!r.ok) return;
        S.reading = { date: new Date().toISOString().slice(0, 10), value: '' };
        showToast('Avlesningen er lagret');
      });
      return;
    case 'reading-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      S.confirmDelete = false;
      cmd({ type: 'reading_delete', id: ds.id }).then((r) => r.ok && showToast('Siste avlesning er slettet'));
      return;

    case 'tab':
      S.tab = ds.id;
      store.set('hybel-tab', ds.id);
      window.scrollTo(0, 0);
      return render();
    case 'settings':
      return go('settings');
    case 'back':
      if (S.view === 'scene') { S.draft = null; return go(S.tab === 'scener' ? 'tabs' : 'settings'); }
      if (S.view === 'auto') S.adraft = null;
      return go('tabs');
    case 'scene': {
      const s = sceneById(ds.id);
      if (!s) return;
      for (const [key, v] of Object.entries(s.values)) setPending(key, v);
      for (const x of m.scenes) x.active = x.id === s.id;
      render();
      cmd({ type: 'scene', id: s.id }).then((r) => r.ok && showToast(`${s.name} er satt`));
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
      showToast('Hentet verdiene som er på nå');
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
        showToast(`${d.name.trim()} er lagret`);
      });
      return;
    }
    case 'scene-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      cmd({ type: 'scene_delete', id: S.draft.id }).then((r) => { if (r.ok) { S.draft = null; go('tabs'); showToast('Scenen er slettet'); } });
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
        showToast('Automasjonen er lagret');
      });
      return;
    }
    case 'auto-run':
      cmd({ type: 'auto_run', id: S.adraft.id }).then((r) => r.ok && showToast('Automasjonen kjørte'));
      return;
    case 'auto-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      cmd({ type: 'auto_delete', id: S.adraft.id }).then((r) => { if (r.ok) { S.adraft = null; go('tabs'); showToast('Automasjonen er slettet'); } });
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
  if (f === 'reading-date') { S.reading.date = t.value; return; }
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
  if (st) st.textContent = `På · ${v} %`;
});

$app.addEventListener('change', (ev) => {
  const t = ev.target;
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
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Kunne ikke lese bildet'))), 'image/jpeg', 0.82));
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
      const j = await r.json().catch(() => ({ ok: false, error: 'Uventet svar' }));
      if (!j.ok) throw new Error(j.error || 'Opplasting feilet');
      await done(j.id);
    } catch (err) {
      showToast(err.message || 'Kunne ikke laste opp bildet', true);
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
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Varsler ble blokkert' : 'Varsler ble ikke slått på');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) { try { await sub.unsubscribe(); } catch {} }
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(S.m.push.key) });
    const device = P.ios ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'Nettleser';
    const r = await cmd({ type: 'push_subscribe', subscription: sub.toJSON(), device });
    if (!r.ok) throw new Error(r.error || 'Kunne ikke lagre');
    P.sub = sub;
    showToast('Varsler er slått på');
  } catch (err) {
    showToast(err.message || 'Kunne ikke slå på varsler', true);
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
  showToast('Varsler er slått av');
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
