// Leiekontrakt: utleier krysser av for vanlige vilkår, appen lager kontraktsteksten og en PDF.
// Utleier sender den til leietaker, som leser og godtar i appen (tidsstempel + innlogget e-post).
// Sendt tekst lagres som et øyeblikksbilde, så leietaker godtar akkurat den teksten som ble sendt.
import { createHash } from 'node:crypto';
import { PdfDoc, PAGE, textWidth } from './pdf.js';
import { localDate } from './lease.js';

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(new Date(v).getTime());
const nice = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const stamp = (iso) => new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });
const kr = (n) => `${Number(n).toLocaleString('nb-NO', Number.isInteger(Number(n)) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
const yearsBetween = (a, b) => (new Date(b) - new Date(a)) / (365.25 * 86400000);

const ONE_OF = {
  object_type: ['hybel', 'sokkel', 'leilighet'],
  furnished: ['umoblert', 'delvis', 'moblert'],
  term: ['tidsubestemt', 'tidsbestemt'],
  term_cancel: ['begge', 'leietaker', 'ingen'],
  power: ['maaler', 'inkludert', 'fast'],
  deposit_type: ['konto', 'garanti', 'ingen'],
  pets: ['nei', 'avtale', 'ja'],
  smoking: ['nei', 'ute', 'ja']
};
const FLAGS = ['own_bath', 'own_kitchen', 'storage', 'parking', 'washer', 'internet', 'water_incl', 'heat_incl', 'kpi', 'eviction', 'app_clause', 'attach_rules', 'checklist_clause', 'insurance'];

export function defaultContractOpts() {
  return {
    object_type: 'hybel', rooms: '', furnished: 'delvis',
    own_bath: true, own_kitchen: true, storage: false, parking: false, washer: false, internet: true, water_incl: true, heat_incl: false,
    term: 'tidsubestemt', term_cancel: 'begge',
    power: 'maaler', power_fixed: null, kpi: true,
    deposit_type: 'konto', pets: 'nei', smoking: 'nei',
    eviction: true, app_clause: true, attach_rules: true, checklist_clause: true, insurance: true,
    tenant_birth: '', tenant_email: '', tenant_phone: '', landlord_address: '', special: ''
  };
}

export class Contract {
  constructor(extras) {
    this.x = extras;
  }

  get opts() {
    if (!this.x.d.contract_opts) this.x.d.contract_opts = defaultContractOpts();
    return { ...defaultContractOpts(), ...this.x.d.contract_opts };
  }

  get sent() {
    return this.x.d.contract || null;
  }

  saveOpts(o = {}) {
    const cur = this.opts;
    for (const [k, list] of Object.entries(ONE_OF)) if (o[k] !== undefined && list.includes(o[k])) cur[k] = o[k];
    for (const k of FLAGS) if (o[k] !== undefined) cur[k] = Boolean(o[k]);
    for (const [k, max] of [['rooms', 300], ['tenant_birth', 20], ['tenant_email', 120], ['tenant_phone', 30], ['landlord_address', 160], ['special', 3000]]) if (o[k] !== undefined) cur[k] = str(o[k], max);
    if (o.power_fixed !== undefined) {
      const n = Math.round(Number(String(o.power_fixed).replace(/\s/g, '').replace(',', '.')));
      cur.power_fixed = o.power_fixed === '' || o.power_fixed === null ? null : n >= 0 && n <= 20000 ? n : cur.power_fixed;
    }
    this.x.d.contract_opts = cur;
    this.x.save();
  }

  // Ting utleier bør se på før kontrakten sendes.
  warnings(o = this.opts) {
    const l = this.x.lease.l;
    const info = this.x.d.info || {};
    const w = [];
    if (!l.landlord_name && !info.contact_name) w.push('Utleiers navn mangler (Leieforhold eller Info).');
    if (!l.tenant_name) w.push('Leietakers navn mangler (Leieforhold).');
    if (!l.address) w.push('Adressen til hybelen mangler (Leieforhold).');
    if (!l.start) w.push('Innflyttingsdato mangler (Leieforhold).');
    if (!l.rent) w.push('Husleie er ikke satt (Økonomi).');
    if (!l.account) w.push('Kontonummer mangler (Økonomi).');
    if (o.term === 'tidsbestemt') {
      if (!l.end) w.push('Tidsbestemt avtale trenger en sluttdato («Kontrakt til» under Leieforhold).');
      else if (l.start) {
        const min = o.object_type === 'leilighet' ? 3 : 1;
        if (yearsBetween(l.start, l.end) < min - 0.01) w.push(`Tidsbestemte avtaler må normalt vare minst ${min === 3 ? 'tre år' : 'ett år (del av bolig der utleier selv bor)'}. Kortere avtaler kan bli regnet som tidsubestemte.`);
      }
    } else if (!l.notice_months) w.push('Oppsigelsestid mangler (Leieforhold). Vanlig er 3 måneder.');
    if (o.deposit_type !== 'ingen' && l.deposit && l.rent && l.deposit > l.rent * 6) w.push('Depositum og garanti kan til sammen ikke være mer enn seks måneders leie.');
    if (o.deposit_type !== 'ingen' && !l.deposit) w.push('Beløpet for depositum/garanti mangler (Leieforhold).');
    if (o.power === 'maaler' && this.x.d.electricity?.price_per_kwh == null) w.push('Strømpris per kWh er ikke satt (Økonomi).');
    if (o.power === 'fast' && !o.power_fixed) w.push('Fast månedsbeløp for strøm mangler.');
    if (o.attach_rules && !info.rules) w.push('Husordensregler skal vedlegges, men er ikke skrevet (Info til leietaker).');
    return w;
  }

  // Selve kontraktsteksten: liste med { h: overskrift, p: [avsnitt] }.
  build(o = this.opts) {
    const l = this.x.lease.l;
    const info = this.x.d.info || {};
    const el = this.x.d.electricity || {};
    const landlord = l.landlord_name || info.contact_name || '';
    const S = [];
    const add = (h, p) => S.push({ h, p: p.filter(Boolean) });

    add('Parter', [
      `Utleier: ${landlord || '________________'}${o.landlord_address ? `, ${o.landlord_address}` : ''}${info.contact_phone ? `, tlf. ${info.contact_phone}` : ''}${info.contact_email ? `, e-post ${info.contact_email}` : ''}.`,
      `Leietaker: ${l.tenant_name || '________________'}${o.tenant_birth ? `, født ${o.tenant_birth}` : ''}${o.tenant_phone ? `, tlf. ${o.tenant_phone}` : ''}${o.tenant_email ? `, e-post ${o.tenant_email}` : ''}.`
    ]);

    const typeText = {
      hybel: 'hybel i bolig der utleier selv bor',
      sokkel: 'sokkel- eller loftsleilighet i hus der utleier selv bor',
      leilighet: 'selvstendig bolig'
    }[o.object_type];
    const extras = [o.own_bath && 'eget bad', o.own_kitchen && 'eget kjøkken/kjøkkenkrok', o.storage && 'bod', o.parking && 'parkeringsplass', o.washer && 'tilgang til vaskemaskin', o.internet && 'internett'].filter(Boolean);
    add('Leieobjektet', [
      `Leieforholdet gjelder ${typeText}${l.address ? ` i ${l.address}` : ''}.`,
      o.rooms ? `Leieobjektet består av: ${o.rooms}.` : '',
      extras.length ? `Leietaker har i tillegg ${extras.join(', ').replace(/, ([^,]*)$/, ' og $1')}.` : '',
      `Boligen leies ut ${{ umoblert: 'umøblert', delvis: 'delvis møblert', moblert: 'møblert' }[o.furnished]}.${o.furnished !== 'umoblert' && o.checklist_clause ? ' Inventaret som følger med, registreres i innflyttingssjekklisten.' : ''}`
    ]);

    const n = Number(l.notice_months) || 3;
    const nTxt = `${n} måned${n === 1 ? '' : 'er'}`;
    if (o.term === 'tidsbestemt') {
      add('Leietid og oppsigelse', [
        `Leieforholdet starter ${nice(l.start) || '________'} og opphører uten oppsigelse ${nice(l.end) || '________'}.`,
        o.term_cancel === 'begge' ? `I leieperioden kan begge parter si opp avtalen med ${nTxt} oppsigelsesfrist, regnet fra utgangen av den måneden oppsigelsen kom fram.`
          : o.term_cancel === 'leietaker' ? `I leieperioden kan leietaker si opp avtalen med ${nTxt} oppsigelsesfrist, regnet fra utgangen av den måneden oppsigelsen kom fram. Utleier kan ikke si opp avtalen i leieperioden.`
            : 'Avtalen kan ikke sies opp i leieperioden.',
        'Oppsigelse skal være skriftlig. Oppsigelse fra utleier må oppfylle kravene i husleieloven.'
      ]);
    } else {
      add('Leietid og oppsigelse', [
        `Leieforholdet starter ${nice(l.start) || '________'} og løper til det blir sagt opp.`,
        `Oppsigelsesfristen er ${nTxt} for begge parter, regnet fra utgangen av den måneden oppsigelsen kom fram.`,
        'Oppsigelse skal være skriftlig. Leietaker kan si opp i Hybel-appen. Oppsigelse fra utleier må oppfylle kravene i husleieloven og være saklig begrunnet.'
      ]);
    }

    const incl = [o.water_incl && 'vann og avløp', o.heat_incl && 'oppvarming', o.internet && 'internett', l.includes].filter(Boolean);
    const price = el.price_per_kwh;
    add('Husleie og betaling', [
      `Husleien er ${l.rent ? kr(l.rent) : '________ kr'} per måned${(l.due_day || 1) === 1 ? ' og betales forskuddsvis innen den 1. hver måned' : ` og betales innen den ${l.due_day}. i måneden leien gjelder for (for eksempel betales leien for oktober innen ${l.due_day}. oktober)`}${l.account ? ` til konto ${l.account}` : ''}. Merk betalingen med fakturanummeret som vises i Hybel-appen.`,
      'Flytter leietaker inn eller ut i løpet av en måned, beregnes husleien per dag for den måneden.',
      incl.length ? `Husleien inkluderer ${incl.join(', ').replace(/, ([^,]*)$/, ' og $1')}.` : '',
      o.power === 'maaler' ? `Strøm betales etter faktisk forbruk målt på egen måler for hybelen. Prisen tilsvarer utleiers kostnad per kWh inkludert nettleie og avgifter, for tiden ${price != null ? kr(price) : '____ kr'} per kWh. Strøm faktureres etterskuddsvis sammen med husleien, og endret pris varsles i appen.`
        : o.power === 'inkludert' ? 'Strøm er inkludert i husleien.'
          : `Strøm betales med et fast beløp på ${o.power_fixed ? kr(o.power_fixed) : '____ kr'} per måned sammen med husleien.`,
      o.kpi ? 'Husleien kan reguleres i samsvar med endringen i konsumprisindeksen, tidligst ett år etter siste leiefastsettelse og med minst én måneds skriftlig varsel.' : '',
      'Andre beløp enn det som står i denne kontrakten kan ikke kreves.'
    ]);

    const dep = l.deposit;
    add(o.deposit_type === 'garanti' ? 'Garanti' : 'Depositum', [
      o.deposit_type === 'konto' ? `Leietaker betaler et depositum på ${dep ? kr(dep) : '________ kr'}${dep && l.rent ? ` (${Math.round((dep / l.rent) * 10) / 10} måneders leie)` : ''}. Beløpet settes inn på en egen depositumskonto i leietakers navn. Utleier betaler kostnadene ved å opprette kontoen. Depositumet frigis når leieforholdet er avsluttet og eventuelle krav fra utleier etter leieavtalen er gjort opp.`
        : o.deposit_type === 'garanti' ? `Leietaker stiller garanti på ${dep ? kr(dep) : '________ kr'}, for eksempel fra NAV eller et garantiselskap, som sikkerhet for leie og andre krav etter leieavtalen.`
          : 'Det stilles ikke depositum eller garanti.',
      o.deposit_type !== 'ingen' ? 'Depositum og garanti kan til sammen ikke overstige seks måneders leie.' : ''
    ]);

    add('Overtakelse', [
      'Utleier overleverer boligen ryddet, rengjort og i god stand.',
      o.checklist_clause ? 'Partene går gjennom boligen ved innflytting med sjekklisten i Hybel-appen. Merknader og bilder lagres der og gjelder som dokumentasjon av tilstanden. Mangler som oppdages senere, må meldes så snart som mulig.' : 'Mangler må meldes så snart som mulig etter innflytting.'
    ]);

    add('Bruk av boligen', [
      'Leietaker skal behandle boligen med tilbørlig aktsomhet og følge husordensreglene' + (o.attach_rules ? ' (vedlegg 1).' : '.'),
      { nei: 'Dyrehold er ikke tillatt uten skriftlig samtykke fra utleier, med de unntak som følger av husleieloven.', avtale: 'Dyrehold er bare tillatt etter avtale med utleier.', ja: 'Dyrehold er tillatt så lenge det ikke er til ulempe for utleier eller andre.' }[o.pets],
      { nei: 'Røyking er ikke tillatt i boligen.', ute: 'Røyking er bare tillatt utendørs.', ja: '' }[o.smoking],
      'Leietaker kan ikke fremleie hele eller deler av boligen uten skriftlig samtykke fra utleier, med mindre annet følger av husleieloven. Opptak i husstanden følger reglene i husleieloven.',
      'Leietaker kan ikke gjøre endringer i boligen uten samtykke fra utleier.'
    ]);

    add('Vedlikehold og skader', [
      'Leietaker sørger for vanlig vedlikehold av låser, kraner, servant og toalett, brytere og stikkontakter, og bytter lyspærer og batterier i røykvarsler. Annet vedlikehold er utleiers ansvar.',
      'Leietaker skal straks melde fra til utleier om skader – gjerne i Hybel-appen – og så langt det er mulig hindre at skaden blir større.',
      'Utleier skal varsle i rimelig tid før han eller hun går inn i boligen, med mindre det er fare for skade og leietaker ikke kan nås.',
      o.insurance ? 'Leietaker bør ha egen innboforsikring. Utleiers forsikring dekker ikke leietakers eiendeler.' : ''
    ]);

    if (o.app_clause) {
      add('Smarthus og Hybel-appen', [
        'Leietaker får tilgang til Hybel-appen for å styre lys, varme og ventilasjon, melde fra til utleier, lese av strøm og se fakturaer. Utleier kan sette grenser for temperatur og ventilasjon.',
        'Målinger av temperatur, luftfuktighet og strømforbruk lagres i utleiers smarthussystem. De brukes bare til drift av boligen og avregning av strøm, og deles ikke med andre. Ber leietaker om sparetips i appen, sendes målingene fra siste uke – uten navn, meldinger eller betalinger – til en AI-modell for vurdering.',
        'Meldinger, sjekklister og betalinger i appen gjelder som skriftlig kommunikasjon mellom partene.'
      ]);
    }

    if (o.eviction) {
      add('Tvangsfravikelse', [
        'Leietaker vedtar at tvangsfravikelse kan kreves dersom leie eller avtalte tilleggsytelser ikke blir betalt innen 14 dager etter at skriftlig varsel er sendt etter forfall, jf. tvangsfullbyrdelsesloven § 4-18 og § 13-2 tredje ledd bokstav a.',
        o.term === 'tidsbestemt' ? 'Leietaker vedtar også at tvangsfravikelse kan kreves når leietiden er ute, jf. tvangsfullbyrdelsesloven § 13-2 tredje ledd bokstav b.' : ''
      ]);
    }

    add('Tilbakelevering', [
      'Ved fraflytting skal boligen være ryddet og rengjort, og alle nøkler leveres tilbake. Boligen skal være i samme stand som ved overtakelsen, bortsett fra vanlig slit og elde.',
      o.checklist_clause ? 'Partene går gjennom boligen med utflyttingssjekklisten i Hybel-appen. Er utleier ikke fornøyd med rengjøringen, skal leietaker få mulighet til å rette det før det kreves erstatning.' : ''
    ]);

    if (o.special) add('Særlige bestemmelser', o.special.split(/\n+/).map((s) => s.trim()));

    add('Lov og tvister', [
      'For leieforholdet gjelder husleieloven. Ved motstrid går lovens ufravikelige regler foran denne kontrakten.',
      'Tvister kan bringes inn for Husleietvistutvalget eller de alminnelige domstolene.'
    ]);

    const attach = [];
    if (o.attach_rules && info.rules) attach.push({ h: 'Vedlegg 1 – Husordensregler', p: String(info.rules).split(/\n+/).map((s) => s.trim()).filter(Boolean) });
    return { sections: S, attachments: attach };
  }

  hash(body) {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  }

  // Utleier sender kontrakten (og godtar den selv).
  send() {
    const w = this.warnings().filter((x) => !/Husordensregler/.test(x));
    const hard = w.filter((x) => /mangler|ikke satt|trenger/.test(x));
    if (hard.length) throw new Error(`Fyll ut først: ${hard.join(' ')}`);
    if (this.sent?.tenant_accept) throw new Error('Kontrakten er allerede godtatt. Lag en ny versjon først.');
    const l = this.x.lease.l;
    const body = this.build();
    const version = (this.sent?.version || 0) + 1;
    this.x.d.contract = {
      version,
      created: new Date().toISOString(),
      landlord: l.landlord_name || this.x.d.info?.contact_name || '',
      tenant: l.tenant_name || '',
      address: l.address || '',
      body,
      hash: this.hash(body),
      landlord_accept: { at: new Date().toISOString() },
      tenant_accept: null
    };
    this.x.save();
    this.x.pushTenant({
      title: 'Leiekontrakt til godkjenning', body: 'Utleier har sendt deg leiekontrakten. Les den og godta i appen.', tag: 'kontrakt', url: '/?vis=strom',
      en: { title: 'Lease contract to approve', body: 'The landlord has sent you the lease contract. Read it and accept it in the app.' }
    });
  }

  // Lag ny versjon (f.eks. etter endringer). Godtatt kontrakt flyttes til historikk.
  reset() {
    const c = this.sent;
    if (!c) return;
    this.x.d.contract_history = [...(this.x.d.contract_history || []), c].slice(-10);
    this.x.d.contract = null;
    this.x.save();
  }

  accept(cmd, ctx) {
    const c = this.sent;
    if (!c) throw new Error('Det finnes ingen kontrakt å godta');
    if (c.tenant_accept) throw new Error('Kontrakten er allerede godtatt');
    if (String(cmd.hash || '') !== c.hash) throw new Error('Kontrakten er endret – last siden på nytt og les den igjen');
    if (cmd.read !== true) throw new Error('Bekreft at du har lest kontrakten');
    c.tenant_accept = { at: new Date().toISOString(), email: ctx?.email || null };
    this.x.save();
    this.x.engine.notify(`Leietaker har godtatt leiekontrakten (versjon ${c.version}). PDF-en finner du under Leiekontrakt i Hybel.`,
      { title: 'Hybel: leiekontrakt godtatt', inbox: true, id: 'kontrakt_godtatt', event: 'kontrakt' }).catch(() => {});
  }

  view(admin = false) {
    const c = this.sent;
    const sent = c && {
      version: c.version, created: c.created, hash: c.hash, body: c.body,
      landlord_accept: c.landlord_accept, tenant_accept: c.tenant_accept ? { at: c.tenant_accept.at, ...(admin ? { email: c.tenant_accept.email } : {}) } : null
    };
    return admin ? { opts: this.opts, warnings: this.warnings(), preview: this.build(), sent, history: (this.x.d.contract_history || []).map((h) => ({ version: h.version, created: h.created, accepted: h.tenant_accept?.at || null })) } : sent;
  }

  // ---------- PDF ----------

  pdf(which = 'sent') {
    const c = which === 'draft' ? null : this.sent;
    const l = this.x.lease.l;
    const body = c ? c.body : this.build();
    const doc = new PdfDoc();
    const { W, M } = PAGE;
    const CW = W - 2 * M;
    const GRAY = '0.42 0.38 0.35';
    doc.text('Leiekontrakt for bolig', M, doc.y - 24, 24, true);
    const sub = [c ? `Versjon ${c.version}` : 'UTKAST – ikke sendt', (c?.address || l.address) || ''].filter(Boolean).join(' · ');
    doc.text(sub, M, doc.y - 42, 10, false, GRAY);
    doc.y -= 64;
    body.sections.forEach((s, i) => {
      doc.ensure(40);
      doc.text(`${i + 1}. ${s.h}`, M, doc.y - 12, 12, true);
      doc.y -= 20;
      for (const p of s.p) { doc.para(p, M, CW, 10, false, 1.42); doc.y -= 5; }
      doc.y -= 6;
    });

    // Godkjenning
    doc.ensure(150);
    doc.y -= 4;
    doc.text(`${body.sections.length + 1}. Godkjenning`, M, doc.y - 12, 12, true);
    doc.y -= 22;
    doc.para('Kontrakten er inngått elektronisk i Hybel-appen. Begge parter har tilgang til kontrakten som PDF.', M, CW, 10, false, 1.42);
    doc.y -= 8;
    const colW = CW / 2 - 10;
    const top = doc.y;
    const box = (x, title, name, lines) => {
      doc.rect(x, top - 78, colW, 78, '0.96 0.94 0.91');
      doc.text(title, x + 10, top - 16, 8.5, true, GRAY);
      doc.text(name || '–', x + 10, top - 32, 11, true);
      lines.filter(Boolean).forEach((t, i) => doc.text(t, x + 10, top - 48 - i * 12, 9, false, GRAY));
    };
    box(M, 'UTLEIER', c?.landlord || l.landlord_name, c?.landlord_accept ? [`Sendt og godtatt ${stamp(c.landlord_accept.at)}`] : ['Ikke sendt']);
    box(M + colW + 20, 'LEIETAKER', c?.tenant || l.tenant_name, c?.tenant_accept ? [`Godtatt ${stamp(c.tenant_accept.at)}`, c.tenant_accept.email ? `Innlogget som ${c.tenant_accept.email}` : ''] : ['Ikke godtatt ennå']);
    doc.y = top - 92;
    if (c) {
      const ref = `Dokumentkode ${c.hash}`;
      doc.text(ref, W - M - textWidth(ref, 8), doc.y, 8, false, GRAY);
      doc.y -= 14;
    }

    for (const a of body.attachments || []) {
      doc.newPage();
      doc.text(a.h, M, doc.y - 14, 14, true);
      doc.y -= 30;
      for (const p of a.p) { doc.para(p, M, CW, 10, false, 1.42); doc.y -= 4; }
    }
    return doc.build({ footer: `Leiekontrakt${c ? ` v${c.version}` : ' (utkast)'}${(c?.address || l.address) ? ` · ${c?.address || l.address}` : ''}` });
  }

  filename(which = 'sent') {
    const c = which === 'draft' ? null : this.sent;
    return `Leiekontrakt${c ? `-v${c.version}` : '-utkast'}-${localDate()}.pdf`;
  }
}
