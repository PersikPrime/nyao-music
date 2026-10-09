// Приветствие при первом запуске: что это за плеер → вход в сервисы → характер волны → Discord → готово.
// Показывается, пока в настройках не стоит onboarded: true. Повторно — кнопкой в «Настройках».

const LOGO = `<svg class="ob-logo" viewBox="0 0 120 120" aria-hidden="true">
  <rect width="120" height="120" rx="27" fill="#13111C"/>
  <rect x="1" y="1" width="118" height="118" rx="26" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>
  <g fill="none" stroke-width="11" stroke-linecap="round">
    <path d="M20 52c13-22 27-22 40 0s27 22 40 0" stroke="#FFD60A"/>
    <path d="M20 68c13-22 27-22 40 0s27 22 40 0" stroke="#F0574A"/>
    <path d="M20 60c13-22 27-22 40 0s27 22 40 0" stroke="#D8CEFF"/>
  </g></svg>`;

const DIV = [
  ['favorite', 'Любимое', 'Больше того, что ты уже лайкал, плюс сами лайки из YouTube Music.'],
  ['discover', 'Незнакомое', 'Только новое: в поток не попадёт ничего из твоих лайков.'],
  ['popular', 'Популярное', 'Хиты и то, что сейчас слушают чаще всего.']
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class Onboarding {
  /**
   * @param {object} ctx
   *   api, isMac, getStatus(), getSettings(), setSettings(patch) → settings,
   *   login(svc) → Promise, startWave() → Promise, toast(msg, isErr)
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.step = 0;
    this.version = '';
    this.busy = null;
    this.el = document.createElement('div');
    this.el.className = 'onboarding';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Добро пожаловать в Nyao Music');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('keydown', (e) => e.stopPropagation()); // горячие клавиши плеера тут не нужны
  }

  async open() {
    this.step = 0;
    try {
      this.version = (await this.ctx.api.version()).label;
    } catch {
      this.version = '';
    }
    document.body.appendChild(this.el);
    document.body.classList.add('ob-open');
    this.render();
    requestAnimationFrame(() => this.el.classList.add('in'));
  }

  async close(startWave) {
    await this.ctx.setSettings({ onboarded: true });
    this.el.classList.remove('in');
    document.body.classList.remove('ob-open');
    setTimeout(() => this.el.remove(), 260);
    if (startWave) this.ctx.startWave().catch((e) => this.ctx.toast(e.message, true));
  }

  get steps() {
    return ['welcome', 'accounts', 'wave', 'discord', 'done'];
  }

  render() {
    const name = this.steps[this.step];
    const dots = this.steps.map((_, i) => `<span class="${i === this.step ? 'on' : i < this.step ? 'past' : ''}"></span>`).join('');
    const body = this[name]();
    const last = this.step === this.steps.length - 1;
    const backBtn = this.step > 0 && !last ? '<button class="btn ghost" data-ob="back">Назад</button>' : '<span></span>';
    let next = '';
    if (name === 'welcome') next = '<button class="btn primary" data-ob="next">Начать</button>';
    else if (name === 'accounts') next = `<button class="btn primary" data-ob="next">${this.anyAccount() ? 'Дальше' : 'Пропустить пока'}</button>`;
    else if (!last) next = '<button class="btn primary" data-ob="next">Дальше</button>';
    this.el.innerHTML = `<div class="ob-card ob-${name}">
      ${body}
      ${last ? '' : `<div class="ob-foot">${backBtn}<div class="ob-dots" aria-label="Шаг ${this.step + 1} из ${this.steps.length}">${dots}</div>${next}</div>`}
    </div>`;
    const first = this.el.querySelector('[data-ob="next"], [data-ob="finish-wave"]');
    if (first) first.focus({ preventScroll: true });
  }

  anyAccount() {
    const st = this.ctx.getStatus();
    return !!(st.ya || st.yt);
  }

  welcome() {
    return `<div class="ob-hero">${LOGO}
      <h1>Nyao Music</h1>
      <p>Одна «Моя волна» из Яндекс Музыки и YouTube Music. Яндекс подбирает основу, YouTube подмешивает треки, которых там нет.</p>
      ${this.version ? `<span class="ob-ver">версия ${esc(this.version)}</span>` : ''}
    </div>`;
  }

  accounts() {
    const st = this.ctx.getStatus();
    const card = (svc) => {
      const isYa = svc === 'ya';
      const acc = st[svc];
      const busy = this.busy === svc;
      return `<div class="ob-svc ${acc ? 'ok' : ''}">
        <div class="logo" style="background:${isYa ? 'var(--ya)' : 'var(--yt)'};color:${isYa ? '#000' : '#fff'}">${isYa ? 'Я' : 'YT'}</div>
        <div class="info"><div class="name">${isYa ? 'Яндекс Музыка' : 'YouTube Music'}</div>
          <div class="st">${acc ? `Вход выполнен: ${esc(acc.name)}` : isYa ? 'Даёт «Мою волну», лайки и плейлисты' : 'Подмешивает треки в волну. Поиск работает и без входа'}</div></div>
        ${acc ? '<span class="ob-check" aria-label="Подключено">✓</span>' : `<button class="btn ${isYa ? 'primary' : ''}" data-ob="login" data-svc="${svc}" ${busy ? 'disabled' : ''}>${busy ? 'Жду вход…' : 'Войти'}</button>`}
      </div>`;
    };
    return `<h2>Подключи сервисы</h2>
      <p class="ob-sub">Откроется обычное окно входа сервиса. Пароли в Nyao не попадают — сохраняется только токен, зашифрованный системой.</p>
      <div class="ob-list">${card('ya')}${card('yt')}</div>
      <p class="ob-note">Можно подключить позже в «Настройках». Если Google не пускает в окне входа, там же есть вставка cookies вручную.</p>`;
  }

  wave() {
    const s = this.ctx.getSettings();
    const share = s.ytmShare ?? 30;
    return `<h2>Настрой «Мою волну»</h2>
      <p class="ob-sub">Всё это меняется на экране волны в любой момент.</p>
      <div class="ob-block"><span class="eyebrow">Характер</span>
        <div class="seg" role="radiogroup">${DIV.map(([v, l]) => `<button role="radio" aria-checked="${s.waveDiversity === v}" class="${s.waveDiversity === v ? 'on' : ''}" data-ob="div" data-v="${v}">${l}</button>`).join('')}</div>
        <span class="hint">${(DIV.find((d) => d[0] === s.waveDiversity) || DIV[0])[2]}</span>
      </div>
      <div class="ob-block"><span class="eyebrow">Сколько YouTube Music подмешивать</span>
        <div class="ob-share"><span class="y">Я <b id="ob-ya">${100 - share}%</b></span>
          <input type="range" min="0" max="100" step="5" value="${share}" data-ob-share aria-label="Доля YouTube Music">
          <span class="t"><b id="ob-yt">${share}%</b> YT</span></div>
      </div>`;
  }

  discord() {
    const s = this.ctx.getSettings();
    return `<h2>Статус в Discord</h2>
      <p class="ob-sub">По желанию: друзья увидят «Слушает Nyao Music» с обложкой, названием, полоской трека и значком Яндекса или YouTube.</p>
      <label class="ob-toggle"><input type="checkbox" data-ob-rpc ${s.discordRpc ? 'checked' : ''}><span>Показывать, что я слушаю</span></label>
      <input class="ob-input" type="text" data-ob-rpc-id value="${esc(s.discordClientId || '')}" placeholder="Application ID из Discord Developer Portal">
      <p class="ob-note">Нужен свой Application ID — как его получить, написано в «Настройках» → Discord. Можно пропустить.</p>`;
  }

  done() {
    const st = this.ctx.getStatus();
    const any = st.ya || st.yt;
    return `<div class="ob-hero">${LOGO}
      <h1>Готово</h1>
      <p>${any ? 'Волна соберётся из подключённых сервисов. Лайки и «не нравится» её подстраивают.' : 'Сервисы не подключены — поиск YouTube Music уже работает, а для волны войди в аккаунт в «Настройках».'}</p>
      <div class="ob-actions">
        ${any ? '<button class="btn primary big" data-ob="finish-wave">Запустить «Мою волну»</button>' : ''}
        <button class="btn ${any ? 'ghost' : 'primary big'}" data-ob="finish">Перейти в плеер</button>
      </div>
      ${this.version ? `<span class="ob-ver">версия ${esc(this.version)}</span>` : ''}
    </div>`;
  }

  async saveDiscordStep() {
    const idEl = this.el.querySelector('[data-ob-rpc-id]');
    const onEl = this.el.querySelector('[data-ob-rpc]');
    if (!idEl) return true;
    const id = idEl.value.trim();
    if (id && !/^\d{15,22}$/.test(id)) {
      this.ctx.toast('Application ID — это число из 17–20 цифр', true);
      return false;
    }
    await this.ctx.setSettings({ discordClientId: id, discordRpc: !!(onEl && onEl.checked) });
    return true;
  }

  async onClick(e) {
    const b = e.target.closest('[data-ob]');
    if (!b) return;
    const act = b.dataset.ob;
    try {
      if (act === 'next') {
        if (this.steps[this.step] === 'discord' && !(await this.saveDiscordStep())) return;
        this.step = Math.min(this.step + 1, this.steps.length - 1);
        this.render();
      } else if (act === 'back') {
        this.step = Math.max(0, this.step - 1);
        this.render();
      } else if (act === 'login') {
        this.busy = b.dataset.svc;
        this.render();
        try {
          await this.ctx.login(this.busy);
        } finally {
          this.busy = null;
          if (this.el.isConnected) this.render();
        }
      } else if (act === 'div') {
        await this.ctx.setSettings({ waveDiversity: b.dataset.v });
        this.render();
      } else if (act === 'finish' || act === 'finish-wave') {
        await this.close(act === 'finish-wave');
      }
    } catch (err) {
      this.ctx.toast(err.message, true);
    }
  }

  onInput(e) {
    if (!('obShare' in e.target.dataset)) return;
    const v = Number(e.target.value);
    this.el.querySelector('#ob-ya').textContent = `${100 - v}%`;
    this.el.querySelector('#ob-yt').textContent = `${v}%`;
    e.target.style.setProperty('--p', `${v}%`);
  }

  onChange(e) {
    if ('obShare' in e.target.dataset) this.ctx.setSettings({ ytmShare: Number(e.target.value) }).catch(() => {});
  }
}
