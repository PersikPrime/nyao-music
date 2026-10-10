import { Player } from './player.js';
import { Ribbon } from './ribbon.js';
import { Onboarding } from './onboarding.js';

const api = window.nyao;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const player = new Player($('#audio'));

// ---------- Тема по системе: macOS — Liquid Glass, остальное — Windows ----------
const THEME = new URLSearchParams(location.search).get('theme') || (api.platform === 'darwin' ? 'mac' : 'win');
document.body.classList.add(THEME);
const IS_MAC = THEME === 'mac';

const state = {
  route: 'home',
  params: {},
  stack: [],
  status: { ya: null, yt: null, sc: null },
  update: { info: null, checking: false, progress: null, error: null },
  cloud: { loggedIn: false, user: null, logging: false, devices: null, others: [] },
  settings: null,
  home: null,
  lib: { lists: null, filter: 'all', selected: 'liked', tracks: null, counts: null },
  search: { q: '', res: null, filter: 'all', loading: false },
  tab: 'cover',
  lyrics: { id: null, data: undefined },
  artist: { ref: null, data: null, error: null, kind: 'album' },
  album: { ref: null, data: null, error: null },
  npArtist: { ref: null, data: null },
  version: ''
};
const lists = {}; // списки на экране: клики по строкам берут трек отсюда
const artistCache = new Map();

// ---------- Утилиты ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
function badge(source, extra = '') {
  if (source === 'ya') return `<span class="badge ya ${extra}">Я</span>`;
  if (source === 'yt') return `<span class="badge yt ${extra}">YT</span>`;
  if (source === 'sc') return `<span class="badge sc ${extra}">SC</span>`;
  if (source === 'mix') return '<span class="badge mix">Я+YT</span>';
  return '';
}
const RING = { ya: '#FFD60A', yt: '#FF6A5C', sc: '#FF8A3D', mix: '#C6B8FF' };
function coverHtml(item, cls = '', withBadge = false) {
  const src = item && item.source;
  const bgCls = src === 'ya' ? 'ya-bg' : src === 'yt' ? 'yt-bg' : src === 'sc' ? 'sc-bg' : '';
  const ring = `<svg width="45%" height="45%" viewBox="0 0 72 72" fill="none" stroke="${RING[src] || RING.mix}" stroke-width="3"><circle cx="36" cy="36" r="26"/><circle cx="36" cy="36" r="12"/></svg>`;
  const img = item && item.cover ? `<img src="${esc(item.cover)}" alt="" loading="lazy">` : '';
  return `<div class="cover ${cls} ${bgCls}">${ring}${img}${withBadge ? badge(src) : ''}</div>`;
}
function artistLink(t) {
  if (!t.artistRef) return esc(t.artist);
  return `<button class="link-plain" data-action="open-artist" data-ref="${esc(t.artistRef)}">${esc(t.artist)}</button>`;
}
function rowHtml(t, i, key, opts = {}) {
  const cur = player.current && player.current.id === t.id;
  return `<div class="trow ${cur ? 'cur' : ''} ${t.available === false ? 'unavail' : ''}" data-action="${opts.action || 'play-row'}" data-list="${key}" data-i="${i}">
    ${opts.num === false ? '' : `<span class="n">${cur ? '▶' : i + 1}</span>`}
    ${coverHtml(t, 'xs')}
    <div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${artistLink(t)}</div></div>
    ${badge(t.source)}
    <span class="dur">${t.duration ? fmt(t.duration) : ''}</span>
    <button class="more" data-action="row-more" data-list="${key}" data-i="${i}" aria-label="Действия с треком"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
  </div>`;
}
function tracksHtml(tracks, key, opts) {
  lists[key] = tracks;
  return `<div class="tracks">${tracks.map((t, i) => rowHtml(t, i, key, opts)).join('')}</div>`;
}

// Объединённые строки (исполнитель/альбом): у строки до двух вариантов — ya и yt
function sourcePref() {
  return (state.settings && state.settings.sourcePref) || 'auto';
}
function pick(row, pref = sourcePref()) {
  if (pref === 'ya') return row.ya || null;
  if (pref === 'yt') return row.yt || null;
  return row.ya || row.yt || null;
}
function availHtml(row, chosen) {
  const one = (src) => {
    if (!row[src]) return `<span class="badge off">${src === 'ya' ? 'Я' : 'YT'}</span>`;
    return badge(src, chosen && chosen.source === src ? '' : 'dim');
  };
  return `<span class="avail">${one('ya')}${one('yt')}</span>`;
}
function mergedRowHtml(row, i, key, opts = {}) {
  const t = pick(row);
  const cur = t && player.current && (player.current.id === (row.ya && row.ya.id) || player.current.id === (row.yt && row.yt.id));
  const any = row.ya || row.yt;
  return `<div class="trow ${cur ? 'cur' : ''} ${t ? '' : 'unavail'}" data-action="play-merged" data-list="${key}" data-i="${i}">
    <span class="n">${cur ? '▶' : i + 1}</span>
    ${opts.cover === false ? '' : coverHtml({ cover: row.cover, source: any && any.source }, 'xs')}
    <div class="meta"><div class="t">${esc(row.title)}</div><div class="s">${any ? artistLink(any) : ''}</div></div>
    ${availHtml(row, t)}
    <span class="dur">${row.duration ? fmt(row.duration) : ''}</span>
  </div>`;
}
function playMerged(rows, index, label) {
  const playable = [];
  let start = 0;
  rows.forEach((r, i) => {
    const t = pick(r);
    if (!t) return;
    if (i === index) start = playable.length;
    playable.push(t);
  });
  if (!playable.length) return toast('В выбранном источнике этих треков нет', true);
  player.playList(playable, start, label);
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${isErr ? 'err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 4200);
}
function setRangeFill(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}
const SETTINGS_ICON_SM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>';
const ICONS = {
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>',
  playBig: '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z"/></svg>',
  pauseBig: '<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.4"/><rect x="14" y="4" width="4" height="16" rx="1.4"/></svg>',
  heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  heartOn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  shuffle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h3c4 0 6 10 10 10h3M4 17h3c1.5 0 2.7-1.4 3.7-3M14 9.5C15 8 16 7 17 7h3M18 4l2 3-2 3M18 14l2 3-2 3"/></svg>',
  repeat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V9a3 3 0 0 1 3-3h13l-3-3M20 13v2a3 3 0 0 1-3 3H4l3 3"/></svg>',
  tune: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  ban: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
  wave: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></svg>'
};
const NAV = [
  ['home', 'Главная', 'M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z'],
  ['search', 'Поиск', 'M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M20 20l-4.2-4.2'],
  ['wave', 'Моя волна', 'M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0'],
  ['player', 'Сейчас играет', 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0'],
  ['library', 'Медиатека', 'M5 4v16M10 4v16M15 5l4 15']
];
const SETTINGS_ICON = 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1';

const DIVERSITY = [['favorite', 'Любимое', 'Больше того, что ты уже лайкал, плюс сами лайки из YouTube Music.'], ['discover', 'Незнакомое', 'Только новое: в поток не попадёт ничего из твоих лайков.'], ['popular', 'Популярное', 'Хиты и то, что сейчас слушают чаще всего.']];
const MOODS = [['active', 'Бодрое', '#FFB86B', 'M13 22h18M22 13v18'], ['fun', 'Весёлое', '#E8F06B', 'M14 25c3 4 13 4 16 0'], ['calm', 'Спокойное', '#7CE0C3', 'M13 22c3-3 6 3 9 0s6 3 9 0'], ['sad', 'Грустное', '#8FB4FF', 'M14 28c3-4 13-4 16 0']];

function balanceTrack(share) {
  const mid = 100 - share;
  const ytc = IS_MAC ? '#FF453A' : '#FF4433';
  return `linear-gradient(90deg, #FFD60A 0%, #FFD60A ${Math.max(0, mid - 9)}%, var(--accent) ${mid}%, ${ytc} ${Math.min(100, mid + 9)}%, ${ytc} 100%)`;
}
function shareLabel(share) {
  const extra = [state.status.yt && 'YT', state.status.sc && 'SC'].filter(Boolean).join('+');
  if (!extra) return 'YouTube Music и SoundCloud не подключены';
  if (!state.status.ya) return `только ${extra}`;
  if (share === 0) return 'только Яндекс';
  if (share === 100) return `только ${extra}`;
  return share >= 50 ? `каждый ${Math.round(100 / (100 - share))}-й трек — Яндекс` : `каждый ${Math.round(100 / share)}-й трек — ${extra}`;
}
function waveControlsHtml(compact = false) {
  const s = state.settings || {};
  const share = s.ytmShare ?? 30;
  const cur = DIVERSITY.find((d) => d[0] === s.waveDiversity) || DIVERSITY[0];
  return `
  <div class="card">
    <span class="eyebrow">Характер</span>
    <div class="seg" role="radiogroup">${DIVERSITY.map(([v, l]) => `<button role="radio" aria-checked="${s.waveDiversity === v}" class="${s.waveDiversity === v ? 'on' : ''}" data-action="wave-div" data-v="${v}">${l}</button>`).join('')}</div>
    ${compact ? '' : `<span class="hint">${cur[2]}</span>`}
  </div>
  <div class="card">
    <span class="eyebrow">Настроение</span>
    <div class="moods">${MOODS.map(([v, l, c, g]) => `<button class="drop ${s.waveMood === v ? 'on' : ''}" style="--c:${c}" aria-pressed="${s.waveMood === v}" data-action="wave-mood" data-v="${v}"><span class="ball"><svg viewBox="0 0 44 44" fill="none"><path d="${g}" stroke="#000" stroke-width="2.6" stroke-linecap="round"/></svg></span>${l}</button>`).join('')}</div>
  </div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="eyebrow">Баланс источников</span><span style="font-size:12px;color:var(--accent)" id="share-label">${shareLabel(share)}</span></div>
    <div class="balance"><div class="track" id="share-track" style="background:${balanceTrack(share)}"></div><input type="range" min="0" max="100" step="5" value="${share}" data-input="share" aria-label="Доля YouTube Music"></div>
    <div class="balance-legend"><span>${badge('ya')}<b id="share-ya">${100 - share}%</b></span><span><b id="share-yt">${share}%</b>${badge('yt')}${state.status.sc ? badge('sc') : ''}</span></div>
  </div>`;
}

// ---------- Навигация ----------
function renderRail() {
  const btn = (route, label, d) => `<button class="nav-btn ${state.route === route ? 'active' : ''}" data-route="${route}" aria-label="${label}" title="${label}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg><span class="lbl">${label}</span></button>`;
  let extra = '';
  if (IS_MAC) {
    const pls = (state.lib.lists || []).slice(0, 7);
    const colors = { ya: '#FFD60A', yt: '#FF453A', sc: '#FF5500', mix: '#7A6CFF' };
    extra = `<div class="side-extra">
      ${pls.length ? '<div class="side-title">Плейлисты</div>' : ''}
      ${pls.map((p) => `<button class="side-pl" data-open-pl="${esc(p.id)}"><span class="sw" style="background:${colors[p.source] || '#7A6CFF'}"></span><span class="nm">${esc(p.title)}</span></button>`).join('')}
    </div>`;
  }
  const accounts = IS_MAC ? `<div class="side-accounts">${accountButton()}</div>` : '';
  $('#rail').innerHTML = NAV.map((n) => btn(...n)).join('') + extra + '<div class="spacer"></div>' + btn('settings', 'Настройки', SETTINGS_ICON) + accounts;
}
// Подключаемые сервисы. Новый сервис (VK Музыка, SoundCloud…) добавляется сюда — кнопка аккаунта и меню подхватят его сами
/** Название сервиса: в родительном падеже («из Яндекс Музыки») или обычное */
function srcName(source, gen = false) {
  if (source === 'ya') return gen ? 'Яндекс Музыки' : 'Яндекс Музыка';
  if (source === 'sc') return 'SoundCloud';
  if (source === 'mix') return gen ? 'моего микса' : 'Мой микс';
  return 'YouTube Music';
}
const SERVICES = [
  { id: 'ya', short: 'Я', name: 'Яндекс Музыка', bg: 'var(--ya)', fg: '#000' },
  { id: 'yt', short: 'YT', name: 'YouTube Music', bg: 'var(--yt-bright)', fg: '#fff' },
  { id: 'sc', short: 'SC', name: 'SoundCloud', bg: 'var(--sc)', fg: '#fff' }
];
function svcDot(s, on = true) {
  return `<span class="dot ${on ? '' : 'off'}" style="background:${s.bg};color:${s.fg}">${s.short}</span>`;
}
/** Одна кнопка «Аккаунт» вместо пилюли на каждый сервис: аватар с именем и стопка значков подключённых сервисов */
function accountButton() {
  const first = SERVICES.map((s) => state.status[s.id]).find(Boolean);
  const cu = state.cloud.loggedIn && state.cloud.user;
  const name = cu ? cu.name : first ? first.name : 'Войти';
  const initial = first ? esc(String(first.name).trim().charAt(0).toUpperCase()) : '+';
  return `<button class="acc-btn ${first || cu ? '' : 'off'}" data-acc-menu aria-label="Аккаунт" title="Аккаунт">
    ${cu ? nyaoAvatar('av') : `<span class="av">${initial}</span>`}
    <span class="nm">${esc(name)}</span>
    <span class="stack">${SERVICES.map((s) => svcDot(s, !!state.status[s.id])).join('')}</span>
  </button>`;
}
function openAccountMenu(anchor) {
  const menu = $('#menu');
  const cu = state.cloud.user;
  menu.innerHTML = `<div class="lbl">Аккаунт</div>
    <div class="acc-row">${nyaoAvatar('dot')}
      <span class="acc-info"><b>Аккаунт Nyao</b><span>${state.cloud.loggedIn && cu ? esc(cu.name) : 'синхронизация устройств'}</span></span>
      ${state.cloud.loggedIn ? '<button class="acc-act" data-a="settings">Открыть</button>' : `<button class="acc-act primary" data-a="cloud-login" ${state.cloud.logging ? 'disabled' : ''}>${state.cloud.logging ? 'Жду…' : 'Войти'}</button>`}
    </div>
    ${SERVICES.map((s) => {
      const st = state.status[s.id];
      return `<div class="acc-row">${svcDot(s, !!st)}
        <span class="acc-info"><b>${s.name}</b><span>${st ? esc(st.name) : 'не подключено'}</span></span>
        <button class="acc-act ${st ? '' : 'primary'}" data-a="${st ? 'logout' : 'login'}" data-svc="${s.id}">${st ? 'Выйти' : 'Войти'}</button>
      </div>`;
    }).join('')}
    <button data-a="settings">${SETTINGS_ICON_SM} Настройки аккаунтов</button>`;
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const left = IS_MAC ? r.left : r.right - m.width;
  const top = IS_MAC ? r.top - m.height - 8 : r.bottom + 8;
  menu.style.left = `${Math.max(8, Math.min(left, innerWidth - m.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(top, innerHeight - m.height - 8))}px`;
  menu.onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.a === 'settings') {
      menu.hidden = true;
      return go('settings');
    }
    if (b.dataset.a === 'cloud-login') {
      menu.hidden = true;
      return cloudLogin();
    }
    const svc = b.dataset.svc;
    const meta = SERVICES.find((s) => s.id === svc);
    menu.hidden = true;
    try {
      if (b.dataset.a === 'login') {
        await api.auth.login(svc);
        toast(`${meta.name}: вход выполнен`);
      } else {
        await api.auth.logout(svc);
        toast(`${meta.name}: выход выполнен`);
      }
    } catch (err) {
      toast(err.message, true);
    }
    await afterAuthChange();
  };
}
function renderAccounts() {
  if (!IS_MAC) $('#accounts').innerHTML = accountButton();
  renderRail();
}

function go(route, params = {}, push = true) {
  if (push && (state.route !== route || JSON.stringify(state.params) !== JSON.stringify(params))) {
    state.stack.push({ route: state.route, params: state.params });
    if (state.stack.length > 30) state.stack.shift();
  }
  state.route = route;
  state.params = params;
  renderRail();
  view.scrollTop = 0;
  RENDER[route]();
  if (route === 'home') loadHome();
  if (route === 'library') loadLibrary();
  if (route === 'artist') loadArtist(params.ref);
  if (route === 'album') loadAlbum(params.ref);
  if (route === 'player') loadNpArtist();
  if (route === 'settings' && state.cloud.loggedIn) loadCloudDevices();
}
function back() {
  const prev = state.stack.pop();
  if (prev) go(prev.route, prev.params, false);
  else go('home', {}, false);
}

// ---------- Экраны ----------
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function renderHome() {
  const loggedAny = state.status.ya || state.status.yt;
  const name = (state.status.ya && state.status.ya.name) || '';
  const h = state.home;
  const ytSection = h && h.ytHome.find((s) => s.tracks.length);
  const tiles = h ? [...h.mixes, ...h.yaPlaylists, ...h.ytHome.flatMap((s) => s.playlists)].slice(0, 12) : [];
  const waveOn = player.mode === 'wave' && player.playing;
  view.innerHTML = `<div class="scroll">
    <div class="home-top">
      <h1 class="page">${greeting()}${name ? ', ' + esc(name.split(' ')[0]) : ''}</h1>
      <form class="search-field" data-form="home-search">${ICONS.search}<input name="q" type="search" placeholder="Поиск в Яндексе, YouTube Music и SoundCloud" aria-label="Поиск"></form>
    </div>
    ${continueHtml()}
    ${!loggedAny ? `<div class="card"><div class="field"><label>Подключи сервисы</label><div class="hint">Войди в Яндекс Музыку и/или YouTube Music — после этого здесь появятся волна, плейлисты и лайки.</div></div><div><button class="btn primary" data-action="go" data-route="settings">Открыть настройки</button></div></div>` : ''}
    <div class="hero">
      <section class="wave-card">
        <canvas id="home-ribbon"></canvas>
        <span class="eyebrow">${SERVICES.filter((x) => state.status[x.id]).map((x) => (x.id === 'ya' ? 'Яндекс' : x.name)).join(' + ') || 'Нужен вход'}</span>
        <h2>Моя волна</h2>
        <div class="actions">
          <button class="btn primary" data-action="wave-toggle" ${loggedAny ? '' : 'disabled'}>${waveOn ? ICONS.pause + 'Пауза' : ICONS.play + 'Слушать'}</button>
          <button class="btn" data-action="go" data-route="wave">${ICONS.tune}Настроить</button>
        </div>
      </section>
      ${ytSection ? `<button class="yt-card" data-action="play-section">
        <div style="display:flex;align-items:center;gap:8px">${badge('yt')}<span class="muted" style="font-size:12px">С главной YouTube Music</span></div>
        <div class="art">${ytSection.tracks.slice(0, 4).map((t) => (t.cover ? `<img src="${esc(t.cover)}" alt="">` : '<div></div>')).join('')}</div>
        <h3>${esc(ytSection.title)}</h3>
        <span class="muted" style="font-size:13px">${ytSection.tracks.length} треков · включить</span>
      </button>` : ''}
    </div>
    ${!h && loggedAny ? '<div class="skeleton" style="height:220px"></div>' : ''}
    ${tiles.length ? `<section><div class="sec-head"><h2 class="sec">Плейлисты и миксы</h2><button class="link" data-action="go" data-route="library">Вся медиатека</button></div>
      <div class="tiles">${tiles.map((p) => `<button class="tile" data-action="open-pl" data-id="${esc(p.id)}">${coverHtml(p, '', true)}<div class="t">${esc(p.title)}</div><div class="s">${esc(p.sub || (p.count ? p.count + ' треков' : ''))}</div></button>`).join('')}</div></section>` : ''}
    ${ytSection ? `<section><h2 class="sec" style="margin-bottom:12px">${esc(ytSection.title)}</h2>${tracksHtml(ytSection.tracks.slice(0, 8), 'home-yt')}</section>` : ''}
  </div>`;
  if (ytSection) lists['home-section'] = ytSection.tracks;
  new Ribbon($('#home-ribbon'), { lines: 14, cy: 0.42, amp: 0.9, accent: IS_MAC ? '#D8CEFF' : '#C6B8FF' });
}

function renderWave() {
  const t = player.current;
  const waveOn = player.mode === 'wave';
  const playing = waveOn && player.playing;
  const next = waveOn ? player.queue.slice(player.index + 1, player.index + 6) : [];
  view.innerHTML = `<div class="wave-view">
    <section class="wave-hero">
      <canvas id="wave-ribbon"></canvas>
      <div class="top"><span class="srcs"><span class="dotsrc ya"></span>Яндекс<span style="opacity:.4">+</span><span class="dotsrc yt"></span>YouTube Music<span style="opacity:.4">→</span><span style="color:var(--accent)">одна волна</span></span><span></span></div>
      <div class="center">
        <h1 class="wave-title">Моя волна</h1>
        <button class="wave-play" data-action="wave-toggle" aria-label="${playing ? 'Пауза' : 'Слушать волну'}">${playing ? ICONS.pauseBig : ICONS.playBig}</button>
        ${waveOn && t ? `<button class="now-pill" data-action="go" data-route="player">${coverHtml(t, '')}<span class="ttl">${esc(t.title)}</span><span class="muted">${esc(t.artist)}</span>${badge(t.source)}</button>` : ''}
      </div>
    </section>
    <section class="wave-panels">${waveControlsHtml()}</section>
    <section class="next-up">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px"><h2 class="sec" style="font-size:17px">Дальше в волне</h2><span class="hint">дослушанные и пропущенные треки учат ленту Яндекса</span></div>
      ${next.length ? `<div class="next-grid">${next.map((n, i) => `<button class="next-card" data-action="q-play" data-i="${player.index + 1 + i}">${coverHtml(n, 'xs')}<span class="meta"><span class="t" style="display:block">${esc(n.title)}</span><span class="s" style="display:block">${esc(n.artist)}</span></span><span class="dotsrc ${n.source}"></span></button>`).join('')}</div>` : '<div class="hint">Запусти волну — здесь появятся следующие треки.</div>'}
    </section>
  </div>`;
  $$('input[data-input="share"]', view).forEach(setRangeFill);
  new Ribbon($('#wave-ribbon'), { lines: 18, cy: 0.5, amp: 1, accent: '#C6B8FF' });
}

function renderPlayer() {
  const t = player.current;
  const tabs = [['cover', 'Обложка'], ['lyrics', 'Текст'], ['queue', 'Очередь']];
  let body = '';
  if (state.tab === 'cover') {
    body = t ? `<div class="np-cover">
      ${coverHtml(t, 'np-art')}
      <div class="np-info">
        <div class="src-chips"><span class="src-chip">${badge(t.source)}Играет из ${srcName(t.source, true)}</span>${player.label ? `<span class="src-chip" style="padding-left:10px">${esc(player.label)}</span>` : ''}</div>
        <h1>${esc(t.title)}</h1>
        <div class="by">${t.artistRef ? `<button class="link-plain" data-action="open-artist" data-ref="${esc(t.artistRef)}">${esc(t.artist)}</button>` : esc(t.artist)}${t.album ? ` <span class="muted">·</span> ${t.albumRef ? `<button class="link-plain" data-action="open-album" data-ref="${esc(t.albumRef)}">${esc(t.album)}</button>` : esc(t.album)}` : ''}</div>
        <div class="row-actions">
          <button class="btn ${player.liked.has(t.id) ? 'primary' : ''}" data-action="like-cur">${player.liked.has(t.id) ? ICONS.heartOn : ICONS.heart}${player.liked.has(t.id) ? 'В «Мне нравится»' : 'Нравится'}</button>
          <button class="btn" data-action="cur-more">${ICONS.plus}В микс</button>
          ${player.mode === 'wave' ? `<button class="btn" data-action="go" data-route="wave">${ICONS.tune}Волна</button>` : ''}
        </div>
        <div class="lyric-peek" data-action="tab" data-v="lyrics"><span class="eyebrow">Текст</span><span class="cur" id="peek-cur">…</span><span class="nx" id="peek-nx"></span></div>
      </div>
    </div>` : `<div class="empty">Ничего не играет.<br><br><button class="btn primary" data-action="wave-toggle">${ICONS.play}Моя волна</button></div>`;
  } else if (state.tab === 'lyrics') {
    body = '<div class="lyrics" id="lyrics"></div>';
  } else {
    body = `<div class="qwrap"><div class="eyebrow" style="margin-bottom:8px">${player.mode === 'wave' ? 'Моя волна · без конца' : player.queue.length ? `Очередь · ${player.queue.length}` : 'Очередь пуста'}</div><div id="qlist">${tracksHtml(player.queue, 'queue', { action: 'q-play' })}</div></div>`;
  }
  const nx = player.queue[player.index + 1];
  const a = state.npArtist.data;
  view.innerHTML = `<div class="np">
    <div class="np-main">
      <div class="np-tabs" role="tablist">${tabs.map(([v, l]) => `<button role="tab" aria-selected="${state.tab === v}" class="${state.tab === v ? 'on' : ''}" data-action="tab" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="np-body" id="np-body">${body}</div>
    </div>
    <aside class="np-aside">
      ${t ? `<div class="np-card artist" ${t.artistRef ? `data-action="open-artist" data-ref="${esc(t.artistRef)}"` : ''}>
        <div class="ph">${a && a.cover ? `<img src="${esc(a.cover)}" alt="">` : ''}<span class="eyebrow" style="position:absolute;left:16px;top:14px;color:#fff">Об исполнителе</span></div>
        <div class="bd"><span style="font-size:18px;font-weight:700">${esc(a ? a.name : t.artist)}</span>
        <span class="muted" style="font-size:12px">${a ? [a.refs.ya ? 'есть в Яндексе' : '', a.refs.yt ? 'есть в YouTube Music' : ''].filter(Boolean).join(' · ') : 'Загружаю…'}</span>
        ${a && a.description ? `<span style="font-size:13px;color:var(--text2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(a.description)}</span>` : ''}</div>
      </div>` : ''}
      <div class="np-card">
        <div class="h"><span>Далее</span><button class="link" data-action="tab" data-v="queue">Открыть очередь</button></div>
        ${nx ? `<div style="display:flex;align-items:center;gap:12px;cursor:pointer" data-action="q-play" data-i="${player.index + 1}">${coverHtml(nx, 'xs')}<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nx.title)}</div><div class="muted" style="font-size:12px">${esc(nx.artist)}</div></div>${badge(nx.source)}</div>` : '<span class="muted" style="font-size:13px">Дальше пусто</span>'}
      </div>
      ${t ? `<div class="np-card"><div class="h"><span>Об этом треке</span></div><div class="facts">
        <span>Исполнитель</span><span>${esc(t.artist)}</span>
        ${t.album ? `<span>Альбом</span><span>${esc(t.album)}</span>` : ''}
        <span>Источник</span><span>${srcName(t.source)}</span>
        <span>Откуда</span><span>${esc(player.label || '—')}</span>
      </div></div>` : ''}
    </aside>
  </div>`;
  if (state.tab === 'lyrics') renderLyrics();
  else if (state.tab === 'queue') {
    const cur = $('#qlist .trow.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
  } else ensureLyrics().then(() => syncLyrics(true));
}

async function ensureLyrics() {
  const t = player.current;
  if (!t) return null;
  if (state.lyrics.id !== t.id) {
    state.lyrics = { id: t.id, data: undefined };
    const data = await api.lyrics(t).catch(() => null);
    if (state.lyrics.id !== t.id) return null;
    state.lyrics.data = data;
  }
  return state.lyrics.data;
}

async function renderLyrics() {
  const box = $('#lyrics');
  const t = player.current;
  if (!box) return;
  if (!t) {
    box.innerHTML = '<div class="empty">Ничего не играет</div>';
    return;
  }
  if (state.lyrics.id !== t.id || state.lyrics.data === undefined) box.innerHTML = '<div class="empty">Ищу текст…</div>';
  const d = await ensureLyrics();
  const el = $('#lyrics');
  if (!el || state.lyrics.id !== (player.current && player.current.id)) return;
  if (!d || !d.lines.length) {
    el.innerHTML = '<div class="empty">Текст не найден в LRCLIB</div>';
    return;
  }
  el.classList.toggle('plain', !d.synced);
  el.innerHTML = d.lines.map((l, i) => `<p data-i="${i}" ${d.synced ? `data-action="lyric-seek" data-t="${l.time}"` : ''}>${esc(l.text) || '♪'}</p>`).join('');
  syncLyrics(true);
}

let lastLyric = -1;
function syncLyrics(force) {
  const d = state.lyrics.data;
  if (!d || !d.synced) {
    const pc = $('#peek-cur');
    if (pc) pc.textContent = d === null || (d && !d.lines.length) ? 'Текст не найден' : d && !d.synced ? d.lines[0].text : '…';
    return;
  }
  const time = player.audio.currentTime + 0.25;
  let idx = -1;
  for (let i = 0; i < d.lines.length; i++) if (d.lines[i].time <= time) idx = i;
  if (idx === lastLyric && !force) return;
  lastLyric = idx;
  const pc = $('#peek-cur');
  if (pc) {
    pc.textContent = (d.lines[idx] && d.lines[idx].text) || '♪';
    $('#peek-nx').textContent = (d.lines[idx + 1] && d.lines[idx + 1].text) || '';
  }
  const el = $('#lyrics');
  if (!el) return;
  $$('p', el).forEach((p, i) => {
    p.classList.toggle('on', i === idx);
    p.classList.toggle('past', i < idx);
  });
  const on = el.querySelector('p.on');
  if (on) on.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
}

function libraryCounts() {
  const l = state.lib.lists || [];
  return { all: l.length + 1, ya: l.filter((p) => p.source === 'ya').length, yt: l.filter((p) => p.source === 'yt').length, sc: l.filter((p) => p.source === 'sc').length, mix: l.filter((p) => p.source === 'mix').length };
}

function renderLibrary() {
  const lib = state.lib;
  const c = libraryCounts();
  const liked = { id: 'liked', title: 'Мне нравится', source: 'mix', count: lib.counts ? lib.counts.ya + lib.counts.yt : 0, cover: null };
  const all = lib.lists ? [liked, ...lib.lists] : null;
  const shown = all ? all.filter((p) => lib.filter === 'all' || p.source === lib.filter || (p.id === 'liked' && lib.filter === 'mix')) : null;
  const sel = all ? all.find((p) => p.id === lib.selected) : null;
  const f = (v, label, dot) => `<button class="chip solid ${lib.filter === v ? 'on' : ''}" data-action="lib-filter" data-v="${v}">${dot ? `<span class="d" style="background:${dot}"></span>` : ''}${label}</button>`;
  const heart = (size) => `<div class="cover" style="background:#17142a">${ICONS.heartOn.replace('width="20" height="20"', `width="${size}" height="${size}" style="color:var(--accent)"`)}</div>`;
  view.innerHTML = `<div class="split">
    <div class="scroll">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <h1 class="page">Медиатека</h1>
        <button class="btn" data-action="new-mix">${ICONS.plus}Новый микс</button>
      </div>
      <div class="chips">${f('all', `Все · ${c.all}`)}${f('ya', 'Яндекс Музыка', 'var(--ya)')}${f('yt', 'YouTube Music', 'var(--yt-bright)')}${state.status.sc || c.sc ? f('sc', 'SoundCloud', 'var(--sc)') : ''}${f('mix', 'Мои миксы', 'var(--accent)')}</div>
      ${shown ? `<div class="tiles">${shown.map((p) => `<button class="tile ${p.id === lib.selected ? 'sel' : ''}" data-action="lib-select" data-id="${esc(p.id)}">
          ${p.id === 'liked' ? heart('40%') : coverHtml(p, '', true)}
          <div class="t">${esc(p.title)}</div><div class="s">${p.id === 'liked' ? 'Все сервисы' : esc(p.source === 'ya' ? 'Яндекс' : srcName(p.source))}${p.count ? ' · ' + p.count : ''}</div>
        </button>`).join('')}</div>` : '<div class="tiles">' + '<div class="skeleton" style="aspect-ratio:1"></div>'.repeat(8) + '</div>'}
    </div>
    <aside class="aside">
      ${sel ? `<div class="aside-head">
        <div class="pl-head">
          ${sel.id === 'liked' ? heart('50') : coverHtml(sel)}
          <div style="min-width:0"><span class="muted" style="font-size:12px">${sel.id === 'liked' ? 'Общий список лайков' : sel.source === 'mix' ? 'Смешанный плейлист' : sel.source === 'ya' ? 'Плейлист Яндекса' : sel.source === 'sc' ? 'Плейлист SoundCloud' : 'Плейлист YouTube Music'}</span>
          <h2>${esc(sel.title)}</h2>
          <span class="muted" style="font-size:12px">${lib.tracks ? `${lib.tracks.length} треков · ${fmt(lib.tracks.reduce((a, t) => a + (t.duration || 0), 0))}` : 'Загружаю…'}</span></div>
        </div>
        <div class="row-actions">
          <button class="btn primary" data-action="pl-play" ${lib.tracks && lib.tracks.length ? '' : 'disabled'}>${ICONS.play}Слушать</button>
          <button class="icbtn" data-action="pl-shuffle" aria-label="Перемешать">${ICONS.shuffle}</button>
          <span class="grow"></span>
          ${lib.tracks ? `<span class="counts"><span class="dotsrc ya"></span>${lib.tracks.filter((t) => t.source === 'ya').length}<span class="dotsrc yt" style="margin-left:6px"></span>${lib.tracks.filter((t) => t.source === 'yt').length}${lib.tracks.some((t) => t.source === 'sc') ? `<span class="dotsrc sc" style="margin-left:6px"></span>${lib.tracks.filter((t) => t.source === 'sc').length}` : ''}</span>` : ''}
          ${sel.source === 'mix' && sel.id !== 'liked' ? `<button class="icbtn" data-action="del-mix" aria-label="Удалить микс">${ICONS.ban}</button>` : ''}
        </div>
      </div>
      <div class="aside-scroll">${lib.tracks ? (lib.tracks.length ? tracksHtml(lib.tracks, 'lib', { num: false }) : `<div class="empty">${sel.source === 'mix' ? 'Микс пустой. Добавляй треки через «⋯» в любом списке.' : 'Здесь пока пусто'}</div>`) : '<div class="skeleton" style="height:300px;margin:8px"></div>'}</div>` : '<div class="empty">Выбери плейлист</div>'}
    </aside>
  </div>`;
}

function renderSearch() {
  const s = state.search;
  let merged = [];
  if (s.res) {
    const lists = [s.res.ya, s.res.yt, s.res.sc || []];
    for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
    if (s.filter !== 'all') merged = merged.filter((t) => t.source === s.filter);
  }
  const f = (v, label, dot) => `<button class="chip solid ${s.filter === v ? 'on' : ''}" data-action="search-filter" data-v="${v}">${dot ? `<span class="d" style="background:${dot}"></span>` : ''}${label}</button>`;
  view.innerHTML = `<div class="scroll">
    <h1 class="page">Поиск</h1>
    <form class="search-field" data-form="search" style="max-width:640px">${ICONS.search}<input name="q" type="search" value="${esc(s.q)}" placeholder="Трек или исполнитель" aria-label="Поиск"></form>
    ${s.res ? `<div class="chips">${f('all', 'Все')}${f('ya', `Яндекс · ${s.res.ya.length}`, 'var(--ya)')}${f('yt', `YouTube Music · ${s.res.yt.length}`, 'var(--yt-bright)')}${f('sc', `SoundCloud · ${(s.res.sc || []).length}`, 'var(--sc)')}</div>` : ''}
    ${s.loading ? '<div class="skeleton" style="height:300px"></div>' : s.res ? (merged.length ? tracksHtml(merged, 'search') : '<div class="empty">Ничего не нашлось</div>') : ''}
  </div>`;
  const input = $('input[name=q]', view);
  if (input && !s.res) input.focus();
}

function renderArtist() {
  const st = state.artist;
  const a = st.data;
  if (!a) {
    view.innerHTML = `<div class="page-view"><div class="artist-hero"><button class="back" data-action="back">${ICONS.back}Назад</button><div class="in">${st.error ? `<h1 class="artist-name" style="font-size:32px">Не удалось открыть исполнителя</h1><span class="muted">${esc(st.error)}</span>` : '<div class="skeleton" style="height:80px;width:50%"></div>'}</div></div></div>`;
    return;
  }
  const pref = sourcePref();
  const kinds = [['album', 'Альбомы'], ['single', 'Синглы и EP'], ['compilation', 'Сборники']].filter(([k]) => a.albums.some((x) => x.kind === k));
  const kind = kinds.some(([k]) => k === st.kind) ? st.kind : (kinds[0] || ['album'])[0];
  const albums = a.albums.filter((x) => x.kind === kind);
  lists['artist-popular'] = a.popular;
  const latest = a.albums.filter((x) => x.year).sort((x, y) => String(y.year).localeCompare(String(x.year)))[0];
  view.innerHTML = `<div class="page-view">
    <section class="artist-hero">
      ${a.cover ? `<img class="bg" src="${esc(a.cover)}" alt="">` : '<canvas id="artist-ribbon"></canvas>'}
      <button class="back" data-action="back">${ICONS.back}Назад</button>
      <div class="in">
        <div class="src-chips">${a.refs.ya ? `<span class="src-chip">${badge('ya')}есть в Яндексе</span>` : ''}${a.refs.yt ? `<span class="src-chip">${badge('yt')}есть в YouTube Music</span>` : ''}</div>
        <h1 class="artist-name">${esc(a.name)}</h1>
        ${a.listeners && a.listeners.ya ? `<span class="muted" style="font-size:14px">${Number(a.listeners.ya).toLocaleString('ru-RU')} слушателей за месяц в Яндексе</span>` : ''}
      </div>
    </section>
    <section class="act-row">
      <button class="bigplay" data-action="artist-play" aria-label="Слушать исполнителя">${ICONS.play}</button>
      <button class="icbtn" data-action="artist-shuffle" aria-label="Перемешать">${ICONS.shuffle}</button>
      <span class="grow"></span>
      <div class="pill-seg" role="radiogroup" aria-label="Источник">${[['auto', 'Вместе', ''], ['ya', 'Яндекс', 'ya'], ['yt', 'YouTube Music', 'yt']].map(([v, l, d]) => `<button role="radio" aria-checked="${pref === v}" class="${pref === v ? 'on' : ''}" data-action="set-pref" data-v="${v}">${d ? `<span class="dotsrc ${d}"></span>` : ''}${l}</button>`).join('')}</div>
    </section>
    <section class="two-col">
      <div class="main">
        <h2 class="sec" style="margin-bottom:10px">Популярное</h2>
        ${a.popular.length ? `<div class="tracks">${a.popular.map((r, i) => mergedRowHtml(r, i, 'artist-popular')).join('')}</div>` : '<div class="hint">Популярных треков нет</div>'}
      </div>
      ${latest ? `<div class="side"><button class="release" data-action="open-album" data-ref="${esc(latest.ref)}">
        <span class="eyebrow">Последний релиз</span>
        <span class="row">${coverHtml(latest)}<span style="display:flex;flex-direction:column;gap:4px"><span style="font-size:18px;font-weight:700">${esc(latest.title)}</span><span class="muted" style="font-size:13px">${latest.kind === 'single' ? 'Сингл' : 'Альбом'}${latest.year ? ' · ' + esc(latest.year) : ''}</span></span></span>
      </button></div>` : ''}
    </section>
    ${a.albums.length ? `<section class="sect">
      <div class="sect-head"><h2>Альбомы и синглы</h2>${kinds.map(([k, l]) => `<button class="chip solid ${kind === k ? 'on' : ''}" data-action="artist-kind" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="album-grid">${albums.map((al) => `<button class="album-tile" data-action="open-album" data-ref="${esc(al.ref)}">${coverHtml(al, '', true)}<span class="t">${esc(al.title)}</span><span class="s">${al.kind === 'single' ? 'Сингл' : al.kind === 'compilation' ? 'Сборник' : 'Альбом'}${al.year ? ' · ' + esc(al.year) : ''}</span></button>`).join('')}</div>
    </section>` : ''}
    ${a.similar.length ? `<section class="sect">
      <div class="sect-head"><h2>Похожие исполнители</h2></div>
      <div class="artist-grid">${a.similar.map((s) => `<button class="artist-tile" data-action="open-artist" data-ref="${esc(s.ref)}"><div class="cover round" style="background:#14101e">${esc((s.name || '?').charAt(0).toUpperCase())}${s.cover ? `<img src="${esc(s.cover)}" alt="">` : ''}</div><span class="t">${esc(s.name)}</span></button>`).join('')}</div>
    </section>` : ''}
  </div>`;
  if (!a.cover) new Ribbon($('#artist-ribbon'), { lines: 12, cy: 0.45, amp: 0.8, accent: '#C6B8FF' });
}

function renderAlbum() {
  const st = state.album;
  const al = st.data;
  if (!al) {
    view.innerHTML = `<div class="page-view"><section class="album-head"><button class="back" data-action="back">${ICONS.back}Назад</button>${st.error ? `<div class="info"><h1 style="font-size:32px">Не удалось открыть альбом</h1><span class="muted">${esc(st.error)}</span></div>` : '<div class="skeleton cover" style="width:240px;height:240px"></div>'}</section></div>`;
    return;
  }
  const pref = sourcePref();
  lists['album'] = al.tracks;
  const total = al.tracks.reduce((s, r) => s + (r.duration || 0), 0);
  view.innerHTML = `<div class="page-view">
    <section class="album-head">
      <button class="back" data-action="back">${ICONS.back}Назад</button>
      ${coverHtml({ cover: al.cover, source: al.refs.ya ? 'ya' : 'yt' })}
      <div class="info">
        <span style="font-size:13px;font-weight:600;color:#b4b4bb">${al.kind === 'single' ? 'Сингл' : 'Альбом'}</span>
        <h1>${esc(al.title)}</h1>
        <div class="by">${al.artistRef ? `<button class="link-plain" style="color:var(--text);font-weight:600" data-action="open-artist" data-ref="${esc(al.artistRef)}">${esc(al.artist)}</button>` : esc(al.artist)}${al.year ? `<span>·</span><span>${esc(al.year)}</span>` : ''}<span>·</span><span>${al.tracks.length} треков, ${fmt(total)}</span>
        ${al.refs.ya ? badge('ya') : ''}${al.refs.yt ? badge('yt') : ''}</div>
      </div>
    </section>
    <section class="act-row">
      <button class="bigplay" data-action="album-play" aria-label="Слушать альбом">${ICONS.play}</button>
      <button class="icbtn" data-action="album-shuffle" aria-label="Перемешать">${ICONS.shuffle}</button>
      <span class="grow"></span>
      <span class="muted" style="font-size:13px">Играть из</span>
      <div class="pill-seg" role="radiogroup" aria-label="Источник воспроизведения">${[['auto', 'Авто', ''], ['ya', 'Яндекс', 'ya'], ['yt', 'YouTube Music', 'yt']].map(([v, l, d]) => `<button role="radio" aria-checked="${pref === v}" class="${pref === v ? 'on' : ''}" data-action="set-pref" data-v="${v}">${d ? `<span class="dotsrc ${d}"></span>` : ''}${l}</button>`).join('')}</div>
    </section>
    <section class="album-table">
      <div class="hd"><span style="text-align:right">#</span><span>Название</span><span>Где есть</span><span style="text-align:right">Время</span></div>
      <div class="tracks" style="padding-top:8px">${al.tracks.map((r, i) => {
        const t = pick(r);
        const any = r.ya || r.yt;
        const cur = t && player.current && player.current.id === t.id;
        return `<div class="trow ${cur ? 'cur' : ''} ${t ? '' : 'unavail'}" data-action="play-merged" data-list="album" data-i="${i}">
          <span class="n" style="text-align:right">${cur ? '▶' : i + 1}</span>
          <span class="meta"><span class="t" style="display:block">${esc(r.title)}</span><span class="s" style="display:block">${any ? artistLink(any) : ''}</span></span>
          ${availHtml(r, t)}
          <span class="dur" style="width:auto">${r.duration ? fmt(r.duration) : ''}</span>
        </div>`;
      }).join('')}</div>
      <p class="note">Блёклая метка — трек есть, но играет из другого источника; пустая — в этом сервисе трека нет. «Авто» берёт Яндекс, если трек там есть.</p>
    </section>
  </div>`;
}

const SVC_HELP = {
  ya: { manual: 'Вставить OAuth-токен вручную', input: '<input type="text" data-manual="ya" placeholder="y0_AgAAAA…">' },
  yt: { manual: 'Вставить cookies вручную (если Google не пускает в окне входа)', input: '<textarea rows="3" data-manual="yt" placeholder="SAPISID=…; __Secure-3PAPISID=…; …"></textarea>' },
  sc: {
    manual: 'Войти через свой браузер (если окно входа не пускает)',
    input: `<div class="hint" style="margin-bottom:8px">1. <button class="link-plain" data-action="open-url" data-url="https://soundcloud.com/signin" style="color:var(--accent)">Открой soundcloud.com</button> в своём браузере и войди.<br>2. Нажми F12 (на Mac — ⌥⌘I) → вкладка «Application» / «Хранилище» → Cookies → https://soundcloud.com.<br>3. Скопируй значение <b>oauth_token</b> и вставь сюда.</div><input type="text" data-manual="sc" placeholder="2-123456-…">`
  }
};
function svcCard(svc) {
  const st = state.status[svc];
  const meta = SERVICES.find((x) => x.id === svc);
  const extra = svc === 'ya' && st && st.plus === false ? ' · без Плюса полные треки могут не играть' : svc === 'sc' && st ? ' · треки Go+ играют только отрывком' : '';
  return `<div class="card">
    <div class="svc">
      <div class="logo" style="background:${meta.bg};color:${meta.fg}">${meta.short}</div>
      <div class="info"><div class="name">${meta.name}</div>
        <div class="st">${st ? `Вход выполнен: ${esc(st.name)}${st.error ? ' (токен не принят — войди заново)' : ''}${extra}` : svc === 'sc' ? 'Не подключено · поиск работает и без входа' : 'Не подключено'}</div></div>
      ${st ? `<button class="btn danger" data-action="logout" data-svc="${svc}">Выйти</button>` : `<button class="btn primary" data-action="login" data-svc="${svc}">Войти</button>`}
    </div>
    <details><summary>${SVC_HELP[svc].manual}</summary>
      <div class="manual">${SVC_HELP[svc].input}
      <button class="btn" data-action="manual-save" data-svc="${svc}">Сохранить</button></div>
    </details>
  </div>`;
}

/** Центр обновлений: версия, проверка релиза на GitHub, скачивание установщика */
function updateCardHtml() {
  const u = state.update;
  const i = u.info;
  let status = 'Нажми «Проверить», чтобы посмотреть свежий релиз на GitHub.';
  if (u.checking) status = 'Проверяю…';
  else if (u.error) status = `Не получилось: ${esc(u.error)}`;
  else if (i && i.available) status = `Доступна версия <b>${esc(i.latest.label)}</b>${i.asset ? ` · ${(i.asset.size / 1048576).toFixed(0)} МБ` : ' · файла для этой системы в релизе нет'}`;
  else if (i) status = `Установлена последняя версия${i.latest ? ` (${esc(i.latest.label)})` : ''}.`;
  const pct = u.progress != null ? Math.round(u.progress * 100) : null;
  return `<section class="card update-card">
    <div class="svc">
      <div class="logo" style="background:var(--accent-soft);color:var(--accent)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg></div>
      <div class="info"><div class="name">Центр обновлений</div><div class="st">Сейчас: Nyao Music ${esc(state.version || '')}</div></div>
      ${i && i.available && i.asset
        ? `<button class="btn primary" data-action="update-install" ${pct != null ? 'disabled' : ''}>${pct != null ? `Скачиваю… ${pct}%` : 'Скачать и установить'}</button>`
        : `<button class="btn" data-action="update-check" ${u.checking ? 'disabled' : ''}>Проверить</button>`}
    </div>
    <div class="hint" id="update-status">${status}</div>
    ${pct != null ? `<div class="update-bar"><span style="width:${pct}%"></span></div>` : ''}
    ${i && i.available && i.notes ? `<details><summary>Что нового</summary><div class="hint" style="white-space:pre-wrap;margin-top:8px">${esc(i.notes)}</div></details>` : ''}
    ${i && i.url ? `<button class="link-plain" data-action="update-page" style="font-size:12px;color:var(--accent);margin-top:6px">Открыть релизы на GitHub</button>` : ''}
  </section>`;
}
async function checkUpdates(silent = false) {
  state.update.checking = true;
  state.update.error = null;
  if (state.route === 'settings') renderSettings();
  try {
    state.update.info = await api.updates.check();
    if (silent && state.update.info.available) toast(`Доступна Nyao Music ${state.update.info.latest.label} — обновить можно в Настройках`);
  } catch (e) {
    state.update.error = e.message;
  }
  state.update.checking = false;
  if (state.route === 'settings') renderSettings();
}

// ---------- Аккаунт Nyao (свой сервер): вход через Telegram, синхронизация, продолжение ----------
function nyaoAvatar(cls = 'av') {
  const u = state.cloud.loggedIn && state.cloud.user;
  if (u && u.picture) return `<span class="${cls} nyao-av"><img src="${esc(u.picture)}" alt=""></span>`;
  const letter = u ? esc(String(u.name || 'N').trim().charAt(0).toUpperCase()) : 'N';
  return `<span class="${cls} nyao-av">${letter}</span>`;
}
const PLATFORM_NAME = { win32: 'Windows', darwin: 'macOS', android: 'Android', linux: 'Linux' };
function ago(ts) {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 2) return 'сейчас';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}
function nyaoCardHtml() {
  const c = state.cloud;
  if (!api.cloud) return '';
  if (!c.loggedIn) {
    return `<section class="card nyao-card">
      <div class="svc">${nyaoAvatar('logo')}
        <div class="info"><div class="name">Аккаунт Nyao</div>
          <div class="st">${c.logging ? 'Открыл Telegram в браузере — подтверди вход там, а потом возвращайся сюда.' : 'Миксы, настройки волны и история на всех твоих устройствах + «продолжить с телефона».'}</div></div>
        ${c.logging ? '<button class="btn" data-action="cloud-cancel">Отмена</button>' : `<button class="btn primary tg" data-action="cloud-login">${TG_ICON}Войти через Telegram</button>`}
      </div>
      <div class="hint">Токены Яндекса, YouTube и SoundCloud на сервер не отправляются — они остаются только на этом устройстве.</div>
    </section>`;
  }
  const u = c.user || {};
  const devs = c.devices;
  return `<section class="card nyao-card">
    <div class="svc">${nyaoAvatar('logo')}
      <div class="info"><div class="name">${esc(u.name || 'Аккаунт Nyao')}</div><div class="st">${u.username ? '@' + esc(u.username) + ' · ' : ''}синхронизация включена</div></div>
      <button class="btn danger" data-action="cloud-logout">Выйти</button>
    </div>
    <div class="devices">
      <div class="eyebrow">Устройства</div>
      ${devs ? devs.map((d) => `<div class="dev"><span class="dev-ic">${d.platform === 'android' ? '📱' : '💻'}</span><span class="dev-info"><b>${esc(d.device || PLATFORM_NAME[d.platform] || 'Устройство')}</b><span>${d.current ? 'это устройство' : 'был ' + ago(d.lastSeen)}</span></span>${d.current ? '' : `<button class="link-plain" data-action="cloud-device-remove" data-id="${esc(d.id)}">Отключить</button>`}</div>`).join('') : '<div class="skeleton" style="height:44px"></div>'}
    </div>
    <div class="hint">Токены музыкальных сервисов на сервер не отправляются — они остаются только на устройствах.</div>
  </section>`;
}
const TG_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2 1.8 11.7c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3z"/></svg>';

async function loadCloud() {
  if (!api.cloud) return;
  const st = await api.cloud.status().catch(() => null);
  if (!st) return;
  state.cloud.loggedIn = st.loggedIn;
  state.cloud.user = st.user;
  renderAccounts();
  if (st.loggedIn) {
    loadOthers();
    if (state.route === 'settings') loadCloudDevices();
  }
}
async function loadCloudDevices() {
  try {
    const me = await api.cloud.me();
    state.cloud.user = me.user;
    state.cloud.devices = me.devices;
  } catch (e) {
    const st = await api.cloud.status().catch(() => ({ loggedIn: false }));
    state.cloud.loggedIn = st.loggedIn;
    if (st.loggedIn) toast(e.message, true);
  }
  if (state.route === 'settings') renderSettings();
}
async function loadOthers() {
  if (!state.cloud.loggedIn) return;
  try {
    const list = await api.cloud.others();
    const cur = player.current;
    // показываем только свежее (за последние 12 часов) и не то, что уже играет здесь
    state.cloud.others = list.filter((d) => d.track && Date.now() - d.updatedAt < 12 * 3600_000 && !(cur && cur.id === d.track.id)).slice(0, 1);
  } catch {
    state.cloud.others = [];
  }
  if (state.route === 'home') renderHome();
}
async function cloudLogin() {
  if (state.cloud.logging) return;
  state.cloud.logging = true;
  if (state.route === 'settings') renderSettings();
  try {
    const user = await api.cloud.login();
    state.cloud.loggedIn = true;
    state.cloud.user = user;
    toast(`Привет, ${user.name}! Синхронизация включена`);
    loadOthers();
    loadCloudDevices();
  } catch (e) {
    if (!/отмен/i.test(e.message)) toast(e.message, true);
  }
  state.cloud.logging = false;
  renderAccounts();
  if (state.route === 'settings') renderSettings();
}
function continueHtml() {
  const d = state.cloud.others[0];
  if (!d) return '';
  const t = d.track;
  const pos = d.playing ? d.position + (Date.now() - d.updatedAt) / 1000 : d.position;
  return `<section class="continue-card">
    ${coverHtml(t, 'sm')}
    <div class="meta"><span class="eyebrow">${d.platform === 'android' ? '📱' : '💻'} Продолжить с «${esc(d.device)}» · ${ago(d.updatedAt)}</span>
      <b>${esc(t.title)}</b><span class="muted">${esc(t.artist)} · ${fmt(Math.min(pos, t.duration || pos))}</span></div>
    <button class="btn primary" data-action="resume-device" data-id="${esc(d.deviceId)}">${ICONS.play}Продолжить</button>
    <button class="icbtn" data-action="resume-dismiss" data-id="${esc(d.deviceId)}" aria-label="Скрыть">✕</button>
  </section>`;
}
let nowTimer;
function pushNow() {
  if (!api.cloud || !state.cloud.loggedIn) return;
  clearTimeout(nowTimer);
  nowTimer = setTimeout(() => {
    const t = player.current;
    api.cloud.now({ track: t, position: player.audio.currentTime || 0, playing: player.playing, context: player.mode || '' }).catch(() => {});
  }, 800);
}

function renderSettings() {
  view.innerHTML = `<div class="scroll settings">
    <h1 class="page">Настройки</h1>
    ${nyaoCardHtml()}
    <section style="display:flex;flex-direction:column;gap:14px"><h2 class="sec">Аккаунты</h2>${SERVICES.map((x) => svcCard(x.id)).join('')}</section>
    <section style="display:flex;flex-direction:column;gap:14px"><h2 class="sec">Моя волна</h2>${waveControlsHtml()}</section>
    ${discordCardHtml()}
    ${updateCardHtml()}
    <section class="card">
      <h2 class="sec">О приложении</h2>
      <div class="hint">Nyao Music ${esc(state.version || '0.2')} · тема ${IS_MAC ? 'macOS (Liquid Glass)' : 'Windows'}. Сервисы подключены через неофициальные API, поэтому после их обновлений что-то может сломаться; тексты песен — из LRCLIB.</div>
      <button class="btn" data-action="onboarding" style="margin-top:12px">Показать приветствие снова</button>
    </section>
  </div>`;
  $$('input[data-input="share"]', view).forEach(setRangeFill);
  refreshRpcStatus();
}

const RPC_STATUS = { off: 'выключено', 'no-id': 'выключено', connecting: 'жду Discord… (он должен быть запущен)', connected: 'подключено' };
function discordCardHtml() {
  const s = state.settings || {};
  return `<section class="card">
    <div class="svc">
      <div class="logo" style="background:#5865F2;color:#fff"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0L8.8 4a16.6 16.6 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.7 16.7 0 0 0 5.1 2.6l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5.1-2.6c.4-4.3-.7-8-2.9-11.4zM8.7 14.5c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z"/></svg></div>
      <div class="info"><div class="name">Статус в Discord</div><div class="st"><span id="rpc-status">Статус: …</span> · в профиле видно «Слушает nyao.Music», трек и кнопку на него</div></div>
      <button class="btn ${s.discordRpc ? 'primary' : ''}" data-action="rpc-toggle" role="switch" aria-checked="${!!s.discordRpc}">${s.discordRpc ? 'Включено' : 'Выключено'}</button>
    </div>
  </section>`;
}
async function refreshRpcStatus() {
  const el = $('#rpc-status');
  if (!el) return;
  const st = await api.rpc.status().catch(() => 'off');
  el.textContent = 'Статус: ' + (RPC_STATUS[st] || st);
}
let rpcTimer;
function pushRpc() {
  if (!state.settings || !state.settings.discordRpc) return;
  clearTimeout(rpcTimer);
  rpcTimer = setTimeout(() => {
    const t = player.current;
    const a = player.audio;
    const info = t ? {
      track: { title: t.title, artist: t.artist, album: t.album, cover: t.cover, source: t.source, srcId: t.srcId, albumId: t.albumId, url: t.url },
      playing: player.playing,
      position: a.currentTime || 0,
      duration: Number.isFinite(a.duration) ? a.duration : t.duration || 0
    } : null;
    api.rpc.update(info).catch(() => {});
  }, 400);
}

const RENDER = { home: renderHome, wave: renderWave, player: renderPlayer, library: renderLibrary, search: renderSearch, settings: renderSettings, artist: renderArtist, album: renderAlbum };

// ---------- Загрузка данных ----------
async function loadStatus() {
  state.status = await api.auth.status().catch(() => ({ ya: null, yt: null, sc: null }));
  renderAccounts();
}
async function loadHome() {
  if (!state.status.ya && !state.status.yt) return;
  try {
    state.home = await api.home();
  } catch (e) {
    toast(e.message, true);
    state.home = { yaPlaylists: [], ytHome: [], mixes: [] };
  }
  if (state.route === 'home') renderHome();
}
async function loadLibrary(force = false) {
  if (!state.lib.lists || force) {
    const [lists2] = await Promise.all([api.library.playlists().catch(() => []), loadLiked()]);
    state.lib.lists = lists2;
    renderRail();
    if (state.route === 'library') renderLibrary();
  }
  if (!state.lib.tracks && state.route === 'library') selectPlaylist(state.lib.selected);
}
let likedPromise = null;
function loadLiked(force = false) {
  if (!likedPromise || force) {
    likedPromise = api.library.liked().then((r) => {
      state.lib.counts = { ya: r.ya, yt: r.yt, sc: r.sc || 0 };
      state.lib.liked = r.tracks;
      r.tracks.forEach((t) => player.liked.add(t.id));
      return r.tracks;
    }).catch(() => []);
  }
  return likedPromise;
}
async function selectPlaylist(id) {
  state.lib.selected = id;
  state.lib.tracks = null;
  if (state.route === 'library') renderLibrary();
  try {
    const tracks = id === 'liked' ? await loadLiked() : await api.library.tracks(id);
    if (state.lib.selected !== id) return;
    state.lib.tracks = tracks;
  } catch (e) {
    state.lib.tracks = [];
    toast(e.message, true);
  }
  if (state.route === 'library') renderLibrary();
}
function openPlaylist(id) {
  state.lib.selected = id;
  state.lib.tracks = null;
  go('library');
}
async function fetchArtist(ref) {
  if (artistCache.has(ref)) return artistCache.get(ref);
  const p = api.catalog.artist(ref);
  artistCache.set(ref, p);
  p.catch(() => artistCache.delete(ref));
  return p;
}
async function loadArtist(ref) {
  if (state.artist.ref === ref && state.artist.data) return renderArtist();
  state.artist = { ref, data: null, error: null, kind: 'album' };
  renderArtist();
  try {
    const data = await fetchArtist(ref);
    if (state.artist.ref !== ref) return;
    state.artist.data = data;
  } catch (e) {
    if (state.artist.ref === ref) state.artist.error = e.message;
  }
  if (state.route === 'artist') renderArtist();
}
async function loadAlbum(ref) {
  if (state.album.ref === ref && state.album.data) return renderAlbum();
  state.album = { ref, data: null, error: null };
  renderAlbum();
  try {
    const data = await api.catalog.album(ref);
    if (state.album.ref !== ref) return;
    state.album.data = data;
  } catch (e) {
    if (state.album.ref === ref) state.album.error = e.message;
  }
  if (state.route === 'album') renderAlbum();
}
async function loadNpArtist() {
  const t = player.current;
  if (!t || !t.artistRef || state.npArtist.ref === t.artistRef) return;
  const ref = t.artistRef;
  state.npArtist = { ref, data: null };
  try {
    const data = await fetchArtist(ref);
    if (state.npArtist.ref !== ref) return;
    state.npArtist.data = data;
    if (state.route === 'player') renderPlayer();
  } catch {
    // карточка исполнителя просто останется без фото
  }
}

async function setWave(patch) {
  state.settings = await api.settings.set(patch);
  if (['home', 'wave', 'player', 'settings'].includes(state.route)) RENDER[state.route]();
  if (player.mode === 'wave') {
    toast('Перенастраиваю волну…');
    player.refreshWave().catch((e) => toast(e.message, true));
  }
}

// ---------- Меню «⋯» ----------
function openMenu(x, y, track) {
  const menu = $('#menu');
  const mixes = (state.lib.lists || []).filter((p) => p.source === 'mix');
  menu.innerHTML = `
    <button data-m="next">Играть следующим</button>
    <button data-m="like">${player.liked.has(track.id) ? 'Убрать из «Мне нравится»' : 'В «Мне нравится»'}</button>
    ${track.artistRef ? '<button data-m="artist">Открыть исполнителя</button>' : ''}
    ${track.albumRef ? '<button data-m="album">Открыть альбом</button>' : ''}
    <div class="lbl">Добавить в микс</div>
    ${mixes.map((m) => `<button data-m="mix" data-id="${esc(m.id)}">${esc(m.title)}</button>`).join('')}
    <button data-m="newmix">${ICONS.plus} Новый микс…</button>`;
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  menu.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    menu.hidden = true;
    try {
      if (b.dataset.m === 'next') {
        player.enqueueNext(track);
        toast('Будет играть следующим');
      } else if (b.dataset.m === 'like') {
        await player.toggleLike(track);
      } else if (b.dataset.m === 'artist') {
        go('artist', { ref: track.artistRef });
      } else if (b.dataset.m === 'album') {
        go('album', { ref: track.albumRef });
      } else if (b.dataset.m === 'mix') {
        await api.mix.add(b.dataset.id, track);
        state.lib.lists = null;
        toast('Добавлено в микс');
      } else if (b.dataset.m === 'newmix') {
        const title = await askText('Название микса', 'Новый микс');
        if (!title) return;
        const mix = await api.mix.create(title);
        await api.mix.add(mix.id, track);
        state.lib.lists = null;
        toast(`Создан микс «${mix.title}»`);
      }
    } catch (err) {
      toast(err.message, true);
    }
  };
  if (!state.lib.lists) api.library.playlists().then((l) => (state.lib.lists = l)).catch(() => {});
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#menu')) $('#menu').hidden = true;
});

// Простое окно ввода (prompt() в Electron не работает)
function askText(label, value = '') {
  return new Promise((resolve) => {
    const menu = $('#menu');
    menu.innerHTML = `<form style="padding:8px;display:flex;flex-direction:column;gap:8px"><div class="lbl" style="padding:0">${esc(label)}</div>
      <input name="v" value="${esc(value)}" style="height:38px;border-radius:8px;border:1px solid var(--line2);background:var(--s2);color:var(--text);padding:0 10px;font:inherit">
      <button class="btn primary" style="height:38px;justify-content:center">Создать</button></form>`;
    menu.hidden = false;
    menu.style.left = `${innerWidth / 2 - 130}px`;
    menu.style.top = `${innerHeight / 2 - 80}px`;
    menu.onclick = null;
    const form = $('form', menu);
    const input = $('input', form);
    input.focus();
    input.select();
    form.onsubmit = (e) => {
      e.preventDefault();
      menu.hidden = true;
      resolve(input.value.trim());
    };
  });
}

// ---------- Обработчики экрана ----------
async function handleAction(el, e) {
  const a = el.dataset.action;
  switch (a) {
    case 'go':
      go(el.dataset.route);
      break;
    case 'back':
      back();
      break;
    case 'wave-toggle':
      if (player.mode === 'wave' && player.current) player.toggle();
      else await player.startWave();
      if (state.route === 'home' || state.route === 'wave') RENDER[state.route]();
      break;
    case 'wave-div':
      await setWave({ waveDiversity: el.dataset.v });
      break;
    case 'wave-mood':
      await setWave({ waveMood: state.settings.waveMood === el.dataset.v ? null : el.dataset.v });
      break;
    case 'play-section':
      player.playList(lists['home-section'], 0, 'YouTube Music');
      break;
    case 'play-row': {
      const list = lists[el.dataset.list];
      const label = el.dataset.list === 'lib' ? ((state.lib.lists || []).find((p) => p.id === state.lib.selected) || { title: 'Мне нравится' }).title : el.dataset.list === 'search' ? 'Поиск' : '';
      player.playList(list, Number(el.dataset.i), label);
      break;
    }
    case 'play-merged': {
      const label = el.dataset.list === 'album' ? state.album.data && state.album.data.title : state.artist.data && state.artist.data.name;
      playMerged(lists[el.dataset.list], Number(el.dataset.i), label);
      break;
    }
    case 'row-more': {
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, lists[el.dataset.list][Number(el.dataset.i)]);
      break;
    }
    case 'cur-more':
      if (player.current) openMenu(e.clientX, e.clientY, player.current);
      break;
    case 'like-cur':
      await player.toggleLike();
      if (state.route === 'player') renderPlayer();
      break;
    case 'q-play':
      player.playAt(Number(el.dataset.i));
      break;
    case 'open-pl':
      openPlaylist(el.dataset.id);
      break;
    case 'open-artist':
      e.stopPropagation();
      go('artist', { ref: el.dataset.ref });
      break;
    case 'open-album':
      e.stopPropagation();
      go('album', { ref: el.dataset.ref });
      break;
    case 'artist-play':
    case 'artist-shuffle': {
      const rows = state.artist.data ? state.artist.data.popular : [];
      if (a === 'artist-shuffle') player.shuffle = true;
      playMerged(rows, player.shuffle ? Math.floor(Math.random() * rows.length) : 0, state.artist.data && state.artist.data.name);
      renderBar();
      break;
    }
    case 'album-play':
    case 'album-shuffle': {
      const rows = state.album.data ? state.album.data.tracks : [];
      if (a === 'album-shuffle') player.shuffle = true;
      playMerged(rows, player.shuffle ? Math.floor(Math.random() * rows.length) : 0, state.album.data && state.album.data.title);
      renderBar();
      break;
    }
    case 'artist-kind':
      state.artist.kind = el.dataset.v;
      renderArtist();
      break;
    case 'rpc-toggle':
      state.settings = await api.settings.set({ discordRpc: !state.settings.discordRpc });
      renderSettings();
      pushRpc();
      setTimeout(refreshRpcStatus, 1500);
      break;
    case 'cloud-login':
      cloudLogin();
      break;
    case 'cloud-cancel':
      api.cloud.cancel().catch(() => {});
      break;
    case 'cloud-logout':
      await api.cloud.logout();
      state.cloud = { loggedIn: false, user: null, logging: false, devices: null, others: [] };
      toast('Вышел из аккаунта Nyao');
      renderSettings();
      renderAccounts();
      break;
    case 'cloud-device-remove':
      await api.cloud.removeDevice(el.dataset.id);
      toast('Устройство отключено');
      loadCloudDevices();
      break;
    case 'resume-device': {
      const d = state.cloud.others.find((x) => x.deviceId === el.dataset.id);
      if (d && d.track) {
        const pos = d.playing ? d.position + (Date.now() - d.updatedAt) / 1000 : d.position;
        player.resume(d.track, d.track.duration && pos > d.track.duration - 5 ? 0 : pos, `С устройства «${d.device}»`);
        state.cloud.others = state.cloud.others.filter((x) => x !== d);
        if (state.route === 'home') renderHome();
      }
      break;
    }
    case 'resume-dismiss':
      state.cloud.others = state.cloud.others.filter((x) => x.deviceId !== el.dataset.id);
      if (state.route === 'home') renderHome();
      break;
    case 'open-url':
      if (/^https:\/\//.test(el.dataset.url)) api.openExternal(el.dataset.url);
      break;
    case 'update-check':
      await checkUpdates();
      break;
    case 'update-page':
      if (state.update.info && state.update.info.url) api.openExternal(state.update.info.url);
      break;
    case 'update-install': {
      const asset = state.update.info && state.update.info.asset;
      if (!asset) break;
      state.update.progress = 0;
      renderSettings();
      try {
        await api.updates.download(asset);
        toast(IS_MAC ? 'Установщик открыт: перетащи Nyao Music в «Программы»' : 'Установщик запущен — после установки приложение перезапустится');
      } catch (err) {
        state.update.error = err.message;
      }
      state.update.progress = null;
      if (state.route === 'settings') renderSettings();
      break;
    }
    case 'onboarding':
      openOnboarding();
      break;
    case 'set-pref':
      state.settings = await api.settings.set({ sourcePref: el.dataset.v });
      RENDER[state.route]();
      break;
    case 'lib-select':
      selectPlaylist(el.dataset.id);
      break;
    case 'lib-filter':
      state.lib.filter = el.dataset.v;
      renderLibrary();
      break;
    case 'pl-play':
    case 'pl-shuffle': {
      const sel = state.lib.selected === 'liked' ? { title: 'Мне нравится' } : (state.lib.lists || []).find((p) => p.id === state.lib.selected) || {};
      if (a === 'pl-shuffle') player.shuffle = true;
      const start = player.shuffle ? Math.floor(Math.random() * state.lib.tracks.length) : 0;
      player.playList(state.lib.tracks, start, sel.title);
      renderBar();
      break;
    }
    case 'new-mix': {
      const title = await askText('Название микса', 'Новый микс');
      if (!title) break;
      const mix = await api.mix.create(title);
      state.lib.selected = mix.id;
      state.lib.tracks = [];
      await loadLibrary(true);
      break;
    }
    case 'del-mix':
      await api.mix.delete(state.lib.selected);
      state.lib.selected = 'liked';
      state.lib.tracks = null;
      await loadLibrary(true);
      break;
    case 'search-filter':
      state.search.filter = el.dataset.v;
      renderSearch();
      break;
    case 'tab':
      state.tab = el.dataset.v;
      renderPlayer();
      break;
    case 'lyric-seek':
      player.seek(Number(el.dataset.t));
      break;
    case 'login': {
      const svc = el.dataset.svc;
      el.disabled = true;
      try {
        await api.auth.login(svc);
        toast(svc === 'ya' ? 'Яндекс Музыка подключена' : 'YouTube Music подключён');
      } catch (err) {
        toast(err.message, true);
      }
      await afterAuthChange();
      break;
    }
    case 'logout':
      await api.auth.logout(el.dataset.svc);
      await afterAuthChange();
      break;
    case 'manual-save': {
      const svc = el.dataset.svc;
      const input = $(`[data-manual="${svc}"]`, view);
      await api.auth.setManual(svc, input.value);
      toast('Сохранено');
      await afterAuthChange();
      break;
    }
  }
}

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !view.contains(el)) return;
  try {
    await handleAction(el, e);
  } catch (err) {
    toast(err.message, true);
  }
});

view.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const q = new FormData(form).get('q').toString().trim();
  if (!q) return;
  state.search = { q, res: null, filter: 'all', loading: true };
  go('search');
  try {
    const res = await api.search(q);
    if (state.search.q !== q) return;
    state.search.res = res;
  } catch (err) {
    toast(err.message, true);
    state.search.res = { ya: [], yt: [], sc: [] };
  }
  state.search.loading = false;
  if (state.route === 'search') renderSearch();
});

view.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'share') {
    const v = Number(e.target.value);
    setRangeFill(e.target);
    const tr = $('#share-track', view);
    if (tr) tr.style.background = balanceTrack(v);
    const set = (id, txt) => {
      const n = $(id, view);
      if (n) n.textContent = txt;
    };
    set('#share-ya', `${100 - v}%`);
    set('#share-yt', `${v}%`);
    set('#share-label', shareLabel(v));
  }
});
view.addEventListener('change', (e) => {
  if (e.target.dataset.input === 'share') setWave({ ytmShare: Number(e.target.value) });
});

async function afterAuthChange() {
  await loadStatus();
  state.home = null;
  state.lib = { lists: null, filter: 'all', selected: 'liked', tracks: null, counts: null };
  likedPromise = null;
  artistCache.clear();
  if (state.route === 'settings') renderSettings();
  if (state.status.ya || state.status.yt) {
    loadLiked();
    loadLibrary();
  }
}

// ---------- Нижний плеер ----------
function renderBar() {
  const t = player.current;
  $('#pb-cover').innerHTML = coverHtml(t, 'sm');
  const title = $('#pb-title');
  title.textContent = t ? t.title : 'Ничего не играет';
  title.title = t && t.albumRef ? 'Открыть альбом' : '';
  $('#pb-sub').innerHTML = t ? `${badge(t.source)}${artistLink(t)}${player.label ? ' · ' + esc(player.label) : ''}` : 'Запусти «Мою волну»';
  $('#pb-play').innerHTML = player.playing ? ICONS.pause : ICONS.play;
  $('#pb-play').setAttribute('aria-label', player.playing ? 'Пауза' : 'Играть');
  const liked = t && player.liked.has(t.id);
  $('#pb-like').innerHTML = liked ? ICONS.heartOn : ICONS.heart;
  $('#pb-like').classList.toggle('on', !!liked);
  const wave = player.mode === 'wave';
  // В волне «перемешать» и «повтор» не нужны: вместо них «не нравится» и настройка волны
  $('#pb-shuffle').innerHTML = wave ? ICONS.ban : ICONS.shuffle;
  $('#pb-shuffle').setAttribute('aria-label', wave ? 'Не нравится' : 'Перемешать');
  $('#pb-shuffle').classList.toggle('on', !wave && player.shuffle);
  $('#pb-repeat').innerHTML = wave ? ICONS.tune : ICONS.repeat;
  $('#pb-repeat').setAttribute('aria-label', wave ? 'Настроить волну' : 'Повтор');
  $('#pb-repeat').classList.toggle('on', !wave && player.repeat);
  document.body.classList.toggle('src-ya', !!t && t.source === 'ya');
  document.body.classList.toggle('src-yt', !!t && t.source === 'yt');
  Ribbon.setPlaying(player.playing);
}
let seeking = false;
function updateTime() {
  const a = player.audio;
  const dur = Number.isFinite(a.duration) ? a.duration : (player.current && player.current.duration) || 0;
  $('#pb-cur').textContent = fmt(a.currentTime);
  $('#pb-dur').textContent = fmt(dur);
  if (!seeking) {
    const seek = $('#pb-seek');
    seek.value = dur ? Math.round((a.currentTime / dur) * 1000) : 0;
    setRangeFill(seek);
  }
}

$('#pb-play').onclick = () => (player.current ? player.toggle() : player.startWave().catch((e) => toast(e.message, true)));
$('#pb-next').onclick = () => player.next(true);
$('#pb-prev').onclick = () => player.prev();
$('#pb-shuffle').onclick = () => {
  if (player.mode === 'wave') return player.dislike();
  player.shuffle = !player.shuffle;
  renderBar();
};
$('#pb-repeat').onclick = () => {
  if (player.mode === 'wave') return go('wave');
  player.repeat = !player.repeat;
  renderBar();
};
$('#pb-like').onclick = () => player.toggleLike();
$('#pb-coverbtn').onclick = () => {
  state.tab = 'cover';
  go('player');
};
$('#pb-title').onclick = () => {
  const t = player.current;
  if (t && t.albumRef) go('album', { ref: t.albumRef });
  else go('player');
};
$('#pb-sub').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="open-artist"]');
  if (el) go('artist', { ref: el.dataset.ref });
});
const npOpen = (tab) => () => {
  state.tab = tab;
  go('player');
};
$('#pb-np').onclick = npOpen('cover');
$('#pb-lyrics').onclick = npOpen('lyrics');
$('#pb-queue').onclick = npOpen('queue');
const seekEl = $('#pb-seek');
seekEl.addEventListener('input', () => {
  seeking = true;
  setRangeFill(seekEl);
});
seekEl.addEventListener('change', () => {
  const dur = player.audio.duration;
  if (Number.isFinite(dur)) player.seek((seekEl.value / 1000) * dur);
  seeking = false;
});
const volEl = $('#pb-vol');
let volTimer;
volEl.addEventListener('input', () => {
  player.setVolume(volEl.value / 100);
  setRangeFill(volEl);
  clearTimeout(volTimer);
  volTimer = setTimeout(() => api.settings.set({ volume: volEl.value / 100 }), 400);
});

player.addEventListener('track', () => {
  renderBar();
  lastLyric = -1;
  if (state.route === 'player') {
    renderPlayer();
    loadNpArtist();
  } else if (state.route === 'home' || state.route === 'wave' || state.route === 'album' || state.route === 'artist') RENDER[state.route]();
  else $$('.trow.cur').forEach((r) => r.classList.remove('cur'));
});
player.addEventListener('queue', () => {
  if (state.route === 'player' && state.tab === 'queue') {
    const q = $('#qlist');
    if (q) {
      const top = q.parentElement.parentElement.scrollTop;
      q.innerHTML = tracksHtml(player.queue, 'queue', { action: 'q-play' });
      q.parentElement.parentElement.scrollTop = top;
    }
  }
});
player.addEventListener('state', () => {
  renderBar();
  const wp = $('.wave-play', view);
  if (wp && player.mode === 'wave') wp.innerHTML = player.playing ? ICONS.pauseBig : ICONS.playBig;
});
player.addEventListener('time', () => {
  updateTime();
  if (state.route === 'player' && state.tab !== 'queue') syncLyrics(false);
});
player.addEventListener('like', renderBar);
player.addEventListener('track', pushRpc);
player.addEventListener('state', pushRpc);
player.addEventListener('track', pushNow);
player.addEventListener('state', pushNow);
setInterval(() => player.playing && pushNow(), 30_000);
player.audio.addEventListener('seeked', pushRpc);
player.audio.addEventListener('durationchange', pushRpc);
player.addEventListener('error', (e) => toast(e.detail, true));
player.addEventListener('info', (e) => toast(e.detail));
if (api.sc) api.sc.onSent((r) => toast(`SoundCloud: отложенные лайки доставлены (${r.sent})`));
player.addEventListener('loading', (e) => {
  if (e.detail) toast('Собираю волну…');
});

// Битые обложки убираем — под ними остаётся заглушка с кольцами (inline onerror запрещён CSP)
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') e.target.remove();
}, true);

// ---------- Окно ----------
$$('[data-win]').forEach((b) => (b.onclick = () => api.win[b.dataset.win]()));
$('#rail').addEventListener('click', (e) => {
  const nav = e.target.closest('[data-route]');
  if (nav) return go(nav.dataset.route);
  const pl = e.target.closest('[data-open-pl]');
  if (pl) return openPlaylist(pl.dataset.openPl);
  const acc = e.target.closest('[data-acc-menu]');
  if (acc) {
    e.stopPropagation();
    openAccountMenu(acc);
  }
});
$('#accounts').addEventListener('click', (e) => {
  const acc = e.target.closest('[data-acc-menu]');
  if (acc) {
    e.stopPropagation();
    openAccountMenu(acc);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    player.toggle();
  } else if (e.code === 'ArrowRight' && (e.ctrlKey || e.metaKey)) player.next(true);
  else if (e.code === 'ArrowLeft' && (e.ctrlKey || e.metaKey)) player.prev();
  else if (e.code === 'BracketLeft' && (e.metaKey || e.altKey)) back();
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 3) back(); // боковая кнопка мыши «назад»
});

// ---------- Приветствие ----------
function openOnboarding() {
  const ob = new Onboarding({
    api,
    isMac: IS_MAC,
    getStatus: () => state.status,
    getSettings: () => state.settings,
    setSettings: async (patch) => {
      state.settings = await api.settings.set(patch);
      if ('discordRpc' in patch) pushRpc();
      return state.settings;
    },
    login: async (svc) => {
      try {
        await api.auth.login(svc);
        toast(svc === 'ya' ? 'Яндекс Музыка подключена' : 'YouTube Music подключён');
      } catch (err) {
        toast(err.message, true);
      }
      await afterAuthChange();
    },
    startWave: async () => {
      await player.startWave();
      go('wave');
    },
    toast
  });
  ob.open().then(() => {}).catch(() => {});
  // после закрытия обновить текущий экран (настройки волны могли поменяться)
  const obs = new MutationObserver(() => {
    if (!ob.el.isConnected) {
      obs.disconnect();
      if (RENDER[state.route]) RENDER[state.route]();
    }
  });
  obs.observe(document.body, { childList: true });
}

// ---------- Старт ----------
(async function init() {
  if (IS_MAC) new Ribbon($('#bg-ribbon'), { lines: 20, cy: 0.58, amp: 1, width: 1.7, accent: '#D8CEFF', alpha: 0.9 });
  state.settings = await api.settings.get();
  player.setVolume(state.settings.volume);
  volEl.value = Math.round(state.settings.volume * 100);
  setRangeFill(volEl);
  renderBar();
  // На Mac стартовый экран — «Моя волна» (как в макете Liquid Glass), на Windows — «Главная»
  const start = IS_MAC ? 'wave' : 'home';
  go(start, {}, false);
  await loadStatus();
  RENDER[state.route]();
  loadHome();
  if (state.status.ya || state.status.yt) {
    loadLiked();
    loadLibrary();
  }
  loadCloud();
  if (api.cloud) {
    api.cloud.onChanged(async (keys) => {
      // другое устройство поменяло миксы или настройки волны
      if (keys.includes('wave')) state.settings = await api.settings.get();
      if (keys.includes('mixes')) {
        loadHome();
        loadLibrary();
      }
      if (state.route === 'settings' || state.route === 'wave') RENDER[state.route]();
    });
    // вернулся к окну — вдруг на телефоне что-то играло
    window.addEventListener('focus', () => loadOthers());
  }
  if (api.updates) {
    api.updates.onProgress((p) => {
      state.update.progress = p;
      const btn = $('[data-action="update-install"]');
      if (btn) btn.textContent = `Скачиваю… ${Math.round(p * 100)}%`;
      const bar = $('.update-bar span');
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    });
    setTimeout(() => checkUpdates(true), 4000);
  }
  api.version().then((v) => {
    state.version = v.label;
    if (state.route === 'settings') renderSettings();
  }).catch(() => {});
  if (!state.settings.onboarded) {
    // Кто уже входил в аккаунты в прошлых сборках — тому приветствие не показываем
    if (state.status.ya || state.status.yt) state.settings = await api.settings.set({ onboarded: true });
    else openOnboarding();
  }
})();
