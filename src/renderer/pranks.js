// «Приколы» из раздела «Разработчик»: ломают вид и поведение, но приложение остаётся рабочим.
// Всё живёт только в памяти окна: перезапуск (или Ctrl+Shift+Backspace, или плашка «Сбросить приколы») — всё как было.

export const PRANKS = [
  // вид
  ['nostyle', 'Без стилей', 'Голый HTML из 2003-го'],
  ['comic', 'Comic Sans везде', 'Серьёзная музыка — несерьёзный шрифт'],
  ['flip', 'Вверх ногами', 'Кнопки работают, просто наоборот'],
  ['mirror', 'Зеркало', 'Всё отражено слева направо'],
  ['drunk', 'Пьяный режим', 'Интерфейс покачивается'],
  ['rainbow', 'Радуга', 'Цвета бесконечно переливаются'],
  ['round', 'Всё круглое', 'Радиус 999px у всего'],
  ['square', 'Всё квадратное', 'Ни одного скругления'],
  ['win98', 'Windows 98', 'Серые объёмные кнопки'],
  ['giant', 'Гигант', 'Масштаб 200%'],
  ['ant', 'Муравей', 'Масштаб 50%'],
  // поведение
  ['runaway', 'Кнопка убегает', '«Играть» отпрыгивает от курсора (с третьей попытки сдаётся)'],
  ['frog', 'Лягушка', 'Каждое нажатие — смешной звук'],
  ['lag', 'Тормоза', 'Любое нажатие срабатывает через 2 секунды'],
  ['chaos', 'Хаос-очередь', 'Каждый новый трек перемешивает очередь'],
  ['ghost', 'Невидимка', 'Интерфейс виден только под курсором'],
  // музыка и текст
  ['chipmunk', 'Бурундук', 'Музыка в 1,5 раза быстрее и выше'],
  ['vader', 'Дарт Вейдер', 'Музыка медленнее и ниже'],
  ['reverse', 'Текст наоборот', 'Строки песни задом наперёд'],
  ['karaoke', 'Караоке на всё', 'Слова заливаются даже там, где разметки нет'],
  ['cat', 'Котики вместо обложек', 'У всех треков одна обложка'],
  ['meow', 'Meow Music', 'Nyao → Meow, и немного «мяу»']
];

// исключают друг друга
const PAIRS = { flip: 'mirror', mirror: 'flip', round: 'square', square: 'round', giant: 'ant', ant: 'giant', chipmunk: 'vader', vader: 'chipmunk' };

/** Кот для обложек: свой, нарисованный здесь */
const CAT = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#FFD9A8"/><path d="M22 40 L28 14 L44 32 Z M78 40 L72 14 L56 32 Z" fill="#E8925A"/><ellipse cx="50" cy="58" rx="34" ry="28" fill="#E8925A"/><circle cx="38" cy="54" r="5" fill="#2B1B12"/><circle cx="62" cy="54" r="5" fill="#2B1B12"/><circle cx="39.5" cy="52.5" r="1.6" fill="#fff"/><circle cx="63.5" cy="52.5" r="1.6" fill="#fff"/><path d="M46 63 L54 63 L50 67 Z" fill="#C2185B"/><path d="M50 67 Q46 72 41 70 M50 67 Q54 72 59 70" stroke="#2B1B12" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20 62 L34 64 M20 70 L34 68 M80 62 L66 64 M80 70 L66 68" stroke="#2B1B12" stroke-width="1.6" stroke-linecap="round"/></svg>')}`;

const CSS = `
html.pk-nostyle, html.pk-nostyle body { background: #fff !important; color: #000 !important; }
body.pk-comic, body.pk-comic * { font-family: 'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', cursive !important; }
html.pk-flip { transform: rotate(180deg); }
html.pk-mirror { transform: scaleX(-1); }
@keyframes pk-drunk { 0%, 100% { transform: rotate(-1.2deg) translate(-4px, 2px); } 25% { transform: rotate(.8deg) translate(3px, -3px) skewX(1deg); } 50% { transform: rotate(1.4deg) translate(5px, 3px); } 75% { transform: rotate(-.6deg) translate(-2px, -2px) skewX(-1deg); } }
body.pk-drunk > .body, body.pk-drunk > header, body.pk-drunk > footer, body.pk-drunk .fs-stage { animation: pk-drunk 3.2s ease-in-out infinite; }
@keyframes pk-hue { to { filter: hue-rotate(360deg) saturate(1.6); } }
html.pk-rainbow { animation: pk-hue 6s linear infinite; }
body.pk-round * { border-radius: 999px !important; }
body.pk-square * { border-radius: 0 !important; }
body.pk-win98 button, body.pk-win98 .btn, body.pk-win98 input { background: #C0C0C0 !important; color: #000 !important; border: 2px outset #FFF !important; border-radius: 0 !important; box-shadow: none !important; font-family: Tahoma, 'MS Sans Serif', sans-serif !important; }
body.pk-win98 button:active { border-style: inset !important; }
body.pk-win98 .card, body.pk-win98 .sgroup-b, body.pk-win98 .playerbar { background: #C0C0C0 !important; color: #000 !important; border: 2px outset #FFF !important; border-radius: 0 !important; }
body.pk-win98 .card *, body.pk-win98 .sgroup-b *, body.pk-win98 .playerbar * { color: #000 !important; }
body.pk-win98 .titlebar, body.pk-win98 header { background: linear-gradient(90deg, #000080, #1084D0) !important; color: #fff !important; }
html.pk-giant { zoom: 2; }
html.pk-ant { zoom: .5; }
body.pk-ghost > .body, body.pk-ghost > header, body.pk-ghost > footer { opacity: .05; transition: opacity .25s; }
body.pk-ghost > .body:hover, body.pk-ghost > header:hover, body.pk-ghost > footer:hover { opacity: 1; }
body.pk-reverse .fs-lyrics p, body.pk-reverse .fs-lyrics p * { unicode-bidi: bidi-override; direction: rtl; }
body.pk-reverse .fs-lyrics p { text-align: right; }
body.pk-cat img { content: url("${CAT}"); object-fit: cover; }
body.pk-meow .hint::after { content: ' мяу'; }
#pk-reset { position: fixed; left: 12px; bottom: 96px; z-index: 99999; padding: 8px 14px; border-radius: 18px; border: 0; background: #FF5C7A; color: #fff; font: 700 13px system-ui, sans-serif; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
`;

export function createPranks({ player, onChange = () => {}, onLyrics = () => {} }) {
  const on = new Set();
  let style = null;
  let audioCtx = null;
  let meowObs = null;
  const meowed = new Map(); // текстовый узел → прежний текст
  let runawayTries = 0;

  const has = (id) => on.has(id);

  function ensureStyle() {
    if (style) return;
    style = document.createElement('style');
    style.id = 'pk-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ---------- без стилей: выключаем все таблицы стилей, кроме своей (в ней только кнопка сброса) ----------
  function setNoStyle(v) {
    for (const s of document.styleSheets) {
      const node = s.ownerNode;
      if (node && node.id === 'pk-style') continue;
      s.disabled = v;
    }
  }

  // ---------- звук лягушки ----------
  function boing() {
    try {
      audioCtx = audioCtx || new AudioContext();
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      const kinds = ['sine', 'square', 'triangle', 'sawtooth'];
      o.type = kinds[Math.floor(Math.random() * kinds.length)];
      const f = 200 + Math.random() * 700;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(Math.random() < 0.5 ? f * 3 : f / 3, t + 0.18);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.25);
    } catch {
      // без звука — не беда
    }
  }

  // ---------- нажатия: лягушка и тормоза ----------
  const isReset = (el) => el && el.closest && el.closest('#pk-reset, [data-action^="dev-prank"]');
  document.addEventListener('click', (e) => {
    if (!on.size || e.nyaoLag) return;
    if (has('frog')) boing();
    if (has('lag') && !isReset(e.target)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      const target = e.target;
      setTimeout(() => {
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY });
        ev.nyaoLag = true;
        target.dispatchEvent(ev);
      }, 2000);
    }
  }, true);

  // ---------- убегающая кнопка ----------
  document.addEventListener('mousemove', (e) => {
    if (!has('runaway')) return;
    const b = document.getElementById('pb-play');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(e.clientX - cx, e.clientY - cy);
    if (d < 70 && runawayTries < 3) {
      runawayTries++;
      const dx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 120);
      const dy = -(20 + Math.random() * 60);
      b.style.transition = 'transform .18s cubic-bezier(.2,1.6,.4,1)';
      b.style.transform = `translate(${dx}px, ${dy}px)`;
      setTimeout(() => {
        if (has('runaway')) b.style.transform = '';
      }, 1400);
    }
  });

  // ---------- хаос-очередь ----------
  player.addEventListener('track', () => {
    if (!has('chaos')) return;
    const n = (player.queue || []).length;
    const from = player.index + 1;
    if (n - from < 2) return;
    for (let k = 0; k < Math.min(30, n - from); k++) {
      const a = from + Math.floor(Math.random() * (n - from));
      const b = from + Math.floor(Math.random() * (n - from));
      if (a !== b) player.move(a, b);
    }
  });

  // ---------- скорость: бурундук и Вейдер ----------
  function applyRate() {
    const a = player.audio;
    const rate = has('chipmunk') ? 1.5 : has('vader') ? 0.75 : 1;
    a.preservesPitch = rate === 1;
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;
  }
  player.audio.addEventListener('loadeddata', () => {
    if (has('chipmunk') || has('vader')) applyRate();
  });

  // ---------- Meow Music ----------
  const MEOW = [[/Nyao Music/g, 'Meow Music'], [/Nyao/g, 'Meow'], [/Няо/g, 'Мяу']];
  function meowNode(n) {
    const t = n.nodeValue;
    if (!t || !/Nyao|Няо/.test(t)) return;
    if (!meowed.has(n)) meowed.set(n, t);
    let v = t;
    for (const [re, to] of MEOW) v = v.replace(re, to);
    n.nodeValue = v;
  }
  function meowAll(root = document.body) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) meowNode(n);
  }
  function setMeow(v) {
    if (v) {
      meowAll();
      meowObs = new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'characterData') meowNode(m.target);
          m.addedNodes.forEach((x) => (x.nodeType === 3 ? meowNode(x) : x.nodeType === 1 && meowAll(x)));
        }
      });
      meowObs.observe(document.body, { subtree: true, childList: true, characterData: true });
      document.title = document.title.replace(/Nyao/g, 'Meow');
    } else {
      if (meowObs) meowObs.disconnect();
      meowObs = null;
      for (const [n, t] of meowed) if (n.isConnected) n.nodeValue = t;
      meowed.clear();
      document.title = document.title.replace(/Meow/g, 'Nyao');
    }
  }

  function resetButton() {
    let b = document.getElementById('pk-reset');
    if (on.size && !b) {
      b = document.createElement('button');
      b.id = 'pk-reset';
      b.textContent = 'Сбросить приколы';
      b.onclick = () => resetAll();
      document.body.appendChild(b);
    } else if (!on.size && b) b.remove();
  }

  function apply(id, v) {
    ensureStyle();
    const html = document.documentElement;
    if (['flip', 'mirror', 'rainbow', 'giant', 'ant', 'nostyle'].includes(id)) html.classList.toggle(`pk-${id}`, v);
    else document.body.classList.toggle(`pk-${id}`, v);
    if (id === 'nostyle') setNoStyle(v);
    if (id === 'chipmunk' || id === 'vader') applyRate();
    if (id === 'meow') setMeow(v);
    if (id === 'runaway') {
      runawayTries = 0;
      const b = document.getElementById('pb-play');
      if (b && !v) b.style.transform = '';
    }
    if (id === 'reverse' || id === 'karaoke') onLyrics(id);
  }

  function set(id, v) {
    if (!PRANKS.some((p) => p[0] === id)) return;
    if (v && PAIRS[id] && on.has(PAIRS[id])) {
      on.delete(PAIRS[id]);
      apply(PAIRS[id], false);
    }
    if (v) on.add(id);
    else on.delete(id);
    apply(id, v);
    resetButton();
    onChange();
  }

  function resetAll() {
    for (const id of [...on]) {
      on.delete(id);
      apply(id, false);
    }
    resetButton();
    onChange();
  }

  // аварийный выход: Ctrl+Shift+Backspace
  document.addEventListener('keydown', (e) => {
    if (on.size && e.ctrlKey && e.shiftKey && e.key === 'Backspace') {
      e.preventDefault();
      resetAll();
    }
  }, true);

  return { has, set, toggle: (id) => set(id, !on.has(id)), resetAll, active: () => [...on] };
}

/**
 * «Караоке на всё»: строки с таймингами без разметки слов получают слова поровну по длительности строки.
 * Не трогает текст, где разметка уже есть.
 */
export function fakeWords(data) {
  if (!data || !data.synced || data.words || !Array.isArray(data.lines)) return data;
  const lines = data.lines.map((l, i) => {
    const next = data.lines.slice(i + 1).find((x) => Number.isFinite(x.time));
    const end = next ? next.time : l.time + 4;
    const words = String(l.text || '').split(/\s+/).filter(Boolean);
    if (!words.length || !Number.isFinite(l.time)) return l;
    const step = Math.max(0.12, (end - l.time) / words.length);
    return { ...l, words: words.map((text, j) => ({ text, time: l.time + j * step, end: l.time + (j + 1) * step })) };
  });
  return { ...data, lines, words: true };
}
