// Минимальный ZIP без зависимостей: собрать архив из файлов (deflate) и достать файлы из архива.
// Нужен для выгрузки текстов (LRC + TTML) и чтения артефактов GitHub Actions с логами контейнеров.
import zlib from 'node:zlib';

const crc32 = (buf) => (zlib.crc32 ? zlib.crc32(buf) : crcSlow(buf));

function crcSlow(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Дата и время в формате DOS (локальная зона не важна — архив служебный) */
function dosTime(d = new Date()) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/** files: [{ name, data: Buffer | string }] → Buffer с ZIP-архивом */
export function zipFiles(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosTime();
  for (const f of files) {
    const name = Buffer.from(String(f.name), 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data ?? ''), 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const method = deflated.length < raw.length ? 8 : 0;
    const body = method ? deflated : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // имена в UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(cd, name);
    offset += local.length + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, end]);
}

/** Buffer с ZIP → [{ name, data: Buffer }] (без шифрования и ZIP64 — артефакты Actions такие и есть) */
export function unzip(buf) {
  const out = [];
  // конец центрального каталога — ищем сигнатуру с хвоста
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Это не ZIP-архив');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Повреждённый каталог ZIP');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const body = buf.subarray(start, start + csize);
    if (!name.endsWith('/')) out.push({ name, data: method === 8 ? zlib.inflateRawSync(body) : method === 0 ? Buffer.from(body) : Buffer.alloc(0) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
