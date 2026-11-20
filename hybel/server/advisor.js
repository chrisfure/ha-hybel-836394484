// Sparetips: appen lager et sammendrag av siste uke (temperaturer, innstillinger, strømforbruk,
// ventilasjon, utetemperatur og automasjoner) og ber en AI-modell om konkrete tips og forslag
// til automasjoner. Ingen navn, meldinger eller betalinger sendes. Svarene lagres også hos utleier.
import { randomBytes } from 'node:crypto';
import { log } from './log.js';
import { keyOf } from './engine.js';

const MAX_HISTORY = 30;
const VENT = ['away', 'low', 'normal', 'high'];
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+\n/g, '\n').trim().slice(0, max);
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const dayKey = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));

export class Advisor {
  constructor(engine) {
    this.engine = engine;
    this.busy = false;
  }

  get d() { return this.engine.data; }

  get cfg() {
    if (!this.d.advisor) this.d.advisor = { enabled: true, per_day: 3, ai_entity: '' };
    return this.d.advisor;
  }

  get history() {
    if (!Array.isArray(this.d.advice)) this.d.advice = [];
    return this.d.advice;
  }

  aiEntities() {
    return [...this.engine.ha.states.keys()].filter((id) => id.startsWith('ai_task.'));
  }

  aiEntity() {
    const list = this.aiEntities();
    if (this.cfg.ai_entity && list.includes(this.cfg.ai_entity)) return this.cfg.ai_entity;
    return list.find((id) => /claude/.test(id) && /ai_task$|claude_ai/.test(id)) || list.find((id) => /claude/.test(id)) || list[0] || null;
  }

  usedToday() {
    const today = dayKey();
    return this.history.filter((h) => h.at && dayKey(new Date(h.at)) === today && !h.error && h.by !== 'landlord').length;
  }

  saveCfg(b = {}) {
    const c = this.cfg;
    if (b.enabled !== undefined) c.enabled = Boolean(b.enabled);
    if (b.per_day !== undefined) { const n = Math.round(Number(b.per_day)); if (n >= 1 && n <= 10) c.per_day = n; }
    if (b.weather_entity !== undefined) c.weather_entity = /^weather\.[a-z0-9_]+$/.test(String(b.weather_entity)) ? String(b.weather_entity) : '';
    if (b.ai_entity !== undefined) c.ai_entity = /^ai_task\.[a-z0-9_]+$/.test(String(b.ai_entity)) ? String(b.ai_entity) : '';
  }

  // Det leietaker ser.
  tenantView() {
    const c = this.cfg;
    const last = [...this.history].reverse().find((h) => !h.error && h.by !== 'landlord') || null;
    return {
      enabled: Boolean(c.enabled && this.aiEntity()),
      consent: Boolean(this.d.advice_consent),
      left: Math.max(0, (c.per_day || 3) - this.usedToday()),
      busy: this.busy,
      last: last && { id: last.id, at: last.at, lang: last.lang, summary: last.summary, tips: last.tips, automations: last.automations.map((a) => ({ name: a.name, reason: a.reason, draft: a.draft })) }
    };
  }

  adminView() {
    return {
      ...this.cfg,
      ai_entities: this.aiEntities(),
      ai_entity_used: this.aiEntity(),
      weather_entities: [...this.engine.ha.states.keys()].filter((id) => id.startsWith('weather.')),
      weather_entity_used: this.weatherEntity(),
      consent: this.d.advice_consent || null,
      history: [...this.history].reverse().slice(0, 15)
    };
  }

  // ---------- data om hybelen ----------

  async facts() {
    const eng = this.engine;
    const [week, day] = await Promise.all([eng.stats.get('7d'), eng.stats.get('24h')]);
    const ents = eng.enabled().filter((e) => ['heat', 'climate', 'vent', 'light'].includes(e.kind));
    const codes = new Map();
    const devices = ents.map((e, i) => {
      const code = `d${i + 1}`;
      codes.set(code, e);
      const st = eng.state(e);
      const a = st?.attributes || {};
      const base = { id: code, navn: e.label, type: { heat: 'varmeovn/termostat', climate: 'varmepumpe', vent: 'ventilasjon', light: 'lys' }[e.kind] };
      if (e.kind === 'heat' || e.kind === 'climate') {
        return { ...base, innstilt_nå: a.temperature ?? null, målt_nå: a.current_temperature ?? null, modus: st?.state, lovlig_min: eng.tempRange(e)[0], lovlig_maks: eng.tempRange(e)[1] };
      }
      if (e.kind === 'vent') return { ...base, nivå_nå: eng.currentValue(e), lovlige_nivåer: VENT.filter((v) => v !== 'away' || this.d.limits?.vent_allow_away) };
      return { ...base, lysstyrke_nå: eng.currentValue(e) };
    });

    // Innstilt temperatur og ventilasjonsnivå per 2 timer siste uke.
    const setpoints = await this.setpointHistory(ents.filter((e) => e.kind !== 'light'), codes);

    const stepH = Math.round(week.bucket / 3600e3);
    const series = week.series.map((s) => ({ hva: `${s.label}${s.sub ? ` (${s.sub})` : ''}`, enhet: s.unit, snitt: s.avg, min: r1(s.min), maks: r1(s.max), per_2t: s.points }));
    const energyWeek = week.energy.map((en) => ({ hva: en.label, kwh_per_dag: en.points.map(r1), watt_nå: en.power, målt_fra: en.since && en.since > week.start + 6 * 3600e3 ? new Date(en.since).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'medium', timeStyle: 'short' }) : 'hele uken', totalt_kwh: r1(en.total) }));
    const energyDay = day.energy.map((en) => ({ hva: en.label, kwh_per_time_siste_døgn: en.points.map(r1) }));
    const autos = (this.d.automations || []).filter((a) => a.enabled !== false).map((a) => eng.describeAutomation(a));

    // Utetemperatur per døgn og graddager (grunnlag 17 °C), og strøm per graddag.
    const out = week.series.find((x) => x.type === 'out');
    let outdoor = null;
    if (out) {
      const perDay = Math.round(24 / stepH);
      const days = [];
      for (let k = 0; k < out.points.length; k += perDay) {
        const v = out.points.slice(k, k + perDay).filter((x) => x != null);
        days.push(v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null);
      }
      const gd = r1(days.reduce((acc, t) => acc + (t == null ? 0 : Math.max(0, 17 - t)), 0));
      outdoor = {
        snitt_per_døgn_siste_uke: days, graddager_siste_uke: gd, nå: out.now,
        kwh_per_graddag: gd > 0 ? week.energy.map((en) => ({ hva: en.label, kwh_per_graddag: r1(en.total / gd) })) : []
      };
    }
    const vent = await this.ventFacts(ents.filter((e) => e.kind === 'vent'));
    const forecast = await this.forecast();
    return {
      codes,
      payload: {
        tidspunkt: new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'full', timeStyle: 'short' }),
        tidsserier_start: new Date(week.start).toISOString(),
        tidsserier_steg_timer: stepH,
        strømpris_kr_per_kwh: week.price,
        enheter: devices,
        innstillinger_per_2t: setpoints,
        målinger_siste_uke: series,
        strøm_siste_uke: energyWeek,
        strøm_siste_døgn: energyDay,
        aktive_automasjoner: autos,
        ute: outdoor,
        ventilasjonsaggregat: vent,
        værvarsel: forecast
      }
    };
  }

  // Alt ventilasjonsaggregatet rapporterer (varmegjenvinning, tilluft/avtrekk, ettervarmer, eco, filter),
  // nå-verdier og historikk for de viktigste temperaturene og gjenvinningsgraden.
  async ventFacts(vents) {
    if (!vents.length) return null;
    const eng = this.engine;
    const res = [];
    for (const e of vents) {
      const obj = e.entity_id.split('.')[1];
      const sib = new Set(await eng.stats.deviceSensors(e.entity_id).catch(() => []));
      for (const id of eng.ha.states.keys()) if (/^(sensor|binary_sensor|switch)\./.test(id) && id.split('.')[1].startsWith(`${obj}_`)) sib.add(id);
      const now = [];
      const hist = [];
      for (const id of [...sib].sort()) {
        const st = eng.ha.states.get(id);
        if (!st || ['unknown', 'unavailable', ''].includes(st.state)) continue;
        const name = String(st.attributes?.friendly_name || id).replace(/[⁠​]/g, '');
        const unit = st.attributes?.unit_of_measurement || '';
        now.push(`${name}: ${st.state}${unit ? ` ${unit}` : ''}`);
        if (/gjenvinn|recovery|efficien|tilluft.*temp|supply.*temp|avtrekk.*temp|extract.*temp|utetemp|outdoor|veksler|exchanger|varmeeffekt|heater/i.test(`${id} ${name}`) && Number.isFinite(Number(st.state)) && hist.length < 6) hist.push({ id, name, unit });
      }
      const a = eng.state(e)?.attributes || {};
      const series = await this.bucketHistory(hist.map((h) => h.id));
      res.push({
        navn: e.label,
        innstillinger_nå: { viftenivå: a.fan_mode ?? null, forhåndsinnstilling: a.preset_mode ?? null, tilluft_settpunkt: a.temperature ?? null, eco_modus: a.eco_mode ?? null, modus: eng.state(e)?.state },
        sensorer_nå: now.slice(0, 30),
        historikk_per_2t: hist.map((h) => ({ hva: h.name, enhet: h.unit, verdier: series[h.id] || [] }))
      });
    }
    return res;
  }

  // Tidsserie per 2 timer siste uke (snitt av målinger i hver periode, siste kjente verdi videreført).
  async bucketHistory(ids) {
    if (!ids.length) return {};
    const end = Date.now();
    const start = end - 7 * 24 * 3600e3;
    let hist = {};
    try {
      hist = await this.engine.ha.send({ type: 'history/history_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false }, false, 30000);
    } catch (err) {
      log.warn('Sparetips: fikk ikke historikk for ventilasjon:', err.message);
      return {};
    }
    const step = 2 * 3600e3;
    const n = Math.ceil((end - start) / step);
    const out = {};
    for (const id of ids) {
      const rows = (hist[id] || []).map((r) => [(r.lu ?? r.lc ?? 0) * 1000 || Date.parse(r.last_updated || r.last_changed), Number(r.s ?? r.state)]).filter(([, v]) => Number.isFinite(v)).sort((x, y) => x[0] - y[0]);
      const vals = [];
      let i = 0, last = null;
      for (let b = 0; b < n; b++) {
        const b1 = start + (b + 1) * step;
        let sum = 0, k = 0;
        while (i < rows.length && rows[i][0] < b1) { sum += rows[i][1]; k++; last = rows[i][1]; i++; }
        vals.push(k ? r1(sum / k) : r1(last));
      }
      out[id] = vals;
    }
    return out;
  }

  weatherEntity() {
    const list = [...this.engine.ha.states.keys()].filter((id) => id.startsWith('weather.'));
    if (this.cfg.weather_entity && list.includes(this.cfg.weather_entity)) return this.cfg.weather_entity;
    return list.find((id) => /home|hjem|forecast/.test(id)) || list[0] || null;
  }

  // Værvarsel: neste 7 døgn og neste 24 timer.
  async forecast() {
    const w = this.weatherEntity();
    if (!w) return null;
    const get = async (type) => {
      try {
        const r = await this.engine.ha.send({ type: 'call_service', domain: 'weather', service: 'get_forecasts', service_data: { type }, target: { entity_id: w }, return_response: true }, false, 20000);
        return r?.response?.[w]?.forecast || [];
      } catch (err) {
        log.debug('Sparetips: værvarsel', type, err.message);
        return [];
      }
    };
    const [daily, hourly] = await Promise.all([get('daily'), get('hourly')]);
    const day = (iso) => new Date(iso).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short' });
    return {
      døgn: daily.slice(0, 7).map((f) => ({ dag: day(f.datetime), maks: f.temperature ?? null, min: f.templow ?? null, vær: f.condition, vind_ms: f.wind_speed != null ? r1(f.wind_speed / (this.engine.ha.states.get(w)?.attributes?.wind_speed_unit === 'km/h' ? 3.6 : 1)) : null, nedbør_mm: f.precipitation ?? null })),
      neste_24t_temp_per_time: hourly.slice(0, 24).map((f) => f.temperature ?? null)
    };
  }

  async setpointHistory(ents, codes) {
    if (!ents.length) return [];
    const end = Date.now();
    const start = end - 7 * 24 * 3600e3;
    let hist = {};
    try {
      hist = await this.engine.ha.send({
        type: 'history/history_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
        entity_ids: ents.map((e) => e.entity_id), minimal_response: false, no_attributes: false, significant_changes_only: false
      }, false, 30000);
    } catch (err) {
      log.warn('Sparetips: fikk ikke innstillingshistorikk:', err.message);
      return [];
    }
    const code = (e) => [...codes.entries()].find(([, x]) => x === e)?.[0];
    const step = 2 * 3600e3;
    const n = Math.ceil((end - start) / step);
    return ents.map((e) => {
      const rows = (hist[e.entity_id] || []).map((r) => ({ t: (r.lu ?? r.lc ?? 0) * 1000 || Date.parse(r.last_updated || r.last_changed), s: r.s ?? r.state, a: r.a || r.attributes || {} })).sort((x, y) => x.t - y.t);
      const out = [];
      let i = 0, cur = null;
      for (let b = 0; b < n; b++) {
        const b1 = start + (b + 1) * step;
        while (i < rows.length && rows[i].t < b1) { cur = rows[i]; i++; }
        if (!cur) { out.push(null); continue; }
        if (e.kind === 'vent') out.push(String(cur.a?.preset_mode || '').toLowerCase() === 'away' ? 'away' : cur.a?.fan_mode ?? cur.s);
        else out.push(cur.s === 'off' ? 'av' : r1(Number(cur.a?.temperature)));
      }
      return { id: code(e), navn: e.label, verdi_per_2t: out };
    });
  }

  prompt(payload, lang) {
    const en = lang === 'en';
    return `Du er en energirådgiver for en liten utleiehybel i Norge. Leietakeren betaler strøm etter forbruk og har trykket «Få sparetips» i hybel-appen.
Under følger måledata fra siste uke (JSON). Tidsserier har én verdi per ${payload.tidsserier_steg_timer}. time fra tidsserier_start (UTC). null betyr ukjent.

Oppgave:
1. Finn de 2–4 tiltakene som gir størst besparelse eller bedre inneklima for akkurat denne hybelen, basert på tallene. Vær konkret og vis til tallene (f.eks. «stua har stått på 23 °C også om natta»). Estimer besparelsen forsiktig i kWh og kroner per måned med strømprisen som er oppgitt (er den null, oppgi bare kWh uten å kommentere prisen). Bruk tommelfingerregelen ca. 5 % per grad lavere temperatur for direkte elektrisk oppvarming, og si at det er et anslag.
2. Foreslå 0–3 automasjoner som gjennomfører tiltakene. Ikke foreslå noe som allerede finnes i aktive_automasjoner. Hold deg innenfor lovlig_min/lovlig_maks og lovlige_nivåer. Ikke foreslå noe som går ut over komfort på en urimelig måte (ikke under 17 °C i oppholdsrom når leietakeren er hjemme).
3. Strømmålere med målt_fra senere enn uken startet er nye – 0 kWh før det tidspunktet betyr ingen data, ikke feil eller null forbruk.
4. Ta med utetemperaturen: bruk ute.graddager_siste_uke og kwh_per_graddag til å vurdere om forbruket er rimelig for været, og sammenlign kalde og milde dager. Ikke kall forbruket høyt hvis det skyldes kulde. Ikke bruk ordet «graddager» eller tallet kWh per graddag i teksten – skriv i stedet med vanlige ord, f.eks. «selv om det var mildt» eller «fordi det var kaldere».
5. Vurder ventilasjonsaggregatet med varmegjenvinning: gjenvinningsgrad, tilluft- mot avtrekkstemperatur, ettervarmer/tilluft_settpunkt, eco-modus og viftenivå. Med høy gjenvinningsgrad er varmetapet fra ventilasjonen lite, så ikke overdriv gevinsten av lavere viftenivå – men tørr luft om vinteren kan tale for lavere luftmengde. Leietakeren kan bare styre viftenivået. Nevn aldri ettervarmer, tilluftstemperatur, settpunkt, eco-modus eller varmegjenvinning i tips eller oppsummering – det kan leietakeren ikke gjøre noe med. Er noe av dette tydelig unormalt, kan det bare stå kort i til_utleier.
6. Ta hensyn til værvarselet: kommer det en kuldeperiode, mildvær eller sterk vind de neste dagene, kan tipsene være konkrete for det (f.eks. «det blir kaldt fra lørdag, ...»). Ikke finn på værdata som ikke står i varselet.
7. Hvis det er for lite data til å si noe sikkert, si det ærlig og gi heller generelle, korte tips.

Regler for teksten: Skriv til leietakeren med «du». ${en ? 'Write all text in English.' : 'Skriv på norsk bokmål.'} Korte setninger, ingen markdown. Ikke nevn tekniske systemer, integrasjoner eller entity-id-er – bruk navnene på enhetene. Ikke gi råd om å endre utstyr eller ting som er utleiers ansvar; nevn dem i så fall i «til_utleier».

Svar KUN med gyldig JSON på denne formen (ingen tekst før eller etter):
{
  "oppsummering": "1–2 setninger om hvordan hybelen brukes nå",
  "tips": [{"tittel": "kort", "tekst": "2–3 setninger", "besparelse": "kort, maks 40 tegn, f.eks. «ca. 15 kWh / 30 kr i måneden», eller tom streng"}],
  "automasjoner": [{
    "navn": "kort navn",
    "hvorfor": "1 setning",
    "når": {"type": "time", "at": "HH:MM"} eller {"type": "sunset" | "sunrise", "offset": minutter (-180..180)},
    "dager": [1,2,3,4,5,6,7] (1 = mandag),
    "sett": {"d1": 19, "d3": "low"}  (temperatur som tall for varme, nivå som tekst for ventilasjon, lysstyrke 0–100 for lys),
    "deretter": [{"at": "HH:MM", "sett": {"d1": 21}}]  (valgfritt, maks 3: samme enheter settes til nye verdier senere, f.eks. senk kl. 23 og opp igjen kl. 06.30 i én automasjon)
  }],
  "til_utleier": "kort merknad til utleier om noe bør sjekkes (fukt, feil, unormalt forbruk), ellers tom streng"
}

Data:
${JSON.stringify(payload)}`;
  }

  // ---------- kjør ----------

  async run(lang = 'no', consent = false, by = 'tenant') {
    const c = this.cfg;
    const landlord = by === 'landlord';
    if (!c.enabled && !landlord) throw new Error('Sparetips er ikke slått på');
    const ai = this.aiEntity();
    if (!ai) throw new Error('Sparetips er ikke tilgjengelig akkurat nå');
    if (!landlord && !this.d.advice_consent) {
      if (!consent) throw new Error('Godta at måledata sendes til vurdering først');
      this.d.advice_consent = { at: new Date().toISOString() };
    }
    if (!landlord && this.usedToday() >= (c.per_day || 3)) throw new Error('Du har brukt dagens vurderinger – prøv igjen i morgen');
    if (this.busy) throw new Error('En vurdering pågår allerede');
    this.busy = true;
    this.engine.changed();
    const entry = { id: randomBytes(5).toString('hex'), by, at: new Date().toISOString(), lang: lang === 'en' ? 'en' : 'no', summary: '', tips: [], automations: [], to_landlord: '' };
    try {
      const { codes, payload } = await this.facts();
      const res = await this.engine.ha.send({
        type: 'call_service', domain: 'ai_task', service: 'generate_data',
        service_data: { task_name: 'Hybel sparetips', entity_id: ai, instructions: this.prompt(payload, entry.lang) },
        return_response: true
      }, false, 120000);
      const text = res?.response?.data ?? res?.data ?? '';
      const parsed = this.parse(typeof text === 'string' ? text : JSON.stringify(text));
      entry.summary = str(parsed.oppsummering, 400);
      entry.tips = (Array.isArray(parsed.tips) ? parsed.tips : []).slice(0, 4).map((t) => ({ title: str(t.tittel, 80), text: str(t.tekst, 500), saving: str(t.besparelse, 120) })).filter((t) => t.title && t.text);
      entry.automations = (Array.isArray(parsed.automasjoner) ? parsed.automasjoner : []).slice(0, 3).map((a) => this.toDraft(a, codes)).filter(Boolean);
      entry.to_landlord = str(parsed.til_utleier, 400);
      if (!entry.tips.length && !entry.summary) throw new Error('Tomt svar');
    } catch (err) {
      log.warn('Sparetips feilet:', err.message);
      entry.error = err.message;
    } finally {
      this.busy = false;
    }
    this.history.push(entry);
    while (this.history.length > MAX_HISTORY) this.history.shift();
    this.engine.store.save();
    this.engine.changed();
    if (entry.error) throw new Error('Fikk ikke laget tips akkurat nå. Prøv igjen litt senere.');
    if (entry.to_landlord && !landlord) {
      this.engine.notify(`Sparetips for hybelen: ${entry.to_landlord}`, { title: 'Hybel: merknad fra sparetips', untrusted: true }).catch(() => {});
    }
    return entry;
  }

  parse(text) {
    const t = String(text).replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('Svaret var ikke JSON');
    return JSON.parse(t.slice(a, b + 1));
  }

  // Gjør AI-forslaget om til et utkast i appens format (verdier per enhetsnøkkel). Ugyldige forslag droppes.
  toDraft(a, codes) {
    try {
      const w = a['når'] || a.naar || a.when || {};
      let trigger;
      if (w.type === 'time' && isTime(w.at)) trigger = { type: 'time', at: w.at, offset: 0 };
      else if ((w.type === 'sunset' || w.type === 'sunrise') && Math.abs(Number(w.offset) || 0) <= 180) trigger = { type: w.type, offset: Math.round((Number(w.offset) || 0) / 15) * 15 };
      else return null;
      const days = [...new Set((Array.isArray(a.dager) ? a.dager : [1, 2, 3, 4, 5, 6, 7]).map(Number).filter((n) => n >= 1 && n <= 7))].sort();
      const values = {};
      for (const [code, v] of Object.entries(a.sett || {})) {
        const e = codes.get(code);
        if (!e) continue;
        try {
          if (e.kind === 'climate') values[keyOf(e.entity_id)] = this.engine.sanitize(e, typeof v === 'object' ? v : { mode: 'heat', temp: v }, true);
          else values[keyOf(e.entity_id)] = this.engine.sanitize(e, v, true);
        } catch { /* utenfor grensene – hopp over */ }
      }
      if (!Object.keys(values).length) return null;
      const steps = [];
      for (const st of (Array.isArray(a.deretter) ? a.deretter : []).slice(0, 3)) {
        if (!isTime(st?.at)) continue;
        const sv = {};
        for (const k of Object.keys(values)) {
          const code = [...codes.entries()].find(([, e]) => keyOf(e.entity_id) === k)?.[0];
          const e = codes.get(code);
          const v = st.sett?.[code];
          if (!e || v == null) { sv[k] = values[k]; continue; }
          try { sv[k] = e.kind === 'climate' ? this.engine.sanitize(e, typeof v === 'object' ? v : { mode: 'heat', temp: v }, true) : this.engine.sanitize(e, v, true); } catch { sv[k] = values[k]; }
        }
        steps.push({ trigger: { type: 'time', at: st.at }, action: { type: 'set', values: sv } });
      }
      const draft = { id: null, trigger, window: null, days: days.length ? days : [1, 2, 3, 4, 5, 6, 7], action: { type: 'set', values }, revert_after: 0, steps };
      this.engine.validateAutomation(draft);
      return { name: str(a.navn, 60), reason: str(a.hvorfor, 200), draft };
    } catch (err) {
      log.debug('Sparetips: forkastet forslag:', err.message);
      return null;
    }
  }
}
