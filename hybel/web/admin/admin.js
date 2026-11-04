// Utleiersiden – kjøres inne i Home Assistant (ingress). Bruker relative stier.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deg = (t) => (t == null ? '–' : String(t).replace('.', ',') + '°');

const DEFAULTS = {
  light: { Hjemme: 80, Kveld: 35, Natt: 0, Borte: 0 },
  heat: { Hjemme: 21, Kveld: 22, Natt: 20, Borte: 18 },
  vent: { Hjemme: 'normal', Kveld: 'low', Natt: 'low', Borte: 'away' }
};
const VENT_LABEL = { away: 'Borte', low: 'Lav', normal: 'Normal', high: 'Høy' };
const KIND_LABEL = { light: 'Lys', heat: 'Varme', vent: 'Ventilasjon', climate: 'Varmepumpe', button: 'Knapp' };
const BOOST_STEPS = [15, 30, 60, 90, 120];

const A = {
  st: null,
  cfg: null,
  dirty: false,
  cand: null,
  picker: null,       // 'entity' | 'alarm' | null
  q: '',
  resetScenes: false,
  confirmScenes: false,
  confirmReset: false
};

const svg = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.errors) throw new Error(j.error || `Feil ${r.status}`);
  return j;
}

function pickCfg(st) {
  return JSON.parse(JSON.stringify({
    entities: st.entities.map(({ entity_id, label, kind, enabled, min_pct, max_pct, min_temp, max_temp }) => ({ entity_id, label, kind, enabled, ...(kind === 'light' ? { min_pct: min_pct ?? 1, max_pct: max_pct ?? 100 } : {}), ...(kind === 'heat' || kind === 'climate' ? { min_temp: min_temp ?? st.limits.heat_min, max_temp: max_temp ?? st.limits.heat_max } : {}) })),
    limits: st.limits,
    tenant_can_edit_scenes: st.tenant_can_edit_scenes,
    alerts: st.alerts
  }));
}

function message(text, err = false) {
  $('msg').innerHTML = text ? `<div class="msg ${err ? 'err' : ''}">${text}</div>` : '';
  if (text && !err) setTimeout(() => { if ($('msg').textContent === text.replace(/<[^>]+>/g, '')) $('msg').innerHTML = ''; }, 4000);
}

function setDirty(v = true) {
  A.dirty = v;
  const b = $('save');
  b.disabled = !v;
  b.classList.toggle('dirty', v);
  b.textContent = v ? 'Lagre endringer' : 'Alt er lagret';
}

// ---------- status ----------

function since(iso) {
  if (!iso) return 'Ikke brukt ennå';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `Sist brukt ${today ? 'i dag' : d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderStatus() {
  const s = A.st.status;
  const tc = s.tenant_clients || 0;
  $('status').innerHTML = `
    <div class="tile"><span class="k">Home Assistant</span>
      <span class="v"><span class="dot ${s.ha_connected ? '' : 'bad'}"></span>${s.ha_connected ? 'Tilkoblet' : 'Ikke tilkoblet'}</span>
      <span class="s">${A.st.entities.filter((e) => e.enabled).length} enheter synlige for leietaker</span></div>
    <div class="tile"><span class="k">Leietakersiden</span>
      <span class="v">${tc ? `${tc} åpen nå` : 'Ingen åpen nå'}</span>
      <span class="s">${esc(since(s.last_tenant_activity))}</span></div>
    <div class="tile"><span class="k">Aktiv scene</span>
      <span class="v">${esc((s.active_scenes || []).join(' · ') || 'Ingen')}</span>
      <span class="s">${s.boost ? `Høy ventilasjon til kl. ${new Date(s.boost.until).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}` : 'Ingen tidsbegrensede endringer'}</span></div>`;
}

// ---------- hovedvisning ----------


function entitiesPanel() {
  const ents = A.cfg.entities;
  const live = new Map(A.st.entities.map((e) => [e.entity_id, e]));
  let h = `<section class="panel"><div class="panel-head"><h2>Synlige enheter</h2><span>Leietakeren ser bare det som er slått på her</span></div>`;
  if (!ents.length) h += `<p class="help">Ingen enheter ennå. Legg til lys, termostat og ventilasjon for hybelen.</p>`;
  ents.forEach((e, i) => {
    const l = live.get(e.entity_id);
    const now = l && e.enabled && l.value != null ? (e.kind === 'light' ? (l.value ? `på ${l.value} %` : 'av') : e.kind === 'heat' ? `satt til ${deg(l.value)}` : VENT_LABEL[l.value] || '') : '';
    h += `<div class="ent ${e.enabled ? '' : 'off'}">
      <button class="switch" role="switch" aria-checked="${e.enabled}" aria-label="Vis ${esc(e.label)} for leietaker" data-act="ent-toggle" data-i="${i}"></button>
      <div class="fields"><label for="lbl-${i}">Navn leietakeren ser</label>
        <input id="lbl-${i}" class="input" type="text" maxlength="40" value="${esc(e.label)}" data-field="label" data-i="${i}"></div>
      <div class="meta">
        ${e.entity_id.startsWith('event.') ? `<span style="font-size:14px;font-weight:600">Trådløs knapp</span><span class="help">Brukes i leietakerens automasjoner</span>` : e.entity_id.startsWith('climate.')
          ? `<select class="select" aria-label="Type" data-field="kind" data-i="${i}"><option value="heat" ${e.kind === 'heat' ? 'selected' : ''}>Varme (termostat)</option><option value="climate" ${e.kind === 'climate' ? 'selected' : ''}>Varmepumpe / klima</option><option value="vent" ${e.kind === 'vent' ? 'selected' : ''}>Ventilasjon</option></select>
            ${e.kind !== 'vent' ? `<span class="range-pair"><label>Lavest <input class="input num-in" type="number" min="5" max="34" value="${e.min_temp ?? A.cfg.limits.heat_min}" data-field="min_temp" data-i="${i}" aria-label="Laveste temperatur for ${esc(e.label)}">°</label>
              <label>Høyest <input class="input num-in" type="number" min="6" max="35" value="${e.max_temp ?? A.cfg.limits.heat_max}" data-field="max_temp" data-i="${i}" aria-label="Høyeste temperatur for ${esc(e.label)}">°</label></span>` : ''}`
          : `<span class="range-pair"><span style="font-size:14px;font-weight:600">Lys</span>
              <label>Lavest <input class="input num-in" type="number" min="1" max="99" value="${e.min_pct ?? 1}" data-field="min_pct" data-i="${i}" aria-label="Laveste ekte lysstyrke for ${esc(e.label)}">%</label>
              <label>Høyest <input class="input num-in" type="number" min="2" max="100" value="${e.max_pct ?? 100}" data-field="max_pct" data-i="${i}" aria-label="Høyeste ekte lysstyrke for ${esc(e.label)}">%</label></span>`}
        <span class="mono">${esc(e.entity_id)}${now ? ` · ${esc(now)}` : ''}${l && !l.available ? ' · utilgjengelig' : ''}</span>
      </div>
      <div class="tools">
        <button class="tool" data-act="ent-up" data-i="${i}" aria-label="Flytt opp" ${i === 0 ? 'disabled' : ''}>${svg('M6 15l6-6 6 6')}</button>
        <button class="tool" data-act="ent-down" data-i="${i}" aria-label="Flytt ned" ${i === ents.length - 1 ? 'disabled' : ''}>${svg('M6 9l6 6 6-6')}</button>
        <button class="tool" data-act="ent-remove" data-i="${i}" aria-label="Fjern ${esc(e.label)}">${svg('M6 6l12 12M18 6L6 18')}</button>
      </div>
    </div>`;
  });
  h += A.picker === 'entity' ? pickerHTML('entity') : `<button class="add" data-act="open-picker" data-kind="entity">+ Legg til enhet fra Home Assistant</button>`;
  return h + `</section>`;
}

function pickerHTML(kind) {
  if (!A.cand) return `<div class="picker"><p class="help">Henter enheter …</p></div>`;
  const q = A.q.trim().toLowerCase();
  const taken = new Set(kind === 'entity' ? A.cfg.entities.map((e) => e.entity_id) : A.cfg.alerts.entities);
  const list = A.cand.entities
    .filter((c) => (kind === 'entity' ? c.domain !== 'binary_sensor' : c.domain === 'binary_sensor'))
    .filter((c) => !taken.has(c.entity_id))
    .filter((c) => !q || `${c.name} ${c.entity_id} ${c.area}`.toLowerCase().includes(q))
    .slice(0, 80);
  return `<div class="picker">
    <div style="display:flex;gap:8px">
      <input class="input" type="search" placeholder="Søk etter navn, område eller entitet …" value="${esc(A.q)}" data-field="q" aria-label="Søk" autofocus>
      <button class="sbtn" data-act="close-picker">Lukk</button>
    </div>
    <div class="picker-list">${list.length ? list.map((c) => `
      <button class="pick" data-act="pick" data-kind="${kind}" data-id="${esc(c.entity_id)}">
        <span><span class="n">${esc(c.name)}</span><span class="mono">${esc(c.entity_id)}</span></span>
        <span class="a">${esc(c.area || '')}${c.kind && kind === 'entity' ? ` · ${KIND_LABEL[c.kind]}` : ''}</span>
      </button>`).join('') : '<p class="help" style="padding:8px">Ingen treff.</p>'}</div>
  </div>`;
}

function scenesPanel() {
  const st = A.st;
  const days = (d) => d.length === 7 ? 'hver dag' : d.join() === '1,2,3,4,5' ? 'hverdager' : d.join() === '6,7' ? 'helg' : d.map((n) => ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'][n - 1]).join(', ');
  let h = `<section class="panel"><div class="panel-head"><h2>Leietakers scener</h2><span>Leietakeren lager og endrer disse selv</span></div>`;
  if (!st.scenes.length) h += `<p class="help">Ingen scener ennå. Forslag lages automatisk når enhetene er lagt inn.</p>`;
  for (const sc of st.scenes) {
    h += `<div class="srow"><span class="lbl">${esc(sc.name)}</span><span class="ctl" style="justify-content:space-between">
      <span class="help">${esc(sc.parts.join(', ') || 'ingen enheter')}</span>
      <button class="sbtn" data-act="apply-scene" data-id="${esc(sc.id)}">Bruk nå</button></span></div>`;
  }
  h += `<h2 style="font-size:20px;margin-top:18px">Automasjoner</h2>`;
  h += st.automations.length
    ? st.automations.map((a) => `<div class="srow"><span class="lbl" style="${a.enabled ? '' : 'opacity:.5'}">${esc(a.label)}</span><span class="help">${esc(days(a.days))}${a.enabled ? '' : ' · av'}</span></div>`).join('')
    : `<p class="help">Ingen automasjoner ennå.</p>`;
  h += `<div class="row-btns">
      <button class="sbtn" data-act="reset-scenes">${A.resetScenes ? 'Tilbakestilles ved lagring ✓' : A.confirmScenes ? 'Trykk igjen for å bekrefte' : 'Tilbakestill scener til forslag'}</button>
    </div>
    <button class="toggle-row" data-act="toggle-tenant-edit" style="margin-top:10px">
      <span><span class="t">Leietaker kan lage og endre scener og automasjoner</span><span class="s">Av: leietakeren kan bare bruke scenene som finnes</span></span>
      <span class="switch" role="switch" aria-checked="${A.cfg.tenant_can_edit_scenes}"></span>
    </button>
  </section>`;
  return h;
}

function limitsPanel() {
  const L = A.cfg.limits;
  const row = (key, label, hint, val, decDis, incDis) => `<div class="limit-row">
    <span><span class="t">${label}</span><span class="s">${hint}</span></span>
    <span class="stepper sm"><button data-act="limit" data-key="${key}" data-dir="-1" aria-label="Senk ${label.toLowerCase()}" ${decDis ? 'disabled' : ''}>−</button><output>${val}</output><button data-act="limit" data-key="${key}" data-dir="1" aria-label="Øk ${label.toLowerCase()}" ${incDis ? 'disabled' : ''}>+</button></span>
  </div>`;
  const bi = BOOST_STEPS.indexOf(L.boost_max_minutes);
  return `<section class="panel"><div class="panel-head"><h2>Grenser</h2></div>
    <p class="help" style="margin:0 0 6px">Temperaturgrenser settes per enhet under «Synlige enheter».</p>
    ${row('boost', 'Høy ventilasjon maks', 'Går tilbake automatisk etter', `${L.boost_max_minutes} min`, bi <= 0, bi >= BOOST_STEPS.length - 1)}
    <button class="toggle-row" data-act="toggle-away" style="border-top:1px solid var(--line);margin-top:6px">
      <span><span class="t">Leietaker kan velge Borte på ventilasjon</span><span class="s">Lav drift når hybelen står tom</span></span>
      <span class="switch teal" role="switch" aria-checked="${L.vent_allow_away}"></span>
    </button>
  </section>`;
}

function alertsPanel() {
  const al = A.cfg.alerts;
  const names = new Map((A.cand?.entities || []).map((c) => [c.entity_id, c.name]));
  return `<section class="panel"><div class="panel-head"><h2>Varsle meg</h2></div>
    <label for="notify" class="help">Varslingstjeneste (tom = varsel i Home Assistant)</label>
    <input id="notify" class="input" list="notify-list" placeholder="notify.mobile_app_telefon" value="${esc(al.notify_service)}" data-field="notify">
    <datalist id="notify-list">${(A.cand?.notify_services || []).map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <span class="help" style="margin-top:10px">Varsle når disse slår seg på (f.eks. filter- eller frostalarm):</span>
    <div class="chips">${al.entities.map((id) => `<span class="chip">${esc(names.get(id) || id)}<button data-act="alarm-remove" data-id="${esc(id)}" aria-label="Fjern">×</button></span>`).join('') || '<span class="help">Ingen valgt.</span>'}</div>
    ${A.picker === 'alarm' ? pickerHTML('alarm') : `<button class="add" data-act="open-picker" data-kind="alarm">+ Legg til alarm</button>`}
  </section>`;
}

function resetPanel() {
  return `<section class="panel soft"><h2>Leietakerbytte</h2>
    <p class="help">Sletter leietakerens scener og automasjoner og lager nye forslag. Husk å fjerne forrige leietaker i Cloudflare Access og legge inn den nye.</p>
    <button class="danger ${A.confirmReset ? 'confirm' : ''}" data-act="tenant-reset">${A.confirmReset ? 'Trykk igjen for å bekrefte' : 'Klargjør for ny leietaker'}</button>
  </section>
  <section class="panel soft"><h2>Oppsett</h2>
    <p class="help">Leietakersiden kjører på port <code>8100</code> inne i Home Assistant. Pek Cloudflare Tunnel til <code>http://&lt;vertsnavn&gt;:8100</code> – vertsnavnet står på appens infoside. Se dokumentasjonen for steg-for-steg.</p>
  </section>`;
}

function render() {
  if (!A.cfg) return;
  const focusId = document.activeElement?.id || (document.activeElement?.dataset?.field === 'q' ? '__q' : null);
  $('main').innerHTML = `<div class="col-main">${entitiesPanel()}${scenesPanel()}</div><div class="col-side">${limitsPanel()}${alertsPanel()}${resetPanel()}</div>`;
  if (focusId === '__q') {
    const q = document.querySelector('[data-field="q"]');
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  } else if (focusId) document.getElementById(focusId)?.focus();
}

// ---------- handlinger ----------

async function loadCandidates() {
  if (A.cand) return;
  try {
    A.cand = await api('api/admin/candidates');
  } catch (e) {
    message('Kunne ikke hente enheter: ' + esc(e.message), true);
    A.cand = { entities: [], notify_services: [] };
  }
  render();
}


document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b || b.disabled || !A.cfg) return;
  const d = b.dataset;
  const ents = A.cfg.entities;
  const i = Number(d.i);
  if (d.act !== 'tenant-reset') A.confirmReset = false;
  if (d.act !== 'reset-scenes') A.confirmScenes = false;
  switch (d.act) {
    case 'ent-toggle': ents[i].enabled = !ents[i].enabled; setDirty(); break;
    case 'ent-up': [ents[i - 1], ents[i]] = [ents[i], ents[i - 1]]; setDirty(); break;
    case 'ent-down': [ents[i + 1], ents[i]] = [ents[i], ents[i + 1]]; setDirty(); break;
    case 'ent-remove': ents.splice(i, 1); setDirty(); break;
    case 'open-picker': A.picker = d.kind; A.q = ''; render(); loadCandidates(); return;
    case 'close-picker': A.picker = null; break;
    case 'pick': {
      const c = A.cand.entities.find((x) => x.entity_id === d.id);
      if (!c) return;
      if (d.kind === 'entity') ents.push({ entity_id: c.entity_id, label: c.name.slice(0, 40), kind: c.kind, enabled: true, ...(c.kind === 'light' ? { min_pct: 1, max_pct: 100 } : {}), ...(c.kind === 'heat' || c.kind === 'climate' ? { min_temp: c.kind === 'climate' ? 16 : A.cfg.limits.heat_min, max_temp: c.kind === 'climate' ? 26 : A.cfg.limits.heat_max } : {}) });
      else A.cfg.alerts.entities.push(c.entity_id);
      A.picker = null;
      setDirty();
      break;
    }
    case 'alarm-remove': A.cfg.alerts.entities = A.cfg.alerts.entities.filter((x) => x !== d.id); setDirty(); break;
    case 'toggle-tenant-edit': A.cfg.tenant_can_edit_scenes = !A.cfg.tenant_can_edit_scenes; setDirty(); break;
    case 'toggle-away': A.cfg.limits.vent_allow_away = !A.cfg.limits.vent_allow_away; setDirty(); break;
    case 'limit': {
      const L = A.cfg.limits;
      const dir = Number(d.dir);
      if (d.key === 'heat_max') L.heat_max = Math.min(35, Math.max(L.heat_min + 1, L.heat_max + dir));
      if (d.key === 'heat_min') L.heat_min = Math.min(L.heat_max - 1, Math.max(5, L.heat_min + dir));
      if (d.key === 'boost') {
        const idx = Math.min(BOOST_STEPS.length - 1, Math.max(0, BOOST_STEPS.indexOf(L.boost_max_minutes) + dir));
        L.boost_max_minutes = BOOST_STEPS[idx];
      }
      setDirty();
      break;
    }
    case 'reset-scenes':
      if (A.resetScenes) break;
      if (!A.confirmScenes) { A.confirmScenes = true; break; }
      A.confirmScenes = false; A.resetScenes = true; setDirty(); break;
    case 'apply-scene':
      try {
        const r = await api('api/admin/apply-scene', { method: 'POST', body: JSON.stringify({ id: d.id }) });
        message(r.ok ? 'Scenen er satt i hybelen.' : esc(r.error), !r.ok);
      } catch (e) { message(esc(e.message), true); }
      return;
    case 'tenant-reset':
      if (!A.confirmReset) { A.confirmReset = true; break; }
      A.confirmReset = false;
      try {
        await api('api/admin/tenant-reset', { method: 'POST', body: '{}' });
        message('Klar for ny leietaker. Husk Cloudflare Access.');
        await refresh(true);
      } catch (e) { message(esc(e.message), true); }
      break;
  }
  render();
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  const f = el.dataset?.field;
  if (!f || !A.cfg) return;
  if (f === 'label') { A.cfg.entities[Number(el.dataset.i)].label = el.value; setDirty(); }
  else if (['min_pct', 'max_pct', 'min_temp', 'max_temp'].includes(f)) { A.cfg.entities[Number(el.dataset.i)][f] = Number(el.value); setDirty(); }
  else if (f === 'notify') { A.cfg.alerts.notify_service = el.value.trim(); setDirty(); }
  else if (f === 'q') { A.q = el.value; render(); }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const f = el.dataset?.field;
  if (!f || !A.cfg) return;
  if (f === 'kind') { A.cfg.entities[Number(el.dataset.i)].kind = el.value; setDirty(); render(); }
});

$('save').addEventListener('click', async () => {
  const body = { ...A.cfg, reset_scenes: A.resetScenes };
  try {
    const r = await api('api/admin/config', { method: 'PUT', body: JSON.stringify(body) });
    A.st = r.state;
    if (r.ok) {
      A.cfg = pickCfg(r.state);
      A.resetScenes = false;
      setDirty(false);
      message('Lagret. Leietakersiden er oppdatert.');
    } else {
      message(r.errors.map(esc).join('<br>'), true);
    }
    renderStatus();
    render();
  } catch (e) {
    message('Kunne ikke lagre: ' + esc(e.message), true);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (A.dirty) { e.preventDefault(); e.returnValue = ''; }
});

async function refresh(full = false) {
  try {
    const st = await api('api/admin/state');
    A.st = st;
    if (full || !A.cfg || !A.dirty) {
      const first = !A.cfg;
      A.cfg = pickCfg(st);
      if (first || full) render();
      else if (!document.activeElement || document.activeElement === document.body) render();
    }
    renderStatus();
  } catch (e) {
    message('Mistet kontakt med appen: ' + esc(e.message), true);
  }
}

refresh(true);
loadCandidates();
setInterval(() => refresh(false), 5000);
