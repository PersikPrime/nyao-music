// Пасхалка сотой сборки: волны, из которых складывается «100».
// Показывается один раз при первом запуске 0.8 (100), по пяти нажатиям на версию в «О приложении»
// и на каждый сотый трек (трек засчитывается после 30 секунд).
// Счётчик живёт только в localStorage этого компьютера.

const KEY_PLAYS = 'nyao.hundred.plays';
const KEY_SEEN = 'nyao.hundred.seen';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* приватный режим и т.п. */ } }
};

const COLORS = ['#C6B8FF', '#7CE0C3', '#FFB86B', '#FF8FB1', '#8FB4FF', '#FFD60A'];

/** Маска «100» (или другого текста): какие точки сетки внутри цифр */
function textMask(text, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let fs = Math.floor(h * 0.78);
  g.font = `800 ${fs}px Unbounded, sans-serif`;
  while (g.measureText(text).width > w * 0.86 && fs > 20) {
    fs -= 4;
    g.font = `800 ${fs}px Unbounded, sans-serif`;
  }
  g.fillText(text, w / 2, h / 2 + fs * 0.04);
  // размываем, чтобы волны поднимались плавно, а не ступеньками
  const soft = document.createElement('canvas');
  soft.width = w;
  soft.height = h;
  const sg = soft.getContext('2d');
  sg.filter = `blur(${Math.max(3, Math.round(h / 90))}px)`;
  sg.drawImage(c, 0, 0);
  const d = sg.getImageData(0, 0, w, h).data;
  return (x, y) => {
    const xi = Math.max(0, Math.min(w - 1, x | 0));
    const yi = Math.max(0, Math.min(h - 1, y | 0));
    return d[(yi * w + xi) * 4 + 3] / 255;
  };
}

/** Полноэкранная сцена: горизонтальные волны, которые поднимаются там, где цифры */
export function showHundred({ title = 'Сотая сборка', text = 'Nyao Music 0.8 (100). Спасибо, что слушаешь с нами.', label = '100' } = {}) {
  if (document.querySelector('.hundred')) return;
  const wrap = document.createElement('div');
  wrap.className = 'hundred';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', title);
  wrap.innerHTML = `<canvas aria-hidden="true"></canvas>
    <div class="hundred-cap"><b></b><span></span><button class="btn primary" type="button">Слушать дальше</button></div>`;
  wrap.querySelector('b').textContent = title;
  wrap.querySelector('span').textContent = text;
  document.body.appendChild(wrap);
  const canvas = wrap.querySelector('canvas');
  const g = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let mask = null;
  let W = 0;
  let H = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    W = wrap.clientWidth;
    H = wrap.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    mask = textMask(label, Math.round(W), Math.round(H * 0.64));
  };
  resize();
  const t0 = performance.now();
  const frame = (now) => {
    const t = (now - t0) / 1000;
    // 0 → 1 за 2,4 с: волны «собираются» в цифры
    const k = reduce ? 1 : Math.min(1, t / 2.4);
    const ease = 1 - Math.pow(1 - k, 3);
    g.clearRect(0, 0, W, H);
    const lines = Math.max(24, Math.round(H / 17));
    const top = H * 0.05;
    const span = H * 0.64;
    const step = span / lines;
    for (let i = 0; i < lines; i++) {
      const y0 = top + i * step;
      const color = COLORS[i % COLORS.length];
      g.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const m = mask(x, y0 - top);
        const calm = Math.sin(x * 0.012 + t * 1.6 + i * 0.5) * 4 * (1 - ease * 0.6);
        const lift = m * step * 1.9 * ease;
        const y = y0 + calm - lift;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = color;
      g.globalAlpha = 0.35 + 0.65 * ease * 0.9;
      g.lineWidth = 2;
      g.stroke();
    }
    g.globalAlpha = 1;
    if (!reduce) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const close = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    document.removeEventListener('keydown', onKey, true);
    wrap.classList.add('out');
    setTimeout(() => wrap.remove(), 260);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('resize', resize);
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('click', close);
  requestAnimationFrame(() => wrap.classList.add('in'));
}

function tracksWord(n) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return 'трек';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'трека';
  return 'треков';
}

const ordinal = (n) => `${n.toLocaleString('ru-RU')}-й`;

/**
 * Подключение: счётчик треков (30 секунд = трек), показ на первом запуске 100-й сборки и пять нажатий на версию.
 * player — наш Player (audio + события), toast — всплывашка приложения.
 */
export function createHundred({ player, toast, build = () => 0 }) {
  let countedFor = 0;
  player.addEventListener('time', () => {
    const a = player.audio;
    if (!player.current || !player.startedAt || countedFor === player.startedAt) return;
    if (!a || a.currentTime < 30) return;
    countedFor = player.startedAt;
    const n = (Number(ls.get(KEY_PLAYS)) || 0) + 1;
    ls.set(KEY_PLAYS, n);
    if (n % 100 !== 0) return;
    if (n === 100) showHundred({ title: 'Сотый трек!', text: 'Ровно сто треков в Nyao Music. Дальше — больше.' });
    else toast(`Это твой ${ordinal(n)} трек в Nyao Music 🎉`);
  });

  // первый запуск сотой сборки — один раз
  const maybeFirstRun = () => {
    const b = Number(build()) || 0;
    if (b < 100 || ls.get(KEY_SEEN)) return;
    ls.set(KEY_SEEN, b);
    setTimeout(() => showHundred(), 1200);
  };

  let taps = 0;
  let tapTimer = 0;
  const tapVersion = () => {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => (taps = 0), 1500);
    if (taps >= 5) {
      taps = 0;
      const n = Number(ls.get(KEY_PLAYS)) || 0;
      showHundred({ text: n ? `Nyao Music 0.8 (100). С тобой уже ${n.toLocaleString('ru-RU')} ${tracksWord(n)}. Спасибо, что слушаешь.` : undefined });
    }
  };

  return { maybeFirstRun, tapVersion, show: showHundred };
}
