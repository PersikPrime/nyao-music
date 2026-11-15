// «Новый интерфейс» (вариант Fable) — пробный вид главной, исполнителя, альбома, настроек и входа.
// Включается флагом в «Разработчик → Флаги» (settings.uiFable) и только меняет разметку и стили (ui2.css):
// данные, действия (data-action) и плеер — те же, что у обычного интерфейса. Выключил флаг — всё как было.

/** Нити «ленты» для экрана сервисов: у каждого сервиса свои линии */
function strand(group, groups, W, H) {
  let d = '';
  for (let k = group; k < groups * 5; k += groups) {
    const y0 = H * 0.46 + (k - (groups * 5) / 2) * 13;
    for (let x = -20; x <= W + 20; x += 20) {
      const u = (x / W) * Math.PI * 2;
      const y = y0 + 58 * Math.sin(u * 1.1 + k * 0.24 + 0.8) + 20 * Math.sin(u * 2.7 + k * 0.15);
      d += `${x === -20 ? 'M' : 'L'}${x} ${y.toFixed(1)}`;
    }
  }
  return d;
}
const SVC_COLOR = { ya: '#FFD60A', yt: '#FF453A', sc: '#FF5500', vk: '#0077FF', sp: '#1ED760' };
const SVC_HINT = { ya: 'Моя волна, лайки, плейлисты', yt: 'Лайки, миксы, главная YouTube', sc: 'Лайки, подписки, ремиксы', vk: 'Своя музыка и плейлисты · эксперимент', sp: 'Нужен Premium и свой Client ID' };
const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const DASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>';
const LOGO = '<svg width="74" height="48" viewBox="0 0 300 190" fill="none" stroke-width="26" stroke-linecap="round" role="img" aria-label="Nyao Music"><path d="M20 45c40-40 80-40 130 0s90 40 130 0" stroke="#FFD60A"/><path d="M20 95c40-40 80-40 130 0s90 40 130 0" stroke="#F0574A"/><path d="M20 145c40-40 80-40 130 0s90 40 130 0" stroke="#D8CEFF"/></svg>';
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function createUi2(c) {
  const { state, player, view, lists, esc, fmt, ICONS, SERVICES } = c;
  const on = () => !!(state.settings && state.settings.uiFable);
  const svcName = (id) => (id === 'ya' ? 'Яндекс' : (SERVICES.find((x) => x.id === id) || {}).name || id);

  // ---------- Главная ----------
  function home() {
    const loggedAny = SERVICES.some((x) => state.status[x.id]);
    const h = state.home;
    const ytSection = h && h.ytHome.find((s) => s.tracks.length);
    if (ytSection) lists['home-section'] = ytSection.tracks;
    const waveOn = player.mode === 'wave' && player.playing;
    const mood = state.settings.waveMood || null;
    const upcoming = player.mode === 'wave' ? player.queue.slice(player.index + 1, player.index + 4) : [];
    const pl = h ? [...h.mixes, ...h.yaPlaylists][0] : null;
    const tiles = h ? [...h.mixes, ...h.yaPlaylists, ...h.ytHome.flatMap((s) => s.playlists)].slice(pl ? 1 : 0, 13) : [];
    const recent = state.recent || [];
    lists['home-recent'] = recent;
    const name = c.homeName();
    view.innerHTML = `<div class="scroll u2-home">
      <div class="home-top">
        <h1 class="page">${c.greeting()}${name ? ', ' + esc(name) : ''}</h1>
        <form class="search-field" data-form="home-search">${ICONS.search}<input name="q" type="search" placeholder="Поиск в Яндексе, YouTube Music и SoundCloud" aria-label="Поиск"></form>
      </div>
      ${c.continueHtml()}
      ${!loggedAny ? '<div class="card"><div class="field"><label>Подключи сервисы</label><div class="hint">Подключи любой музыкальный сервис — здесь появятся волна, плейлисты и лайки.</div></div><div><button class="btn primary" data-action="go" data-route="settings">Открыть настройки</button></div></div>' : ''}
      <div class="u2-hero ${pl || ytSection ? '' : 'solo'}">
        <section class="u2-wave" aria-label="Моя волна">
          <canvas id="home-ribbon"></canvas>
          <span class="eyebrow">${SERVICES.filter((x) => state.status[x.id]).map((x) => (x.id === 'ya' ? 'Яндекс' : x.name)).join(' + ') || 'Нужен вход'}${state.settings.waveNyao !== false && loggedAny ? ' + своя волна Nyao' : ''}</span>
          <h2>Моя волна</h2>
          <div class="u2-moods" role="group" aria-label="Настроение волны">${c.MOODS.map(([v, l]) => `<button class="chip ${mood === v ? 'on' : ''}" aria-pressed="${mood === v}" data-action="wave-mood" data-v="${v}">${l}</button>`).join('')}</div>
          <div class="actions">
            <button class="btn primary big" data-action="wave-toggle" ${loggedAny ? '' : 'disabled'}>${waveOn ? ICONS.pause + 'Пауза' : ICONS.play + 'Слушать'}</button>
            <button class="btn big" data-action="go" data-route="wave">${ICONS.tune}Настроить</button>
            ${upcoming.length ? `<span class="u2-next"><span class="stack">${upcoming.map((t) => c.coverHtml(t, 'xs')).join('')}</span><span class="tx"><i>Дальше</i><b>${esc(upcoming[0].title)}</b>${upcoming[0].waveReason ? `<span>${esc(upcoming[0].waveReason)}</span>` : ''}</span></span>` : ''}
          </div>
        </section>
        ${pl || ytSection ? `<div class="u2-picks">
          ${pl ? `<button class="u2-pick" data-action="open-pl" data-id="${esc(pl.id)}">${c.coverHtml(pl)}<span class="tx"><span class="from">${c.badge(pl.source)}${esc(c.srcName(pl.source))}</span><b>${esc(pl.title)}</b><span class="s">${esc(pl.sub || (pl.count ? pl.count + ' треков' : ''))}</span></span></button>` : ''}
          ${ytSection ? `<button class="u2-pick" data-action="play-section"><span class="mosaic">${ytSection.tracks.slice(0, 4).map((t) => (t.cover ? `<img src="${esc(t.cover)}" alt="" loading="lazy">` : '<i></i>')).join('')}</span><span class="tx"><span class="from">${c.badge('yt')}С главной YouTube Music</span><b>${esc(ytSection.title)}</b><span class="s">${ytSection.tracks.length} треков · включить</span></span><span class="go">${ICONS.play}</span></button>` : ''}
        </div>` : ''}
      </div>
      ${loggedAny ? c.quickGridHtml() : ''}
      ${!recent.length && state.recentLoading ? c.shelfSkeleton() : ''}
      ${recent.length ? `<section><div class="sec-head"><h2 class="sec">Недавно слушал</h2><button class="link" data-action="go" data-route="history">Вся история</button></div>
        <div class="recent-row">${recent.slice(0, 12).map((t, i) => `<button class="rcard" data-action="play-row" data-list="home-recent" data-i="${i}">${c.coverHtml(t, '', true)}<b>${esc(t.title)}</b><span>${esc(t.artist)}</span></button>`).join('')}</div></section>` : ''}
      ${!h && loggedAny ? c.shelfSkeleton() : ''}
      ${c.releasesHtml()}
      ${tiles.length ? `<section><div class="sec-head"><h2 class="sec">Плейлисты и миксы</h2><button class="link" data-action="go" data-route="library">Вся медиатека</button></div>
        <div class="tiles">${tiles.map((p) => `<button class="tile" data-action="open-pl" data-id="${esc(p.id)}">${c.coverHtml(p, '', true)}<div class="t">${esc(p.title)}</div><div class="s">${esc(p.sub || (p.count ? p.count + ' треков' : ''))}</div></button>`).join('')}</div></section>` : ''}
    </div>`;
    new c.Ribbon(c.$('#home-ribbon'), { lines: 14, cy: 0.5, amp: 0.9, accent: c.accentColor() });
    c.injectOutage();
  }

  // ---------- Исполнитель ----------
  /** Его треки из твоих лайков: лайки уже загружены для медиатеки, здесь только отбор по имени */
  function loadLikedBy(st, a) {
    if (st.u2LikedFor === a.name) return;
    st.u2LikedFor = a.name;
    st.u2Liked = null;
    const want = norm(a.name);
    c.loadLiked().then((tracks) => {
      st.u2Liked = (tracks || []).filter((t) => norm(t.artist).split(/\s*(?:,|&| feat | ft )\s*/).some((x) => x === want) || norm(t.artist) === want);
      if (state.route === 'artist' && state.artist === st && st.data === a && on()) artist();
    }).catch(() => { st.u2Liked = []; });
  }
  function artist() {
    const st = state.artist;
    const a = st.data;
    const pref = c.sourcePref();
    const kinds = [['album', 'Альбомы'], ['single', 'Синглы и EP'], ['compilation', 'Сборники']].filter(([k]) => a.albums.some((x) => x.kind === k));
    const kind = kinds.some(([k]) => k === st.kind) ? st.kind : (kinds[0] || ['album'])[0];
    const albums = a.albums.filter((x) => x.kind === kind).sort((x, y) => String(y.year || '').localeCompare(String(x.year || '')));
    lists['artist-popular'] = a.popular;
    const latest = a.albums.filter((x) => x.year).sort((x, y) => String(y.year).localeCompare(String(x.year)))[0];
    loadLikedBy(st, a);
    const liked = st.u2Liked || [];
    const fav = !!c.favOf(a);
    const count = (k) => a.albums.filter((x) => x.kind === k).length;
    const stats = [
      a.listeners && a.listeners.ya ? [Number(a.listeners.ya).toLocaleString('ru-RU'), 'слушателей за месяц в Яндексе'] : null,
      liked.length ? [liked.length, 'в твоих лайках'] : null,
      count('album') ? [count('album'), 'альбомов'] : null,
      count('single') ? [count('single'), 'синглов и EP'] : null
    ].filter(Boolean);
    view.innerHTML = `<div class="page-view u2-artist">
      <section class="u2-ahero">
        <canvas id="artist-ribbon"></canvas>
        <button class="back" data-action="back">${ICONS.back}Назад</button>
        <div class="u2-portrait" aria-hidden="true">${a.cover ? `<img src="${esc(a.cover)}" alt="">` : `<span>${esc((a.name || '?').charAt(0).toUpperCase())}</span>`}</div>
        <div class="in">
          <div class="src-chips">${a.refs.ya ? `<span class="src-chip">${c.badge('ya')}есть в Яндексе</span>` : ''}${a.refs.yt ? `<span class="src-chip">${c.badge('yt')}есть в YouTube Music</span>` : ''}</div>
          <h1 class="artist-name">${esc(a.name)}</h1>
          ${stats.length ? `<div class="u2-stats">${stats.map(([v, l]) => `<span><b>${v}</b><i>${l}</i></span>`).join('')}</div>` : ''}
        </div>
      </section>
      <section class="act-row">
        <button class="bigplay" data-action="artist-play" aria-label="Слушать исполнителя">${ICONS.play}</button>
        <button class="icbtn" data-action="artist-shuffle" aria-label="Перемешать">${ICONS.shuffle}</button>
        <button class="btn fav-artist u2-fav ${fav ? 'on' : ''}" data-action="artist-like" aria-pressed="${fav}">${fav ? ICONS.heartOn : ICONS.heart}${fav ? 'Любимый исполнитель' : 'В любимые'}</button>
        ${fav ? '<span class="hint">чаще звучит в «Моей волне»</span>' : ''}
        <span class="grow"></span>
        <div class="pill-seg" role="radiogroup" aria-label="Источник">${[['auto', 'Вместе', ''], ['ya', 'Яндекс', 'ya'], ['yt', 'YouTube Music', 'yt']].map(([v, l, d]) => `<button role="radio" aria-checked="${pref === v}" class="${pref === v ? 'on' : ''}" data-action="set-pref" data-v="${v}">${d ? `<span class="dotsrc ${d}"></span>` : ''}${l}</button>`).join('')}</div>
      </section>
      <section class="u2-cols ${liked.length ? '' : 'two'}">
        <div class="col">
          <div class="u2-h"><h2>Популярное</h2><button class="link" data-action="artist-all">Все треки</button></div>
          ${a.popular.length ? `<div class="tracks">${a.popular.slice(0, 5).map((r, i) => c.mergedRowHtml(r, i, 'artist-popular')).join('')}</div>` : '<div class="hint">Популярных треков нет</div>'}
        </div>
        ${liked.length ? `<div class="col">
          <div class="u2-h"><h2>Из твоих лайков <i>${liked.length}</i></h2><button class="link" data-action="play-row" data-list="artist-liked" data-i="0">Слушать все</button></div>
          ${c.tracksHtml(liked.slice(0, 5), 'artist-liked', { num: false })}
        </div>` : ''}
        ${latest ? `<button class="u2-latest" data-action="open-album" data-ref="${esc(latest.ref)}">
          <span class="eyebrow">Последний релиз</span>
          <span class="row">${c.coverHtml(latest)}<span class="tx"><b>${esc(latest.title)}</b><span>${latest.kind === 'single' ? 'Сингл' : 'Альбом'}${latest.year ? ' · ' + esc(latest.year) : ''}</span></span></span>
          <span class="btn primary">${ICONS.play}Открыть</span>
        </button>` : ''}
      </section>
      ${a.albums.length ? `<section class="sect">
        <div class="sect-head"><h2>Дискография по годам</h2>${kinds.map(([k, l]) => `<button class="chip solid ${kind === k ? 'on' : ''}" data-action="artist-kind" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="album-grid u2-years">${albums.map((al) => `<button class="album-tile" data-action="open-album" data-ref="${esc(al.ref)}"><span class="yr">${esc(al.year || '—')}<i></i></span>${c.coverHtml(al, '', true)}<span class="t">${esc(al.title)}</span></button>`).join('')}</div>
      </section>` : ''}
      ${a.similar.length ? `<section class="sect">
        <div class="sect-head"><h2>Похожие исполнители</h2></div>
        <div class="artist-grid">${a.similar.map((s) => `<button class="artist-tile" data-action="open-artist" data-ref="${esc(s.ref)}"><div class="cover round" style="background:#14101e">${esc((s.name || '?').charAt(0).toUpperCase())}${s.cover ? `<img src="${esc(s.cover)}" alt="">` : ''}</div><span class="t">${esc(s.name)}</span></button>`).join('')}</div>
      </section>` : ''}
    </div>`;
    new c.Ribbon(c.$('#artist-ribbon'), { lines: 12, cy: 0.45, amp: 0.8, accent: c.accentColor() });
  }

  // ---------- Альбом ----------
  function album() {
    const al = state.album.data;
    const pref = c.sourcePref();
    lists['album'] = al.tracks;
    const total = al.tracks.reduce((s, r) => s + (r.duration || 0), 0);
    const prefName = pref === 'yt' ? 'YouTube Music' : 'Яндексе';
    view.innerHTML = `<div class="page-view u2-album">
      <aside class="u2-alside">
        <button class="back" data-action="back">${ICONS.back}Назад</button>
        ${c.coverHtml({ cover: al.cover, source: al.refs.ya ? 'ya' : 'yt' }, 'u2-bigcover')}
        <span class="eyebrow">${al.kind === 'single' ? 'Сингл' : 'Альбом'}${al.year ? ' · ' + esc(al.year) : ''}</span>
        <h1>${esc(al.title)}</h1>
        <div class="by">${al.artistRef ? `<button class="link-plain" data-action="open-artist" data-ref="${esc(al.artistRef)}">${esc(al.artist)}</button>` : `<span>${esc(al.artist)}</span>`}</div>
        <span class="meta">${al.tracks.length} треков · ${fmt(total)} ${al.refs.ya ? c.badge('ya') : ''}${al.refs.yt ? c.badge('yt') : ''}</span>
        <div class="acts">
          <button class="btn primary big u2-accent" data-action="album-play">${ICONS.play}Слушать</button>
          <button class="icbtn" data-action="album-shuffle" aria-label="Перемешать">${ICONS.shuffle}</button>
        </div>
        <div class="from"><span>Играть из</span>
          <div class="pill-seg" role="radiogroup" aria-label="Источник воспроизведения">${[['auto', 'Авто', ''], ['ya', 'Яндекс', 'ya'], ['yt', 'YouTube Music', 'yt']].map(([v, l, d]) => `<button role="radio" aria-checked="${pref === v}" class="${pref === v ? 'on' : ''}" data-action="set-pref" data-v="${v}">${d ? `<span class="dotsrc ${d}"></span>` : ''}${l}</button>`).join('')}</div>
        </div>
      </aside>
      <section class="album-table u2-altracks">
        <div class="hd"><span style="text-align:right">#</span><span>Название</span><span>Играет из</span><span style="text-align:right">Время</span></div>
        <div class="tracks" style="padding-top:8px">${al.tracks.map((r, i) => {
          const t = c.pick(r);
          const any = r.ya || r.yt;
          const cur = t && player.current && player.current.id === t.id;
          return `<div class="trow ${cur ? 'cur' : ''} ${t ? '' : 'unavail'}" data-action="play-merged" data-list="album" data-i="${i}">
            <span class="n" style="text-align:right">${cur ? '▶' : i + 1}</span>
            <span class="meta"><span class="t" style="display:block">${esc(r.title)}</span><span class="s" style="display:block">${any ? c.artistLink(any) : ''}</span></span>
            <span class="u2-src">${t ? `<span class="dotsrc ${t.source}"></span>${esc(svcName(t.source))}` : `нет в ${prefName}`}</span>
            <span class="dur" style="width:auto">${r.duration ? fmt(r.duration) : ''}</span>
          </div>`;
        }).join('')}</div>
        <p class="note">«Авто» берёт Яндекс, если трек там есть. Выбрал один сервис — треки, которых в нём нет, не играют.</p>
      </section>
    </div>`;
  }

  // ---------- Настройки: всё на одном экране ----------
  function settings() {
    const cl = state.cloud;
    const u = cl.user || {};
    const prof = state.social && state.social.profile;
    const s = state.settings;
    const connected = SERVICES.filter((x) => state.status[x.id]);
    const curAccent = s.accent || 'lavender';
    const tile = (sec, icon, title, sub, extra = '') => `<button class="u2-tile" data-action="set-sec" data-sec="${sec}"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${icon}"/></svg></span><b>${title}</b><span class="s">${sub}</span>${extra}</button>`;
    const upd = state.update.info && state.update.info.available;
    view.innerHTML = `<div class="scroll u2-settings">
      ${state.route === 'prefs' ? '<h1 class="page">Настройки</h1>' : c.profileTabs('settings')}
      <div class="u2-bento">
        <section class="u2-box span2 u2-prof">
          ${c.nyaoAvatar('u2-av')}
          <div class="tx"><b>${esc(cl.loggedIn ? u.name || 'Аккаунт Nyao' : 'Гость')}</b>
            <span class="hint">${cl.loggedIn ? (prof ? '@' + esc(prof.nick) + ' · ' : '') + 'аккаунт Nyao · синхронизация включена' : cl.logging ? 'Подтверди вход в Telegram' : 'История и настройки — только на этом компьютере'}</span>
            <div class="row">${cl.loggedIn
              ? '<button class="btn sm" data-action="go" data-route="profile">Профиль и приватность</button><button class="btn sm" data-action="open-connect">Устройства</button><button class="btn sm" data-action="go" data-route="stats">Статистика</button>'
              : cl.logging ? '<button class="btn sm" data-action="cloud-cancel">Отмена</button>' : `<button class="btn sm primary tg" data-action="cloud-login">${c.TG_ICON}Войти через Telegram</button><button class="btn sm" data-action="go" data-route="stats">Статистика</button>`}</div>
          </div>
        </section>
        <section class="u2-box span2">
          <div class="u2-h"><h2>Сервисы</h2><span class="hint">подключено ${connected.length} из ${SERVICES.length}</span></div>
          <div class="u2-svcs">${SERVICES.map((x) => { const acc = state.status[x.id]; return `<button class="${acc ? 'on' : ''}" data-action="set-sec" data-sec="svc:${x.id}">${c.svcDot(x, !!acc)}<span><b>${esc(x.id === 'ya' ? 'Яндекс' : x.name.replace(' Музыка', '').replace(' Music', ''))}</b><i>${acc ? 'подключено' : 'войти'}</i></span></button>`; }).join('')}</div>
        </section>
        ${tile('sound', c.RI.sound, 'Звук и воспроизведение', c.normalizeEq(s.eq).on ? 'Эквалайзер включён' : 'Эквалайзер, громкость, переходы')}
        ${tile('wave', 'M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0', 'Моя волна', `${s.waveMood ? (c.MOODS.find((m) => m[0] === s.waveMood) || [0, ''])[1] + ' · ' : ''}${s.waveNyao !== false ? 'своя волна Nyao включена' : 'только сервисы'}`)}
        <section class="u2-box span2">
          <div class="u2-h"><h2>Оформление</h2><button class="link" data-action="set-sec" data-sec="view">Открыть</button></div>
          <span class="hint">Акцентный цвет — меняется сразу во всём приложении</span>
          <div class="u2-swatches" role="radiogroup" aria-label="Акцентный цвет">${c.ACCENTS.map(([id, label]) => {
            const p = id === 'cover' ? null : c.paletteFor(id, { mac: c.IS_MAC });
            return `<button class="accent-sw u2-sw ${curAccent === id ? 'on' : ''}" role="radio" aria-checked="${curAccent === id}" aria-label="${esc(label)}" title="${esc(label)}" data-action="set-accent" data-v="${id}"><i style="${p ? `background:${p.a}` : ''}" class="${p ? '' : 'cover'}"></i></button>`;
          }).join('')}</div>
          <div class="row"><span class="hint" style="flex:1">Что главное при запуске</span>
            <div class="pill-seg" role="radiogroup" aria-label="Вид приложения">${[['wave', 'Моя волна'], ['player', 'Плеер']].map(([v, l]) => `<button role="radio" aria-checked="${c.layout() === v}" class="${c.layout() === v ? 'on' : ''}" data-action="set-layout" data-v="${v}">${l}</button>`).join('')}</div></div>
        </section>
        ${tile('lyrics', c.RI.lyrics, 'Текст песни', esc(c.lyricsName()))}
        ${tile('keys', c.RI.keys, 'Управление и окно', 'Горячие клавиши, трей, полный экран')}
        ${tile('addons', c.RI.puzzle, 'Дополнения', c.addonsOn() ? `Включено ${c.addonsOn()}` : 'Last.fm, оверлей для OBS')}
        ${tile('discord', 'M7 8c3-1.5 7-1.5 10 0l2 8c-1.5 1.2-3 1.8-4.5 2l-1-2M7 8l-2 8c1.5 1.2 3 1.8 4.5 2l1-2M9.5 13v.5M14.5 13v.5', 'Статус в Discord', s.discordRpc ? 'Включён' : 'Выключен')}
        <button class="u2-box span2 u2-upd ${upd ? 'new' : ''}" data-action="set-sec" data-sec="updates"><span class="tx"><b>Nyao Music ${esc(state.version || '')}</b><span class="s">${upd ? 'Есть новая версия — открыть обновления' : 'Обновления и канал'}</span></span><span class="btn sm ${upd ? 'primary' : ''}">${upd ? 'Обновить' : 'Открыть'}</span></button>
        <button class="u2-box span2 u2-upd" data-action="set-sec" data-sec="about"><span class="tx"><b>О приложении</b><span class="s">Что нового, приветствие, лицензии</span></span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
        ${c.isDev() ? tile('dev', c.RI.dev, 'Разработчик', 'Тесты, диагностика, флаги') : ''}
      </div>
    </div>`;
  }

  // ---------- Вход: аккаунт или гость → сервисы ----------
  let welcomeEl = null;
  function welcome() {
    if (welcomeEl) return;
    const el = document.createElement('div');
    welcomeEl = el;
    el.className = 'u2-welcome';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Вход в Nyao Music');
    let step = state.cloud.loggedIn ? 'svc' : 'choose';
    const close = async () => {
      await c.setSettings({ onboarded: true, guest: !state.cloud.loggedIn });
      el.classList.remove('in');
      setTimeout(() => { el.remove(); welcomeEl = null; c.rerender(); }, 260);
    };
    const draw = () => {
      if (step === 'choose' || step === 'wait') {
        const ribbon = [0, 1, 2].map((g) => `<path d="${strand(g, 3, 1440, 900)}" stroke="${['#FFD60A', '#F0574A', '#D8CEFF'][g]}" opacity=".5"/>`).join('');
        el.innerHTML = `<svg class="bg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${ribbon}</svg><span class="shade" aria-hidden="true"></span>
          <main class="u2-w-main">
            <div class="head">${LOGO}<h1>Как будем слушать?</h1><p>Оба пути ведут в один и тот же плеер. Отличается только то, что останется с тобой.</p></div>
            <div class="cards">
              <section class="card nyao">${step === 'choose' ? `
                <div><span class="eyebrow">Аккаунт Nyao</span><h2>Музыка везде со мной</h2></div>
                <ul>${['История, лайки и миксы — на ПК, телефоне и в Minecraft', 'Nyao Connect: переключать треки с другого устройства', 'Друзья, профиль и «Слушать вместе»', 'Статистика и настройки едут за тобой'].map((t) => `<li>${CHECK}${t}</li>`).join('')}</ul>
                <button class="btn big tg" data-u2="tg">${c.TG_ICON}Войти через Telegram</button>` : `
                <div><span class="eyebrow">Шаг в Telegram</span><h2>Подтверди вход в боте</h2></div>
                <ol><li class="done"><i>1</i>Открылся бот Nyao в Telegram</li><li><i>2</i>Нажми в нём «Подтвердить вход»</li><li><i>3</i>Это окно продолжит само</li></ol>
                <button class="btn big" data-u2="cancel">Отмена</button>`}
              </section>
              <section class="card">
                <div><span class="eyebrow">Без аккаунта</span><h2>Просто послушать</h2></div>
                <ul>${['Все сервисы, «Моя волна», плейлисты и тексты песен', 'Эквалайзер, дополнения, полный экран — всё как у всех'].map((t) => `<li>${CHECK}${t}</li>`).join('')}${['История и настройки — только на этом компьютере', 'Без друзей, Nyao Connect и статистики'].map((t) => `<li class="no">${DASH}${t}</li>`).join('')}</ul>
                <button class="btn big" data-u2="guest" ${step === 'wait' ? 'disabled' : ''}>Продолжить как гость</button>
              </section>
            </div>
            <p class="foot">Гостем можно войти позже — история, лайки и настройки переедут в аккаунт.<br>Пароли и входы в музыкальные сервисы хранятся только на этом компьютере и в Nyao не попадают.</p>
          </main>`;
        return;
      }
      const names = SERVICES.filter((x) => state.status[x.id]).map((x) => x.name);
      const who = state.cloud.loggedIn ? (state.cloud.user && state.cloud.user.name) || 'Аккаунт Nyao' : 'Гость';
      el.innerHTML = `<div class="u2-w-svc">
        <section class="wave"><svg viewBox="0 0 620 560" preserveAspectRatio="xMidYMid slice" fill="none" stroke-linecap="round" aria-hidden="true">${SERVICES.map((x, i) => { const o = !!state.status[x.id]; return `<path d="${strand(i, 5, 620, 560)}" stroke="${o ? SVC_COLOR[x.id] : '#3A3A40'}" stroke-width="${o ? 2.2 : 1.2}" opacity="${o ? 0.95 : 0.45}"/>`; }).join('')}</svg>
          <div class="tx"><span class="eyebrow">Твоя волна</span><b>${names.length === 0 ? 'Пока пусто' : names.length === 1 ? 'Из одного сервиса' : `Из ${names.length} сервисов`}</b><span>${names.length ? esc(names.join(' · ')) + '. Nyao смешает их рекомендации и твои лайки в одну волну.' : 'Подключи хотя бы один сервис — и здесь зазвучит волна.'}</span></div>
        </section>
        <main>
          <div class="head"><span class="who">${esc(who)} · остался один шаг</span><h1>Откуда берём музыку?</h1><p>Хватит и одного сервиса. С каждым новым волна становится разнообразнее.</p></div>
          <div class="list">${SERVICES.map((x) => { const acc = state.status[x.id]; return `<div class="row">${c.svcDot(x, !!acc)}<span class="tx"><b>${esc(x.name)}</b><i>${acc ? esc(acc.name || 'подключено') + ' · ' : ''}${SVC_HINT[x.id] || ''}</i></span>${acc ? `<span class="ok">${CHECK}в волне</span>` : `<button class="btn primary" data-u2="svc" data-v="${x.id}">Подключить</button>`}</div>`; }).join('')}</div>
          <div class="foot"><span class="hint">Подключить или отключить сервис можно в любой момент — в настройках.</span><button class="btn big ghost" data-u2="done">Пропустить</button><button class="btn big primary" data-u2="done">Открыть Nyao</button></div>
        </main>
      </div>`;
    };
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-u2]');
      if (!b || b.disabled) return;
      const act = b.dataset.u2;
      if (act === 'guest') { step = 'svc'; draw(); }
      else if (act === 'cancel') { c.api.cloud.cancel().catch(() => {}); }
      else if (act === 'tg') {
        step = 'wait'; draw();
        await c.cloudLogin();
        step = state.cloud.loggedIn ? 'svc' : 'choose';
        draw();
      } else if (act === 'svc') {
        // Spotify и VK настраиваются на своих страницах в настройках — там нужны дополнительные шаги
        if (b.dataset.v === 'sp') { await close(); c.openSection('svc:sp'); return; }
        b.disabled = true; b.textContent = 'Жду вход…';
        await c.loginSvc(b.dataset.v);
        draw();
      } else if (act === 'done') await close();
    });
    document.body.appendChild(el);
    draw();
    requestAnimationFrame(() => el.classList.add('in'));
  }

  return { on, home, artist, album, settings, welcome, apply: () => document.body.classList.toggle('ui2', on()) };
}
