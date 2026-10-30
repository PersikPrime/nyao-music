// Мост между окном и главным процессом: окно видит только эти функции.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Неизвестная ошибка');
  return res.data;
}

contextBridge.exposeInMainWorld('nyao', {
  platform: process.platform,
  win: {
    minimize: () => call('win:minimize'),
    maximize: () => call('win:maximize'),
    close: () => call('win:close'),
    onState: (cb) => ipcRenderer.on('win:state', (_e, s) => cb(s)),
    fullscreen: (on) => call('win:fullscreen', on),
    onFullscreen: (cb) => ipcRenderer.on('win:fullscreen', (_e, on) => cb(on))
  },
  coverColor: (url) => call('cover:color', url),
  dev: {
    info: () => call('dev:info'),
    librespotFlag: (on) => call('dev:librespotFlag', on),
    librespotClientId: (id) => call('dev:librespotClientId', id),
    librespotLogin: () => call('dev:librespotLogin'),
    librespotUse: (on) => call('dev:librespotUse', on),
    librespotLogout: () => call('dev:librespotLogout'),
    librespotDebug: () => call('dev:librespotDebug'),
    hotClearBad: () => call('dev:hotClearBad'),
    open: (what) => call('dev:open', what),
    ping: () => call('dev:ping'),
    offline: (on) => call('dev:offline', on),
    crash: (what) => call('dev:crash', what),
    diag: () => call('dev:diag'),
    lyricsProbe: (track) => call('dev:lyricsProbe', track)
  },
  card: {
    cover: (url) => call('card:cover', url),
    copy: (dataUrl) => call('card:copy', dataUrl),
    save: (dataUrl, name) => call('card:save', dataUrl, name)
  },
  trackDetails: (track) => call('track:details', track),
  onControl: (cb) => ipcRenderer.on('control', (_e, cmd) => cb(cmd)),
  radio: {
    start: (track) => call('radio:start', track),
    more: (ids) => call('radio:more', ids),
    feedback: (type, track, played) => call('radio:feedback', type, track, played)
  },
  lastfm: {
    status: () => call('lastfm:status'),
    connect: () => call('lastfm:connect'),
    cancel: () => call('lastfm:cancel'),
    disconnect: () => call('lastfm:disconnect')
  },
  status: {
    get: (force) => call('status:get', force),
    onChange: (cb) => ipcRenderer.on('status', (_e, s) => cb(s))
  },
  openExternal: (url) => call('open:external', url),
  vkLog: () => call('vk:openLog'),
  // ссылки nyao:// и music.withnyao.app/share/…: приглашение, комната, профиль, трек
  deepLinks: {
    take: () => call('deeplink:take'),
    on: (fn) => on('deeplink', fn)
  },
  // Spotify: вход со своим Client ID, плеер — Web Playback SDK в скрытом окне главного процесса
  spotify: {
    status: () => call('spotify:status'),
    setClientId: (id) => call('spotify:setClientId', id),
    login: () => call('spotify:login'),
    logout: () => call('spotify:logout'),
    prewarm: () => call('spotify:prewarm'),
    play: (uris, positionMs) => call('spotify:play', uris, positionMs),
    pause: () => call('spotify:pause'),
    resume: () => call('spotify:resume'),
    seek: (ms) => call('spotify:seek', ms),
    next: () => call('spotify:next'),
    volume: (v) => call('spotify:volume', v),
    modes: () => call('spotify:modes'),
    snapshot: () => call('spot…23682 tokens truncated…''}</div>
      <div class="row-actions" style="padding:0"><button class="btn primary" data-action="tl-play" ${tl.tracks && tl.tracks.length ? '' : 'disabled'}>${ICONS.play}Слушать</button><button class="icbtn" data-action="tl-shuffle" aria-label="Вперемешку">${ICONS.shuffle}</button></div>
    </div>
    ${tl.error ? `<div class="hint err">${esc(tl.error)}</div>` : !tl.tracks ? '<div class="skeleton" style="height:320px"></div>' : tl.tracks.length ? tracksHtml(tl.tracks, 'tracklist') : '<div class="empty">Треков не нашлось</div>'}
  </div>`;
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
  },
  vk: {
    manual: 'Что-то не работает?',
    input: `<div class="hint">VK Музыка в этой сборке экспериментальная: у VK нет открытого API, Nyao работает через сайт vk.com от имени твоей сессии. Если что-то не грузится — открой лог и пришли его разработчику.</div><button class="btn" data-action="vk-log">Открыть vk-debug.log</button>`
  }
};
/** Spotify: свой Client ID → вход (PKCE) → плеер на Web Playback SDK (нужен Premium) */
function spCard() {
  const s = state.spotify || {};
  const acc = state.status.sp;
  const eng = s.engine || { state: 'idle' };
  const engText = { idle: 'запустится с первым треком', loading: 'загружается…', connecting: 'подключается…', ready: 'готов', not_ready: 'нет связи, переподключается', failed: eng.message || 'ошибка' }[eng.state] || eng.state;
  const wv = s.widevine || {};
  const status = acc
    ? `Вход выполнен: ${esc(acc.name)}${acc.premium === false ? ' · без Premium плеер Spotify не играет — работают поиск и библиотека' : ''}`
    : 'Не подключено';
  return `<div class="card">
    <div class="svc">
      <div class="logo" style="background:var(--sp);color:#000">SP</div>
      <div class="info"><div class="name">Spotify</div><div class="st">${status}</div></div>
      ${acc ? '<button class="btn danger" data-action="sp-logout">Выйти</button>' : `<button class="btn primary" data-action="sp-login" ${s.hasClientId ? '' : 'disabled'}>Войти</button>`}
    </div>
    ${s.regionBlocked ? '<div class="hint" style="color:#ffb37a">Spotify сейчас отвечает «недоступен в этой стране». Без VPN Nyao его пропускает, остальные сервисы работают как обычно.</div>' : ''}
    ${acc ? `<div class="hint">Плеер: <b>${esc(engText)}</b> · Widevine: ${wv.ok ? 'готов' : esc(wv.reason || 'проверяется')}. Звук идёт из официального плеера Spotify — прослушивания засчитываются в твой Spotify.</div>` : ''}
    ${acc ? '' : `<div class="hint" style="margin-top:10px"><b>Один раз настроить</b><br>
      1. Открой <button class="link-plain" data-action="open-url" data-url="https://developer.spotify.com/dashboard" style="color:var(--accent)">developer.spotify.com/dashboard</button> → Create app (или своё приложение с телефона).<br>
      2. В Redirect URIs добавь адрес ниже — посимвольно:<br>
      <code style="user-select:all">${esc(s.redirect || '')}</code> <button class="link-plain" data-action="sp-copy-redirect" style="color:var(--accent)">Копировать</button><br>
      3. Отметь Web API и Web Playback SDK.<br>
      4. В User Management добавь почту своего Spotify.<br>
      5. Вставь Client ID из Basic Information. Client Secret не нужен.</div>
    <div class="manual" style="display:flex;gap:8px;margin-top:8px"><input type="text" data-sp-client placeholder="Client ID (32 символа)" value="${esc(s.clientId || '')}" style="flex:1"><button class="btn" data-action="sp-save-id">Сохранить</button></div>
    <div class="hint">Client ID и вход хранятся только на этом компьютере.</div>`}
    <details><summary>Что-то не работает?</summary><div class="manual"><button class="btn" data-action="sp-debug">Показать журнал</button><pre class="hint" id="sp-log" style="white-space:pre-wrap;max-height:320px;overflow:auto"></pre></div></details>
  </div>`;
}

function svcCard(svc) {
  const st = state.status[svc];
  const meta = SERVICES.find((x) => x.id === svc);
  const extra = svc === 'ya' && st && st.plus === false ? ' · без Плюса полные треки могут не играть' : svc === 'sc' && st ? ' · треки Go+ играют только отрывком' : svc === 'vk' ? ' · бета, только на ПК' : '';
  return `<div class="card">
    <div class="svc">
      <div class="logo" style="background:${meta.bg};color:${meta.fg}">${meta.short}</div>
      <div class="info"><div class="name">${meta.name}</div>
        <div class="st">${st ? `Вход выполнен: ${esc(st.name)}${st.error ? ' (токен не принят — войди заново)' : ''}${extra}` : svc === 'sc' ? 'Не подключено · поиск работает и без входа' : 'Не подключено'}</div></div>
      ${st ? `<button class="btn danger" data-action="logout" data-svc="${svc}">Выйти</button>` : `<button class="btn primary" data-action="login" data-svc="${svc}">Войти</button>`}
    </div>
    ${svc === 'yt' ? `<div class="hint svc-diag">Плейлисты не открываются? <button class="link-plain" data-action="yt-log">Открой отчёт</button> и пришли его разработчику — там только ошибки и структура ответа YouTube, без cookies и личных данных.</div>` : ''}
    <details><summary>${SVC_HELP[svc].manual}</summary>
      <div class="manual">${SVC_HELP[svc].input}
      ${svc === 'vk' ? '' : `<button class="btn" data-action="manual-save" data-svc="${svc}">Сохранить</button>`}</div>
    </details>
  </div>`;
}

/** Центр обновлений: версия, проверка релиза на GitHub, скачивание установщика */
// Каналы обновлений — как в центре обновлений macOS
const UPDATE_CHANNELS = [['stable', 'Обычные'], ['dev', 'Бета'], ['nightly', 'Ночные']];
const UPDATE_CHANNEL_HINT = {
  stable: 'Проверенные релизы.',
  dev: 'Бета: новое раньше всех, иногда с недочётами. Если обычный релиз новее — придёт он.',
  nightly: 'Ночные сборки — эксперименты прямо из разработки, могут ломаться.'
};
/** Заметки релиза: текст как есть, а <sub>…</sub> (мелкий шрифт на GitHub) — мелким и здесь */
function notesHtml(text) {
  return esc(text).replace(/&lt;(sub|small)&gt;([\s\S]*?)&lt;\/\1&gt;/g, '<span class="notes-small">$2</span>');
}
function updateCardHtml() {
  const u = state.update;
  const i = u.info;
  const ready = u.hotReady || (i && i.staged);
  const hot = i && i.available && i.hot && api.updates.hot ? i.hot : null;
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
  let status = 'Нажми «Проверить», чтобы посмотреть свежий релиз на GitHub.';
  if (u.checking) status = 'Проверяю…';
  else if (u.error) status = `Не получилось: ${esc(u.error)}`;
  else if (ready) status = 'Обновление скачано. Перезапуск займёт пару секунд — трек продолжит играть с того же места.';
  else if (hot) status = `Доступна версия <b>${esc(i.latest.label)}</b> · быстрое обновление, ${kb(hot.size)}`;
  else if (i && i.available) status = `Доступна версия <b>${esc(i.latest.label)}</b>${i.asset ? ` · ${(i.asset.size / 1048576).toFixed(0)} МБ` : ' · файла для этой системы в релизе нет'}`;
  else if (i) status = `Установлена последняя версия${i.latest ? ` (${esc(i.latest.label)})` : ''}.`;
  const pct = u.progress != null ? Math.round(u.progress * 100) : null;
  let button;
  if (ready) button = `<button class="btn primary" data-action="update-relaunch">Перезапустить</button>`;
  else if (hot) button = `<button class="btn primary" data-action="update-hot" ${u.hotBusy ? 'disabled' : ''}>${u.hotBusy ? 'Обновляю…' : 'Обновить за секунды'}</button>`;
  else if (i && i.available && i.asset) button = `<button class="btn primary" data-action="update-install" ${pct != null ? 'disabled' : ''}>${pct != null ? `Скачиваю… ${pct}%` : 'Скачать и установить'}</button>`;
  else button = `<button class="btn" data-action="update-check" ${u.checking ? 'disabled' : ''}>Проверить</button>`;
  const installed = state.versionInfo && state.versionInfo.installed;
  const channel = (i && i.channel) || (state.settings && state.settings.updateChannel) || (state.versionInfo && state.versionInfo.channel) || 'stable';
  return `<section class="card update-card">
    <div class="svc">
      <div class="logo" style="background:var(--accent-soft);color:var(--accent)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg></div>
      <div class="info"><div class="name">Центр обновлений</div><div class="st">Сейчас: Nyao Music ${esc(state.version || '')}</div></div>
      ${button}
    </div>
    <div class="hint" id="update-status">${status}</div>
    ${pct != null ? `<div class="update-bar"><span style="width:${pct}%"></span></div>` : ''}
    ${i && i.available && i.notes ? `<details><summary>Что нового</summary><div class="hint" style="white-space:pre-wrap;margin-top:8px">${notesHtml(i.notes)}</div></details>` : ''}
    ${installed ? `<div class="hint" style="margin-top:6px">Код обновлён без установщика; установщиком стоит ${esc(installed)}.</div>` : ''}
    <div class="update-channel">
      <span>Канал обновлений</span>
      <div class="seg">${UPDATE_CHANNELS.map(([id, label]) => `<button class="${id === channel ? 'on' : ''}" data-action="update-channel" data-v="${id}">${label}</button>`).join('')}</div>
      <div class="hint">${UPDATE_CHANNEL_HINT[channel]}${i && !i.available && i.latest && i.latest.build < (i.current && i.current.build) ? ' Версия в этом канале старше установленной — обновление придёт, когда канал её догонит.' : ''}</div>
    </div>
    <div class="update-links">
      ${i && i.url ? `<button class="link-plain" data-action="update-page">Открыть релизы на GitHub</button>` : ''}
      ${hot && i.asset && !ready ? `<button class="link-plain" data-action="update-install">Скачать полный установщик</button>` : ''}
      ${installed ? `<button class="link-plain" data-action="update-reset-hot">Вернуть версию из установщика</button>` : ''}
    </div>
  </section>`;
}
async function checkUpdates(silent = false) {
  state.update.checking = true;
  state.update.error = null;
  if (isSettingsRoute()) renderSettings();
  try {
    state.update.info = await api.updates.check();
    if (state.update.info.required) showOutdated(state.update.info.minBuild);
    if (silent && state.update.info.available) toast(`Доступна Nyao Music ${state.update.info.latest.label} — ${state.update.info.hot ? 'обновить за секунды' : 'обновить'} можно в Настройках`);
  } catch (e) {
    state.update.error = e.message;
  }
  state.update.checking = false;
  if (isSettingsRoute()) renderSettings();
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
      <button class="btn" data-action="go" data-route="profile">Мой профиль</button>
      <button class="btn danger" data-action="cloud-logout">Выйти</button>
    </div>
    <div class="devices">
      <div class="eyebrow">Устройства</div>
      ${devs ? devs.map((d) => `<div class="dev"><span class="dev-ic">${d.platform === 'android' ? '📱' : '💻'}</span><span class="dev-info"><b>${esc(d.device || PLATFORM_NAME[d.platform] || 'Устройство')}</b><span>${d.current ? 'это устройство' : 'был ' + ago(d.lastSeen)}</span></span>${d.current ? '' : `<button class="link-plain" data-action="cloud-device-remove" data-id="${esc(d.id)}">Отключить</button>`}</div>`).join('') : '<div class="skeleton" style="height:44px"></div>'}
      <button class="link-plain" data-action="legacy-pair">Подключить по коду — Nyao Legacy на Android 4</button>
    </div>
    <div class="hint">Токены музыкальных сервисов на сервере не хранятся — они остаются на устройствах. Для Nyao Legacy они передаются зашифрованными ключом самого устройства.</div>
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
    // свежий профиль с сервера: в нём, например, отметка разработчика
    loadCloudDevices(true);
    friends.load().then(() => {
      friendsBadge = friends.unread();
      renderRail();
      friends.askNick();
    });
  }
}
async function loadCloudDevices(silent = false) {
  try {
    const me = await api.cloud.me();
    state.cloud.user = me.user;
    state.cloud.devices = me.devices;
  } catch (e) {
    const st = await api.cloud.status().catch(() => ({ loggedIn: false }));
    state.cloud.loggedIn = st.loggedIn;
    if (st.loggedIn && !silent) toast(e.message, true);
  }
  if (isSettingsRoute()) renderSettings();
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
  if (isSettingsRoute()) renderSettings();
  try {
    const user = await api.cloud.login();
    state.cloud.loggedIn = true;
    state.cloud.user = user;
    toast(`Привет, ${user.name}! Синхронизация включена`);
    loadOthers();
    loadCloudDevices();
    friends.load().then(() => friends.askNick());
  } catch (e) {
    if (!/отмен/i.test(e.message)) toast(e.message, true);
  }
  state.cloud.logging = false;
  renderAccounts();
  if (isSettingsRoute()) renderSettings();
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
let lastQueueKey = '';
function pushNow(force = false) {
  roomPush();
  if (!api.cloud || !state.cloud.loggedIn) return;
  clearTimeout(nowTimer);
  nowTimer = setTimeout(() => {
    const t = player.current;
    // очередь («откуда играет и что дальше») — только когда она поменялась, чтобы перенос на другое устройство брал весь список
    const key = t ? `${t.id}|${player.index}|${player.queue.length}|${player.mode}|${player.label}` : '';
    const queue = t && key !== lastQueueKey ? queueSnapshot(player.queue, player.index, player.label, player.mode) : null;
    lastQueueKey = key;
    api.cloud.now({ track: t, position: player.audio.currentTime || 0, playing: player.playing, context: player.mode || '', volume: player.audio.volume, force: force === true, ...(queue ? { queue } : {}) }).catch(() => {});
  }, force === true ? 100 : 800);
}
/** Забрать музыку с другого устройства: весь его список или волну, с того же места */
function playHandoff(d, fallbackLabel) {
  const plan = handoffPlan(d);
  if (!plan) return;
  if (state.room && !state.room.isHost) leaveRoom(true);
  playListAt(plan.tracks, plan.index, plan.label || fallbackLabel, plan.position);
  if (plan.mode === 'wave') {
    player.mode = 'wave';
    player.maybeMore();
  }
  renderBar();
}

/** macOS: оформление Nyao (как на Windows) или Liquid Glass — как выбор темы на Android */
function themePickerHtml() {
  const cur = IS_MAC ? 'glass' : 'nyao';
  const opts = [['nyao', 'Nyao', 'как на Windows'], ['glass', 'Liquid Glass', 'стекло и размытие macOS']];
  return `<div class="accent-pick">
    <div><b>Оформление</b><span class="hint">Окно перезагрузится в новой теме, музыка продолжит играть с того же места.</span></div>
    <div class="seg theme-seg" role="radiogroup" aria-label="Оформление">${opts.map(([v, n, h]) => `<button role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" data-action="set-theme" data-v="${v}"><b>${n}</b><span>${h}</span></button>`).join('')}</div>
  </div>`;
}

function accentPickerHtml() {
  const cur = (state.settings && state.settings.accent) || 'lavender';
  return `<div class="accent-pick">
    <div><b>Акцентный цвет</b><span class="hint">Как в Android 16: один цвет красит фигуры «Моей волны», кнопки, выделение и прогресс. «Из обложки» подстраивается под текущий трек.</span></div>
    <div class="accent-row" role="radiogroup" aria-label="Акцентный цвет">${ACCENTS.map(([id, label]) => {
      const p = id === 'cover' ? null : paletteFor(id, { mac: IS_MAC });
      const sw = p ? `<span class="sw"><i style="background:${p.a}"></i><i style="background:${p.strong}"></i><i style="background:${p.deep}"></i></span>` : '<span class="sw cover"></span>';
      return `<button class="accent-sw ${cur === id ? 'on' : ''}" role="radio" aria-checked="${cur === id}" data-action="set-accent" data-v="${id}">${sw}<span class="nm">${label}</span></button>`;
    }).join('')}</div>
  </div>`;
}

// ---------- Профиль: аккаунт, друзья, комнаты и все настройки (как на Android) ----------
const PROFILE_ROUTES = ['settings', 'friends', 'together', 'stats', 'user', 'profile'];
const RI = {
  stats: 'M5 20V11M12 20V5M19 20v-6',
  devices: 'M3 5.5h13v9H3zM7 18.5h5M9.5 14.5v4M18.5 9h2.5v10.5h-2.5z',
  person: 'M12 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7M5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  sound: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  keys: 'M3.5 6.5h17v11h-17zM7 10h1M11 10h2M16 10h1M7.5 14h9',
  lyrics: 'M5 7h14M5 12h14M5 17h9',
  dev: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.7-.8 1.7-1.6 0-1-.9-1.5-.9-2.4 0-.9.7-1.5 1.6-1.5h2c2 0 3.6-1.6 3.6-3.6 0-4.4-3.6-7.9-8-7.9M7.5 12a1 1 0 1 0 0 .1M10 8a1 1 0 1 0 0 .1M14.5 8a1 1 0 1 0 0 .1',
  update: 'M20 12a8 8 0 1 1-2.3-5.7M20 4.5v4h-4',
  info: 'M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18M12 11v5M12 7.8v.2',
  chevron: 'M9.5 6l6 6-6 6'
};
function rowIcon(d) {
  return `<span class="srow-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></span>`;
}
function srow({ icon, lead, title, value, ok, action = 'set-sec', sec, route, extra = '' }) {
  const data = route ? `data-action="go" data-route="${route}"` : `data-action="${action}" data-sec="${esc(sec || '')}"`;
  return `<button class="srow" ${data} ${extra}>${lead || rowIcon(icon)}<span class="srow-t">${title}</span>${value ? `<span class="srow-v ${ok ? 'ok' : ''}">${value}</span>` : ''}<svg class="srow-ch" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${RI.chevron}"/></svg></button>`;
}
function sgroup(title, rows) {
  return `<section class="sgroup"><div class="sgroup-t">${title}</div><div class="sgroup-b">${rows.join('')}</div></section>`;
}
/** Вкладки раздела профиля: Профиль / Друзья / Вместе */
function profileTabs(active) {
  const t = (route, label) => `<button class="ptab ${active === route ? 'on' : ''}" data-action="go" data-route="${route}">${label}</button>`;
  return `<div class="ptabs">${t('settings', 'Профиль')}${t('friends', 'Друзья')}${t('together', 'Вместе')}</div>`;
}
const SECTIONS = {
  account: 'Аккаунт Nyao', sound: 'Звук и воспроизведение', lyrics: 'Текст песни', dev: 'Разработчик', keys: 'Управление и окно', view: 'Вид приложения',
  lastfm: 'Last.fm', discord: 'Discord', updates: 'Обновления', about: 'О приложении', wave: 'Моя волна'
};
function sectionTitle(sec) {
  if (sec === 'svc:sp-native') return 'Spotify (librespot)';
  if (sec && sec.startsWith('svc:')) return (SERVICES.find((x) => x.id === sec.slice(4)) || {}).name || 'Сервис';
  return SECTIONS[sec] || 'Настройки';
}

function renderSettings() {
  const sec = state.params && state.params.section;
  if (sec) return renderSettingsSection(sec);
  const c = state.cloud;
  const u = c.user || {};
  const prof = state.social && state.social.profile;
  const connected = SERVICES.filter((x) => state.status[x.id]);
  const visLabel = prof ? (prof.invisible ? 'невидимка' : prof.visibility === 'all' ? 'видят все' : prof.visibility === 'nobody' ? 'скрыт' : 'только друзья') : '';
  // отдельные «Настройки» — только группы настроек; профиль тогда — только шапка и «Профиль»
  const part = state.route === 'prefs' ? 'prefs' : navPrefs() ? 'profile' : 'all';
  const showProfile = part !== 'prefs';
  const showPrefs = part !== 'profile';
  view.innerHTML = `<div class="scroll settings phub">
    ${part === 'prefs' ? '<h1 class="page">Настройки</h1>' : profileTabs('settings')}
    ${showProfile ? `
    <button class="pcard" ${c.loggedIn ? 'data-action="fr-me"' : 'data-action="set-sec" data-sec="account"'}>
      ${nyaoAvatar('pcard-av')}
      <span class="pcard-info"><b>${esc(c.loggedIn ? u.name || 'Аккаунт Nyao' : 'Аккаунт Nyao')}</b>
        <span class="hint">${c.loggedIn ? (prof ? '@' + esc(prof.nick) : u.username ? '@' + esc(u.username) : 'синхронизация включена') : c.logging ? 'Подтверди вход в Telegram' : 'Войди, чтобы история, миксы и друзья были везде'}</span>
        ${connected.length ? `<span class="pcard-svcs">${connected.map((x) => svcDot(x)).join('')}</span>` : ''}</span>
      ${c.loggedIn ? '' : c.logging ? '<span class="btn" data-action="cloud-cancel">Отмена</span>' : `<span class="btn primary tg" data-action="cloud-login">${TG_ICON}Войти через Telegram</span>`}
    </button>
    ${sgroup('Профиль', [
      srow({ icon: RI.stats, title: 'Статистика', route: 'stats' }),
      srow({ icon: RI.devices, title: 'Устройства', action: 'open-connect' }),
      ...(c.loggedIn ? [srow({ icon: RI.edit, title: 'Мой профиль и приватность', value: visLabel, route: 'profile' })] : []),
      srow({ icon: RI.person, title: 'Аккаунт Nyao', value: c.loggedIn ? 'вход выполнен' : 'не выполнен', ok: c.loggedIn, sec: 'account' })
    ])}` : ''}
    ${part === 'profile' ? sgroup('Настройки', [srow({ icon: RI.gear, title: 'Все настройки', route: 'prefs' })]) : ''}
    ${showPrefs ? `${sgroup('Приложение', [
      srow({ icon: RI.sound, title: 'Звук и воспроизведение', value: normalizeEq(state.settings.eq).on ? 'эквалайзер вкл.' : '', sec: 'sound' }),
      srow({ icon: RI.lyrics, title: 'Текст песни', value: LYRIC_PROVIDERS[(lyricsOrder().find((p) => p.on) || { id: 'ya' }).id].name, sec: 'lyrics' }),
      srow({ icon: RI.keys, title: 'Управление и окно', sec: 'keys' })
    ])}
    ${sgroup('Оформление', [
      srow({ icon: RI.palette, title: 'Вид приложения', value: layout() === 'wave' ? 'Моя волна' : 'Плеер', sec: 'view' })
    ])}
    ${sgroup('Сервисы', [...SERVICES.map((x) => srow({ lead: svcDot(x), title: x.name, value: state.status[x.id] ? 'подключено' : 'войти', ok: !!state.status[x.id], sec: 'svc:' + x.id })), ...(nativeVisible() ? [srow({ lead: svcDot(SERVICES.find(x => x.id === 'sp')), title: 'Spotify (librespot)', value: state.spotify.native.active ? 'используется' : 'эксперимент', ok: state.spotify.native.active, sec: 'svc:sp-native' })] : [])])}
    ${sgroup('Интеграции', [
      srow({ lead: '<span class="dot" style="background:#D51007;color:#fff">fm</span>', title: 'Last.fm', value: lastfmState.connected ? lastfmState.name || 'подключено' : lastfmState.configured ? 'подключить' : 'выключен', ok: lastfmState.connected, sec: 'lastfm' }),
      srow({ lead: '<span class="dot" style="background:#5865F2;color:#fff">D</span>', title: 'Статус в Discord', value: state.settings.discordRpc ? 'включён' : 'выключен', ok: !!state.settings.discordRpc, sec: 'discord' })
    ])}
    ${isDev() ? sgroup('Разработчик', [srow({ icon: RI.dev, title: 'Разработчик', value: 'тесты и диагностика', sec: 'dev' })]) : ''}
    ${sgroup('О приложении', [
      srow({ icon: RI.update, title: 'Обновления', value: state.update.info && state.update.info.available ? 'есть новая версия' : esc(state.version || ''), ok: !!(state.update.info && state.update.info.available), sec: 'updates' }),
      srow({ icon: RI.info, title: 'О приложении', sec: 'about' })
    ])}` : ''}
  </div>`;
  refreshLastfm();
}

function renderSettingsSection(sec) {
  let body = '';
  if (sec === 'account') body = nyaoCardHtml();
  else if (sec === 'sound') body = soundCardHtml() + eqCardHtml();
  else if (sec === 'lyrics') body = lyricsCardHtml();
  else if (sec === 'dev' && isDev()) body = devCardHtml();
  else if (sec === 'keys') body = controlCardHtml();
  else if (sec === 'wave') body = waveControlsHtml();
  else if (sec === 'view') body = `<section class="card">
      <div class="hint">Что главное при запуске. Через аккаунт Nyao едет на все устройства.</div>
      ${layoutChoiceHtml(layout(), 'data-action="set-layout"')}
      ${ON_MAC ? themePickerHtml() : ''}
      ${accentPickerHtml()}
      <div class="pref-row"><span><b>«Мне нравится» по сервисам</b><span class="hint">Отдельные плейлисты лайков Яндекса, YouTube Music и SoundCloud — плюс общий.</span></span>
        <button class="switch ${state.settings.splitLiked ? 'on' : ''}" role="switch" aria-checked="${!!state.settings.splitLiked}" aria-label="«Мне нравится» по сервисам" data-action="split-liked" data-v="${state.settings.splitLiked ? 0 : 1}"><span></span></button></div>
      ${layout() === 'player' ? `<div class="pref-row"><span><b>Вкладка «Моя волна» в меню</b><span class="hint">В режиме «Плеер» волна живёт плиткой на главной. Можно вернуть её отдельной вкладкой.</span></span>
        <button class="switch ${state.settings.waveTab ? 'on' : ''}" role="switch" aria-checked="${!!state.settings.waveTab}" aria-label="Вкладка «Моя волна» в меню" data-action="toggle-wavetab"><span></span></button></div>` : ''}
      <div class="pref-row"><span><b>«Друзья» отдельной кнопкой</b><span class="hint">Друзья, профили и заявки — в боковой панели, а не внутри профиля</span></span>
        <button class="switch ${navFriends() ? 'on' : ''}" role="switch" aria-checked="${navFriends()}" aria-label="«Друзья» отдельной кнопкой" data-action="toggle-nav" data-k="navFriends"><span></span></button></div>
      <div class="pref-row"><span><b>«Настройки» отдельной кнопкой</b><span class="hint">В профиле остаются аккаунт, статистика и устройства, всё остальное — на своей странице</span></span>
        <button class="switch ${navPrefs() ? 'on' : ''}" role="switch" aria-checked="${navPrefs()}" aria-label="«Настройки» отдельной кнопкой" data-action="toggle-nav" data-k="navPrefs"><span></span></button></div>
    </section>`;
  else if (sec === 'svc:sp-native' && nativeVisible()) body = librespotCard(state.spotify.native, esc);
  else if (sec === 'svc:sp') body = spCard();
  else if (sec.startsWith('svc:')) body = svcCard(sec.slice(4));
  else if (sec === 'lastfm') body = `<section class="card" id="lastfm-card">${lastfmCardInner()}</section>`;
  else if (sec === 'discord') body = discordCardHtml();
  else if (sec === 'updates') body = updateCardHtml();
  else if (sec === 'about') body = `<section class="card">
      <div class="hint">Nyao Music ${esc(state.version || '0.2')} · оформление ${IS_MAC ? 'Liquid Glass' : 'Nyao'}. Сервисы подключены через неофициальные API, поэтому после их обновлений что-то может сломаться; тексты песен — из Яндекс Музыки, LRCLIB и YouTube Music.</div>
      <div><button class="btn" data-action="onboarding">Показать приветствие снова</button></div>
    </section>`;
  view.innerHTML = `<div class="scroll settings psec">
    <div class="psec-head"><button class="icon-btn" data-action="set-sec" data-sec="" aria-label="Назад"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button><h1 class="page">${esc(sectionTitle(sec))}</h1></div>
    ${body}
  </div>`;
  $$('input[data-input="share"], input[data-input="fresh"]', view).forEach(setRangeFill);
  if (sec === 'discord') refreshRpcStatus();
  if (sec === 'dev' && isDev() && !devState.info) loadDevInfo();
  if (sec === 'lastfm') refreshLastfm();
  if (sec === 'account' && state.cloud.loggedIn && !state.cloud.devices) loadCloudDevices();
}

function eqCardHtml() {
  const e = normalizeEq(state.settings.eq);
  return `<section class="card eq-card">
    <div class="pref-row"><span><b>Эквалайзер</b><span class="hint">Настраивает звук всех сервисов сразу. Выключен — звук без изменений.</span></span>
      <button class="switch ${e.on ? 'on' : ''}" role="switch" aria-checked="${e.on}" aria-label="Эквалайзер" data-action="eq-toggle"><span></span></button></div>
    <div class="eq-presets ${e.on ? '' : 'off'}">${EQ_PRESETS.map(([id, name]) => `<button class="chip ${e.preset === id ? 'on' : ''}" data-action="eq-preset" data-v="${id}">${name}</button>`).join('')}${e.preset === 'custom' ? '<button class="chip on" disabled>Свой</button>' : ''}</div>
    <div class="eq-bands ${e.on ? '' : 'off'}">${EQ_BANDS.map((hz, i) => `<label class="eq-band"><span class="eq-db" id="eq-db-${i}">${e.gains[i] > 0 ? '+' : ''}${e.gains[i]}</span><input type="range" min="-12" max="12" step="1" value="${e.gains[i]}" data-input="eq" data-i="${i}" aria-label="${bandLabel(hz)} Гц" ${e.on ? '' : 'disabled'}><span class="eq-hz">${bandLabel(hz)}</span></label>`).join('')}</div>
  </section>`;
}

// ---------- Управление: глобальные сочетания и трей ----------
function controlCardHtml() {
  const s = state.settings;
  const mod = ON_MAC ? '⌘⌥' : 'Ctrl+Alt+';
  return `<section class="card eq-card">
    <div class="pref-row"><span><b>Сочетания клавиш везде</b><span class="hint">Работают, даже когда окно свёрнуто: ${mod}Пробел — пауза, ${mod}→ / ${mod}← — следующий и предыдущий, ${mod}L — «Мне нравится». Медиаклавиши клавиатуры работают всегда.</span></span>
      <button class="switch ${s.globalKeys !== false ? 'on' : ''}" role="switch" aria-checked="${s.globalKeys !== false}" aria-label="Сочетания клавиш везде" data-action="toggle-globalkeys"><span></span></button></div>
    <div class="pref-row"><span><b>Сворачивать в трей при закрытии</b><span class="hint">Крестик прячет окно, музыка играет дальше. Иконка Nyao в трее — управление и выход.</span></span>
      <button class="switch ${s.closeToTray ? 'on' : ''}" role="switch" aria-checked="${!!s.closeToTray}" aria-label="Сворачивать в трей при закрытии" data-action="toggle-tray"><span></span></button></div>
    <div class="pref-row"><span><b>Прятать кнопки в полноэкранном режиме</b><span class="hint">Если мышь не двигается 3 секунды, кнопки исчезают и остаются обложка и текст</span></span>
      <button class="switch ${s.fsAutoHide ? 'on' : ''}" role="switch" aria-checked="${!!s.fsAutoHide}" aria-label="Прятать кнопки в полноэкранном режиме" data-action="toggle-fshide"><span></span></button></div>
  </section>`;
}

// ---------- Last.fm ----------
let lastfmState = { configured: true, connected: false, name: null, queued: 0, waiting: false };
function lastfmCardInner() {
  const s = lastfmState;
  const st = !s.configured ? 'В этой сборке Last.fm выключен'
    : s.waiting ? 'Подтверди доступ на странице Last.fm в браузере…'
    : s.connected ? `Подключено: ${esc(s.name)}${s.queued ? ` · ждут отправки: ${s.queued}` : ''}`
    : 'Записывает прослушанное из всех сервисов в твой профиль Last.fm';
  const btn = !s.configured ? '' : s.waiting ? '<button class="btn" data-action="lastfm-cancel">Отмена</button>'
    : s.connected ? '<button class="btn" data-action="lastfm-disconnect">Отключить</button>'
    : '<button class="btn primary" data-action="lastfm-connect">Подключить</button>';
  return `<div class="svc">
    <div class="logo" style="background:#D51007;color:#fff;font-weight:800;font-size:13px">fm</div>
    <div class="info"><div class="name">Last.fm</div><div class="st">${st}</div></div>
    ${btn}
  </div>`;
}
function renderLastfm() {
  const el = $('#lastfm-card');
  if (el) el.innerHTML = lastfmCardInner();
}
async function refreshLastfm() {
  try {
    lastfmState = { ...lastfmState, ...(await api.lastfm.status()) };
  } catch {
    // нет связи с главным процессом — оставим как есть
  }
  renderLastfm();
}

// ---------- Звук: выравнивание громкости и плавные переходы ----------
// Провайдеры текстов: порядок поиска, как порядок загрузки дисков; первый с таймингами побеждает
const LYRIC_PROVIDERS = {
  ya: { name: 'Яндекс Музыка', caps: 'с таймингами · нужен вход в Яндекс' },
  nyao: { name: 'Nyao LyricLabs', caps: 'с таймингами · по словам (караоке)' },
  lrclib: { name: 'LRCLIB', caps: 'с таймингами · открытая база' },
  ytm: { name: 'YouTube Music', caps: 'только текст · для треков YouTube' }
};
const LYRIC_DEFAULT = ['ya', 'nyao', 'lrclib', 'ytm'];
function lyricsOrder() {
  const saved = Array.isArray(state.settings.lyricsOrder) ? state.settings.lyricsOrder : [];
  const out = [];
  for (const x of saved) if (x && LYRIC_PROVIDERS[x.id] && !out.some((o) => o.id === x.id)) out.push({ id: x.id, on: x.on !== false });
  for (const id of LYRIC_DEFAULT) if (!out.some((o) => o.id === id)) out.push({ id, on: true });
  return out;
}
function lyricsCardHtml() {
  const order = lyricsOrder();
  const up = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
  const down = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const wordsFirst = state.settings.lyricsWordsFirst !== false;
  return `<section class="card">
    <div class="hint" style="margin-bottom:10px">Текст ищется сверху вниз: берётся первый с таймингами. Если таймингов нет нигде — первый найденный текст.</div>
    <div class="lyr-order">${order.map((p, i) => `<div class="lyr-row ${p.on ? '' : 'off'}">
      <span class="lyr-n">${i + 1}</span>
      <span class="lyr-t"><b>${LYRIC_PROVIDERS[p.id].name}</b><span class="hint">${LYRIC_PROVIDERS[p.id].caps}</span></span>
      <button class="lyr-mv" data-action="lyr-move" data-id="${p.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше">${up}</button>
      <button class="lyr-mv" data-action="lyr-move" data-id="${p.id}" data-d="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Ниже">${down}</button>
      <button class="switch ${p.on ? 'on' : ''}" role="switch" aria-checked="${p.on}" aria-label="${LYRIC_PROVIDERS[p.id].name}" data-action="lyr-toggle" data-id="${p.id}"><span></span></button>
    </div>`).join('')}</div>
    <div class="pref-row"><span><b>Караоке LyricLabs важнее порядка</b><span class="hint">Если в Nyao LyricLabs у песни размечены слова — берётся он, даже когда источник выше нашёл текст по строкам</span></span>
      <button class="switch ${wordsFirst ? 'on' : ''}" role="switch" aria-checked="${wordsFirst}" aria-label="Караоке LyricLabs важнее порядка" data-action="lyr-words"><span></span></button></div>
    <button class="link-plain" data-action="lyr-reset" style="font-size:12px;color:var(--accent);margin-top:6px">Сбросить по умолчанию</button>
  </section>`;
}
/** Порядок поменяли — текст текущего трека ищем заново */
async function saveLyricsPrefs(patch) {
  state.settings = await api.settings.set(patch);
  state.lyrics = { id: null };
  if (fullscreen.open) fullscreen.reloadLyrics();
  renderSettings();
}

// ---------- Раздел «Разработчик»: виден, если сервер Nyao отметил аккаунт как разработчика (NYAO_DEV_IDS) ----------
const nativeVisible = () => !!(isDev() && state.spotify?.native?.permitted && state.spotify.native.flag);
const isDev = () => !!(state.cloud.loggedIn && state.cloud.user && state.cloud.user.dev && api.dev);
const devState = { info: null, probe: null, ping: null, offline: false, fps: false };
function devCardHtml() {
  const i = devState.info;
  const hot = i && i.hot;
  const t = player.current;
  const btn = (action, label, extra = '') => `<button class="btn" data-action="${action}" ${extra}>${label}</button>`;
  const kv = (k, v) => `<div class="dev-kv"><span>${k}</span><b>${v}</b></div>`;
  const group = (title, body) => `<section class="card dev-card"><div class="dev-h">${title}</div>${body}</section>`;
  return [
    group('Сборка', i ? [
      kv('Версия', esc(i.version.label)),
      kv('Electron · Chromium · Node', `${esc(i.electron)} · ${esc(i.chrome)} · ${esc(i.node)}`),
      kv('Система', esc(i.platform)),
      kv('Память main', `${i.memory} МБ`),
      kv('Папка данных', esc(i.userData)),
      kv('Быстрые обновления', hot ? (hot.enabled ? `вкл · запущен ${hot.running != null ? `код ${hot.running}` : 'код установщика'} · установщик ${hot.bundled.build} · compat ${esc(hot.compat)}` : 'выключены (нет ключа или разработка)') : '—'),
      hot && hot.state.bad.length ? kv('Плохие версии', hot.state.bad.join(', ')) : '',
      `<div class="dev-btns">${btn('dev-open', 'Открыть папку данных', 'data-v="data"')}${hot && hot.state.bad.length ? btn('dev-hot-clear', 'Забыть плохие версии') : ''}${hot && hot.running != null ? btn('update-reset-hot', 'Вернуть код установщика') : ''}</div>`
    ].join('') : '<div class="hint">Загружаю…</div>'),
    group('Тексты песен', `<div class="hint">${t ? `Текущий трек: ${esc(t.artist)} — ${esc(t.title)}` : 'Включи трек, чтобы проверить источники'}</div>
      ${Array.isArray(devState.probe) ? `<div class="dev-table">${devState.probe.map((r) => `<div class="dev-row"><b>${esc(LYRIC_PROVIDERS[r.id].name)}</b><span>${r.ms} мс</span><span class="${r.found ? 'ok' : 'bad'}">${r.found ? `${r.synced ? (r.words ? 'по словам' : 'с таймингами') : 'без таймингов'} · ${r.lines} стр.` : r.skipped ? 'пропущен' : 'не нашёл'}</span><span class="hint">${esc(r.skipped || r.error || (r.found ? r.source : r.diag) || '')}</span></div>`).join('')}</div>` : ''}
      <div class="dev-btns">${btn('dev-probe', devState.probe === 'busy' ? 'Проверяю…' : 'Прогнать все источники', t ? '' : 'disabled')}${btn('dev-lyrics-reload', 'Искать текст заново')}</div>`),
    group('Воспроизведение', `<div class="hint">${t ? `Источник: ${esc(t.source)} · ${esc(String(player.audio.currentSrc || '').split('/').slice(0, 3).join('/') || '—')}` : 'Ничего не играет'}</div>
      <div class="dev-btns">${btn('dev-break-stream', 'Сломать поток (проверить восстановление)', t ? '' : 'disabled')}${btn('dev-seek-end', 'В конец трека', t ? '' : 'disabled')}${btn('dev-queue-1000', 'Очередь на 1000 треков', t ? '' : 'disabled')}</div>`),
    group('Сеть и сервер', `${Array.isArray(devState.ping) ? `<div class="dev-table">${devState.ping.map((r) => `<div class="dev-row"><b>${esc(r.name)}</b><span>${r.ms} мс</span><span class="${r.error || r.status >= 400 ? 'bad' : 'ok'}">${r.error ? esc(r.error) : `HTTP ${r.status}`}</span></div>`).join('')}</div>` : ''}
      <div class="pref-row"><span><b>Без сети</b><span class="hint">Запросы окна и Chromium перестают ходить — проверить экраны «нет интернета» и восстановление</span></span>
        <button class="switch ${devState.offline ? 'on' : ''}" role="switch" aria-checked="${devState.offline}" aria-label="Без сети" data-action="dev-offline"><span></span></button></div>
      <div class="dev-btns">${btn('dev-ping', devState.ping === 'busy' ? 'Пингую…' : 'Пинг серверов')}</div>`),
    group('Статус-экраны', `<div class="hint">Только у тебя, на сервере ничего не включается. Техработы ставят музыку на паузу, как настоящие; «Проверить снова» вернёт настоящий статус.</div>
      <div class="dev-btns">${btn('dev-mt', 'Техработы')}${btn('dev-outage', 'Сбой Яндекса и YouTube')}${btn('dev-status-real', 'Настоящий статус')}</div>`),
    group('Стабильность', `<div class="pref-row"><span><b>FPS и память поверх окна</b><span class="hint">Счётчик в правом нижнем углу</span></span>
        <button class="switch ${devState.fps ? 'on' : ''}" role="switch" aria-checked="${devState.fps}" aria-label="FPS и память" data-action="dev-fps"><span></span></button></div>
      <div class="dev-btns">${btn('dev-crash', 'Уронить окно', 'data-v="renderer"')}${btn('dev-crash', 'Уронить приложение', 'data-v="main"')}</div>`),
    group('Журналы', `<div class="dev-btns">${btn('dev-open', 'YouTube', 'data-v="yt"')}${btn('dev-open', 'VK', 'data-v="vk"')}${btn('dev-open', 'Тексты', 'data-v="lyrics"')}${btn('dev-diag', 'Скопировать диагностику')}</div>
      <div class="hint">Диагностика — версия, система, статус сервисов и настройки, без токенов.</div>`),
    group('Приколы', `<div class="hint">Ломают вид и поведение, но приложение остаётся рабочим. Только в этом окне: перезапуск, плашка «Сбросить приколы» или Ctrl+Shift+Backspace — и всё как было.</div>
      <div class="dev-btns">${PRANKS.map(([id, title, hint]) => `<button class="btn ${pranks.has(id) ? 'primary' : ''}" data-action="dev-prank" data-v="${id}" title="${esc(hint)}">${pranks.has(id) ? '✓ ' : ''}${esc(title)}</button>`).join('')}</div>
      ${pranks.active().length ? '<div class="dev-btns"><button class="btn" data-action="dev-prank-reset">Сбросить все приколы</button></div>' : ''}`),
    group('Флаги', `<div class="pref-row"><span><b>Spotify (librespot)</b><span class="hint">Экспериментальный нативный плеер. Добавляет отдельную привязку Spotify в сервисах. Только nightly на ПК.</span></span><button class="switch ${state.spotify?.native?.flag ? 'on' : ''}" role="switch" aria-checked="${!!state.spotify?.native?.flag}" aria-label="Spotify (librespot)" data-action="dev-librespot-flag"><span></span></button></div>${state.spotify?.native?.flag ? '<button class="btn" data-action="set-sec" data-sec="svc:sp-native">Открыть Spotify (librespot)</button>' : ''}`)
  ].join('');
}
async function loadDevInfo() {
  devState.info = await api.dev.info().catch(() => null);
  if (isSettingsRoute() && state.params && state.params.section === 'dev') renderSettings();
}
/** Счётчик FPS и памяти поверх окна */
let fpsRaf = 0;
function toggleFps(on) {
  devState.fps = on;
  let el = $('#dev-fps');
  cancelAnimationFrame(fpsRaf);
  if (!on) return el && el.remove();
  if (!el) {
    el = document.createElement('div');
    el.id = 'dev-fps';
    document.body.appendChild(el);
  }
  let frames = 0;
  let last = performance.now();
  const loop = (now) => {
    frames++;
    if (now - last >= 500) {
      const mem = performance.memory ? ` · ${Math.round(performance.memory.usedJSHeapSize / 1048576)} МБ` : '';
      el.textContent = `${Math.round((frames * 1000) / (now - last))} FPS${mem}`;
      frames = 0;
      last = now;
    }
    fpsRaf = requestAnimationFrame(loop);
  };
  fpsRaf = requestAnimationFrame(loop);
}

function soundCardHtml() {
  const s = state.settings;
  const fade = Number(s.fade) || 0;
  return `<section class="card eq-card">
    <div class="pref-row"><span><b>Выравнивать громкость</b><span class="hint">Треки из разных сервисов звучат одинаково громко — по данным Яндекса и YouTube о громкости трека. SoundCloud и VK такие данные не дают.</span></span>
      <button class="switch ${s.normalize ? 'on' : ''}" role="switch" aria-checked="${!!s.normalize}" aria-label="Выравнивать громкость" data-action="toggle-normalize"><span></span></button></div>
    <div class="pref-row"><span><b>Плавные переходы</b><span class="hint" id="fade-label">${fade ? `Трек затихает за ${fade} с до конца, следующий плавно нарастает` : 'Выключены — треки сменяются сразу'}</span></span>
      <input type="range" min="0" max="10" step="1" value="${fade}" data-input="fade" aria-label="Плавные переходы, секунд" style="width:180px"></div>
    <div class="pref-row"><span><b>Продолжать похожим</b><span class="hint">Плейлист или альбом доиграл — дальше без паузы идёт радио по последнему треку</span></span>
      <button class="switch ${s.continueSimilar !== false ? 'on' : ''}" role="switch" aria-checked="${s.continueSimilar !== false}" aria-label="Продолжать похожим" data-action="toggle-continue"><span></span></button></div>
    <div class="pref-row"><span><b>Трек из поиска</b><span class="hint">${(s.searchPlay || 'similar') === 'similar' ? 'Играет он, а дальше — похожее на него, как в Яндексе' : 'После него играют остальные найденные треки'}</span></span>
      <div class="pill-seg" role="radiogroup" aria-label="Что играть после трека из поиска">${[['similar', 'Дальше похожее'], ['list', 'Весь поиск']].map(([v, l]) => `<button role="radio" aria-checked="${(s.searchPlay || 'similar') === v}" class="${(s.searchPlay || 'similar') === v ? 'on' : ''}" data-action="search-play" data-v="${v}">${l}</button>`).join('')}</div></div>
  </section>`;
}

let normSeq = 0;
async function applyTrackSound() {
  const t = player.current;
  const s = state.settings || {};
  fadingOut = false;
  if (Number(s.fade) > 0) {
    eq.fade(0, 0.01);
    eq.fade(1, Math.min(2, Number(s.fade)));
  } else eq.unfade();
  const seq = ++normSeq;
  if (!t || !s.normalize) return eq.setTrackGain(0);
  const yt = t.source === 'yt' ? await api.loudness(t.id).catch(() => null) : null;
  if (seq === normSeq) eq.setTrackGain(normalizeGain(t, yt));
}

let fadingOut = false;
function checkFadeOut() {
  const fade = Number((state.settings || {}).fade) || 0;
  const a = player.audio;
  if (!fade || fadingOut || !Number.isFinite(a.duration) || player.repeat === 'one') return;
  const left = a.duration - a.currentTime;
  if (left > 0 && left <= fade) {
    fadingOut = true;
    eq.fade(0, Math.max(0.2, left - 0.1));
  }
}

let eqSaveTimer;
function saveEq(next, rerender = true) {
  state.settings = { ...state.settings, eq: next };
  eq.apply(next);
  clearTimeout(eqSaveTimer);
  eqSaveTimer = setTimeout(() => api.settings.set({ eq: next }).catch(() => {}), 300);
  if (rerender && isSettingsRoute()) renderSettings();
}

// ---------- Техработы и сбои сервисов (статус с сервера Nyao) ----------
const SVC_NAMES = { ya: 'Яндекс Музыка', yt: 'YouTube Music', sc: 'SoundCloud', vk: 'VK Музыка' };
let svcStatus = { maintenance: { active: false }, outages: [] };
const hiddenOutages = new Set();

function injectOutage() {
  const box = $('.scroll', view);
  if (!box) return;
  const list = svcStatus.outages.filter((id) => !hiddenOutages.has(id));
  if (!list.length) return;
  const names = list.map((id) => SVC_NAMES[id] || id);
  const one = names.length === 1;
  box.insertAdjacentHTML('afterbegin', `<div class="outage" role="status">
    <span class="outage-ic">${list.map((id) => badge(id)).join('')}</span>
    <span class="outage-txt"><b>${esc(names.join(', '))} ${one ? 'сейчас не отвечает' : 'сейчас не отвечают'}</b><span>${one ? 'Его треки' : 'Их треки'} в волне и поиске пока пропускаем, остальное работает. Вернётся — подключим сами.</span></span>
    <button class="ic" data-action="outage-hide" aria-label="Скрыть"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>`);
}

function applyStatus(s) {
  const was = svcStatus.maintenance && svcStatus.maintenance.active;
  svcStatus = { maintenance: (s && s.maintenance) || { active: false }, outages: (s && s.outages) || [] };
  const m = svcStatus.maintenance;
  let el = $('#mt');
  if (m.active) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'mt';
      el.className = 'mt';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="mt-brand"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" stroke-width="7" stroke-linecap="round" aria-hidden="true"><path d="M10 26c8-12 16-12 22 0s14 12 22 0" stroke="#FFD60A"/><path d="M10 32c8-12 16-12 22 0s14 12 22 0" stroke="#D8CEFF"/><path d="M10 38c8-12 16-12 22 0s14 12 22 0" stroke="#F0574A"/></svg>Nyao Music</div>
      <div class="mt-body">
        <svg class="mt-waves" width="260" height="120" viewBox="0 0 260 120" fill="none" stroke-width="14" stroke-linecap="round" aria-hidden="true"><path d="M20 52c26-34 52-34 74 0s48 34 74 0 50-34 72 0" stroke="#FFD60A"/><path d="M20 66c26-34 52-34 74 0s48 34 74 0 50-34 72 0" stroke="#D8CEFF"/><path d="M20 80c26-34 52-34 74 0s48 34 74 0 50-34 72 0" stroke="#F0574A"/></svg>
        <h1>${esc(m.title || 'Скоро вернёмся')}</h1>
        <p>${esc(m.text || '')}</p>
        ${m.until ? `<div class="mt-eta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${esc(m.until)}</div>` : ''}
        <button class="btn primary mt-retry" data-mt="retry">Проверить снова</button>
      </div>
      <div class="mt-foot">Лайки, плейлисты и входы в сервисы в порядке · проверяем каждые 2 минуты сами</div>`;
    el.querySelector('[data-mt="retry"]').onclick = async (e) => {
      e.currentTarget.disabled = true;
      applyStatus(await api.status.get(true).catch(() => svcStatus));
      if (svcStatus.maintenance.active) toast('Пока ещё чиним — загляни чуть позже');
    };
    if (!was && player.playing) player.toggle();
  } else if (el) {
    el.remove();
    if (was) toast('Nyao снова работает');
  }
  if (state.route === 'home') RENDER.home();
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

const friends = createFriends({
  api, state, esc, coverHtml, badge, toast, go, player, copyText, ago,
  get view() { return view; },
  joinRoom: (code) => { go('together'); joinRoom(code); },
  createRoom: async () => {
    state.room = await api.room.create();
    state.roomSync = { hostTrackId: null };
    roomPush(true);
    renderBar();
  },
  askText: (label, value, btn) => askText(label, value, btn),
  profileTabs: (a) => profileTabs(a),
  updateBadge: (n) => {
    friendsBadge = n;
    renderRail();
  }
});
const RENDER = { friends: () => friends.renderFriends(), user: () => friends.renderUser(), profile: () => friends.renderProfile(), home: renderHome, wave: renderWave, library: renderLibrary, search: renderSearch, settings: renderSettings, prefs: renderSettings, artist: renderArtist, album: renderAlbum, together: renderTogether, stats: renderStats, tracks: renderTrackList };

// ---------- Загрузка данных ----------
/** Может ли Spotify играть сам; если нет — треки Spotify играют копиями из других сервисов */
function syncSpMode() {
  const previousNative = spMode.native;
  const native = nativeVisible() && state.spotify.native.active;
  spMode.native = !!native;
  const s = native ? state.spotify.native : state.spotify;
  const a = s && s.account;
  const was = spMode.fallback;
  spMode.fallback = !(s && s.loggedIn && !s.regionBlocked && a && !a.error && a.premium !== false);
  // Spotify снова может играть сам — значки «SP → Я» и пометки о копиях больше не нужны
  if (!spMode.fallback) spMode.subs.clear();
  if ((was !== spMode.fallback || previousNative !== spMode.native) && player.current && player.current.source === 'sp') { spotifySync.resetBackend(); player.reload(); }
}
async function loadStatus() {
  state.status = await api.auth.status().catch(() => ({ ya: null, yt: null, sc: null, vk: null }));
  // Spotify — отдельно: вход со своим Client ID, свой экран в настройках
  if (api.spotify) {
    state.spotify = await api.spotify.status().catch(() => null);
    const selected = state.spotify?.native?.active ? state.spotify.native : state.spotify;
    state.status.sp = selected?.loggedIn ? selected.account || { name: 'Spotify' } : null;
  }
  syncSpMode();
  renderAccounts();
}
function releasesHtml() {
  const r = state.releases;
  if (!r || !r.length) return '';
  return `<section><div class="sec-head"><h2 class="sec">Новые релизы любимых исполнителей</h2></div>
    <div class="recent-row releases-row">${r.map((al) => `<button class="rcard" data-action="open-album" data-ref="${esc(al.ref)}">${coverHtml(al, '', true)}<b>${esc(al.title)}</b><span>${esc(al.artist)}</span><span class="rel-when">${al.kind === 'single' ? 'Сингл' : 'Альбом'} · ${esc(releaseAgo(al.releaseDate))}</span></button>`).join('')}</div></section>`;
}
async function loadReleases() {
  if (!api.releases || !state.status.ya) return;
  try {
    state.releases = await api.releases();
  } catch {
    state.releases = [];
  }
  if (state.route === 'home') renderHome();
}

async function loadHome() {
  loadRecent();
  if (!state.releases) loadReleases();
  if (layout() === 'player' && !state.lib.lists) loadLibrary();
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
      state.lib.counts = { ya: r.ya, yt: r.yt, sc: r.sc || 0, vk: r.vk || 0, sp: r.sp || 0 };
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
    const tracks = id === 'liked' ? await loadLiked() : id.startsWith('liked:') ? (await loadLiked()).filter((t) => t.source === id.slice(6)) : await api.library.tracks(id);
    if (state.lib.selected !== id) return;
    state.lib.tracks = tracks;
  } catch (e) {
    state.lib.tracks = [];
    toast(e.message, true);
  }
  if (state.route === 'library') renderLibrary();
}
/** Название выбранного в медиатеке списка — для подписи «играет из …» */
function libLabel() {
  const id = state.lib.selected;
  const l = likedEntries().find((x) => x.id === id) || (state.lib.lists || []).find((p) => p.id === id);
  return l ? l.title : 'Мне нравится';
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
    if (state.drawer === 'info') renderDrawer();
  } catch {
    // карточка исполнителя просто останется без фото
  }
}

async function setWave(patch) {
  state.settings = await api.settings.set(patch);
  if (['home', 'wave', 'settings'].includes(state.route)) RENDER[state.route]();
  if (player.mode === 'wave') {
    toast('Перенастраиваю волну…');
    player.refreshWave().catch((e) => toast(e.message, true));
  }
}

// ---------- Любимые исполнители ----------
async function loadFavArtists() {
  if (!api.artists) return;
  try {
    state.favArtists = (await api.artists.list()) || [];
  } catch {
    return;
  }
  if (state.route === 'artist') renderArtist();
  if (state.route === 'library' && state.lib.filter === 'artists') renderLibrary();
}
function favOf(a) {
  if (!a) return null;
  const refs = a.refs || {};
  return (state.favArtists || []).find((x) => x.ref === state.artist.ref || (refs.ya && (x.ref === refs.ya || (x.refs && x.refs.ya === refs.ya))) || (refs.yt && (x.ref === refs.yt || (x.refs && x.refs.yt === refs.yt)))) || null;
}

// ---------- Меню «⋯» ----------
function openMenu(x, y, track, queueIndex = -1, { addOnly = false } = {}) {
  const menu = $('#menu');
  const mixes = (state.lib.lists || []).filter((p) => p.source === 'mix');
  const inQueue = queueIndex > -1 && queueIndex !== player.index;
  menu.innerHTML = addOnly ? `
    <div class="lbl">Добавить «${esc(track.title)}»</div>
    ${mixes.map((m) => `<button data-m="mix" data-id="${esc(m.id)}">${esc(m.title)}</button>`).join('') || '<div class="lbl" style="text-transform:none;letter-spacing:0">Миксов пока нет</div>'}
    <button data-m="newmix">${ICONS.plus} Новый микс…</button>
    <button data-m="next">Играть следующим</button>` : `
    <button data-m="next">Играть следующим</button>
    <button data-m="last">В конец очереди</button>
    ${inQueue ? '<button data-m="remove">Убрать из очереди</button>' : ''}
    <button data-m="radio">Похожее · радио по треку</button>
    ${state.cloud.loggedIn ? '<button data-m="share">Отправить другу</button>' : ''}
    <button data-m="link">Скопировать ссылку</button>
    <button data-m="like">${player.liked.has(track.id) ? 'Убрать из «Мне нравится»' : 'В «Мне нравится»'}</button>
    ${track.artistRef ? '<button data-m="artist">Открыть исполнителя</button>' : ''}
    ${track.albumRef ? '<button data-m="album">Открыть альбом</button>' : ''}
    <div class="lbl">Добавить в микс</div>
    ${mixes.map((m) => `<button data-m="mix" data-id="${esc(m.id)}">${esc(m.title)}</button>`).join('')}
    <button data-m="newmix">${ICONS.plus} Новый микс…</button>`;
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  // из плеера меню раскрывается вверх, над кнопкой
  menu.style.top = `${Math.max(8, addOnly ? y - r.height : Math.min(y, innerHeight - r.height - 8))}px`;
  menu.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    menu.hidden = true;
    try {
      if (b.dataset.m === 'next') {
        player.enqueueNext(track);
        toast('Будет играть следующим');
      } else if (b.dataset.m === 'last') {
        player.enqueueLast(track);
        toast('Добавлено в конец очереди');
      } else if (b.dataset.m === 'remove') {
        player.removeAt(queueIndex);
      } else if (b.dataset.m === 'radio') {
        await player.startRadio(track);
      } else if (b.dataset.m === 'share') {
        if (!state.social || !state.social.loaded) await friends.load();
        friends.sharePicker(track, x, y);
      } else if (b.dataset.m === 'link') {
        copyText(trackLink(track));
        toast('Ссылка скопирована — откроется в Nyao Music');
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
/** Подтверждение: «Да» → true, «Отмена» или клик мимо → false */
function askConfirm(label, okLabel = 'Да') {
  return new Promise((resolve) => {
    const menu = $('#menu');
    menu.innerHTML = `<div style="padding:10px;display:flex;flex-direction:column;gap:10px;max-width:280px"><div style="white-space:normal">${esc(label)}</div>
      <div style="display:flex;gap:8px"><button class="btn primary" data-c="1" style="flex:1;justify-content:center">${esc(okLabel)}</button><button class="btn" data-c="0" style="flex:1;justify-content:center">Отмена</button></div></div>`;
    menu.hidden = false;
    menu.style.left = `${innerWidth / 2 - 140}px`;
    menu.style.top = `${innerHeight / 2 - 60}px`;
    menu.onclick = (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      menu.hidden = true;
      resolve(b.dataset.c === '1');
    };
  });
}

/**
 * Ссылка снаружи (nyao://… или music.withnyao.app/share/…): приглашение, комната, профиль, трек.
 * Такую ссылку может прислать кто угодно — поэтому дружба и вход в комнату только после подтверждения.
 */
async function openDeepLink(link) {
  if (!link) return;
  try {
    if (link.kind === 'user') {
      friends.openUser(link.value);
    } else if (link.kind === 'add') {
      if (!state.cloud.loggedIn) return toast('Чтобы добавить друга, войди в аккаунт Nyao', true);
      if (await askConfirm('Принять приглашение в друзья по ссылке?', 'Принять')) await friends.useInvite(link.value);
    } else if (link.kind === 'join') {
      if (!state.cloud.loggedIn) return toast('Чтобы слушать вместе, войди в аккаунт Nyao', true);
      if (await askConfirm(`Войти в комнату «Слушать вместе» ${link.value}?`, 'Войти')) { go('together'); joinRoom(link.value); }
    } else if (link.kind === 'track') {
      const t = await api.matchPlayable(link.track).catch(() => null);
      if (!t) return toast(`Не нашёл «${link.track.title}» в подключённых сервисах`, true);
      player.playList([t], 0, 'По ссылке');
      if (t.source !== link.track.source) toast(`Играет из ${srcName(t.source, true)} — исходный сервис не подключён`);
    }
  } catch (e) {
    toast(e.message, true);
  }
}

function askText(label, value = '', btnLabel = 'Создать') {
  return new Promise((resolve) => {
    const menu = $('#menu');
    menu.innerHTML = `<form style="padding:8px;display:flex;flex-direction:column;gap:8px"><div class="lbl" style="padding:0">${esc(label)}</div>
      <input name="v" value="${esc(value)}" style="height:38px;border-radius:8px;border:1px solid var(--line2);background:var(--s2);color:var(--text);padding:0 10px;font:inherit">
      <button class="btn primary" style="height:38px;justify-content:center">${esc(btnLabel)}</button></form>`;
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

// ---------- Nyao Connect: пульт для других устройств ----------
function devIcon(platform) {
  return platform === 'android'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M11 18.5h2"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/></svg>';
}
function connectCardHtml(d) {
  const t = d.track;
  const status = d.online ? (t ? (d.playing ? 'Играет' : 'На паузе') : 'В сети') : `Не в сети${d.lastSeen ? ' · ' + ago(new Date(d.lastSeen).getTime()) : ''}`;
  return `<div class="cx-dev ${d.online ? 'on' : ''}">
    <div class="cx-top"><span class="cx-ic">${devIcon(d.platform)}</span><div class="cx-name"><b>${esc(d.device)}</b><span>${esc(status)}</span></div><span class="cx-dot" aria-hidden="true"></span></div>
    ${t ? `<div class="cx-track">${coverHtml(t, 'sm')}<div class="cx-meta"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div>` : ''}
    ${d.online ? `<div class="cx-ctl">
        <button class="ic" data-action="cx-cmd" data-cmd="prev" data-id="${esc(d.deviceId)}" aria-label="Предыдущий">${ICONS.prev}</button>
        <button class="play" data-action="cx-cmd" data-cmd="toggle" data-id="${esc(d.deviceId)}" aria-label="${d.playing ? 'Пауза' : 'Играть'}">${d.playing ? ICONS.pause : ICONS.play}</button>
        <button class="ic" data-action="cx-cmd" data-cmd="next" data-id="${esc(d.deviceId)}" aria-label="Следующий">${ICONS.next}</button>
        ${d.volume != null ? `<input type="range" class="cx-vol" min="0" max="100" value="${Math.round(d.volume * 100)}" data-cx-vol="${esc(d.deviceId)}" aria-label="Громкость на «${esc(d.device)}»">` : ''}
      </div>
      <div class="cx-acts">
        ${t ? `<button class="btn" data-action="cx-take" data-id="${esc(d.deviceId)}">Забрать сюда</button>` : ''}
        ${player.current ? `<button class="btn primary" data-action="cx-send" data-id="${esc(d.deviceId)}">Включить там</button>` : ''}
      </div>` : ''}
  </div>`;
}
function renderConnect() {
  const el = $('#connect');
  if (el.hidden) return;
  if (!state.cloud.loggedIn) {
    el.innerHTML = `<div class="cx-head"><b>Nyao Connect</b><span>Управляй музыкой на своих устройствах</span></div>
      <div class="hint">Войди в аккаунт Nyao на этом и другом устройстве — и сможешь переключать треки на телефоне с компьютера и наоборот.</div>
      <button class="btn primary" data-action="go" data-route="settings">Войти в аккаунт Nyao</button>`;
    return;
  }
  const devs = state.connect.devices;
  const others = (devs || []).filter((d) => !d.current).sort((a, b) => b.online - a.online);
  const t = player.current;
  el.innerHTML = `<div class="cx-head"><b>Nyao Connect</b><button class="icbtn" data-action="cx-refresh" aria-label="Обновить" title="Обновить"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg></button></div>
    <div class="cx-dev me on"><div class="cx-top"><span class="cx-ic">${devIcon(api.platform)}</span><div class="cx-name"><b>Это устройство</b><span>${t ? esc(t.title) + ' · ' + esc(t.artist) : 'Ничего не играет'}</span></div><span class="cx-dot"></span></div></div>
    ${state.connect.error ? `<div class="hint err">${esc(state.connect.error)}</div>` : ''}
    ${devs == null ? '<div class="skeleton" style="height:120px"></div>' : others.length ? others.map(connectCardHtml).join('') : '<div class="hint">Других устройств пока нет — войди в аккаунт Nyao на телефоне или другом компьютере.</div>'}
    <button class="btn cx-together" data-action="go" data-route="together">${NAV.find((n) => n[0] === 'together') ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="${NAV.find((n) => n[0] === 'together')[2]}"/></svg>` : ''}Слушать вместе с друзьями</button>`;
  $$('.cx-vol', el).forEach(setRangeFill);
}
async function loadConnect() {
  if (!state.cloud.loggedIn) return renderConnect();
  try {
    state.connect.devices = await api.connect.devices();
    state.connect.error = null;
  } catch (e) {
    state.connect.error = e.message;
  }
  renderConnect();
}
function toggleConnect() {
  const el = $('#connect');
  el.hidden = !el.hidden;
  if (!el.hidden) {
    renderConnect();
    loadConnect();
  }
}

/** Команда с другого устройства (Nyao Connect) */
function remoteCommand(e) {
  const a = e.args || {};
  const from = (e.from && e.from.device) || 'другое устройство';
  switch (e.cmd) {
    case 'toggle':
      player.toggle();
      break;
    case 'play':
      if (player.current && !player.playing) player.toggle();
      break;
    case 'pause':
      if (player.playing) player.audio.pause();
      break;
    case 'next':
      player.next(true);
      break;
    case 'prev':
      player.prev();
      break;
    case 'seek':
      player.seek(a.position);
      break;
    case 'volume':
      player.setVolume(a.volume);
      volEl.value = Math.round(a.volume * 100);
      setRangeFill(volEl);
      api.settings.set({ volume: a.volume }).catch(() => {});
      break;
    case 'like':
      if (player.current) player.toggleLike().catch(() => {});
      break;
    case 'playTracks':
      if (!a.tracks || !a.tracks.length) break;
      if (state.room && !state.room.isHost) leaveRoom(true);
      playListAt(a.tracks, a.index || 0, a.title || `С «${from}»`, a.position || 0, a.play !== false);
      toast(`Музыка перенесена с «${from}»`);
      break;
  }
  setTimeout(() => pushNow(true), 400);
}
/** Включить список с нужного трека и места */
function playListAt(tracks, index, label, position = 0, play = true) {
  player.playList(tracks, index, label);
  const once = () => {
    player.audio.removeEventListener('loadedmetadata', once);
    if (position > 2) player.seek(position);
    if (!play) player.audio.pause();
  };
  player.audio.addEventListener('loadedmetadata', once);
}
function copyText(text) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// ---------- «Слушать вместе» ----------
async function loadRoom() {
  if (state.cloud.loggedIn) {
    try {
      const r = await api.room.current();
      if (r && (!state.room || state.room.code !== r.code)) state.roomSync = { hostTrackId: null };
      state.room = r;
      if (r && !r.isHost) applyRoom(r.state);
    } catch {
      // нет связи — покажем, что есть
    }
  }
  if (state.route === 'together') renderTogether();
}
async function joinRoom(input) {
  const code = parseRoomCode(input);
  if (!code) return toast('Код комнаты — 6 букв и цифр', true);
  try {
    state.room = await api.room.join(code);
    state.roomSync = { hostTrackId: null };
    toast(state.room.isHost ? 'Это твоя комната' : `Ты слушаешь вместе с ${state.room.host.name}`);
    if (!state.room.isHost) applyRoom(state.room.state);
  } catch (e) {
    toast(e.message, true);
  }
  if (state.route === 'together') renderTogether();
  renderBar();
}
async function leaveRoom(silent = false) {
  const r = state.room;
  if (!r) return;
  state.room = null;
  state.roomSync = { hostTrackId: null };
  await api.room.leave(r.code).catch(() => {});
  if (!silent) toast(r.isHost ? 'Комната закрыта' : 'Ты вышел из комнаты');
  if (state.route === 'together') renderTogether();
  renderBar();
}
let roomTimer;
let roomLastBeat = 0;
/** Хост: сообщаем комнате, что играет (сразу при смене трека/паузе, иначе раз в 15 секунд) */
function roomPush(now = false) {
  if (!state.room || !state.room.isHost) return;
  clearTimeout(roomTimer);
  roomTimer = setTimeout(() => {
    roomLastBeat = Date.now();
    const t = player.current;
    api.room.state(state.room.code, { track: t, position: player.audio.currentTime || 0, playing: player.playing }).catch((e) => {
      if (/только тот|403/.test(e.message)) {
        state.room = null;
        if (state.route === 'together') renderTogether();
      }
    });
  }, now ? 0 : 300);
}
let roomBusy = false;
/** Гость: догоняем хоста — тот же трек (или найденный в своих сервисах), то же место */
async function applyRoom(st) {
  if (!state.room || state.room.isHost || roomBusy) return;
  const plan = roomSyncPlan({ hostTrackId: state.roomSync.hostTrackId, position: player.audio.currentTime || 0, playing: player.playing }, st);
  if (plan.load) {
    roomBusy = true;
    const started = Date.now();
    try {
      const t = await api.matchPlayable(st.track).catch(() => null);
      state.roomSync.hostTrackId = st.track.id;
      if (!t) {
        player.audio.pause();
        toast(`«${st.track.title}» нет в твоих сервисах — ждём следующий трек`, true);
        return;
      }
      const pos = (st.position || 0) + (st.playing ? (Date.now() - started) / 1000 : 0);
      playListAt([t], 0, `Вместе с ${state.room ? state.room.host.name : ''}`, pos, st.playing);
    } finally {
      roomBusy = false;
    }
    return;
  }
  if (plan.seek != null) player.seek(plan.seek);
  if (plan.play === true) player.audio.play().catch(() => {});
  if (plan.play === false) player.audio.pause();
}
function showReaction(emoji, name) {
  const layer = $('#react-layer') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'react-layer' }));
  const el = document.createElement('div');
  el.className = 'react-fly';
  el.style.left = `${10 + Math.random() * 80}%`;
  el.innerHTML = `<span class="e">${esc(emoji)}</span><span class="n">${esc(name || '')}</span>`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function renderTogether() {
  const r = state.room;
  const head = profileTabs('together') + '<h1 class="page">Слушать вместе</h1>';
  if (!state.cloud.loggedIn) {
    view.innerHTML = `<div class="scroll together">${head}
      <div class="card"><div class="field"><label>Нужен аккаунт Nyao</label><div class="hint">Комнаты работают через аккаунт Nyao (вход через Telegram). Токены музыкальных сервисов остаются на устройстве.</div></div><div><button class="btn primary" data-action="go" data-route="settings">Войти</button></div></div></div>`;
    return;
  }
  if (!r) {
    view.innerHTML = `<div class="scroll together">${head}
      <p class="muted tg-lead">Одна музыка на всех: хост включает треки, а у остальных они играют одновременно — каждый слушает в своём сервисе. Если трека там нет, Nyao найдёт его в другом.</p>
      <div class="tg-start">
        <section class="tg-card create"><canvas id="tg-ribbon"></canvas>
          <span class="eyebrow">Ты ведёшь</span><h2>Создать комнату</h2><p>Получишь код и ссылку — отправь друзьям.</p>
          <button class="btn primary" data-action="room-create">Создать</button></section>
        <section class="tg-card"><span class="eyebrow">Тебя позвали</span><h2>Войти по коду</h2><p>Код из 6 знаков или ссылка-приглашение.</p>
          <form data-form="room-join" class="tg-join"><input name="code" maxlength="64" placeholder="Например, K7QM2X" aria-label="Код комнаты" autocomplete="off"><button class="btn primary">Войти</button></form></section>
      </div></div>`;
    new Ribbon($('#tg-ribbon'), { lines: 10, cy: 0.6, amp: 0.7, accent: accentColor() });
    return;
  }
  const st = r.state;
  const t = st && st.track;
  const people = [{ name: r.host.name, picture: r.host.picture, host: true }, ...r.members];
  view.innerHTML = `<div class="scroll together">${head}
    <section class="tg-room">
      <div class="tg-code-box">
        <span class="eyebrow">${r.isHost ? 'Твоя комната' : 'Комната ' + esc(r.host.name)}</span>
        <button class="tg-code" data-action="room-code" title="Скопировать код">${esc(r.code)}</button>
        <div class="tg-acts"><button class="btn" data-action="room-copy">Скопировать ссылку</button><button class="btn" data-action="room-leave">${r.isHost ? 'Закрыть комнату' : 'Выйти'}</button></div>
      </div>
      <div class="tg-now">
        ${t ? `${coverHtml(t)}<div class="tg-meta"><span class="eyebrow">${st.playing ? 'Сейчас играет у всех' : 'На паузе'}</span><b>${esc(t.title)}</b><span>${badge(t.source)}${esc(t.artist)}</span></div>`
          : `<div class="tg-meta"><span class="eyebrow">Тишина</span><b>${r.isHost ? 'Включи что-нибудь — все услышат' : 'Ждём, пока ' + esc(r.host.name) + ' включит музыку'}</b></div>`}
      </div>
    </section>
    <div class="tg-cols">
      <section class="card"><span class="eyebrow">В комнате · ${people.length}</span>
        <div class="tg-people">${people.map((p) => `<div class="tg-person">${p.picture ? `<img src="${esc(p.picture)}" alt="">` : `<span class="av">${esc((p.name || '?').slice(0, 1))}</span>`}<b>${esc(p.name)}</b>${p.host ? '<span class="tag">ведёт</span>' : ''}</div>`).join('')}</div>
        <span class="hint">${r.isHost ? 'Всё, что ты включаешь, ставишь на паузу или перематываешь, повторяется у всех.' : 'Музыку выбирает ' + esc(r.host.name) + '. Пауза у тебя — только у тебя: при следующем треке ты снова догонишь.'}</span>
      </section>
      <section class="card"><span class="eyebrow">Реакции</span>
        <div class="tg-reacts">${REACTIONS.map((e) => `<button data-action="room-react" data-e="${e}" aria-label="Реакция ${e}">${e}</button>`).join('')}</div>
        <span class="hint">Видны всем в комнате.</span>
      </section>
    </div>
  </div>`;
}
function onRoomEvent(e) {
  if (e.type === 'room-closed') {
    if (state.room && state.room.code === e.code) {
      state.room = null;
      toast('Хост закрыл комнату');
    }
  } else if (e.type === 'room') {
    if (!state.room || state.room.code !== e.room.code) return;
    state.room = { ...e.room, isHost: state.room.isHost };
    if (e.joined) toast(`${e.joined} в комнате`);
    if (e.left) toast(`${e.left} вышел`);
    if (!state.room.isHost) applyRoom(e.room.state);
  } else if (e.type === 'react') {
    showReaction(e.emoji, e.name);
    return;
  }
  if (state.route === 'together') renderTogether();
  renderBar();
}

// ---------- Итоги ----------
async function loadStats() {
  if (!state.cloud.loggedIn) return renderStats();
  const period = state.stats.period;
  state.stats.loading = true;
  state.stats.error = null;
  if (state.route === 'stats') renderStats();
  try {
    const data = await api.stats(period);
    if (state.stats.period !== period) return;
    state.stats.data = data;
  } catch (e) {
    state.stats.error = e.message;
  }
  state.stats.loading = false;
  if (state.route === 'stats') renderStats();
}
function statTrack(t) {
  const i = String(t.trackId).indexOf(':');
  return { id: t.trackId, source: t.source || t.trackId.slice(0, i), srcId: t.trackId.slice(i + 1), title: t.title, artist: t.artist, cover: t.cover, duration: t.duration || 0 };
}
function renderStats() {
  const s = state.stats.data;
  const seg = `<div class="pill-seg" role="radiogroup" aria-label="Период">${PERIODS.map(([v, l]) => `<button role="radio" aria-checked="${state.stats.period === v}" class="${state.stats.period === v ? 'on' : ''}" data-action="stats-period" data-v="${v}">${l}</button>`).join('')}</div>`;
  let body;
  if (!state.cloud.loggedIn) {
    body = `<div class="card"><div class="field"><label>Нужен аккаунт Nyao</label><div class="hint">Итоги собираются из истории прослушиваний со всех твоих устройств — она хранится в аккаунте Nyao.</div></div><div><button class="btn primary" data-action="go" data-route="settings">Войти</button></div></div>`;
  } else if (state.stats.error) {
    body = `<div class="card"><div class="hint err">${esc(state.stats.error)}</div></div>`;
  } else if (!s) {
    body = '<div class="skeleton" style="height:240px"></div><div class="skeleton" style="height:160px;margin-top:16px"></div>';
  } else if (!s.plays) {
    body = '<div class="empty">За этот период пока нечего подводить — послушай что-нибудь, и здесь появятся итоги.</div>';
  } else {
    const tracks = s.topTracks.map(statTrack);
    lists['stats-top'] = tracks;
    const maxH = Math.max(...s.hours, 1);
    const total = Object.values(s.sources).reduce((a, b) => a + b, 0) || 1;
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const maxD = Math.max(...s.weekdays, 1);
    const topA = s.topArtists[0];
    body = `<section class="st-hero"><canvas id="st-ribbon"></canvas>
        <button class="icbtn st-refresh" data-action="stats-refresh" aria-label="Обновить итоги" title="Обновить">${state.stats.loading ? '…' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>'}</button>
        <span class="eyebrow">${esc(periodTitle(s.period, s.from))}</span>
        <div class="st-big">${num(s.minutes)}</div>
        <div class="st-sub">${pl(s.minutes, 'минута', 'минуты', 'минут')} музыки · ${num(s.plays)} ${pl(s.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}</div>
        ${topA ? `<div class="st-topa">${coverHtml({ cover: topA.cover }, 'sm')}<span>Главный исполнитель — <b>${esc(topA.name)}</b>, ${minutesText(topA.minutes)}</span></div>` : ''}
      </section>
      <div class="st-facts">${statFacts(s).map((f) => `<div class="st-fact"><b>${esc(f.big)}</b><span>${esc(f.label)}</span></div>`).join('')}</div>
      <div class="st-cols">
        <section class="card"><span class="eyebrow">Исполнители</span>
          <ol class="st-artists">${s.topArtists.map((a, i) => `<li><span class="n">${i + 1}</span>${coverHtml({ cover: a.cover }, 'sm')}<div><b>${esc(a.name)}</b><span>${minutesText(a.minutes)} · ${a.tracks} ${pl(a.tracks, 'трек', 'трека', 'треков')}</span></div></li>`).join('')}</ol></section>
        <section class="card"><div class="sec-head"><span class="eyebrow">Треки</span><button class="link" data-action="stats-play">Слушать все</button></div>
          ${tracksHtml(tracks, 'stats-top')}</section>
      </div>
      <div class="st-cols">
        <section class="card"><span class="eyebrow">Когда слушаешь</span>
          <div class="st-hours">${s.hours.map((m, h) => `<span style="height:${Math.max(3, (m / maxH) * 100)}%" title="${h}:00 — ${minutesText(m)}"></span>`).join('')}</div>
          <div class="st-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          <div class="st-week">${s.weekdays.map((m, i) => `<div><span style="opacity:${0.25 + (m / maxD) * 0.75}"></span><b>${days[i]}</b></div>`).join('')}</div></section>
        <section class="card"><span class="eyebrow">Сервисы</span>
          <div class="st-src">${Object.entries(s.sources).map(([k, m]) => `<div class="row"><span>${badge(k)}${esc(srcName(k) || 'Другое')}</span><b>${Math.round((m / total) * 100)}%</b><i style="width:${Math.max(2, (m / total) * 100)}%" class="b-${esc(k)}"></i></div>`).join('')}</div>
          ${s.first ? `<span class="hint">Первый трек периода: «${esc(s.first.title)}» — ${esc(s.first.artist)}</span>` : ''}</section>
      </div>`;
  }
  view.innerHTML = `<div class="scroll stats">${profileTabs('')}<div class="st-head"><h1 class="page">Статистика</h1>${seg}</div>${body}</div>`;
  if ($('#st-ribbon')) new Ribbon($('#st-ribbon'), { lines: 14, cy: 0.55, amp: 1, accent: accentColor() });
}

// ---------- Перенос плейлиста в другой сервис ----------
async function openTransfer(sel, tracks) {
  const targets = (await api.transfer.targets()).filter((t) => t.id !== sel.source || sel.id === 'liked');
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'xfer';
  const title = sel.id.startsWith('liked') ? 'Мне нравится' : sel.title;
  const first = (targets.find((t) => t.ok) || targets[0] || {}).id;
  wrap.innerHTML = `<div class="modal" role="dialog" aria-label="Перенос плейлиста">
    <h2>Перенести плейлист</h2>
    <span class="muted">«${esc(title)}» · ${tracks.length} ${pl(tracks.length, 'трек', 'трека', 'треков')}. Каждый трек найдём в выбранном сервисе, ненайденные покажем списком.</span>
    <div class="xf-targets">${targets.map((t) => `<label class="xf-t ${t.ok ? '' : 'off'}"><input type="radio" name="xf" value="${t.id}" ${t.id === first && t.ok ? 'checked' : ''} ${t.ok ? '' : 'disabled'}>
      <span class="xf-dot ${t.id}"></span><span><b>${esc(t.name)}</b><small>${t.id === 'mix' ? 'Плейлист внутри Nyao, синхронизируется между устройствами' : t.ok ? 'Создадим приватный плейлист' : 'Нужен вход в этот сервис'}</small></span></label>`).join('')}</div>
    <label class="field"><span class="lbl">Название</span><input class="xf-name" value="${esc(title)}" maxlength="80"></label>
    <div class="xf-progress" hidden><div class="xf-bar"><i></i></div><span class="muted xf-count"></span></div>
    <div class="xf-result" hidden></div>
    <div class="modal-foot"><button class="btn" data-x="close">Отмена</button><button class="btn primary" data-x="go" ${first ? '' : 'disabled'}>Перенести</button></div>
  </div>`;
  document.body.appendChild(wrap);
  let running = false;
  const close = () => {
    if (!running) wrap.remove();
  };
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) close();
  });
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'close') return close();
    if (b.dataset.x === 'open') {
      wrap.remove();
      await loadLibrary(true);
      if (b.dataset.id) selectPlaylist(b.dataset.id);
      go('library');
      return;
    }
    if (b.dataset.x !== 'go' || running) return;
    const target = ($('input[name="xf"]:checked', wrap) || {}).value;
    if (!target) return toast('Выбери, куда переносить', true);
    running = true;
    b.disabled = true;
    $('.xf-progress', wrap).hidden = false;
    $('.xf-count', wrap).textContent = 'Ищу треки…';
    try {
      const r = await api.transfer.start({ tracks, title: $('.xf-name', wrap).value.trim() || title, target });
      const res = $('.xf-result', wrap);
      res.hidden = false;
      res.innerHTML = `<b>${r.playlistId ? 'Готово' : 'Ничего не нашлось'}: перенесено ${r.found} из ${r.total}</b>
        ${r.missing.length ? `<details><summary>Не нашлись (${r.missing.length})</summary><ul>${r.missing.slice(0, 200).map((m) => `<li>${esc(m.artist)} — ${esc(m.title)}</li>`).join('')}</ul></details>` : ''}`;
      $('.modal-foot', wrap).innerHTML = `<button class="btn" data-x="close">Закрыть</button>${r.playlistId ? `<button class="btn primary" data-x="open" data-id="${esc(r.playlistId)}">Открыть</button>` : ''}`;
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
    } finally {
      running = false;
    }
  });
}
if (api.transfer) {
  api.transfer.onProgress((p) => {
    const w = $('#xfer');
    if (!w) return;
    $('.xf-bar i', w).style.width = `${Math.round((p.done / Math.max(1, p.total)) * 100)}%`;
    $('.xf-count', w).textContent = `Проверено ${p.done} из ${p.total} · найдено ${p.found}`;
  });
}

// ---------- Обработчики экрана ----------
async function handleAction(el, e) {
  const a = el.dataset.action;
  if (a && a.startsWith('fr-') && (await friends.action(el))) return;
  switch (a) {
    case 'set-sec':
      // с отдельной страницы «Настройки» разделы открываются на ней же
      go(state.route === 'prefs' && el.dataset.sec !== 'account' ? 'prefs' : 'settings', el.dataset.sec ? { section: el.dataset.sec } : {});
      break;
    case 'open-connect':
      toggleConnect();
      break;
    case 'go':
      $('#connect').hidden = true;
      go(el.dataset.route);
      break;
    case 'cx-cmd': {
      const d = (state.connect.devices || []).find((x) => x.deviceId === el.dataset.id);
      await api.connect.cmd(el.dataset.id, el.dataset.cmd);
      if (d && el.dataset.cmd === 'toggle') {
        d.position = livePosition(d);
        d.updatedAt = Date.now();
        d.playing = !d.playing;
        renderConnect();
      }
      break;
    }
    case 'cx-take': {
      // свежая запись с очередью (в живых событиях её нет)
      const fresh = (await api.connect.devices().catch(() => null)) || [];
      const d = fresh.find((x) => x.deviceId === el.dataset.id) || (state.connect.devices || []).find((x) => x.deviceId === el.dataset.id);
      if (!d || !d.track) break;
      playHandoff(d, `С «${d.device}»`);
      api.connect.cmd(d.deviceId, 'pause').catch(() => {});
      $('#connect').hidden = true;
      break;
    }
    case 'cx-send': {
      const d = (state.connect.devices || []).find((x) => x.deviceId === el.dataset.id);
      if (!d || !player.current) break;
      const q = queueForTransfer(player.queue, player.index);
      await api.connect.cmd(d.deviceId, 'playTracks', { ...q, position: player.audio.currentTime || 0, title: player.label || '' });
      player.audio.pause();
      toast(`Играет на «${d.device}»`);
      $('#connect').hidden = true;
      break;
    }
    case 'cx-refresh':
      await loadConnect();
      break;
    case 'room-create':
      state.room = await api.room.create();
      state.roomSync = { hostTrackId: null };
      roomPush(true);
      toast('Комната создана — поделись кодом');
      renderTogether();
      renderBar();
      break;
    case 'room-leave':
      await leaveRoom();
      break;
    case 'room-copy':
      copyText(JOIN_BASE + state.room.code);
      toast('Ссылка скопирована');
      break;
    case 'room-code':
      copyText(state.room.code);
      toast('Код скопирован');
      break;
    case 'room-react':
      if (state.room) api.room.react(state.room.code, el.dataset.e).catch((err) => toast(err.message, true));
      break;
    case 'stats-refresh':
      // сначала дошлём накопленные прослушивания, потом пересчитаем
      if (api.cloud && api.cloud.sync) await api.cloud.sync().catch(() => {});
      await loadStats();
      toast('Статистика обновлена');
      break;
    case 'stats-period':
      state.stats.period = el.dataset.v;
      state.stats.data = null;
      loadStats();
      break;
    case 'stats-play': {
      const tracks = lists['stats-top'] || [];
      if (tracks.length) player.playList(tracks, 0, 'Статистика: любимое');
      break;
    }
    case 'pl-transfer': {
      const all = [...likedEntries(), ...(state.lib.lists || [])];
      const sel = all.find((p) => p.id === state.lib.selected);
      if (sel && state.lib.tracks) openTransfer(sel, state.lib.tracks);
      break;
    }
    case 'back':
      back();
      break;
    case 'wave-toggle':
      if (player.mode === 'wave' && player.current) player.toggle();
      else await player.startWave();
      if (state.route === 'home' || state.route === 'wave') RENDER[state.route]();
      break;
    case 'wave-tune':
      state.waveTune = true;
      $('.wave-tune-layer', view)?.classList.add('open');
      $('.wave-tune-btn', view)?.setAttribute('aria-expanded', 'true');
      break;
    case 'wave-tune-close':
      closeWaveTune();
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
      const label = el.dataset.list === 'lib' ? libLabel() : el.dataset.list === 'search' ? 'Поиск' : el.dataset.list === 'home-recent' ? 'Недавно слушал' : el.dataset.list === 'home-top' ? 'Чаще всего' : '';
      if (el.dataset.list === 'search' && (state.settings.searchPlay || 'similar') === 'similar') {
        // трек из поиска: только он, а дальше — похожее на него
        player.playList([list[Number(el.dataset.i)]], 0, `Поиск: ${state.search.q}`);
        player.forceContinue = true;
      } else player.playList(list, Number(el.dataset.i), label);
      break;
    }
    case 'play-merged': {
      const label = el.dataset.list === 'album' ? state.album.data && state.album.data.title : state.artist.data && state.artist.data.name;
      playMerged(lists[el.dataset.list], Number(el.dataset.i), label);
      break;
    }
    case 'row-more': {
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, lists[el.dataset.list][Number(el.dataset.i)], el.dataset.list === 'queue' ? Number(el.dataset.i) : -1);
      break;
    }
    case 'cur-more':
      if (player.current) openMenu(e.clientX, e.clientY, player.current);
      break;
    case 'fullscreen':
      fullscreen.show();
      break;
    case 'outage-hide':
      svcStatus.outages.forEach((id) => hiddenOutages.add(id));
      el.closest('.outage')?.remove();
      break;
    case 'like-cur':
      await player.toggleLike();
      break;
    case 'q-play':
      player.playAt(Number(el.dataset.i));
      break;
    case 'open-pl':
      openPlaylist(el.dataset.id);
      break;
    case 'search-next':
    case 'search-last': {
      const list = (lists.search || []).filter((t) => t.available !== false);
      if (!list.length) break;
      if (!player.current) {
        player.playList(list, 0, `Поиск: ${state.search.q}`);
      } else if (a === 'search-next') {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].id !== player.current.id) player.enqueueNext(list[i]);
      } else {
        for (const t of list) if (t.id !== player.current.id) player.enqueueLast(t);
      }
      toast(a === 'search-next' ? `${list.length} ${pl(list.length, 'трек', 'трека', 'треков')} — играют следующими` : `${list.length} ${pl(list.length, 'трек', 'трека', 'треков')} — в конце очереди`);
      break;
    }
    case 'artist-all': {
      const ad = state.artist.data;
      if (!ad) break;
      state.trackList = { title: ad.name, sub: 'Все треки', tracks: null, error: null };
      go('tracks', { artist: state.artist.ref });
      try {
        state.trackList.tracks = await api.catalog.artistTracks(ad.refs);
      } catch (err) {
        state.trackList.error = err.message;
      }
      if (state.route === 'tracks') renderTrackList();
      break;
    }
    case 'tl-play':
    case 'tl-shuffle': {
      const tl = state.trackList.tracks || [];
      if (!tl.length) break;
      const was = player.shuffle;
      player.shuffle = a === 'tl-shuffle';
      player.playList(tl, a === 'tl-shuffle' ? Math.floor(Math.random() * tl.length) : 0, `${state.trackList.title}: все треки`);
      player.shuffle = was;
      break;
    }
    case 'open-artist':
      e.stopPropagation();
      go('artist', { ref: el.dataset.ref });
      break;
    case 'open-album':
      e.stopPropagation();
      go('album', { ref: el.dataset.ref });
      break;
    case 'artist-like': {
      const a2 = state.artist.data;
      if (!a2) break;
      const on = !favOf(a2);
      const cover = a2.cover || null;
      state.favArtists = await api.artists.like({ ref: state.artist.ref, refs: a2.refs || {}, name: a2.name, cover }, on);
      toast(on ? `${a2.name} — в любимых: будет чаще в «Моей волне»` : 'Убрано из любимых исполнителей');
      renderArtist();
      break;
    }
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
    case 'lastfm-connect':
      lastfmState.waiting = true;
      renderLastfm();
      try {
        const r = await api.lastfm.connect();
        toast(`Last.fm подключён: ${r.name}`);
      } catch (err) {
        if (lastfmState.waiting) toast(err.message, true);
      }
      lastfmState.waiting = false;
      refreshLastfm();
      break;
    case 'lastfm-cancel':
      lastfmState.waiting = false;
      await api.lastfm.cancel().catch(() => {});
      renderLastfm();
      break;
    case 'lastfm-disconnect':
      await api.lastfm.disconnect();
      toast('Last.fm отключён');
      refreshLastfm();
      break;
    case 'toggle-globalkeys':
      state.settings = await api.settings.set({ globalKeys: state.settings.globalKeys === false });
      renderSettings();
      break;
    case 'toggle-fshide':
      state.settings = await api.settings.set({ fsAutoHide: !state.settings.fsAutoHide });
      renderSettings();
      break;
    case 'toggle-tray':
      state.settings = await api.settings.set({ closeToTray: !state.settings.closeToTray });
      renderSettings();
      break;
    case 'toggle-continue':
      state.settings = await api.settings.set({ continueSimilar: state.settings.continueSimilar === false });
      player.continueSimilar = state.settings.continueSimilar !== false;
      renderSettings();
      break;
    case 'search-play':
      state.settings = await api.settings.set({ searchPlay: el.dataset.v });
      renderSettings();
      break;
    case 'toggle-normalize':
      state.settings = await api.settings.set({ normalize: !state.settings.normalize });
      applyTrackSound();
      renderSettings();
      break;
    case 'eq-toggle': {
      const e = normalizeEq(state.settings.eq);
      saveEq({ ...e, on: !e.on });
      break;
    }
    case 'eq-preset': {
      const p = EQ_PRESETS.find((x) => x[0] === el.dataset.v);
      if (p) saveEq({ ...normalizeEq(state.settings.eq), on: true, preset: p[0], gains: p[2].slice() });
      break;
    }
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
    case 'legacy-pair': {
      const code = await askText('Код с экрана Nyao Legacy', '', 'Подключить');
      if (!code) break;
      try {
        const name = await api.cloud.legacyPair(code);
        toast(`Подключено: ${name || 'устройство'}`);
        loadCloudDevices();
      } catch (e) {
        toast(e.message || 'Не получилось подключить');
      }
      break;
    }
    case 'cloud-device-remove':
      await api.cloud.removeDevice(el.dataset.id);
      toast('Устройство отключено');
      loadCloudDevices();
      break;
    case 'resume-device': {
      const d = state.cloud.others.find((x) => x.deviceId === el.dataset.id);
      if (d && d.track) {
        playHandoff(d, `С устройства «${d.device}»`);
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
    case 'toggle-nav': {
      const k = el.dataset.k;
      state.settings = await api.settings.set({ [k]: !state.settings[k] });
      renderRail();
      RENDER[state.route]();
      break;
    }
    case 'dev-prank':
      pranks.toggle(el.dataset.v);
      break;
    case 'dev-prank-reset':
      pranks.resetAll();
      break;
    case 'dev-open':
      try {
        await api.dev.open(el.dataset.v);
      } catch (err) {
        toast(err.message, true);
      }
      break;
    case 'dev-hot-clear':
      await api.dev.hotClearBad();
      await loadDevInfo();
      break;
    case 'dev-probe': {
      const t = player.current;
      if (!t || devState.probe === 'busy') break;
      devState.probe = 'busy';
      renderSettings();
      devState.probe = await api.dev.lyricsProbe(t).catch((err) => {
        toast(err.message, true);
        return null;
      });
      renderSettings();
      break;
    }
    case 'dev-lyrics-reload':
      state.lyrics = { id: null };
      if (fullscreen.open) fullscreen.reloadLyrics();
      toast('Текст текущего трека будет найден заново');
      break;
    case 'dev-break-stream':
      // поток «обрывается» — плеер должен сам восстановиться (переподключиться или взять копию)
      player.audio.src = 'https://127.0.0.1:9/nyao-broken-stream';
      toast('Поток сломан — смотрим, как плеер восстановится');
      break;
    case 'dev-seek-end': {
      const d = player.audio.duration;
      if (Number.isFinite(d) && d > 8) player.seek(d - 6);
      break;
    }
    case 'dev-queue-1000': {
      const q = (player.queue || []).filter(Boolean);
      if (!q.length) break;
      const big = Array.from({ length: 1000 }, (_, i) => q[i % q.length]);
      player.playList(big, Math.max(0, player.index), 'Тест: 1000 треков');
      toast('Очередь: 1000 треков');
      break;
    }
    case 'dev-ping':
      devState.ping = 'busy';
      renderSettings();
      devState.ping = await api.dev.ping().catch(() => null);
      renderSettings();
      break;
    case 'dev-offline':
      devState.offline = await api.dev.offline(!devState.offline);
      toast(devState.offline ? 'Сеть выключена (только Chromium)' : 'Сеть снова есть');
      renderSettings();
      break;
    case 'dev-mt':
      applyStatus({ maintenance: { active: true, title: 'Скоро вернёмся', text: 'Это предпросмотр экрана техработ из раздела «Разработчик».', until: 'Примерно через 15 минут' }, outages: [] });
      break;
    case 'dev-outage':
      applyStatus({ maintenance: { active: false }, outages: ['ya', 'yt'] });
      toast('Предпросмотр: сбой Яндекса и YouTube Music');
      break;
    case 'dev-status-real':
      applyStatus(await api.status.get(true).catch(() => null));
      break;
    case 'dev-fps':
      toggleFps(!devState.fps);
      renderSettings();
      break;
    case 'dev-crash':
      await api.dev.crash(el.dataset.v);
      break;
    case 'dev-diag':
      copyText(await api.dev.diag());
      break;
    case 'lyr-move': {
      const order = lyricsOrder();
      const i = order.findIndex((p) => p.id === el.dataset.id);
      const j = i + Number(el.dataset.d);
      if (i < 0 || j < 0 || j >= order.length) break;
      [order[i], order[j]] = [order[j], order[i]];
      await saveLyricsPrefs({ lyricsOrder: order });
      break;
    }
    case 'lyr-toggle': {
      const order = lyricsOrder().map((p) => (p.id === el.dataset.id ? { ...p, on: !p.on } : p));
      if (!order.some((p) => p.on)) {
        toast('Хотя бы один источник текста должен остаться', true);
        break;
      }
      await saveLyricsPrefs({ lyricsOrder: order });
      break;
    }
    case 'lyr-words':
      await saveLyricsPrefs({ lyricsWordsFirst: state.settings.lyricsWordsFirst === false });
      break;
    case 'lyr-reset':
      await saveLyricsPrefs({ lyricsOrder: null, lyricsWordsFirst: true });
      break;
    case 'update-channel': {
      state.settings = await api.settings.set({ updateChannel: el.dataset.v });
      state.update.info = null;
      state.update.hotReady = false;
      await checkUpdates();
      break;
    }
    case 'update-hot': {
      const pkg = state.update.info && state.update.info.hot;
      if (!pkg || state.update.hotBusy) break;
      state.update.hotBusy = true;
      state.update.error = null;
      renderSettings();
      try {
        await api.updates.hot(pkg);
        state.update.hotReady = true;
      } catch (err) {
        state.update.error = err.message;
      }
      state.update.hotBusy = false;
      if (isSettingsRoute()) renderSettings();
      break;
    }
    case 'update-relaunch':
    case 'update-reset-hot': {
      // приложение перезапустится: запоминаем трек, место и то, что музыка играла
      saveSession(true);
      try {
        if (player.playing) localStorage.setItem('nyao.resume', '1');
      } catch {
        // не запомнилось — просто не продолжим сами
      }
      if (a === 'update-relaunch') await api.updates.relaunch();
      else await api.updates.resetHot();
      break;
    }
    case 'update-install': {
      const asset = state.update.info && state.update.info.asset;
      if (!asset) break;
      state.update.progress = 0;
      renderSettings();
      try {
        await api.updates.download(asset);
        toast(ON_MAC ? 'Установщик открыт: перетащи Nyao Music в «Программы»' : 'Установщик запущен — после установки приложение перезапустится');
      } catch (err) {
        state.update.error = err.message;
      }
      state.update.progress = null;
      if (isSettingsRoute()) renderSettings();
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
      if (a === 'pl-shuffle') player.shuffle = true;
      const start = player.shuffle ? Math.floor(Math.random() * state.lib.tracks.length) : 0;
      player.playList(state.lib.tracks, start, libLabel());
      renderBar();
      break;
    }
    case 'split-liked': {
      const on = el.dataset.v === '1';
      state.settings = await api.settings.set({ splitLiked: on });
      if (!on && state.lib.selected.startsWith('liked:')) state.lib.selected = 'liked';
      RENDER[state.route]();
      break;
    }
    case 'set-layout':
      await setLayout(el.dataset.v);
      break;
    case 'set-theme': {
      if ((el.dataset.v === 'glass') === IS_MAC || !api.theme) break;
      // окно перезагрузится: запоминаем трек, место и то, что музыка играла
      saveSession(true);
      try {
        if (player.playing) localStorage.setItem('nyao.resume', '1');
      } catch {
        // не запомнилось — просто не продолжим сами
      }
      await api.theme.set(el.dataset.v);
      break;
    }
    case 'set-accent':
      state.settings = await api.settings.set({ accent: el.dataset.v });
      refreshAccent();
      $$('.accent-sw').forEach((b) => {
        const on = b.dataset.v === el.dataset.v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      break;
    case 'toggle-wavetab':
      state.settings = await api.settings.set({ waveTab: !state.settings.waveTab });
      renderRail();
      renderSettings();
      break;
    case 'mix-builder':
      openMixBuilder();
      break;
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
      if (el.dataset.v === 'lyrics') fullscreen.show();
      else openDrawer(el.dataset.v === 'queue' ? 'queue' : 'info');
      break;
    case 'drawer-close':
      closeDrawer();
      break;
    case 'drawer-queue':
      openDrawer('queue');
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
    case 'vk-log':
      api.vkLog && api.vkLog();
      break;
    case 'dev-librespot-flag':
    case 'native-save-id':
    case 'native-login':
    case 'native-use':
    case 'native-logout': {
      el.disabled = true;
      try {
        if (el.dataset.action === 'dev-librespot-flag') state.spotify = await api.dev.librespotFlag(!state.spotify?.native?.flag);
        else if (el.dataset.action === 'native-save-id') {
          const id = ($('[data-native-client]')?.value || '').trim();
          state.spotify = await api.dev.librespotClientId(id);
        } else if (el.dataset.action === 'native-login') {
          toast('Открыл вход Spotify (librespot) в браузере');
          state.spotify = await api.dev.librespotLogin();
          toast('Spotify (librespot) подключён');
        } else if (el.dataset.action === 'native-use') state.spotify = await api.dev.librespotUse(!state.spotify?.native?.active);
        else state.spotify = await api.dev.librespotLogout();
        syncSpMode();
        await afterAuthChange();
      } catch (error) { toast(error.message, true); await loadStatus(); renderSettings(); }
      break;
    }
    case 'native-copy-redirect':
      copyText(state.spotify?.native?.redirect || ''); toast('Скопировано'); break;
    case 'native-debug': {
      const log = await api.dev.librespotDebug().catch(e => e.message);
      const pre = $('#native-log'); if (pre) pre.textContent = log;
      break;
    }
    case 'sp-save-id': {
      const v = ($('[data-sp-client]') || {}).value || '';
      if (!/^[0-9a-fA-F]{32}$/.test(v.trim())) {
        toast('Client ID — 32 символа из Spotify Developer Dashboard', true);
        break;
      }
      state.spotify = await api.spotify.setClientId(v.trim());
      toast('Client ID сохранён — теперь «Войти»');
      renderSettings();
      break;
    }
    case 'sp-copy-redirect':
      copyText((state.spotify && state.spotify.redirect) || '');
      toast('Скопировано');
      break;
    case 'sp-login':
      el.disabled = true;
      toast('Открыл вход Spotify в браузере — подтверди доступ');
      try {
        state.spotify = await api.spotify.login();
      syncSpMode();
        toast('Spotify подключён');
        api.spotify.prewarm().catch(() => {});
      } catch (err) {
        toast(err.message, true);
      }
      await afterAuthChange();
      break;
    case 'sp-logout':
      state.spotify = await api.spotify.logout();
      syncSpMode();
      await afterAuthChange();
      break;
    case 'sp-debug': {
      const log = await api.spotify.debug().catch((e) => e.message);
      const pre = $('#sp-log');
      if (pre) pre.textContent = log;
      break;
    }
    case 'yt-log':
      api.ytLog && api.ytLog();
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

$('#drawer').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  try {
    await handleAction(el, e);
    // перешли к исполнителю или альбому — панель уступает место странице
    if (['open-artist', 'open-album'].includes(el.dataset.action)) closeDrawer();
  } catch (err) {
    toast(err.message, true);
  }
});

view.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'room-join') {
    joinRoom(new FormData(form).get('code').toString());
    return;
  }
  if (form.dataset.form.startsWith('fr-')) {
    try {
      await friends.submit(form);
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
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
    state.search.res = { ya: [], yt: [], sc: [], vk: [] };
  }
  state.search.loading = false;
  if (state.route === 'search') renderSearch();
});

view.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'fade') {
    const v = Number(e.target.value);
    state.settings = { ...state.settings, fade: v };
    const l = $('#fade-label', view);
    if (l) l.textContent = v ? `Трек затихает за ${v} с до конца, следующий плавно нарастает` : 'Выключены — треки сменяются сразу';
    clearTimeout(eqSaveTimer);
    eqSaveTimer = setTimeout(() => api.settings.set({ fade: v }).catch(() => {}), 300);
    if (!v) eq.unfade();
    return;
  }
  if (e.target.dataset.input === 'eq') {
    const i = Number(e.target.dataset.i);
    const cur = normalizeEq(state.settings.eq);
    const gains = cur.gains.slice();
    gains[i] = Number(e.target.value);
    const db = $(`#eq-db-${i}`, view);
    if (db) db.textContent = `${gains[i] > 0 ? '+' : ''}${gains[i]}`;
    const wasCustom = cur.preset === 'custom';
    saveEq({ ...cur, preset: 'custom', gains }, !wasCustom);
    return;
  }
  if (e.target.dataset.input === 'fresh') {
    setRangeFill(e.target);
    const l = $('#fresh-label');
    if (l) l.textContent = freshLabel(e.target.value);
    return;
  }
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
  if (e.target.dataset.input === 'fresh') setWave({ waveFresh: Number(e.target.value) });
  if (e.target.dataset.input === 'share') setWave({ ytmShare: Number(e.target.value) });
});

async function afterAuthChange() {
  await loadStatus();
  state.home = null;
  state.lib = { lists: null, filter: 'all', selected: 'liked', tracks: null, counts: null };
  likedPromise = null;
  artistCache.clear();
  if (isSettingsRoute()) renderSettings();
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
  $('#pb-sub').innerHTML = t ? `${trackBadge(t)}${artistLink(t)}${player.label ? ' · ' + esc(player.label) : ''}` : 'Запусти «Мою волну»';
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
  // повтор: выкл → плейлист → трек (в волне — выкл ↔ трек); бейдж «1» — повтор одного трека
  const REP = { off: 'Повтор выключен', all: 'Повтор плейлиста', one: 'Повтор трека' };
  $('#pb-repeat').innerHTML = ICONS.repeat + (player.repeat === 'one' ? '<span class="rep1">1</span>' : '');
  $('#pb-repeat').setAttribute('aria-label', REP[player.repeat]);
  $('#pb-repeat').title = REP[player.repeat];
  $('#pb-repeat').classList.toggle('on', player.repeat !== 'off');
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
  player.setShuffle(!player.shuffle);
  toast(player.shuffle ? 'Очередь перемешана' : 'Очередь снова по порядку');
  renderBar();
};
$('#pb-repeat').onclick = () => {
  const r = player.cycleRepeat();
  toast({ off: 'Повтор выключен', all: 'Повтор плейлиста', one: 'Повтор трека' }[r]);
  renderBar();
};
$('#pb-like').onclick = () => player.toggleLike();
$('#pb-coverbtn').onclick = () => fullscreen.show();
$('#pb-title').onclick = () => {
  const t = player.current;
  if (t && t.albumRef) go('album', { ref: t.albumRef });
  else fullscreen.show();
};
$('#pb-sub').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="open-artist"]');
  if (el) go('artist', { ref: el.dataset.ref });
});
$('#pb-panel').onclick = () => toggleDrawer('info');
$('#pb-queue').onclick = () => toggleDrawer('queue');
$('#pb-radio').onclick = () => startTrackRadio();
$('#pb-add').onclick = async (e) => {
  const t = player.current;
  if (!t) return toast('Сейчас ничего не играет');
  const r = e.currentTarget.getBoundingClientRect();
  if (!state.lib.lists) await loadLibrary().catch(() => {});
  openMenu(r.left, r.top - 8, t, -1, { addOnly: true });
};
$('#pb-more').onclick = (e) => openBarMore(e.currentTarget.getBoundingClientRect());
async function startTrackRadio() {
  const t = player.current;
  if (!t) return toast('Сейчас ничего не играет');
  try {
    await player.startRadio(t);
    toast(`Волна по треку «${t.title}»`);
  } catch (err) {
    toast(err.message, true);
  }
}
// Узкое окно: то, что не влезло в плеер, — в меню «⋯»
function openBarMore(r) {
  const menu = $('#menu');
  const rep = player.repeat || 'off';
  menu.innerHTML = `
    <button data-m="radio">Волна по треку</button>
    <button data-m="full">Полный экран</button>
    <button data-m="shuffle">${player.shuffle ? 'Не перемешивать' : 'Перемешать'}</button>
    <button data-m="repeat">Повтор: ${{ off: 'выключен', all: 'плейлист', one: 'трек' }[rep] || 'выключен'}</button>
    <button data-m="queue">Очередь</button>
    <button data-m="connect">Устройства и «Слушать вместе»</button>`;
  menu.hidden = false;
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8))}px`;
  menu.style.top = `${Math.max(8, r.top - m.height - 8)}px`;
  menu.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    menu.hidden = true;
    const k = b.dataset.m;
    if (k === 'radio') startTrackRadio();
    else if (k === 'full') fullscreen.show();
    else if (k === 'shuffle') $('#pb-shuffle').click();
    else if (k === 'repeat') $('#pb-repeat').click();
    else if (k === 'queue') toggleDrawer('queue');
    else if (k === 'connect') $('#pb-connect').click();
  };
}
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
  if (state.settings && state.settings.accent === 'cover') refreshAccent();
  if (state.drawer) {
    renderDrawer(state.drawer === 'queue');
    if (state.drawer === 'info') loadNpArtist();
  }
  if (state.route === 'home' || state.route === 'wave' || state.route === 'album' || state.route === 'artist') RENDER[state.route]();
  else $$('.trow.cur').forEach((r) => r.classList.remove('cur'));
});
player.addEventListener('queue', () => {
  if (state.drawer === 'queue') {
    const sc = $('#drawer .dr-scroll');
    const top = sc ? sc.scrollTop : 0;
    renderDrawer();
    const sc2 = $('#drawer .dr-scroll');
    if (sc2) sc2.scrollTop = top;
  } else if (state.drawer === 'info') renderDrawer();
  if (fullscreen.open) fullscreen.renderQueue(false, true);
});
player.addEventListener('state', () => {
  renderBar();
  const wp = $('.wave-play', view);
  if (wp && player.mode === 'wave') wp.innerHTML = player.playing ? ICONS.pauseBig : ICONS.playBig;
});
player.addEventListener('time', () => {
  updateTime();
});
const fullscreen = new FullScreen({
  player,
  api,
  isMac: IS_MAC,
  // «Караоке на всё» из приколов разработчика: слова поровну по строке
  ensureLyrics: (opts) => ensureLyrics(opts).then((d) => (pranks.has('karaoke') ? fakeWords(d) : d)),
  source: () => $('#pb-cover'), // обложка в плашке плеера: из неё разворачивается полный экран и в неё сворачивается
  autoHide: () => !!(state.settings && state.settings.fsAutoHide),
  like: () => player.toggleLike(),
  toast: (m, err) => toast(m, err),
  trackLink: (t) => trackLink(t),
  icons: {
    play: ICONS.playBig, pause: ICONS.pauseBig, heart: ICONS.heart, heartOn: ICONS.heartOn,
    prev: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>'
  }
});
// «Приколы» раздела «Разработчик»: только в памяти окна, перезапуск возвращает всё как было
const pranks = createPranks({
  player,
  onChange: () => {
    if (isSettingsRoute() && state.params && state.params.section === 'dev') renderSettings();
  },
  onLyrics: (id) => {
    if (id === 'karaoke' && fullscreen.open) fullscreen.reloadLyrics();
  }
});
player.addEventListener('like', renderBar);
player.addEventListener('track', () => fullscreen.update());
player.addEventListener('track', applyTrackSound);
player.addEventListener('time', checkFadeOut);
player.addEventListener('state', () => fullscreen.update());
player.addEventListener('like', () => fullscreen.update());
player.addEventListener('time', () => fullscreen.tick());
// команды из трея и глобальных сочетаний
api.onControl((cmd) => {
  if (cmd === 'toggle') player.toggle();
  else if (cmd === 'next') player.next(true);
  else if (cmd === 'prev') player.prev();
  else if (cmd === 'like' && player.current) player.toggleLike().then(() => toast(player.liked.has(player.current.id) ? 'Добавлено в «Мне нравится»' : 'Убрано из «Мне нравится»')).catch(() => {});
});
if (api.onLive) {
  api.onLive((e) => {
    if (e.type === 'cmd') return remoteCommand(e);
    if (e.type === 'social') return friends.onEvent(e);
    if (e.type === 'now') {
      const list = state.connect.devices;
      if (list) {
        const i = list.findIndex((d) => d.deviceId === e.deviceId);
        const d = { ...(i > -1 ? list[i] : { deviceId: e.deviceId }), ...e, online: true };
        if (i > -1) list[i] = d;
        else list.push(d);
        renderConnect();
      }
      return;
    }
    onRoomEvent(e);
  });
}
if (api.onSocialOpen) api.onSocialOpen((p) => friends.onOpen(p));
$('#pb-connect').onclick = toggleConnect;
$('#connect').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  try {
    await handleAction(el, e);
  } catch (err) {
    toast(err.message, true);
  }
});
let cxVolTimer;
$('#connect').addEventListener('input', (e) => {
  const id = e.target.dataset.cxVol;
  if (!id) return;
  setRangeFill(e.target);
  clearTimeout(cxVolTimer);
  cxVolTimer = setTimeout(() => api.connect.cmd(id, 'volume', { volume: e.target.value / 100 }).catch((err) => toast(err.message, true)), 250);
});
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#connect') && !e.target.closest('#pb-connect')) $('#connect').hidden = true;
});
setInterval(() => {
  if (state.room && state.room.isHost && player.playing && Date.now() - roomLastBeat > 15_000) roomPush(true);
}, 5000);
player.audio.addEventListener('seeked', () => roomPush());
api.win.onFullscreen((on) => {
  if (!on) fullscreen.close();
});
$('#pb-full').onclick = () => fullscreen.toggle();
// ---------- Запоминание сессии: трек, место и очередь переживают закрытие приложения ----------
const SESSION_KEY = 'nyao.session';
let sessionSavedAt = 0;
function saveSession(force = false) {
  if (!force && Date.now() - sessionSavedAt < 5000) return;
  sessionSavedAt = Date.now();
  try {
    const s = player.snapshot();
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // хранилище недоступно — просто не запоминаем
  }
}
player.addEventListener('track', () => saveSession(true));
player.addEventListener('queue', () => saveSession(true));
player.addEventListener('state', () => saveSession(!player.playing));
player.addEventListener('time', () => saveSession());
window.addEventListener('beforeunload', () => saveSession(true));
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
  if (e.target.closest && e.target.closest('input, textarea')) return;
  // полноэкранный режим: F11 — вкл/выкл, Esc — выход
  if (e.code === 'F11' || (e.code === 'KeyF' && (e.metaKey || e.ctrlKey) && e.shiftKey)) {
    e.preventDefault();
    fullscreen.toggle();
    return;
  }
  if (e.code === 'Escape') {
    if (!$('#menu').hidden) {
      $('#menu').hidden = true;
      return;
    }
    if (fullscreen.escape()) return;
    if (!$('#connect').hidden) {
      $('#connect').hidden = true;
      return;
    }
    if (closeWaveTune()) return;
    if (closeDrawer()) return;
  }
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

// ---------- Вид приложения: выбор и окно после обновления ----------
async function setLayout(v) {
  state.settings = await api.settings.set({ layout: v === 'wave' ? 'wave' : 'player' });
  renderRail();
  RENDER[state.route]();
}
/** Обновился с 0.4, где вид ещё не выбирали — один раз спрашиваем */
function askLayout() {
  const el = document.createElement('div');
  el.className = 'modal-wrap';
  el.innerHTML = `<section class="modal" role="dialog" aria-label="Новый вид Nyao Music">
    <h2>Новый вид Nyao Music</h2>
    <p class="hint">Теперь можно выбрать, что главное: обычный плеер с твоей музыкой на первом плане или, как раньше, «Моя волна». Поменять можно в «Настройках».</p>
    ${layoutChoiceHtml('player', 'data-lay')}
    <div class="modal-foot"><button class="btn primary" data-lay-ok>Готово</button></div>
  </section>`;
  document.body.appendChild(el);
  let choice = 'player';
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lay]');
    if (b) {
      choice = b.dataset.v;
      el.querySelectorAll('.layout-card').forEach((c) => {
        c.classList.toggle('on', c.dataset.v === choice);
        c.setAttribute('aria-checked', String(c.dataset.v === choice));
      });
    }
    if (e.target.closest('[data-lay-ok]')) {
      el.remove();
      await setLayout(choice);
      if (choice === 'wave' && IS_MAC) go('wave');
    }
  });
}

// ---------- Обязательное обновление ----------
function showOutdated(minBuild) {
  if ($('.outdated-wrap')) return;
  state.outdated = minBuild || 1;
  const el = document.createElement('div');
  el.className = 'modal-wrap outdated-wrap';
  el.innerHTML = `<section class="modal" role="alertdialog" aria-label="Нужно обновить Nyao Music">
    <h2>Нужно обновиться</h2>
    <p class="hint">Эта версия Nyao Music (${esc(state.version || '')}) больше не поддерживается. Скачай свежую — займёт минуту, входы в сервисы сохранятся.</p>
    <div class="update-bar" hidden><span style="width:0%"></span></div>
    <div class="modal-foot"><button class="btn" data-out-page>Страница релиза</button><button class="btn primary" data-out-install>Скачать и установить</button></div>
  </section>`;
  document.body.appendChild(el);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-out-page]')) {
      const i = state.update.info;
      api.openExternal((i && i.url) || 'https://github.com/PersikPrime/nyao-music/releases/latest');
    }
    const btn = e.target.closest('[data-out-install]');
    if (btn) {
      btn.disabled = true;
      try {
        if (!state.update.info || !state.update.info.asset) state.update.info = await api.updates.check();
        if (!state.update.info.asset) throw new Error('В релизе нет файла для этой системы — открой страницу релиза');
        el.querySelector('.update-bar').hidden = false;
        await api.updates.download(state.update.info.asset);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    }
  });
}

// ---------- Новый микс: из самого прослушиваемого, по исполнителям или пустой ----------
const MB = { mode: 'top', period: 30, src: { ya: true, yt: true, sc: true, vk: true }, count: 20, noSkip: true, data: null, artists: null, off: new Set(), name: '' };
function mbTracks() {
  if (MB.mode === 'empty' || !MB.data) return [];
  let rows = MB.data.filter((x) => MB.src[x.track.source] !== false);
  if (MB.mode === 'artists') {
    // лучшие исполнители по числу прослушиваний → их треки по очереди
    const byArtist = new Map();
    for (const x of rows) {
      const a = (x.track.artist || '').split(/,|×| feat\.? | & /i)[0].trim() || '—';
      if (!byArtist.has(a)) byArtist.set(a, { plays: 0, list: [] });
      const g = byArtist.get(a);
      g.plays += x.plays;
      g.list.push(x);
    }
    const groups = [...byArtist.values()].sort((a, b) => b.plays - a.plays).slice(0, 8);
    rows = [];
    for (let i = 0; rows.length < MB.count && groups.some((g) => g.list[i]); i++) for (const g of groups) if (g.list[i]) rows.push(g.list[i]);
  }
  return rows.slice(0, MB.count);
}
function mbDefaultName() {
  if (MB.mode === 'empty') return 'Новый микс';
  if (MB.mode === 'artists') return 'Любимые исполнители';
  return { 7: 'Топ недели', 30: 'Топ месяца', 365: 'Топ года' }[MB.period];
}
function renderMixBuilder(el) {
  const list = mbTracks();
  const pill = (on, attrs, label, dot) => `<button class="chip solid ${on ? 'on' : ''}" aria-pressed="${on}" ${attrs}>${dot ? `<span class="d" style="background:${dot}"></span>` : ''}${label}</button>`;
  const modes = [['top', 'Из самого прослушиваемого', 'Nyao соберёт то, что ты слушаешь чаще всего'], ['artists', 'По любимым исполнителям', 'Треки тех, кого ты слушаешь больше всех'], ['empty', 'Пустой микс', 'Добавишь треки сам через «⋯» → «В микс»']];
  const name = MB.name || mbDefaultName();
  el.innerHTML = `<section class="modal mix-builder" role="dialog" aria-label="Новый микс">
    <div class="mb-left">
      <div class="mb-head"><h2>Новый микс</h2><button class="icbtn sm" data-mb="close" aria-label="Закрыть">✕</button></div>
      <label class="mb-field"><span class="eyebrow">Название</span><input data-mb-name value="${esc(name)}"></label>
      <div class="mb-field"><span class="eyebrow">Как собрать</span>
        ${modes.map(([v, t, sub]) => `<button class="mb-mode ${MB.mode === v ? 'on' : ''}" role="radio" aria-checked="${MB.mode === v}" data-mb="mode" data-v="${v}"><span class="lc-radio"><span></span></span><span><b>${t}</b><span>${sub}</span></span></button>`).join('')}
      </div>
      ${MB.mode === 'empty' ? '' : `
      <div class="mb-field"><span class="eyebrow">За какое время</span><div class="chips">${[[7, 'Неделя'], [30, 'Месяц'], [365, 'Год']].map(([v, l]) => pill(MB.period === v, `data-mb="period" data-v="${v}"`, l)).join('')}</div></div>
      <div class="mb-field"><span class="eyebrow">Откуда</span><div class="chips">${SERVICES.map((x) => pill(MB.src[x.id] !== false, `data-mb="src" data-v="${x.id}"`, x.id === 'ya' ? 'Яндекс' : x.name, x.bg)).join('')}</div></div>
      <div class="mb-field"><span class="eyebrow">Сколько треков</span><div class="chips">${[20, 30, 50].map((v) => pill(MB.count === v, `data-mb="count" data-v="${v}"`, String(v))).join('')}</div></div>`}
    </div>
    <div class="mb-right">
      <div class="mb-head"><b>${MB.mode === 'empty' ? 'Пустой микс' : 'Что попадёт в микс'}</b><span class="muted">${MB.mode === 'empty' ? '' : MB.data ? `${list.filter((t) => !MB.off.has(t.track.id)).length} треков · можно снять галочки` : 'Считаю историю…'}</span></div>
      <div class="mb-list">${MB.mode === 'empty' ? '<div class="empty">Микс создастся пустым — добавляй треки из любого списка через «⋯».</div>' : !MB.data ? '<div class="skeleton" style="height:240px"></div>' : list.length ? list.map((x) => `<label class="mb-row"><input type="checkbox" data-mb-off="${esc(x.track.id)}" ${MB.off.has(x.track.id) ? '' : 'checked'}>${coverHtml(x.track, 'xs')}<span class="meta"><b>${esc(x.track.title)}</b><span>${esc(x.track.artist)}</span></span>${badge(x.track.source)}<span class="muted">${x.plays} ×</span></label>`).join('') : '<div class="empty">Пока мало истории. Послушай что-нибудь — Nyao запоминает треки на всех устройствах с аккаунтом Nyao.</div>'}</div>
      <div class="modal-foot"><button class="btn" data-mb="close">Отмена</button><button class="btn primary" data-mb="create" ${MB.mode !== 'empty' && !list.length ? 'disabled' : ''}>${MB.mode === 'empty' ? 'Создать' : `Собрать ${list.filter((t) => !MB.off.has(t.track.id)).length} треков`}</button></div>
    </div>
  </section>`;
}
async function mbLoad(el) {
  MB.data = null;
  renderMixBuilder(el);
  try {
    MB.data = await api.cloud.top({ days: MB.period });
  } catch {
    MB.data = [];
  }
  if (el.isConnected) renderMixBuilder(el);
}
function openMixBuilder() {
  const el = document.createElement('div');
  el.className = 'modal-wrap';
  document.body.appendChild(el);
  Object.assign(MB, { mode: 'top', off: new Set(), name: '' });
  mbLoad(el);
  el.addEventListener('input', (e) => {
    if ('mbName' in e.target.dataset) MB.name = e.target.value;
  });
  el.addEventListener('change', (e) => {
    const id = e.target.dataset.mbOff;
    if (id === undefined) return;
    if (e.target.checked) MB.off.delete(id);
    else MB.off.add(id);
    renderMixBuilder(el);
  });
  el.addEventListener('click', async (e) => {
    if (e.target === el) return el.remove();
    const b = e.target.closest('[data-mb]');
    if (!b) return;
    const v = b.dataset.v;
    switch (b.dataset.mb) {
      case 'close':
        return el.remove();
      case 'mode':
        MB.mode = v;
        MB.name = '';
        return renderMixBuilder(el);
      case 'period':
        MB.period = Number(v);
        MB.name = '';
        return mbLoad(el);
      case 'src':
        MB.src[v] = MB.src[v] === false;
        return renderMixBuilder(el);
      case 'count':
        MB.count = Number(v);
        return renderMixBuilder(el);
      case 'create': {
        b.disabled = true;
        try {
          const title = (MB.name || mbDefaultName()).trim() || 'Новый микс';
          const tracks = mbTracks().filter((x) => !MB.off.has(x.track.id)).map((x) => x.track);
          const mix = await api.mix.create(title);
          if (tracks.length) await api.mix.addMany(mix.id, tracks);
          el.remove();
          toast(`Создан микс «${title}»${tracks.length ? ` · ${tracks.length} треков` : ''}`);
          state.lib.selected = mix.id;
          state.lib.tracks = null;
          await loadLibrary(true);
          go('library');
        } catch (err) {
          toast(err.message, true);
          b.disabled = false;
        }
      }
    }
  });
}

// ---------- Старт ----------
(async function init() {
  state.settings = await api.settings.get();
  refreshAccent();
  if (IS_MAC) bgRibbon = new Ribbon($('#bg-ribbon'), { lines: 20, cy: 0.58, amp: 1, width: 1.7, accent: accentColor(), alpha: 0.9 });
  eq.apply(state.settings.eq);
  api.status.get().then(applyStatus).catch(() => {});
  api.status.onChange(applyStatus);
  player.setVolume(state.settings.volume);
  player.continueSimilar = state.settings.continueSimilar !== false;
  volEl.value = Math.round(state.settings.volume * 100);
  setRangeFill(volEl);
  renderBar();
  // Стартовый экран: в виде «Моя волна» на Mac — волна (как в макете Liquid Glass), иначе — главная
  const start = IS_MAC && layout() === 'wave' ? 'wave' : 'home';
  go(start, {}, false);
  await loadStatus();
  RENDER[state.route]();
  loadHome();
  if (state.status.ya || state.status.yt) {
    loadLiked();
    loadLibrary();
  }
  loadCloud();
  loadFavArtists();
  if (api.cloud) {
    api.cloud.onChanged(async (keys) => {
      if (keys.includes('artists')) loadFavArtists();
      // другое устройство поменяло миксы или настройки волны
      if (keys.includes('wave') || keys.includes('prefs')) state.settings = await api.settings.get();
      if (keys.includes('prefs')) {
        renderRail();
        refreshAccent();
      }
      if (keys.includes('mixes')) {
        loadHome();
        loadLibrary();
      }
      if (['settings', 'wave', 'home', 'library'].includes(state.route)) RENDER[state.route]();
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
    state.versionInfo = v;
    if (isSettingsRoute()) renderSettings();
  }).catch(() => {});
  if (api.onOutdated) api.onOutdated((min) => showOutdated(min));
  // трек Spotify заиграл копией из другого сервиса — показываем «SP → Я»
  if (api.spotify && api.spotify.onSubstitute) {
    api.spotify.onSubstitute(({ id, track } = {}) => {
      if (!id || !track) return;
      spMode.subs.set(id, track);
      // сервер отдал копию сам (например, Spotify не пускает из региона) — значит, Spotify сейчас не играет
      spMode.fallback = true;
      renderBar();
      if (state.drawer === 'queue') renderDrawer();
      if (state.route === 'wave') RENDER.wave();
    });
  }
  // ссылки, которыми открыли Nyao (и пришедшие, пока окно грузилось)
  if (api.deepLinks) {
    api.deepLinks.on((link) => openDeepLink(link));
    api.deepLinks.take().then((link) => link && openDeepLink(link)).catch(() => {});
  }
  // прошлый трек и очередь — на месте, на паузе
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved) player.restore(saved);
    // окно перезагрузили (смена оформления), а музыка играла — продолжаем
    if (localStorage.getItem('nyao.resume') === '1') {
      localStorage.removeItem('nyao.resume');
      if (saved && !player.playing) player.toggle();
    }
  } catch {
    // нет сохранённого — ничего страшного
  }
  // интерфейс поднялся — по этому знаку горячее обновление считается рабочим (main.js, watchHotStart)
  window.__nyaoReady = true;
  // обновился с версии, где вида ещё не было: один раз предлагаем выбрать
  if (state.settings.onboarded && !state.settings.layout) askLayout();
  if (!state.settings.onboarded) {
    // Кто уже входил в аккаунты в прошлых сборках — тому приветствие не показываем
    if (state.status.ya || state.status.yt) state.settings = await api.settings.set({ onboarded: true });
    else openOnboarding();
  }
})();

// Очередь: перетаскивание строк мышью
let dragFrom = -1;
document.addEventListener('dragstart', (e) => {
  const row = e.target.closest && e.target.closest('#qlist .trow');
  if (!row) return;
  dragFrom = Number(row.dataset.i);
  row.classList.add('dragging');
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => {
  const row = e.target.closest && e.target.closest('#qlist .trow');
  if (!row || dragFrom < 0) return;
  e.preventDefault();
  $$('#qlist .trow.drop').forEach((r) => r.classList.remove('drop'));
  row.classList.add('drop');
});
document.addEventListener('drop', (e) => {
  const row = e.target.closest && e.target.closest('#qlist .trow');
  if (!row || dragFrom < 0) return;
  e.preventDefault();
  player.move(dragFrom, Number(row.dataset.i));
  dragFrom = -1;
});
document.addEventListener('dragend', () => {
  dragFrom = -1;
  $$('#qlist .trow.dragging, #qlist .trow.drop').forEach((r) => r.classList.remove('dragging', 'drop'));
});

view.addEventListener('dblclick', (e) => {
  if (e.target.closest('[data-dbl="fullscreen"]')) fullscreen.show();
});
