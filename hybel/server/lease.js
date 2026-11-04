// Leieforholdet: husleie, strøm på etterskudd, betalinger, kontraktsdatoer og påminnelser.
import { log } from './log.js';

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(new Date(v).getTime());
const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => d.slice(0, 7);
const addMonths = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};
const daysIn = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const dueDate = (m, day) => `${m}-${pad(Math.min(day, daysIn(m)))}`;
const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
export const monthName = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const kr = (n) => `${n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;

export function defaultLease() {
  return { rent: null, due_day: 1, start: '', end: '', notice_months: 3, deposit: null, deposit_note: '', account: '', includes: '', note: '', remind_days: 3, meter_sensor: '' };
}

export class Lease {
  constructor(extras) {
    this.x = extras;
  }

  get d() {
    return this.x.d;
  }

  get l() {
    if (!this.d.lease) this.d.lease = defaultLease();
    return this.d.lease;
  }

  get pay() {
    if (!this.d.payments) this.d.payments = {};
    return this.d.payments;
  }

  save(body, errors) {
    const b = body.lease;
    if (!b) return;
    const l = this.l;
    const num = (v, min, max, label, dec = 2) => {
      if (v === null || v === '' || v === undefined) return null;
      const n = Math.round(Number(String(v).replace(/\s/g, '').replace(',', '.')) * 10 ** dec) / 10 ** dec;
      if (!(n >= min && n <= max)) { errors.push(`${label} må være mellom ${min} og ${max}`); return undefined; }
      return n;
    };
    const rent = num(b.rent, 0, 200000, 'Husleien');
    if (rent !== undefined) l.rent = rent;
    const dep = num(b.deposit, 0, 1000000, 'Depositumet');
    if (dep !== undefined) l.deposit = dep;
    const due = num(b.due_day, 1, 28, 'Forfallsdagen', 0);
    if (due !== undefined && due !== null) l.due_day = due;
    const notice = num(b.notice_months, 0, 12, 'Oppsigelsestiden', 0);
    if (notice !== undefined) l.notice_months = notice ?? 0;
    const remind = num(b.remind_days, 0, 14, 'Påminnelsen', 0);
    if (remind !== undefined) l.remind_days = remind ?? 0;
    for (const k of ['start', 'end']) {
      if (b[k] === undefined) continue;
      if (b[k] === '' || b[k] === null) l[k] = '';
      else if (isDate(b[k])) l[k] = b[k];
      else errors.push('Ugyldig dato i leieforholdet');
    }
    if (l.start && l.end && l.end <= l.start) errors.push('Sluttdato må være etter startdato');
    for (const [k, max] of [['deposit_note', 200], ['account', 40], ['includes', 600], ['note', 1500]]) if (b[k] !== undefined) l[k] = str(b[k], max);
    if (b.meter_sensor !== undefined) {
      const id = String(b.meter_sensor || '');
      if (!id || /^sensor\.[a-z0-9_]+$/.test(id)) l.meter_sensor = id;
    }
  }

  // Betalingsplan: husleie forskuddsvis per måned, strøm på etterskudd med første forfall etter avlesningen.
  ledger() {
    const l = this.l;
    const periods = [...this.x.periods()].reverse(); // eldste først
    const today = localDate();
    const thisMonth = monthKey(today);
    let first = l.start ? monthKey(l.start) : periods.length ? monthKey(periods[0].to) : null;
    if (!l.rent && !periods.length) return [];
    if (!first) first = thisMonth;
    let last = addMonths(thisMonth, 1);
    if (l.end && monthKey(l.end) < last) last = monthKey(l.end);
    const months = [];
    for (let m = first, i = 0; m <= last && i < 240; m = addMonths(m, 1), i++) months.push(m);
    if (!months.length) return [];
    const rows = months.map((m) => ({ month: m, due: dueDate(m, l.due_day), rent: null, electricity: [] }));
    for (const p of periods) {
      const row = rows.find((r) => r.due > p.to) || rows[rows.length - 1];
      if (row.due < p.to && !(l.end && p.to >= l.end)) continue; // avlest etter siste forfall – kommer med neste måned
      row.electricity.push(p);
    }
    return rows.map((r) => {
      const rec = this.pay[r.month] || {};
      const inLease = !l.start || r.month >= monthKey(l.start);
      r.rent = rec.paid ? rec.rent ?? null : inLease ? l.rent : null;
      const el = r.electricity.reduce((s, p) => s + (p.amount || 0), 0);
      r.total = Math.round(((r.rent || 0) + el) * 100) / 100;
      r.paid = Boolean(rec.paid);
      r.paid_at = rec.at || null;
      r.status = r.paid ? 'paid' : r.due < today ? 'overdue' : daysBetween(today, r.due) <= 10 ? 'soon' : 'upcoming';
      r.label = monthName(r.month);
      return r;
    }).filter((r) => r.total > 0 || r.paid);
  }

  setPaid(month, paid) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Ugyldig måned');
    const row = this.ledger().find((r) => r.month === month);
    if (!row) throw new Error('Fant ikke måneden');
    if (paid) this.pay[month] = { paid: true, at: new Date().toISOString(), rent: row.rent, total: row.total };
    else delete this.pay[month];
    for (const p of row.electricity) {
      const rd = this.d.readings.find((x) => x.id === p.id);
      if (rd) rd.paid = Boolean(paid);
      if (paid) this.x.engine.dismissNotice(`strom_${p.id}`);
    }
    this.x.save();
  }

  contract() {
    const l = this.l;
    const today = localDate();
    const out = { start: l.start || null, end: l.end || null, notice_months: l.notice_months, deposit: l.deposit, deposit_note: l.deposit_note, includes: l.includes, note: l.note, rent: l.rent, due_day: l.due_day, account: l.account, auto_meter: Boolean(l.meter_sensor) };
    if (l.end) {
      out.days_left = daysBetween(today, l.end);
      // Siste dag for oppsigelse for å flytte ved kontraktsslutt (gjelder tidsbestemte avtaler med oppsigelsesadgang).
      if (l.notice_months) {
        const m = addMonths(monthKey(l.end), -l.notice_months);
        out.notice_by = `${m}-${pad(Math.min(Number(l.end.slice(8)), daysIn(m)))}`;
      }
    }
    if (l.start) out.days_in = Math.max(0, daysBetween(l.start, today));
    return out;
  }

  view() {
    const ledger = this.ledger();
    const today = localDate();
    const open = ledger.filter((r) => !r.paid);
    const next = open.find((r) => r.due >= today) || null;
    return {
      contract: this.contract(),
      ledger: [...ledger].reverse(),
      next,
      overdue: open.filter((r) => r.due < today).map((r) => ({ month: r.month, label: r.label, total: r.total, due: r.due })),
      year_total: ledger.filter((r) => r.paid && r.month.startsWith(today.slice(0, 4))).reduce((s, r) => s + r.total, 0)
    };
  }

  // Kalles hvert minutt fra motoren.
  tick() {
    const l = this.l;
    const now = new Date();
    const today = localDate(now);
    const flags = this.d.lease_flags || (this.d.lease_flags = {});
    let ch = false;

    // Automatisk avlesning fra strømmåler i Home Assistant: siste dag i måneden kl. 23:45.
    if (l.meter_sensor && now.getDate() === daysIn(monthKey(today)) && now.getHours() === 23 && now.getMinutes() >= 45) {
      const last = this.d.readings[this.d.readings.length - 1];
      if (!last || last.date !== today) {
        const st = this.x.engine.ha.states.get(l.meter_sensor);
        let v = Number(st?.state);
        const unit = st?.attributes?.unit_of_measurement;
        if (unit === 'Wh') v /= 1000;
        if (unit === 'MWh') v *= 1000;
        if (Number.isFinite(v) && v > 0) {
          try { this.x.addReading({ date: today, value: v }, 'auto'); log.info('Strøm lest av automatisk:', v, 'kWh'); }
          catch (err) { log.warn('Automatisk avlesning feilet:', err.message); }
        } else log.warn('Automatisk avlesning: måleren har ingen gyldig verdi');
      }
    }

    // Påminnelse om betaling noen dager før forfall, kl. 10.
    if (l.remind_days && now.getHours() >= 10) {
      for (const r of this.ledger()) {
        if (r.paid || r.total <= 0) continue;
        const days = daysBetween(today, r.due);
        if (days < 0 || days > l.remind_days) continue;
        const key = `pay-${r.month}`;
        if (flags[key]) continue;
        flags[key] = today;
        ch = true;
        const parts = [r.rent ? `husleie ${kr(r.rent)}` : null, r.electricity.length ? `strøm ${kr(r.electricity.reduce((s, p) => s + (p.amount || 0), 0))}` : null].filter(Boolean).join(' + ');
        this.x.pushTenant({ title: `Betaling ${days === 0 ? 'i dag' : `om ${days} dag${days === 1 ? '' : 'er'}`}: ${kr(r.total)}`, body: `${parts}${l.account ? `. Kontonr. ${l.account}` : ''}`, tag: `betaling-${r.month}`, url: '/?vis=strom' });
      }
    }

    // Kontrakten nærmer seg slutten: varsel 90 og 30 dager før.
    if (l.end && now.getHours() >= 10) {
      const left = daysBetween(today, l.end);
      for (const n of [90, 30]) {
        const key = `end-${l.end}-${n}`;
        if (left <= n && left >= 0 && !flags[key]) {
          flags[key] = today;
          ch = true;
          const when = new Date(l.end).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
          this.x.engine.notify(`Leiekontrakten for hybelen utløper ${when} (om ${left} dager).`, { title: 'Leiekontrakt utløper snart', inbox: true, id: `kontrakt_${n}`, event: 'kontrakt' }).catch(() => {});
          this.x.pushTenant({ title: 'Leiekontrakten utløper snart', body: `Kontrakten løper til ${when}. Ta kontakt med utleier om veien videre.`, tag: 'kontrakt', url: '/?vis=strom' });
        }
      }
    }
    if (ch) this.x.save();
  }
}
