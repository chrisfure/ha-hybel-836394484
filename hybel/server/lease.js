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
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthNameEn = (m) => (String(m).endsWith('-S') ? 'the final settlement' : `${MONTHS_EN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`);
const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
export const monthName = (m) => (String(m).endsWith('-S') ? 'sluttoppgjør' : `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`);
const MONTH_RX = /^\d{4}-\d{2}(-S)?$/;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
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

  // Husleie for én måned, avregnet per dag ved innflytting/utflytting midt i måneden.
  rentFor(m) {
    const l = this.l;
    if (!l.rent || (l.start && m < monthKey(l.start)) || (l.end && m > monthKey(l.end))) return { rent: 0, note: null };
    const dim = daysIn(m);
    const from = l.start && monthKey(l.start) === m ? Number(l.start.slice(8)) : 1;
    const to = l.end && monthKey(l.end) === m ? Number(l.end.slice(8)) : dim;
    const days = Math.max(0, to - from + 1);
    if (days >= dim) return { rent: Math.round(l.rent), note: null };
    return { rent: Math.round((l.rent * days) / dim), note: `${from}.–${to}. ${MONTHS[Number(m.slice(5)) - 1].slice(0, 3)}: ${days} av ${dim} dager` };
  }

  // Betalingsplan: husleie for måned M forfaller på forfallsdagen i måned M og dekker hele M, strøm på etterskudd med første forfall etter avlesningen.
  // Ved avsluttet leieforhold kommer et sluttoppgjør (måned «YYYY-MM-S») 14 dager etter siste dag:
  // strøm fram til utflytting og tilbakebetaling av husleie som er betalt for dager etter utflytting.
  ledger() {
    const l = this.l;
    const periods = [...this.x.periods()].reverse(); // eldste først
    const today = localDate();
    const thisMonth = monthKey(today);
    let first = l.start ? monthKey(l.start) : periods.length ? monthKey(periods[0].to) : null;
    if (!l.rent && !periods.length) return [];
    if (!first) first = thisMonth;
    const endM = l.end ? monthKey(l.end) : null;
    let last = addMonths(thisMonth, 1);
    if (endM && endM < last) last = endM;
    const months = [];
    for (let m = first, i = 0; m <= last && i < 240; m = addMonths(m, 1), i++) months.push(m);
    if (!months.length) return [];
    // Første husleie forfaller ved innflytting hvis det er etter vanlig forfallsdag den måneden.
    const rows = months.map((m) => {
      let due = dueDate(m, l.due_day);
      if (l.start && m === monthKey(l.start) && l.start > due) due = l.start;
      return { month: m, due, rent: null, electricity: [], credits: [] };
    });
    const final = endM ? { month: `${endM}-S`, due: addDays(l.end, 14), rent: null, electricity: [], credits: [], final: true } : null;
    const all = final ? [...rows, final] : rows;
    const isPaid = (m) => Boolean(this.pay[m]?.paid);

    // Strøm: betalte perioder blir på fakturaen de ble betalt med; ubetalte går til første ubetalte faktura med forfall etter avlesningen.
    const paidIn = new Map();
    for (const [m, rec] of Object.entries(this.pay)) if (rec.paid && Array.isArray(rec.periods)) for (const id of rec.periods) paidIn.set(id, m);
    for (const p of periods) {
      const pm = paidIn.get(p.id);
      const known = pm && all.find((r) => r.month === pm);
      if (known) { known.electricity.push(p); continue; }
      if (p.paid) { // betalt før perioder ble lagret på betalingen
        const r = rows.find((x) => x.due > p.to) || rows[rows.length - 1];
        r.electricity.push(p);
        continue;
      }
      let row = rows.find((r) => r.due > p.to && !isPaid(r.month) && !(final && p.to >= l.end));
      if (!row && final && !isPaid(final.month)) row = final;
      if (!row) continue; // avlest etter siste forfall – kommer med neste måned
      row.electricity.push(p);
    }

    // Husleie som allerede er betalt for dager etter utflytting, trekkes fra i sluttoppgjøret.
    if (final) {
      for (const [m, rec] of Object.entries(this.pay).sort()) {
        if (!rec.paid || !/^\d{4}-\d{2}$/.test(m) || m < endM || rec.rent == null) continue;
        const due = this.rentFor(m).rent;
        const back = Math.round(rec.rent - due);
        if (back > 0) final.credits.push({ month: m, paid: rec.rent, due, amount: -back, note: m === endM ? this.rentFor(m).note : null });
      }
    }

    return all.map((r) => {
      const rec = this.pay[r.month] || {};
      r.rent = null;
      r.rent_note = null;
      if (rec.paid && !r.final) { r.rent = rec.rent ?? null; r.rent_note = rec.rent_note || null; }
      else if (!r.final) { const x = this.rentFor(r.month); r.rent = x.rent || null; r.rent_note = x.note; }
      if (r.final && rec.paid) r.credits = rec.credits || [];
      const el = r.electricity.reduce((s, p) => s + (p.amount || 0), 0);
      const cr = r.credits.reduce((s, c) => s + c.amount, 0);
      r.total = rec.paid && rec.total != null && r.final ? rec.total : Math.round(((r.rent || 0) + el + cr) * 100) / 100;
      r.paid = Boolean(rec.paid);
      r.paid_at = rec.paid ? rec.at || null : null;
      r.claimed_at = !rec.paid && rec.claimed_at ? rec.claimed_at : null;
      r.refund = r.total < 0;
      r.status = r.paid ? 'paid' : r.refund ? 'refund' : r.claimed_at ? 'claimed' : r.due < today ? 'overdue' : daysBetween(today, r.due) <= 10 ? 'soon' : 'upcoming';
      r.label = monthName(r.month);
      return r;
    }).filter((r) => (r.total !== 0 || r.paid) && !this.pay[r.month]?.void);
  }

  // Slett (annuller) en faktura. Kan gjenopprettes. Strømmen i måneden blir da ikke fakturert.
  setVoid(month, on) {
    if (!MONTH_RX.test(String(month))) throw new Error('Ugyldig måned');
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

  // Leietaker melder at en faktura er betalt. Utleier bekrefter (setPaid) eller avviser.
  claimPaid(month, on = true) {
    if (!MONTH_RX.test(String(month))) throw new Error('Ugyldig måned');
    const row = this.ledger().find((r) => r.month === month);
    if (!row) throw new Error('Fant ikke fakturaen');
    if (row.paid) throw new Error('Fakturaen er allerede registrert som betalt');
    if (row.total <= 0) throw new Error('Her er det utleier som skal betale tilbake');
    if (!on) {
      if (row.claimed_at) { delete this.pay[month]; this.x.engine.dismissNotice(`betalt_${month}`); this.x.save(); }
      return;
    }
    if (row.claimed_at) return;
    if (row.due > addDays(localDate(), 45)) throw new Error('Denne fakturaen kan ikke betales ennå');
    this.pay[month] = { claimed_at: new Date().toISOString() };
    this.x.save();
    this.x.engine.notify(`Leietaker har meldt at fakturaen for ${monthName(month)} (${kr(row.total)}) er betalt. Sjekk kontoen og bekreft under Økonomi i Hybel.`,
      { title: 'Husleie meldt betalt', inbox: true, id: `betalt_${month}`, event: 'betalt' }).catch(() => {});
  }

  // Utleier finner ikke betalingen: fjern meldingen og si fra til leietaker.
  rejectClaim(month) {
    if (!this.pay[month]?.claimed_at || this.pay[month]?.paid) return;
    delete this.pay[month];
    this.x.engine.dismissNotice(`betalt_${month}`);
    this.x.save();
    this.x.pushTenant({ title: 'Betalingen er ikke kommet fram ennå', body: `Utleier finner ikke betalingen for ${monthName(month)} ennå. Sjekk at den er sendt, eller send en melding.`, tag: `betaling-${month}`, url: '/?vis=strom', en: { title: "The payment hasn't arrived yet", body: `The landlord can't find the payment for ${monthNameEn(month)} yet. Check that it has been sent, or send a message.` } });
  }

  setPaid(month, paid) {
    if (!MONTH_RX.test(String(month))) throw new Error('Ugyldig måned');
    const row = this.ledger().find((r) => r.month === month);
    if (!row) throw new Error('Fant ikke måneden');
    this.x.engine.dismissNotice(`betalt_${month}`);
    if (paid && row.claimed_at) this.x.pushTenant({ title: 'Betalingen er mottatt ✓', body: `Utleier har bekreftet betalingen for ${monthName(month)}.`, tag: `betaling-${month}`, url: '/?vis=strom', en: { title: 'Payment received ✓', body: `The landlord has confirmed the payment for ${monthNameEn(month)}.` } });
    if (paid) this.pay[month] = { paid: true, at: new Date().toISOString(), rent: row.rent, rent_note: row.rent_note, total: row.total, periods: row.electricity.map((p) => p.id), ...(row.final ? { credits: row.credits } : {}) };
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
    doc.text(row.final ? (row.refund ? 'Sluttoppgjør – til gode' : 'Sluttoppgjør') : 'Faktura', M, doc.y - 26, 28, true);
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
    const cells = row.refund
      ? [['Utflytting', d(l.end)], ['Tilbakebetales innen', d(row.due)], ['Referanse', this.invoiceNo(month)], ['Til gode leietaker', `${kr2(-row.total)} kr`]]
      : [['Forfallsdato', d(row.due)], ['Kontonummer', l.account || '–'], ['Merk betalingen', this.invoiceNo(month)], ['Å betale', `${kr2(row.total)} kr`]];
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
    if (row.rent) line(`Husleie ${monthName(month)}`, row.rent_note ? `Avregnet ${row.rent_note} (${kr2(this.l.rent)} kr per måned)` : `Gjelder 1.–${daysIn(month)}. ${MONTHS[Number(month.slice(5, 7)) - 1]}`, row.rent);
    for (const p of row.electricity) {
      line(`Strøm ${new Date(p.from).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} – ${new Date(p.to).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        `Målerstand ${p.start.toLocaleString('nb-NO')} → ${p.end.toLocaleString('nb-NO')} = ${p.kwh.toLocaleString('nb-NO')} kWh × ${p.price != null ? kr2(p.price) : '–'} kr/kWh`, p.amount || 0);
    }
    for (const c of row.credits || []) {
      line(`Tilbake: husleie ${monthName(c.month)}`, c.note ? `Betalt ${kr2(c.paid)} kr – avregnet til utflytting ${c.note} = ${kr2(c.due)} kr` : `Betalt ${kr2(c.paid)} kr for måned etter utflytting`, c.amount);
    }
    doc.y -= 8;
    doc.text(row.refund ? 'Til gode leietaker' : 'Totalt å betale', M + CW / 2, doc.y - 14, 12, true);
    right(`${kr2(Math.abs(row.total))} kr`, W - M, doc.y - 14, 13, true);
    doc.y -= 34;

    if (row.paid) {
      doc.rect(M, doc.y - 30, CW, 30, '0.89 0.93 0.89');
      doc.text(`${row.refund ? 'Tilbakebetalt' : 'Betalt'}${row.paid_at ? ` – registrert ${d(row.paid_at)}` : ''}`, M + 12, doc.y - 19, 11, true, '0.18 0.37 0.25');
      doc.y -= 44;
    }
    const notes = [
      row.final ? `Sluttoppgjør for leieforholdet som ble avsluttet ${d(l.end)}. Husleie er avregnet per dag fram til utflytting.` : '',
      row.refund ? `Utleier betaler tilbake ${kr2(-row.total)} kr til leietakers konto innen ${d(row.due)}.`
        : l.account ? `Betal til kontonummer ${l.account} innen ${d(row.due)}, og merk betalingen med ${this.invoiceNo(month)}.` : `Forfall ${d(row.due)}.`,
      row.final && l.deposit ? `Depositum (${kr2(l.deposit)} kr) er ikke med her og frigis etter avtale når utflyttingen er godkjent.` : '',
      row.electricity.length ? 'Strøm faktureres på etterskudd etter avlesning av måleren i hybelen.' : '',
      l.includes ? `Inkludert i leien: ${l.includes}` : ''
    ].filter(Boolean).join(' ');
    doc.para(notes, M, CW, 9.5, false, 1.4, GRAY);
    return doc.build({ footer: `Faktura ${this.invoiceNo(month)}${l.address ? ` · ${l.address}` : ''}` });
  }

  // Alle fakturerte måneder for et år – nåværende leietaker og arkiverte leieforhold.
  yearRows(year) {
    const y = String(year);
    const rows = [];
    for (const a of this.d.archive || []) {
      const name = a.lease?.tenant_name || 'Tidligere leietaker';
      for (const [m, rec] of Object.entries(a.payments || {})) {
        if (!m.startsWith(y) || !rec.paid) continue;
        const rent = rec.rent || 0;
        rows.push({ month: m, tenant: name, rent, electricity: Math.round(((rec.total || 0) - rent) * 100) / 100, kwh: null, total: rec.total || 0, paid: true, paid_at: rec.at || null });
      }
    }
    const cur = this.l.tenant_name || 'Leietaker';
    for (const r of this.ledger()) {
      if (!r.month.startsWith(y)) continue;
      const el = r.electricity.reduce((s, p) => s + (p.amount || 0), 0);
      rows.push({ month: r.month, tenant: cur, rent: (r.rent || 0) + (r.credits || []).reduce((a, c) => a + c.amount, 0), electricity: Math.round(el * 100) / 100, kwh: r.electricity.reduce((s, p) => s + (p.kwh || 0), 0) || null, total: r.total, paid: r.paid, paid_at: r.paid_at, claimed: Boolean(r.claimed_at) });
    }
    return rows.sort((a, b) => a.month.localeCompare(b.month));
  }

  years() {
    const set = new Set([localDate().slice(0, 4)]);
    for (const a of this.d.archive || []) for (const m of Object.keys(a.payments || {})) set.add(m.slice(0, 4));
    for (const r of this.ledger()) set.add(r.month.slice(0, 4));
    return [...set].sort().reverse();
  }

  // Årsoversikt (PDF) – grunnlag for skattemeldingen.
  yearPdf(year) {
    if (!/^\d{4}$/.test(String(year))) throw new Error('Ugyldig år');
    const rows = this.yearRows(year);
    const doc = new PdfDoc();
    const { W, M } = PAGE;
    const CW = W - 2 * M;
    const GRAY = '0.42 0.38 0.35';
    const kr2 = (n) => n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const right = (t, x, y, size = 10, bold = false, color = null) => doc.text(t, x - textWidth(t, size, bold), y, size, bold, color);
    const d = (iso) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
    const sum = (f, list = rows) => Math.round(list.reduce((s, r) => s + f(r), 0) * 100) / 100;
    const l = this.l;

    doc.text(`Årsoversikt ${year}`, M, doc.y - 26, 26, true);
    doc.text(['Utleie av hybel', l.address].filter(Boolean).join(' · '), M, doc.y - 44, 10.5, false, GRAY);
    doc.text(`Laget ${d(new Date().toISOString())}`, M, doc.y - 58, 9, false, GRAY);
    doc.y -= 80;

    const paid = rows.filter((r) => r.paid);
    const cells = [['Husleie betalt', sum((r) => r.rent, paid)], ['Strøm betalt', sum((r) => r.electricity, paid)], ['Sum betalt', sum((r) => r.total, paid)], ['Ikke betalt', sum((r) => r.total, rows.filter((r) => !r.paid))]];
    doc.rect(M, doc.y - 46, CW, 46, '0.96 0.94 0.91');
    cells.forEach(([k, v], i) => {
      const x = M + 12 + i * (CW / 4);
      doc.text(k, x, doc.y - 16, 8.5, false, GRAY);
      doc.text(`${kr2(v)} kr`, x, doc.y - 33, i === 2 ? 12 : 10.5, true);
    });
    doc.y -= 68;

    const cols = [M, M + 120, M + 230, M + 320, M + 410];
    const head = () => {
      doc.text('Måned', cols[0], doc.y - 10, 9, true, GRAY);
      right('Husleie', cols[2] - 10, doc.y - 10, 9, true, GRAY);
      right('Strøm', cols[3] - 10, doc.y - 10, 9, true, GRAY);
      right('Sum', cols[4] - 10, doc.y - 10, 9, true, GRAY);
      doc.text('Betalt', cols[4] + 6, doc.y - 10, 9, true, GRAY);
      doc.y -= 16;
      doc.line(M, doc.y, W - M, doc.y, 0.75, 0.8);
    };
    if (!rows.length) doc.para('Ingen fakturaer dette året.', M, CW, 10.5);
    else head();
    const multi = new Set(rows.map((r) => r.tenant)).size > 1;
    for (const r of rows) {
      doc.ensure(30);
      if (doc.y > PAGE.H - M - 5) head();
      const name = monthName(r.month);
      doc.text(name.charAt(0).toUpperCase() + name.slice(1), cols[0], doc.y - 14, 10);
      if (multi) doc.text(r.tenant, cols[0], doc.y - 25, 8, false, GRAY);
      right(r.rent ? kr2(r.rent) : '–', cols[2] - 10, doc.y - 14, 10);
      right(r.electricity ? kr2(r.electricity) : '–', cols[3] - 10, doc.y - 14, 10);
      if (r.kwh) right(`${Math.round(r.kwh).toLocaleString('nb-NO')} kWh`, cols[3] - 10, doc.y - 25, 8, false, GRAY);
      right(kr2(r.total), cols[4] - 10, doc.y - 14, 10, true);
      doc.text(r.paid ? (r.paid_at ? d(r.paid_at) : 'Ja') : r.claimed ? 'Meldt betalt' : 'Ikke betalt', cols[4] + 6, doc.y - 14, 9.5, !r.paid, r.paid ? null : '0.6 0.2 0.1');
      doc.y -= multi || r.kwh ? 30 : 22;
      doc.line(M, doc.y, W - M, doc.y, 0.9);
    }
    if (rows.length) {
      doc.y -= 6;
      doc.text('Totalt fakturert', cols[0], doc.y - 14, 10.5, true);
      right(kr2(sum((r) => r.rent)), cols[2] - 10, doc.y - 14, 10.5, true);
      right(kr2(sum((r) => r.electricity)), cols[3] - 10, doc.y - 14, 10.5, true);
      right(kr2(sum((r) => r.total)), cols[4] - 10, doc.y - 14, 10.5, true);
      doc.y -= 34;
    }
    doc.ensure(60);
    doc.para('Oversikten viser fakturaer etter måneden de gjelder. Strøm er viderefakturert etter målt forbruk. Betalingsdato er datoen betalingen ble registrert i Hybel. Les mer om skatteregler for utleie av egen bolig på skatteetaten.no.', M, CW, 9, false, 1.4, GRAY);
    return doc.build({ footer: `Årsoversikt ${year}${l.address ? ` · ${l.address}` : ''}` });
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
    const next = open.find((r) => r.due >= today && !r.refund) || null;
    return {
      contract: this.contract(),
      ledger: [...ledger].reverse(),
      deleted: this.deletedMonths(),
      refund: open.find((r) => r.refund) || null,
      years: this.years(),
      next,
      overdue: open.filter((r) => r.due < today && !r.claimed_at && !r.refund).map((r) => ({ month: r.month, label: r.label, total: r.total, due: r.due })),
      claimed: open.filter((r) => r.claimed_at).map((r) => ({ month: r.month, label: r.label, total: r.total, due: r.due, claimed_at: r.claimed_at })),
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
    // Også på siste dag i leieforholdet, så sluttoppgjøret får riktig strøm.
    if (l.meter_sensor && (now.getDate() === daysIn(monthKey(today)) || today === l.end) && now.getHours() === 23 && now.getMinutes() >= 45) {
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
        if (r.paid || r.claimed_at || r.total <= 0) continue;
        const days = daysBetween(today, r.due);
        if (days < 0 || days > l.remind_days) continue;
        const key = `pay-${r.month}`;
        if (flags[key]) continue;
        flags[key] = today;
        ch = true;
        const parts = [r.rent ? `husleie ${kr(r.rent)}` : null, r.electricity.length ? `strøm ${kr(r.electricity.reduce((s, p) => s + (p.amount || 0), 0))}` : null].filter(Boolean).join(' + ');
        this.x.pushTenant({ title: `Betaling ${days === 0 ? 'i dag' : `om ${days} dag${days === 1 ? '' : 'er'}`}: ${kr(r.total)}`, body: `${parts}${l.account ? `. Kontonr. ${l.account}` : ''}`, tag: `betaling-${r.month}`, url: '/?vis=strom', en: { title: `Payment ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}: ${kr(r.total)}`, body: `${parts.replace('husleie', 'rent').replace('strøm', 'electricity')}${l.account ? `. Account ${l.account}` : ''}` } });
      }
    }

    // Kontrakten nærmer seg slutten: varsel 90 og 30 dager før.
    // Ikke ved godkjent oppsigelse – da vet leietaker allerede sluttdatoen.
    if (l.end && now.getHours() >= 10 && !(this.d.terminations || []).some((t) => t.status === 'approved' && t.approved_end === l.end)) {
      const left = daysBetween(today, l.end);
      for (const n of [90, 30]) {
        const key = `end-${l.end}-${n}`;
        if (left <= n && left >= 0 && !flags[key]) {
          flags[key] = today;
          ch = true;
          const when = new Date(l.end).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
          this.x.engine.notify(`Leiekontrakten for hybelen utløper ${when} (om ${left} dager).`, { title: 'Leiekontrakt utløper snart', inbox: true, id: `kontrakt_${n}`, event: 'kontrakt' }).catch(() => {});
          this.x.pushTenant({ title: 'Leiekontrakten utløper snart', body: `Kontrakten løper til ${when}. Ta kontakt med utleier om veien videre.`, tag: 'kontrakt', url: '/?vis=strom', en: { title: 'Your lease ends soon', body: `The contract runs until ${new Date(l.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Contact the landlord about what happens next.` } });
        }
      }
    }
    if (ch) this.x.save();
  }
}
