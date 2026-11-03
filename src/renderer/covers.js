// Обложки: шаблонный диск для треков без картинки и запасной путь для картинок, которые не грузятся.
// Шаблон рисует main по адресу nyao://cover/<id трека>.png — цвет зависит от трека и везде одинаковый.
// Трек без своей обложки (чаще всего VK) получает шаблон везде: в списках, плеере, полноэкранном режиме,
// шторке Windows, — иначе на экране оставалась обложка прошлого трека.

/** Адрес сервера Nyao: через него идут картинки, которые без VPN не открываются */
export const IMG_PROXY = 'https://api.music.withnyao.app/img?u=';
// те же хосты, что пропускает сервер (server/src/img-proxy.js)
const PROXY_HOSTS = /(^|\.)(t\.me|telegram\.org|telesco\.pe|cdn-telegram\.org|ytimg\.com|ggpht\.com|googleusercontent\.com|sndcdn\.com|userapi\.com|vk\.me|vkuser\.net|vk-cdn\.net|scdn\.co|spotifycdn\.com|mzstatic\.com)$/i;

export function templateCover(id) {
  return `nyao://cover/${encodeURIComponent(String(id || 'nyao'))}.png`;
}

/** Обложка трека: своя или шаблон (для плейлистов и альбомов — только своя) */
export function coverOf(t) {
  if (!t) return '';
  if (t.cover) return t.cover;
  return t.srcId ? templateCover(t.id) : '';
}

/** Проставляет шаблон треку без обложки (мутирует: дальше трек везде с обложкой) */
export function fillCover(t) {
  if (t && !t.cover && t.id) t.cover = templateCover(t.id);
  return t;
}

export function proxyUrl(src) {
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:' || !PROXY_HOSTS.test(u.hostname)) return null;
    return IMG_PROXY + encodeURIComponent(src);
  } catch {
    return null;
  }
}

/**
 * Картинка не загрузилась: сначала пробуем её же через сервер Nyao, потом — шаблонный диск (data-tpl),
 * а если и его нет — прячем, чтобы не висела сломанная иконка.
 */
export function installImageFallback(root = document) {
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const src = img.getAttribute('src') || '';
    if (!img.dataset.px && !src.startsWith(IMG_PROXY)) {
      const p = proxyUrl(src);
      if (p) {
        img.dataset.px = '1';
        img.src = p;
        return;
      }
    }
    const tpl = img.dataset.tpl;
    if (tpl && src !== tpl) {
      img.src = tpl;
      return;
    }
    img.style.visibility = 'hidden';
  }, true);
}
