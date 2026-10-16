// Акцентный цвет (как в Android 16): одна палитра красит фигуры «Моей волны», кнопки, чипы и прогресс.
// «Из обложки» строит такую же палитру из цвета текущей обложки.

export const ACCENTS = [
  ['lavender', 'Лаванда'],
  ['coral', 'Коралл'],
  ['mint', 'Мята'],
  ['sun', 'Солнце'],
  ['cover', 'Из обложки']
];

// a — основной, strong — насыщенный, deep — тёмный для крупных фигур, light — светлый текст на тёмном,
// dark — почти фон, soft — подложка выбранного, cur — подсветка играющей строки
export const PALETTES = {
  lavender: { a: '#C6B8FF', strong: '#7A6CFF', deep: '#3B3360', light: '#E2DAFF', dark: '#2A2346', soft: '#1C1930', cur: '#141220' },
  coral: { a: '#FFB4A2', strong: '#FF6A5C', deep: '#5C1F17', light: '#FFDAD3', dark: '#3A1712', soft: '#2A1310', cur: '#1E0F0C' },
  mint: { a: '#7CE0C3', strong: '#2FA88A', deep: '#0F3D33', light: '#C6F5E6', dark: '#0B2A24', soft: '#0E211C', cur: '#0A1814' },
  sun: { a: '#FFD60A', strong: '#E0A800', deep: '#4A3A00', light: '#FFF0A8', dark: '#2E2600', soft: '#221C04', cur: '#181402' }
};
// На стеклянной теме macOS основной цвет чуть светлее — как было раньше (#D8CEFF)
const MAC_A = { lavender: '#D8CEFF' };

function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Палитра из цвета обложки: оттенок обложки, светлота и насыщенность — как у готовых палитр */
export function paletteFromRgb(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return PALETTES.lavender;
  const [h, s0] = rgbToHsl(rgb);
  // серые обложки — мягкая лаванда того же «веса», иначе всё станет серым
  if (s0 < 0.12) return PALETTES.lavender;
  const s = Math.min(0.9, Math.max(0.55, s0));
  return {
    a: hslToHex(h, s, 0.78),
    strong: hslToHex(h, s, 0.6),
    deep: hslToHex(h, s * 0.6, 0.24),
    light: hslToHex(h, s, 0.9),
    dark: hslToHex(h, s * 0.55, 0.15),
    soft: hslToHex(h, s * 0.45, 0.11),
    cur: hslToHex(h, s * 0.4, 0.08)
  };
}

export function paletteFor(id, { mac = false, coverRgb = null } = {}) {
  if (id === 'cover') return paletteFromRgb(coverRgb);
  const p = PALETTES[id] || PALETTES.lavender;
  return mac && MAC_A[id] ? { ...p, a: MAC_A[id] } : p;
}

function rgba(h, alpha) {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** CSS-переменные палитры. На macOS подложки полупрозрачные — под ними стекло */
export function accentVars(p, mac = false) {
  return {
    '--accent': p.a,
    '--accent-strong': p.strong,
    '--accent-deep': p.deep,
    '--accent-light': p.light,
    '--accent-dark': p.dark,
    '--accent-soft': mac ? rgba(p.a, 0.16) : p.soft,
    '--accent-line': mac ? rgba(p.a, 0.4) : p.deep,
    '--accent-cur': mac ? rgba(p.a, 0.12) : p.cur
  };
}

export function applyAccent(el, p, mac = false) {
  const vars = accentVars(p, mac);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  return vars;
}
