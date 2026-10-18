// Мини-соцсеть на ПК: друзья и что они слушают, профиль, заявки, входящие, приглашения,
// совпадение вкусов и «Микс на двоих». Экран собирается из HTML-строк, как и остальное приложение.
// ctx — то, что даёт app.js: api, state, view, esc, coverHtml, badge, toast, go, player, copyText, ago.

export const REACTIONS = ['🔥', '❤️', '😂', '😮', '👏', '🎶'];
export const NICK_RE = /^[a-z0-9_.]{3,24}$/;

/** Ник: латиница, цифры, точка и _ (то же правило, что на сервере) — для подсказки до отправки */
export function nickHint(nick) {
  const n = String(nick || '').trim().replace(/^@/, '');
  if (n.length < 3) return 'Минимум 3 символа';
  if (!NICK_RE.test(n.toLowerCase())) return 'Только латиница, цифры, точка и _';
  if (/^[._]|[._]$/.test(n) || /\.\./.test(n)) return 'Точка и _ не в начале, не в конце и не подряд';
  return null;
}

/** Код приглашения из ссылки …/add/CODE или nyao://add/CODE */
export function inviteCodeOf(input) {
  const m = String(input || '').trim().match(/(?:\/add\/|nyao:\/\/add\/)([a-z0-9]{6,16})\b/);
  return m ? m[1] : null;
}

export function createFriends(ctx) {
  const { api, state, esc, coverHtml, badge, toast, go, player, copyText, ago } = ctx;
  const s = (state.social = state.social || { profile: null, friends: [], incoming: [], outgoing: [], inbox: [], search: { q: '', res: [] }, invite: null, user: null, blocked: null, loaded: false });
  const call = (m, p, b) => api.social(m, p, b);
  const display = (u) => (u && (u.name || (u.nick ? '@' + u.nick : ''))) || 'Друг';

  function avatar(u, size = 44) {
    const pic = u && u.picture;
    const letter = esc(String((u && (u.name || u.nick)) || 'N').trim().charAt(0).toUpperCase());
    return `<span class="fr-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${pic ? `<img src="${esc(pic)}" alt="">` : letter}</span>`;
  }

  async function load() {
    if (!state.cloud.loggedIn) return;
    try {
      const [profile, fr, inbox] = await Promise.all([call('GET', '/profile'), call('GET', '/friends'), call('GET', '/inbox').catch(() => ({ items: [] }))]);
      s.profile = profile;
      s.friends = fr.friends || [];
      s.incoming = fr.incoming || [];
      s.outgoing = fr.outgoing || [];
      s.inbox = inbox.items || [];
      s.loaded = true;
      ctx.updateBadge(unread());
    } catch (e) {
      s.error = e.message;
    }
    rerender();
  }

  function rerender() {
    if (state.route === 'friends') renderFriends();
    else if (state.route === 'user') renderUser();
    else if (state.route === 'profile') renderProfile();
  }

  const unread = () => s.incoming.length + s.inbox.filter((i) => !i.read).length;

  // ---------- Экран «Друзья» ----------
  function renderFriends() {
    const view = ctx.view;
    if (!state.cloud.loggedIn) {
      view.innerHTML = `<div class="scroll friends">${ctx.profileTabs ? ctx.profileTabs('friends') : ''}<h1 class="page">Друзья</h1>
        <div class="card"><div class="field"><label>Нужен аккаунт Nyao</label><div class="hint">Друзья работают через аккаунт Nyao (вход через Telegram). Токены музыкальных сервисов остаются на этом компьютере.</div></div><div><button class="btn primary" data-action="go" data-route="settings">Войти</button></div></div></div>`;
      return;
    }
    const sr = s.search;
    const inv = s.invite;
    view.innerHTML = `<div class="scroll friends">${ctx.profileTabs ? ctx.profileTabs('friends') : ''}
      <div class="fr-head"><h1 class="page">Друзья</h1>
        <button class="btn" data-action="fr-me">${avatar(state.cloud.user ? { name: state.cloud.user.name, picture: state.cloud.user.picture } : null, 24)}<span>@${esc(s.profile ? s.profile.nick : '…')}</span></button></div>
      ${s.incoming.length ? `<section class="fr-sec"><div class="eyebrow">Заявки · ${s.incoming.length}</div>${s.incoming.map((u) => `
        <div class="fr-req">${avatar(u)}<button class="fr-name link-plain" data-action="fr-open" data-id="${esc(u.id)}"><b>${esc(display(u))}</b><span>@${esc(u.nick)} хочет дружить</span></button>
          <button class="btn" data-action="fr-decline" data-id="${esc(u.id)}">Нет</button><button class="btn primary" data-action="fr-accept" data-id="${esc(u.id)}">Принять</button></div>`).join('')}</section>` : ''}
      <section class="fr-sec"><div class="eyebrow">Сейчас слушают</div>
        ${s.friends.length ? `<div class="fr-grid">${s.friends.map(friendCard).join('')}</div>`
          : `<div class="card"><b>Пока никого</b><span class="hint">Найди друга по нику ниже или отправь ему свою ссылку — увидишь, что он слушает, и сможешь звать в комнату.</span></div>`}
      </section>
      ${s.inbox.length ? `<section class="fr-sec"><div class="fr-row-head"><div class="eyebrow">Входящие</div>${s.inbox.some((i) => !i.read) ? '<button class="link-plain" data-action="fr-read">Отметить прочитанным</button>' : ''}</div>
        ${s.inbox.slice(0, 8).map(inboxRow).join('')}</section>` : ''}
      <div class="fr-cols">
        <section class="card"><div class="eyebrow">Найти по нику</div>
          <form data-form="fr-search" class="fr-search"><input name="q" value="${esc(sr.q)}" placeholder="@ник друга" autocomplete="off" spellcheck="false"><button class="btn primary">Найти</button></form>
          ${sr.loading ? '<div class="skeleton" style="height:44px"></div>' : sr.q && !sr.res.length ? '<span class="hint">Никого не нашлось — проверь ник</span>' : ''}
          ${sr.res.map((r) => `<div class="fr-req">${avatar(r)}<button class="fr-name link-plain" data-action="fr-open" data-id="${esc(r.id)}"><b>${esc(display(r))}</b><span>@${esc(r.nick)}</span></button>${relationBtn(r.id, r.relation)}</div>`).join('')}
        </section>
        <section class="card"><div class="eyebrow">Пригласить</div>
          <span class="hint">Ссылка живёт неделю. Друг открывает её — и вы сразу друзья. На телефоне можно показать QR-код или приложить телефоны.</span>
          ${inv ? `<div class="fr-link"><code>${esc(inv.url)}</code><button class="btn" data-action="fr-copy">Скопировать</button></div>` : '<div><button class="btn primary" data-action="fr-invite">Получить ссылку</button></div>'}
          <form data-form="fr-use" class="fr-search"><input name="code" placeholder="Вставь ссылку друга" autocomplete="off" spellcheck="false"><button class="btn">Добавить</button></form>
        </section>
      </div>
    </div>`;
  }

  function friendCard(f) {
    const n = f.now;
    return `<button class="fr-card" data-action="fr-open" data-id="${esc(f.id)}">
      <div class="fr-card-top">${avatar(f, 46)}${n && n.playing ? '<span class="fr-live"></span>' : ''}<div class="fr-name"><b>${esc(display(f))}</b><span>@${esc(f.nick)}</span></div></div>
      ${n ? `<div class="fr-now">${coverHtml(n.track, 'xs')}<div class="meta"><div class="t">${esc(n.track.title)}</div><div class="s">${esc(n.track.artist)}</div></div></div>`
        : `<div class="fr-now muted">${f.online ? 'в сети' : 'сейчас не слушает'}</div>`}
    </button>`;
  }

  function inboxRow(i) {
    const t = i.track;
    const title = i.kind === 'track' ? `${display(i.from)} прислал трек ${i.emoji || ''}` : i.kind === 'room' ? `${display(i.from)} зовёт слушать вместе` : `${display(i.from)}: ${i.emoji || ''}`;
    const sub = i.kind === 'room' ? `Нажми, чтобы войти · ${ago(i.createdAt)}` : t ? (i.kind === 'track' ? `${t.artist} — ${t.title}` : `на «${t.title}» · ${ago(i.createdAt)}`) : ago(i.createdAt);
    return `<button class="fr-inbox ${i.read ? '' : 'unread'}" data-action="fr-inbox" data-id="${esc(i.id)}">
      ${t && i.kind === 'track' ? coverHtml(t, 'xs') : avatar(i.from, 40)}<div class="meta"><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div>${t && i.kind === 'track' ? badge(t.source) : ''}</button>`;
  }

  function relationBtn(id, rel) {
    const b = (act, label, primary) => `<button class="btn ${primary ? 'primary' : ''}" data-action="${act}" data-id="${esc(id)}">${label}</button>`;
    switch (rel) {
      case 'none': return b('fr-add', 'Добавить', true);
      case 'outgoing': return b('fr-decline', 'Отменить заявку');
      case 'incoming': return b('fr-accept', 'Принять', true);
      case 'friends': return '<span class="tag">в друзьях</span>';
      case 'blocked': return b('fr-unblock', 'Разблокировать');
      default: return '';
    }
  }

  // ---------- Профиль пользователя ----------
  function openUser(key) {
    go('user', { key: String(key || '') });
  }

  /** Загрузка профиля для экрана «user» (и при переходе «назад» к другому профилю) */
  async function loadUser(key) {
    s.user = { key: String(key || ''), data: null, match: null, error: null };
    const k = s.user.key || (s.profile && s.profile.nick) || '';
    try {
      if (!k) {
        s.profile = await call('GET', '/profile');
      }
      const data = await call('GET', `/users/${encodeURIComponent(k || s.profile.nick)}`);
      if (s.user.key !== String(key || '')) return;
      s.user.data = data;
      if (data.relation === 'friends' && data.duo !== false) s.user.match = await call('GET', `/friends/${data.id}/match`).catch(() => null);
    } catch (e) {
      s.user.error = e.message;
    }
    if (state.route === 'user') renderUser();
  }

  function renderUser() {
    const view = ctx.view;
    const want = String((state.params && state.params.key) || '');
    if (!s.user || s.user.key !== want) {
      loadUser(want);
    }
    const u = s.user;
    const d = u.data;
    if (u.error) {
      view.innerHTML = `<div class="scroll friends"><button class="btn" data-action="back">← Назад</button><div class="card"><b>${esc(u.error)}</b></div></div>`;
      return;
    }
    if (!d) {
      view.innerHTML = '<div class="scroll friends"><div class="skeleton" style="height:180px;border-radius:28px"></div></div>';
      return;
    }
    const live = s.friends.find((f) => f.id === d.id);
    const now = (live && live.now) || d.now;
    const m = u.match;
    const st = d.stats;
    view.innerHTML = `<div class="scroll friends user-page">
      <div class="fr-row-head"><button class="btn" data-action="back">← Назад</button>
        ${d.relation === 'self' ? '<button class="btn" data-action="go" data-route="profile">Изменить профиль</button>'
          : d.relation === 'friends' ? `<button class="link-plain" data-action="fr-remove" data-id="${esc(d.id)}">Удалить из друзей</button>` : ''}
        ${d.relation !== 'self' && d.relation !== 'blocked' ? `<button class="link-plain" data-action="fr-block" data-id="${esc(d.id)}">Заблокировать</button>` : ''}</div>
      <section class="up-head">${avatar(d, 112)}<div><h1 class="page">${esc(display(d))}</h1><div class="up-nick">@${esc(d.nick)}</div>
        ${!d.private && d.bio ? `<p class="muted">${esc(d.bio)}</p>` : ''}
        ${!d.private ? `<div class="hint">${d.friends} ${plural(d.friends, 'друг', 'друга', 'друзей')}</div>` : ''}
        <div class="up-acts">${d.relation === 'self' ? '' : relationBtn(d.id, d.relation)}</div></div></section>
      ${d.private ? `<div class="card"><b>Профиль скрыт</b><span class="hint">${d.relation === 'blocked' ? 'Ты заблокировал этого пользователя' : 'Его музыку видят только друзья'}</span></div>` : ''}
      ${!d.private && now ? `<section class="card up-now"><div class="eyebrow">${now.playing ? 'Сейчас слушает' : 'Слушал ' + ago(now.updatedAt)}</div>
        <div class="fr-now big">${coverHtml(now.track)}<div class="meta"><div class="t">${esc(now.track.title)}</div><div class="s">${badge(now.track.source)}${esc(now.track.artist)}</div></div>
          <button class="btn" data-action="fr-play-now">Включить себе</button></div>
        ${d.relation === 'friends' ? `<div class="tg-reacts">${REACTIONS.map((e) => `<button data-action="fr-react" data-e="${e}" aria-label="Реакция ${e}">${e}</button>`).join('')}</div>
          <div><button class="btn primary" data-action="fr-room">${state.room ? 'Позвать в мою комнату' : 'Создать комнату и позвать'}</button></div>` : ''}</section>` : ''}
      ${d.relation === 'friends' && d.duo === false ? `<span class="hint">${esc(display(d))} не открывал совпадение вкусов и «Микс на двоих»</span>` : ''}
      ${d.relation === 'friends' && m ? `<section class="card up-match"><div class="ring" style="--p:${m.percent}"><b>${m.percent}%</b></div>
        <div class="meta"><b>Совпадение вкусов</b><span class="hint">${!m.enough ? 'Пока мало прослушиваний — точнее будет через пару дней' : m.commonArtists.length ? 'Общие: ' + esc(m.commonArtists.slice(0, 5).join(', ')) : 'Общих исполнителей пока нет'}</span></div>
        <button class="btn primary" data-action="fr-mix">Микс на двоих</button></section>` : ''}
      ${!d.private && d.badges && d.badges.length ? `<section class="fr-sec"><div class="eyebrow">Значки</div><div class="up-badges">${d.badges.map((b) => `<div class="up-badge"><span>${esc(b.emoji)}</span><b>${esc(b.title)}</b></div>`).join('')}</div></section>` : ''}
      ${!d.private && st && st.plays ? `<div class="fr-cols">
        <section class="card"><div class="eyebrow">За месяц</div><div class="up-stats"><div><b>${st.minutes}</b><span>минут</span></div><div><b>${st.plays}</b><span>прослушиваний</span></div></div>
          ${st.topArtists.map((a, i) => `<div class="up-artist"><span class="n">${i + 1}</span><b>${esc(a.name)}</b><span class="muted">${a.plays}</span></div>`).join('')}</section>
        <section class="card"><div class="eyebrow">Чаще всего слушает</div>
          ${st.topTracks.map((t, i) => `<button class="fr-inbox" data-action="fr-top" data-i="${i}">${coverHtml(t, 'xs')}<div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist)}</div></div><span class="muted">${t.plays}×</span></button>`).join('')}</section></div>` : ''}
    </div>`;
  }

  // ---------- Мой профиль и приватность ----------
  function renderProfile() {
    const view = ctx.view;
    const p = s.profile;
    if (!p) {
      view.innerHTML = '<div class="scroll friends"><div class="skeleton" style="height:240px;border-radius:28px"></div></div>';
      call('GET', '/profile').then((x) => { s.profile = x; renderProfile(); }).catch((e) => toast(e.message, true));
      return;
    }
    const chip = (id, label) => `<button class="chip ${p.visibility === id ? 'on' : ''}" data-action="fr-vis" data-v="${id}">${label}</button>`;
    const sw = (key, title, hint) => `<label class="fr-switch"><span><b>${title}</b><span class="hint">${hint}</span></span><input type="checkbox" data-action="fr-toggle" data-k="${key}" ${p[key] ? 'checked' : ''}></label>`;
    view.innerHTML = `<div class="scroll friends">
      <div class="fr-row-head"><button class="btn" data-action="back">← Назад</button></div>
      <h1 class="page">Мой профиль</h1>
      <section class="card"><form data-form="fr-profile" class="fr-form">
        <label>Ник<div class="fr-nick"><span>@</span><input name="nick" value="${esc(p.nick)}" maxlength="24" autocomplete="off" spellcheck="false"></div><span class="hint">Латиница, цифры, точка и _ · по нему тебя найдут</span></label>
        <label>О себе<textarea name="bio" maxlength="160" rows="2">${esc(p.bio)}</textarea></label>
        <div><button class="btn primary">Сохранить</button></div></form></section>
      <section class="card"><div class="eyebrow">Кто видит профиль</div>
        <div class="chips">${chip('all', 'Все')}${chip('friends', 'Друзья')}${chip('nobody', 'Никто')}</div>
        <span class="hint">${p.visibility === 'all' ? 'Профиль и статистику видят все, кто тебя найдёт. Что ты слушаешь сейчас — только друзья.' : p.visibility === 'nobody' ? 'Тебя находят только по точному нику, профиль закрыт даже для друзей.' : 'Профиль открыт только друзьям. Остальные видят ник и аватар.'}</span>
        ${sw('showNow', 'Показывать, что слушаю сейчас', 'Друзья видят трек в реальном времени')}
        ${sw('showStats', 'Показывать статистику', 'Минуты, любимые исполнители и треки за месяц')}
        ${sw('allowDuo', 'Микс на двоих', 'Друзья видят совпадение вкусов и могут включить общий микс из твоей истории')}
        ${sw('invisible', 'Невидимка', 'Пока включено, никто не видит, что ты слушаешь')}
        ${sw('friendPopups', 'Окошки от друзей', 'Всплывают в углу экрана, когда Nyao свёрнут')}
      </section>
      ${s.blocked && s.blocked.length ? `<section class="card"><div class="eyebrow">Заблокированные</div>${s.blocked.map((u) => `<div class="fr-req">${avatar(u, 36)}<span class="fr-name"><b>${esc(display(u))}</b></span><button class="btn" data-action="fr-unblock" data-id="${esc(u.id)}">Разблокировать</button></div>`).join('')}</section>` : ''}
    </div>`;
    // окошки — локальная настройка компьютера, не сервера
    const pop = view.querySelector('[data-k="friendPopups"]');
    if (pop) pop.checked = !state.settings || state.settings.friendPopups !== false;
    if (!s.blocked) call('GET', '/blocks').then((r) => { s.blocked = r.users || []; if (s.blocked.length && state.route === 'profile') renderProfile(); }).catch(() => {});
  }

  // ---------- Действия ----------
  async function action(el) {
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'fr-open':
        openUser(id);
        return true;
      case 'fr-me':
        openUser('');
        return true;
      case 'fr-add': {
        const r = await call('POST', '/friends/request', { userId: id });
        toast(r.relation === 'friends' ? 'Теперь вы друзья' : 'Заявка отправлена');
        s.search.res = s.search.res.map((x) => (x.id === id ? { ...x, relation: r.relation } : x));
        if (s.user && s.user.data && s.user.data.id === id) s.user.data.relation = r.relation;
        await load();
        return true;
      }
      case 'fr-accept':
        await call('POST', `/friends/${id}/accept`);
        toast('Теперь вы друзья');
        if (s.user && s.user.data && s.user.data.id === id) loadUser(s.user.key);
        await load();
        return true;
      case 'fr-decline':
      case 'fr-remove':
        await call('DELETE', `/friends/${id}`);
        s.search.res = s.search.res.map((x) => (x.id === id ? { ...x, relation: 'none' } : x));
        if (s.user && s.user.data && s.user.data.id === id) s.user.data = { ...s.user.data, relation: 'none' };
        await load();
        return true;
      case 'fr-block':
        await call('POST', `/blocks/${id}`);
        toast('Пользователь заблокирован');
        s.blocked = null;
        await load();
        if (state.route === 'user' && s.user) loadUser(s.user.key);
        return true;
      case 'fr-unblock':
        await call('DELETE', `/blocks/${id}`);
        s.blocked = null;
        rerender();
        return true;
      case 'fr-invite':
        s.invite = await call('POST', '/invites');
        renderFriends();
        return true;
      case 'fr-copy':
        copyText(`Добавляйся в друзья в Nyao Music: ${s.invite.url}`);
        toast('Ссылка скопирована');
        return true;
      case 'fr-read':
        await call('POST', '/inbox/read', { all: true });
        s.inbox = s.inbox.map((i) => ({ ...i, read: true }));
        renderFriends();
        return true;
      case 'fr-inbox': {
        const i = s.inbox.find((x) => x.id === id);
        if (!i) return true;
        if (i.kind === 'room' && i.code) ctx.joinRoom(i.code);
        else if (i.track) player.playList([i.track], 0, `От ${display(i.from)}`);
        else openUser(i.from.id);
        return true;
      }
      case 'fr-play-now': {
        const d = s.user && s.user.data;
        const live = d && s.friends.find((f) => f.id === d.id);
        const now = (live && live.now) || (d && d.now);
        if (now) player.playList([now.track], 0, `Как у @${d.nick}`);
        return true;
      }
      case 'fr-react': {
        const d = s.user.data;
        const live = s.friends.find((f) => f.id === d.id);
        const now = (live && live.now) || d.now;
        await call('POST', `/friends/${d.id}/react`, { emoji: el.dataset.e, track: now && now.track });
        toast(`Реакция отправлена ${el.dataset.e}`);
        return true;
      }
      case 'fr-room': {
        const d = s.user.data;
        if (!state.room) await ctx.createRoom();
        await call('POST', `/friends/${d.id}/invite`);
        toast(`${display(d)} получит приглашение в комнату`);
        renderUser();
        return true;
      }
      case 'fr-mix': {
        const d = s.user.data;
        const r = await call('GET', `/friends/${d.id}/mix`);
        if (!r.tracks.length) toast('Пока не из чего собрать микс — послушайте ещё');
        else player.playList(r.tracks, 0, r.title);
        return true;
      }
      case 'fr-top': {
        const st = s.user.data.stats;
        const tracks = st.topTracks.map((t) => {
          const i = String(t.trackId).indexOf(':');
          return { id: t.trackId, source: t.trackId.slice(0, i), srcId: t.trackId.slice(i + 1), title: t.title, artist: t.artist, album: '', duration: 0, cover: t.cover };
        });
        player.playList(tracks, Number(el.dataset.i) || 0, `Любимое @${s.user.data.nick}`);
        return true;
      }
      case 'fr-vis':
        s.profile = await call('PUT', '/profile', { visibility: el.dataset.v });
        renderProfile();
        return true;
      case 'fr-toggle': {
        const k = el.dataset.k;
        if (k === 'friendPopups') {
          state.settings = await api.settings.set({ friendPopups: el.checked });
          return true;
        }
        s.profile = await call('PUT', '/profile', { [k]: el.checked });
        if (k === 'invisible' && el.checked) toast('Невидимка включена');
        return true;
      }
      default:
        return false;
    }
  }

  async function submit(form) {
    const f = new FormData(form);
    switch (form.dataset.form) {
      case 'fr-search': {
        const q = String(f.get('q') || '').trim().replace(/^@/, '');
        s.search = { q, res: [], loading: q.length >= 2 };
        renderFriends();
        if (q.length < 2) return true;
        try {
          s.search.res = (await call('GET', `/users/search?q=${encodeURIComponent(q)}`)).users || [];
        } finally {
          s.search.loading = false;
          renderFriends();
        }
        return true;
      }
      case 'fr-use': {
        const code = inviteCodeOf(f.get('code'));
        if (!code) throw new Error('Это не похоже на ссылку-приглашение');
        await useInvite(code);
        return true;
      }
      case 'fr-profile': {
        const nick = String(f.get('nick') || '').trim().replace(/^@/, '');
        const bad = nick.toLowerCase() !== (s.profile.nick || '').toLowerCase() && nickHint(nick);
        if (bad) throw new Error(bad);
        s.profile = await call('PUT', '/profile', { nick, bio: String(f.get('bio') || '') });
        toast('Профиль сохранён');
        renderProfile();
        return true;
      }
      default:
        return false;
    }
  }

  async function useInvite(code) {
    const r = await call('POST', `/invites/${code}/use`);
    if (r.relation === 'self') return toast('Это твоё приглашение');
    toast(`${display(r.user)} теперь в друзьях`);
    await load();
    if (r.user) openUser(r.user.id);
  }

  // ---------- Живые события ----------
  function onEvent(e) {
    const u = e.user || e.from;
    switch (e.kind) {
      case 'now': {
        const f = s.friends.find((x) => x.id === (e.user && e.user.id));
        if (f) {
          f.now = e.now;
          // now: null — друг поставил паузу или включил «невидимку»; в сети он только если что-то играет
          f.online = e.online === false ? false : !!e.now || f.online;
          s.friends.sort((a, b) => ((b.now && b.now.updatedAt) || 0) - ((a.now && a.now.updatedAt) || 0));
        }
        if (state.route === 'friends' || (state.route === 'user' && s.user && s.user.data && f && s.user.data.id === f.id)) rerender();
        return;
      }
      case 'friend-request':
        if (u && !s.incoming.some((x) => x.id === u.id)) s.incoming.unshift(u);
        if (!e.quiet) banner(`${display(u)} хочет дружить`, 'Открыть', () => openUser(u.id));
        break;
      case 'friend-accepted':
        banner(`${display(u)} теперь в друзьях`, 'Профиль', () => openUser(u.id));
        load();
        break;
      case 'track':
      case 'room':
      case 'react': {
        const item = { id: String(e.inboxId || e.id), kind: e.kind, from: e.from, track: e.track || null, emoji: e.emoji || null, code: e.code || null, createdAt: e.createdAt || Date.now(), read: false };
        s.inbox = [item, ...s.inbox.filter((x) => x.id !== item.id)].slice(0, 100);
        if (e.kind === 'track') banner(`${display(e.from)} прислал трек ${e.emoji || ''}${e.track ? ' · ' + e.track.title : ''}`, 'Слушать', () => player.playList([e.track], 0, `От ${display(e.from)}`));
        if (e.kind === 'room') banner(`${display(e.from)} зовёт слушать вместе`, 'Войти', () => ctx.joinRoom(e.code));
        if (e.kind === 'react') banner(`${display(e.from)}: ${e.emoji}${e.track ? ' на «' + e.track.title + '»' : ''}`, null, null);
        break;
      }
      default:
        return;
    }
    ctx.updateBadge(unread());
    rerender();
  }

  /** Всплывашка сверху внутри окна (если окно свёрнуто — main.js показывает окошко в углу экрана) */
  function banner(text, label, fn) {
    if (!document.hasFocus()) return;
    let el = document.getElementById('fr-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fr-banner';
      document.body.appendChild(el);
    }
    el.innerHTML = `<span>${esc(text)}</span>${label ? `<button class="btn primary">${esc(label)}</button>` : ''}`;
    el.className = 'show';
    const btn = el.querySelector('button');
    if (btn) btn.onclick = () => { el.className = ''; fn && fn(); };
    clearTimeout(banner.t);
    banner.t = setTimeout(() => (el.className = ''), 6000);
  }

  /** Окошко из угла экрана нажали — открываем нужное */
  function onOpen(p) {
    if (!p) return;
    if (p.room) ctx.joinRoom(p.room);
    else if (p.play) player.playList([p.play], 0, `От ${p.from || 'друга'}`);
    else if (p.route === 'user') openUser(p.key);
    else go('friends');
  }

  /** После входа: если ник ещё не выбран — спросить (один раз на компьютере) */
  async function askNick() {
    if (!s.profile || s.profile.nickSet || localStorage.getItem('nyao.nickAsked')) return;
    localStorage.setItem('nyao.nickAsked', '1');
    const nick = await ctx.askText('Придумай ник — по нему тебя найдут друзья', (state.cloud.user && state.cloud.user.username) || '', 'Готово');
    if (!nick) return;
    const bad = nickHint(nick);
    if (bad) return toast(`${bad}. Ник можно поменять в «Мой профиль»`, true);
    try {
      s.profile = await call('PUT', '/profile', { nick });
      toast(`Привет, @${s.profile.nick}!`);
    } catch (e) {
      toast(`${e.message}. Ник можно поменять в «Мой профиль»`, true);
    }
  }

  /** «Отправить другу» из меню трека */
  function sharePicker(track, x, y) {
    const menu = document.getElementById('menu');
    menu.innerHTML = `<div class="lbl">Отправить «${esc(track.title)}»</div>
      <div class="fr-pick-emoji">${REACTIONS.map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>
      ${s.friends.length ? s.friends.map((f) => `<button data-to="${esc(f.id)}">${avatar(f, 22)} ${esc(display(f))}</button>`).join('') : '<div class="lbl" style="text-transform:none;letter-spacing:0">Сначала добавь друзей</div>'}`;
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
    let emoji = null;
    menu.onclick = async (e) => {
      const em = e.target.closest('[data-e]');
      if (em) {
        emoji = emoji === em.dataset.e ? null : em.dataset.e;
        menu.querySelectorAll('[data-e]').forEach((b) => b.classList.toggle('on', b.dataset.e === emoji));
        return;
      }
      const b = e.target.closest('[data-to]');
      if (!b) return;
      menu.hidden = true;
      try {
        await call('POST', '/share', { to: b.dataset.to, track, emoji });
        toast('Отправлено');
      } catch (err) {
        toast(err.message, true);
      }
    };
  }

  return { load, renderFriends, renderUser, renderProfile, openUser, action, submit, onEvent, onOpen, askNick, sharePicker, useInvite, unread };
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
