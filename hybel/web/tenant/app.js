// Leietakersiden – ren JavaScript, ingen rammeverk.
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

const S = {
  m: null,            // siste tilstand fra serveren
  view: 'main',       // main | settings | scene | auto
  draft: null,        // sceneutkast
  adraft: null,       // automasjonsutkast
  pending: {},        // key -> { v, t } (optimistisk visning mens HA svarer)
  lastBri: {},
  toast: null,
  conn: 'connecting', // connecting | ok | lost | relogin
  fails: 0,
  dragging: null,
  deferred: false,
  confirmDelete: false
};

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
const VENT_LABEL = { away: 'Borte', low: 'Lav', normal: 'Normal', high: 'Høy' };
const VENT_LEVEL = { away: 0, low: 1, normal: 2, high: 3 };
const DAYS = ['Ma', 'Ti', 'On', 'To', 'Fr', 'Lø', 'Sø'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deg = (t) => (t == null || !Number.isFinite(Number(t)) ? '–' : String(Math.round(Number(t) * 10) / 10).replace('.', ',') + '°');
const svg = (d, size = 22, sw = 1.8) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const clock = (ms) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

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
    const same = ent && (ent.kind === 'light' ? Math.abs((ent.value ?? -99) - p.v) <= 2 || (p.v === 0 && ent.value === 0) : ent.value === p.v);
    if (!ent || (same && now - p.t > 300) || now - p.t > 4000) delete S.pending[key];
  }
}
function valueOf(ent) {
  const p = S.pending[ent.key];
  return p ? p.v : ent.value;
}
const entity = (key) => S.m.entities.find((e) => e.key === key);
const sceneById = (id) => S.m.scenes.find((s) => s.id === id);

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

function sceneSummary(values) {
  const parts = [];
  const ents = S.m.entities;
  const lights = ents.filter((e) => values[e.key] !== undefined && e.kind === 'light');
  if (lights.length) {
    const on = lights.filter((l) => values[l.key] > 0);
    parts.push(on.length ? (on.length === lights.length && lights.length > 1 ? 'lys' : `${on.length} lys`) : 'lys av');
  }
  const h = ents.find((e) => e.kind === 'heat' && values[e.key] !== undefined);
  if (h) parts.push(`varme ${deg(values[h.key])}`);
  const v = ents.find((e) => e.kind === 'vent' && values[e.key] !== undefined);
  if (v) parts.push(`luft ${VENT_LABEL[values[v.key]].toLowerCase()}`);
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function autoWhen(t) {
  if (t.type === 'time') return `Kl. ${t.at}`;
  const base = t.type === 'sunset' ? 'Solnedgang' : 'Soloppgang';
  if (!t.offset) return base;
  const abs = Math.abs(t.offset);
  const amount = abs % 60 === 0 ? `${abs / 60} t` : `${abs} min`;
  return `${amount} ${t.offset < 0 ? 'før' : 'etter'} ${base.toLowerCase()}`;
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
  return `Varme ${deg(a.value)}`;
}

// ---------- visning ----------

function kicker() {
  if (S.conn !== 'ok') return ['warn', 'Kobler til …'];
  if (!S.m.connected) return ['bad', 'Mistet kontakt med huset'];
  return ['', 'Tilkoblet'];
}

function topHTML() {
  const [cls, text] = kicker();
  const active = S.m.scenes.filter((s) => s.active).map((s) => s.name);
  return `<header class="top">
    <div>
      <span class="kicker ${cls}"><span class="dot ${cls}"></span>${text}</span>
      <h1>Hybelen</h1>
      ${active.length ? `<span class="active-line">${esc(active.join(' · '))}</span>` : ''}
    </div>
    <button class="icon-btn" data-act="settings" data-fid="settings" aria-label="Innstillinger">${svg('M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4')}</button>
  </header>`;
}

function subHTML(kick, title) {
  return `<header class="sub">
    <button class="icon-btn" data-act="back" data-fid="back" aria-label="Tilbake">${svg('M15 5l-7 7 7 7', 22, 2)}</button>
    <div><span class="kicker">${esc(kick)}</span><h1>${esc(title)}</h1></div>
  </header>`;
}

function toastHTML() {
  if (!S.toast) return '';
  return `<div class="toast ${S.toast.error ? 'error' : ''}" role="status">${S.toast.error ? '' : svg('M5 12l5 5 9-10', 18, 2.2)}<span>${esc(S.toast.msg)}</span></div>`;
}

function scenesHTML() {
  const m = S.m;
  if (!m.scenes.length && !m.can_edit) return '';
  return `<div class="scenes" role="list">
    ${m.scenes.map((s) => `<button class="scene" role="listitem" aria-pressed="${s.active}" data-act="scene" data-id="${s.id}" data-fid="s-${s.id}" title="${esc(sceneSummary(s.values))}">${svg(ICON[s.icon] || ICON.star, 20)}<span class="name">${esc(s.name)}</span></button>`).join('')}
    ${m.can_edit ? `<button class="scene add" data-act="scene-new" data-fid="s-new" aria-label="Ny scene">${svg('M12 5v14M5 12h14', 20, 2)}<span class="name">Ny</span></button>` : ''}
  </div>`;
}

function lightRow(e, v, mode) {
  const on = v > 0;
  const live = mode === 'draft' || e.available;
  const status = !live ? 'Svarer ikke' : on ? (e.dimmable ? `På · ${v} %` : 'På') : 'Av';
  return `<div class="light ${live ? '' : 'unavail'}">
    <div class="row">
      <span><span class="name">${esc(e.label)}</span><span class="status" data-status="${e.key}">${status}</span></span>
      <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(e.label)}" data-act="toggle" data-key="${e.key}" data-mode="${mode}" data-fid="t-${mode}-${e.key}" ${live ? '' : 'disabled'}></button>
    </div>
    ${on && e.dimmable && live ? `<input class="range" type="range" min="1" max="100" step="1" value="${v}" aria-label="Lysstyrke ${esc(e.label)}" data-key="${e.key}" data-mode="${mode}" data-fid="r-${mode}-${e.key}">` : ''}
  </div>`;
}

function heatControl(e, v, mode) {
  const m = S.m;
  const live = mode === 'draft' || e.available;
  const atMax = v != null && v >= m.limits.heat_max;
  const atMin = v != null && v <= m.limits.heat_min;
  return `<span class="stepper">
    <button data-act="heat" data-dir="-1" data-key="${e.key}" data-mode="${mode}" data-fid="hd-${mode}-${e.key}" aria-label="Senk temperatur" ${!live || atMin ? 'disabled' : ''}>−</button>
    <output aria-live="polite">${deg(v)}</output>
    <button data-act="heat" data-dir="1" data-key="${e.key}" data-mode="${mode}" data-fid="hu-${mode}-${e.key}" aria-label="Øk temperatur" ${!live || atMax ? 'disabled' : ''}>+</button>
  </span>`;
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

function controlsHTML() {
  const m = S.m;
  let html = '';
  const lights = m.entities.filter((e) => e.kind === 'light');
  if (lights.length) {
    html += `<section class="card section"><div class="section-head"><h2>Lys</h2>
      <button class="chip-btn" data-act="all-off" data-fid="alloff">Slå av alle</button></div>
      ${lights.map((e) => lightRow(e, valueOf(e) ?? 0, 'live')).join('')}</section>`;
  }
  for (const e of m.entities.filter((x) => x.kind === 'heat')) {
    const v = valueOf(e);
    const atMax = v != null && v >= m.limits.heat_max;
    const atMin = v != null && v <= m.limits.heat_min;
    const limitText = !e.available ? 'Termostaten svarer ikke akkurat nå'
      : atMax ? `Maks ${m.limits.heat_max}° – satt av utleier`
      : atMin ? `Minimum ${m.limits.heat_min}° – beskytter mot fukt`
      : `Kan stilles mellom ${m.limits.heat_min}° og ${m.limits.heat_max}°`;
    const now = e.current != null ? `Nå ${deg(e.current)}${e.heating ? ' · varmer' : ''}` : '';
    html += `<section class="card heat ${e.available ? '' : 'unavail'}">
      <div class="row"><span><span class="title">${esc(e.label)}</span><span class="muted" style="font-size:13px">${now}</span></span>${heatControl(e, v, 'live')}</div>
      <div class="limit ${atMax || atMin ? 'hit' : ''}">${limitText}</div>
    </section>`;
  }
  for (const e of m.entities.filter((x) => x.kind === 'vent')) {
    const v = valueOf(e);
    const meta = [e.humidity != null ? `Luftfukt ${Math.round(e.humidity)} %` : '', e.temperature != null ? deg(e.temperature) : ''].filter(Boolean).join(' · ');
    html += `<section class="vent ${e.available ? '' : 'unavail'}">
      <div class="section-head"><h2>${esc(e.label)}</h2><span class="meta">${e.available ? meta : 'Svarer ikke'}</span></div>
      ${ventButtons(e, v, 'live')}
      ${v === 'high' && m.boost && m.boost.key === e.key ? `<div class="boost">${svg('M12 9v4l2.5 2M9 2h6M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0z', 18, 2)}<span>Høy til kl. ${clock(m.boost.until)}, så tilbake til ${VENT_LABEL[m.boost.return_to].toLowerCase()}</span></div>` : ''}
    </section>`;
  }
  if (!m.entities.length) html += `<section class="card section"><p class="intro" style="padding:18px 0">Ingen enheter er satt opp ennå. Ta kontakt med utleier.</p></section>`;
  return html;
}

function mainHTML() {
  return topHTML() + scenesHTML() + toastHTML() + controlsHTML();
}

function settingsHTML() {
  const m = S.m;
  let html = subHTML('Hybelen', 'Innstillinger') + toastHTML();

  html += `<section><h2 class="group-title">Mine scener</h2><div class="list">`;
  for (const s of m.scenes) {
    const inner = `<span class="row-ic">${svg(ICON[s.icon] || ICON.star, 20)}</span><span class="grow"><span class="t">${esc(s.name)}</span><span class="s">${esc(sceneSummary(s.values))}</span></span>`;
    html += m.can_edit
      ? `<button class="list-row" data-act="scene-edit" data-id="${s.id}" data-fid="e-${s.id}">${inner}${svg('M9 5l7 7-7 7', 18, 2)}</button>`
      : `<div class="list-row">${inner}</div>`;
  }
  if (m.can_edit) html += `<button class="list-row add-row" data-act="scene-new" data-fid="e-new">${svg('M12 5v14M5 12h14', 20, 2)}<span class="t">Ny scene</span></button>`;
  html += `</div>${m.can_edit ? '' : '<p class="note">Scenene er satt av utleier.</p>'}</section>`;

  if (m.can_edit) {
    html += `<section><h2 class="group-title">Automasjoner</h2><div class="list">`;
    for (const a of m.automations) {
      html += `<div class="list-row auto-row">
        <button class="grow plain" data-act="auto-edit" data-id="${a.id}" data-fid="a-${a.id}">
          <span class="t">${esc(autoWhat(a.action))}</span>
          <span class="s">${esc(autoWhen(a.trigger))} · ${esc(autoDays(a.days))}</span>
        </button>
        <button class="switch teal" role="switch" aria-checked="${a.enabled}" aria-label="Automasjon på" data-act="auto-toggle" data-id="${a.id}" data-fid="at-${a.id}"></button>
      </div>`;
    }
    html += `<button class="list-row add-row" data-act="auto-new" data-fid="a-new">${svg('M12 5v14M5 12h14', 20, 2)}<span class="t">Ny automasjon</span></button></div>
      <p class="note" style="margin-top:8px">F.eks. «Kos ved solnedgang» eller «Slå av alle lys kl. 23 på hverdager».</p></section>`;
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
  for (const e of m.entities.filter((x) => x.kind === 'heat')) {
    html += `<div class="list-row"><span class="t" style="font-weight:500">${esc(e.label)}</span><span class="t">${m.limits.heat_min}–${m.limits.heat_max}°</span></div>`;
  }
  if (hasVent) {
    html += `<div class="list-row"><span class="t" style="font-weight:500">Høy ventilasjon</span><span class="t">Maks ${m.limits.boost_max_minutes} min</span></div>`;
    html += `<div class="list-row"><span class="t" style="font-weight:500">Bortemodus på ventilasjon</span><span class="t">${m.limits.vent_allow_away ? 'Tillatt' : 'Ikke tillatt'}</span></div>`;
  }
  html += `</div><p class="note" style="margin-top:8px">Grensene beskytter gulv, fukt og inneklima. Ta kontakt med utleier hvis noe ikke passer.</p></section>`;
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
  for (const e of m.entities) {
    const inc = d.include[e.key];
    const v = d.values[e.key];
    let ctl = '';
    if (inc) {
      if (e.kind === 'light') {
        const on = (v ?? 0) > 0;
        ctl = `<div class="draft-light">
          <span class="status" data-status="${e.key}">${on ? (e.dimmable ? `På · ${v} %` : 'På') : 'Av'}</span>
          <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(e.label)} på eller av" data-act="toggle" data-key="${e.key}" data-mode="draft" data-fid="t-draft-${e.key}"></button>
        </div>
        ${on && e.dimmable ? `<input class="range" type="range" min="1" max="100" step="1" value="${v}" aria-label="Lysstyrke ${esc(e.label)}" data-key="${e.key}" data-mode="draft" data-fid="r-draft-${e.key}">` : ''}`;
      } else if (e.kind === 'heat') ctl = `<div class="draft-heat"><span class="status">Temperatur</span>${heatControl(e, v, 'draft')}</div>`;
      else ctl = ventButtons(e, v, 'draft');
    }
    const kind = e.kind === 'light' ? 'Lys' : e.kind === 'heat' ? 'Varme' : 'Ventilasjon';
    html += `<section class="card pick ${inc ? 'on' : ''}">
      <div class="row">
        <span><span class="name">${esc(e.label)}</span><span class="status">${kind}${inc ? '' : ' · ikke med'}</span></span>
        <button class="check" role="checkbox" aria-checked="${!!inc}" aria-label="Ta med ${esc(e.label)}" data-act="include" data-key="${e.key}" data-fid="inc-${e.key}">${inc ? svg('M5 12l5 5 9-10', 18, 2.6) : ''}</button>
      </div>
      ${inc ? `<div class="pick-ctl">${ctl}</div>` : ''}
    </section>`;
  }
  html += `<button class="btn ghost big" data-act="scene-from-now" style="width:100%">Hent det som er på nå</button>`;
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
  let html = subHTML(a.id ? 'Rediger automasjon' : 'Ny automasjon', 'Automasjon') + toastHTML();

  const sunTime = t.type === 'sunset' ? m.sun.sunset : t.type === 'sunrise' ? m.sun.sunrise : null;
  html += `<section class="card form">
    <span class="field-label">Når</span>
    <div class="seg" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
      ${[['time', 'Klokkeslett'], ['sunset', 'Solnedgang'], ['sunrise', 'Soloppgang']].map(([k, l]) => `<button aria-pressed="${t.type === k}" data-act="trig" data-v="${k}">${l}</button>`).join('')}
    </div>
    ${t.type === 'time'
      ? `<input class="input time" type="time" value="${esc(t.at)}" data-field="auto-time" aria-label="Klokkeslett">`
      : `<div class="seg offsets">${[[-60, '1 t før'], [-30, '30 min før'], [0, 'Akkurat'], [30, '30 min etter'], [60, '1 t etter']].map(([o, l]) => `<button aria-pressed="${(t.offset || 0) === o}" data-act="offset" data-v="${o}">${l}</button>`).join('')}</div>
         ${sunTime ? `<span class="note">${t.type === 'sunset' ? 'Solnedgang' : 'Soloppgang'} i dag: kl. ${clock(sunTime)}</span>` : ''}`}
    <span class="field-label">Dager</span>
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
      <span class="row-ic">${svg(ICON[s.icon] || ICON.star, 20)}</span><span class="grow"><span class="t">${esc(s.name)}</span><span class="s">${esc(sceneSummary(s.values))}</span></span><span class="radio"></span></button>`;
  }
  html += `<button class="list-row" role="radio" aria-checked="${act.type === 'lights_off'}" data-act="action" data-type="lights_off">
      <span class="row-ic">${svg('M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3zM3 3l18 18', 20)}</span><span class="grow"><span class="t">Slå av alle lys</span></span><span class="radio"></span></button>`;
  const heatEnt = m.entities.find((e) => e.kind === 'heat');
  if (heatEnt) {
    html += `<button class="list-row" role="radio" aria-checked="${act.type === 'heat'}" data-act="action" data-type="heat">
      <span class="row-ic">${svg('M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.5 1.5 1.5 2.5 3 2.5-1-2-1-4.5 0-7z', 20)}</span><span class="grow"><span class="t">Sett ${esc(heatEnt.label.toLowerCase())}</span></span><span class="radio"></span></button>`;
    if (act.type === 'heat') {
      html += `<div class="list-row"><span class="t" style="font-weight:500">Temperatur</span><span class="stepper">
        <button data-act="auto-heat" data-dir="-1" aria-label="Senk" ${act.value <= m.limits.heat_min ? 'disabled' : ''}>−</button><output>${deg(act.value)}</output>
        <button data-act="auto-heat" data-dir="1" aria-label="Øk" ${act.value >= m.limits.heat_max ? 'disabled' : ''}>+</button></span></div>`;
    }
  }
  html += `</div></section>`;

  html += `<div class="actions">
    ${a.id ? `<button class="btn ghost big danger-text" data-act="auto-delete">${S.confirmDelete ? 'Trykk igjen for å slette' : 'Slett'}</button>` : ''}
    <button class="btn primary big" data-act="auto-save">Lagre</button>
  </div>`;
  return html;
}

function reloginHTML() {
  return `<div class="loading"><p>Du er logget ut, eller forbindelsen ble brutt.</p>
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
  // Ikke tegn på nytt mens man skriver – det ville flyttet markøren.
  const ae = document.activeElement;
  if (ae && ae.matches?.('input[type="text"], input[type="time"]') && $app.contains(ae)) return;
  if (S.view === 'scene' && !S.draft) S.view = 'settings';
  if (S.view === 'auto' && !S.adraft) S.view = 'settings';
  const fid = ae?.dataset?.fid;
  const html = S.view === 'settings' ? settingsHTML() : S.view === 'scene' ? sceneEditorHTML() : S.view === 'auto' ? autoEditorHTML() : mainHTML();
  $app.innerHTML = html;
  if (fid) $app.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
}

// ---------- handlinger ----------

function go(view) {
  S.view = view;
  S.toast = null;
  S.confirmDelete = false;
  window.scrollTo(0, 0);
  render();
}

function currentValues(keys) {
  const out = {};
  for (const e of S.m.entities) {
    if (keys && !keys.includes(e.key)) continue;
    const v = valueOf(e);
    if (v != null) out[e.key] = e.kind === 'heat' ? Math.round(v) : v;
  }
  return out;
}

function openScene(id) {
  const s = id ? sceneById(id) : null;
  const now = currentValues();
  const include = {};
  const values = { ...now };
  if (s) for (const [k, v] of Object.entries(s.values)) { include[k] = true; values[k] = v; }
  for (const e of S.m.entities) {
    if (values[e.key] == null) values[e.key] = e.kind === 'light' ? 60 : e.kind === 'heat' ? S.m.limits.heat_min + 5 : 'normal';
    if (e.kind === 'light' && !include[e.key] && !s && values[e.key] === 0) values[e.key] = 60;
  }
  S.draft = { id: s?.id || null, name: s?.name || '', icon: s?.icon || 'star', include, values };
  go('scene');
}

function openAuto(id) {
  const a = id ? S.m.automations.find((x) => x.id === id) : null;
  const firstScene = S.m.scenes[0];
  S.adraft = a
    ? JSON.parse(JSON.stringify({ id: a.id, trigger: a.trigger, days: a.days, action: a.action }))
    : { id: null, trigger: { type: 'time', at: '22:00', offset: 0 }, days: [1, 2, 3, 4, 5, 6, 7], action: firstScene ? { type: 'scene', scene_id: firstScene.id } : { type: 'lights_off' } };
  if (S.adraft.action.type === 'heat' && S.adraft.action.value == null) S.adraft.action.value = 21;
  go('auto');
}

function act(a, ds) {
  const m = S.m;
  const draft = ds.mode === 'draft';
  if (a !== 'scene-delete' && a !== 'auto-delete') S.confirmDelete = false;
  switch (a) {
    case 'relogin':
      location.reload();
      return;
    case 'settings':
      return go('settings');
    case 'back':
      if (S.view === 'scene') S.draft = null;
      if (S.view === 'auto') S.adraft = null;
      return go(S.view === 'settings' ? 'main' : S.view === 'main' ? 'main' : 'settings');
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
    case 'icon':
      S.draft.icon = ds.icon;
      return render();
    case 'include':
      S.draft.include[ds.key] = !S.draft.include[ds.key];
      return render();
    case 'scene-from-now': {
      const now = currentValues();
      for (const k of Object.keys(S.draft.include)) if (S.draft.include[k] && now[k] !== undefined) S.draft.values[k] = now[k];
      showToast('Hentet verdiene som er på nå');
      return;
    }
    case 'scene-save': {
      const d = S.draft;
      const values = Object.fromEntries(Object.keys(d.include).filter((k) => d.include[k]).map((k) => [k, d.values[k]]));
      cmd({ type: 'scene_save', scene: { id: d.id, name: d.name.trim(), icon: d.icon, values } }).then((r) => {
        if (!r.ok) return;
        S.draft = null;
        go('settings');
        showToast(`${d.name.trim()} er lagret`);
      });
      return;
    }
    case 'scene-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      cmd({ type: 'scene_delete', id: S.draft.id }).then((r) => { if (r.ok) { S.draft = null; go('settings'); showToast('Scenen er slettet'); } });
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
    case 'trig':
      S.adraft.trigger.type = ds.v;
      if (ds.v === 'time' && !S.adraft.trigger.at) S.adraft.trigger.at = '22:00';
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
    case 'action':
      S.adraft.action = ds.type === 'scene' ? { type: 'scene', scene_id: ds.id } : ds.type === 'heat' ? { type: 'heat', value: S.adraft.action.value ?? Math.min(m.limits.heat_max, 21) } : { type: 'lights_off' };
      return render();
    case 'auto-heat': {
      const v = Math.round(S.adraft.action.value ?? 21) + Number(ds.dir);
      S.adraft.action.value = Math.min(m.limits.heat_max, Math.max(m.limits.heat_min, v));
      return render();
    }
    case 'auto-save': {
      const ad = S.adraft;
      const body = { id: ad.id, trigger: ad.trigger.type === 'time' ? { type: 'time', at: ad.trigger.at } : { type: ad.trigger.type, offset: ad.trigger.offset || 0 }, days: ad.days, action: ad.action };
      cmd({ type: 'auto_save', automation: body }).then((r) => {
        if (!r.ok) return;
        S.adraft = null;
        go('settings');
        showToast('Automasjonen er lagret');
      });
      return;
    }
    case 'auto-delete':
      if (!S.confirmDelete) { S.confirmDelete = true; return render(); }
      cmd({ type: 'auto_delete', id: S.adraft.id }).then((r) => { if (r.ok) { S.adraft = null; go('settings'); showToast('Automasjonen er slettet'); } });
      return;
    case 'toggle': {
      const e = entity(ds.key);
      if (!e) return;
      const cur = draft ? S.draft.values[e.key] ?? 0 : valueOf(e) ?? 0;
      const next = cur > 0 ? 0 : S.lastBri[e.key] || (e.dimmable ? 60 : 100);
      if (cur > 0) S.lastBri[e.key] = cur;
      if (draft) S.draft.values[e.key] = next;
      else {
        setPending(e.key, next);
        sendSet(e.key, next);
      }
      return render();
    }
    case 'all-off':
      for (const e of m.entities.filter((x) => x.kind === 'light')) {
        const cur = valueOf(e);
        if (cur > 0) S.lastBri[e.key] = cur;
        setPending(e.key, 0);
      }
      cmd({ type: 'all_off' });
      return render();
    case 'heat': {
      const e = entity(ds.key);
      if (!e) return;
      const cur = (draft ? S.draft.values[e.key] : valueOf(e)) ?? m.limits.heat_min;
      const base = Math.round(Math.min(m.limits.heat_max, Math.max(m.limits.heat_min, Number(cur) || m.limits.heat_min)));
      const next = Math.min(m.limits.heat_max, Math.max(m.limits.heat_min, base + Number(ds.dir)));
      if (draft) S.draft.values[e.key] = next;
      else {
        setPending(e.key, next);
        sendLater(e.key, next);
      }
      return render();
    }
    case 'fan': {
      const e = entity(ds.key);
      if (!e) return;
      if (draft) S.draft.values[e.key] = ds.v;
      else {
        setPending(e.key, ds.v);
        sendSet(e.key, ds.v);
      }
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
  if (t.dataset.field === 'scene-name') { S.draft.name = t.value; return; }
  if (t.dataset.field === 'auto-time') { S.adraft.trigger.at = t.value; return; }
  const r = t.closest('input.range[data-key]');
  if (!r) return;
  const key = r.dataset.key;
  const v = Number(r.value);
  S.dragging = key;
  clearTimeout(dragTimer);
  dragTimer = setTimeout(endDrag, 1500);
  S.lastBri[key] = v;
  if (r.dataset.mode === 'draft') S.draft.values[key] = v;
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
// Når man forlater et tekstfelt, tegnes siden på nytt med siste data.
$app.addEventListener('focusout', (ev) => {
  if (ev.target.matches?.('input[type="text"], input[type="time"]')) setTimeout(render, 0);
});

connect();
