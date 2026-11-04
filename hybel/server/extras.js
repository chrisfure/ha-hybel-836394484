// Info-side, meldinger til utleier og strømavlesning. Alt lagres i /data (aldri i koden).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.js';
import { loadVapid, sendPush } from './webpush.js';
import { Checklists, DEFAULT_TEMPLATE, parseTemplate, templateToText } from './checklist.js';
import { Lease, defaultLease } from './lease.js';

export const REPORT_CATEGORIES = ['Vann og rør', 'Elektrisk', 'Varme og ventilasjon', 'Hvitevarer', 'Dører, vinduer og lås', 'Annet'];
export const REPORT_STATUS = ['new', 'in_progress', 'done'];
const STATUS_LABEL = { new: 'Mottatt', in_progress: 'Under arbeid', done: 'Løst', info: 'Fra utleier' };
const MAX_REPORT_PHOTOS = 3;
export const isPhotoId = (id) => /^[a-f0-9]{16}$/.test(String(id));
const MAX_OPEN_REPORTS = 20;

const newId = () => randomBytes(5).toString('hex');
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(new Date(v).getTime());

export function defaultExtras() {
  return {
    info: { wifi_ssid: '', wifi_password: '', contact_name: '', contact_phone: '', contact_email: '', garbage: '', rules: '', emergency: '', other: '', safety: [] },
    reports: [],
    readings: [],
    electricity: { price_per_kwh: null, note: '' },
    push_subs: [],
    push_reminded: '',
    checklists: [],
    checklist_template: null,
    photo_pending: {},
    lease: defaultLease(),
    payments: {},
    lease_flags: {}
  };
}

export class Extras {
  constructor(engine) {
    this.engine = engine;
    this.dir = engine.store.dir;
    this.photoDir = join(this.dir, 'photos');
    try { mkdirSync(this.photoDir, { recursive: true }); } catch {}
    try { this.vapid = loadVapid(this.dir); } catch (err) { log.warn('Pushvarsler er ikke tilgjengelige:', err.message); }
    this.checklists = new Checklists(this);
    this.lease = new Lease(this);
  }

  save() {
    this.engine.store.save();
  }

  // ---------- bilder ----------

  photoFile(id) {
    return isPhotoId(id) ? join(this.photoDir, `${id}.jpg`) : null;
  }

  savePhoto(buf) {
    if (!buf || buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Bildet må være JPEG');
    const pending = this.d.photo_pending || (this.d.photo_pending = {});
    if (Object.keys(pending).length > 40) throw new Error('For mange bilder lastet opp – prøv igjen senere');
    const id = randomBytes(8).toString('hex');
    writeFileSync(this.photoFile(id), buf);
    pending[id] = Date.now();
    this.save();
    return id;
  }

  // Bildet tas i bruk (i sjekkliste eller melding). Bilder som aldri tas i bruk ryddes bort etter et døgn.
  claimPhoto(id) {
    const pending = this.d.photo_pending || {};
    if (!isPhotoId(id) || !pending[id]) throw new Error('Bildet finnes ikke – last opp på nytt');
    delete pending[id];
  }

  deletePhotos(ids) {
    for (const id of ids || []) {
      const f = this.photoFile(id);
      if (f) try { unlinkSync(f); } catch {}
    }
  }

  // ---------- pushvarsler til leietaker ----------

  pushSubscribe(cmd, ctx) {
    if (!this.vapid) throw new Error('Varsler er ikke tilgjengelige');
    const sub = cmd.subscription || {};
    const endpoint = String(sub.endpoint || '');
    if (!/^https:\/\/[^\s]{10,800}$/.test(endpoint)) throw new Error('Ugyldig abonnement');
    if (!sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Ugyldig abonnement');
    const subs = this.d.push_subs;
    const entry = { endpoint, keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }, created: new Date().toISOString(), device: str(cmd.device, 60) };
    this.d.push_subs = [...subs.filter((s) => s.endpoint !== endpoint), entry].slice(-8);
    if (ctx?.origin) this.d.push_subject = ctx.origin;
    this.save();
  }

  pushUnsubscribe(cmd) {
    this.d.push_subs = this.d.push_subs.filter((s) => s.endpoint !== cmd.endpoint);
    this.save();
  }

  async pushTenant(msg, only = null) {
    if (!this.vapid) return 0;
    const subs = this.d.push_subs.filter((s) => !only || s.endpoint === only);
    if (!subs.length) return 0;
    const subject = this.d.push_subject || 'mailto:utleier@example.invalid';
    let ok = 0;
    const gone = [];
    await Promise.all(subs.map(async (s) => {
      const r = await sendPush(this.vapid, s, { title: msg.title, body: msg.body, tag: msg.tag || 'hybel', url: msg.url || '/' }, subject, { urgency: msg.urgency });
      if (r === 'ok') ok++;
      if (r === 'gone') gone.push(s.endpoint);
    }));
    if (gone.length) {
      this.d.push_subs = this.d.push_subs.filter((s) => !gone.includes(s.endpoint));
      this.save();
      log.info(`Fjernet ${gone.length} utgått(e) varselabonnement.`);
    }
    log.info(`Pushvarsel til leietaker (${ok}/${subs.length}): ${msg.title}`);
    return ok;
  }

  // ---------- jevnlige oppgaver ----------

  tick() {
    // Rydd bilder som ble lastet opp men aldri brukt.
    const pending = this.d.photo_pending || {};
    let ch = false;
    for (const [id, at] of Object.entries(pending)) {
      if (Date.now() - at > 86400000) { this.deletePhotos([id]); delete pending[id]; ch = true; }
    }
    // Påminnelse om strømavlesning: den 28. og utover, kl. 18, én gang per måned.
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (now.getDate() >= 28 && now.getHours() >= 18 && this.d.push_reminded !== month && this.d.push_subs.length) {
      const last = this.d.readings[this.d.readings.length - 1];
      if (!last || !last.date.startsWith(month) || Number(last.date.slice(8)) < 20) {
        this.d.push_reminded = month;
        ch = true;
        this.pushTenant({ title: 'Les av strømmen', body: 'Det er slutten av måneden – husk å lese av strømmåleren.', tag: 'strom', url: '/?vis=strom' });
      }
    }
    if (ch) this.save();
    this.lease.tick();
  }

  get d() {
    return this.engine.data;
  }

  // ---------- info ----------

  safetyView() {
    const ha = this.engine.ha;
    return (this.d.info.safety || []).map((id) => {
      const st = ha.states.get(id);
      const a = st?.attributes || {};
      const name = a.friendly_name || id;
      if (!st || st.state === 'unavailable' || st.state === 'unknown') return { name, text: 'Ingen kontakt', level: 'warn' };
      if (id.startsWith('binary_sensor.')) {
        const on = st.state === 'on';
        const problem = ['smoke', 'gas', 'moisture', 'problem', 'safety', 'carbon_monoxide', 'heat'].includes(a.device_class) || /alarm|røyk|lekk/i.test(name);
        return { name, text: on ? (problem ? 'ALARM' : 'På') : problem ? 'OK' : 'Av', level: on && problem ? 'bad' : 'ok' };
      }
      const unit = a.unit_of_measurement ? ` ${a.unit_of_measurement}` : '';
      const n = Number(st.state);
      const low = a.device_class === 'battery' && Number.isFinite(n) && n < 20;
      return { name, text: `${st.state}${unit}`, level: low ? 'warn' : 'ok' };
    });
  }

  saveInfo(body, errors) {
    this.lease.save(body, errors);
    if (!body.info) return;
    const i = body.info;
    const info = this.d.info;
    for (const [k, max] of [['wifi_ssid', 64], ['wifi_password', 64], ['contact_name', 60], ['contact_phone', 30], ['contact_email', 80], ['garbage', 1500], ['rules', 3000], ['emergency', 1500], ['other', 3000]]) {
      if (i[k] !== undefined) info[k] = str(i[k], max);
    }
    if (Array.isArray(i.safety)) info.safety = [...new Set(i.safety.map(String).filter((id) => /^(binary_sensor|sensor)\.[a-z0-9_]+$/.test(id)))].slice(0, 10);
    if (body.electricity) {
      const p = body.electricity.price_per_kwh;
      if (p === null || p === '' || p === undefined) this.d.electricity.price_per_kwh = null;
      else {
        const n = Math.round(Number(String(p).replace(',', '.')) * 100) / 100;
        if (!(n >= 0 && n <= 20)) errors.push('Strømprisen må være mellom 0 og 20 kr per kWh');
        else this.d.electricity.price_per_kwh = n;
      }
      if (body.electricity.note !== undefined) this.d.electricity.note = str(body.electricity.note, 300);
    }
  }

  // ---------- meldinger ----------

  createReport(cmd) {
    const category = REPORT_CATEGORIES.includes(cmd.category) ? cmd.category : 'Annet';
    const text = str(cmd.text, 2000);
    if (text.length < 3) throw new Error('Skriv litt om hva det gjelder');
    const open = this.d.reports.filter((r) => r.status !== 'done').length;
    if (open >= MAX_OPEN_REPORTS) throw new Error('Det er mange åpne meldinger – vent til utleier har svart');
    const photos = (Array.isArray(cmd.photos) ? cmd.photos : []).slice(0, MAX_REPORT_PHOTOS);
    for (const p of photos) this.claimPhoto(p);
    const r = { id: newId(), created: new Date().toISOString(), category, text, urgent: Boolean(cmd.urgent), status: 'new', updates: [], tenant_unread: false, photos };
    this.d.reports.unshift(r);
    this.engine.store.save();
    this.engine.notify(`${category}: ${text.slice(0, 300)}`, { title: r.urgent ? 'HASTER – melding fra hybel' : 'Melding fra hybel', inbox: true, id: `melding_${r.id}`, event: 'melding' }).catch((e) => log.warn('Varsling feilet:', e.message));
  }

  tenantReply(cmd) {
    const r = this.d.reports.find((x) => x.id === cmd.id);
    if (!r) throw new Error('Meldingen finnes ikke');
    const text = str(cmd.text, 1000);
    if (!text) throw new Error('Skriv et svar');
    r.updates.push({ from: 'tenant', text, at: new Date().toISOString() });
    if (r.status === 'done') r.status = r.origin === 'landlord' ? 'info' : 'new';
    r.landlord_unread = true;
    this.engine.store.save();
    this.engine.notify(`${r.category} – «${r.text.slice(0, 60)}»\n\nLeietaker svarer: ${text.slice(0, 300)}`, { title: 'Svar fra hybel', inbox: true, id: `melding_${r.id}`, event: 'svar' }).catch(() => {});
  }

  markSeen() {
    let changed = false;
    for (const r of this.d.reports) if (r.tenant_unread) { r.tenant_unread = false; changed = true; }
    if (changed) this.engine.store.save();
  }

  adminMessage(body) {
    const text = str(body.text, 2000);
    if (text.length < 2) throw new Error('Skriv en melding');
    const r = { id: newId(), created: new Date().toISOString(), origin: 'landlord', category: 'Fra utleier', text, urgent: false, status: 'info', updates: [], tenant_unread: true, photos: [] };
    this.d.reports.unshift(r);
    this.save();
    this.pushTenant({ title: 'Melding fra utleier', body: text.slice(0, 240), tag: `melding-${r.id}`, url: '/?vis=meld' });
  }

  adminUpdateReport(body) {
    const r = this.d.reports.find((x) => x.id === body.id);
    if (!r) throw new Error('Meldingen finnes ikke');
    if (body.seen === true) { r.landlord_unread = false; this.save(); return; }
    if (body.delete === true) {
      this.deletePhotos(r.photos);
      this.d.reports = this.d.reports.filter((x) => x.id !== r.id);
      this.engine.dismissNotice(`melding_${r.id}`);
      this.engine.store.save();
      return;
    }
    let statusChanged = false;
    if (body.status && REPORT_STATUS.includes(body.status) && body.status !== r.status) {
      statusChanged = true;
      r.status = body.status;
      r.updates.push({ from: 'landlord', text: `Status: ${STATUS_LABEL[body.status]}`, at: new Date().toISOString(), status: true });
      r.tenant_unread = true;
    }
    if (r.status !== 'new') this.engine.dismissNotice(`melding_${r.id}`);
    const text = str(body.reply, 1000);
    if (text) {
      r.updates.push({ from: 'landlord', text, at: new Date().toISOString() });
      r.tenant_unread = true;
    }
    r.landlord_unread = false;
    this.engine.store.save();
    if (text || statusChanged) {
      const what = r.origin === 'landlord' ? 'meldingen fra utleier' : `«${r.text.slice(0, 50)}»`;
      this.pushTenant({
        title: text ? 'Svar fra utleier' : `Status: ${STATUS_LABEL[r.status]}`,
        body: text ? text.slice(0, 240) : `Gjelder ${what}`,
        tag: `melding-${r.id}`,
        url: '/?vis=meld'
      });
    }
  }

  // ---------- strøm ----------

  addReading(cmd, by = 'tenant') {
    if (by === true) by = 'landlord';
    const date = isDate(cmd.date) ? cmd.date : new Date().toISOString().slice(0, 10);
    const value = Math.round(Number(String(cmd.value).replace(',', '.')) * 10) / 10;
    if (!Number.isFinite(value) || value < 0 || value > 10_000_000) throw new Error('Ugyldig målerstand');
    const list = this.d.readings;
    const prev = list[list.length - 1];
    if (prev) {
      if (date < prev.date) throw new Error(`Datoen må være etter forrige avlesning (${prev.date})`);
      if (value < prev.value) throw new Error(`Målerstanden kan ikke være lavere enn forrige (${prev.value} kWh)`);
      if (value - prev.value > 20000) throw new Error('Forbruket ser urimelig høyt ut – sjekk tallet');
    }
    const reading = { id: newId(), date, value, price: this.d.electricity.price_per_kwh, paid: false, at: new Date().toISOString() };
    if (by !== 'tenant') reading.by = by;
    list.push(reading);
    this.engine.store.save();
    if (by === 'landlord') return;
    const p = this.d.electricity.price_per_kwh;
    const fmtD = (x) => x.split('-').reverse().join('.');
    let msg;
    if (prev) {
      const kwh = Math.round((value - prev.value) * 10) / 10;
      msg = `Målerstand ${String(value).replace('.', ',')} kWh (${fmtD(date)}).\nForbruk ${String(kwh).replace('.', ',')} kWh siden ${fmtD(prev.date)}${p != null ? ` = ${(kwh * p).toFixed(2).replace('.', ',')} kr` : ''}.`;
    } else {
      msg = `Første avlesning: ${String(value).replace('.', ',')} kWh (${fmtD(date)}).`;
    }
    const id = list[list.length - 1].id;
    this.engine.notify(msg, { title: by === 'auto' ? 'Strøm lest av automatisk' : 'Strøm lest av i hybelen', inbox: true, id: `strom_${id}`, event: 'strom' }).catch((e) => log.warn('Varsling feilet:', e.message));
  }

  deleteLastReading(id, admin = false) {
    const list = this.d.readings;
    const last = list[list.length - 1];
    if (!last || last.id !== id) throw new Error('Bare siste avlesning kan slettes');
    if (!admin && last.paid) throw new Error('Avlesningen er markert som betalt');
    if (!admin && Date.now() - new Date(last.at).getTime() > 7 * 86400000) throw new Error('Avlesninger eldre enn en uke kan bare slettes av utleier');
    list.pop();
    this.engine.dismissNotice(`strom_${last.id}`);
    this.engine.store.save();
  }

  setPaid(id, paid) {
    const r = this.d.readings.find((x) => x.id === id);
    if (!r) throw new Error('Finner ikke avlesningen');
    r.paid = Boolean(paid);
    if (r.paid) this.engine.dismissNotice(`strom_${r.id}`);
    this.engine.store.save();
  }

  // Perioder mellom avlesninger, nyeste først.
  periods() {
    const list = this.d.readings;
    const out = [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const kwh = Math.round((b.value - a.value) * 10) / 10;
      const days = Math.max(1, Math.round((new Date(b.date) - new Date(a.date)) / 86400000));
      out.push({ id: b.id, from: a.date, to: b.date, start: a.value, end: b.value, kwh, days, per_day: Math.round((kwh / days) * 10) / 10, price: b.price, amount: b.price != null ? Math.round(kwh * b.price * 100) / 100 : null, paid: b.paid, by: b.by || 'tenant' });
    }
    return out.reverse();
  }

  electricityView() {
    const list = this.d.readings;
    const last = list[list.length - 1] || null;
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const remind = now.getDate() >= 26 && (!last || !last.date.startsWith(thisMonth) || now.getDate() - Number(last.date.slice(8)) > 20);
    const periods = this.periods();
    return {
      price: this.d.electricity.price_per_kwh,
      note: this.d.electricity.note,
      last: last ? { id: last.id, date: last.date, value: last.value, by: last.by || 'tenant', deletable: !last.by && !last.paid && Date.now() - new Date(last.at).getTime() < 7 * 86400000 } : null,
      periods,
      unpaid: Math.round(periods.filter((p) => !p.paid && p.amount != null).reduce((s, p) => s + p.amount, 0) * 100) / 100,
      remind
    };
  }

  tenantView() {
    const i = this.d.info;
    return {
      info: { wifi_ssid: i.wifi_ssid, wifi_password: i.wifi_password, contact_name: i.contact_name, contact_phone: i.contact_phone, contact_email: i.contact_email, garbage: i.garbage, rules: i.rules, emergency: i.emergency, other: i.other, safety: this.safetyView() },
      reports: this.d.reports.map((r) => ({ id: r.id, created: r.created, origin: r.origin || 'tenant', category: r.category, text: r.text, urgent: r.urgent, status: r.status, updates: r.updates, unread: r.tenant_unread, photos: r.photos || [] })),
      report_categories: REPORT_CATEGORIES,
      electricity: this.electricityView(),
      checklists: this.checklists.view(),
      lease: this.lease.view(),
      push: { key: this.vapid?.publicKey || null, devices: this.d.push_subs.length }
    };
  }

  adminView() {
    return {
      info: this.d.info,
      reports: this.d.reports,
      electricity: { ...this.electricityView(), readings: this.d.readings },
      checklists: this.checklists.view(),
      lease: { ...this.lease.view(), settings: this.d.lease },
      checklist_template: templateToText(this.d.checklist_template?.length ? this.d.checklist_template : DEFAULT_TEMPLATE),
      push_devices: this.d.push_subs.map((x) => ({ device: x.device, created: x.created }))
    };
  }

  saveTemplate(body, errors) {
    if (body.checklist_template === undefined) return;
    const t = parseTemplate(body.checklist_template);
    if (!t.length) errors.push('Sjekklisten må ha minst ett rom, f.eks. «Bad: Gulv, Dusj»');
    else this.d.checklist_template = t;
  }

  async handleTenant(cmd, ctx) {
    if (await this.checklists.handleTenant(cmd, ctx)) return true;
    switch (cmd.type) {
      case 'push_subscribe': this.pushSubscribe(cmd, ctx); return true;
      case 'push_unsubscribe': this.pushUnsubscribe(cmd); return true;
      case 'push_test': {
        const n = await this.pushTenant({ title: 'Varsler er på 👍', body: 'Slik ser det ut når utleier sender deg en melding.', tag: 'test' }, String(cmd.endpoint || ''));
        if (!n) throw new Error('Testvarselet kom ikke fram. Prøv å slå varsler av og på igjen.');
        return true;
      }
      case 'report_create': this.createReport(cmd); return true;
      case 'report_reply': this.tenantReply(cmd); return true;
      case 'report_seen': this.markSeen(); return true;
      case 'reading_add': this.addReading(cmd); return true;
      case 'reading_delete': this.deleteLastReading(cmd.id); return true;
      default: return false;
    }
  }
}
