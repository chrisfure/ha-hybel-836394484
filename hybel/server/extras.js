// Info-side, meldinger til utleier og strømavlesning. Alt lagres i /data (aldri i koden).
import { randomBytes } from 'node:crypto';
import { log } from './log.js';

export const REPORT_CATEGORIES = ['Vann og rør', 'Elektrisk', 'Varme og ventilasjon', 'Hvitevarer', 'Dører, vinduer og lås', 'Annet'];
export const REPORT_STATUS = ['new', 'in_progress', 'done'];
const STATUS_LABEL = { new: 'Mottatt', in_progress: 'Under arbeid', done: 'Løst' };
const MAX_OPEN_REPORTS = 20;

const newId = () => randomBytes(5).toString('hex');
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(new Date(v).getTime());

export function defaultExtras() {
  return {
    info: { wifi_ssid: '', wifi_password: '', contact_name: '', contact_phone: '', contact_email: '', garbage: '', rules: '', emergency: '', other: '', safety: [] },
    reports: [],
    readings: [],
    electricity: { price_per_kwh: null, note: '' }
  };
}

export class Extras {
  constructor(engine) {
    this.engine = engine;
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
    const r = { id: newId(), created: new Date().toISOString(), category, text, urgent: Boolean(cmd.urgent), status: 'new', updates: [], tenant_unread: false };
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
    if (r.status === 'done') r.status = 'new';
    this.engine.store.save();
    this.engine.notify(`${r.category} – «${r.text.slice(0, 60)}»\n\nLeietaker svarer: ${text.slice(0, 300)}`, { title: 'Svar fra hybel', inbox: true, id: `melding_${r.id}`, event: 'svar' }).catch(() => {});
  }

  markSeen() {
    let changed = false;
    for (const r of this.d.reports) if (r.tenant_unread) { r.tenant_unread = false; changed = true; }
    if (changed) this.engine.store.save();
  }

  adminUpdateReport(body) {
    const r = this.d.reports.find((x) => x.id === body.id);
    if (!r) throw new Error('Meldingen finnes ikke');
    if (body.delete === true) {
      this.d.reports = this.d.reports.filter((x) => x.id !== r.id);
      this.engine.dismissNotice(`melding_${r.id}`);
      this.engine.store.save();
      return;
    }
    if (body.status && REPORT_STATUS.includes(body.status) && body.status !== r.status) {
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
    this.engine.store.save();
  }

  // ---------- strøm ----------

  addReading(cmd) {
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
    list.push({ id: newId(), date, value, price: this.d.electricity.price_per_kwh, paid: false, at: new Date().toISOString() });
    this.engine.store.save();
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
    this.engine.notify(msg, { title: 'Strøm lest av i hybelen', inbox: true, id: `strom_${id}`, event: 'strom' }).catch((e) => log.warn('Varsling feilet:', e.message));
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
      out.push({ id: b.id, from: a.date, to: b.date, start: a.value, end: b.value, kwh, days, per_day: Math.round((kwh / days) * 10) / 10, price: b.price, amount: b.price != null ? Math.round(kwh * b.price * 100) / 100 : null, paid: b.paid });
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
      last: last ? { id: last.id, date: last.date, value: last.value, deletable: !last.paid && Date.now() - new Date(last.at).getTime() < 7 * 86400000 } : null,
      periods,
      unpaid: Math.round(periods.filter((p) => !p.paid && p.amount != null).reduce((s, p) => s + p.amount, 0) * 100) / 100,
      remind
    };
  }

  tenantView() {
    const i = this.d.info;
    return {
      info: { wifi_ssid: i.wifi_ssid, wifi_password: i.wifi_password, contact_name: i.contact_name, contact_phone: i.contact_phone, contact_email: i.contact_email, garbage: i.garbage, rules: i.rules, emergency: i.emergency, other: i.other, safety: this.safetyView() },
      reports: this.d.reports.map((r) => ({ id: r.id, created: r.created, category: r.category, text: r.text, urgent: r.urgent, status: r.status, updates: r.updates, unread: r.tenant_unread })),
      report_categories: REPORT_CATEGORIES,
      electricity: this.electricityView()
    };
  }

  adminView() {
    return {
      info: this.d.info,
      reports: this.d.reports,
      electricity: { ...this.electricityView(), readings: this.d.readings }
    };
  }

  async handleTenant(cmd) {
    switch (cmd.type) {
      case 'report_create': this.createReport(cmd); return true;
      case 'report_reply': this.tenantReply(cmd); return true;
      case 'report_seen': this.markSeen(); return true;
      case 'reading_add': this.addReading(cmd); return true;
      case 'reading_delete': this.deleteLastReading(cmd.id); return true;
      default: return false;
    }
  }
}
