// Leietakersiden – ren JavaScript, ingen rammeverk.
const $app = document.getElementById('app');

// Sperr zoom (iOS Safari ignorerer user-scalable=no).
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350 && !e.target.closest('input')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

const S = {
  m: null,            // siste tilstand fra serveren
  view: 'main',       // main | settings | edit
  editName: null,
  draft: null,
  pending: {},        // key -> { v, t } (optimistisk visning mens HA svarer)
  lastBri: {},
  toast: null,
  conn: 'connecting', // connecting | ok | lost | relogin
  fails: 0,
  dragging: null,
  deferred: false
};

const ICON = {
  Hjemme: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  Kveld: 'M12 3v2M5.6 5.6l1.4 1.4M3 12h2M19 12h2M17 7l1.4-1.4M7 16a5 5 0 1 1 10 0z',
  Natt: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  Borte: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3'
};
const VENT_LABEL = { away: 'Borte', low: 'Lav', normal: 'Normal', high: 'Høy' };
const VENT_LEVEL = { away: 0, low: 1, normal: 2, high: 3 };

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
function sendLater(key, value, ms = 350) {
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

let toastTimer;
function showToast(msg, error = false) {
  S.toast = { msg, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    S.toast = null;
    render();
  }, error ? 5000 : 3000);
  render();
}

// ---------- visning ----------

function summary(vals) {
  const ents = S.m.entities;
  const parts = [];
  const h = ents.find((e) => e.kind === 'heat');
  if (h && vals[h.key] != null) parts.push(deg(vals[h.key]));
  const v = ents.find((e) => e.kind === 'vent');
  if (v && vals[v.key]) parts.push('luft ' + VENT_LABEL[vals[v.key]].toLowerCase());
  const lights = ents.filter((e) => e.kind === 'light');
  if (lights.length) {
    const n = lights.filter((l) => vals[l.key] > 0).length;
    parts.push(n ? `${n} lys` : 'lys av');
  }
  return parts.join(' · ');
}

function kicker() {
  if (S.conn !== 'ok') return ['warn', 'Kobler til …'];
  if (!S.m.connected) return ['bad', 'Mistet kontakt med huset'];
  return ['', 'Tilkoblet'];
}

function topHTML() {
  const [cls, text] = kicker();
  return `<header class="top">
    <div>
      <span class="kicker ${cls}"><span class="dot ${cls}"></span>${text}</span>
      <h1>${esc(S.m.active_scene && S.m.matches ? S.m.active_scene : 'Hybelen')}</h1>
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

function controlsHTML(mode) {
  const m = S.m;
  const draft = mode === 'draft';
  const val = (e) => (draft ? S.draft[e.key] ?? e.value : valueOf(e));
  let html = '';

  const lights = m.entities.filter((e) => e.kind === 'light');
  if (lights.length) {
    html += `<section class="card section"><div class="section-head"><h2>Lys</h2>
      <button class="chip-btn" data-act="all-off" data-mode="${mode}" data-fid="alloff">Slå av alle</button></div>`;
    for (const e of lights) {
      const v = val(e) ?? 0;
      const on = v > 0;
      const live = draft || e.available;
      const status = !live ? 'Svarer ikke' : on ? (e.dimmable ? `På · ${v} %` : 'På') : 'Av';
      html += `<div class="light ${live ? '' : 'unavail'}">
        <div class="row">
          <span><span class="name">${esc(e.label)}</span><span class="status" data-status="${e.key}">${status}</span></span>
          <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(e.label)}" data-act="toggle" data-key="${e.key}" data-mode="${mode}" data-fid="t-${e.key}" ${live ? '' : 'disabled'}></button>
        </div>
        ${on && e.dimmable && live ? `<input class="range" type="range" min="1" max="100" step="1" value="${v}" aria-label="Lysstyrke ${esc(e.label)}" data-key="${e.key}" data-mode="${mode}" data-fid="r-${e.key}">` : ''}
      </div>`;
    }
    html += `</section>`;
  }

  for (const e of m.entities.filter((x) => x.kind === 'heat')) {
    const v = val(e);
    const live = draft || e.available;
    const atMax = v != null && v >= m.limits.heat_max;
    const atMin = v != null && v <= m.limits.heat_min;
    const limitText = !live ? 'Termostaten svarer ikke akkurat nå'
      : atMax ? `Maks ${m.limits.heat_max}° – satt av utleier`
      : atMin ? `Minimum ${m.limits.heat_min}° – beskytter mot fukt`
      : `Kan stilles mellom ${m.limits.heat_min}° og ${m.limits.heat_max}°`;
    const now = e.current != null ? `Nå ${deg(e.current)}${e.heating ? ' · varmer' : ''}` : '';
    html += `<section class="card heat ${live ? '' : 'unavail'}">
      <div class="row">
        <span><span class="title">${esc(e.label)}</span><span class="muted" style="font-size:13px">${draft ? 'Ønsket temperatur' : now}</span></span>
        <span class="stepper">
          <button data-act="heat" data-dir="-1" data-key="${e.key}" data-mode="${mode}" data-fid="hd-${e.key}" aria-label="Senk temperatur" ${!live || atMin ? 'disabled' : ''}>−</button>
          <output aria-live="polite">${deg(v)}</output>
          <button data-act="heat" data-dir="1" data-key="${e.key}" data-mode="${mode}" data-fid="hu-${e.key}" aria-label="Øk temperatur" ${!live || atMax ? 'disabled' : ''}>+</button>
        </span>
      </div>
      <div class="limit ${atMax || atMin ? 'hit' : ''}">${limitText}</div>
    </section>`;
  }

  for (const e of m.entities.filter((x) => x.kind === 'vent')) {
    const v = val(e);
    const live = draft || e.available;
    const meta = [e.humidity != null ? `Luftfukt ${Math.round(e.humidity)} %` : '', e.temperature != null ? deg(e.temperature) : ''].filter(Boolean).join(' · ');
    html += `<section class="vent ${live ? '' : 'unavail'}">
      <div class="section-head"><h2>${esc(e.label)}</h2><span class="meta">${live ? meta : 'Svarer ikke'}</span></div>
      <div class="fans" style="grid-template-columns: repeat(${e.modes.length}, minmax(0, 1fr))">
        ${e.modes.map((mo) => {
          const lvl = VENT_LEVEL[mo];
          const bars = [8, 14, 20].map((h, i) => `<i class="${i < lvl ? 'on' : ''}" style="height:${h}px"></i>`).join('');
          return `<button class="fan" aria-pressed="${v === mo}" data-act="fan" data-key="${e.key}" data-v="${mo}" data-mode="${mode}" data-fid="f-${e.key}-${mo}" ${live ? '' : 'disabled'}><span class="bars">${bars}</span>${VENT_LABEL[mo]}</button>`;
        }).join('')}
      </div>
      ${!draft && v === 'high' && m.boost && m.boost.key === e.key ? `<div class="boost">${svg('M12 9v4l2.5 2M9 2h6M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0z', 18, 2)}<span>Høy til kl. ${clock(m.boost.until)}, så tilbake til ${VENT_LABEL[m.boost.return_to].toLowerCase()}</span></div>` : ''}
    </section>`;
  }

  if (!m.entities.length) {
    html += `<section class="card section"><p class="intro" style="padding:18px 0">Ingen enheter er satt opp ennå. Ta kontakt med utleier.</p></section>`;
  }
  return html;
}

function mainHTML() {
  const m = S.m;
  let html = topHTML();
  html += `<div class="scenes">${m.scene_names.map((n) => `
    <button class="scene" aria-pressed="${m.active_scene === n && m.matches}" data-act="scene" data-name="${n}" data-fid="s-${n}" title="${esc(summary(m.scenes[n]))}">
      ${svg(ICON[n], 20)}<span class="name">${n}</span>
    </button>`).join('')}</div>`;
  html += toastHTML();
  html += controlsHTML('live');
  return html;
}

function settingsHTML() {
  const m = S.m;
  let html = subHTML('Hybelen', 'Innstillinger');
  html += `<section><h2 class="group-title">Scener – hva skjer når du trykker</h2><div class="list">`;
  for (const n of m.scene_names) {
    const inner = `<span><span class="t">${n}</span><span class="s">${esc(summary(m.scenes[n]))}</span></span>`;
    html += m.can_edit
      ? `<button class="list-row" data-act="edit" data-name="${n}" data-fid="e-${n}">${inner}${svg('M9 5l7 7-7 7', 18, 2)}</button>`
      : `<div class="list-row">${inner}</div>`;
  }
  html += `</div>${m.can_edit ? '' : '<p class="note">Scenene er satt av utleier.</p>'}</section>`;

  const hasVent = m.entities.some((e) => e.kind === 'vent');
  html += `<section><h2 class="group-title">Midlertidige endringer</h2><div class="card" style="border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:14px">`;
  if (hasVent && m.boost_options.length) {
    html += `<span style="font-size:15px">Høy ventilasjon går tilbake etter</span>
      <div class="seg" style="grid-template-columns: repeat(${m.boost_options.length}, minmax(0, 1fr))">
      ${m.boost_options.map((o) => `<button aria-pressed="${m.prefs.boost_minutes === o}" data-act="boost" data-min="${o}" data-fid="b-${o}">${o} min</button>`).join('')}</div>`;
  }
  html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <span><span style="font-size:15px;font-weight:600;display:block">Tilbake til scenen om natten</span><span class="muted" style="font-size:13px">Glemte endringer nullstilles kl. 03</span></span>
      <button class="switch teal" role="switch" aria-checked="${m.prefs.night_reset}" aria-label="Tilbake til scenen om natten" data-act="night" data-fid="night"></button>
    </div></div></section>`;

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

function editHTML() {
  const n = S.editName;
  let html = subHTML('Standard for scenen', n);
  html += `<p class="intro">Slik blir det hver gang du trykker på ${esc(n)}. Endringer du gjør på forsiden påvirker ikke dette.</p>`;
  html += controlsHTML('draft');
  html += `<div class="actions">
    <button class="btn ghost big" data-act="factory" data-fid="factory">Utleiers standard</button>
    <button class="btn primary big" data-act="save-edit" data-fid="saveedit">Lagre ${esc(n)}</button>
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
  if (S.view === 'edit' && !S.draft) S.view = 'settings';
  const fid = document.activeElement?.dataset?.fid;
  $app.innerHTML = S.view === 'settings' ? settingsHTML() : S.view === 'edit' ? editHTML() : mainHTML();
  if (fid) $app.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
}

// ---------- handlinger ----------

function entity(key) {
  return S.m.entities.find((e) => e.key === key);
}

function act(a, ds) {
  const m = S.m;
  const draft = ds.mode === 'draft';
  switch (a) {
    case 'relogin':
      location.reload();
      return;
    case 'settings':
      S.view = 'settings';
      window.scrollTo(0, 0);
      return render();
    case 'back':
      if (S.view === 'edit') {
        S.view = 'settings';
        S.draft = null;
      } else S.view = 'main';
      window.scrollTo(0, 0);
      return render();
    case 'scene': {
      const n = ds.name;
      for (const [key, v] of Object.entries(m.scenes[n] || {})) setPending(key, v);
      m.active_scene = n;
      m.matches = true;
      render();
      cmd({ type: 'scene', name: n }).then((r) => r.ok && showToast(`${n} er satt`));
      return;
    }
    case 'revert':
      for (const [key, v] of Object.entries(m.scenes[m.active_scene] || {})) setPending(key, v);
      m.matches = true;
      render();
      cmd({ type: 'revert' });
      return;
    case 'save-current':
      cmd({ type: 'save_current' }).then((r) => r.ok && showToast(`${m.active_scene} er oppdatert med disse innstillingene`));
      return;
    case 'toggle': {
      const e = entity(ds.key);
      if (!e) return;
      const cur = draft ? S.draft[e.key] ?? 0 : valueOf(e) ?? 0;
      const next = cur > 0 ? 0 : S.lastBri[e.key] || (e.dimmable ? 60 : 100);
      if (cur > 0) S.lastBri[e.key] = cur;
      if (draft) S.draft[e.key] = next;
      else {
        setPending(e.key, next);
        sendSet(e.key, next);
      }
      return render();
    }
    case 'all-off':
      for (const e of m.entities.filter((x) => x.kind === 'light')) {
        if (draft) S.draft[e.key] = 0;
        else {
          const cur = valueOf(e);
          if (cur > 0) S.lastBri[e.key] = cur;
          setPending(e.key, 0);
        }
      }
      if (!draft) cmd({ type: 'all_off' });
      return render();
    case 'heat': {
      const e = entity(ds.key);
      if (!e) return;
      const cur = (draft ? S.draft[e.key] : valueOf(e)) ?? m.limits.heat_min;
      const base = Math.round(Math.min(m.limits.heat_max, Math.max(m.limits.heat_min, Number(cur) || m.limits.heat_min)));
      const next = Math.min(m.limits.heat_max, Math.max(m.limits.heat_min, base + Number(ds.dir)));
      if (draft) S.draft[e.key] = next;
      else {
        setPending(e.key, next);
        sendLater(e.key, next);
      }
      return render();
    }
    case 'fan': {
      const e = entity(ds.key);
      if (!e) return;
      if (draft) S.draft[e.key] = ds.v;
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
    case 'night':
      m.prefs.night_reset = !m.prefs.night_reset;
      render();
      cmd({ type: 'prefs', night_reset: m.prefs.night_reset });
      return;
    case 'edit':
      S.editName = ds.name;
      S.draft = { ...m.scenes[ds.name] };
      S.view = 'edit';
      window.scrollTo(0, 0);
      return render();
    case 'factory':
      S.draft = { ...m.factory[S.editName] };
      return render();
    case 'save-edit': {
      const n = S.editName;
      cmd({ type: 'save_scene', name: n, values: S.draft }).then((r) => {
        if (!r.ok) return;
        S.view = 'main';
        S.draft = null;
        window.scrollTo(0, 0);
        showToast(`${n} er oppdatert`);
      });
      return;
    }
  }
}

$app.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b || b.disabled || !S.m && b.dataset.act !== 'relogin') return;
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
  const r = ev.target.closest('input.range[data-key]');
  if (!r) return;
  const key = r.dataset.key;
  const v = Number(r.value);
  S.dragging = key;
  clearTimeout(dragTimer);
  dragTimer = setTimeout(endDrag, 1500);
  S.lastBri[key] = v;
  if (r.dataset.mode === 'draft') S.draft[key] = v;
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

connect();
