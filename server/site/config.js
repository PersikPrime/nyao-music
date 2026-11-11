// Всё, что меняется без правки вёрстки: ссылки, версии, тексты платформ.
// Секретов здесь нет и быть не должно. Токен GitHub (если репозиторий закрыт) — только в переменной окружения GITHUB_TOKEN.
module.exports = {
  port: Number(process.env.PORT) || 3000,
  siteUrl: process.env.SITE_URL || 'http://localhost:3000',

  // Откуда брать релизы. На нашем сервере — API Nyao Music (/updates/latest): у него зеркало файлов,
  // скачивание идёт с нашего сервера, а не с GitHub. Без RELEASES_API — напрямую из GitHub-репозитория.
  releasesApi: (process.env.RELEASES_API || '').replace(/\/$/, ''),
  repo: process.env.GITHUB_REPO || 'PersikPrime/nyao-music',
  releaseCacheMinutes: 10,

  links: {
    github: 'https://github.com/PersikPrime/nyao-music',
    releases: 'https://github.com/PersikPrime/nyao-music/releases',
    telegram: 'https://t.me/nyaomusic',
    docs: 'https://github.com/PersikPrime/nyao-music/tree/main/docs',
    addonsDoc: 'https://github.com/PersikPrime/nyao-music/blob/nightly/docs/addons.md',
  },

  // Запасные подписи версий, если GitHub недоступен
  fallback: { stable: '0.10', red: '0.10' },

  platforms: [
    { id: 'win', label: 'Windows', title: 'Для Windows', match: /win-x64\.exe$/i, button: 'Скачать .exe', color: '#8FB4FF',
      note: 'Установщик .exe. Обновления приходят сами, небольшие — без переустановки.' },
    { id: 'mac', label: 'macOS', title: 'Для macOS', match: /mac-arm64\.dmg$/i, button: 'Скачать для Apple Silicon',
      alt: { id: 'mac-intel', match: /mac-x64\.dmg$/i, label: 'Для Mac на Intel' }, color: '#C6B8FF',
      note: 'Образ .dmg с оформлением Liquid Glass. Обновляется сам.' },
    { id: 'android', label: 'Android', title: 'Для Android', match: /\.apk$/i, button: 'Скачать APK', color: '#7CE0C3',
      note: 'Файл APK: скачай и открой на телефоне. Три темы оформления и управление из шторки.' },
    { id: 'ios', label: 'iPhone и iPad', title: 'Для iOS и iPadOS', match: /\.ipa$/i, button: 'Скачать IPA', color: '#FFB86B',
      note: 'Файл IPA. В App Store приложения нет — ставится через SideStore, AltStore или Sideloadly.' },
  ],
};
