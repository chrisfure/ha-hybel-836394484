// Inn- og utflyttingssjekkliste: leietaker går gjennom rom for rom, merker OK eller skriver merknad med bilder.
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PdfDoc, PAGE, wrap } from './pdf.js';

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

  submit(cmd, ctx = {}) {
    const c = this.editable(cmd.id);
    const missing = c.rows.filter((r) => !r.status).length;
    if (missing) throw new Error(`Du mangler ${missing} punkt${missing === 1 ? '' : 'er'}`);
    c.status = 'submitted';
    c.submitted_at = new Date().toISOString();
    if (ctx.email) c.submitted_by = String(ctx.email).slice(0, 120);
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

  // Fingeravtrykk av innholdet, slik at begge parter kan se at PDF-en ikke er endret i ettertid.
  fingerprint(c) {
    const data = JSON.stringify({ id: c.id, type: c.type, created: c.created, submitted_at: c.submitted_at, submitted_by: c.submitted_by, rows: c.rows, comment: c.comment });
    return createHash('sha256').update(data).digest('hex').slice(0, 32).replace(/(.{4})/g, '$1 ').trim();
  }

  filename(c) {
    return `${TYPE_LABEL[c.type]}ssjekkliste-${(c.submitted_at || c.created).slice(0, 10)}.pdf`;
  }

  pdf(id) {
    const c = this.find(id);
    const doc = new PdfDoc();
    const { W, M } = PAGE;
    const CW = W - 2 * M;
    const fmt = (iso) => (iso ? new Date(iso).toLocaleString('nb-NO', { timeZone: process.env.TZ || 'Europe/Oslo', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
    const GREEN = '0.18 0.42 0.27', AMBER = '0.6 0.33 0.07', GRAY = '0.42 0.38 0.35';

    doc.y -= 6;
    doc.text(`${TYPE_LABEL[c.type]}ssjekkliste`, M, doc.y - 22, 22, true);
    doc.y -= 34;
    const info = this.d.info || {};
    const meta = [
      ['Opprettet', fmt(c.created)],
      ['Sendt inn', c.submitted_at ? `${fmt(c.submitted_at)}${c.submitted_by ? ` av ${c.submitted_by}` : ''}` : 'Ikke sendt inn ennå'],
      ['Godkjent', c.approved_at ? fmt(c.approved_at) : c.status === 'submitted' ? 'Venter på utleier' : '–'],
      ...(info.contact_name ? [['Utleier', [info.contact_name, info.contact_email].filter(Boolean).join(', ')]] : [])
    ];
    for (const [k, v] of meta) {
      doc.text(k, M, doc.y - 10, 9.5, true, GRAY);
      doc.y -= 0;
      const lines = wrap(v, CW - 90, 9.5);
      lines.forEach((l, i) => doc.text(l, M + 90, doc.y - 10 - i * 13, 9.5));
      doc.y -= Math.max(1, lines.length) * 13;
    }
    const notes = c.rows.filter((r) => r.status === 'note').length;
    const ok = c.rows.filter((r) => r.status === 'ok').length;
    doc.y -= 6;
    doc.rect(M, doc.y - 26, CW, 26, '0.96 0.94 0.91');
    doc.text(`${c.rows.length} punkter: ${ok} OK, ${notes} med merknad${c.rows.length - ok - notes ? `, ${c.rows.length - ok - notes} ikke besvart` : ''}.`, M + 10, doc.y - 17, 10, true);
    doc.y -= 38;

    const COL = 170;
    const rooms = [...new Set(c.rows.map((r) => r.room))];
    for (const room of rooms) {
      doc.ensure(50);
      doc.text(room, M, doc.y - 14, 13, true);
      doc.y -= 20;
      doc.line(M, doc.y, M + CW, doc.y, 0.75, 0.8);
      doc.y -= 4;
      for (const r of c.rows.filter((x) => x.room === room)) {
        const itemLines = wrap(r.item, COL - 8, 10);
        const noteLines = r.note ? wrap(r.note, CW - COL, 9.5) : [];
        const h = Math.max(itemLines.length * 13, 13 + noteLines.length * 12.5) + 8;
        doc.ensure(h);
        const top = doc.y;
        itemLines.forEach((l, i) => doc.text(l, M, top - 12 - i * 13, 10));
        const st = r.status === 'ok' ? ['OK', GREEN] : r.status === 'note' ? ['Merknad', AMBER] : ['Ikke besvart', GRAY];
        doc.text(st[0], M + COL, top - 12, 10, true, st[1]);
        noteLines.forEach((l, i) => doc.text(l, M + COL, top - 25 - i * 12.5, 9.5));
        doc.y = top - h;
        if (r.photos?.length) {
          const per = 3, gap = 8, pw = (CW - COL - gap * (per - 1)) / per;
          let col = 0, rowH = 0;
          for (const pid of r.photos) {
            let buf;
            try { buf = readFileSync(this.x.photoFile(pid)); } catch { continue; }
            const img = doc.addImage(buf);
            if (!img) continue;
            const ih = Math.min(pw * img.h / img.w, 150);
            const iw = ih * img.w / img.h;
            if (col === 0) doc.ensure(ih + 8);
            doc.image(img, M + COL + col * (pw + gap), doc.y, iw, ih);
            rowH = Math.max(rowH, ih);
            col++;
            if (col === per) { doc.y -= rowH + gap; col = 0; rowH = 0; }
          }
          if (col) doc.y -= rowH + gap;
        }
        doc.line(M, doc.y + 2, M + CW, doc.y + 2, 0.92);
        doc.y -= 4;
      }
      doc.y -= 10;
    }
    const block = (title, text) => {
      if (!text) return;
      doc.ensure(40);
      doc.text(title, M, doc.y - 13, 12, true);
      doc.y -= 20;
      doc.para(text, M, CW, 10);
      doc.y -= 10;
    };
    block('Kommentar fra leietaker', c.comment);
    block('Kommentar fra utleier', c.landlord_comment);
    doc.ensure(60);
    doc.y -= 6;
    doc.line(M, doc.y, M + CW, doc.y, 0.8);
    doc.y -= 4;
    doc.para(`Dokumentet er laget av Hybel-appen ${fmt(new Date().toISOString())} fra det som ble registrert i appen. Bildene er tatt av leietaker. Fingeravtrykk for innholdet: ${this.fingerprint(c)}`, M, CW, 8.5, false, 1.35, GRAY);
    return doc.build({ footer: `${TYPE_LABEL[c.type]}ssjekkliste · ${c.id}` });
  }

  view() {
    return this.list.map((c) => ({
      id: c.id, type: c.type, label: TYPE_LABEL[c.type], status: c.status, created: c.created, submitted_at: c.submitted_at || null, approved_at: c.approved_at || null,
      rows: c.rows, comment: c.comment, submitted_by: c.submitted_by || null, landlord_comment: c.landlord_comment, unread: Boolean(c.tenant_unread),
      done: c.rows.filter((r) => r.status).length, total: c.rows.length
    }));
  }

  async handleTenant(cmd, ctx = {}) {
    switch (cmd.type) {
      case 'checklist_set': this.set(cmd); return true;
      case 'checklist_photo_add': this.addPhoto(cmd); return true;
      case 'checklist_photo_remove': this.removePhoto(cmd); return true;
      case 'checklist_comment': this.setComment(cmd); return true;
      case 'checklist_submit': this.submit(cmd, ctx); return true;
      case 'checklist_seen': this.markSeen(); return true;
      default: return false;
    }
  }
}
