// Профиль 0.100: цвет профиля, форма аватара, баннер и ссылки на соцсети.
// Баннер и ссылки видны сразу, а в Nyao Automator попадают в очередь модерации (её чистят вручную).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const AVATAR_SHAPES = ['cookie', 'circle', 'squircle'];
export const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const MAX_LINKS = 6;
export const BANNER_MAX = 380 * 1024;

// площадка ссылки по адресу; «site» — любой другой https-сайт
const LINK_HOSTS = [
  ['telegram', /^(t\.me|telegram\.me)$/],
  ['vk', /^(m\.)?vk\.(com|ru)$/],
  ['youtube', /^((www|m|music)\.)?youtube\.com$|^youtu\.be$/],
  ['soundcloud', /^(www\.|m\.)?soundcloud\.com$/],
  ['spotify', /^open\.spotify\.com$/],
  ['yandex', /^music\.yandex\.(ru|com|by|kz)$/],
  ['instagram', /^(www\.)?instagram\.com$/],
  ['tiktok', /^(www\.)?tiktok\.com$/],
  ['x', /^(www\.)?(x|twitter)\.com$/],
  ['twitch', /^(www\.)?twitch\.tv$/],
  ['github', /^(www\.)?github\.com$/],
  ['discord', /^(www\.)?discord\.(gg|com)$/]
];

/** Ссылка на соцсеть → { kind, url } или текст ошибки */
export function cleanLink(raw) {
  let s = String(raw || '').trim();
  if (!s) return { error: 'Пустая ссылка' };
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return { error: `Не похоже на ссылку: ${String(raw).slice(0, 60)}` };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Только обычные ссылки (https)' };
  if (u.username || u.password) return { error: 'Ссылка с логином не подходит' };
  u.protocol = 'https:';
  const host = u.hostname.toLowerCase();
  if (!/\./.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') return { error: 'Нужен адрес сайта' };
  const url = u.toString().replace(/\/$/, '');
  if (url.length > 200) return { error: 'Слишком длинная ссылка' };
  const kind = (LINK_HOSTS.find(([, re]) => re.test(host)) || ['site'])[0];
  return { kind, url };
}

/** Тип картинки по первым байтам → расширение или null */
export function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const FILE_RE = /^(\d+)-[a-z0-9]{10}\.(jpg|png|webp)$/;

export function bannerStore(dataDir) {
  const dir = path.join(dataDir, 'banners');
  return {
    dir,
    save(uid, buf, ext) {
      fs.mkdirSync(dir, { recursive: true });
      const name = `${uid}-${crypto.randomBytes(8).toString('hex').slice(0, 10)}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf);
      return name;
    },
    remove(name) {
      if (!name || !FILE_RE.test(name)) return;
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        // уже удалён
      }
    },
    read(name) {
      const m = FILE_RE.exec(name || '');
      if (!m) return null;
      try {
        return { body: fs.readFileSync(path.join(dir, name)), type: MIME[m[2]] };
      } catch {
        return null;
      }
    }
  };
}
