// Vedlikehold: gjentakende oppgaver med intervall (f.eks. filterbytte, rens av sluk).
// Utleier får påminnelse når noe forfaller. Oppgaver merket «leietaker» vises også i hybelappen.
import { randomBytes } from 'node:crypto';
import { localDate } from './lease.js';

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(new Date(v).getTime());
const MAX = 30;

export const DEFAULT_TASKS = [
  { title: 'Bytt filter i ventilasjonen', months: 6, tenant: false },
  { title: 'Rens sluket i dusjen', months: 2, tenant: true },
  { title: 'Rengjør kjøkkenviften (fettfilter)', months: 3, tenant: true }
];

function addMonths(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return localDate(d);
}

export class Maintenance {
  constructor(extras) {
    this.x = extras;
  }

  get list() {
    if (!Array.isArray(this.x.d.maintenance)) {
      const today = localDate();
      this.x.d.maintenance = DEFAULT_TASKS.map((t) => ({ id: randomBytes(5).toString('hex'), ...t, last: today, history: [] }));
    }
    return this.x.d.maintenance;
  }

  next(t) {
    return addMonths(t.last, t.months);
  }

  view(t, today = localDate()) {
    const next = this.next(t);
    const days = Math.round((new Date(next) - new Date(today)) / 86400000);
    return { id: t.id, title: t.title, months: t.months, tenant: t.tenant, last: t.last, next, days, due: days <= 0, soon: days > 0 && days <= 14, history: (t.history || []).slice(-5) };
  }

  adminView() {
    const today = localDate();
    return this.list.map((t) => this.view(t, today)).sort((a, b) => a.next.localeCompare(b.next));
  }

  // Leietaker ser bare egne oppgaver som forfaller innen en uke.
  tenantView() {
    const today = localDate();
    return this.list.filter((t) => t.tenant).map((t) => this.view(t, today)).filter((v) => v.days <= 7)
      .map(({ id, title, next, days, due }) => ({ id, title, next, days, due }));
  }

  find(id) {
    const t = this.list.find((x) => x.id === String(id));
    if (!t) throw new Error('Fant ikke oppgaven');
    return t;
  }

  markDone(id, by = 'landlord', date = localDate()) {
    const t = this.find(id);
    if (!isDate(date) || date > localDate()) throw new Error('Ugyldig dato');
    t.history = [...(t.history || []), { date, by }].slice(-20);
    t.last = date;
    delete t.flag;
    this.x.engine.dismissNotice(`vedlikehold_${t.id}`);
    this.x.save();
    return t;
  }

  // Leietaker trykker «Gjort» på en oppgave i appen.
  tenantDone(id) {
    const t = this.find(id);
    if (!t.tenant) throw new Error('Denne oppgaven gjøres av utleier');
    if (this.view(t).days > 7) throw new Error('Oppgaven er ikke aktuell ennå');
    this.markDone(id, 'tenant');
    this.x.engine.notify(`Leietaker har gjort: ${t.title}.`, { title: 'Hybel: vedlikehold utført', untrusted: true }).catch(() => {});
  }

  save(body) {
    const a = body.action;
    if (a === 'done') return this.markDone(body.id, 'landlord', body.date || localDate());
    if (a === 'delete') {
      const t = this.find(body.id);
      this.x.d.maintenance = this.list.filter((x) => x !== t);
      this.x.engine.dismissNotice(`vedlikehold_${t.id}`);
      return this.x.save();
    }
    const title = str(body.title, 80);
    const months = Number(body.months);
    if (title.length < 2) throw new Error('Skriv hva som skal gjøres');
    if (!(Number.isInteger(months) && months >= 1 && months <= 60)) throw new Error('Intervallet må være mellom 1 og 60 måneder');
    const last = body.last && isDate(body.last) && body.last <= localDate() ? body.last : localDate();
    if (a === 'add') {
      if (this.list.length >= MAX) throw new Error(`Maks ${MAX} oppgaver`);
      this.list.push({ id: randomBytes(5).toString('hex'), title, months, tenant: Boolean(body.tenant), last, history: [] });
    } else if (a === 'update') {
      const t = this.find(body.id);
      Object.assign(t, { title, months, tenant: Boolean(body.tenant), last });
      delete t.flag;
    } else throw new Error('Ukjent handling');
    this.x.save();
  }

  // Hvert minutt: varsle én gang når en oppgave forfaller (kl. 10 eller senere).
  tick(now = new Date()) {
    if (now.getHours() < 10) return false;
    const today = localDate(now);
    let ch = false;
    for (const t of this.list) {
      const next = this.next(t);
      if (next > today || t.flag === next) continue;
      t.flag = next;
      ch = true;
      this.x.engine.notify(`Det er tid for: ${t.title} (${t.months === 1 ? 'hver måned' : `hver ${t.months}. måned`}).${t.tenant ? ' Leietaker har også fått påminnelse.' : ''} Marker som utført under Vedlikehold i Hybel.`,
        { title: 'Hybel: vedlikehold', inbox: true, id: `vedlikehold_${t.id}`, event: 'vedlikehold' }).catch(() => {});
      if (t.tenant) this.x.pushTenant({ title: 'Påminnelse', body: `${t.title}. Trykk «Gjort» i appen når det er ordnet.`, tag: `vedlikehold-${t.id}`, url: '/?vis=info' });
    }
    return ch;
  }
}
