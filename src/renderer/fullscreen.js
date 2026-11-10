// Полноэкранный режим (макет «Новый стиль · Сейчас играет»): обложка — большая «печенька», уходящая за левый
// край; справа — откуда играет, крупное название, текст песни и управление внизу. Фон — затемнённый цвет обложки.
// Колёсико над текстом разворачивает его на весь экран, через 4 секунды без прокрутки он сжимается обратно.
// Печенька медленно катится, пока играет музыка (обложка внутри стоит ровно — крутится только кромка), за ней —
// такая же фигура цвета обложки. Открывается перелётом из плашки плеера: обложка вкатывается на место,
// название и текст поднимаются следом. При смене трека печенька перекатывается в сторону следующего.

import { toggleLine, drawCard, ensureFonts, FORMATS, MAX_LINES } from './lyric-card.js';
import { coverOf, templateCover } from './covers.js';

/** Кромка «печеньки» для clip-path: n зубцов, глубина amp (0…1). Проценты — фигура тянется за размером блока */
export function cookiePolygon(n = 10, amp = 0.05, steps = 120) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const r = 50 * (1 - amp) + 50 * amp * Math.cos(n * t);
    pts.push(`${(50 + r * Math.sin(t)).toFixed(2)}% ${(50 - r * Math.cos(t)).toFixed(2)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

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
      <div class="fs-art-wrap">
        <div class="fs-halo" aria-hidden="true"></div>
        <div class="fs-art"><div class="fs-roll"><img alt=""></div></div>
      </div>
      <div class="fs-top">
        <button class="fs-round fs-sharebtn" data-fs="share" aria-label="Карточка со строками" title="Карточка со строками текста"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3l3-3V9a2 2 0 0 0-1-2zM20 7h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3l3-3V9a2 2 0 0 0-1-2z"/></svg></button>
        <button class="fs-round fs-qbtn" data-fs="queue" aria-label="Очередь" title="Очередь" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h10M17 15v6l4-3z"/></svg></button>
        <button class="fs-round" data-fs="exit" aria-label="Выйти из полного экрана" title="Выйти из полного экрана (Esc)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg></button>
      </div>
      <div class="fs-stage">
        <div class="fs-head">
          <div class="fs-from"></div>
          <h1 class="fs-title"></h1>
          <div class="fs-artist"></div>
        </div>
        <div class="fs-right">
          <div class="fs-lyrics" aria-live="off"></div>
          <div class="fs-credit"></div>
          <div class="fs-pick" hidden><span class="fs-pick-n"></span><button class="fs-pill" data-fs="pick-cancel">Отмена</button><button class="fs-pill primary" data-fs="pick-make" disabled>Карточка</button></div>
          <button class="fs-now" data-fs="now"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>К текущей строке</button>
        </div>
        <div class="fs-bottom">
          <div class="fs-seek"><span class="fs-cur">0:00</span><div class="fs-progress" data-fs="seek"><div class="fs-fill"></div><span class="fs-knob fs-ctl"></span></div><span class="fs-left-time">0:00</span></div>
          <div class="fs-controls fs-ctl">
            <button class="fs-btn" data-fs="prev" aria-label="Предыдущий"></button>
            <button class="fs-play" data-fs="play" aria-label="Играть"></button>
            <button class="fs-btn" data-fs="next" aria-label="Следующий"></button>
            <span class="fs-gap"></span>
            <button class="fs-round fs-like" data-fs="like" aria-label="Мне нравится"></button>
            <button class="fs-round fs-lyr" data-fs="lyrics" aria-label="Текст" title="Текст"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg></button>
            <button class="fs-round" data-fs="more" aria-label="Ещё" title="Действия с треком"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg></button>
          </div>
        </div>
      </div>
      <aside class="fs-queue" aria-label="Очередь">
        <div class="fs-q-head"><span>Очередь</span><span class="fs-q-sub"></span><button class="fs-round" data-fs="queue" aria-label="Закрыть очередь"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <div class="fs-q-list"></div>
      </aside>
      <div class="fs-card" hidden role="dialog" aria-label="Карточка со строками">
        <div class="fs-card-box">
          <canvas class="fs-card-canvas"></canvas>
          <div class="fs-card-side">
            <b>Карточка со строками</b>
            <span class="fs-card-hint">Для сторис или чата: обложка, строки, трек и ссылка на него.</span>
            <div class="fs-card-formats">${Object.entries(FORMATS).map(([k, f]) => `<button class="fs-pill" data-fs="card-format" data-v="${k}">${f.label}</button>`).join('')}</div>
            <button class="fs-pill primary" data-fs="card-copy">Скопировать</button>
            <button class="fs-pill" data-fs="card-save">Сохранить…</button>
            <button class="fs-pill" data-fs="card-close">Закрыть</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    const $ = (s) => el.querySelector(s);
    this.$ = $;
    el.style.setProperty('--fs-cookie', cookiePolygon(10, 0.05));
    const { player } = this.d;
    $('[data-fs="prev"]').innerHTML = this.d.icons.prev;
    $('[data-fs="next"]').innerHTML = this.d.icons.next;
    // очередь: перетаскивание строк (за любое место строки, удобнее — за точки справа)
    let dragFrom = -1;
    el.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('.fs-q-row');
      if (!row) return;
      dragFrom = Number(row.dataset.qi);
      row.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => {
      const row = e.target.closest && e.target.closest('.fs-q-row');
      if (!row || dragFrom < 0) return;
      e.preventDefault();
      el.querySelectorAll('.fs-q-row.drop').forEach((r) => r.classList.remove('drop'));
      row.classList.add('drop');
    });
    el.addEventListener('drop', (e) => {
      const row = e.target.closest && e.target.closest('.fs-q-row');
      if (!row || dragFrom < 0) return;
      e.preventDefault();
      player.move(dragFrom, Number(row.dataset.qi));
      dragFrom = -1;
      this.renderQueue(false, true);
    });
    el.addEventListener('dragend', () => {
      dragFrom = -1;
      el.querySelectorAll('.fs-q-row.dragging, .fs-q-row.drop').forEach((r) => r.classList.remove('dragging', 'drop'));
    });
    el.addEventListener('keydown', (e) => {
      const row = e.target.closest && e.target.closest('.fs-q-row');
      if (row && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-qmenu]')) {
        e.preventDefault();
        player.playAt(Number(row.dataset.qi));
      }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fs]');
      const line = e.target.closest('[data-t]');
      const qm = e.target.closest('[data-qmenu]');
      if (qm) {
        // точки у трека: меню без правой кнопки
        const i = Number(qm.dataset.qmenu);
        const r = qm.getBoundingClientRect();
        if (this.d.menu && player.queue[i]) this.d.menu(r.left, r.bottom + 4, player.queue[i], i);
        return;
      }
      const qi = e.target.closest('[data-qi]');
      if (qi) {
        player.playAt(Number(qi.dataset.qi));
        return;
      }
      // выбор строк для карточки: касание строки выделяет её, а не перематывает
      const pickLine = this.picking && e.target.closest('.fs-lyrics [data-i]');
      if (pickLine) {
        this.pickToggle(Number(pickLine.dataset.i));
        return;
      }
      if (line && !this.picking) {
        player.seek(Number(line.dataset.t));
        return;
      }
      if (!b) return;
      const a = b.dataset.fs;
      if (a === 'share') this.picking ? this.endPick() : this.startPick();
      else if (a === 'lyr-other') this.otherSource();
      else if (a === 'pick-cancel') this.endPick();
      else if (a === 'pick-make') this.openCard();
      else if (a === 'card-format') this.renderCard(b.dataset.v);
      else if (a === 'card-copy') this.cardCopy();
      else if (a === 'card-save') this.cardSave();
      else if (a === 'card-close') this.closeCard();
      else if (a === 'exit') this.close();
      else if (a === 'queue') this.toggleQueue();
      else if (a === 'now') this.collapse();
      else if (a === 'more') {
        const r = b.getBoundingClientRect();
        if (this.d.menu && player.current) this.d.menu(r.left, r.top - 8, player.current, player.index);
      }
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

  /** Отступы текста, чтобы текущая строка вставала посередине своего блока */
  layout() {
    if (!this.open || !this.el) return;
    const box = this.$('.fs-lyrics');
    if (box && !box.classList.contains('plain')) {
      // меряем без старых отступов: блок не сжимается меньше своих отступов, и прежние (от развёрнутого
      // на весь экран текста) не давали ему вернуться к прежней высоте
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
    if (this.picking) return; // выбор строк: текст развёрнут, пока не закончили
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
      return `<div class="fs-q-row${i === player.index ? ' cur' : ''}${i < player.index ? ' past' : ''}" data-qi="${i}" role="button" tabindex="0" draggable="true"><span class="fs-q-art"><img src="${esc(coverOf(t))}" data-tpl="${esc(templateCover(t.id))}" alt="" loading="lazy"></span><span class="fs-q-meta"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></span>${t.duration ? `<span class="fs-q-dur">${fmt(t.duration)}</span>` : ''}<span class="fs-q-more" data-qmenu="${i}" role="button" tabindex="0" title="Меню трека · потяни, чтобы переставить" aria-label="Меню трека «${esc(t.title)}»"><svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3" r="1.6"/><circle cx="10" cy="3" r="1.6"/><circle cx="4" cy="9" r="1.6"/><circle cx="10" cy="9" r="1.6"/><circle cx="4" cy="15" r="1.6"/><circle cx="10" cy="15" r="1.6"/></svg></span></div>`;
    }).join('') : `<div class="fs-q-empty">${player.mode === 'wave' ? 'Моя волна подберёт следующий трек сама' : 'Очередь пуста'}</div>`;
    if (scroll) {
      const cur = list.querySelector('.cur');
      if (cur) list.scrollTop = Math.max(0, cur.offsetTop - 80);
    }
  }

  // ---------- Карточка со строками текста ----------

  startPick() {
    const d = this.lyrics;
    if (!(d && d.lines && d.lines.some((l) => l.text && l.text.trim()))) {
      if (this.d.toast) this.d.toast(d === undefined ? 'Текст ещё ищется' : 'Для этого трека текста нет', true);
      return;
    }
    if (!this.showLyrics) {
      this.showLyrics = true;
      this.renderLyrics();
    }
    this.toggleQueue(false);
    this.picking = true;
    this.picked = [];
    this.scrolling = true;
    clearTimeout(this.scrollTimer);
    this.el.classList.add('picking', 'expand');
    this.$('.fs-pick').hidden = false;
    this.$('[data-fs="share"]').setAttribute('aria-pressed', 'true');
    this.paintPick();
    this.layout();
  }

  endPick() {
    if (!this.picking) return;
    this.picking = false;
    this.picked = [];
    if (!this.el) return;
    this.el.classList.remove('picking');
    this.$('.fs-pick').hidden = true;
    this.$('[data-fs="share"]').setAttribute('aria-pressed', 'false');
    this.paintPick();
    this.collapse();
  }

  pickToggle(i) {
    const l = this.lyrics && this.lyrics.lines[i];
    if (!l || !String(l.text || '').trim()) return;
    this.picked = toggleLine(this.picked || [], i);
    this.paintPick();
  }

  paintPick() {
    if (!this.el) return;
    const set = new Set(this.picked || []);
    this.$('.fs-lyrics').querySelectorAll('p[data-i]').forEach((p) => p.classList.toggle('picked', set.has(Number(p.dataset.i))));
    const n = set.size;
    this.$('.fs-pick-n').textContent = n ? `Строк: ${n} из ${MAX_LINES}` : `Выбери до ${MAX_LINES} строк подряд`;
    this.$('[data-fs="pick-make"]').disabled = !n;
  }

  async openCard() {
    const t = this.d.player.current;
    if (!t || !(this.picked && this.picked.length)) return;
    this.card = {
      track: t,
      lines: this.picked.map((i) => this.lyrics.lines[i].text.trim()),
      format: this.card && this.card.format ? this.card.format : 'story',
      cover: null,
      rgb: null
    };
    this.$('.fs-card').hidden = false;
    this.el.classList.add('carding');
    await ensureFonts();
    this.renderCard();
    // обложку берём через main (без CORS — иначе canvas нельзя сохранить), цвет — тот же, что у фона
    const card = this.card;
    const [cover, rgb] = await Promise.all([
      coverOf(t) && this.d.api.card ? this.d.api.card.cover(coverOf(t)).catch(() => null) : null,
      coverOf(t) ? Promise.resolve(this.d.api.coverColor(coverOf(t))).catch(() => null) : null
    ]);
    if (this.card !== card) return;
    card.rgb = rgb;
    if (cover) {
      const img = new Image();
      img.onload = () => {
        if (this.card !== card) return;
        card.cover = img;
        this.renderCard();
      };
      img.src = cover;
    }
    this.renderCard();
  }

  renderCard(format) {
    const c = this.card;
    if (!c || !this.el) return;
    if (format && FORMATS[format]) c.format = format;
    const canvas = this.$('.fs-card-canvas');
    drawCard(canvas, {
      format: c.format,
      lines: c.lines,
      title: c.track.title,
      artist: c.track.artist,
      cover: c.cover,
      rgb: c.rgb,
      link: this.d.trackLink ? this.d.trackLink(c.track) : ''
    });
    canvas.classList.toggle('square', c.format === 'square');
    this.el.querySelectorAll('[data-fs="card-format"]').forEach((b) => b.classList.toggle('on', b.dataset.v === c.format));
  }

  cardName() {
    const t = this.card.track;
    return `Nyao — ${String(t.artist || '').split(',')[0].trim()} — ${t.title}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120) + '.png';
  }

  async cardCopy() {
    if (!this.card) return;
    try {
      await this.d.api.card.copy(this.$('.fs-card-canvas').toDataURL('image/png'));
      if (this.d.toast) this.d.toast('Картинка скопирована — вставь её в чат или сторис');
    } catch (e) {
      if (this.d.toast) this.d.toast(`Не скопировалось: ${e.message}`, true);
    }
  }

  async cardSave() {
    if (!this.card) return;
    try {
      const file = await this.d.api.card.save(this.$('.fs-card-canvas').toDataURL('image/png'), this.cardName());
      if (file && this.d.toast) this.d.toast('Картинка сохранена');
    } catch (e) {
      if (this.d.toast) this.d.toast(`Не сохранилось: ${e.message}`, true);
    }
  }

  closeCard() {
    this.card = null;
    if (!this.el) return;
    this.$('.fs-card').hidden = true;
    this.el.classList.remove('carding');
    this.endPick();
  }

  /** Esc: сначала закрывает очередь, потом сам полный экран */
  escape() {
    if (this.card) {
      this.closeCard();
      return true;
    }
    if (this.picking) {
      this.endPick();
      return true;
    }
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
    if (this.card) this.closeCard();
    else this.endPick();
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

  /** Всё, кроме обложки, по порядку появления: откуда играет, название, исполнитель, текст, управление, кнопки */
  parts() {
    return Array.from(this.el.querySelectorAll('.fs-from, .fs-title, .fs-artist, .fs-right, .fs-bottom, .fs-top, .fs-queue'));
  }

  animateOpen() {
    const art = this.$('.fs-art');
    const from = this.sourceRect();
    const done = () => {
      document.body.classList.add('fs-on');
      const src = this.sourceEl();
      if (src) src.style.visibility = '';
    };
    const to = art && art.getBoundingClientRect ? art.getBoundingClientRect() : null;
    if (!this.canAnimate() || !to || !to.width || !this.open) return done();
    this.el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    const src = this.sourceEl();
    if (src) src.style.visibility = 'hidden'; // обложка «улетела» из плашки — там её не показываем
    const bg = getComputedStyle(this.el).backgroundColor;
    const spring = 'cubic-bezier(.2, .9, .25, 1.06)';
    const D = 860;
    this.el.animate([{ backgroundColor: 'transparent' }, { backgroundColor: bg }], { duration: 380, easing: 'ease-out' });
    // печенька вкатывается из плашки на место: растёт, проворачивается на треть оборота и чуть пружинит
    const fly = art.animate([
      { transform: `${this.flight(from, to)} rotate(-130deg)` },
      { transform: 'translate(0px, 0px) scale(1) rotate(0deg)' }
    ], { duration: D, easing: spring });
    const halo = this.$('.fs-halo');
    if (halo && halo.animate) halo.animate([{ opacity: 0, transform: 'scale(.6) rotate(-60deg)' }, { opacity: 0, transform: 'scale(.7) rotate(-40deg)', offset: 0.4 }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }], { duration: D + 240, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    // остальное поднимается следом, по очереди сверху вниз
    this.parts().forEach((p, i) => p.animate([
      { opacity: 0, transform: 'translateY(26px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 560, delay: 260 + i * 55, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' }));
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
    const from = art && art.getBoundingClientRect ? art.getBoundingClientRect() : null;
    if (!to || !from || !from.width) return finish();
    const src = this.sourceEl();
    if (src) src.style.visibility = 'hidden';
    const bg = getComputedStyle(this.el).backgroundColor;
    this.el.animate([{ backgroundColor: bg }, { backgroundColor: 'transparent' }], { duration: 360, easing: 'ease-in', fill: 'forwards' });
    this.parts().forEach((p) => p.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(14px)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }));
    const halo = this.$('.fs-halo');
    if (halo && halo.animate) halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
    // обратно в плашку: сжимается и докатывается на четверть оборота
    const fly = art.animate([{ transform: 'translate(0px, 0px) scale(1) rotate(0deg)' }, { transform: `${this.flight(to, from)} rotate(-90deg)` }], { duration: 440, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
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

  /** Смена трека при открытом экране: печенька перекатывается в сторону следующего, название поднимается заново */
  coverFlow(dir) {
    const art = this.$('.fs-art');
    if (!art || typeof art.animate !== 'function' || this.closing) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ease = 'cubic-bezier(.2, .8, .2, 1)';
    art.animate([
      { transform: `rotate(${dir * -80}deg) scale(.86)`, opacity: 0.2 },
      { transform: 'rotate(0deg) scale(1)', opacity: 1 }
    ], { duration: 640, easing: ease });
    ['.fs-title', '.fs-artist'].forEach((sel, i) => {
      const n = this.$(sel);
      if (n && n.animate) n.animate([{ opacity: 0, transform: `translateY(${dir * 18}px)` }, { opacity: 1, transform: 'translateY(0)' }], { duration: 460, delay: 60 + i * 50, easing: ease, fill: 'backwards' });
    });
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
      this.el.classList.toggle('paused', !player.playing);
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
      // обложка всегда есть: своя или шаблонный диск (иначе на экране оставалась прошлая)
      const art = coverOf(t);
      const img = $('.fs-art img');
      img.dataset.tpl = templateCover(t.id);
      img.src = art;
      img.style.visibility = 'visible';
      if (prevId) this.coverFlow(dir);
      // откуда играет: волна, плейлист, альбом…
      const from = player.mode === 'wave' ? 'Моя волна' : player.label || '';
      $('.fs-from').textContent = from ? `Играет из · ${from}` : 'Сейчас играет';
      $('.fs-title').textContent = t.title || '';
      $('.fs-artist').textContent = (t.artist || '') + (t.album ? ` · ${t.album}` : '');
      this.el.style.setProperty('--fs-bg', backgroundFrom(null));
      this.el.style.setProperty('--fs-glow', glowFrom(null));
    });
    this.safe(() => this.renderQueue());
    if (coverOf(t)) {
      let colorPromise;
      try {
        colorPromise = this.d.api.coverColor(coverOf(t));
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
    // трек сменился — выбор строк прошлого трека теряет смысл (открытая карточка остаётся со своими строками)
    if (this.picking && !this.card) this.endPick();
    this.tried = [];
    this.loadLyrics();
    this.safe(() => this.tick());
  }

  /** Загрузить текст текущего трека; opts.exclude — пропустить эти источники («другой источник») */
  loadLyrics(opts = null) {
    const t = this.d.player.current;
    if (!t) return;
    this.lyrics = undefined;
    const box = this.$('.fs-lyrics');
    if (box) box.dataset.track = '';
    this.safe(() => this.renderLyrics());
    let lyricsPromise;
    try {
      lyricsPromise = this.d.ensureLyrics(opts);
    } catch (e) {
      lyricsPromise = Promise.resolve(null);
    }
    this.withTimeout(lyricsPromise, 15000).then((data) => {
      if (this.trackId !== t.id) return;
      // «другой источник» ничего не нашёл — говорим об этом и возвращаемся к обычному поиску
      if (opts && opts.exclude && opts.exclude.length && !(data && data.lines && data.lines.length)) {
        if (this.d.toast) this.d.toast('Других источников с этим текстом нет');
        this.tried = [];
        return this.loadLyrics({ exclude: [] });
      }
      this.lyrics = data || null;
      this.safe(() => this.renderLyrics());
    });
  }

  /** Порядок источников поменяли в настройках — ищем заново */
  reloadLyrics() {
    this.tried = [];
    if (this.open) this.loadLyrics({ exclude: [] });
  }

  /** «Текст: …» → попробовать следующий источник для этого трека */
  otherSource() {
    const d = this.lyrics;
    if (!d || !d.provider) return;
    this.tried = [...new Set([...(this.tried || []), d.provider])];
    this.loadLyrics({ exclude: this.tried });
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
    const credit = this.$('.fs-credit');
    credit.innerHTML = has ? `Текст: ${esc(d.source || 'LRCLIB')}${d.provider ? ' · <button class="fs-credit-btn" data-fs="lyr-other">другой источник</button>' : ''}` : '';
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
