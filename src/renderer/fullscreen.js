// Полноэкранный режим (макет «Полный экран 2.0»): фон — затемнённый цвет обложки, без подложек.
// Слева обложка, название и прогресс; справа текст песни по высоте левого блока. Колёсико разворачивает текст
// на весь экран, через 4 секунды без прокрутки он сжимается обратно. Кнопки прячутся, только если это включено.

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
      <div class="fs-top">
        <button class="fs-round fs-qbtn" data-fs="queue" aria-label="Очередь" title="Очередь" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h10M17 15v6l4-3z"/></svg></button>
        <button class="fs-round" data-fs="exit" aria-label="Выйти из полного экрана" title="Выйти из полного экрана (Esc)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg></button>
      </div>
      <div class="fs-stage">
        <div class="fs-left">
          <div class="fs-art"><img alt=""></div>
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
  }

  /** Высота текста = высота левого блока; отступы, чтобы текущая строка вставала посередине */
  layout() {
    if (!this.open || !this.el) return;
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
    const items = q.slice(from, from + 150);
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
    if (!this.d.player.current) return;
    this.build();
    this.open = true;
    this.el.hidden = false;
    // при открытии обложка сразу на своём месте — анимация только при переключении текста
    this.el.classList.add('noanim');
    setTimeout(() => this.el && this.el.classList.remove('noanim'), 400);
    document.body.classList.add('fs-on');
    this.d.api.win.fullscreen(true).catch(() => {});
    this.trackId = null;
    this.update();
    this.wake();
    requestAnimationFrame(() => this.layout());
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    this.el.classList.remove('expand');
    this.scrolling = false;
    document.body.classList.remove('fs-on');
    clearTimeout(this.idleTimer);
    this.d.api.win.fullscreen(false).catch(() => {});
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

  /** Смена трека, паузы, лайка */
  update() {
    if (!this.open) return;
    const { player } = this.d;
    const t = player.current;
    if (!t) return this.close();
    const $ = this.$;
    $('.fs-play').innerHTML = player.playing ? this.d.icons.pause : this.d.icons.play;
    $('.fs-play').setAttribute('aria-label', player.playing ? 'Пауза' : 'Играть');
    const liked = player.liked.has(t.id);
    $('.fs-like').innerHTML = liked ? this.d.icons.heartOn : this.d.icons.heart;
    $('.fs-like').classList.toggle('on', liked);
    if (!player.playing) this.el.classList.remove('idle');
    this.renderQueue();
    if (this.trackId === t.id) return this.tick();
    this.trackId = t.id;
    this.lastLine = -2;
    const img = $('.fs-art img');
    img.src = t.cover || '';
    img.style.visibility = t.cover ? 'visible' : 'hidden';
    $('.fs-title').textContent = t.title;
    $('.fs-artist').textContent = t.artist + (t.album ? ` · ${t.album}` : '');
    this.el.style.setProperty('--fs-bg', backgroundFrom(null));
    if (t.cover) {
      this.d.api.coverColor(t.cover).then((rgb) => {
        if (this.trackId === t.id) this.el.style.setProperty('--fs-bg', backgroundFrom(rgb));
      }).catch(() => {});
    }
    this.lyrics = undefined;
    this.renderLyrics();
    this.d.ensureLyrics().then((data) => {
      if (this.trackId !== t.id) return;
      this.lyrics = data || null;
      this.renderLyrics();
    });
    this.tick();
  }

  renderLyrics() {
    if (!this.el) return;
    const box = this.$('.fs-lyrics');
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
    box.innerHTML = (d.synced ? '' : '<div class="fs-plain-label">Текст без таймингов</div>') +
      d.lines.map((l, i) => `<p data-i="${i}" ${d.synced ? `data-t="${l.time}"` : ''}>${esc(l.text) || '♪'}</p>`).join('');
    this.lastLine = -2;
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

  /** Время: прогресс и текущая строка */
  tick(force) {
    if (!this.open || !this.el) return;
    const a = this.d.player.audio;
    const dur = this.duration();
    const cur = a.currentTime || 0;
    // пока тянут ползунок, он стоит под курсором, а не там, где играет
    if (this.seeking == null) this.paintProgress(dur ? Math.min(1, cur / dur) : 0, dur);
    const d = this.lyrics;
    if (!d || !d.synced || !this.showLyrics) return;
    const time = cur + 0.25;
    let idx = -1;
    for (let i = 0; i < d.lines.length; i++) if (d.lines[i].time <= time) idx = i;
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
