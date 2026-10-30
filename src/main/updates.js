// Центр обновлений: смотрит последний релиз (зеркало на сервере Nyao или GitHub) и скачивает установщик для этой системы.
import fs from 'node:fs';
import path from 'node:path';

export const REPO = 'PersikPrime/nyao-music';

/** v0.3.19 → { name: '0.3', build: 19 }; v0.8.89-dev → { name: '0.8', build: 89, channel: 'dev' } */
export function parseTag(tag) {
  const m = /^v?(\d+\.\d+)\.(\d+)(?:-([a-z]+))?$/.exec(String(tag || '').trim());
  return m ? { name: m[1], build: Number(m[2]), ...(m[3] ? { channel: m[3] } : {}) } : null;
}

/** Пакет горячего обновления в релизе: NyaoMusic-0.8.89-app-<compat>.nui и подпись к нему */
export function pickHotAsset(assets, compat) {
  const list = assets || [];
  const nui = list.find((a) => a.name.endsWith(`-app-${compat}.nui`));
  const sig = nui && list.find((a) => a.name === `${nui.name}.sig`);
  if (!nui || !sig) return null;
  const out = { name: nui.name, url: nui.browser_download_url, size: nui.size, sigUrl: sig.browser_download_url };
  // зеркало отдаёт и адрес на GitHub — запасной путь, если на зеркале файлы разошлись
  if (nui.github_url && sig.github_url) Object.assign(out, { githubUrl: nui.github_url, githubSigUrl: sig.github_url });
  return out;
}

/** Подходящий файл релиза для текущей системы */
export function pickAsset(assets, platform = process.platform, arch = process.arch, tag = '') {
  let list = assets || [];
  const v = parseTag(tag);
  // файлы именно этой сборки — если в релиз случайно попали чужие
  if (v) {
    const own = list.filter((a) => a.name.includes(`${v.name}.${v.build}`));
    if (own.length) list = own;
  }
  if (platform === 'win32') return list.find((a) => /win.*\.exe$/i.test(a.name));
  if (platform === 'darwin') {
    const want = arch === 'arm64' ? /arm64\.dmg$/i : /x64\.dmg$/i;
    return list.find((a) => want.test(a.name)) || list.find((a) => /\.dmg$/i.test(a.name));
  }
  return null;
}

export const MIRROR = 'https://api.music.withnyao.app/updates/latest';
const LEGACY_MIRROR = 'https://api.nmusic.bixtl.cc/updates/latest';

/** Сначала зеркало на сервере Nyao (быстрее из РФ; новый адрес, потом прежний), если оно молчит — GitHub */
async function latestRelease(fetchFn, channel = null) {
  const q = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  for (const base of [MIRROR, LEGACY_MIRROR]) {
    const url = base + q;
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'NyaoMusic' }, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const rel = await res.json();
        if (rel && rel.tag_name) return rel;
      }
    } catch {
      // сервер недоступен — не беда
    }
  }
  if (channel) {
    // GitHub напрямую: последний пререлиз канала из списка
    const res = await fetchFn(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NyaoMusic' }
    });
    if (res.ok) {
      const list = await res.json();
      const own = (Array.isArray(list) ? list : []).filter((r) => !r.draft && parseTag(r.tag_name)?.channel === channel);
      own.sort((a, b) => parseTag(b.tag_name).build - parseTag(a.tag_name).build);
      // обычный релиз новее пререлиза канала — берём его
      const stable = (Array.isArray(list) ? list : []).find((r) => !r.draft && !r.prerelease && parseTag(r.tag_name) && !parseTag(r.tag_name).channel);
      if (own[0] && (!stable || parseTag(own[0].tag_name).build > parseTag(stable.tag_name).build)) return own[0];
      if (stable) return stable;
    }
  }
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NyaoMusic' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ответил ${res.status} (репозиторий приватный или лимит запросов)`);
  return res.json();
}

/**
 * current — { name, build, channel? }; channel берётся из version.json (dev/nightly смотрят свои пререлизы).
 * compat — совместимость установленного приложения: если в релизе есть пакет с тем же compat, можно обновиться горячо.
 */
export async function checkUpdate(current, fetchFn = globalThis.fetch, { compat = null } = {}) {
  const rel = await latestRelease(fetchFn, current.channel || null);
  if (!rel) return { available: false, current, note: 'Релизов пока нет' };
  const latest = parseTag(rel.tag_name);
  const asset = pickAsset(rel.assets, process.platform, process.arch, rel.tag_name);
  // сервер Nyao может потребовать обновиться: сборки ниже min_build дальше не пускаем
  const minBuild = Number(rel.min_build) || 0;
  const publicName = /^Nyao Music (\d+\.\d+\.\d+(?:\.\d+)?)(?:\s|$)/.exec(rel.name || '')?.[1];
  return {
    current,
    latest: latest ? { ...latest, label: publicName || `${latest.name} (${latest.build})` } : null,
    available: !!latest && latest.build > current.build,
    required: minBuild > 0 && current.build < minBuild && !!latest && latest.build >= minBuild,
    minBuild,
    notes: rel.body || '',
    url: rel.html_url,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
    hot: compat ? pickHotAsset(rel.assets, compat) : null
  };
}

/** Пакет горячего обновления целиком в память (он маленький, ~1 МБ) */
export async function fetchHot(hot, fetchFn = globalThis.fetch) {
  const get = async (url) => {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'NyaoMusic' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Не удалось скачать: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const [buf, sig] = await Promise.all([get(hot.url), get(hot.sigUrl)]);
  return { buf, sig: sig.toString('utf8') };
}

/** Качает установщик в «Загрузки», сообщая прогресс 0..1 */
export async function downloadAsset(asset, dir, onProgress, fetchFn = globalThis.fetch) {
  const res = await fetchFn(asset.url, { headers: { 'User-Agent': 'NyaoMusic' } });
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const file = path.join(dir, asset.name);
  const out = fs.createWriteStream(file);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    if (total) onProgress(got / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  return file;
}
