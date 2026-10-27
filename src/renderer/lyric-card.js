// Карточка со строками текста песни: 1–4 строки, обложка, трек, волны Nyao и ссылка — картинка для сторис или чата.
// Рисуется в canvas; выбор строк и раскладка — чистые функции (проверяются тестами без браузера).

export const MAX_LINES = 4;
export const FORMATS = {
  story: { w: 1080, h: 1920, label: 'Сторис 9:16' },
  square: { w: 1080, h: 1080, label: 'Квадрат' }
};

/**
 * Выбор строк подряд, не больше четырёх: касание рядом с выбранным — расширяет, по краю — убирает,
 * в другом месте — начинает заново. sel — отсортированный массив индексов.
 */
export function toggleLine(sel, i, max = MAX_LINES) {
  const s = [...sel].sort((a, b) => a - b);
  if (!s.length) return [i];
  const lo = s[0];
  const hi = s[s.length - 1];
  if (i === lo) return s.slice(1);
  if (i === hi) return s.slice(0, -1);
  if (i > lo && i < hi) return [i];
  if ((i === lo - 1 || i === hi + 1) && s.length < max) return [...s, i].sort((a, b) => a - b);
  return [i];
}

/** Перенос текста по словам под ширину: measure(str) → ширина в пикселях */
export function wrap(text, maxWidth, measure) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || measure(next) <= maxWidth) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Подбор размера шрифта для строк песни: самый крупный (от max до min), при котором всё влезает
 * в box по ширине и высоте. measureAt(size) → (str) => ширина. → { size, rows: [[…строки строки песни]] }
 */
export function fitLines(lines, box, measureAt, { max = 92, min = 40, lineGap = 1.18, blockGap = 0.55 } = {}) {
  for (let size = max; size >= min; size -= 4) {
    const m = measureAt(size);
    const rows = lines.map((l) => wrap(l, box.w, m));
    const count = rows.reduce((n, r) => n + r.length, 0);
    const h = count * size * lineGap + (rows.length - 1) * size * blockGap;
    if (h <= box.h && rows.every((r) => r.every((x) => m(x) <= box.w))) return { size, rows, height: h };
  }
  const m = measureAt(min);
  const rows = lines.map((l) => wrap(l, box.w, m));
  return { size: min, rows, height: rows.reduce((n, r) => n + r.length, 0) * min * lineGap + (rows.length - 1) * min * blockGap };
}

/** Цвета фона из среднего цвета обложки: сверху — приглушённый цвет, снизу — почти чёрный */
export function cardColors(rgb) {
  const [r, g, b] = rgb || [92, 72, 160];
  const mix = (k, base) => [r, g, b].map((c) => Math.round(c * k + base * (1 - k)));
  const top = mix(0.62, 18);
  const bottom = mix(0.16, 10);
  return { top: `rgb(${top.join(',')})`, bottom: `rgb(${bottom.join(',')})`, glow: `rgba(${r},${g},${b},0.55)` };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** Волны Nyao (как в логотипе): три линии жёлтая, красная, лавандовая */
function waves(ctx, x, y, s) {
  const paths = [
    ['#FFD60A', 'M3 10.6c3-5 6-5 9 0s6 5 9 0'],
    ['#F0574A', 'M3 13.4c3-5 6-5 9 0s6 5 9 0'],
    ['#D8CEFF', 'M3 12c3-5 6-5 9 0s6 5 9 0']
  ];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (const [c, d] of paths) {
    ctx.strokeStyle = c;
    ctx.stroke(new Path2D(d));
  }
  ctx.restore();
}

/**
 * Нарисовать карточку. o: { format, lines: [строки], title, artist, cover: CanvasImageSource|null, rgb, link }
 * Шрифты (Onest, Unbounded) должны быть уже загружены — см. ensureFonts().
 */
export function drawCard(canvas, o) {
  const f = FORMATS[o.format] || FORMATS.story;
  canvas.width = f.w;
  canvas.height = f.h;
  const ctx = canvas.getContext('2d');
  const W = f.w;
  const H = f.h;
  const pad = 96;
  const story = H > W * 1.4;
  const col = cardColors(o.rgb);

  // фон: цвет обложки сверху, мягкое свечение, тёмный низ
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, col.top);
  bg.addColorStop(1, col.bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.25, H * 0.12, 0, W * 0.25, H * 0.12, W * 0.9);
  glow.addColorStop(0, col.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // шапка: обложка и трек
  const art = story ? 220 : 168;
  const top = story ? 150 : pad;
  ctx.save();
  roundRect(ctx, pad, top, art, art, art * 0.16);
  ctx.clip();
  if (o.cover) {
    const iw = o.cover.naturalWidth || o.cover.width;
    const ih = o.cover.naturalHeight || o.cover.height;
    const k = Math.max(art / iw, art / ih);
    ctx.drawImage(o.cover, pad + (art - iw * k) / 2, top + (art - ih * k) / 2, iw * k, ih * k);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(pad, top, art, art);
  }
  ctx.restore();
  const tx = pad + art + 40;
  const tw = W - tx - pad;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${story ? 46 : 40}px Onest, system-ui, sans-serif`;
  ctx.fillText(ellipsize(ctx, o.title, tw), tx, top + art / 2 - 6);
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = `500 ${story ? 36 : 32}px Onest, system-ui, sans-serif`;
  ctx.fillText(ellipsize(ctx, o.artist, tw), tx, top + art / 2 + (story ? 46 : 40));

  // строки песни — крупно, Unbounded, сколько влезет
  const footer = story ? 220 : 150;
  const boxTop = top + art + (story ? 120 : 70);
  const box = { w: W - pad * 2, h: H - boxTop - footer - (story ? 80 : 40) };
  const measureAt = (size) => {
    ctx.font = `700 ${size}px Unbounded, Onest, sans-serif`;
    return (s) => ctx.measureText(s).width;
  };
  const fit = fitLines(o.lines, box, measureAt, story ? {} : { max: 88, min: 34 });
  // кавычка-акцент
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.font = `700 ${Math.round(fit.size * 2.2)}px Unbounded, Onest, sans-serif`;
  const y0 = boxTop + Math.max(0, (box.h - fit.height) / 2);
  ctx.fillText('“', pad - 8, y0 + fit.size * 0.6);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${fit.size}px Unbounded, Onest, sans-serif`;
  let y = y0 + fit.size;
  fit.rows.forEach((rows, k) => {
    for (const r of rows) {
      ctx.fillText(r, pad, y);
      y += fit.size * 1.18;
    }
    if (k < fit.rows.length - 1) y += fit.size * 0.55;
  });

  // подвал: волны, Nyao Music, ссылка
  const fy = H - footer + (story ? 60 : 30);
  waves(ctx, pad - 6, fy - 44, 88);
  ctx.fillStyle = '#fff';
  ctx.font = '700 38px Unbounded, Onest, sans-serif';
  ctx.fillText('Nyao Music', pad + 100, fy + 2);
  if (o.link) {
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.font = '500 28px Onest, system-ui, sans-serif';
    ctx.fillText(ellipsize(ctx, o.link.replace(/^https:\/\//, '').replace(/\?.*$/, ''), W - pad * 2 - 100), pad + 100, fy + 48);
  }
  return canvas;
}

/** Дождаться шрифтов карточки (иначе первая картинка выйдет системным шрифтом) */
export async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load('700 80px Unbounded'),
    document.fonts.load('700 40px Onest'),
    document.fonts.load('500 30px Onest')
  ]).catch(() => {});
}
