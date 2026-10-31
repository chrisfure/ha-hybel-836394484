// Gjestesiden – ren JavaScript, ingen rammeverk.
const $app = document.getElementById('app');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

const S = {
  m: null,                 // siste tilstand fra serveren
  tab: store.get('gjest.tab'),
  open: null,              // lys med åpent fargevalg
  pending: {},             // optimistisk visning mens huset svarer
  conn: 'connecting',
  fails: 0,
  dragging: null,
  renderWanted: false,
  toast: null
};

const TEMPS = [
  { k: 2200, hex: '#FFB264', label: 'Varmhvit' },
  { k: 2700, hex: '#FFC88A', label: 'Myk hvit' },
  { k: 3500, hex: '#FFDDB5', label: 'Nøytral hvit' },
  { k: 4500, hex: '#FFF0DE', label: 'Klar hvit' },
  { k: 6000, hex: '#E6EEFF', label: 'Kaldhvit' }
];
const WHITE = { hex: '#FFF4E5', label: 'Hvit' };
const PALETTE = [
  { hex: '#FF5A4E', label: 'Rød' },
  { hex: '#FF9F43', label: 'Oransje' },
  { hex: '#FFD84D', label: 'Gul' },
  { hex: '#5BD27A', label: 'Grønn' },
  { hex: '#38C6E8', label: 'Turkis' },
  { hex: '#4C7DFF', label: 'Blå' },
  { hex: '#9B6BFF', label: 'Lilla' },
  { hex: '#FF6FB5', label: 'Rosa' }
];
const DEFAULT_GLOW = '#FFD59A';

const P = {
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  power: 'M12 3v9M6.3 7.3a8 8 0 1 0 11.4 0',
  thermo: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z',
  radio: 'M3 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 8l9-5M15.5 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 12h3M6.5 16h3',
  minus: 'M6 12h12',
  plus: 'M6 12h12M12 6v12'
};
const svg = (d, size = 20, sw = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const stopIcon = (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (t, d = 1) => String(Math.round(Number(t) * 10 ** d) / 10 ** d).replace('.', ',');
const deg = (t) => (t == null || !Number.isFinite(Number(t)) ? '–' : num(t) + '°');

// ---------- tilkobling ----------

function connect() {
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
    S.conn = 'lost';
    render();
  };
}

async function cmd(body) {
  try {
    const r = await fetch('api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({ ok: false, error: 'Uventet svar fra huset' }));
    if (!j.ok) showToast(j.error || 'Noe gikk galt', true);
    return j;
  } catch {
    showToast('Fikk ikke kontakt med huset. Prøv igjen.', true);
    return { ok: false };
  }
}

// Én forespørsel om gangen per enhet – den nyeste verdien vinner.
const queue = {};
function sendSet(key, body, gap = 110) {
  const q = (queue[key] ||= { busy: false, next: null });
  q.next = body;
  if (!q.busy) pump(key, gap);
}
async function pump(key, gap) {
  const q = queue[key];
  if (!q.next) return;
  const body = q.next;
  q.next = null;
  q.busy = true;
  const started = Date.now();
  await cmd(body);
  const wait = gap - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  q.busy = false;
  if (q.next) pump(key, gap);
}
const debouncers = {};
function sendLater(key, body, ms = 450) {
  clearTimeout(debouncers[key]);
  debouncers[key] = setTimeout(() => sendSet(key, body), ms);
}

// ---------- optimistisk visning ----------

function setPending(key, patch) {
  S.pending[key] = { ...(S.pending[key] || {}), ...patch, t: Date.now() };
}

function allLights() {
  return S.m ? S.m.rooms.flatMap((r) => r.lights) : [];
}

function prunePending() {
  const now = Date.now();
  const lights = new Map(allLights().map((l) => [l.key, l]));
  for (const [key, p] of Object.entries(S.pending)) {
    const age = now - p.t;
    if (age > 5000) { delete S.pending[key]; continue; }
    if (age < 500) continue;
    const l = lights.get(key);
    if (l) {
      const onOk = p.on === undefined || p.on === l.on;
      const pctOk = p.pct === undefined || !l.on || Math.abs(p.pct - l.pct) <= 3;
      const colorOk = p.hex === undefined || age > 2500;
      if (onOk && pctOk && colorOk) delete S.pending[key];
    } else if (age > 2500) {
      delete S.pending[key];
    }
  }
}

function eff(l) {
  const p = S.pending[l.key];
  return p ? { ...l, ...p } : l;
}

function heatEff(h) {
  const p = S.pending['h' + h.key];
  return p ? { ...h, target: p.target } : h;
}

function radioEff(r) {
  const p = S.pending.radio;
  const v = S.pending.vol;
  let out = r;
  if (p) out = { ...out, playing: p.playing, station: p.station, title: p.station != null ? r.stations[p.station]?.name || '' : '' };
  if (v) out = { ...out, volume: v.volume };
  return out;
}

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

// ---------- visning ----------

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return 'God morgen';
  if (h >= 10 && h < 17) return 'God dag';
  if (h >= 17 && h < 23) return 'God kveld';
  return 'God natt';
}

function glow(l) {
  if (l.white) return WHITE.hex;
  return l.hex || DEFAULT_GLOW;
}

function currentTab() {
  const m = S.m;
  const keys = m.rooms.map((r) => r.key).concat(m.radio.configured ? ['radio'] : []);
  if (!keys.includes(S.tab)) S.tab = keys[0] || null;
  return S.tab;
}

function summaryText() {
  const m = S.m;
  const parts = [];
  const lights = allLights();
  if (lights.length) {
    const on = lights.filter((l) => eff(l).on).length;
    parts.push(on ? `${on} lys på` : 'Alle lys er av');
  }
  const warm = m.rooms.find((r) => (r.heat && r.heat.now != null) || (r.temp && r.temp.now != null));
  if (warm) parts.push(`${deg(warm.heat ? warm.heat.now : warm.temp.now)} i ${warm.name.toLowerCase()}`);
  const r = radioEff(m.radio);
  if (r.playing && r.title) parts.push(`${r.title} spiller`);
  return parts.join(' · ');
}

function topHTML() {
  const m = S.m;
  const tab = currentTab();
  const tabs = m.rooms.map((r) => {
    const lit = r.lights.some((l) => eff(l).on);
    return `<button class="tab" role="tab" aria-selected="${tab === r.key}" data-act="tab" data-tab="${r.key}" data-fid="tab-${r.key}">${esc(r.short)}${lit ? '<span class="lit"></span>' : ''}</button>`;
  });
  if (m.radio.configured) {
    const playing = radioEff(m.radio).playing;
    tabs.push(`<button class="tab" role="tab" aria-selected="${tab === 'radio'}" data-act="tab" data-tab="radio" data-fid="tab-radio">Radio${playing ? '<span class="lit teal"></span>' : ''}</button>`);
  }
  const banner = S.conn !== 'ok' ? '<div class="banner">Kobler til huset igjen …</div>'
    : !m.connected ? '<div class="banner">Huset svarer ikke akkurat nå</div>' : '';
  return `<header class="top">
    <div class="top-row">
      <div class="hello">
        <span class="kicker">${esc(m.kicker)}</span>
        <h1>${greeting()}</h1>
        <span class="summary">${esc(summaryText())}</span>
      </div>
      ${allLights().length ? `<button class="pill" data-act="all-off" data-fid="alloff">${svg(P.power, 16)}Alt lys av</button>` : ''}
    </div>
    ${banner}
    ${tabs.length > 1 ? `<nav class="tabs" role="tablist" aria-label="Rom" style="grid-template-columns: repeat(${tabs.length}, minmax(0, 1fr))">${tabs.join('')}</nav>` : ''}
  </header>`;
}

function swatchesHTML(l) {
  let html = '<div class="swatches">';
  if (l.caps.temp) {
    const [lo, hi] = l.caps.temp;
    const temps = TEMPS.filter((t) => t.k >= lo - 100 && t.k <= hi + 100);
    const closest = l.mode === 'temp' && l.kelvin
      ? temps.reduce((a, t) => (Math.abs(t.k - l.kelvin) < Math.abs(a.k - l.kelvin) ? t : a), temps[0])
      : null;
    html += `<span class="sw-label">Hvitt lys</span><div class="sw-row">${temps.map((t) =>
      `<button class="sw" style="--s:${t.hex}" aria-label="${t.label}" aria-pressed="${closest === t}" data-act="kelvin" data-key="${l.key}" data-k="${t.k}" data-hex="${t.hex}" data-fid="k-${l.key}-${t.k}"></button>`).join('')}</div>`;
  }
  if (l.caps.rgb) {
    const list = l.caps.temp ? PALETTE : [WHITE, ...PALETTE];
    const sel = (p) => (p === WHITE ? l.white : l.mode === 'color' && !l.white && l.hex && near(l.hex, p.hex));
    html += `<span class="sw-label">Farger</span><div class="sw-row">${list.map((p) =>
      `<button class="sw" style="--s:${p.hex}" aria-label="${p.label}" aria-pressed="${Boolean(sel(p))}" data-act="${p === WHITE ? 'white' : 'color'}" data-key="${l.key}" data-hex="${p.hex}" data-fid="c-${l.key}-${p.hex.slice(1)}"></button>`).join('')}</div>`;
  }
  return html + '</div>';
}

function near(a, b) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) < 70;
}

function lightHTML(raw) {
  const l = eff(raw);
  const c = glow(l);
  const hasColor = Boolean(l.caps.rgb || l.caps.temp);
  const open = S.open === l.key && hasColor && l.available;
  const sub = !l.available ? 'Svarer ikke' : l.on ? (l.dim ? `${l.pct} %` : 'På') : 'Av';
  return `<div class="card light ${l.on ? 'on' : ''} ${l.available ? '' : 'unavail'}" style="--c:${c}" data-light="${l.key}">
    <div class="row">
      <button class="bulb" data-act="toggle" data-key="${l.key}" data-fid="b-${l.key}" aria-pressed="${l.on}" aria-label="${l.on ? 'Slå av' : 'Slå på'} ${esc(l.name)}" ${l.available ? '' : 'disabled'}>${svg(P.bulb)}</button>
      <div class="txt"><span class="name">${esc(l.name)}</span><span class="sub" data-sub>${sub}</span></div>
      ${hasColor ? `<button class="color-btn" data-act="open" data-key="${l.key}" data-fid="o-${l.key}" aria-expanded="${open}" aria-label="Velg farge på ${esc(l.name)}" ${l.available ? '' : 'disabled'}><span class="dot"></span>Farge</button>` : ''}
    </div>
    ${l.dim ? `<input class="sl" type="range" min="0" max="100" step="1" value="${l.pct}" style="--p:${l.pct}%" data-slide="light" data-key="${l.key}" data-fid="s-${l.key}" aria-label="Lysstyrke ${esc(l.name)}" ${l.available ? '' : 'disabled'}>` : ''}
    ${open ? swatchesHTML(l) : ''}
  </div>`;
}

function heatHTML(raw) {
  const h = heatEff(raw);
  const t = h.target;
  const atMin = t != null && t <= h.min;
  const atMax = t != null && t >= h.max;
  const dis = !h.available;
  return `<div class="card heat ${h.available ? '' : 'unavail'}">
    <span class="heat-ico">${svg(P.thermo)}</span>
    <div class="txt"><span class="name">${esc(h.name)}</span><span class="sub">${!h.available ? 'Svarer ikke' : h.now != null ? `Nå ${deg(h.now)}${h.heating ? ' · varmer' : ''}` : ''}</span></div>
    <button class="round" data-act="heat" data-dir="-1" data-key="${h.key}" data-fid="hd-${h.key}" aria-label="Senk temperaturen" ${dis || atMin ? 'disabled' : ''}>${svg(P.minus, 18, 2.4)}</button>
    <span class="target" aria-live="polite">${t == null ? '–' : num(t) + '°'}</span>
    <button class="round" data-act="heat" data-dir="1" data-key="${h.key}" data-fid="hu-${h.key}" aria-label="Øk temperaturen" ${dis || atMax ? 'disabled' : ''}>${svg(P.plus, 18, 2.4)}</button>
  </div>`;
}

function roomHTML(room) {
  let html = `<div class="room-head"><h2>${esc(room.name)}</h2>${room.lights.length ? `<button class="link" data-act="room-off" data-room="${room.key}" data-fid="ro-${room.key}">Slå av i rommet</button>` : ''}</div>`;
  html += room.lights.map(lightHTML).join('');
  if (room.heat) html += heatHTML(room.heat);
  else if (room.temp) {
    html += `<div class="card heat ${room.temp.available ? '' : 'unavail'}"><span class="heat-ico">${svg(P.thermo)}</span><span class="txt"><span class="name">Temperatur</span></span><span class="big-temp">${deg(room.temp.now)}</span></div>`;
  }
  if (!room.lights.length && !room.heat && !room.temp) html += '<p class="empty">Ingenting å styre her ennå.</p>';
  return html;
}

function radioHTML() {
  const r = radioEff(S.m.radio);
  const vol = r.volume ?? 0;
  const p = r.max_volume ? Math.min(100, Math.round((Math.min(vol, r.max_volume) / r.max_volume) * 100)) : 0;
  let html = `<div class="room-head"><h2>Radio</h2></div>
    <div class="radio-card">
      <div class="row">
        <span class="radio-ico">${svg(P.radio, 24)}</span>
        <div class="txt"><span class="radio-kicker">${!r.available ? 'Høyttaleren svarer ikke' : r.playing ? 'Spiller nå' : 'Radioen er av'}</span><span class="radio-title">${r.playing && r.title ? esc(r.title) : 'Velg en kanal'}</span></div>
        ${r.playing ? `<button class="stop" data-act="stop" data-fid="stop" aria-label="Stopp radioen">${stopIcon()}</button>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="vol-head"><b>Volum</b><span data-vol>${r.volume == null ? '–' : vol + ' %'}</span></div>
        <input class="sl" type="range" min="0" max="${r.max_volume}" step="1" value="${Math.min(vol, r.max_volume)}" style="--p:${p}%" data-slide="vol" data-fid="vol" aria-label="Volum" ${r.available ? '' : 'disabled'}>
      </div>
    </div>`;
  if (r.stations.length) {
    html += `<div class="stations">${r.stations.map((s, i) => {
      const on = r.playing && r.station === i;
      return `<button class="station" aria-pressed="${on}" data-act="station" data-i="${i}" data-fid="st-${i}" ${r.available ? '' : 'disabled'}><b>${esc(s.name)}</b><span>${on ? 'Spiller nå' : esc(s.sub)}</span></button>`;
    }).join('')}</div>`;
  } else {
    html += '<p class="empty">Ingen kanaler er lagt inn ennå.</p>';
  }
  return html;
}

function miniHTML() {
  const r = radioEff(S.m.radio);
  return `<div class="mini-wrap"><div class="mini">
    <button class="mini-open" data-act="tab" data-tab="radio" data-fid="mini">
      <span class="mini-ico ${r.playing ? 'on' : ''}">${svg(P.radio, 18)}</span>
      <span class="mini-txt"><b>${r.playing && r.title ? esc(r.title) : 'Radio'}</b><span>${r.playing ? `Spiller${r.volume != null ? ` · ${r.volume} % volum` : ''}` : 'Trykk for å velge kanal'}</span></span>
    </button>
    ${r.playing ? `<button class="stop" data-act="stop" data-fid="mini-stop" aria-label="Stopp radioen">${stopIcon(14)}</button>` : ''}
  </div></div>`;
}

function toastHTML() {
  if (!S.toast) return '';
  return `<div class="toast ${S.toast.error ? 'error' : ''}" role="status">${esc(S.toast.msg)}</div>`;
}

function render() {
  if (S.dragging) {
    S.renderWanted = true;
    return;
  }
  S.renderWanted = false;
  if (!S.m) {
    $app.innerHTML = `<div class="loading">${S.conn === 'lost' ? 'Får ikke kontakt med huset. Prøver igjen …' : 'Kobler til huset …'}</div>`;
    return;
  }
  const m = S.m;
  if (!m.rooms.length && !m.radio.configured) {
    $app.innerHTML = '<div class="empty"><h1>Ikke satt opp ennå</h1>Gjestesiden er ikke ferdig konfigurert. Spør vertskapet.</div>';
    return;
  }
  const fid = document.activeElement?.dataset?.fid;
  const scroll = $app.querySelector('.content')?.scrollTop || 0;
  const tab = currentTab();
  const room = m.rooms.find((r) => r.key === tab);
  const body = tab === 'radio' ? radioHTML() : room ? roomHTML(room) : '';
  $app.innerHTML = topHTML()
    + `<main class="content" role="tabpanel">${body}</main>`
    + (m.radio.configured && tab !== 'radio' ? miniHTML() : '')
    + toastHTML();
  const content = $app.querySelector('.content');
  if (content) content.scrollTop = scroll;
  if (fid) $app.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
}

// ---------- handlinger ----------

function lightByKey(key) {
  return allLights().find((l) => l.key === key);
}

$app.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled || !S.m) return;
  const act = el.dataset.act;
  const key = el.dataset.key;

  if (act === 'tab') {
    S.tab = el.dataset.tab;
    S.open = null;
    store.set('gjest.tab', S.tab);
    render();
    $app.querySelector('.content')?.scrollTo(0, 0);
    return;
  }
  if (act === 'toggle') {
    const l = eff(lightByKey(key));
    setPending(key, { on: !l.on });
    sendSet(key, { type: 'light', key, on: !l.on });
    return render();
  }
  if (act === 'open') {
    S.open = S.open === key ? null : key;
    return render();
  }
  if (act === 'kelvin') {
    setPending(key, { on: true, mode: 'temp', kelvin: Number(el.dataset.k), hex: el.dataset.hex, white: false });
    sendSet(key, { type: 'light', key, kelvin: Number(el.dataset.k) });
    return render();
  }
  if (act === 'color') {
    setPending(key, { on: true, mode: 'color', hex: el.dataset.hex, white: false });
    sendSet(key, { type: 'light', key, color: el.dataset.hex });
    return render();
  }
  if (act === 'white') {
    setPending(key, { on: true, mode: 'color', hex: WHITE.hex, white: true });
    sendSet(key, { type: 'light', key, white: true });
    return render();
  }
  if (act === 'room-off' || act === 'all-off') {
    const rooms = act === 'all-off' ? S.m.rooms : S.m.rooms.filter((r) => r.key === el.dataset.room);
    for (const r of rooms) for (const l of r.lights) setPending(l.key, { on: false });
    cmd(act === 'all-off' ? { type: 'all_off' } : { type: 'room_off', room: el.dataset.room });
    return render();
  }
  if (act === 'heat') {
    const raw = S.m.rooms.map((r) => r.heat).find((h) => h && h.key === key);
    if (!raw) return;
    const h = heatEff(raw);
    const base = h.target ?? h.now ?? h.min;
    const next = Math.min(h.max, Math.max(h.min, Math.round((base + Number(el.dataset.dir) * h.step) / h.step) * h.step));
    setPending('h' + key, { target: Math.round(next * 10) / 10 });
    sendLater('h' + key, { type: 'heat', key, target: Math.round(next * 10) / 10 });
    return render();
  }
  if (act === 'station') {
    const i = Number(el.dataset.i);
    setPending('radio', { playing: true, station: i });
    cmd({ type: 'radio_play', index: i });
    return render();
  }
  if (act === 'stop') {
    setPending('radio', { playing: false, station: null });
    cmd({ type: 'radio_stop' });
    return render();
  }
});

$app.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset?.slide || !S.m) return;
  const v = Number(el.value);
  const max = Number(el.max) || 100;
  el.style.setProperty('--p', `${Math.round((v / max) * 100)}%`);
  if (el.dataset.slide === 'light') {
    const key = el.dataset.key;
    S.dragging = key;
    setPending(key, v === 0 ? { on: false } : { on: true, pct: v });
    const card = el.closest('[data-light]');
    if (card) {
      card.classList.toggle('on', v > 0);
      const sub = card.querySelector('[data-sub]');
      if (sub) sub.textContent = v > 0 ? `${v} %` : 'Av';
      const b = card.querySelector('.bulb');
      if (b) b.setAttribute('aria-pressed', String(v > 0));
    }
    sendSet(key, { type: 'light', key, pct: v }, 140);
  } else if (el.dataset.slide === 'vol') {
    S.dragging = 'vol';
    setPending('vol', { volume: v });
    const label = $app.querySelector('[data-vol]');
    if (label) label.textContent = `${v} %`;
    sendSet('vol', { type: 'volume', value: v }, 160);
  }
});

$app.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!el.dataset?.slide) return;
  S.dragging = null;
  if (S.renderWanted) render();
});

// Slipper man slideren utenfor feltet, kommer ikke alltid «change» – sørg for at vi ikke blir hengende.
window.addEventListener('pointerup', () => {
  if (!S.dragging) return;
  setTimeout(() => {
    S.dragging = null;
    if (S.renderWanted) render();
  }, 200);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
setInterval(() => { if (S.m && !S.dragging) render(); }, 60000); // hilsenen følger klokken

connect();
