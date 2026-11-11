// Фирменная «печенька» и объёмные значки на ней. Считается на сервере — на странице уже готовый SVG.

/** Точки печеньки в процентах: n — число волн, amp — их глубина */
function points(n = 10, amp = 0.05, steps = 120) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const r = 50 * (1 - amp) + 50 * amp * Math.cos(n * t);
    pts.push([50 + r * Math.sin(t), 50 - r * Math.cos(t)]);
  }
  return pts;
}
const cookiePath = (n, amp) => points(n, amp).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';
const cookiePolygon = (n, amp) => `polygon(${points(n, amp).map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(',')})`;

function mix(hex, other, k) {
  const a = hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = other.match(/\w\w/g).map((h) => parseInt(h, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

const GLYPHS = {
  wave: 'M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0',
  lyrics: 'M5 7h14M5 12h10M5 17h12',
  friends: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.6a3.4 3.4 0 0 1 0 6.3M18 14.8c1.8.7 3 2.4 3.5 5.2',
  radio: 'M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2M7 8l9-4M15.5 11.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  history: 'M12 6a7 7 0 1 0 7 7M12 9.5V13l2.5 2M4 5v4h4',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 2-1 2-2s-.8-1.6-.8-2.6 1-1.9 2.3-1.9H17a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7-8.5-7M7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  scrobble: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M15 5.5l2 2 3.5-4',
  overlay: 'M3.5 5.5h17v13h-17zM7 14.5h6M7 11.5h3',
  code: 'M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  heart: 'M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20z',
};

let seq = 0;
/**
 * Объёмный значок: печенька с заливкой сверху вниз, бликом, светлой кромкой и тенью снизу; знак выдавлен белым.
 * Всё в одном SVG, без картинок — чёткий на любом экране.
 */
function cookieIcon({ color = '#C6B8FF', glyph = 'wave', waves = 8, amp = 0.07, glyphColor = '#fff' } = {}) {
  const id = `ci${++seq}`;
  const d = cookiePath(waves, amp);
  const hi = mix(color.slice(1), 'ffffff', 0.38);
  const lo = mix(color.slice(1), '000000', 0.34);
  const ink = mix(color.slice(1), '000000', 0.72);
  return `<svg class="ci" viewBox="0 0 100 100" aria-hidden="true" style="--ci:${color}">
<defs>
<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
<radialGradient id="${id}h" cx=".32" cy=".12" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
<clipPath id="${id}c"><path d="${d}"/></clipPath>
<filter id="${id}s" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.1" flood-color="${glyphColor === '#fff' ? ink : '#fff'}" flood-opacity="${glyphColor === '#fff' ? '.55' : '.6'}"/></filter>
</defs>
<path d="${d}" fill="url(#${id}g)"/>
<g clip-path="url(#${id}c)">
<ellipse cx="46" cy="14" rx="52" ry="34" fill="url(#${id}h)"/>
<ellipse cx="50" cy="108" rx="46" ry="24" fill="${ink}" opacity=".2"/>
<path d="${d}" fill="none" stroke="url(#${id}r)" stroke-width="3"/>
</g>
<g transform="translate(25 25) scale(2.08)" fill="none" stroke="${glyphColor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}s)"><path d="${GLYPHS[glyph] || GLYPHS.wave}"/></g>
</svg>`;
}

module.exports = { cookiePath, cookiePolygon, cookieIcon, GLYPHS };
