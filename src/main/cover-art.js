// Шаблонная обложка «диск на цвете» (как в макетах) для треков без своей картинки — VK часто её не отдаёт.
// Без картинки плеер, шторка Windows и «Сейчас играет» могли держать обложку и название прошлого трека.
// Картинка рисуется здесь же в PNG и отдаётся по nyao://cover/<ключ>; цвет зависит от трека и не меняется.
import zlib from 'node:zlib';
import crypto from 'node:crypto';

// фон и цвет колец — пары из макетов «Продолжить слушать»
export const COVER_PALETTE = [
  ['#17142A', '#C6B8FF'],
  ['#1E0E0E', '#FF6A5C'],
  ['#1E1A08', '#FFD60A'],
  ['#1A0C0C', '#FF8A7A'],
  ['#0E1A16', '#7CE0C3'],
  ['#101420', '#8FB4FF'],
  ['#1E1408', '#FFB86B'],
  ['#1E0E16', '#FF8FB1']
];

export function coverIndex(key) {
  const h = crypto.createHash('sha1').update(String(key)).digest();
  return h[0] % COVER_PALETTE.length;
}

/** Адрес шаблонной обложки для трека (по его id) */
export function placeholderCover(key) {
  return `nyao://cover/${encodeURIComponent(String(key))}.png`;
}

export function isPlaceholderCover(url) {
  return typeof url === 'string' && url.startsWith('nyao://cover/');
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const cache = new Map();

/** PNG size×size: фон и два кольца (как значок «диск» в макетах) */
export function renderCover(key, size = 400) {
  const ck = `${key}|${size}`;
  if (cache.has(ck)) return cache.get(ck);
  const [bgHex, fgHex] = COVER_PALETTE[coverIndex(key)];
  const bg = hex(bgHex);
  const fg = hex(fgHex);
  const c = size / 2;
  // в квадрате 72: кольца r=26 и r=12, толщина 3 — масштабируем на 60% картинки
  const k = (size * 0.6) / 72;
  const rings = [[26 * k, 3 * k], [12 * k, 3 * k]];
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let a = 0;
      for (const [r, w] of rings) a = Math.max(a, Math.min(1, Math.max(0, w / 2 - Math.abs(d - r) + 0.5)));
      const o = y * row + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(bg[i] * (1 - a) + fg[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  if (cache.size > 200) cache.clear();
  cache.set(ck, png);
  return png;
}
