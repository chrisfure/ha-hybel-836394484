// Liten PDF-generator uten eksterne pakker: tekst (Helvetica, WinAnsi) og JPEG-bilder.
import { deflateSync } from 'node:zlib';

const W = 595.28, H = 841.89, M = 48;

// Helvetica-bredder (1/1000 em) for tegn 32–126.
const HV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const EXTRA = { 'æ': 889, 'ø': 611, 'å': 556, 'Æ': 1000, 'Ø': 778, 'Å': 667, 'é': 556, 'è': 556, 'ü': 556, 'ö': 556, 'ä': 556, '–': 556, '—': 1000, '•': 350, '…': 1000, '«': 556, '»': 556, '’': 222, '‘': 222, '“': 333, '”': 333, '°': 400, '·': 278, '×': 584 };
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };

function charW(ch, bold) {
  const c = ch.charCodeAt(0);
  const w = c >= 32 && c <= 126 ? HV[c - 32] : EXTRA[ch] ?? 556;
  return bold ? w * 1.07 : w;
}
export const textWidth = (s, size, bold = false) => [...String(s)].reduce((a, ch) => a + charW(ch, bold), 0) * size / 1000;

function enc(s) {
  let out = '';
  const t = String(s).replace(/[\u202f\u2009\u2007]/g, ' ').replace(/→/g, '–').replace(/[✓✔]/g, 'v').replace(/−/g, '-');
  for (const ch of t) {
    let c = WIN[ch] ?? ch.charCodeAt(0);
    if (c > 255 || (c < 32 && c !== 9)) c = 63; // '?'
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out;
}

export function wrap(text, width, size, bold = false) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (textWidth(t, size, bold) <= width) { line = t; continue; }
      if (line) lines.push(line);
      line = word;
      while (textWidth(line, size, bold) > width) { // altfor lange ord deles
        let i = line.length - 1;
        while (i > 1 && textWidth(line.slice(0, i), size, bold) > width) i--;
        lines.push(line.slice(0, i));
        line = line.slice(i);
      }
    }
    lines.push(line);
  }
  return lines;
}

function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

export class PdfDoc {
  constructor() {
    this.pages = [];
    this.images = [];
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = H - M;
  }

  ensure(h) {
    if (this.y - h < M + 20) this.newPage();
  }

  text(s, x, y, size = 10, bold = false, color = null) {
    if (color) this.ops.push(`${color} rg`);
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${enc(s)}) Tj ET`);
    if (color) this.ops.push('0 0 0 rg');
  }

  line(x1, y1, x2, y2, gray = 0.8, w = 0.5) {
    this.ops.push(`${gray} G ${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rect(x, y, w, h, rgb) {
    this.ops.push(`${rgb} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 0 0 rg`);
  }

  // Skriver et avsnitt fra nåværende y og nedover. Returnerer høyden.
  para(s, x, width, size = 10, bold = false, gap = 1.35, color = null) {
    const lines = wrap(s, width, size, bold);
    for (const l of lines) {
      this.ensure(size * gap);
      this.text(l, x, this.y - size, size, bold, color);
      this.y -= size * gap;
    }
  }

  addImage(buf) {
    const info = jpegInfo(buf);
    if (!info) return null;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, buf, ...info });
    return { name, ...info };
  }

  image(img, x, yTop, w, h) {
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(yTop - h).toFixed(2)} cm /${img.name} Do Q`);
  }

  build({ footer = '' } = {}) {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null);
    const pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgIds = this.images.map((im) => add({
      dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.comps === 1 ? 'DeviceGray' : im.comps === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode${im.comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${im.buf.length} >>`,
      data: im.buf
    }));
    const xobj = this.images.map((im, i) => `/${im.name} ${imgIds[i]} 0 R`).join(' ');
    const pageIds = [];
    this.pages.forEach((ops, i) => {
      const foot = [];
      if (footer) foot.push(`0.45 g BT /F1 8 Tf ${M} 26 Td (${enc(footer)}) Tj ET`);
      const pn = `Side ${i + 1} av ${this.pages.length}`;
      foot.push(`0.45 g BT /F1 8 Tf ${(W - M - textWidth(pn, 8)).toFixed(2)} 26 Td (${enc(pn)}) Tj ET 0 g`);
      const stream = deflateSync(Buffer.from([...ops, ...foot].join('\n'), 'latin1'));
      const content = add({ dict: `<< /Length ${stream.length} /Filter /FlateDecode >>`, data: stream });
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let pos = chunks[0].length;
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(pos);
      const parts = typeof o === 'string'
        ? [Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]
        : [Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')];
      for (const p of parts) { chunks.push(p); pos += p.length; }
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

export const PAGE = { W, H, M };
