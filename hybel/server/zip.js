// Enkel ZIP-skriver uten avhengigheter (DEFLATE via zlib, UTF-8-filnavn).
import { deflateRawSync } from 'node:zlib';

const TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

export class Zip {
  constructor() {
    this.files = [];
    this.names = new Set();
  }

  add(name, data, date = new Date()) {
    let n = String(name).replace(/[\\:*?"<>|\u0000-\u001f]/g, '_').replace(/^\/+/, '');
    // Unngå like navn
    if (this.names.has(n)) {
      const dot = n.lastIndexOf('.');
      let i = 2;
      while (this.names.has(dot > 0 ? `${n.slice(0, dot)} (${i})${n.slice(dot)}` : `${n} (${i})`)) i++;
      n = dot > 0 ? `${n.slice(0, dot)} (${i})${n.slice(dot)}` : `${n} (${i})`;
    }
    this.names.add(n);
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const comp = deflateRawSync(raw);
    const stored = comp.length >= raw.length;
    this.files.push({ name: Buffer.from(n, 'utf8'), raw, body: stored ? raw : comp, method: stored ? 0 : 8, crc: crc32(raw), ...dosTime(date) });
  }

  build() {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of this.files) {
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(0x0800, 6); // UTF-8
      h.writeUInt16LE(f.method, 8);
      h.writeUInt16LE(f.time, 10);
      h.writeUInt16LE(f.date, 12);
      h.writeUInt32LE(f.crc, 14);
      h.writeUInt32LE(f.body.length, 18);
      h.writeUInt32LE(f.raw.length, 22);
      h.writeUInt16LE(f.name.length, 26);
      h.writeUInt16LE(0, 28);
      parts.push(h, f.name, f.body);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(f.method, 10);
      c.writeUInt16LE(f.time, 12);
      c.writeUInt16LE(f.date, 14);
      c.writeUInt32LE(f.crc, 16);
      c.writeUInt32LE(f.body.length, 20);
      c.writeUInt32LE(f.raw.length, 24);
      c.writeUInt16LE(f.name.length, 28);
      c.writeUInt32LE(offset, 42);
      central.push(c, f.name);
      offset += 30 + f.name.length + f.body.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.files.length, 8);
    end.writeUInt16LE(this.files.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cd, end]);
  }
}
