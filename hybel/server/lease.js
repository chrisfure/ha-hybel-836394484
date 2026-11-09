// Leieforholdet: husleie, strøm på etterskudd, betalinger, kontraktsdatoer og påminnelser.
import { log } from './log.js';
import { PdfDoc, PAGE, wrap, textWidth } from './pdf.js';

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
const kr = (n) => `${n.toLocaleString('nb-NO', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;

export function defaultLease() {
  return { rent: null, due_day: 1, start: '', end: '', notice_months: 3, deposit: null, deposit_note: '', account: '', includes: '', note: '', remind_days: 3, meter_sensor: '', tenant_name: '', landlord_name: '', address: '' };
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
    const rent = num(b.rent, 0, 200000, 'Husleien', 0);
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
    for (const [k, max] of [['deposit_note', 200], ['account', 40], ['includes', 600], ['note', 1500], ['tenant_name', 80], ['landlord_name', 80], ['address', 160]]) if (b[k] !== undefined) l[k] = str(b[k], max);
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
    // Første husleie forfaller ved innflytting hvis det er etter vanlig forfallsdag den måneden.
    const rows = months.map((m) => {
      let due = dueDate(m, l.due_day);
      if (l.start && m === monthKey(l.start) && l.start > due) due = l.start;
      return { month: m, due, rent: null, electricity: [] };
    });
    for (const p of periods) {
      const row = rows.find((r) => r.due > p.to) || rows[rows.length - 1];
      if (row.due < p.to && !(l.end && p.to >= l.end)) continue; // avlest etter siste forfall – kommer med neste måned
      row.electricity.push(p);
    }
    return rows.map((r) => {
      const rec = this.pay[r.month] || {};
      const inLease = !l.start || r.month >= monthKey(l.start);
      r.rent = null;
      r.rent_note = null;
      if (rec.paid) { r.rent = rec.rent ?? null; r.rent_note = rec.rent_note || null; }
      else if (inLease && l.rent) {
        // Avregning for delvis måned ved innflytting eller utflytting.
        const dim = daysIn(r.month);
        const from = l.start && monthKey(l.start) === r.month ? Number(l.start.slice(8)) : 1;
        const to = l.end && monthKey(l.end) === r.month ? Number(l.end.slice(8)) : dim;
        const days = Math.max(0, to - from + 1);
        if (days < dim) {
          r.rent = Math.round((l.rent * days) / dim);
          r.rent_note = `${from}.–${to}. ${MONTHS[Number(r.month.slice(5)) - 1].slice(0, 3)}: ${days} av ${dim} dager`;
        } else r.rent = Math.round(l.rent);
      }
      const el = r.electricity.reduce((s, p) => s + (p.amount || 0), 0);
      r.total = Math.round(((r.rent || 0) + el) * 100) / 100;
      r.paid = Boolean(rec.paid);
      r.paid_at = rec.at || null;
      r.status = r.paid ? 'paid' : r.due < today ? 'overdue' : daysBetween(today, r.due) <= 10 ? 'soon' : 'upcoming';
      r.label = monthName(r.month);
      return r;
    }).filter((r) => (r.total > 0 || r.paid) && !this.pay[r.month]?.void);
  }

  // Slett (annuller) en faktura. Kan gjenopprettes. Strømmen i måneden blir da ikke fakturert.
  setVoid(month, on) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Ugyldig måned');
    if (on) {
      if (this.pay[month]?.paid) throw new Error('Fakturaen er markert som betalt – fjern betalingen først');
      this.pay[month] = { void: true, at: new Date().toISOString() };
      this.x.engine.dismissNotice(`betaling_${month}`);
    } else if (this.pay[month]?.void) delete this.pay[month];
    this.x.save();
  }

  deletedMonths() {
    return Object.entries(this.pay).filter(([, v]) => v.void).map(([m, v]) => ({ month: m, label: monthName(m), at: v.at })).sort((a, b) => b.month.localeCompare(a.month));
  }

  setPaid(month, paid) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Ugyldig måned');
    const row = this.ledger().find((r) => r.month === month);
    if (!row) throw new Error('Fant ikke måneden');
    if (paid) this.pay[month] = { paid: true, at: new Date().toISOString(), rent: row.rent, rent_note: row.rent_note, total: row.total };
    else delete this.pay[month];
    for (const p of row.electricity) {
      const rd = this.d.readings.find((x) => x.id === p.id);
      if (rd) rd.paid = Boolean(paid);
      if (paid) this.x.engine.dismissNotice(`strom_${p.id}`);
    }
    this.x.save();
  }

  invoiceNo(month) {
    return `H-${month.replace('-', '')}`;
  }

  // Faktura for én måned: husleie (evt. avregnet) + strøm på etterskudd.
  invoicePdf(month) {
    const row = this.ledger().find((r) => r.month === month);
    if (!row) throw new Error('Fant ikke måneden');
    const l = this.l;
    const info = this.d.info || {};
    const doc = new PdfDoc();
    const { W, M } = PAGE;
    const CW = W - 2 * M;
    const GRAY = '0.42 0.38 0.35';
    const d = (iso) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
    const kr2 = (n) => n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const right = (t, x, y, size = 10, bold = false, color = null) => doc.text(t, x - textWidth(t, size, bold), y, size, bold, color);

    // Topp
    doc.text('Faktura', M, doc.y - 26, 28, true);
    right(this.invoiceNo(month), W - M, doc.y - 14, 11, true);
    right(`Fakturadato ${d(new Date(Math.min(Date.now(), new Date(row.due).getTime() - 7 * 86400000)).toISOString())}`, W - M, doc.y - 28, 9.5, false, GRAY);
    doc.y -= 50;

    // Parter
    const colW = CW / 2 - 10;
    const block = (x, title, lines) => {
      doc.text(title, x, doc.y - 10, 8.5, true, GRAY);
      lines.filter(Boolean).forEach((t, i) => doc.text(t, x, doc.y - 24 - i * 13, 10, i === 0));
    };
    const landlord = l.landlord_name || info.contact_name || 'Utleier';
    block(M, 'FRA', [landlord, info.contact_email, info.contact_phone]);
    block(M + colW + 20, 'TIL', [l.tenant_name || 'Leietaker', l.address]);
    doc.y -= 80;

    // Nøkkeltall
    doc.rect(M, doc.y - 46, CW, 46, '0.96 0.94 0.91');
    const cells = [['Forfallsdato', d(row.due)], ['Kontonummer', l.account || '–'], ['Merk betalingen', this.invoiceNo(month)], ['Å betale', `${kr2(row.total)} kr`]];
    cells.forEach(([k, v], i) => {
      const x = M + 12 + i * (CW / 4);
      doc.text(k, x, doc.y - 16, 8.5, false, GRAY);
      doc.text(v, x, doc.y - 33, i === 3 ? 12 : 10.5, true);
    });
    doc.y -= 66;

    // Linjer
    doc.text('Beskrivelse', M, doc.y - 10, 9, true, GRAY);
    right('Beløp', W - M, doc.y - 10, 9, true, GRAY);
    doc.y -= 16;
    doc.line(M, doc.y, W - M, doc.y, 0.75, 0.8);
    const line = (title, sub, amount) => {
      const subs = sub ? wrap(sub, CW - 120, 9) : [];
      const h = 16 + subs.length * 12 + 8;
      doc.text(title, M, doc.y - 15, 10.5);
      subs.forEach((t, i) => doc.text(t, M, doc.y - 28 - i * 12, 9, false, GRAY));
      right(`${kr2(amount)} kr`, W - M, doc.y - 15, 10.5);
      doc.y -= h;
      doc.line(M, doc.y, W - M, doc.y, 0.9);
    };
    if (row.rent) line(`Husleie ${monthName(month)}`, row.rent_note ? `Avregnet ${row.rent_note} (${kr2(this.l.rent)} kr per måned)` : 'Forskuddsvis', row.rent);
    for (const p of row.electricity) {
      line(`Strøm ${new Date(p.from).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} – ${new Date(p.to).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        `Målerstand ${p.start.toLocaleString('nb-NO')} → ${p.end.toLocaleString('nb-NO')} = ${p.kwh.toLocaleString('nb-NO')} kWh × ${p.price != null ? kr2(p.price) : '–'} kr/kWh`, p.amount || 0);
    }
    doc.y -= 8;
    doc.text('Totalt å betale', M + CW / 2, doc.y - 14, 12, true);
    right(`${kr2(row.total)} kr`, W - M, doc.y - 14, 13, true);
    doc.y -= 34;

    if (row.paid) {
      doc.rect(M, doc.y - 30, CW, 30, '0.89 0.93 0.89');
      doc.text(`Betalt${row.paid_at ? ` – registrert ${d(row.paid_at)}` : ''}`, M + 12, doc.y - 19, 11, true, '0.18 0.37 0.25');
      doc.y -= 44;
    }
    const notes = [
      l.account ? `Betal til kontonummer ${l.account} innen ${d(row.due)}, og merk betalingen med ${this.invoiceNo(month)}.` : `Forfall ${d(row.due)}.`,
      row.electricity.length ? 'Strøm faktureres på etterskudd etter avlesning av måleren i hybelen.' : '',
      l.includes ? `Inkludert i leien: ${l.includes}` : ''
    ].filter(Boolean).join(' ');
    doc.para(notes, M, CW, 9.5, false, 1.4, GRAY);
    return doc.build({ footer: `Faktura ${this.invoiceNo(month)}${l.address ? ` · ${l.address}` : ''}` });
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
      deleted: this.deletedMonths(),
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
