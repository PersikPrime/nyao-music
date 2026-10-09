// Центр обновлений: смотрит последний релиз на GitHub и скачивает установщик для этой системы.
import fs from 'node:fs';
import path from 'node:path';

export const REPO = 'PersikPrime/nyao-music';

/** v0.3.19 → { name: '0.3', build: 19 } */
export function parseTag(tag) {
  const m = /^v?(\d+\.\d+)\.(\d+)$/.exec(String(tag || '').trim());
  return m ? { name: m[1], build: Number(m[2]) } : null;
}

/** Подходящий файл релиза для текущей системы */
export function pickAsset(assets, platform = process.platform, arch = process.arch) {
  const list = assets || [];
  if (platform === 'win32') return list.find((a) => /win.*\.exe$/i.test(a.name));
  if (platform === 'darwin') {
    const want = arch === 'arm64' ? /arm64\.dmg$/i : /x64\.dmg$/i;
    return list.find((a) => want.test(a.name)) || list.find((a) => /\.dmg$/i.test(a.name));
  }
  return null;
}

export async function checkUpdate(current, fetchFn = globalThis.fetch) {
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NyaoMusic' }
  });
  if (res.status === 404) return { available: false, current, note: 'Релизов пока нет' };
  if (!res.ok) throw new Error(`GitHub ответил ${res.status} (репозиторий приватный или лимит запросов)`);
  const rel = await res.json();
  const latest = parseTag(rel.tag_name);
  const asset = pickAsset(rel.assets);
  return {
    current,
    latest: latest ? { ...latest, label: `${latest.name} (${latest.build})` } : null,
    available: !!latest && latest.build > current.build,
    notes: rel.body || '',
    url: rel.html_url,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null
  };
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
