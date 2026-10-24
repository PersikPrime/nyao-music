// Полноэкранный режим (макет «Полный экран 2.0»): фон — затемнённый цвет обложки, без подложек.
// Слева обложка, название и прогресс; справа текст песни по высоте левого блока. Колёсико разворачивает текст
// на весь экран, через 4 секунды без прокрутки он сжимается обратно. Кнопки прячутся, только если это включено.
// Фон (макет 8 «Глубокий разворот»): зеркальный пол с отражением обложки, свет за текущей строкой и на полу под текстом.
// Обложка в покое чуть повёрнута (левая грань ближе); открывается полуоборотом в полёте из плашки плеера,
// из-за неё веером расходятся обложки соседних треков; при смене трека обложки проезжают как Cover Flow.

/** Поворот обложки в покое, градусы */
const TILT = 12;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Цвет обложки → почти чёрный фон с её оттенком (яркость не выше 0.03 — белый текст читается, фон не «серый») */
export function backgroundFrom(rgb) {
  if (!rgb) return '#1c1a20';
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r0, g0, b0] = rgb;
  let k = 1;
  for (let i = 0; i < 30; i++) {
    const L = 0.2126 * lin(r0 * k) + 0.7152 * lin(g0 * k) + 0.0722 * lin(b0 * k);
    if (L <= 0.03) break;
    k *= 0.92;
  }
  return `rgb(${Math.round(r0 * k)}, ${Math.round(g0 * k)}, ${Math.round(b0 * k)})`;
}

/** Цвет света на фоне (за строкой и на полу): цвет обложки, поднятый до заметной яркости */
export function glowFrom(rgb) {
  if (!rgb) return 'rgb(182, 156, 255)';
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b, 1);
  const k = max < 190 ? 190 / max : 1;
  const c = (v) => Math.min(255, Math.round(v * k));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

export class FullScreen {
  /**
   * deps: player, api, icons, ensureLyrics() → Promise<{synced, lines}>, like(track, on), isMac
   */
  constructor(deps) {
    this.d = deps;
    this.el = null;
    this.open = false;
    this.trackId = null;
    this.lastLine = -2;
    this.idleTimer = null;
    this.showLyrics = true;
    try {
      this.showLyrics = localStorage.getItem('nyao-fs-lyrics') !== '0';
    } catch {
      // без сохранения — текст показываем
    }
  }

  build() {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'fs';
    el.hidden = true;
    el.innerHTML = `
      <div class="fs-floor" aria-hidden="true"><div class="fs-sweep"></div><div class="fs-pool"></div></div>
      <div class="fs-top">
        <button class="fs-round fs-qbtn" data-fs="queue" aria-label="Очередь" title="Очередь" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h10M17 15v6l4-3z"/></svg></button>
        <button class="fs-round" data-fs="exit" aria-label="Выйти из полного экрана" title="Выйти из полного экрана (Esc)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg></button>
      </div>
      <div class="fs-stage">
        <div class="fs-left">
          <div class="fs-art-wrap">
            <div class="fs-nb fs-nb-prev" aria-hidden="true"><img alt=""></div>
            <div class="fs-nb fs-nb-next" aria-hidden="true"><img alt=""></div>
            <div class="fs-art"><div class="fs-face"><img alt=""></div><div class="fs-face fs-back" aria-hidden="true"><img alt=""></div></div>
            <div class="fs-refl" aria-hidden="true"><img alt=""></div>
          </div>
          <div class="fs-head">
            <button class="fs-round fs-lyr" data-fs="lyrics" aria-label="Текст" title="Текст"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg></button>
            <div class="fs-meta"><h1 class="fs-title"></h1><div class="fs-artist"></div></div>
            <button class="fs-round fs-like" data-fs="like" aria-label="Мне нравится"></button>
          </div>
          <div class="fs-progress" data-fs="seek"><div class="fs-fill"></div><span class="fs-knob fs-ctl"></span></div>
          <div class="fs-times"><span class="fs-cur">0:00</span><span class="fs-left-time">0:00</span></div>
          <div class="fs-controls fs-ctl">
            <button class="fs-btn" data-fs="prev" aria-label="Предыдущий"></button>
            <button class="fs-play" data-fs="play" aria-label="Играть"></button>
            <button class="fs-btn" data-fs="next" aria-label="Следующий"></button>
          </div>
        </div>
        <div class="fs-right">
          <div class="fs-lyrics" aria-live="off"></div>
          <div class="fs-credit"></div>
          <button class="fs-now" data-fs="now"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>К текущей строке</button>
        </div>
      </div>
      <aside class="fs-queue" aria-label="Очередь">
        <div class="fs-q-head"><span>Очередь</span><span class="fs-q-sub"></span><button class="fs-round" data-fs="queue" aria-label="Закрыть очередь"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <div class="fs-q-list"></div>
      </aside>`;
    document.body.appendChild(el);
    this.el = el;
    const $ = (s) => el.querySelector(s);
    this.$ = $;
    const { player } = this.d;
    $('[data-fs="prev"]').innerHTML = this.d.icons.prev;
    $('[data-fs="next"]').innerHTML = this.d.icons.next;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fs]');
      const line = e.target.closest('[data-t]');
      const qi = e.target.closest('[data-qi]');
      if (qi) {
        player.playAt(Number(qi.dataset.qi));
        return;
      }
      if (line) {
        player.seek(Number(line.dataset.t));
        return;
      }
      if (!b) return;
      const a = b.dataset.fs;
      if (a === 'exit') this.close();
      else if (a === 'queue') this.toggleQueue();
      else if (a === 'now') this.collapse();
      else if (a === 'play') player.toggle();
      else if (a === 'prev') player.prev();
      else if (a === 'next') player.next(true);
      else if (a === 'like') {
        const t = player.current;
        if (t) this.d.like(t, !player.liked.has(t.id));
      } else if (a === 'lyrics') {
        if (!(this.lyrics && this.lyrics.lines && this.lyrics.lines.length)) return;
        this.showLyrics = !this.showLyrics;
        try {
          localStorage.setItem('nyao-fs-lyrics', this.showLyrics ? '1' : '0');
        } catch {
          // не сохранилось — не страшно
        }
        this.renderLyrics();
      }
    });
    // Перемотка: ползунок и время едут за курсором, перематываем, когда отпустили
    const bar = $('.fs-progress');
    const frac = (x) => {
      const r = bar.getBoundingClientRect();
      return r.width ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0;
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const dur = this.duration();
      if (!dur) return;
      e.preventDefault();
      this.seeking = frac(e.clientX);
      bar.classList.add('dragging');
      if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
      this.paintProgress(this.seeking, dur);
    });
    bar.addEventListener('pointermove', (e) => {
      if (this.seeking == null) return;
      this.seeking = frac(e.clientX);
      this.paintProgress(this.seeking, this.duration());
    });
    const finish = (e, apply) => {
      if (this.seeking == null) return;
      const p = e && e.clientX != null && apply ? frac(e.clientX) : this.seeking;
      this.seeking = null;
      bar.classList.remove('dragging');
      const dur = this.duration();
      if (apply && dur) player.seek(p * dur);
      this.tick(true);
    };
    bar.addEventListener('pointerup', (e) => finish(e, true));
    bar.addEventListener('pointercancel', (e) => finish(e, false));
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.fs-art')) this.close();
    });
    el.addEventListener('mousemove', () => this.wake());
    // колёсико над текстом — развернуть на весь экран и листать самому
    $('.fs-right').addEventListener('wheel', () => this.userScroll(), { passive: true });
    window.addEventListener('resize', () => this.layout());
    // высота текста меняется анимацией (.35 с) при разворачивании и сворачивании: отступы считаем по
    // итоговой высоте, а не по промежуточной — иначе после прокрутки текст оставался ниже середины
    if (typeof ResizeObserver === 'function') {
      let lastH = 0;
      new ResizeObserver(() => {
        const right = this.$('.fs-right');
        if (!this.open || !right || right.clientHeight === lastH) return;
        lastH = right.clientHeight;
        this.layout();
        if (!this.scrolling) {
          this.lastLine = -2;
          this.tick(true);
        }
      }).observe($('.fs-right'));
    }
  }

  /** Высота текста = высота левого блока; отступы, чтобы текущая строка вставала посередине */
  layout() {
    if (!this.open || !this.el) return;
    // линия «пола» — по нижнему краю обложки
    const wrap = this.$('.fs-art-wrap');
    if (wrap && wrap.getBoundingClientRect && this.el.getBoundingClientRect) {
      const r = wrap.getBoundingClientRect();
      const top = this.el.getBoundingClientRect().top || 0;
      if (r.height) this.el.style.setProperty('--fs-horizon', `${Math.round(r.bottom - top)}px`);
    }
    const left = this.$('.fs-left');
    if (left) this.el.style.setProperty('--fs-lh', `${left.offsetHeight}px`);
    // без текста обложка встаёт по центру: сдвиг от её места в сетке до середины экрана
    const stage = this.$('.fs-stage');
    if (left && stage) {
      const ls = left.offsetLeft + left.offsetWidth / 2;
      this.el.style.setProperty('--fs-shift', `${Math.round(stage.clientWidth / 2 - ls)}px`);
    }
    const box = this.$('.fs-lyrics');
    if (box && !box.classList.contains('plain')) {
      // меряем без старых отступов: блок не сжимается меньше своих отступов, и прежние (от развёрнутого
      // на весь экран текста) не давали ему вернуться к высоте плеера
      box.style.paddingTop = '0px';
      box.style.paddingBottom = '0px';
      const pad = `${Math.round(box.clientHeight / 2)}px`;
      box.style.paddingTop = pad;
      box.style.paddingBottom = pad;
    } else if (box) {
      box.style.paddingTop = '';
      box.style.paddingBottom = '';
    }
  }

  userScroll() {
    if (!this.lyrics || !this.showLyrics) return;
    this.scrolling = true;
    if (!this.el.classList.contains('expand')) {
      this.el.classList.add('expand');
      this.layout();
    }
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => this.collapse(), 4000);
  }

  /** Обратно к высоте плеера и к текущей строке */
  collapse() {
    clearTimeout(this.scrollTimer);
    this.scrolling = false;
    if (!this.el) return;
    this.el.classList.remove('expand');
    this.layout();
    this.lastLine = -2;
    this.tick(true);
  }

  /** Очередь — панель справа поверх текста; та же кнопка или Esc закрывают */
  toggleQueue(on = !this.queueOpen) {
    this.queueOpen = !!on;
    if (!this.el) return;
    this.el.classList.toggle('queue', this.queueOpen);
    this.el.querySelectorAll('[data-fs="queue"]').forEach((b) => b.setAttribute('aria-pressed', String(this.queueOpen)));
    if (this.queueOpen) this.renderQueue(true);
  }

  renderQueue(scroll, force = false) {
    if (!this.el || !this.queueOpen) return;
    const { player } = this.d;
    const q = player.queue || [];
    const from = Math.max(0, player.index - 3);
    const items = q.slice(from, from + 150).filter(Boolean);
    const list = this.$('.fs-q-list');
    const key = `${player.index}|${q.length}|${q[player.index] && q[player.index].id}`;
    if (this.queueKey === key && !scroll && !force) return;
    this.queueKey = key;
    this.$('.fs-q-sub').textContent = player.mode === 'wave' ? 'Моя волна' : [player.label, q.length ? `${q.length} тр.` : ''].filter(Boolean).join(' · ');
    list.innerHTML = items.length ? items.map((t, k) => {
      const i = from + k;
      return `<button class="fs-q-row${i === player.index ? ' cur' : ''}${i < player.index ? ' past' : ''}" data-qi="${i}"><span class="fs-q-art">${t.cover ? `<img src="${esc(t.cover)}" alt="" loading="lazy">` : ''}</span><span class="fs-q-meta"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></span>${t.duration ? `<span class="fs-q-dur">${fmt(t.duration)}</span>` : ''}</button>`;
    }).join('') : `<div class="fs-q-empty">${player.mode === 'wave' ? 'Моя волна подберёт следующий трек сама' : 'Очередь пуста'}</div>`;
    if (scroll) {
      const cur = list.querySelector('.cur');
      if (cur) list.scrollTop = Math.max(0, cur.offsetTop - 80);
    }
  }

  /** Esc: сначала закрывает очередь, потом сам полный экран */
  escape() {
    if (this.queueOpen) {
      this.toggleQueue(false);
      return true;
    }
    if (this.open) {
      this.close();
      return true;
    }
    return false;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    if (!this.d.player.current || this.closing) return;
    this.build();
    this.open = true;
    this.el.hidden = false;
    // при открытии обложка сразу на своём месте — анимация только при переключении текста
    this.el.classList.add('noanim');
    setTimeout(() => this.el && this.el.classList.remove('noanim'), 400);
    this.trackId = null;
    this.lastIndex = null;
    this.update();
    this.wake();
    requestAnimationFrame(() => this.layout());
    if (!this.canAnimate()) {
      this.d.api.win.fullscreen(true).catch(() => {});
      document.body.classList.add('fs-on');
      return;
    }
    // окно сначала становится полноэкранным, потом из плашки вылетает обложка — иначе она прыгнет,
    // когда окно поменяет размер посреди полёта
    this.el.style.opacity = '0';
    Promise.resolve(this.d.api.win.fullscreen(true).catch(() => {}))
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .then(() => {
        if (!this.el) return;
        this.el.style.opacity = '';
        if (!this.open) return;
        this.layout();
        this.animateOpen();
      });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('expand');
    this.scrolling = false;
    document.body.classList.remove('fs-on');
    clearTimeout(this.idleTimer);
    const back = this.d.api.win.fullscreen(false).catch(() => {});
    if (!this.canAnimate()) {
      this.el.hidden = true;
      return;
    }
    // окно сначала возвращается к обычному размеру, чтобы плашка плеера встала на своё место,
    // и уже туда уезжает обложка
    this.closing = true;
    Promise.resolve(back)
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .then(() => this.animateClose());
  }

  // ---------- Разворот из плашки плеера и обратно ----------

  canAnimate() {
    if (!this.el || typeof this.el.animate !== 'function') return false;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return !!this.sourceRect();
  }

  /** Обложка в плашке плеера, откуда разворачивается полный экран */
  sourceEl() {
    try {
      return (this.d.source && this.d.source()) || null;
    } catch {
      return null;
    }
  }

  sourceRect() {
    const el = this.sourceEl();
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  /** Сдвиг и масштаб, чтобы обложка полного экрана встала точно на место обложки в плашке */
  flight(from, to, k = 1) {
    const s = 1 + (from.width / to.width - 1) * k;
    const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) * k;
    const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) * k;
    return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(4)})`;
  }

  /** Поворот обложки в покое: без текста она одна по центру и стоит прямо */
  tilt() {
    return this.el && this.el.classList.contains('nolyrics') ? 0 : TILT;
  }

  /** Место обложки без поворота в покое — от него считается перелёт */
  artRect(art) {
    const prev = art.style.transform;
    art.style.transform = 'none';
    const r = art.getBoundingClientRect();
    art.style.transform = prev;
    return r;
  }

  /** Всё, кроме обложки: кнопки, текст, прогресс — они просто проявляются */
  parts() {
    return Array.from(this.el.querySelectorAll('.fs-top, .fs-right, .fs-queue, .fs-floor, .fs-left > :not(.fs-art-wrap)'));
  }

  animateOpen() {
    const art = this.$('.fs-art');
    const from = this.sourceRect();
    const done = () => {
      document.body.classList.add('fs-on');
      const src = this.sourceEl();
      if (src) src.style.visibility = '';
    };
    const to = art && art.getBoundingClientRect ? this.artRect(art) : null;
    if (!this.canAnimate() || !to || !to.width || !this.open) return done();
    this.el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    const src = this.sourceEl();
    if (src) src.style.visibility = 'hidden'; // обложка «улетела» из плашки — там её не показываем
    const bg = getComputedStyle(this.el).backgroundColor;
    const ease = 'cubic-bezier(.2, .8, .2, 1)';
    this.el.animate([{ backgroundColor: 'transparent' }, { backgroundColor: bg }], { duration: 420, easing: 'ease-out' });
    const D = 980;
    this.parts().forEach((p) => p.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: D, easing: 'ease-out' }));
    // перелёт из плашки с полуоборотом: в плашке виден «задник» обложки, лицом она поворачивается к концу
    // полёта и с пружинкой встаёт под углом покоя
    const fly = art.animate([
      { transform: `${this.flight(from, to)} rotateY(180deg)` },
      { transform: `${this.flight(from, to, 0.28)} rotateY(72deg)`, offset: 0.5 },
      { transform: `translate(0px, 0px) scale(1.03) rotateY(${this.tilt() - 9}deg)`, offset: 0.78 },
      { transform: `translate(0px, 0px) scale(1) rotateY(${this.tilt()}deg)` }
    ], { duration: D, easing: ease });
    // в момент приземления из-за обложки веером расходятся соседние треки (Cover Flow) и гаснут
    const fan = (sel, dir) => {
      const nb = this.$(sel);
      if (!nb || !nb.animate || !nb.dataset.on) return;
      nb.animate([
        { opacity: 0, transform: `translateZ(-160px) rotateY(${dir * 40}deg) scale(.86)` },
        { opacity: 0.85, offset: 0.3 },
        { opacity: 0, transform: `translateX(${dir * -72}%) translateZ(-120px) rotateY(${dir * 72}deg) scale(.86)` }
      ], { duration: 820, delay: D * 0.42, easing: ease, fill: 'backwards' });
    };
    fan('.fs-nb-prev', 1);
    fan('.fs-nb-next', -1);
    const refl = this.$('.fs-refl');
    if (refl && refl.animate) refl.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 0.15 }], { duration: D, easing: 'ease-out' });
    fly.finished.then(done, done);
  }

  animateClose() {
    const art = this.$('.fs-art');
    const to = this.sourceRect();
    const finish = () => {
      this.closing = false;
      const src = this.sourceEl();
      if (src) src.style.visibility = '';
      if (!this.open) this.el.hidden = true;
    };
    const from = art && art.getBoundingClientRect ? this.artRect(art) : null;
    if (!to || !from || !from.width) return finish();
    const src = this.sourceEl();
    if (src) src.style.visibility = 'hidden';
    const bg = getComputedStyle(this.el).backgroundColor;
    this.el.animate([{ backgroundColor: bg }, { backgroundColor: 'transparent' }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
    this.parts().forEach((p) => p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' }));
    // обратно — без кувырков: поворот покоя распрямляется по пути в плашку
    const fly = art.animate([{ transform: `translate(0px, 0px) scale(1) rotateY(${this.tilt()}deg)` }, { transform: `${this.flight(to, from)} rotateY(0deg)` }], { duration: 440, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    const refl = this.$('.fs-refl');
    if (refl && refl.animate) refl.animate([{ opacity: 0.15 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
    const end = () => {
      finish();
      // снимаем «замороженные» конечные кадры уже спрятанного слоя, иначе при следующем открытии всё останется прозрачным
      this.el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    };
    fly.finished.then(end, end);
  }

  /** Мышь двинулась — показываем кнопки; прячем через 3 секунды, только если включено «Прятать кнопки» */
  wake() {
    if (!this.el) return;
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    if (!(this.d.autoHide && this.d.autoHide())) return;
    this.idleTimer = setTimeout(() => {
      if (this.open && this.d.player.playing) this.el.classList.add('idle');
    }, 3000);
  }

  /** Промис с пределом ожидания: зависший запрос цвета или текста не держит экран в «Ищу…» */
  withTimeout(promise, ms, fallback = null) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); });
    });
  }

  /** Шаг обновления, который не должен ронять остальные: ошибка в очереди или тексте не трогает название */
  safe(step) {
    try {
      step();
    } catch (e) {
      console.warn('[fs]', e);
    }
  }

  /** Обложки предыдущего и следующего трека за текущей (для веера и Cover Flow) */
  setNeighbors() {
    const { player } = this.d;
    const q = player.queue || [];
    const cur = player.current;
    const set = (sel, t) => {
      const nb = this.$(sel);
      const img = this.$(`${sel} img`);
      if (!nb || !img) return;
      const src = (t && t.cover) || (cur && cur.cover) || '';
      img.src = src;
      nb.dataset.on = src ? '1' : '';
    };
    set('.fs-nb-prev', q[player.index - 1]);
    set('.fs-nb-next', q[player.index + 1]);
  }

  /** Смена трека при открытом экране: новая обложка въезжает сбоку с разворота, прошлая уезжает в другую сторону */
  coverFlow(dir) {
    const art = this.$('.fs-art');
    if (!art || typeof art.animate !== 'function' || this.closing) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ease = 'cubic-bezier(.2, .8, .2, 1)';
    art.animate([
      { transform: `translateX(${dir * 34}%) scale(.88) rotateY(${this.tilt() - dir * 55}deg)`, opacity: 0.35 },
      { transform: `translateX(0%) scale(1) rotateY(${this.tilt()}deg)`, opacity: 1 }
    ], { duration: 560, easing: ease });
    // прошлый трек теперь сосед с той стороны, куда уехал: показываем, как он уходит
    const nb = this.$(dir > 0 ? '.fs-nb-prev' : '.fs-nb-next');
    if (nb && nb.animate && nb.dataset.on) {
      nb.animate([
        { opacity: 0.9, transform: `translateX(0%) scale(1) rotateY(${this.tilt()}deg)` },
        { opacity: 0, transform: `translateX(${dir * -64}%) scale(.86) rotateY(${dir * 70}deg)` }
      ], { duration: 560, easing: ease });
    }
  }

  /** Смена трека, паузы, лайка */
  update() {
    if (!this.open || !this.el) return;
    const { player } = this.d;
    const t = player.current;
    if (!t) return this.close();
    const $ = this.$;
    this.safe(() => {
      $('.fs-play').innerHTML = player.playing ? this.d.icons.pause : this.d.icons.play;
      $('.fs-play').setAttribute('aria-label', player.playing ? 'Пауза' : 'Играть');
      const liked = player.liked.has(t.id);
      $('.fs-like').innerHTML = liked ? this.d.icons.heartOn : this.d.icons.heart;
      $('.fs-like').classList.toggle('on', liked);
      if (!player.playing) this.el.classList.remove('idle');
    });
    if (this.trackId === t.id) {
      this.safe(() => this.renderQueue());
      return this.tick();
    }
    // Сначала название и обложка — это то, что человек видит; очередь, цвет фона и текст идут отдельными
    // шагами, чтобы сбой в любом из них не оставил на экране прошлый трек
    const prevId = this.trackId;
    const dir = player.index < (this.lastIndex ?? player.index) ? -1 : 1;
    this.lastIndex = player.index;
    this.trackId = t.id;
    this.lastLine = -2;
    this.safe(() => {
      const img = $('.fs-art img');
      img.src = t.cover || '';
      img.style.visibility = t.cover ? 'visible' : 'hidden';
      // задник и отражение — та же обложка
      this.el.querySelectorAll('.fs-back img, .fs-refl img').forEach((i) => {
        i.src = t.cover || '';
        i.style.visibility = t.cover ? 'visible' : 'hidden';
      });
      this.setNeighbors();
      if (prevId) this.coverFlow(dir);
      $('.fs-title').textContent = t.title || '';
      $('.fs-artist').textContent = (t.artist || '') + (t.album ? ` · ${t.album}` : '');
      this.el.style.setProperty('--fs-bg', backgroundFrom(null));
      this.el.style.setProperty('--fs-glow', glowFrom(null));
    });
    this.safe(() => this.renderQueue());
    if (t.cover) {
      let colorPromise;
      try {
        colorPromise = this.d.api.coverColor(t.cover);
      } catch (e) {
        colorPromise = Promise.resolve(null);
      }
      this.withTimeout(colorPromise, 8000).then((rgb) => {
        if (rgb && this.trackId === t.id && this.el) {
          this.el.style.setProperty('--fs-bg', backgroundFrom(rgb));
          this.el.style.setProperty('--fs-glow', glowFrom(rgb));
        }
      });
    }
    this.lyrics = undefined;
    this.safe(() => this.renderLyrics());
    let lyricsPromise;
    try {
      lyricsPromise = this.d.ensureLyrics();
    } catch (e) {
      lyricsPromise = Promise.resolve(null);
    }
    this.withTimeout(lyricsPromise, 15000).then((data) => {
      if (this.trackId !== t.id) return;
      this.lyrics = data || null;
      this.safe(() => this.renderLyrics());
    });
    this.safe(() => this.tick());
  }

  renderLyrics() {
    if (!this.el) return;
    const box = this.$('.fs-lyrics');
    if (!box) return;
    const d = this.lyrics;
    const has = this.showLyrics && d && d.lines && d.lines.length;
    const avail = !!(d && d.lines && d.lines.length);
    this.el.classList.toggle('nolyrics', !has);
    if (!has) this.el.classList.remove('expand');
    const lb = this.$('[data-fs="lyrics"]');
    lb.classList.toggle('on', this.showLyrics && avail);
    lb.disabled = !avail;
    lb.setAttribute('aria-pressed', String(this.showLyrics && avail));
    lb.title = avail ? (this.showLyrics ? 'Скрыть текст' : 'Показать текст') : d === undefined ? 'Ищу текст…' : 'Для этого трека текста нет';
    this.$('.fs-credit').textContent = has ? `Текст: ${d.source || 'LRCLIB'}` : '';
    if (!has) {
      // скрыли кнопкой — текст остаётся под обложкой, чтобы уехать за неё анимацией
      if (!avail) box.innerHTML = '';
      return;
    }
    box.classList.toggle('plain', !d.synced);
    if (box.dataset.track === this.trackId && box.childElementCount) {
      requestAnimationFrame(() => {
        this.layout();
        this.tick(true);
      });
      return;
    }
    box.dataset.track = this.trackId;
    // строки с пословным временем — каждое слово из букв: буквы заливаются по ходу слова (караоке)
    const kw = (l) => l.words.map((w, j) => `<span class="kw-w" data-j="${j}">${Array.from(w.text).map((c) => `<span class="kw-c">${esc(c)}</span>`).join('')}</span>`).join(' ');
    box.innerHTML = (d.synced ? '' : '<div class="fs-plain-label">Текст без таймингов</div>') +
      d.lines.map((l, i) => `<p data-i="${i}" ${d.synced ? `data-t="${l.time}"` : ''}${d.synced && l.words ? ' class="kw"' : ''}>${d.synced && l.words ? kw(l) : esc(l.text) || '♪'}</p>`).join('');
    this.lastLine = -2;
    this.kLine = null;
    requestAnimationFrame(() => {
      this.layout();
      this.tick(true);
    });
  }

  duration() {
    const a = this.d.player.audio;
    return Number.isFinite(a.duration) ? a.duration : (this.d.player.current && this.d.player.current.duration) || 0;
  }

  paintProgress(p, dur) {
    const cur = p * dur;
    this.$('.fs-fill').style.width = `${p * 100}%`;
    this.$('.fs-knob').style.left = `${p * 100}%`;
    this.$('.fs-cur').textContent = fmt(cur);
    this.$('.fs-left-time').textContent = '−' + fmt(Math.max(0, dur - cur));
  }

  /**
   * Караоке: у текущей строки с пословным временем каждый кадр пересчитываем заливку букв.
   * Буква k слова из n букв начинает подниматься, когда пройдено k/n слова, и подъём перекрывает соседние
   * буквы — заливка идёт волной: длинное «аааа» тянется долго, короткое «дом» проходит быстро.
   */
  karaoke(idx) {
    const d = this.lyrics;
    const line = d && d.lines[idx];
    if (!line || !line.words) { this.kLine = null; return; }
    if (!this.kLine || this.kLine.idx !== idx) {
      const p = this.$(`.fs-lyrics p[data-i="${idx}"]`);
      if (!p) return;
      this.kLine = { idx, words: line.words.map((w, j) => ({ ...w, chars: [...p.querySelectorAll(`.kw-w[data-j="${j}"] .kw-c`)].map((el) => ({ el, k: -1 })) })) };
    }
    this.paintKaraoke();
    if (!this.kRaf && this.d.player.playing) {
      const frame = () => {
        this.kRaf = 0;
        if (!this.open || !this.kLine || !this.d.player.playing) return;
        this.paintKaraoke();
        this.kRaf = requestAnimationFrame(frame);
      };
      this.kRaf = requestAnimationFrame(frame);
    }
  }

  paintKaraoke() {
    const L = this.kLine;
    if (!L) return;
    const t = (this.d.player.audio.currentTime || 0) + 0.04; // чуть раньше звука — глаз успевает за голосом
    // свет за строкой вспыхивает в начале каждого слова и гаснет за треть секунды
    const w0 = L.words.find((w) => t >= w.time && t < w.end);
    const beat = w0 ? Math.max(0, 1 - (t - w0.time) / 0.35) : 0;
    if (Math.abs((this.beat ?? -1) - beat) > 0.02) {
      this.beat = beat;
      this.el.style.setProperty('--fs-beat', beat.toFixed(2));
    }
    const SOFT = 1.8; // на сколько букв растянут подъём одной буквы
    for (const w of L.words) {
      const n = w.chars.length;
      const wp = Math.max(0, Math.min(1, (t - w.time) / Math.max(0.05, w.end - w.time)));
      for (let k = 0; k < n; k++) {
        let x = Math.max(0, Math.min(1, (wp * (n + SOFT) - k) / SOFT));
        x = x * x * (3 - 2 * x); // плавно в начале и в конце
        const c = w.chars[k];
        if (Math.abs(c.k - x) < 0.004) continue;
        c.k = x;
        c.el.style.setProperty('--k', x.toFixed(3));
      }
    }
  }

  /** Время: прогресс и текущая строка */
  tick(force) {
    if (!this.open || !this.el) return;
    // страховка: если на экране не тот трек, что играет (событие смены потерялось или упало), обновляемся сами
    const cur = this.d.player.current;
    if (cur && cur.id !== this.trackId) return this.update();
    const a = this.d.player.audio;
    const dur = this.duration();
    const pos = a.currentTime || 0;
    // пока тянут ползунок, он стоит под курсором, а не там, где играет
    if (this.seeking == null) this.paintProgress(dur ? Math.min(1, pos / dur) : 0, dur);
    const d = this.lyrics;
    if (!d || !d.synced || !this.showLyrics) return;
    const time = pos + 0.25;
    let idx = -1;
    for (let i = 0; i < d.lines.length; i++) if (d.lines[i].time <= time) idx = i;
    if (d.words) this.karaoke(idx);
    if (idx === this.lastLine && !force) return;
    this.lastLine = idx;
    const box = this.$('.fs-lyrics');
    box.querySelectorAll('p').forEach((el, i) => {
      el.classList.toggle('on', i === idx);
      el.classList.toggle('past', i < idx);
      el.classList.toggle('next', i === idx + 1);
    });
    if (this.scrolling) return; // человек листает сам — не мешаем
    const on = box.querySelector('p.on') || box.querySelector('p');
    if (!on) return;
    const top = on.offsetTop - box.clientHeight / 2 + on.offsetHeight / 2;
    if (typeof box.scrollTo === 'function') box.scrollTo({ top, behavior: force ? 'auto' : 'smooth' });
    else box.scrollTop = top;
  }
}
