// Oppsettsiden – kjøres inne i Home Assistant (ingress). Bruker relative stier.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = { up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', del: 'M6 6l12 12M18 6L6 18' };

const A = { st: null, cfg: null, cand: null, dirty: false };

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.errors) throw new Error(j.error || `Feil ${r.status}`);
  return j;
}

function pickCfg(st) {
  const { texts, rooms, radio, limits } = st;
  return JSON.parse(JSON.stringify({ texts, rooms, radio, limits }));
}

function message(html, err = false) {
  $('msg').innerHTML = html ? `<div class="msg ${err ? 'err' : ''}">${html}</div>` : '';
  if (html && !err) setTimeout(() => { $('msg').innerHTML = ''; }, 4000);
}

function setDirty(v = true) {
  A.dirty = v;
  const b = $('save');
  b.disabled = !v;
  b.classList.toggle('dirty', v);
  b.textContent = v ? 'Lagre endringer' : 'Alt er lagret';
}

function since(iso) {
  if (!iso) return 'Ikke brukt ennå';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `Sist brukt ${today ? 'i dag' : d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} kl. ${d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderStatus() {
  const s = A.st.status;
  const n = s.guest_clients || 0;
  const lights = A.cfg.rooms.reduce((a, r) => a + r.lights.length, 0);
  $('status').innerHTML = `
    <div class="tile"><span class="k">Home Assistant</span>
      <span class="v"><span class="dot ${s.ha_connected ? '' : 'bad'}"></span>${s.ha_connected ? 'Tilkoblet' : 'Ikke tilkoblet'}</span>
      <span class="s">${A.cfg.rooms.length} rom · ${lights} lys · ${A.cfg.radio.stations.length} radiokanaler</span></div>
    <div class="tile"><span class="k">Gjestesiden</span>
      <span class="v">${n ? `${n} har den åpen nå` : 'Ingen har den åpen nå'}</span>
      <span class="s">${esc(since(A.st.last_guest_activity))}</span></div>
    <div class="tile"><span class="k">Adresse på hjemmenettet</span>
      <span class="v">Port 8200</span>
      <span class="s">http://&lt;Home Assistant-IP&gt;:8200, eller ditt lokale navn</span></div>`;
}

// ---------- velgere ----------

function options(list, current, { none = '— Ingen —', withCaps = false } = {}) {
  let html = `<option value="">${esc(none)}</option>`;
  const groups = new Map();
  for (const it of list) {
    const g = it.area || 'Uten område';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  let found = !current;
  for (const [g, items] of groups) {
    html += `<optgroup label="${esc(g)}">`;
    for (const it of items) {
      if (it.entity_id === current) found = true;
      const caps = withCaps && it.caps?.length ? ` (${it.caps.join(', ')})` : '';
      html += `<option value="${esc(it.entity_id)}" ${it.entity_id === current ? 'selected' : ''}>${esc(it.name)}${esc(caps)}</option>`;
    }
    html += '</optgroup>';
  }
  if (!found) html += `<option value="${esc(current)}" selected>${esc(current)} (finnes ikke)</option>`;
  return html;
}

const tools = (kind, ...idx) => {
  const at = idx.join(',');
  return `<span class="tools">
    <button class="ib" data-act="up" data-kind="${kind}" data-at="${at}" aria-label="Flytt opp">${svg(ICON.up)}</button>
    <button class="ib" data-act="down" data-kind="${kind}" data-at="${at}" aria-label="Flytt ned">${svg(ICON.down)}</button>
    <button class="ib del" data-act="del" data-kind="${kind}" data-at="${at}" aria-label="Fjern">${svg(ICON.del)}</button>
  </span>`;
};

function roomHTML(r, ri) {
  const lights = r.lights.map((l, li) => `
    <div class="item">
      <select data-path="rooms.${ri}.lights.${li}.entity_id" data-fill="rooms.${ri}.lights.${li}.name" aria-label="Lys">${options(A.cand.light, l.entity_id, { none: '— Velg lys —', withCaps: true })}</select>
      <input type="text" data-path="rooms.${ri}.lights.${li}.name" value="${esc(l.name)}" placeholder="Navn gjestene ser" aria-label="Navn gjestene ser" maxlength="40">
      ${tools('light', ri, li)}
    </div>`).join('');
  return `<div class="card">
    <div class="card-head">
      <label class="f grow">Romnavn<input type="text" data-path="rooms.${ri}.name" value="${esc(r.name)}" maxlength="40"></label>
      <label class="f short">Navn på fanen<input type="text" data-path="rooms.${ri}.short" value="${esc(r.short)}" maxlength="12"></label>
      ${tools('room', ri)}
    </div>
    <div class="sub-h">Lys</div>
    <div class="items">${lights || '<p class="hint" style="margin:0">Ingen lys i dette rommet.</p>'}</div>
    <button class="add" data-act="add-light" data-at="${ri}">+ Legg til lys</button>
    <div class="sub-h">Varme</div>
    <div class="two">
      <label class="f">Termostat<select data-path="rooms.${ri}.heat.entity_id" data-fill="rooms.${ri}.heat.name">${options(A.cand.climate, r.heat?.entity_id || '')}</select></label>
      ${r.heat ? `<label class="f">Navn gjestene ser<input type="text" data-path="rooms.${ri}.heat.name" value="${esc(r.heat.name)}" maxlength="40"></label>`
        : `<label class="f">Eller bare vis temperatur fra føler<select data-path="rooms.${ri}.temp_sensor">${options(A.cand.sensor, r.temp_sensor || '')}</select></label>`}
    </div>
  </div>`;
}

function radioHTML() {
  const r = A.cfg.radio;
  const stations = r.stations.map((s, i) => `
    <div class="item station">
      <input type="text" data-path="radio.stations.${i}.name" value="${esc(s.name)}" placeholder="Navn (f.eks. NRK P1)" aria-label="Kanalnavn" maxlength="30">
      <input type="text" data-path="radio.stations.${i}.sub" value="${esc(s.sub)}" placeholder="Undertekst" aria-label="Undertekst" maxlength="30">
      <input type="text" data-path="radio.stations.${i}.media_id" value="${esc(s.media_id)}" placeholder="Kanal i Music Assistant" aria-label="Kanal i Music Assistant" maxlength="200">
      ${tools('station', i)}
    </div>`).join('');
  return `<div class="card">
    <div class="two">
      <label class="f">Høyttaler<select data-path="radio.player">${options(A.cand.media_player, r.player)}</select></label>
      <label class="f">Høyeste volum gjestene kan velge (%)<input type="number" min="5" max="100" step="5" data-path="radio.max_volume" data-num value="${esc(r.max_volume)}"></label>
    </div>
    <div class="sub-h">Kanaler</div>
    <div class="items">${stations || '<p class="hint" style="margin:0">Ingen kanaler ennå.</p>'}</div>
    <button class="add" data-act="add-station">+ Legg til kanal</button>
    <p class="hint">«Kanal i Music Assistant» er det samme du ville skrevet i <code>music_assistant.play_media</code>, for eksempel <code>NRK P1 Stor-Oslo</code>.</p>
  </div>`;
}

function render() {
  const c = A.cfg;
  $('main').innerHTML = `
    <section class="block">
      <div class="block-head"><div><h2>Rom</h2><p>Hvert rom blir en fane på gjestesiden. Bare det du legger inn her kan styres.</p></div></div>
      ${c.rooms.map(roomHTML).join('')}
      <button class="add big" data-act="add-room">+ Legg til rom</button>
    </section>
    <section class="block">
      <div class="block-head"><div><h2>Radio</h2><p>Vises som egen fane og som en liten spiller nederst.</p></div></div>
      ${radioHTML()}
    </section>
    <section class="block">
      <div class="block-head"><div><h2>Grenser og tekst</h2></div></div>
      <div class="card"><div class="two">
        <label class="f">Laveste temperatur gjestene kan velge (°)<input type="number" min="5" max="35" step="0.5" data-path="limits.heat_min" data-num value="${esc(c.limits.heat_min)}"></label>
        <label class="f">Høyeste temperatur gjestene kan velge (°)<input type="number" min="5" max="35" step="0.5" data-path="limits.heat_max" data-num value="${esc(c.limits.heat_max)}"></label>
        <label class="f">Liten tekst over hilsenen<input type="text" data-path="texts.kicker" value="${esc(c.texts.kicker)}" maxlength="40"></label>
      </div></div>
    </section>`;
  renderStatus();
}

// ---------- redigering ----------

function setPath(path, value) {
  const parts = path.split('.');
  let o = A.cfg;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (o[k] == null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[k];
  }
  o[parts.at(-1)] = value;
}
function getPath(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), A.cfg);
}
function nameOf(id) {
  for (const list of Object.values(A.cand)) {
    const hit = list.find((x) => x.entity_id === id);
    if (hit) return hit.name;
  }
  return '';
}

$('main').addEventListener('input', (ev) => {
  const el = ev.target;
  const path = el.dataset.path;
  if (!path || el.tagName === 'SELECT') return;
  setPath(path, el.dataset.num !== undefined ? Number(el.value) : el.value);
  setDirty();
});

$('main').addEventListener('change', (ev) => {
  const el = ev.target;
  const path = el.dataset.path;
  if (!path || el.tagName !== 'SELECT') return;
  const m = path.match(/^rooms\.(\d+)\.heat\.entity_id$/);
  if (m) {
    const r = A.cfg.rooms[Number(m[1])];
    r.heat = el.value ? { entity_id: el.value, name: r.heat?.name || nameOf(el.value) || 'Varme' } : null;
    if (r.heat) r.temp_sensor = '';
  } else {
    setPath(path, el.value);
    const fill = el.dataset.fill;
    if (fill && el.value && !getPath(fill)) setPath(fill, nameOf(el.value));
  }
  setDirty();
  render();
});

function listFor(kind, at) {
  const [a] = at;
  if (kind === 'room') return A.cfg.rooms;
  if (kind === 'light') return A.cfg.rooms[a].lights;
  if (kind === 'station') return A.cfg.radio.stations;
  return null;
}

$('main').addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const at = String(el.dataset.at ?? '').split(',').filter(Boolean).map(Number);
  if (act === 'add-room') A.cfg.rooms.push({ name: '', short: '', lights: [], heat: null, temp_sensor: '' });
  else if (act === 'add-light') A.cfg.rooms[at[0]].lights.push({ entity_id: '', name: '' });
  else if (act === 'add-station') A.cfg.radio.stations.push({ name: '', sub: '', media_id: '' });
  else if (['up', 'down', 'del'].includes(act)) {
    const list = listFor(el.dataset.kind, at);
    const i = at.at(-1);
    if (!list) return;
    if (act === 'del') {
      if (el.dataset.kind === 'room' && !confirm(`Fjerne rommet «${list[i].name || 'uten navn'}»?`)) return;
      list.splice(i, 1);
    } else {
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    }
  } else return;
  setDirty();
  render();
});

$('save').addEventListener('click', async () => {
  // Tomme linjer (lys uten valgt enhet, kanaler uten innhold) ryddes bort før lagring.
  const body = JSON.parse(JSON.stringify(A.cfg));
  for (const r of body.rooms) r.lights = r.lights.filter((l) => l.entity_id);
  body.radio.stations = body.radio.stations.filter((s) => s.name || s.media_id);
  $('save').disabled = true;
  try {
    const j = await api('api/admin/config', { method: 'PUT', body: JSON.stringify(body) });
    if (!j.ok) {
      $('save').disabled = false;
      return message(`Kunne ikke lagre:<ul>${j.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`, true);
    }
    A.st = j.state;
    A.cfg = pickCfg(j.state);
    setDirty(false);
    render();
    message('Lagret. Gjestesiden er oppdatert.');
  } catch (err) {
    $('save').disabled = false;
    message(esc(err.message), true);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (A.dirty) e.preventDefault();
});

async function load() {
  try {
    const [st, cand] = await Promise.all([api('api/admin/state'), api('api/admin/candidates')]);
    A.st = st;
    A.cand = cand;
    A.cfg = pickCfg(st);
    render();
  } catch (err) {
    $('main').innerHTML = `<p class="msg err">Kunne ikke laste oppsettet: ${esc(err.message)}</p>`;
  }
}

setInterval(async () => {
  if (!A.st) return;
  try {
    const st = await api('api/admin/state');
    A.st.status = st.status;
    A.st.last_guest_activity = st.last_guest_activity;
    renderStatus();
  } catch {}
}, 15000);

load();
