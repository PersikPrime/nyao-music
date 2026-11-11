// Nyao Music — сайт. Без библиотек: появление при прокрутке, объём за курсором, живой пример полного экрана, загрузки.
// Всё движение идёт через requestAnimationFrame с плавным догоном значения — поэтому не дёргается.
(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---------- шапка ----------
  const top = $('.top');
  if (top) {
    const onScroll = () => top.classList.toggle('stuck', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- появление при прокрутке ----------
  const reveal = $$('[data-reveal]');
  if (!('IntersectionObserver' in window) || calm) reveal.forEach((el) => el.classList.add('in'));
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveal.forEach((el) => io.observe(el));
  }

  // Один общий цикл кадров на всё, что догоняет цель. Работает, только пока есть что двигать.
  const movers = new Set();
  let running = false;
  function frame() {
    let alive = false;
    movers.forEach((m) => { if (m()) alive = true; });
    running = alive;
    if (alive) requestAnimationFrame(frame);
  }
  const kick = () => { if (!running) { running = true; requestAnimationFrame(frame); } };

  // ---------- первый экран: сцена поворачивается за курсором ----------
  const hero = $('[data-parallax]');
  const scene = $('.scene');
  if (hero && scene && !calm) {
    const cur = { x: 0, y: 0 };
    const goal = { x: 0, y: 0 };
    movers.add(() => {
      cur.x = lerp(cur.x, goal.x, 0.07);
      cur.y = lerp(cur.y, goal.y, 0.07);
      scene.style.setProperty('--px', cur.x.toFixed(4));
      scene.style.setProperty('--py', cur.y.toFixed(4));
      return Math.abs(cur.x - goal.x) + Math.abs(cur.y - goal.y) > 0.001;
    });
    if (fine) {
      hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        goal.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
        goal.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
        kick();
      });
      hero.addEventListener('pointerleave', () => { goal.x = 0; goal.y = 0; kick(); });
    } else {
      // на телефоне курсора нет — сцена сама медленно покачивается
      const sway = (t) => {
        goal.x = Math.sin(t / 2600) * 0.55;
        goal.y = Math.cos(t / 3400) * 0.35;
        kick();
        if (document.visibilityState === 'visible') requestAnimationFrame(sway);
        else document.addEventListener('visibilitychange', () => requestAnimationFrame(sway), { once: true });
      };
      requestAnimationFrame(sway);
    }
  }

  // ---------- карточки: наклон и блик за курсором ----------
  if (fine && !calm) {
    $$('[data-tilt]').forEach((card) => {
      const cur = { rx: 0, ry: 0, lift: 0, go: 0 };
      const goal = { rx: 0, ry: 0, lift: 0, go: 0 };
      const step = () => {
        let d = 0;
        for (const k in cur) { cur[k] = lerp(cur[k], goal[k], 0.12); d += Math.abs(cur[k] - goal[k]); }
        card.style.setProperty('--rx', `${cur.rx.toFixed(3)}deg`);
        card.style.setProperty('--ry', `${cur.ry.toFixed(3)}deg`);
        card.style.setProperty('--lift', `${cur.lift.toFixed(2)}px`);
        card.style.setProperty('--go', cur.go.toFixed(3));
        return d > 0.01;
      };
      movers.add(step);
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        goal.ry = (x - 0.5) * 12;
        goal.rx = (0.5 - y) * 10;
        goal.lift = -6;
        goal.go = 1;
        card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
        kick();
      });
      card.addEventListener('pointerleave', () => { goal.rx = goal.ry = goal.lift = goal.go = 0; kick(); });
    });
  }

  // ---------- полный экран: живой пример ----------
  const demo = $('#demo');
  if (demo) {
    // Треки и строки выдуманы для примера
    const TRACKS = [
      { title: 'Ночной трамвай', artist: 'Лисья Нора', bg: '#2a1808', glow: '#ffb86b', c: ['#ffc98a', '#ffe2b8', '#c97a2b'],
        lines: ['Город гасит окна по одному', 'Последний трамвай звенит во тьму', 'Я еду туда, где ещё светло', 'Где дышит дождём на моё стекло', 'Считаю огни, как чужие сны', 'И рельсы поют до самой весны', 'Не спрашивай, где мой дом', 'Он там, где мы были вдвоём'] },
      { title: 'Мятный рассвет', artist: 'Северный Пляж', bg: '#06221b', glow: '#7ce0c3', c: ['#8fe8cf', '#d6fff3', '#2f9c80'],
        lines: ['Утро пахнет морем и травой', 'Чайки спорят с сонной синевой', 'Мы босиком идём по воде', 'И больше не нужно быть нигде', 'Солнце катит мятный леденец', 'Этой ночи наконец конец', 'Держи мою ладонь в своей', 'Пока рассвет не стал взрослей'] },
      { title: 'Сиреневый шум', artist: 'Комната 404', bg: '#17112b', glow: '#c6b8ff', c: ['#d3c8ff', '#f1ecff', '#7a66d6'],
        lines: ['В наушниках тихо шумит эфир', 'За стенкой сосед чинит целый мир', 'А я собираю из нот маяк', 'Чтоб ты нашла меня просто так', 'Сиреневый шум, не гасни, свети', 'Нам вместе с тобой ещё по пути', 'Пусть полночь рисует на потолке', 'Созвездие в каждой моей строке'] },
    ];
    const LINE_MS = 2300;
    const el = { title: $('#demo-title'), artist: $('#demo-artist'), lines: $('#demo-lines'), lyrics: $('#demo-lyrics'), fill: $('#demo-fill'), play: $('#demo-play'), icon: $('#demo-play-ic') };
    const cover = $('.demo-cover', demo);
    let idx = 0;
    let line = 0;
    let within = 0; // сколько мс прошло в текущей строке
    let playing = true;
    let visible = false;
    let last = 0;
    let swapTimer;

    function paint() {
      const t = TRACKS[idx];
      demo.style.setProperty('--dbg', t.bg);
      demo.style.setProperty('--dglow', t.glow);
      cover.style.setProperty('--c1', t.c[0]);
      cover.style.setProperty('--c2', t.c[1]);
      cover.style.setProperty('--c3', t.c[2]);
      el.title.textContent = t.title;
      el.artist.textContent = t.artist;
      el.lines.replaceChildren(...t.lines.map((text, i) => {
        const row = document.createElement('i');
        row.textContent = text;
        row.dataset.i = i;
        return row;
      }));
      mark();
    }
    function mark() {
      [...el.lines.children].forEach((row, i) => {
        row.classList.toggle('on', i === line);
        row.classList.toggle('past', i < line);
      });
      // строка, которая звучит, — по центру окошка: сдвигаем список, а не прокручиваем
      const lh = el.lines.firstElementChild ? el.lines.firstElementChild.offsetHeight : 0;
      const box = demo.classList.contains('expand') ? 8.2 : 3.6;
      el.lines.style.transform = `translateY(${(box / 2 - line - 0.5) * lh}px)`;
    }
    function setTrack(next, dir = 1) {
      idx = (next + TRACKS.length) % TRACKS.length;
      line = 0;
      within = 0;
      if (calm) return paint();
      demo.style.setProperty('--swap-dir', dir);
      demo.classList.add('swap'); // обложка перекатывается, подписи уходят
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => { paint(); demo.classList.remove('swap'); }, 320);
    }
    function setPlaying(on) {
      playing = on;
      demo.classList.toggle('paused', !on);
      el.play.setAttribute('aria-label', on ? 'Пауза' : 'Играть');
      el.icon.setAttribute('d', on ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
      if (on) loop();
    }
    function tick(now) {
      if (!playing || !visible) { last = 0; return; }
      if (last) within += Math.min(100, now - last);
      last = now;
      const total = TRACKS[idx].lines.length;
      if (within >= LINE_MS) {
        within = 0;
        if (line + 1 >= total) setTrack(idx + 1);
        else { line += 1; mark(); }
      }
      el.fill.style.width = `${Math.min(100, ((line + within / LINE_MS) / total) * 100).toFixed(2)}%`;
      requestAnimationFrame(tick);
    }
    const loop = () => { if (playing && visible && !last) requestAnimationFrame(tick); };

    $('#demo-next').addEventListener('click', () => setTrack(idx + 1, 1));
    $('#demo-prev').addEventListener('click', () => setTrack(idx - 1, -1));
    el.play.addEventListener('click', () => setPlaying(!playing));
    // как в плеере: нажатие на текст разворачивает его, остаётся только название; ещё раз — сворачивает
    el.lyrics.addEventListener('click', () => {
      const on = demo.classList.toggle('expand');
      el.lyrics.setAttribute('aria-expanded', on);
      mark();
    });
    addEventListener('resize', mark);
    new ResizeObserver(mark).observe(demo);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; loop(); }, { threshold: 0.25 }).observe(demo);
    paint();

    // при прокрутке пример «доворачивается» лицом к зрителю
    if (!calm && demo.hasAttribute('data-scroll-tilt')) {
      let cur = 0;
      let goal = 0;
      const measure = () => {
        const r = demo.getBoundingClientRect();
        goal = Math.max(0, Math.min(1, (innerHeight - r.top) / (innerHeight * 0.75)));
        kick();
      };
      movers.add(() => {
        cur = lerp(cur, goal, 0.09);
        demo.style.setProperty('--st', cur.toFixed(4));
        return Math.abs(cur - goal) > 0.0008;
      });
      addEventListener('scroll', measure, { passive: true });
      addEventListener('resize', measure);
      measure();
    }
  }

  // ---------- загрузки: вкладки платформ ----------
  const tabs = $$('.tab');
  const dlCookie = $('#dl-cookie');
  function pick(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (dlCookie) dlCookie.style.setProperty('--c', tab.dataset.color);
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => pick(tab));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      pick(tabs[(i + d + tabs.length) % tabs.length], true);
    });
  });
  const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
  if (current) pick(current);
})();
