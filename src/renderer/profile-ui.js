// Профиль 0.100: аватар нужной формы (печенька / круг / скруглённый квадрат), значки-печеньки, ссылки на соцсети,
// цвет профиля и подготовка баннера (обрезка 3:1 и сжатие до загрузки на сервер). Чистые функции — без DOM, кроме баннера.

export const AVATAR_SHAPES = [
  ['cookie', 'Печенька'],
  ['circle', 'Круг'],
  ['squircle', 'Скруглённый квадрат']
];
export const PROFILE_COLORS = ['#C6B8FF', '#7CE0C3', '#FFB86B', '#FF8FB1', '#8FB4FF', '#FFD60A', '#FF6A5C', '#B8E05A'];
export const DEFAULT_COLOR = '#C6B8FF';

// цвета значков по «tone» с сервера: фон и метка
export const BADGE_TONES = {
  accent: null,
  yellow: ['#2A2208', '#FFD60A'],
  blue: ['#1E2A44', '#9FC2FF'],
  mint: ['#1A2A22', '#7CE0C3'],
  coral: ['#2A0E0C', '#FF8F84'],
  pink: ['#2A0E18', '#FF8FB1']
};

const cookieCache = new Map();
/** Контур печеньки в квадрате 100×100: n лепестков, глубина amp */
export function cookiePath(n = 9, amp = 0.07, steps = 120) {
  const key = `${n}|${amp}|${steps}`;
  if (cookieCache.has(key)) return cookieCache.get(key);
  let d = '';
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const r = 50 * (1 - amp) + 50 * amp * Math.cos(n * t);
    d += `${i ? 'L' : 'M'}${(50 + r * Math.sin(t)).toFixed(1)} ${(50 - r * Math.cos(t)).toFixed(1)}`;
  }
  d += 'Z';
  cookieCache.set(key, d);
  return d;
}

/** Контур формы аватара в квадрате 100×100 */
export function shapePath(shape) {
  if (shape === 'circle') return 'M50 0A50 50 0 1 1 49.99 0Z';
  if (shape === 'squircle') return 'M26 0H74C88.4 0 100 11.6 100 26V74C100 88.4 88.4 100 74 100H26C11.6 100 0 88.4 0 74V26C0 11.6 11.6 0 26 0Z';
  return cookiePath(9, 0.07);
}

export function cleanColor(c) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(c || '')) ? String(c).toUpperCase() : DEFAULT_COLOR;
}

/** Тёмный фон в оттенке цвета профиля (для шапки без баннера и карточек) */
export function tintOf(color, k = 0.16, base = 8) {
  const c = cleanColor(color);
  const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return `rgb(${rgb.map((v) => Math.round(v * k + base * (1 - k))).join(',')})`;
}

/** Тёмный ли цвет — какой брать текст поверх */
export function inkOn(color) {
  const c = cleanColor(color);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#120D26' : '#FFFFFF';
}

let uid = 0;
/**
 * Аватар в форме, которую выбрал пользователь: картинка Telegram или буква на цвете профиля.
 * ring — чёрная обводка (для аватара поверх баннера).
 */
export function avatarSvg(u, size, esc, { ring = 0 } = {}) {
  const shape = (u && (u.shape || u.avatarShape)) || 'cookie';
  const color = cleanColor(u && u.color);
  const d = shapePath(shape);
  const id = `av${++uid}`;
  const pic = u && u.picture;
  const letter = esc(String((u && (u.name || u.nick)) || 'N').trim().charAt(0).toUpperCase());
  const inner = ring ? (100 - ring * 2) / 100 : 1;
  const tr = ring ? ` transform="translate(${ring} ${ring}) scale(${inner})"` : '';
  return `<svg class="pf-av" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    ${ring ? `<path d="${d}" fill="#000"/>` : ''}
    <g${tr}><clipPath id="${id}"><path d="${d}"/></clipPath>
    <path d="${d}" fill="${color}"/>
    ${pic ? `<image href="${esc(pic)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
      : `<text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Unbounded, sans-serif" font-weight="700" font-size="40" fill="${inkOn(color)}">${letter}</text>`}</g></svg>`;
}

/** Значок-печенька: метка на цвете (tone с сервера; accent — цвет профиля) */
export function badgeSvg(b, size, esc, color) {
  const tone = BADGE_TONES[b.tone] || null;
  const bg = tone ? tone[0] : cleanColor(color);
  const fg = tone ? tone[1] : inkOn(color);
  const mark = esc(String(b.mark || b.emoji || '★'));
  const fs = mark.length >= 4 ? 22 : mark.length === 3 ? 26 : 34;
  return `<svg class="pf-badge" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${esc(b.title || '')}"><title>${esc(b.title || '')}</title>
    <path d="${cookiePath(12, 0.06)}" fill="${bg}"/>
    <text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Unbounded, sans-serif" font-weight="700" font-size="${fs}" fill="${fg}">${mark}</text></svg>`;
}

export const LINK_NAMES = {
  telegram: 'Telegram', vk: 'ВКонтакте', youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify', yandex: 'Яндекс Музыка',
  instagram: 'Instagram', tiktok: 'TikTok', x: 'X', twitch: 'Twitch', github: 'GitHub', discord: 'Discord', site: 'Сайт'
};

/** Подпись ссылки: площадка и короткий адрес */
export function linkLabel(l) {
  let short = String(l.url || '').replace(/^https?:\/\/(www\.)?/, '');
  if (short.length > 34) short = short.slice(0, 33) + '…';
  return { name: LINK_NAMES[l.kind] || 'Сайт', short };
}

// значки площадок: простые линии 24×24 (не логотипы)
const LINK_ICONS = {
  telegram: 'M21 4 3 11l6 2 2 6 3-4 5 4z',
  vk: 'M4 7h3l3 5V7h3v4l3-4h3l-4 5 4 5h-3l-3-4v4h-3l-6-10z',
  youtube: 'M3 8c0-2 1-3 3-3h12c2 0 3 1 3 3v8c0 2-1 3-3 3H6c-2 0-3-1-3-3zM10 9v6l5-3z',
  soundcloud: 'M3 15v2M6 13v4M9 11v6M12 9v8h7a3 3 0 0 0 0-6 5 5 0 0 0-7-2',
  spotify: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M7 9c3-1 7-1 10 1M8 12c2-.6 5-.4 7 1M8.5 15c1.6-.4 3.6-.2 5 .6',
  yandex: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M13 7h-1.5C9.5 7 8.5 8.5 8.5 10s1 3 3 3H13zm0 6-3 4',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M17 6.5v.1',
  tiktok: 'M14 3v11a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 3 2.5 4.5 5 4.5',
  x: 'M4 4l16 16M20 4 4 20',
  twitch: 'M4 3h16v11l-4 4h-4l-3 3v-3H5zM11 7v4M15 7v4',
  github: 'M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
  discord: 'M8 7c2.5-1 5.5-1 8 0l1.5 9c-1.5 1.2-3 2-4.5 2l-.6-1.4M8 7 6.5 16c1.5 1.2 3 2 4.5 2l.6-1.4M9.5 12.5h.1M14.5 12.5h.1',
  site: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'
};
export function linkIcon(kind, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${LINK_ICONS[kind] || LINK_ICONS.site}"/></svg>`;
}

/** Баннер: обрезка по центру до 3:1, не больше 1500×500, JPEG до ~360 КБ → base64 без префикса */
export async function prepareBanner(file, maxBytes = 360 * 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Не получилось открыть картинку'));
      i.src = url;
    });
    const want = 3;
    let sw = img.naturalWidth;
    let sh = Math.round(sw / want);
    if (sh > img.naturalHeight) {
      sh = img.naturalHeight;
      sw = Math.round(sh * want);
    }
    const sx = Math.round((img.naturalWidth - sw) / 2);
    const sy = Math.round((img.naturalHeight - sh) / 2);
    const w = Math.min(1500, sw);
    const h = Math.round(w / want);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    for (const q of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const data = canvas.toDataURL('image/jpeg', q).split(',')[1];
      if (data.length * 0.75 <= maxBytes) return data;
    }
    throw new Error('Картинка не сжимается до нужного размера — попробуй другую');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Повторяющиеся входящие (одна и та же реакция от одного человека на один трек) — одной строкой «×N» */
export function groupInbox(items) {
  const out = [];
  for (const i of items) {
    const key = `${i.kind}|${i.from && i.from.id}|${i.emoji || ''}|${i.track ? i.track.id : ''}`;
    const prev = out[out.length - 1];
    if (prev && prev.key === key && i.kind === 'react') {
      prev.count++;
      prev.ids.push(i.id);
      if (!i.read) prev.read = false;
      continue;
    }
    out.push({ ...i, key, count: 1, ids: [i.id] });
  }
  return out;
}
