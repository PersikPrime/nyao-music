// Свежие релизы с GitHub: версии и файлы для кнопок «Скачать». С кэшем и без падений:
// если GitHub недоступен или репозиторий закрыт, кнопки ведут на страницу релизов.
const config = require('../config');

let cache = { at: 0, data: null };

function pick(release) {
  if (!release) return null;
  const files = {};
  const find = (re) => (release.assets || []).find((a) => re.test(a.name));
  for (const p of config.platforms) {
    for (const [id, re] of [[p.id, p.match], p.alt ? [p.alt.id, p.alt.match] : null].filter(Boolean)) {
      const asset = find(re);
      if (asset) files[id] = { url: asset.browser_download_url, name: asset.name, size: asset.size };
    }
  }
  return { tag: release.tag_name, name: release.name || release.tag_name, url: release.html_url, date: release.published_at, files };
}

/** Через API Nyao Music: там зеркало файлов на нашем сервере. Канал Red — nightly */
async function loadFromApi() {
  const get = async (q) => {
    const res = await fetch(`${config.releasesApi}/updates/latest${q}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`API релизов ответил ${res.status}`);
    return res.json();
  };
  const [stable, red] = await Promise.all([get(''), get('?channel=nightly').catch(() => null)]);
  // API отдаёт обычный релиз, если пререлиз канала старее — тогда отдельной Red-сборки нет
  return { stable: pick(stable), red: red && red.prerelease ? pick(red) : null };
}

async function load() {
  if (config.releasesApi) return loadFromApi();
  if (!config.repo) return null;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'nyao-music-site' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${config.repo}/releases?per_page=30`, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  const list = (await res.json()).filter((r) => !r.draft);
  const isRed = (r) => /nightly/i.test(r.tag_name) || r.prerelease;
  return { stable: pick(list.find((r) => !isRed(r))), red: pick(list.find(isRed)) };
}

/** { stable, red } — каждый либо { tag, name, url, date, files: { win: { url, name, size } … } }, либо null */
async function getReleases() {
  const fresh = Date.now() - cache.at < config.releaseCacheMinutes * 60_000;
  if (fresh) return cache.data;
  try {
    cache = { at: Date.now(), data: await load() };
  } catch (e) {
    console.warn('[site] релизы не получены:', e.message);
    cache = { at: Date.now() - (config.releaseCacheMinutes - 1) * 60_000, data: cache.data }; // повторим через минуту, старое не теряем
  }
  return cache.data;
}

module.exports = { getReleases };
