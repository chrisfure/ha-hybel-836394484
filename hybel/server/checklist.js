// Inn- og utflyttingssjekkliste: leietaker går gjennom rom for rom, merker OK eller skriver merknad med bilder.
import { randomBytes } from 'node:crypto';

const newId = () => randomBytes(5).toString('hex');
const str = (v, max) => String(v ?? '').trim().slice(0, max);
export const MAX_PHOTOS_PER_ROW = 4;
const MAX_PHOTOS_TOTAL = 80;
export const TYPE_LABEL = { in: 'Innflytting', out: 'Utflytting' };

export const DEFAULT_TEMPLATE = [
  { room: 'Gang', items: ['Vegger og tak', 'Gulv', 'Inngangsdør og lås', 'Garderobe/skap'] },
  { room: 'Stue', items: ['Vegger og tak', 'Gulv', 'Vinduer', 'Stikkontakter og lys', 'Møbler'] },
  { room: 'Kjøkken', items: ['Benkeplate og skap', 'Komfyr og stekeovn', 'Kjøleskap og fryser', 'Oppvaskmaskin', 'Kjøkkenvifte', 'Gulv'] },
  { room: 'Bad', items: ['Vegger og fliser', 'Gulv og sluk', 'Toalett', 'Servant og kraner', 'Dusj', 'Speil og skap', 'Ventilasjon'] },
  { room: 'Soverom', items: ['Vegger og tak', 'Gulv', 'Vinduer', 'Skap'] },
  { room: 'Annet', items: ['Nøkler mottatt', 'Røykvarsler testet', 'Brannslukker eller brannteppe'] }
];

export function templateToText(t) {
  return (t || []).map((r) => `${r.room}: ${r.items.join(', ')}`).join('\n');
}

export function parseTemplate(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([^:]{1,40}):\s*(.*)$/);
    if (!m) continue;
    const items = m[2].split(',').map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 25);
    if (items.length) out.push({ room: m[1].trim(), items });
  }
  return out.slice(0, 20);
}

export class Checklists {
  constructor(extras) {
    this.x = extras;
  }

  get d() {
    return this.x.d;
  }

  get list() {
    if (!Array.isArray(this.d.checklists)) this.d.checklists = [];
    return this.d.checklists;
  }

  find(id) {
    const c = this.list.find((x) => x.id === id);
    if (!c) throw new Error('Fant ikke sjekklisten');
    return c;
  }

  editable(id) {
    const c = this.find(id);
    if (c.status !== 'open') throw new Error('Sjekklisten er sendt inn og kan ikke endres');
    return c;
  }

  row(c, i) {
    const r = c.rows[Number(i)];
    if (!r) throw new Error('Ukjent punkt');
    return r;
  }

  // ---------- utleier ----------

  create(type) {
    if (!TYPE_LABEL[type]) throw new Error('Ukjent type');
    if (this.list.some((c) => c.status === 'open')) throw new Error('Det finnes allerede en sjekkliste som ikke er sendt inn');
    const tpl = this.d.checklist_template?.length ? this.d.checklist_template : DEFAULT_TEMPLATE;
    const c = {
      id: newId(), type, status: 'open', created: new Date().toISOString(),
      rows: tpl.flatMap((r) => r.items.map((item) => ({ room: r.room, item, status: null, note: '', photos: [] }))),
      comment: '', landlord_comment: ''
    };
    this.list.unshift(c);
    this.x.save();
    this.x.pushTenant({ title: `${TYPE_LABEL[type]}ssjekkliste`, body: 'Gå gjennom hybelen og merk det som er i orden, eller skriv hva du ser. Ta gjerne bilder.', tag: `sjekk-${c.id}`, url: '/?vis=sjekk' });
  }

  approve(id, comment) {
    const c = this.find(id);
    if (c.status !== 'submitted') throw new Error('Sjekklisten er ikke sendt inn ennå');
    c.status = 'approved';
    c.approved_at = new Date().toISOString();
    c.landlord_comment = str(comment, 1500);
    c.tenant_unread = true;
    this.x.save();
    this.x.engine.dismissNotice(`sjekk_${c.id}`);
    this.x.pushTenant({ title: `${TYPE_LABEL[c.type]}ssjekklisten er godkjent`, body: c.landlord_comment || 'Utleier har gått gjennom sjekklisten.', tag: `sjekk-${c.id}`, url: '/?vis=sjekk' });
  }

  reopen(id) {
    const c = this.find(id);
    if (this.list.some((x) => x.status === 'open' && x.id !== id)) throw new Error('En annen sjekkliste er allerede åpen');
    c.status = 'open';
    delete c.submitted_at;
    delete c.approved_at;
    this.x.save();
    this.x.pushTenant({ title: 'Sjekklisten er åpnet igjen', body: 'Utleier har åpnet sjekklisten slik at du kan gjøre endringer.', tag: `sjekk-${c.id}`, url: '/?vis=sjekk' });
  }

  remove(id) {
    const c = this.find(id);
    this.x.deletePhotos(c.rows.flatMap((r) => r.photos));
    this.d.checklists = this.list.filter((x) => x.id !== id);
    this.x.engine.dismissNotice(`sjekk_${id}`);
    this.x.save();
  }

  // ---------- leietaker ----------

  set(cmd) {
    const c = this.editable(cmd.id);
    const r = this.row(c, cmd.i);
    if (cmd.status !== undefined) {
      if (![null, 'ok', 'note'].includes(cmd.status)) throw new Error('Ugyldig valg');
      r.status = cmd.status;
    }
    if (cmd.note !== undefined) r.note = str(cmd.note, 1000);
    this.x.save();
  }

  addPhoto(cmd) {
    const c = this.editable(cmd.id);
    const r = this.row(c, cmd.i);
    if (r.photos.length >= MAX_PHOTOS_PER_ROW) throw new Error(`Maks ${MAX_PHOTOS_PER_ROW} bilder per punkt`);
    if (c.rows.reduce((s, x) => s + x.photos.length, 0) >= MAX_PHOTOS_TOTAL) throw new Error('Sjekklisten har nådd maks antall bilder');
    this.x.claimPhoto(cmd.photo);
    r.photos.push(cmd.photo);
    if (!r.status) r.status = 'note';
    this.x.save();
  }

  removePhoto(cmd) {
    const c = this.editable(cmd.id);
    const r = this.row(c, cmd.i);
    if (!r.photos.includes(cmd.photo)) return;
    r.photos = r.photos.filter((p) => p !== cmd.photo);
    this.x.deletePhotos([cmd.photo]);
    this.x.save();
  }

  setComment(cmd) {
    const c = this.editable(cmd.id);
    c.comment = str(cmd.text, 2000);
    this.x.save();
  }

  submit(cmd) {
    const c = this.editable(cmd.id);
    const missing = c.rows.filter((r) => !r.status).length;
    if (missing) throw new Error(`Du mangler ${missing} punkt${missing === 1 ? '' : 'er'}`);
    c.status = 'submitted';
    c.submitted_at = new Date().toISOString();
    this.x.save();
    const notes = c.rows.filter((r) => r.status === 'note');
    const photos = c.rows.reduce((s, r) => s + r.photos.length, 0);
    const lines = notes.slice(0, 6).map((r) => `• ${r.room} – ${r.item}${r.note ? `: ${r.note.slice(0, 80)}` : ''}`);
    this.x.engine.notify(
      `${notes.length ? `${notes.length} merknad${notes.length === 1 ? '' : 'er'}` : 'Alt merket som i orden'}${photos ? `, ${photos} bilde${photos === 1 ? '' : 'r'}` : ''}.${lines.length ? `\n${lines.join('\n')}${notes.length > 6 ? '\n…' : ''}` : ''}\n\nSe hele listen på utleiersiden.`,
      { title: `${TYPE_LABEL[c.type]}ssjekkliste sendt inn`, inbox: true, id: `sjekk_${c.id}`, event: 'sjekkliste' }
    ).catch(() => {});
  }

  markSeen() {
    let ch = false;
    for (const c of this.list) if (c.tenant_unread) { c.tenant_unread = false; ch = true; }
    if (ch) this.x.save();
  }

  view() {
    return this.list.map((c) => ({
      id: c.id, type: c.type, label: TYPE_LABEL[c.type], status: c.status, created: c.created, submitted_at: c.submitted_at || null, approved_at: c.approved_at || null,
      rows: c.rows, comment: c.comment, landlord_comment: c.landlord_comment, unread: Boolean(c.tenant_unread),
      done: c.rows.filter((r) => r.status).length, total: c.rows.length
    }));
  }

  async handleTenant(cmd) {
    switch (cmd.type) {
      case 'checklist_set': this.set(cmd); return true;
      case 'checklist_photo_add': this.addPhoto(cmd); return true;
      case 'checklist_photo_remove': this.removePhoto(cmd); return true;
      case 'checklist_comment': this.setComment(cmd); return true;
      case 'checklist_submit': this.submit(cmd); return true;
      case 'checklist_seen': this.markSeen(); return true;
      default: return false;
    }
  }
}
