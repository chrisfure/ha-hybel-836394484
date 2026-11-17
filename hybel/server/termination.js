// Leietaker ber om å avslutte leieforholdet (oppsigelse / søknad om tidligere utflytting).
// Utleier godkjenner (setter sluttdato i leieforholdet) eller avslår med en kommentar.
import { randomBytes } from 'node:crypto';
import { localDate } from './lease.js';

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(new Date(v).getTime());
const pad = (n) => String(n).padStart(2, '0');
const nice = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
const niceEn = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// Siste dag i måneden «n» måneder etter denne (oppsigelsestid regnet fra utgangen av måneden).
function endOfMonthAfter(today, n) {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(y, m - 1 + n + 1, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class Termination {
  constructor(extras) {
    this.x = extras;
  }

  get list() {
    if (!Array.isArray(this.x.d.terminations)) this.x.d.terminations = [];
    return this.x.d.terminations;
  }

  get current() {
    return [...this.list].reverse().find((t) => t.status === 'pending' || t.status === 'approved') || null;
  }

  // Tidligste sluttdato uten særskilt avtale, ut fra kontrakten.
  earliest(today = localDate()) {
    const l = this.x.lease.l;
    const n = Number(l.notice_months) || 0;
    const byNotice = n ? endOfMonthAfter(today, n) : null;
    if (l.end && !this.approved()) return byNotice && byNotice < l.end ? byNotice : l.end; // tidsbestemt: kontraktens slutt
    return byNotice;
  }

  approved() {
    return this.list.find((t) => t.status === 'approved' && t.approved_end === this.x.lease.l.end) || null;
  }

  view(admin = false) {
    const l = this.x.lease.l;
    const last = this.list[this.list.length - 1] || null;
    const pub = (t) => t && ({ id: t.id, created: t.created, requested_end: t.requested_end, reason: admin ? t.reason : t.reason, status: t.status, early: t.early, earliest: t.earliest, decided_at: t.decided_at || null, approved_end: t.approved_end || null, comment: t.comment || '' });
    return {
      notice_months: Number(l.notice_months) || 0,
      fixed_end: l.end && !this.approved() ? l.end : null,
      earliest: this.earliest(),
      latest: pub(last),
      ...(admin ? { history: this.list.map(pub).reverse() } : {})
    };
  }

  // ---------- leietaker ----------

  request(cmd) {
    const today = localDate();
    const cur = this.current;
    if (cur && cur.status === 'pending') throw new Error('Du har allerede sendt en forespørsel – vent på svar fra utleier');
    if (cur && cur.status === 'approved') throw new Error('Utleier har allerede godkjent at leieforholdet avsluttes');
    const date = String(cmd.date || '');
    if (!isDate(date)) throw new Error('Velg ønsket siste dag');
    if (date <= today) throw new Error('Siste dag må være fram i tid');
    if (date > endOfMonthAfter(today, 36)) throw new Error('Velg en dato innen tre år');
    const earliest = this.earliest(today);
    const t = {
      id: randomBytes(5).toString('hex'),
      created: new Date().toISOString(),
      requested_end: date,
      reason: str(cmd.reason, 1000),
      early: Boolean(earliest && date < earliest),
      earliest,
      status: 'pending'
    };
    this.list.push(t);
    if (this.list.length > 20) this.x.d.terminations = this.list.slice(-20);
    this.x.save();
    const what = t.early
      ? `Leietaker ber om å avslutte leieforholdet ${nice(date)} – før oppsigelsestiden er ute (tidligste dato etter kontrakten: ${nice(earliest)}). Dette må du godkjenne.`
      : `Leietaker har sagt opp leieforholdet med siste dag ${nice(date)}.`;
    this.x.engine.notify(`${what}${t.reason ? `\n\nBegrunnelse: ${t.reason}` : ''}\n\nSvar under Leieforhold i Hybel.`,
      { title: t.early ? 'Hybel: søknad om å avslutte leieforholdet' : 'Hybel: oppsigelse fra leietaker', inbox: true, id: 'oppsigelse', event: 'oppsigelse', untrusted: true }).catch(() => {});
  }

  withdraw(cmd) {
    const t = this.list.find((x) => x.id === String(cmd.id || ''));
    if (!t || t.status !== 'pending') throw new Error('Forespørselen kan ikke trekkes tilbake');
    t.status = 'withdrawn';
    t.decided_at = new Date().toISOString();
    this.x.save();
    this.x.engine.dismissNotice('oppsigelse');
    this.x.engine.notify('Leietaker har trukket tilbake forespørselen om å avslutte leieforholdet.', { title: 'Hybel: oppsigelse trukket tilbake' }).catch(() => {});
  }

  // ---------- utleier ----------

  decide(body) {
    const t = this.list.find((x) => x.id === String(body.id || ''));
    if (!t || t.status !== 'pending') throw new Error('Forespørselen er allerede behandlet');
    const comment = str(body.comment, 1000);
    t.decided_at = new Date().toISOString();
    t.comment = comment;
    this.x.engine.dismissNotice('oppsigelse');
    if (body.action === 'approve') {
      const date = body.date ? String(body.date) : t.requested_end;
      if (!isDate(date)) throw new Error('Ugyldig sluttdato');
      const l = this.x.lease.l;
      if (l.start && date <= l.start) throw new Error('Sluttdatoen må være etter innflytting');
      t.status = 'approved';
      t.approved_end = date;
      l.end = date;
      this.x.save();
      this.x.pushTenant({
        title: 'Utleier har godkjent – leieforholdet avsluttes',
        body: `Siste dag: ${nice(date)}.${comment ? ` ${comment}` : ''}`,
        tag: 'oppsigelse', url: '/?vis=strom',
        en: { title: 'Approved – your tenancy is ending', body: `Last day: ${niceEn(date)}.${comment ? ` ${comment}` : ''}` }
      });
    } else if (body.action === 'decline') {
      t.status = 'declined';
      this.x.save();
      this.x.pushTenant({
        title: 'Svar på forespørselen om å avslutte',
        body: comment || 'Utleier har ikke godkjent ønsket dato. Ta kontakt med utleier.',
        tag: 'oppsigelse', url: '/?vis=strom',
        en: { title: 'Reply to your request to end the tenancy', body: comment || 'The landlord has not approved the requested date. Please contact the landlord.' }
      });
    } else throw new Error('Ukjent handling');
  }
}

