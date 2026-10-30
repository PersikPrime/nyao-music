export function librespotCard(s, esc) {
  if (!s?.permitted || !s.flag) return '';
  const account = s.loggedIn && s.account && !s.account.error ? s.account : null;
  const button = (action, label, extra = '') => '<button class="btn" data-action="' + action + '" ' + extra + '>' + label + '</button>';
  return '<section class="card"><div class="svc"><div class="logo" style="background:var(--sp);color:#000">SP</div>' +
    '<div class="info"><div class="name">Spotify (librespot)</div><div class="st">' +
    (account ? 'Подключено: ' + esc(account.name) + (s.active ? ' · используется' : ' · выключено') : 'Экспериментальный плеер · нужен Premium') +
    '</div></div>' + (s.loggedIn ? button('native-logout', 'Выйти') : button('native-login', 'Войти', s.hasClientId && s.available ? '' : 'disabled')) +
    '</div><div class="hint">Привязка отдельная от обычного Spotify. Музыка воспроизводится на этом компьютере, отдельное приложение Spotify не требуется.</div>' +
    (!s.available ? '<p class="note">Нужен полный установщик этой версии для macOS или Windows. Быстрое обновление не добавляет нативный плеер.</p>' : '') +
    (account ? '<div class="manual">' + button('native-use', s.active ? 'Вернуться к обычному Spotify' : 'Использовать librespot', s.available ? '' : 'disabled') + '</div>' : '') +
    (s.engine?.message ? '<p class="note">' + esc(s.engine.message) + '</p>' : '') +
    '<details ' + (s.hasClientId ? '' : 'open') + '><summary>Подключение через браузер</summary><div class="hint">В своём приложении Spotify Developer Dashboard добавь Redirect URI:</div>' +
    '<div class="manual"><code>' + esc(s.redirect || '') + '</code>' + button('native-copy-redirect', 'Скопировать') + '</div>' +
    '<div class="hint">Можно использовать свой существующий Client ID. Client Secret не нужен. После сохранения нажми «Войти».</div>' +
    '<div class="manual" style="display:flex;gap:8px"><input type="text" data-native-client placeholder="Client ID (32 символа)" value="' + esc(s.clientId || '') + '" style="flex:1">' + button('native-save-id', 'Сохранить') + '</div>' +
    '</details><details><summary>Что-то не работает?</summary><div class="manual">' + button('native-debug', 'Показать состояние') +
    '<pre id="native-log" class="hint" style="white-space:pre-wrap"></pre></div></details></section>';
}
