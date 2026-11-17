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
  replies: {},
  compose: '',
  clOpen: null,
  clComment: {},
  photo: null,
  newReading: { value: '', date: '' },
  confirmDel: null,
  mt: { title: '', months: 6, tenant: false },
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
    entities: st.entities.map(({ entity_id, label, kind, enabled, min_pct, max_pct, min_temp, max_temp, now_sensor, all_off }) => ({ entity_id, label, kind, enabled, ...(now_sensor ? { now_sensor } : {}), ...(all_off === false ? { all_off: false } : {}), ...(kind === 'light' ? { min_pct: min_pct ?? 1, max_pct: max_pct ?? 100 } : {}), ...(kind === 'heat' || kind === 'climate' ? { min_temp: min_temp ?? st.limits.heat_min, max_temp: max_temp ?? st.limits.heat_max } : {}) })),
    limits: st.limits,
    tenant_can_edit_scenes: st.tenant_can_edit_scenes,
    pairing_enabled: st.pairing.enabled,
    outdoor_sensor: st.outdoor.set,
    stat_sensors: (st.stat_sensors || []).map((c) => ({ ...c })),
    stat_hidden: [...(st.stat_hidden || [])],
    stat_order: [...(st.stat_order || [])],
    fixed_button: st.fixed_button || { entity_id: '', n: 1, light: '' },
    alerts: st.alerts,
    info: st.extras.info,
    electricity: { price_per_kwh: st.extras.electricity.price, note: st.extras.electricity.note },
    checklist_template: st.extras.checklist_template,
    clean_template: st.extras.clean_template,
    lease: st.extras.lease.settings
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


// Velg hvilken føler «Nå»-temperaturen skal hentes fra. Følere fra samme enhet sorteres først.
function sensorSelect(e, i) {
  const list = A.cand?.temp_sensors || [];
  if (!list.length && !e.now_sensor) return '';
  const base = e.entity_id.split('.')[1];
  const sorted = [...list].sort((a, b) => (b.entity_id.includes(base) - a.entity_id.includes(base)) || a.name.localeCompare(b.name, 'nb'));
  const opts = sorted.map((s) => `<option value="${esc(s.entity_id)}" ${e.now_sensor === s.entity_id ? 'selected' : ''}>${esc(s.name)} (${esc(s.state)}°)</option>`).join('');
  return `<label class="sensor-pick">«Nå» fra <select class="select" data-field="now_sensor" data-i="${i}" aria-label="Føler for ${esc(e.label)}">
    <option value="">Termostaten selv</option>${opts}</select></label>`;
}

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
              <label>Høyest <input class="input num-in" type="number" min="6" max="35" value="${e.max_temp ?? A.cfg.limits.heat_max}" data-field="max_temp" data-i="${i}" aria-label="Høyeste temperatur for ${esc(e.label)}">°</label></span>
              ${sensorSelect(e, i)}` : ''}`
          : `<span class="range-pair"><span style="font-size:14px;font-weight:600">Lys</span>
              <label>Lavest <input class="input num-in" type="number" min="1" max="99" value="${e.min_pct ?? 1}" data-field="min_pct" data-i="${i}" aria-label="Laveste ekte lysstyrke for ${esc(e.label)}">%</label>
              <label>Høyest <input class="input num-in" type="number" min="2" max="100" value="${e.max_pct ?? 100}" data-field="max_pct" data-i="${i}" aria-label="Høyeste ekte lysstyrke for ${esc(e.label)}">%</label></span>
              <label class="sensor-pick"><input type="checkbox" ${e.all_off === false ? '' : 'checked'} data-field="all_off" data-i="${i}"> Med i «Slå av alle»</label>`}
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
    ${fixedButtonHTML()}
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

// Vedlikehold: gjentakende oppgaver med påminnelse.
function maintPanel() {
  const list = A.st.extras.maintenance || [];
  const due = list.filter((t) => t.due).length;
  const every = (m) => (m === 1 ? 'Hver måned' : m === 12 ? 'Hvert år' : m % 12 === 0 ? `Hvert ${m / 12}. år` : `Hver ${m}. måned`);
  let h = `<section class="panel"><div class="panel-head"><h2>Vedlikehold</h2><span>${due ? `${due} forfalt` : list.length ? `Neste ${esc(fmtDate(list[0].next))}` : 'Ingen oppgaver'}</span></div>
    <p class="help">Du får påminnelse når noe skal gjøres. Oppgaver merket «Leietaker» vises også i hybelappen en uke før, med en «Gjort»-knapp.</p>`;
  if (list.length) {
    h += `<table class="tbl"><thead><tr><th>Oppgave</th><th>Neste</th><th></th></tr></thead><tbody>${list.map((t) => `<tr>
      <td><strong>${esc(t.title)}</strong><br><span class="help">${every(t.months)} · sist ${esc(fmtDate(t.last))}${t.history.length && t.history[t.history.length - 1].by === 'tenant' ? ' av leietaker' : ''}</span></td>
      <td>${esc(fmtDate(t.next))}<br><span class="pill2 ${t.due ? 'bad' : t.soon ? 'warn' : ''}">${t.due ? 'Forfalt' : t.days === 0 ? 'I dag' : `Om ${t.days} d`}</span></td>
      <td><button class="sbtn ${t.due ? 'on' : ''}" data-act="mt-done" data-id="${t.id}">Utført i dag</button>
        <button class="sbtn ${t.tenant ? 'on' : ''}" data-act="mt-tenant" data-id="${t.id}" title="Vis i hybelappen">Leietaker${t.tenant ? ' ✓' : ''}</button>
        <button class="sbtn" data-act="mt-delete" data-id="${t.id}">${A.confirmDel === `mt-${t.id}` ? 'Bekreft' : 'Slett'}</button></td></tr>`).join('')}</tbody></table>`;
  }
  h += `<div class="mt-add">
      <input class="input" placeholder="Ny oppgave, f.eks. Test røykvarsleren" maxlength="80" value="${esc(A.mt.title)}" data-field="mt.title">
      <select class="input" data-field="mt.months">${[1, 2, 3, 4, 6, 12, 24].map((m) => `<option value="${m}" ${A.mt.months === m ? 'selected' : ''}>${every(m)}</option>`).join('')}</select>
      <label class="mt-check"><input type="checkbox" data-field="mt.tenant" ${A.mt.tenant ? 'checked' : ''}> Leietaker</label>
      <button class="sbtn on" data-act="mt-add">Legg til</button>
    </div></section>`;
  return h;
}

function alertsPanel() {
  const al = A.cfg.alerts;
  const names = new Map((A.cand?.entities || []).map((c) => [c.entity_id, c.name]));
  return `<section class="panel"><div class="panel-head"><h2>Varsle meg</h2></div>
    <label for="notify" class="help">Varslingstjeneste (tom = varsel i Home Assistant)</label>
    <input id="notify" class="input" list="notify-list" placeholder="notify.mobile_app_telefon" value="${esc(al.notify_service)}" data-field="notify">
    <datalist id="notify-list">${(A.cand?.notify_services || []).map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <label for="offline-h" class="help" style="margin-top:10px">Varsle når en synlig enhet har vært uten kontakt i</label>
    <select id="offline-h" class="input" data-field="offline-hours">${[[0, 'Aldri'], [1, '1 time'], [2, '2 timer'], [6, '6 timer'], [12, '12 timer'], [24, '1 døgn']].map(([v, l]) => `<option value="${v}" ${(al.offline_hours ?? 2) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <span class="help" style="margin-top:10px">Varsle når disse slår seg på (f.eks. filter- eller frostalarm):</span>
    <div class="chips">${al.entities.map((id) => `<span class="chip">${esc(names.get(id) || id)}<button data-act="alarm-remove" data-id="${esc(id)}" aria-label="Fjern">×</button></span>`).join('') || '<span class="help">Ingen valgt.</span>'}</div>
    ${A.picker === 'alarm' ? pickerHTML('alarm') : `<button class="add" data-act="open-picker" data-kind="alarm">+ Legg til alarm</button>`}
    <p class="help" style="margin-top:12px">Meldinger, svar, strømavlesninger og sjekklister fra leietaker havner alltid i bjella i Home Assistant${al.notify_service ? ` og sendes i tillegg til ${esc(al.notify_service)}` : '. Velg en varslingstjeneste over (f.eks. telefonen din) for å få dem som push'}.</p>
    <button class="sbtn" data-act="test-notify">Send testvarsel</button>
    ${A.testResult ? `<div class="help">${A.testResult}</div>` : ''}
  </section>`;
}


const STATUS_LABEL = { new: 'Mottatt', in_progress: 'Under arbeid', done: 'Løst' };
const fmtDate = (d) => new Date(d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const kr = (n) => (n == null ? '–' : n.toLocaleString('nb-NO', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr');

const photoThumbs = (ids) => (ids && ids.length ? `<div class="thumbs">${ids.map((id) => `<button class="thumb" data-act="photo" data-id="${id}" aria-label="Vis bilde"><img src="api/admin/photo/${id}" alt="" loading="lazy"></button>`).join('')}</div>` : '');

function reportsPanel() {
  const reps = A.st.extras.reports;
  const open = reps.filter((r) => r.status === 'new' || r.status === 'in_progress' || r.landlord_unread);
  const dev = A.st.extras.push_devices.length;
  let h = `<section class="panel"><div class="panel-head"><h2>Meldinger</h2><span>${open.length ? `${open.length} venter på deg` : 'Ingen åpne'}</span></div>
    <div class="compose">
      <textarea class="input area" rows="2" maxlength="2000" placeholder="Skriv en melding til leietaker …" data-field="compose">${esc(A.compose)}</textarea>
      <button class="sbtn on" data-act="compose-send">Send</button>
    </div>
    <p class="help">${dev ? `Leietaker har slått på varsler (${dev} enhet${dev === 1 ? '' : 'er'}) og får pushvarsel på meldinger, svar og statusendringer.` : 'Leietaker har ikke slått på varsler ennå – meldingen vises neste gang appen åpnes.'}</p>`;
  if (!reps.length) return h + `<p class="help">Ingen meldinger ennå. Du får varsel når leietakeren melder fra.</p></section>`;
  for (const r of reps.slice(0, 20)) {
    const mine = r.origin === 'landlord';
    h += `<div class="report-a ${r.status}${mine ? ' mine' : ''}${r.landlord_unread ? ' new' : ''}">
      <div class="report-head"><strong>${mine ? 'Du skrev' : esc(r.category)}${r.urgent ? ' · <span class="urgent">haster</span>' : ''}</strong><span class="help">${esc(fmtDate(r.created))}${mine ? (r.tenant_unread ? ' · ikke lest' : ' · lest') : ''}</span></div>
      <p class="pre">${esc(r.text)}</p>
      ${photoThumbs(r.photos)}
      ${r.updates.length ? `<div class="thread">${r.updates.map((u) => `<div class="tmsg ${u.from}${u.status ? ' sys' : ''}">${esc(u.text)} <small>${u.from === 'landlord' ? 'Du' : 'Leietaker'} · ${esc(fmtDate(u.at))}</small></div>`).join('')}</div>` : ''}
      <div class="row-btns">
        ${mine ? '' : ['new', 'in_progress', 'done'].map((s) => `<button class="sbtn ${r.status === s ? 'on' : ''}" data-act="report-status" data-id="${r.id}" data-v="${s}">${STATUS_LABEL[s]}</button>`).join('')}
        ${r.landlord_unread ? `<button class="sbtn" data-act="report-seen" data-id="${r.id}">Merk som lest</button>` : ''}
        <button class="sbtn" data-act="report-delete" data-id="${r.id}">${A.confirmDel === r.id ? 'Bekreft sletting' : 'Slett'}</button>
      </div>
      <div class="reply-a"><textarea class="input area" rows="2" placeholder="Svar til leietaker …" data-field="admin-reply" data-id="${r.id}">${esc(A.replies[r.id] || '')}</textarea><button class="sbtn" data-act="report-reply" data-id="${r.id}">Send svar</button></div>
    </div>`;
  }
  return h + `</section>`;
}

const CL_STATUS = { open: ['Hos leietaker', ''], submitted: ['Sendt inn – venter på deg', 'warn'], approved: ['Godkjent', 'ok'] };

function checklistPanel() {
  const list = A.st.extras.checklists;
  const hasOpen = list.some((c) => c.status === 'open');
  let h = `<section class="panel"><div class="panel-head"><h2>Inn- og utflytting</h2><span>${list.length ? `${list.length} sjekkliste${list.length === 1 ? '' : 'r'}` : 'Sjekkliste for leietaker'}</span></div>
    <p class="help">Leietaker går gjennom hybelen rom for rom, merker hvert punkt som OK eller skriver en merknad med bilder. Du får varsel når listen er sendt inn.</p>
    <div class="row-btns">
      <button class="sbtn on" data-act="cl-create" data-v="in" ${hasOpen ? 'disabled' : ''}>Send innflyttingssjekkliste</button>
      <button class="sbtn" data-act="cl-create" data-v="out" ${hasOpen ? 'disabled' : ''}>Send utflyttingssjekkliste</button>
    </div>`;
  for (const c of list) {
    const [label, cls] = CL_STATUS[c.status];
    const isOpen = A.clOpen === c.id;
    const notes = c.rows.filter((r) => r.status === 'note');
    h += `<div class="cl-a">
      <button class="cl-head" data-act="cl-toggle" data-id="${c.id}">
        <span><strong>${esc(c.label)}</strong> <span class="help">· sendt ${esc(fmtDate(c.created))}</span></span>
        <span class="cl-meta"><span class="pill2 ${cls}">${label}</span><span class="help">${c.done}/${c.total} · ${notes.length} merknad${notes.length === 1 ? '' : 'er'}</span></span>
      </button>`;
    if (isOpen) {
      const rooms = [...new Set(c.rows.map((r) => r.room))];
      h += `<div class="cl-body">`;
      for (const room of rooms) {
        const rows = c.rows.filter((r) => r.room === room);
        const cond = rows.filter((r) => r.kind !== 'clean');
        const cln = rows.filter((r) => r.kind === 'clean');
        const ok = cond.filter((r) => r.status === 'ok').length;
        const rn = rows.filter((r) => r.status === 'note');
        const miss = rows.filter((r) => !r.status).length;
        h += `<div class="cl-room"><div class="cl-room-h"><strong>${esc(room)}</strong><span class="help">${cond.length ? `${ok} OK` : ''}${cln.length ? `${cond.length ? ' · ' : ''}vask ${cln.filter((r) => r.status === 'ok').length}/${cln.length}` : ''}${miss ? ` · ${miss} ikke sjekket` : ''}</span></div>
          ${rn.map((r) => `<div class="cl-note"><span class="t">${esc(r.item)}${r.kind === 'clean' ? ' – ikke vasket' : ''}</span>${r.note ? `<p class="pre">${esc(r.note)}</p>` : ''}${photoThumbs(r.photos)}</div>`).join('')}
        </div>`;
      }
      if (c.comment) h += `<div class="cl-room"><strong>Kommentar fra leietaker</strong><p class="pre">${esc(c.comment)}</p></div>`;
      if (c.status === 'submitted') {
        h += `<label class="lbl-col">Kommentar til leietaker (valgfritt)<textarea class="input area" rows="2" data-field="cl-comment" data-id="${c.id}" placeholder="F.eks. Takk! Riper i benken er notert.">${esc(A.clComment[c.id] || '')}</textarea></label>`;
      }
      if (c.landlord_comment) h += `<p class="help">Din kommentar: ${esc(c.landlord_comment)}</p>`;
      h += `<div class="row-btns">
        ${c.status === 'submitted' ? `<button class="sbtn on" data-act="cl-approve" data-id="${c.id}">Godkjenn</button>` : ''}
        ${c.status !== 'open' ? `<button class="sbtn" data-act="cl-reopen" data-id="${c.id}">Åpne for endringer</button>` : ''}
        <a class="sbtn" href="api/admin/checklist/${c.id}.pdf" target="_blank" rel="noopener">Last ned PDF</a>
        <button class="sbtn" data-act="cl-print" data-id="${c.id}">Skriv ut</button>
        <button class="sbtn" data-act="cl-delete" data-id="${c.id}">${A.confirmDel === c.id ? 'Bekreft sletting' : 'Slett'}</button>
      </div></div>`;
    }
    h += `</div>`;
  }
  h += `<details class="cl-tpl"><summary>Rediger punktene i sjekklisten</summary>
      <p class="help">Ett rom per linje: <code>Rom: punkt, punkt, punkt</code>. Endringer gjelder nye sjekklister. Husk «Lagre endringer» øverst.</p>
      <textarea class="input area mono-area" rows="9" data-field="cl-template">${esc(A.cfg.checklist_template || '')}</textarea>
      <p class="help" style="margin-top:10px"><strong>Vask ved utflytting</strong> – egne avkrysningspunkter som kommer i tillegg på utflyttingssjekklisten, under samme rom. Tøm feltet for å ikke ha vaskeliste.</p>
      <textarea class="input area mono-area" rows="6" data-field="cl-clean-template">${esc(A.cfg.clean_template || '')}</textarea>
    </details>`;
  return h + `</section>`;
}

function printChecklist(c) {
  const rooms = [...new Set(c.rows.map((r) => r.room))];
  const w = window.open('', '_blank');
  if (!w) { message('Nettleseren blokkerte utskriftsvinduet.', true); return; }
  const imgs = (ids) => (ids || []).map((id) => `<img src="${new URL(`api/admin/photo/${id}`, location.href).href}">`).join('');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(c.label)}ssjekkliste</title>
    <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#222}h1{font-size:24px}h2{font-size:17px;margin:20px 0 6px;border-bottom:1px solid #ccc}
    table{width:100%;border-collapse:collapse}td{padding:5px 4px;border-bottom:1px solid #eee;vertical-align:top;font-size:14px}td:first-child{width:38%}.ok{color:#2f6b45}.note{color:#9a4a12}
    img{max-width:220px;max-height:160px;margin:4px 4px 0 0;border-radius:4px}.sig{margin-top:40px;display:flex;gap:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:13px}</style>
    <h1>${esc(c.label)}ssjekkliste</h1>
    <p>Opprettet ${esc(fmtDate(c.created))}${c.submitted_at ? ` · sendt inn ${esc(fmtDate(c.submitted_at))}` : ''}${c.approved_at ? ` · godkjent ${esc(fmtDate(c.approved_at))}` : ''}</p>
    ${rooms.map((room) => `<h2>${esc(room)}</h2><table>${c.rows.filter((r) => r.room === room).map((r) => `<tr><td>${esc(r.item)}</td><td class="${r.status || ''}">${r.status === 'ok' ? 'OK' : r.status === 'note' ? 'Merknad' : '–'}${r.note ? `: ${esc(r.note)}` : ''}<br>${imgs(r.photos)}</td></tr>`).join('')}</table>`).join('')}
    ${c.comment ? `<h2>Kommentar fra leietaker</h2><p>${esc(c.comment)}</p>` : ''}
    ${c.landlord_comment ? `<h2>Kommentar fra utleier</h2><p>${esc(c.landlord_comment)}</p>` : ''}
    <div class="sig"><div>Leietaker</div><div>Utleier</div></div>
    <script>window.onload=()=>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

function photoOverlay() {
  return A.photo ? `<div class="lightbox" data-act="photo-close"><img src="api/admin/photo/${A.photo}" alt="Bilde fra leietaker"></div>` : '';
}

const LSTAT_A = { refund: ['Til gode leietaker', 'info'], claimed: ['Leietaker: betalt', 'info'], paid: ['Betalt', 'ok'], overdue: ['Forfalt', 'bad'], soon: ['Forfaller snart', 'warn'], upcoming: ['Kommende', ''] };

// Oppsigelse / søknad om å avslutte fra leietaker.
function endRequestHTML() {
  const T = A.st.extras.termination;
  const t = T && T.latest;
  if (!t) return '';
  if (t.status === 'pending') {
    if (!A.endDec || A.endDec.id !== t.id) A.endDec = { id: t.id, date: t.requested_end, comment: '' };
    return `<div class="end-req">
      <strong>${t.early ? 'Leietaker søker om å avslutte leieforholdet' : 'Leietaker har sagt opp leieforholdet'}</strong>
      <span>Sendt ${esc(fmtDate(t.created))} · ønsket siste dag <strong>${esc(fmtDate(t.requested_end))}</strong>${t.earliest ? ` · tidligste dato etter kontrakten ${esc(fmtDate(t.earliest))}` : ''}</span>
      ${t.early ? '<span class="pill2 warn">Før oppsigelsestiden er ute – du bestemmer</span>' : ''}
      ${t.reason ? `<p class="pre">${esc(t.reason)}</p>` : ''}
      <div class="form-grid">
        <label class="lbl-col">Siste dag i leieforholdet<input class="input" type="date" value="${esc(A.endDec.date)}" data-field="end-dec-date"></label>
        <label class="lbl-col">Kommentar til leietaker (valgfritt)<input class="input" maxlength="1000" value="${esc(A.endDec.comment)}" placeholder="F.eks. Greit! Vi avtaler nøkkelinnlevering." data-field="end-dec-comment"></label>
      </div>
      <p class="help">Godkjenner du, settes sluttdatoen i leieforholdet. Husleien avregnes per dag, og et sluttoppgjør med strøm og eventuell tilbakebetaling kommer under Økonomi. Husk å sende utflyttingssjekklisten.</p>
      <div class="row-btns"><button class="sbtn on" data-act="end-approve">Godkjenn</button><button class="sbtn" data-act="end-decline">${A.confirmDel === 'end-decline' ? 'Bekreft avslag' : 'Avslå'}</button></div>
    </div>`;
  }
  if (t.status === 'approved') return `<p class="help end-ok">✓ Oppsigelse godkjent ${esc(fmtDate(t.decided_at))} – siste dag ${esc(fmtDate(t.approved_end))}.</p>`;
  return '';
}

// ---------- leiekontrakt ----------
const CT_SEL = {
  object_type: [['hybel', 'Hybel i bolig der jeg bor'], ['sokkel', 'Sokkel/loft i hus der jeg bor'], ['leilighet', 'Selvstendig bolig']],
  furnished: [['umoblert', 'Umøblert'], ['delvis', 'Delvis møblert'], ['moblert', 'Møblert']],
  term: [['tidsubestemt', 'Tidsubestemt (løper til oppsigelse)'], ['tidsbestemt', 'Tidsbestemt (har sluttdato)']],
  term_cancel: [['begge', 'Begge kan si opp i perioden'], ['leietaker', 'Bare leietaker kan si opp'], ['ingen', 'Ingen kan si opp i perioden']],
  power: [['maaler', 'Etter måler (pris per kWh)'], ['inkludert', 'Inkludert i husleien'], ['fast', 'Fast beløp per måned']],
  deposit_type: [['konto', 'Depositumskonto'], ['garanti', 'Garanti (NAV e.l.)'], ['ingen', 'Ingen sikkerhet']],
  pets: [['nei', 'Ikke tillatt uten samtykke'], ['avtale', 'Etter avtale'], ['ja', 'Tillatt']],
  smoking: [['nei', 'Ikke tillatt'], ['ute', 'Bare utendørs'], ['ja', 'Ingen regel']]
};
const CT_FLAGS = [
  ['Leieobjektet', [['own_bath', 'Eget bad'], ['own_kitchen', 'Eget kjøkken/kjøkkenkrok'], ['storage', 'Bod'], ['parking', 'Parkering'], ['washer', 'Tilgang til vaskemaskin'], ['internet', 'Internett inkludert']]],
  ['Inkludert i leien', [['water_incl', 'Vann og avløp'], ['heat_incl', 'Oppvarming'], ['kpi', 'KPI-regulering av leien']]],
  ['Klausuler', [['eviction', 'Tvangsfravikelse ved manglende betaling (anbefalt)'], ['checklist_clause', 'Inn- og utflytting med sjekkliste i appen'], ['app_clause', 'Smarthus og Hybel-appen (personvern)'], ['attach_rules', 'Legg ved husordensregler fra Info'], ['insurance', 'Anbefal innboforsikring']]]
];
function contractPanel() {
  const C = A.st.extras.contract;
  if (!C) return '';
  if (!A.ct) A.ct = { ...C.opts };
  const o = A.ct;
  const sent = C.sent;
  const head = sent ? (sent.tenant_accept ? `Godtatt ${fmtDate(sent.tenant_accept.at)}` : `Sendt ${fmtDate(sent.created)} – venter`) : 'Ikke sendt';
  const sel = (k, label) => `<label class="lbl-col">${label}<select class="input" data-field="ct.${k}">${CT_SEL[k].map(([v, l]) => `<option value="${v}" ${o[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const inp = (k, label, ph = '', extra = '') => `<label class="lbl-col">${label}<input class="input" ${extra} value="${esc(o[k] ?? '')}" placeholder="${esc(ph)}" data-field="ct.${k}"></label>`;
  const locked = sent && !sent.tenant_accept;
  let h = `<section class="panel"><div class="panel-head"><h2>Leiekontrakt</h2><span>${esc(head)}</span></div>`;
  if (sent) {
    h += sent.tenant_accept
      ? `<div class="ct-status ok"><strong>✓ Godtatt av leietaker ${esc(new Date(sent.tenant_accept.at).toLocaleString('nb-NO', { dateStyle: 'long', timeStyle: 'short' }))}</strong>${sent.tenant_accept.email ? `<span>Innlogget som ${esc(sent.tenant_accept.email)}</span>` : ''}<span>Versjon ${sent.version} · dokumentkode ${esc(sent.hash)}</span></div>`
      : `<div class="ct-status"><strong>Sendt til leietaker ${esc(fmtDate(sent.created))}</strong><span>Versjon ${sent.version}. Leietaker leser og godtar i appen under Leie.</span></div>`;
    h += `<div class="row-btns"><a class="sbtn on" href="api/admin/contract.pdf" target="_blank" rel="noopener">Åpne kontrakten (PDF)</a><button class="sbtn" data-act="ct-reset">${A.confirmDel === 'ct-reset' ? 'Bekreft – lag ny versjon' : sent.tenant_accept ? 'Lag ny versjon' : 'Trekk tilbake og endre'}</button></div>`;
    if (!locked && !A.ctEdit) return h + bankidHelp() + `</section>`;
  }
  h += `<p class="help">Kryss av for vilkårene du vil ha med. Navn, adresse, datoer, husleie, depositum og oppsigelsestid hentes fra Leieforhold og Økonomi.</p>`;
  if (C.warnings.length) h += `<ul class="ct-warn">${C.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
  h += `<div class="form-grid">${sel('object_type', 'Type bolig')}${sel('furnished', 'Møblering')}</div>
    ${inp('rooms', 'Rom og areal (valgfritt)', 'F.eks. stue/soverom, bad og kjøkkenkrok, ca. 30 m²')}
    <div class="form-grid">${sel('term', 'Leietid')}${o.term === 'tidsbestemt' ? sel('term_cancel', 'Oppsigelse i perioden') : ''}</div>
    <div class="form-grid">${sel('power', 'Strøm')}${o.power === 'fast' ? inp('power_fixed', 'Fast beløp per måned (kr)', 'F.eks. 800', 'inputmode="numeric"') : sel('deposit_type', 'Sikkerhet')}</div>
    ${o.power === 'fast' ? `<div class="form-grid">${sel('deposit_type', 'Sikkerhet')}</div>` : ''}
    <div class="form-grid">${sel('pets', 'Dyrehold')}${sel('smoking', 'Røyking')}</div>
    ${CT_FLAGS.map(([t, list]) => `<span class="help ct-h">${t}</span><div class="ct-flags">${list.map(([k, l]) => `<label class="ct-flag"><input type="checkbox" data-field="ct.${k}" ${o[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>`).join('')}
    <span class="help ct-h">Opplysninger om partene (valgfritt)</span>
    <div class="form-grid">${inp('tenant_birth', 'Leietakers fødselsdato', 'dd.mm.åååå')}${inp('tenant_phone', 'Leietakers telefon')}</div>
    <div class="form-grid">${inp('tenant_email', 'Leietakers e-post')}${inp('landlord_address', 'Utleiers adresse')}</div>
    <label class="lbl-col">Særlige bestemmelser (én per linje)<textarea class="input area" rows="3" maxlength="3000" data-field="ct.special" placeholder="F.eks. Leietaker måker egen inngang.">${esc(o.special || '')}</textarea></label>
    <div class="row-btns"><a class="sbtn" href="api/admin/contract.pdf?draft=1" target="_blank" rel="noopener">Forhåndsvis PDF</a>
      <button class="sbtn on" data-act="ct-send">${A.confirmDel === 'ct-send' ? 'Bekreft – send til leietaker' : 'Send til leietaker'}</button></div>
    <p class="help">Når du sender, regnes kontrakten som godtatt av deg. Leietaker får pushvarsel, leser kontrakten i appen og godtar den. Tidspunkt og innlogget e-post lagres i PDF-en.</p>`;
  return h + bankidHelp() + `</section>`;
}
function bankidHelp() {
  return `<details class="eco-set"><summary>Signere med BankID?</summary><p class="help">Godkjenning i appen er en enkel elektronisk signatur med tidsstempel og innlogget e-post. Vil dere ha BankID: last ned PDF-en, send den til signering i en BankID-tjeneste (f.eks. Posten/Digipost Signering), og last opp den signerte PDF-en under Dokumenter i Leieforhold.</p></details>`;
}

function leasePanel() {
  const l = A.cfg.lease;
  const c = A.st.extras.lease.contract;
  const f = (k, label, ph = '', type = 'text', extra = '') => `<label class="lbl-col">${label}<input class="input" type="${type}" ${extra} value="${esc(l[k] ?? '')}" placeholder="${esc(ph)}" data-field="lease.${k}"></label>`;
  const head = c.end ? (c.days_left >= 0 ? `${c.days_left} dager igjen` : 'Utløpt') : c.start ? 'Tidsubestemt' : 'Kontrakt og depositum';
  return `<section class="panel"><div class="panel-head"><h2>Leieforhold</h2><span>${esc(head)}</span></div>
    ${endRequestHTML()}
    ${c.end && c.notice_by && c.days_left >= 0 ? `<p class="help">Kontrakten løper til ${esc(fmtDate(c.end))}. Frist for oppsigelse ved kontraktsslutt: ${esc(fmtDate(c.notice_by))}.</p>` : ''}
    <div class="form-grid">
      ${f('start', 'Innflytting', '', 'date')}
      ${f('end', 'Kontrakt til (tom = tidsubestemt)', '', 'date')}
      ${f('notice_months', 'Oppsigelsestid (måneder)', '3', 'number', 'min="0" max="12"')}
      ${f('deposit', 'Depositum (kr)', 'F.eks. 25500', 'text', 'inputmode="decimal"')}
      ${f('deposit_note', 'Om depositumet', 'F.eks. Depositumskonto i banken')}
    </div>
    <label class="lbl-col">Inkludert i leien<textarea class="input area" rows="2" data-field="lease.includes" placeholder="F.eks. Internett, vann og avløp, kommunale avgifter">${esc(l.includes || '')}</textarea></label>
    <label class="lbl-col">Annet om leieforholdet<textarea class="input area" rows="2" data-field="lease.note" placeholder="F.eks. Husleien justeres etter KPI hver januar">${esc(l.note || '')}</textarea></label>
    <p class="help">Du og leietaker får varsel 90 og 30 dager før kontrakten utløper. Husk «Lagre endringer» øverst.</p>
    ${docsHTML()}
  </section>`;
}

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

function docsHTML() {
  const docs = A.st.extras.docs || [];
  return `<h3 class="sub-h">Dokumenter</h3>
    <p class="help">Last opp den signerte leiekontrakten (PDF eller bilde). Leietaker finner den under Leie → Leieforholdet og får varsel når noe nytt er lagt ut.</p>
    ${docs.map((d) => `<div class="doc-row">
      <a class="doc-name" href="api/admin/doc/${d.id}" target="_blank" rel="noopener"><span class="doc-ic">${d.ext === 'pdf' ? 'PDF' : 'BILDE'}</span><span><strong>${esc(d.name)}</strong><br><span class="help">${esc(fmtDate(d.at))} · ${fmtSize(d.size)}</span></span></a>
      <button class="sbtn ${d.visible ? 'on' : ''}" data-act="doc-visible" data-id="${d.id}" data-v="${d.visible ? '0' : '1'}">${d.visible ? 'Synlig for leietaker' : 'Skjult'}</button>
      <button class="sbtn" data-act="doc-delete" data-id="${d.id}">${A.confirmDel === `doc-${d.id}` ? 'Bekreft' : 'Slett'}</button>
    </div>`).join('')}
    <div class="doc-up">
      <input class="input" type="text" maxlength="80" placeholder="Navn, f.eks. Signert leiekontrakt" value="${esc(A.docName || '')}" data-field="doc-name">
      <button class="sbtn on" data-act="doc-upload" ${A.uploading ? 'disabled' : ''}>${A.uploading ? 'Laster opp …' : 'Velg fil og last opp'}</button>
    </div>`;
}

function uploadDoc() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,image/jpeg,image/png';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { message('Filen er for stor (maks 15 MB).', true); return; }
    A.uploading = true; render();
    try {
      const name = (A.docName || '').trim() || file.name;
      const r = await fetch(`api/admin/doc-upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const j = await r.json().catch(() => ({ ok: false, error: `Feil ${r.status}` }));
      if (!j.ok) throw new Error(j.error);
      A.st = j.state; A.docName = '';
      message('Dokumentet er lastet opp og synlig for leietaker.');
    } catch (e) { message(esc(e.message), true); }
    A.uploading = false; render();
  };
  inp.click();
}

// Økonomi: husleie og strøm samlet – oversikt, betalinger, avlesninger og innstillinger.
function economyPanel() {
  const l = A.cfg.lease;
  const c = A.cfg.electricity;
  const L = A.st.extras.lease;
  const e = A.st.extras.electricity;
  if (!A.cand) loadCandidates();
  const hasRent = Boolean(A.st.extras.lease.settings.rent);
  const outstanding = hasRent ? L.overdue.reduce((a, o) => a + o.total, 0) : e.unpaid;
  const head = L.overdue.length ? `${kr(outstanding)} utestående` : L.next ? `Neste: ${kr(L.next.total)} ${fmtDate(L.next.due)}` : 'Husleie og strøm';
  let h = `<section class="panel"><div class="panel-head"><h2>Økonomi</h2><span>${esc(head)}</span></div>
    <div class="eco-tiles">
      <div class="eco-tile ${outstanding > 0 ? 'bad' : ''}"><span>Utestående</span><strong>${esc(kr(outstanding))}</strong>${L.overdue.length ? `<small>${L.overdue.map((o) => esc(o.label)).join(', ')}</small>` : ''}</div>
      <div class="eco-tile"><span>Neste forfall</span><strong>${L.next ? esc(kr(L.next.total)) : '–'}</strong>${L.next ? `<small>${esc(fmtDate(L.next.due))}</small>` : ''}</div>
      <div class="eco-tile"><span>Betalt i år</span><strong>${esc(kr(L.year_total || 0))}</strong></div>
      <div class="eco-tile"><span>Strømpris</span><strong>${e.price != null ? `${esc(kr(e.price))}` : 'Ikke satt'}</strong>${e.price != null ? '<small>per kWh</small>' : ''}</div>
    </div>`;
  for (const cl of L.claimed || []) h += `<div class="claim-row"><span><strong>Leietaker har meldt betalt</strong> ${esc(cl.label)} – ${esc(kr(cl.total))}, ${esc(fmtDate(cl.claimed_at))}. Sjekk kontoen.</span>
    <span class="row-btns"><button class="sbtn on" data-act="month-paid" data-v="${cl.month}" data-paid="1">Bekreft mottatt</button><button class="sbtn" data-act="claim-reject" data-v="${cl.month}">Ikke mottatt</button></span></div>`;
  if (L.overdue.length > 1) h += `<div class="row-btns"><button class="sbtn" data-act="pay-all-overdue">Marker alle forfalte som betalt (${L.overdue.length})</button></div>`;

  if ((L.years || []).length) h += `<div class="row-btns year-row"><span class="help">Årsoversikt til skattemeldingen:</span>${L.years.slice(0, 4).map((y) => `<a class="sbtn" href="api/admin/year/${y}.pdf" target="_blank" rel="noopener">${y} (PDF)</a>`).join('')}</div>`;
  // Betalinger per måned (husleie + strøm)
  if (L.ledger.length && hasRent) {
    h += `<h3 class="sub-h">Betalinger</h3><table class="tbl"><thead><tr><th>Måned</th><th>Husleie</th><th>Strøm</th><th>Sum</th><th></th></tr></thead><tbody>
      ${L.ledger.map((r) => {
        const el = r.electricity.reduce((a, p) => a + (p.amount || 0), 0);
        const [lab, cls] = LSTAT_A[r.status];
        const cr = (r.credits || []).map((c) => `${esc(kr(c.amount))}<br><span class="help">Tilbake for ${esc(c.month)}${c.note ? ` (avregnet ${esc(c.note)})` : ''}</span>`).join('<br>');
        return `<tr><td>${esc(r.label.charAt(0).toUpperCase() + r.label.slice(1))}<br><span class="help">${r.refund ? 'Betales tilbake innen' : 'Forfall'} ${esc(fmtDate(r.due))}</span></td><td>${r.rent ? esc(kr(r.rent)) : cr ? '' : '–'}${r.rent_note ? `<br><span class="help">Avregnet ${esc(r.rent_note)}</span>` : ''}${cr}</td>
          <td>${el ? esc(kr(el)) : '–'}${r.electricity.map((p) => `<br><span class="help">${p.kwh.toLocaleString('nb-NO')} kWh</span>`).join('')}</td>
          <td><strong>${esc(kr(r.total))}</strong><br><span class="pill2 ${cls}">${lab}</span></td>
          <td><button class="sbtn ${r.paid ? 'on' : ''}" data-act="month-paid" data-v="${r.month}" data-paid="${r.paid ? '0' : '1'}">${r.paid ? (r.refund ? 'Tilbakebetalt ✓' : 'Betalt ✓') : r.refund ? 'Marker tilbakebetalt' : 'Marker betalt'}</button>
            <a class="sbtn" href="api/admin/invoice/${r.month}.pdf" target="_blank" rel="noopener">Faktura</a>
            ${r.paid ? '' : `<button class="sbtn" data-act="inv-delete" data-v="${r.month}">${A.confirmDel === `inv-${r.month}` ? 'Bekreft sletting' : 'Slett'}</button>`}</td></tr>`;
      }).join('')}
    </tbody></table>`;
    if (L.deleted.length) h += `<details class="eco-del"><summary>Slettede fakturaer (${L.deleted.length})</summary>
      ${L.deleted.map((x) => `<div class="del-row"><span>${esc(x.label)} <span class="help">slettet ${esc(fmtDate(x.at))}</span></span><button class="sbtn" data-act="inv-restore" data-v="${x.month}">Gjenopprett</button></div>`).join('')}
      <p class="help">En slettet faktura vises ikke for leietaker og regnes ikke som utestående. Strøm i den måneden blir ikke fakturert.</p></details>`;
  }

  // Strøm: avlesning og perioder
  const nr = A.newReading;
  const today = new Date().toISOString().slice(0, 10);
  h += `<h3 class="sub-h">Strøm</h3>
    <p class="help">${L.contract.auto_meter ? 'Leses av automatisk siste dag i måneden. ' : ''}${e.last ? `Siste avlesning: <strong>${e.last.value.toLocaleString('nb-NO')} kWh</strong> ${esc(fmtDate(e.last.date))}${e.last.by === 'landlord' ? ' (lagt inn av deg)' : e.last.by === 'auto' ? ' (automatisk)' : ''}.` : 'Ingen avlesninger ennå – legg inn målerstanden ved innflytting.'}</p>
    <div class="reading-inline">
      <input class="input" type="text" inputmode="decimal" placeholder="${e.last ? 'Målerstand (kWh)' : 'Startavlesning (kWh)'}" value="${esc(nr.value)}" data-field="nr.value">
      <input class="input" type="date" value="${esc(nr.date || today)}" max="${today}" data-field="nr.date">
      <button class="sbtn on" data-act="reading-add">${e.last ? 'Legg inn' : 'Lagre start'}</button>
    </div>`;
  if (e.periods.length) {
    h += `<table class="tbl"><thead><tr><th>Periode</th><th>kWh</th><th>Beløp</th><th></th></tr></thead><tbody>
      ${e.periods.map((p, i) => `<tr><td>${esc(fmtDate(p.from))} – ${esc(fmtDate(p.to))}<br><span class="help">${p.start} → ${p.end}${p.by === 'landlord' ? ' · lagt inn av deg' : p.by === 'auto' ? ' · automatisk' : ''}</span></td><td>${p.kwh.toLocaleString('nb-NO')}<br><span class="help">${p.per_day.toLocaleString('nb-NO')}/dag</span></td><td>${esc(kr(p.amount))}</td>
        <td>${hasRent ? `<span class="pill2 ${p.paid ? 'ok' : ''}">${p.paid ? 'Betalt' : 'Med i husleien'}</span>` : `<button class="sbtn ${p.paid ? 'on' : ''}" data-act="reading-paid" data-id="${p.id}" data-v="${p.paid ? '0' : '1'}">${p.paid ? 'Betalt' : 'Marker betalt'}</button>`}
        ${i === 0 ? `<button class="sbtn" data-act="reading-delete" data-id="${p.id}">${A.confirmDel === p.id ? 'Bekreft' : 'Slett'}</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
  } else if (e.last) {
    h += `<p class="help">Perioder vises når neste avlesning kommer. <button class="sbtn" data-act="reading-delete" data-id="${e.last.id}">${A.confirmDel === e.last.id ? 'Bekreft sletting' : 'Slett startavlesning'}</button></p>`;
  }

  // Innstillinger
  const f = (k, label, ph = '', type = 'text', extra = '') => `<label class="lbl-col">${label}<input class="input" type="${type}" ${extra} value="${esc(l[k] ?? '')}" placeholder="${esc(ph)}" data-field="lease.${k}"></label>`;
  h += `<details class="eco-set" ${hasRent && e.price != null ? '' : 'open'}><summary>Innstillinger for husleie og strøm</summary>
    <div class="form-grid">
      ${f('rent', 'Husleie per måned (kr)', 'F.eks. 8500', 'text', 'inputmode="decimal"')}
      ${f('due_day', 'Forfallsdag (1–28)', '1', 'number', 'min="1" max="28"')}
      ${f('account', 'Kontonummer for betaling', '1234 56 78901')}
      ${f('landlord_name', 'Ditt navn på fakturaen', 'Tom = kontaktperson fra Info')}
      ${f('tenant_name', 'Leietakers navn (faktura)', 'F.eks. Kari Nordmann')}
      ${f('address', 'Adresse for hybelen (faktura)', 'Gate 1, 1234 Sted')}
      ${f('remind_days', 'Påminnelse før forfall (dager, 0 = av)', '3', 'number', 'min="0" max="14"')}
      <label class="lbl-col">Strømpris per kWh (kr)<input class="input" type="text" inputmode="decimal" placeholder="F.eks. 1,50" value="${c.price_per_kwh ?? ''}" data-field="el.price"></label>
      <label class="lbl-col">Merknad om strøm til leietaker<input class="input" type="text" maxlength="300" placeholder="F.eks. Betales sammen med husleien" value="${esc(c.note || '')}" data-field="el.note"></label>
    </div>
    <label class="lbl-col">Automatisk strømavlesning (valgfritt)
      <select class="select" data-field="lease.meter_sensor"><option value="">Av – leietaker leser av selv</option>
      ${(A.cand?.meters || []).map((m) => `<option value="${esc(m.entity_id)}" ${l.meter_sensor === m.entity_id ? 'selected' : ''}>${esc(m.name)} (${esc(m.state)})</option>`).join('')}
      ${l.meter_sensor && !(A.cand?.meters || []).some((m) => m.entity_id === l.meter_sensor) ? `<option value="${esc(l.meter_sensor)}" selected>${esc(l.meter_sensor)}</option>` : ''}</select></label>
    <p class="help">Husleie betales forskuddsvis; første og siste måned avregnes per dag. Strøm legges på første forfall etter hver avlesning, med prisen som gjaldt da. Husk «Lagre endringer» øverst.</p>
  </details>`;
  return h + `</section>`;
}

function infoPanel() {
  const i = A.cfg.info;
  const names = new Map((A.cand?.safety || []).map((c) => [c.entity_id, c.name]));
  const field = (k, label, ph = '', type = 'text') => `<label class="lbl-col">${label}<input class="input" type="${type}" value="${esc(i[k] || '')}" placeholder="${esc(ph)}" data-field="info.${k}"></label>`;
  const area = (k, label, ph) => `<label class="lbl-col">${label}<textarea class="input area" rows="3" placeholder="${esc(ph)}" data-field="info.${k}">${esc(i[k] || '')}</textarea></label>`;
  const avail = (A.cand?.safety || []).filter((c) => !(i.safety || []).includes(c.entity_id));
  return `<section class="panel"><div class="panel-head"><h2>Info til leietaker</h2><span>Vises under Info i appen</span></div>
    <div class="form-grid">
      ${field('wifi_ssid', 'Wifi-navn')}${field('wifi_password', 'Wifi-passord')}
      ${field('contact_name', 'Kontaktperson')}${field('contact_phone', 'Telefon', '', 'tel')}
      ${field('contact_email', 'E-post', '', 'email')}
    </div>
    ${area('garbage', 'Søppel og henting', 'F.eks. Restavfall hver tirsdag, papir annenhver torsdag')}
    ${area('rules', 'Husregler', 'F.eks. Ro etter kl. 23')}
    ${area('emergency', 'Ved nødstilfeller', 'F.eks. Hovedkran for vann er i vaskerommet. Sikringsskap i gangen.')}
    ${area('other', 'Annet')}
    <span class="help">Sikkerhet (vises med status, f.eks. røykvarsler og batteri):</span>
    <div class="chips">${(i.safety || []).map((id) => `<span class="chip">${esc(names.get(id) || id)}<button data-act="safety-remove" data-id="${esc(id)}" aria-label="Fjern">×</button></span>`).join('') || '<span class="help">Ingen valgt.</span>'}</div>
    ${A.picker === 'safety' ? `<div class="picker"><div class="picker-list">${avail.map((c) => `<button class="pick" data-act="safety-add" data-id="${esc(c.entity_id)}"><span><span class="n">${esc(c.name)}</span><span class="mono">${esc(c.entity_id)}</span></span><span class="a">${esc(c.state)}</span></button>`).join('') || '<p class="help">Fant ingen.</p>'}</div><button class="sbtn" data-act="close-picker">Lukk</button></div>` : `<button class="add" data-act="open-picker" data-kind="safety">+ Legg til sikkerhetsføler</button>`}
    <p class="help">Husk «Lagre endringer» øverst.</p>
  </section>`;
}

function fixedButtonHTML() {
  const f = A.cfg.fixed_button;
  const buttons = A.cfg.entities.filter((e) => e.kind === 'button' && e.enabled !== false);
  const lights = A.cfg.entities.filter((e) => e.kind === 'light' && e.enabled !== false);
  if (!buttons.length) return '';
  return `<div class="fixed-btn">
    <span class="t">Fast lysknapp</span>
    <span class="help">Følger hybelen fra start og kan ikke endres av leietaker: opp = på, ned = av, hold inne = dim opp/ned.</span>
    <div class="form-grid">
      <label class="lbl-col">Fjernkontroll<select class="select" data-field="fb.entity_id"><option value="">Av</option>${buttons.map((b) => `<option value="${esc(b.entity_id)}" ${f.entity_id === b.entity_id ? 'selected' : ''}>${esc(b.label || b.entity_id)}</option>`).join('')}</select></label>
      <label class="lbl-col">Knapp<select class="select" data-field="fb.n">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${Number(f.n) === n ? 'selected' : ''}>Knapp ${n}</option>`).join('')}</select></label>
      <label class="lbl-col">Lys<select class="select" data-field="fb.light"><option value="">Velg lys</option>${lights.map((l) => `<option value="${esc(l.entity_id)}" ${f.light === l.entity_id ? 'selected' : ''}>${esc(l.label || l.entity_id)}</option>`).join('')}</select></label>
    </div>
  </div>`;
}

// ---------- statistikk: hvilke sensorer leietaker ser ----------
async function loadStatSeries() {
  if (A.statLoading) return;
  A.statLoading = true;
  try { const r = await api('api/admin/stats-series'); A.statSeries = r.series || []; } catch { A.statSeries = []; }
  A.statLoading = false;
  render();
}

const TYPE_LBL = { temp: 'Temperatur', hum: 'Fuktighet', out: 'Ute', other: 'Annet' };

function statsPanel() {
  if (!A.statSeries) loadStatSeries();
  const hidden = new Set(A.cfg.stat_hidden);
  const auto = (A.statSeries || []).filter((x) => !x.custom);
  const custom = A.cfg.stat_sensors;
  const shown = auto.filter((x) => !hidden.has(x.id)).length + custom.filter((c) => !hidden.has(`c-${c.entity_id}`)).length;
  let h = `<section class="panel"><div class="panel-head"><h2>Statistikk</h2><span>${shown} grafer for leietaker</span></div>
    <p class="help">Velg hvilke målinger leietaker ser under Statistikk. Automatiske målinger kommer fra termostater og ventilasjon; du kan også legge til egne sensorer (temperatur, fukt, CO₂, strøm o.l.).</p>`;
  if (!A.statSeries) h += `<p class="help">Henter …</p>`;
  const items = statItems();
  items.forEach((it, k) => {
    const on = !hidden.has(it.id);
    const move = `<span class="ord"><button class="tool" data-act="stat-move" data-id="${esc(it.id)}" data-v="-1" ${k === 0 ? 'disabled' : ''} aria-label="Flytt opp">↑</button><button class="tool" data-act="stat-move" data-id="${esc(it.id)}" data-v="1" ${k === items.length - 1 ? 'disabled' : ''} aria-label="Flytt ned">↓</button></span>`;
    if (!it.custom) {
      h += `<div class="srow">${move}<span class="lbl">${esc(it.label)} <span class="tpill">${TYPE_LBL[it.type] || ''}</span><br><span class="help">${esc(it.sub || '')} · ${esc(it.entity_id)}</span></span>
        <span class="ctl"><span class="help">${esc(it.now ?? '')}</span><button class="sbtn ${on ? 'on' : ''}" data-act="stat-toggle" data-id="${esc(it.id)}">${on ? 'Vises' : 'Skjult'}</button></span></div>`;
    } else {
      const i = it.i, c = A.cfg.stat_sensors[i];
      const cand = (A.cand?.numeric || []).find((n) => n.entity_id === c.entity_id);
      h += `<div class="srow">${move}<span class="lbl" style="flex:1 1 220px"><input class="input" type="text" maxlength="40" placeholder="${esc(cand?.name || 'Navn')}" value="${esc(c.label)}" data-field="stat-label" data-i="${i}"><span class="help">${esc(c.entity_id)}${cand ? ` · ${esc(cand.state)}` : ''}</span></span>
        <span class="ctl"><button class="sbtn ${on ? 'on' : ''}" data-act="stat-toggle" data-id="${esc(it.id)}">${on ? 'Vises' : 'Skjult'}</button><button class="sbtn" data-act="stat-remove" data-i="${i}">Fjern</button></span></div>`;
    }
  });
  if (items.length > 1) h += `<p class="help">Bruk pilene for å endre rekkefølgen. Grafene vises i denne rekkefølgen innenfor Inneklima, Strømforbruk og Ute.</p>`;
  h += A.picker === 'stat' ? statPickerHTML() : `<button class="add" data-act="open-picker" data-kind="stat">+ Legg til sensor</button>`;
  h += `<div style="margin-top:14px">${outdoorHTML()}</div>`;
  h += `<p class="help">Husk «Lagre endringer» øverst.</p>`;
  return h + `</section>`;
}

// Alle målinger (automatiske + egne) i valgt rekkefølge.
function statItems() {
  const auto = (A.statSeries || []).filter((x) => !x.custom).map((x) => ({ ...x }));
  const custom = A.cfg.stat_sensors.map((c, i) => ({ id: `c-${c.entity_id}`, custom: true, i, type: (A.statSeries || []).find((x) => x.id === `c-${c.entity_id}`)?.type }));
  const all = [...auto, ...custom];
  const order = A.cfg.stat_order;
  const pos = (id) => { const k = order.indexOf(id); return k < 0 ? 1000 : k; };
  return all.map((x, n) => ({ ...x, n })).sort((a, b) => pos(a.id) - pos(b.id) || a.n - b.n);
}

function statPickerHTML() {
  if (!A.cand) return `<div class="picker"><p class="help">Henter sensorer …</p></div>`;
  const q = A.q.trim().toLowerCase();
  const taken = new Set(A.cfg.stat_sensors.map((c) => c.entity_id));
  const list = (A.cand.numeric || []).filter((c) => !taken.has(c.entity_id)).filter((c) => !q || `${c.name} ${c.entity_id} ${c.area}`.toLowerCase().includes(q)).slice(0, 80);
  return `<div class="picker">
    <div style="display:flex;gap:8px">
      <input class="input" type="search" placeholder="Søk etter sensor, område …" value="${esc(A.q)}" data-field="q" aria-label="Søk" autofocus>
      <button class="sbtn" data-act="close-picker">Lukk</button>
    </div>
    <div class="picker-list">${list.length ? list.map((c) => `
      <button class="pick" data-act="stat-add" data-id="${esc(c.entity_id)}">
        <span><span class="n">${esc(c.name)}</span><span class="mono">${esc(c.entity_id)}</span></span>
        <span class="a">${esc(c.area || '')} · ${esc(c.state)}</span>
      </button>`).join('') : '<p class="help" style="padding:8px">Ingen treff.</p>'}</div>
  </div>`;
}

function outdoorHTML() {
  if (!A.cand) loadCandidates();
  const used = A.st.outdoor.used;
  const name = (id) => (A.cand?.temp_sensors || []).find((t) => t.entity_id === id)?.name || id;
  return `<label class="lbl-col"><span class="t" style="font-size:15px;font-weight:600;color:var(--ink)">Utetermometer i statistikken</span>
    <select class="select" data-field="outdoor">
      <option value="" ${!A.cfg.outdoor_sensor ? 'selected' : ''}>Automatisk${!A.cfg.outdoor_sensor && used ? ` (${esc(name(used))})` : ''}</option>
      <option value="off" ${A.cfg.outdoor_sensor === 'off' ? 'selected' : ''}>Ikke vis</option>
      ${(A.cand?.temp_sensors || []).map((t) => `<option value="${esc(t.entity_id)}" ${A.cfg.outdoor_sensor === t.entity_id ? 'selected' : ''}>${esc(t.name)} (${esc(t.state)}°)</option>`).join('')}
    </select></label>`;
}

function resetPanel() {
  const bk = A.st.extras.backup || {};
  const arch = A.st.extras.archives || [];
  const bkLine = bk.last
    ? `<span class="pill2 ${bk.days > 8 ? 'warn' : 'ok'}">${bk.days > 8 ? '!' : '✓'}</span> Siste automatiske sikkerhetskopi i Home Assistant: <strong>${esc(fmtDate(bk.last))}</strong>${bk.next ? ` · neste ${esc(fmtDate(bk.next))}` : ''}`
    : `<span class="pill2 warn">!</span> Fant ingen automatisk sikkerhetskopi i Home Assistant. Slå det på under Innstillinger → System → Sikkerhetskopier.`;
  return `<section class="panel soft"><div class="panel-head"><h2>Sikkerhetskopi</h2></div>
    <p class="help bk-line">${bkLine}</p>
    <p class="help">Kontrakter, fakturaer, sjekklister, bilder og meldinger ligger i appens egen datamappe. De blir med i sikkerhetskopien når den tar med apper – sjekk at <strong>Hybelstyring</strong> er huket av under «Apper» i innstillingene for sikkerhetskopier.</p>
    <a class="sbtn on" href="api/admin/archive.zip" download>Last ned arkiv for dette leieforholdet (ZIP)</a>
    <p class="help">Inneholder alle fakturaer, årsoversikter, sjekklister (PDF), dokumenter, bilder og meldinger.</p>
    ${arch.length ? `<span class="help" style="margin-top:8px"><strong>Tidligere leieforhold</strong></span>${arch.map((a) => `<a class="sbtn" href="api/admin/archive/${a.i}.zip" download>${esc(a.tenant || 'Leietaker')} · ${esc(a.start ? fmtDate(a.start) : '')}${a.start ? ' – ' : ''}${esc(fmtDate(a.end || a.at))}</a>`).join('')}` : ''}
  </section>
  <section class="panel soft"><div class="panel-head"><h2>Leietakerbytte</h2></div>
    <p class="help">Sletter leietakerens scener og automasjoner og lager nye forslag. Kontrakt, betalinger, meldinger og sjekklister flyttes til «Tidligere leieforhold» over. Last gjerne ned arkivet først. Husk å fjerne forrige leietaker i Cloudflare Access og legge inn den nye.</p>
    <button class="danger ${A.confirmReset ? 'confirm' : ''}" data-act="tenant-reset">${A.confirmReset ? 'Trykk igjen for å bekrefte' : 'Klargjør for ny leietaker'}</button>
  </section>
  <section class="panel soft"><div class="panel-head"><h2>Oppsett</h2></div>
    <button class="toggle-row" data-act="toggle-pairing">
      <span><span class="t">Leietaker kan koble lys til Zigbee på nytt</span><span class="s">${A.st.pairing.switch ? `Åpner for tilkobling (${esc(A.st.pairing.switch)}) i opptil 10 minutter når et lys ikke svarer` : 'Fant ingen «permit join»-bryter fra Zigbee2MQTT'}</span></span>
      <span class="switch" role="switch" aria-checked="${A.cfg.pairing_enabled}"></span>
    </button>
    <p class="help">Leietakersiden kjører på port <code>8100</code> inne i Home Assistant. Pek Cloudflare Tunnel til <code>http://&lt;vertsnavn&gt;:8100</code> – vertsnavnet står på appens infoside. Se dokumentasjonen for steg-for-steg.</p>
  </section>`;
}

function render() {
  if (!A.cfg) return;
  const focusId = document.activeElement?.id || (document.activeElement?.dataset?.field === 'q' ? '__q' : null);
  A.todo = todos();
  $('todo').innerHTML = todoBar();
  $('main').innerHTML = `<div class="col-main">${reportsPanel()}${economyPanel()}${leasePanel()}${contractPanel()}${checklistPanel()}${entitiesPanel()}${scenesPanel()}${statsPanel()}${maintPanel()}${infoPanel()}</div><div class="col-side">${limitsPanel()}${alertsPanel()}${resetPanel()}</div>${photoOverlay()}`;
  if (focusId === '__q') {
    const q = document.querySelector('[data-field="q"]');
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  } else if (focusId) document.getElementById(focusId)?.focus();
  applyFolds();
}

// ---------- sammenleggbare seksjoner ----------

const FOLD_KEY = 'hybel-admin-folds';
const folds = (() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch { return {}; } })();
function isOpen(key) {
  if (key in folds) return folds[key];
  // Standard: alt lukket, unntatt meldinger når noe venter.
  if (key === 'Meldinger') return (A.st?.extras?.reports || []).some((r) => r.status === 'new' || r.status === 'in_progress' || r.landlord_unread);
  if (key === 'Økonomi') return (A.st?.extras?.lease?.overdue || []).length > 0 || (A.st?.extras?.lease?.claimed || []).length > 0;
  if (key === 'Leieforhold') return A.st?.extras?.termination?.latest?.status === 'pending';
  if (key === 'Inn- og utflytting') return (A.st?.extras?.checklists || []).some((c) => c.status === 'submitted');
  return false;
}
// ---------- hva må gjøres? ----------
// Hver seksjon kan ha et merke: 'bad' (haster), 'warn' (bør gjøres) eller 'info'.
function todos() {
  const st = A.st;
  const x = st.extras;
  const t = {};
  const add = (key, level, text) => { (t[key] = t[key] || []).push({ level, text }); };
  const waiting = x.reports.filter((r) => r.landlord_unread || (r.origin !== 'landlord' && r.status === 'new' && !r.updates.some((u) => u.from === 'landlord')));
  if (waiting.length) add('Meldinger', waiting.some((r) => r.urgent) ? 'bad' : 'warn', `${waiting.length} venter på svar`);
  const working = x.reports.filter((r) => r.status === 'in_progress').length;
  if (working) add('Meldinger', 'info', `${working} under arbeid`);
  const L = x.lease;
  if (L.overdue.length) add('Økonomi', 'bad', `${L.overdue.length} ikke betalt`);
  const tr = x.termination?.latest;
  if (tr && tr.status === 'pending') add('Leieforhold', 'bad', tr.early ? 'Søknad om å avslutte' : 'Oppsigelse fra leietaker');
  if (L.refund) add('Økonomi', 'warn', `Betal tilbake ${kr(-L.refund.total)} til leietaker`);
  if ((L.claimed || []).length) add('Økonomi', 'warn', `${L.claimed.length} meldt betalt – bekreft`);
  if (L.next && L.next.status === 'soon') add('Økonomi', 'info', `Forfall ${fmtDate(L.next.due)}`);
  const c = L.contract;
  if (c.end && c.days_left != null && c.days_left <= 90) add('Leieforhold', c.days_left <= 30 ? 'bad' : 'warn', c.days_left < 0 ? 'Kontrakten er utløpt' : `Kontrakt utløper om ${c.days_left} d`);
  if (!L.settings.rent) add('Økonomi', 'info', 'Husleie ikke satt');
  const sub = x.checklists.filter((cl) => cl.status === 'submitted').length;
  if (sub) add('Inn- og utflytting', 'warn', `${sub} til godkjenning`);
  const open = x.checklists.filter((cl) => cl.status === 'open');
  if (open.length) add('Inn- og utflytting', 'info', `Hos leietaker (${open[0].done}/${open[0].total})`);
  const off = st.entities.filter((e) => e.enabled && !e.available);
  if (off.length) add('Synlige enheter', 'bad', `${off.length} uten kontakt`);
  const e = x.electricity;
  if (e.remind && !c.auto_meter) add('Økonomi', 'info', 'Strøm ikke lest av');
  if (!L.settings.rent && e.unpaid > 0) add('Økonomi', 'warn', `Strøm ${kr(e.unpaid)} ubetalt`);
  if (e.price == null) add('Økonomi', 'info', 'Strømpris ikke satt');
  const i = x.info;
  const missing = [!i.wifi_ssid && 'wifi', !(i.contact_phone || i.contact_email) && 'kontakt'].filter(Boolean);
  if (missing.length) add('Info til leietaker', 'info', `Mangler ${missing.join(' og ')}`);
  if (!x.backup?.last || x.backup.days > 8) add('Sikkerhetskopi', 'info', x.backup?.last ? `${x.backup.days} d gammel` : 'Ikke funnet');
  const mDue = (x.maintenance || []).filter((m) => m.due);
  if (mDue.length) add('Vedlikehold', 'warn', mDue.length === 1 ? mDue[0].title : `${mDue.length} oppgaver forfalt`);
  if (!st.alerts.notify_service) add('Varsle meg', 'info', 'Bare bjella – ingen push');
  return t;
}

const LEVEL_RANK = { bad: 0, warn: 1, info: 2 };
function todoBar() {
  const t = todos();
  const items = Object.entries(t).flatMap(([key, list]) => list.filter((x) => x.level !== 'info').map((x) => ({ key, ...x })));
  items.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  if (!items.length) return `<div class="todo-bar ok"><span class="todo-ok">✓ Ingenting som venter på deg</span></div>`;
  return `<div class="todo-bar"><span class="todo-title">Må gjøres</span>${items.map((x) => `<button class="todo-chip ${x.level}" data-act="goto" data-key="${esc(x.key)}"><strong>${esc(x.key)}</strong> ${esc(x.text)}</button>`).join('')}</div>`;
}

function applyFolds() {
  document.querySelectorAll('#main section.panel').forEach((sec) => {
    const head = sec.querySelector(':scope > .panel-head');
    const key = head?.querySelector('h2')?.textContent.trim();
    if (!key) return;
    const open = isOpen(key);
    head.dataset.act = 'fold';
    head.dataset.key = key;
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', String(open));
    if (!head.querySelector('.chev')) head.insertAdjacentHTML('beforeend', '<span class="chev" aria-hidden="true"></span>');
    head.querySelector('.todo-badges')?.remove();
    const list = (A.todo || {})[key];
    if (list && list.length) {
      const sorted = [...list].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
      head.querySelector('.chev').insertAdjacentHTML('beforebegin', `<span class="todo-badges">${sorted.map((x) => `<span class="todo-badge ${x.level}">${esc(x.text)}</span>`).join('')}</span>`);
      head.classList.add('has-todo');
    } else head.classList.remove('has-todo');
    sec.classList.toggle('folded', !open);
  });
}
function toggleFold(key) {
  folds[key] = !isOpen(key);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch {}
  applyFolds();
}
document.addEventListener('keydown', (ev) => {
  const h = ev.target.closest?.('.panel-head[data-act="fold"]');
  if (h && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggleFold(h.dataset.key); }
});

// ---------- handlinger ----------

async function saveCt() {
  clearTimeout(A.ctTimer);
  try {
    const r = await api('api/admin/contract', { method: 'POST', body: JSON.stringify({ opts: A.ct }) });
    if (r.ok) A.st = r.state;
  } catch (e) { message(esc(e.message), true); }
}

async function loadCandidates() {
  if (A.cand || A.candLoading) return;
  A.candLoading = true;
  try {
    A.cand = await api('api/admin/candidates');
  } catch (e) {
    message('Kunne ikke hente enheter: ' + esc(e.message), true);
    A.cand = { entities: [], notify_services: [] };
  }
  A.candLoading = false;
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
  if (d.act === 'fold') { toggleFold(d.key); return; }
  if (d.act === 'goto') {
    folds[d.key] = true;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch {}
    applyFolds();
    const h = [...document.querySelectorAll('#main .panel-head')].find((x) => x.dataset.key === d.key);
    h?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  switch (d.act) {
    case 'ent-toggle': ents[i].enabled = !ents[i].enabled; setDirty(); break;
    case 'ent-up': [ents[i - 1], ents[i]] = [ents[i], ents[i - 1]]; setDirty(); break;
    case 'ent-down': [ents[i + 1], ents[i]] = [ents[i], ents[i + 1]]; setDirty(); break;
    case 'ent-remove': ents.splice(i, 1); setDirty(); break;
    case 'open-picker': A.picker = d.kind; A.q = ''; render(); loadCandidates(); return;
    case 'close-picker': A.picker = null; break;
    case 'stat-add': {
      const c = A.cand.numeric.find((x) => x.entity_id === d.id);
      if (c) A.cfg.stat_sensors.push({ entity_id: c.entity_id, label: c.name.slice(0, 40) });
      A.picker = null; setDirty(); break;
    }
    case 'stat-remove': A.cfg.stat_sensors.splice(Number(d.i), 1); setDirty(); break;
    case 'stat-move': {
      const ids = statItems().map((x) => x.id);
      const k = ids.indexOf(d.id), j = k + Number(d.v);
      if (k < 0 || j < 0 || j >= ids.length) break;
      [ids[k], ids[j]] = [ids[j], ids[k]];
      A.cfg.stat_order = ids; setDirty(); break;
    }
    case 'stat-toggle': {
      const hs = new Set(A.cfg.stat_hidden);
      if (hs.has(d.id)) hs.delete(d.id); else hs.add(d.id);
      A.cfg.stat_hidden = [...hs]; setDirty(); break;
    }
    case 'pick': {
      const c = A.cand.entities.find((x) => x.entity_id === d.id);
      if (!c) return;
      if (d.kind === 'entity') ents.push({ entity_id: c.entity_id, label: c.name.slice(0, 40), kind: c.kind, enabled: true, ...(c.kind === 'light' ? { min_pct: 1, max_pct: 100 } : {}), ...(c.kind === 'heat' || c.kind === 'climate' ? { min_temp: c.kind === 'climate' ? 16 : A.cfg.limits.heat_min, max_temp: c.kind === 'climate' ? 26 : A.cfg.limits.heat_max } : {}) });
      else A.cfg.alerts.entities.push(c.entity_id);
      A.picker = null;
      setDirty();
      break;
    }
    case 'safety-add': A.cfg.info.safety = [...(A.cfg.info.safety || []), d.id]; A.picker = null; setDirty(); break;
    case 'safety-remove': A.cfg.info.safety = A.cfg.info.safety.filter((x) => x !== d.id); setDirty(); break;
    case 'photo': A.photo = d.id; break;
    case 'test-notify': {
      if (A.dirty) { message('Lagre endringene først, så testes den lagrede varslingstjenesten.', true); return; }
      try {
        const r = await api('api/admin/test-notify', { method: 'POST', body: '{}' });
        A.testResult = (r.results || []).map((x) => `${x.ok ? '✓' : '✗'} ${x.channel === 'push' ? `Push til ${esc(x.target)}` : 'Bjella i Home Assistant'}${x.ok ? '' : `: ${esc(x.error)}`}`).join('<br>');
      } catch (e) { A.testResult = '✗ ' + esc(e.message); }
      break;
    }
    case 'doc-upload': uploadDoc(); return;
    case 'doc-visible':
    case 'ct-send':
    case 'ct-reset': {
      if (A.confirmDel !== d.act) { A.confirmDel = d.act; break; }
      try {
        const r = await api('api/admin/contract', { method: 'POST', body: JSON.stringify({ opts: A.ct, action: d.act === 'ct-send' ? 'send' : 'reset' }) });
        if (!r.ok) { message(esc(r.error), true); A.confirmDel = null; break; }
        A.st = r.state; A.confirmDel = null; A.ct = null;
        message(d.act === 'ct-send' ? 'Kontrakten er sendt. Leietaker har fått varsel.' : 'Du kan nå endre vilkårene og sende en ny versjon.');
      } catch (e) { message(esc(e.message), true); A.confirmDel = null; }
      break;
    }
    case 'end-approve':
    case 'end-decline': {
      if (d.act === 'end-decline' && A.confirmDel !== 'end-decline') { A.confirmDel = 'end-decline'; break; }
      const t = A.st.extras.termination.latest;
      try {
        const r = await api('api/admin/end-request', { method: 'POST', body: JSON.stringify({ id: t.id, action: d.act === 'end-approve' ? 'approve' : 'decline', date: A.endDec.date, comment: A.endDec.comment }) });
        if (!r.ok) { message(esc(r.error), true); break; }
        A.st = r.state; A.confirmDel = null;
        if (d.act === 'end-approve') { A.cfg.lease.end = A.endDec.date; message(`Godkjent. Leieforholdet avsluttes ${esc(fmtDate(A.endDec.date))}, og leietaker har fått beskjed.`); }
        else message('Leietaker har fått beskjed om avslaget.');
        A.endDec = null;
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'mt-add':
    case 'mt-done':
    case 'mt-tenant':
    case 'mt-delete': {
      if (d.act === 'mt-delete' && A.confirmDel !== `mt-${d.id}`) { A.confirmDel = `mt-${d.id}`; break; }
      const t = (A.st.extras.maintenance || []).find((x) => x.id === d.id);
      const body = d.act === 'mt-add' ? { action: 'add', ...A.mt }
        : d.act === 'mt-done' ? { action: 'done', id: d.id }
        : d.act === 'mt-delete' ? { action: 'delete', id: d.id }
        : { action: 'update', id: d.id, title: t.title, months: t.months, last: t.last, tenant: !t.tenant };
      try {
        const r = await api('api/admin/maint', { method: 'POST', body: JSON.stringify(body) });
        if (!r.ok) { message(esc(r.error), true); break; }
        A.st = r.state; A.confirmDel = null;
        if (d.act === 'mt-add') A.mt = { title: '', months: 6, tenant: false };
        if (d.act === 'mt-done') message('Registrert som utført i dag.');
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'doc-delete': {
      if (d.act === 'doc-delete' && A.confirmDel !== `doc-${d.id}`) { A.confirmDel = `doc-${d.id}`; break; }
      try {
        const r = await api('api/admin/doc', { method: 'POST', body: JSON.stringify(d.act === 'doc-delete' ? { id: d.id, delete: true } : { id: d.id, visible: d.v === '1' }) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state; A.confirmDel = null;
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'inv-delete':
    case 'inv-restore': {
      if (d.act === 'inv-delete' && A.confirmDel !== `inv-${d.v}`) { A.confirmDel = `inv-${d.v}`; break; }
      try {
        const r = await api('api/admin/payment', { method: 'POST', body: JSON.stringify({ month: d.v, void: d.act === 'inv-delete' }) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state; A.confirmDel = null;
        message(d.act === 'inv-delete' ? 'Fakturaen er slettet.' : 'Fakturaen er gjenopprettet.');
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'claim-reject': {
      try {
        const r = await api('api/admin/payment', { method: 'POST', body: JSON.stringify({ month: d.v, reject: true }) });
        A.st = r.state; message('Leietaker har fått beskjed om at betalingen ikke er funnet ennå.');
      } catch (e) { message(esc(e.message), true); }
      return render();
    }
    case 'pay-all-overdue': {
      try {
        let r = null;
        for (const o of A.st.extras.lease.overdue) {
          r = await api('api/admin/payment', { method: 'POST', body: JSON.stringify({ month: o.month, paid: true }) });
          if (!r.ok) { message(esc(r.error), true); return; }
        }
        if (r) A.st = r.state;
        message('Alle forfalte måneder er markert som betalt.');
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'month-paid': {
      try {
        const r = await api('api/admin/payment', { method: 'POST', body: JSON.stringify({ month: d.v, paid: d.paid === '1' }) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state;
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'photo-close': A.photo = null; break;
    case 'compose-send': {
      const text = A.compose.trim();
      if (!text) return;
      try {
        const r = await api('api/admin/message', { method: 'POST', body: JSON.stringify({ text }) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state; A.compose = '';
        message('Meldingen er sendt til leietaker.');
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'cl-toggle': A.clOpen = A.clOpen === d.id ? null : d.id; break;
    case 'cl-print': { const c = A.st.extras.checklists.find((x) => x.id === d.id); if (c) printChecklist(c); return; }
    case 'cl-create':
    case 'cl-approve':
    case 'cl-reopen':
    case 'cl-delete': {
      const action = d.act.slice(3);
      if (action === 'delete' && A.confirmDel !== d.id) { A.confirmDel = d.id; break; }
      const body = { action, id: d.id, type: d.v, comment: A.clComment[d.id] || '' };
      try {
        const r = await api('api/admin/checklist', { method: 'POST', body: JSON.stringify(body) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state; A.confirmDel = null;
        if (action === 'create') A.clOpen = A.st.extras.checklists[0]?.id || null;
        message({ create: 'Sjekklisten er sendt til leietaker.', approve: 'Sjekklisten er godkjent.', reopen: 'Leietaker kan endre sjekklisten igjen.', delete: 'Sjekklisten er slettet.' }[action]);
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'report-status':
    case 'report-reply':
    case 'report-seen':
    case 'report-delete': {
      const body = { id: d.id };
      if (d.act === 'report-seen') body.seen = true;
      if (d.act === 'report-status') body.status = d.v;
      if (d.act === 'report-reply') { body.reply = (A.replies[d.id] || '').trim(); if (!body.reply) return; }
      if (d.act === 'report-delete') { if (A.confirmDel !== d.id) { A.confirmDel = d.id; break; } body.delete = true; }
      try {
        const r = await api('api/admin/report', { method: 'POST', body: JSON.stringify(body) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state; A.replies[d.id] = ''; A.confirmDel = null;
        message(d.act === 'report-reply' ? 'Svaret er sendt til leietaker.' : 'Oppdatert.');
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'reading-add': {
      const nr = A.newReading;
      if (!String(nr.value).trim()) { message('Skriv inn målerstanden.', true); return; }
      try {
        const r = await api('api/admin/reading', { method: 'POST', body: JSON.stringify({ add: { value: nr.value, date: nr.date || new Date().toISOString().slice(0, 10) } }) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state; A.newReading = { value: '', date: '' };
        message('Avlesningen er lagret.');
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'reading-paid':
    case 'reading-delete': {
      const body = d.act === 'reading-paid' ? { id: d.id, paid: d.v === '1' } : { id: d.id, delete: true };
      if (d.act === 'reading-delete' && A.confirmDel !== d.id) { A.confirmDel = d.id; break; }
      try {
        const r = await api('api/admin/reading', { method: 'POST', body: JSON.stringify(body) });
        if (!r.ok) { message(esc(r.error), true); return; }
        A.st = r.state; A.confirmDel = null;
      } catch (e) { message(esc(e.message), true); }
      break;
    }
    case 'alarm-remove': A.cfg.alerts.entities = A.cfg.alerts.entities.filter((x) => x !== d.id); setDirty(); break;
    case 'toggle-pairing': A.cfg.pairing_enabled = !A.cfg.pairing_enabled; setDirty(); break;
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
  else if (f === 'all_off') { const ent = A.cfg.entities[Number(el.dataset.i)]; if (el.checked) delete ent.all_off; else ent.all_off = false; setDirty(); }
  else if (f.startsWith('info.')) { A.cfg.info[f.slice(5)] = el.value; setDirty(); }
  else if (f === 'el.price') { A.cfg.electricity.price_per_kwh = el.value.trim() === '' ? null : el.value; setDirty(); }
  else if (f === 'el.note') { A.cfg.electricity.note = el.value; setDirty(); }
  else if (f === 'nr.value') { A.newReading.value = el.value; }
  else if (f === 'nr.date') { A.newReading.date = el.value; }
  else if (f === 'stat-label') { A.cfg.stat_sensors[Number(el.dataset.i)].label = el.value; setDirty(); }
  else if (f === 'outdoor') { A.cfg.outdoor_sensor = el.value; setDirty(); }
  else if (f === 'doc-name') { A.docName = el.value; }
  else if (f.startsWith('fb.')) { A.cfg.fixed_button[f.slice(3)] = f === 'fb.n' ? Number(el.value) : el.value; setDirty(); }
  else if (f.startsWith('lease.')) { A.cfg.lease[f.slice(6)] = el.value; setDirty(); }
  else if (f === 'compose') { A.compose = el.value; }
  else if (f === 'cl-comment') { A.clComment[el.dataset.id] = el.value; }
  else if (f === 'cl-template') { A.cfg.checklist_template = el.value; setDirty(); }
  else if (f === 'cl-clean-template') { A.cfg.clean_template = el.value; setDirty(); }
  else if (f === 'admin-reply') { A.replies[el.dataset.id] = el.value; }
  else if (f === 'notify') { A.cfg.alerts.notify_service = el.value.trim(); setDirty(); }
  else if (f === 'offline-hours') { A.cfg.alerts.offline_hours = Number(el.value); setDirty(); }
  else if (f === 'q') { A.q = el.value; render(); }
  else if (f.startsWith('ct.') && A.ct) {
    const k = f.slice(3);
    A.ct[k] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.tagName === 'SELECT' || el.type === 'checkbox') { saveCt().then(render); }
    else { clearTimeout(A.ctTimer); A.ctTimer = setTimeout(saveCt, 800); }
  }
  else if (f === 'end-dec-date' && A.endDec) { A.endDec.date = el.value; }
  else if (f === 'end-dec-comment' && A.endDec) { A.endDec.comment = el.value; }
  else if (f === 'mt.title') { A.mt.title = el.value; }
  else if (f === 'mt.months') { A.mt.months = Number(el.value); }
  else if (f === 'mt.tenant') { A.mt.tenant = el.checked; }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const f = el.dataset?.field;
  if (!f || !A.cfg) return;
  if (f === 'now_sensor') {
    const ent = A.cfg.entities[Number(el.dataset.i)];
    if (el.value) ent.now_sensor = el.value; else delete ent.now_sensor;
    setDirty();
    return;
  }
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
      A.statSeries = null;
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
    if (A.st && A.st.build && st.build && st.build !== A.st.build && !A.dirty) { location.reload(); return; }
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

// Lys/mørk modus (følger systemet som standard, samme som Home Assistant gjør med «Automatisk»).
{
  const sel = document.getElementById('theme');
  if (sel && window.hybelTheme) {
    sel.value = window.hybelTheme.get();
    sel.addEventListener('change', () => window.hybelTheme.set(sel.value));
  }
}
