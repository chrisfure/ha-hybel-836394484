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
  tab: store.get('hybel-tab') || 'scener',
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
  infoSub: 'info',      // info | strom | meld
  report: { category: null, text: '', urgent: false },
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
  { id: 'scener', label: 'Scener', icon: ICON.star },
  { id: 'lys', label: 'Lys', icon: UI.bulb },
  { id: 'klima', label: 'Klima', icon: UI.flame },
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
    S.m = JSON.parse(e.data);
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
  let h = `<div class="scene-grid">`;
  for (const s of m.scenes) {
    h += `<div class="scene-card ${s.active ? 'active' : ''}">
      <button class="scene-main" data-act="scene" data-id="${s.id}" data-fid="s-${s.id}" aria-pressed="${s.active}">
        <span class="ic">${svg(ICON[s.icon] || ICON.star, 22)}</span>
        <span class="name">${esc(s.name)}</span>
        <span class="sum">${esc(valuesSummary(s.values))}</span>
      </button>
      ${m.can_edit ? `<button class="scene-edit" data-act="scene-edit" data-id="${s.id}" aria-label="Rediger ${esc(s.name)}">${svg(UI.pencil, 16, 2)}</button>` : ''}
    </div>`;
  }
  if (m.can_edit) h += `<button class="scene-card add" data-act="scene-new" data-fid="s-new">${svg(UI.plus, 24, 2)}<span class="name">Ny scene</span></button>`;
  h += `</div>`;
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

function autoTab() {
  const m = S.m;
  let h = '';
  if (!m.automations.length) h += `<p class="intro">Automasjoner gjør ting av seg selv – f.eks. «Kos 30 min før solnedgang» eller «Høy ventilasjon når luftfuktigheten er over 70 %».</p>`;
  h += `<div class="list">`;
  for (const a of m.automations) {
    h += `<div class="list-row auto-row">
      <button class="grow plain" data-act="auto-edit" data-id="${a.id}" data-fid="a-${a.id}" ${m.can_edit ? '' : 'disabled'}>
        <span class="t">${esc(autoWhat(a.action))}</span>
        <span class="s">${esc(autoWhen(a.trigger, a.window))} · ${esc(autoDays(a.days))}${a.revert_after ? ` · tilbake etter ${revertLabel(a.revert_after)}` : ''}</span>
      </button>
      ${m.can_edit ? `<button class="switch teal" role="switch" aria-checked="${a.enabled}" aria-label="Automasjon på" data-act="auto-toggle" data-id="${a.id}" data-fid="at-${a.id}"></button>` : ''}
    </div>`;
  }
  if (m.can_edit) h += `<button class="list-row add-row" data-act="auto-new" data-fid="a-new">${svg(UI.plus, 20, 2)}<span class="t">Ny automasjon</span></button>`;
  return h + `</div>`;
}


// ---------- info, strøm og meldinger ----------

const nok = (n) => (n == null ? '–' : n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr');
const kwhFmt = (n) => (n == null ? '–' : n.toLocaleString('nb-NO', { maximumFractionDigits: 1 }) + ' kWh');
const dateFmt = (d) => new Date(d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS = { new: ['Mottatt', 'st-new'], in_progress: ['Under arbeid', 'st-work'], done: ['Løst', 'st-done'] };

function infoBadge() {
  const m = S.m;
  return (m.reports || []).some((r) => r.unread) || (m.electricity && m.electricity.remind);
}

function infoTab() {
  const m = S.m;
  const unread = (m.reports || []).filter((r) => r.unread).length;
  const subs = [['info', 'Info'], ['strom', 'Strøm'], ['meld', `Meld fra${unread ? ` (${unread})` : ''}`]];
  let h = `<div class="seg subnav" style="grid-template-columns: repeat(3, minmax(0, 1fr))">${subs.map(([k, l]) => `<button aria-pressed="${S.infoSub === k}" data-act="info-sub" data-v="${k}">${esc(l)}${k === 'strom' && m.electricity.remind ? ' •' : ''}</button>`).join('')}</div>`;
  if (S.infoSub === 'strom') h += stromHTML();
  else if (S.infoSub === 'meld') h += meldHTML();
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
      <button class="btn ghost" data-act="info-sub" data-v="meld" style="margin-top:8px">Meld fra om et problem</button>
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

function stromHTML() {
  const e = S.m.electricity;
  let h = '';
  if (e.remind) h += `<div class="notice-soft">Det er snart månedsslutt – husk å lese av strømmåleren.</div>`;
  h += `<section class="card info-card"><h2>Les av måleren</h2>
    ${e.last ? `<span class="note">Forrige: ${esc(kwhFmt(e.last.value))} den ${esc(dateFmt(e.last.date))}</span>` : `<span class="note">Første avlesning blir startpunktet.</span>`}
    <div class="reading-form">
      <label class="field"><span class="field-label">Målerstand (kWh)</span><input class="input" type="number" inputmode="decimal" step="0.1" min="0" placeholder="F.eks. 12345" value="${esc(S.reading.value)}" data-field="reading-value"></label>
      <label class="field"><span class="field-label">Dato</span><input class="input" type="date" value="${esc(S.reading.date)}" data-field="reading-date"></label>
    </div>
    <button class="btn primary big" data-act="reading-add">Lagre avlesning</button>
    ${e.last && e.last.deletable ? `<button class="btn ghost" data-act="reading-delete" data-id="${e.last.id}">${S.confirmDelete ? 'Trykk igjen for å slette siste' : 'Slett siste avlesning'}</button>` : ''}
    ${e.note ? `<p class="note pre">${esc(e.note)}</p>` : ''}
  </section>`;
  h += `<div class="stat-row">
    <div class="card stat"><span class="field-label">Til betaling</span><span class="big">${esc(nok(e.unpaid))}</span></div>
    <div class="card stat"><span class="field-label">Pris</span><span class="big">${e.price != null ? esc(nok(e.price)) + '<small>/kWh</small>' : 'Ikke satt'}</span></div>
  </div>`;
  h += chartHTML(e.periods);
  if (e.periods.length) {
    h += `<section><h2 class="group-title">Perioder</h2><div class="list">${e.periods.map((p) => `<div class="list-row period">
      <span class="grow"><span class="t">${esc(dateFmt(p.from))} – ${esc(dateFmt(p.to))}</span><span class="s">${esc(kwhFmt(p.kwh))} · ${p.days} dager · ${esc(kwhFmt(p.per_day))}/dag</span></span>
      <span class="amt"><span class="t">${esc(nok(p.amount))}</span><span class="pill ${p.paid ? 'lvl-ok' : 'lvl-warn'}">${p.paid ? 'Betalt' : 'Ikke betalt'}</span></span>
    </div>`).join('')}</div></section>`;
  }
  return h;
}

function meldHTML() {
  const m = S.m;
  const f = S.report;
  let h = `<section class="card info-card"><h2>Ny melding til utleier</h2>
    <span class="field-label">Hva gjelder det?</span>
    <div class="chips">${m.report_categories.map((c) => `<button class="chip" aria-pressed="${f.category === c}" data-act="report-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <label class="field"><span class="field-label">Beskriv problemet</span><textarea class="input area" rows="4" maxlength="2000" placeholder="F.eks. vasken på badet renner sakte unna" data-field="report-text">${esc(f.text)}</textarea></label>
    <div class="row between"><span class="status">Haster</span><button class="switch" role="switch" aria-checked="${f.urgent}" aria-label="Haster" data-act="report-urgent"></button></div>
    <button class="btn primary big" data-act="report-send">Send til utleier</button>
  </section>`;
  if (m.reports.length) {
    h += `<section><h2 class="group-title">Dine meldinger</h2>`;
    for (const r of m.reports) {
      const [label, cls] = STATUS[r.status] || STATUS.new;
      h += `<article class="card report ${r.unread ? 'unread' : ''}">
        <div class="row between"><span class="t">${esc(r.category)}${r.urgent ? ' · <span class="urgent">haster</span>' : ''}</span><span class="pill ${cls}">${label}</span></div>
        <span class="note">${esc(dateFmt(r.created))}</span>
        <p class="pre">${esc(r.text)}</p>
        ${r.updates.length ? `<div class="thread">${r.updates.map((u) => `<div class="msg ${u.from} ${u.status ? 'sys' : ''}"><span>${esc(u.text)}</span><small>${u.from === 'landlord' ? 'Utleier' : 'Deg'} · ${esc(dateFmt(u.at))}</small></div>`).join('')}</div>` : ''}
        ${r.status !== 'done' ? `<div class="reply"><textarea class="input area" rows="2" maxlength="1000" placeholder="Skriv et svar …" data-field="reply" data-id="${r.id}">${esc(S.reply[r.id] || '')}</textarea><button class="chip-btn" data-act="report-reply" data-id="${r.id}">Send</button></div>` : ''}
      </article>`;
    }
    h += `</section>`;
  }
  return h;
}

function tabsHTML() {
  const list = tabs();
  if (!list.some((t) => t.id === S.tab)) S.tab = list[0].id;
  const t = TABS.find((x) => x.id === S.tab);
  const title = S.tab === 'scener' ? 'Hybelen' : t.label;
  let body = '';
  if (!S.m.entities.length) body = `<section class="card section"><p class="intro" style="padding:18px 0">Ingen enheter er satt opp ennå. Ta kontakt med utleier.</p></section>`;
  else if (S.tab === 'scener') body = scenesTab();
  else if (S.tab === 'lys') body = lightsTab();
  else if (S.tab === 'klima') body = climateTab();
  else if (S.tab === 'info') body = infoTab();
  else body = autoTab();
  if (S.tab === 'info' && !S.m.entities.length) body = infoTab();
  return topHTML(title) + toastHTML() + body + navHTML();
}

// ---------- innstillinger og redigering ----------

function settingsHTML() {
  const m = S.m;
  let html = subHTML('Hybelen', 'Innstillinger') + toastHTML();

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
  if (!['scene-delete', 'auto-delete', 'reading-delete'].includes(a)) S.confirmDelete = false;
  switch (a) {
    case 'relogin':
      location.reload();
      return;
    case 'info-sub':
      S.infoSub = ds.v;
      if (ds.v === 'meld' && (S.m.reports || []).some((r) => r.unread)) {
        S.m.reports.forEach((r) => { r.unread = false; });
        cmd({ type: 'report_seen' });
      }
      if (S.tab !== 'info') { S.tab = 'info'; store.set('hybel-tab', 'info'); }
      window.scrollTo(0, 0);
      return render();
    case 'copy':
      try { navigator.clipboard.writeText(ds.v).then(() => showToast('Passordet er kopiert'), () => showToast('Kunne ikke kopiere', true)); } catch { showToast('Kunne ikke kopiere', true); }
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
      cmd({ type: 'report_create', category: f.category, text: f.text, urgent: f.urgent }).then((r) => {
        if (!r.ok) return;
        S.report = { category: null, text: '', urgent: false };
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
  if (ev.target.closest('input.range[data-key]')) endDrag();
});
$app.addEventListener('focusout', (ev) => {
  if (ev.target.matches?.(TYPING)) setTimeout(render, 0);
});

connect();
