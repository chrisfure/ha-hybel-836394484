// Arkiv (ZIP) av et leieforhold: fakturaer, årsoversikter, sjekklister, dokumenter, bilder og meldinger.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Zip } from './zip.js';
import { log } from './log.js';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60) || 'uten-navn';

function messagesText(reports) {
  return reports.map((r) => [
    `${r.origin === 'landlord' ? 'Fra utleier' : `Fra leietaker – ${r.category || ''}`}${r.urgent ? ' (haster)' : ''} · ${fmt(r.created)} · status: ${r.status}`,
    r.text,
    ...(r.updates || []).map((u) => `  ${u.from === 'landlord' ? 'Utleier' : u.from === 'tenant' ? 'Leietaker' : 'Status'} ${fmt(u.at)}: ${u.text || u.status || ''}`),
    ''
  ].join('\n')).join('\n');
}

function addFiles(zip, x, { docs = [], reports = [], checklists = [] }) {
  for (const d of docs) {
    const p = join(x.dir, 'docs', `${d.id}.${d.ext}`);
    if (existsSync(p)) zip.add(`Dokumenter/${safe(d.name)}.${d.ext}`, readFileSync(p));
  }
  const photos = new Set();
  for (const r of reports) for (const id of r.photos || []) photos.add(id);
  for (const c of checklists) for (const row of c.rows || c.items || []) for (const id of row.photos || []) photos.add(id);
  for (const id of photos) {
    const f = x.photoFile(id);
    if (f && existsSync(f)) zip.add(`Bilder/${id}.jpg`, readFileSync(f));
  }
}

// Nåværende leieforhold.
export function currentArchive(x) {
  const d = x.d;
  const zip = new Zip();
  const l = x.lease.l;
  const tenant = l.tenant_name || 'Leietaker';
  const warn = (what, err) => log.warn(`Arkiv: ${what} feilet:`, err.message);
  for (const r of x.lease.ledger()) {
    try { zip.add(`Fakturaer/Faktura-${x.lease.invoiceNo(r.month)}.pdf`, x.lease.invoicePdf(r.month)); } catch (err) { warn(r.month, err); }
  }
  for (const y of x.lease.years()) {
    if (!x.lease.yearRows(y).length) continue;
    try { zip.add(`Årsoversikter/Årsoversikt-${y}.pdf`, x.lease.yearPdf(y)); } catch (err) { warn(y, err); }
  }
  if (x.contract.sent) { try { zip.add(`Leiekontrakt-v${x.contract.sent.version}.pdf`, x.contract.pdf('sent')); } catch (err) { warn('kontrakt', err); } }
  for (const c of d.checklists || []) {
    try { zip.add(`Sjekklister/${x.checklists.filename(c)}`, x.checklists.pdf(c.id)); } catch (err) { warn('sjekkliste', err); }
  }
  if ((d.reports || []).length) zip.add('Meldinger.txt', messagesText(d.reports));
  addFiles(zip, x, { docs: d.docs || [], reports: d.reports || [], checklists: d.checklists || [] });
  zip.add('Data.json', JSON.stringify({ laget: new Date().toISOString(), leieforhold: l, betalinger: d.payments || {}, avlesninger: d.readings || [], meldinger: d.reports || [], sjekklister: d.checklists || [], dokumenter: d.docs || [], vedlikehold: d.maintenance || [] }, null, 2));
  return { buf: zip.build(), name: `Hybel-${safe(tenant)}-${new Date().toISOString().slice(0, 10)}.zip` };
}

// Tidligere leieforhold (fra leietakerbytte).
export function pastArchive(x, i) {
  const a = (x.d.archive || [])[i];
  if (!a) throw new Error('Fant ikke arkivet');
  const zip = new Zip();
  if ((a.reports || []).length) zip.add('Meldinger.txt', messagesText(a.reports));
  addFiles(zip, x, a);
  zip.add('Data.json', JSON.stringify(a, null, 2));
  return { buf: zip.build(), name: `Hybel-${safe(a.lease?.tenant_name || 'tidligere')}-${a.at.slice(0, 10)}.zip` };
}

export function archiveList(x) {
  return (x.d.archive || []).map((a, i) => ({ i, at: a.at, tenant: a.lease?.tenant_name || '', start: a.lease?.start || '', end: a.lease?.end || '' })).reverse();
}
