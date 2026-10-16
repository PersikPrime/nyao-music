// Запасной разбор сырых ответов YouTube Music «поиском по дереву» — как в Android-версии.
// Нужен, когда youtubei.js падает на новой разметке (например «Cannot read properties of undefined
// (reading 'url')» на плейлистах у вошедших пользователей): ищем renderer'ы где угодно в ответе,
// а если их нет совсем (YouTube переводит страницы на *ViewModel) — угадываем треки по videoId.

const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;
const TYPE_WORDS = new Set(['Песня', 'Song', 'Видео', 'Video', 'Трек', 'Эпизод', 'Episode']);

export function findAll(node, key, out = []) {
  if (Array.isArray(node)) for (const v of node) findAll(v, key, out);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
      else findAll(v, key, out);
    }
  }
  return out;
}

export function firstString(node, key) {
  if (Array.isArray(node)) {
    for (const v of node) {
      const s = firstString(v, key);
      if (s) return s;
    }
  } else if (node && typeof node === 'object') {
    if (typeof node[key] === 'string') return node[key];
    for (const v of Object.values(node)) {
      const s = firstString(v, key);
      if (s) return s;
    }
  }
  return null;
}

export function runsText(o) {
  if (!o) return '';
  if (typeof o === 'string') return o;
  if (typeof o.simpleText === 'string') return o.simpleText;
  if (typeof o.content === 'string') return o.content;
  return (o.runs || []).map((r) => (r && r.text) || '').join('');
}

const browseId = (run) => run && run.navigationEndpoint && run.navigationEndpoint.browseEndpoint && run.navigationEndpoint.browseEndpoint.browseId;

export function bigThumb(url, size = 400) {
  if (typeof url !== 'string' || !url) return null;
  const u = url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
  return u.startsWith('//') ? 'https:' + u : u;
}

// Самая большая картинка из любых thumbnails/sources внутри узла
export function thumbIn(node, size = 400) {
  if (!node) return null;
  const all = [];
  const walk = (n, depth) => {
    if (depth > 12 || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((v) => walk(v, depth + 1));
    if (typeof n.url === 'string' && /^(https?:)?\/\//.test(n.url) && /(ytimg|ggpht|googleusercontent)/.test(n.url)) all.push(n);
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(node, 0);
  if (!all.length) return null;
  all.sort((a, b) => (b.width || 0) - (a.width || 0));
  return bigThumb(all[0].url, size);
}

function parseDuration(s) {
  if (!TIME.test(s || '')) return 0;
  return s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
}

function track(videoId, { title, artist, artistId, album, albumId, duration, cover }) {
  return {
    id: `yt:${videoId}`,
    source: 'yt',
    srcId: videoId,
    artistRef: artistId ? `yt:${artistId}` : null,
    albumRef: albumId ? `yt:${albumId}` : null,
    title: title || 'Без названия',
    artist: artist || 'YouTube Music',
    album: album || '',
    duration: duration || 0,
    cover: cover || null,
    available: true
  };
}

export function mapResponsive(r) {
  const cols = (r.flexColumns || []).map((c) => c && c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text);
  if (!cols.length) return null;
  const videoId = (r.playlistItemData && r.playlistItemData.videoId) || (r.overlay && firstString(r.overlay, 'videoId')) || (cols[0] && firstString(cols[0], 'videoId'));
  if (!videoId) return null;
  const runs = cols.slice(1).flatMap((c) => (c && c.runs) || []);
  const artistRuns = runs.filter((x) => String(browseId(x) || '').startsWith('UC'));
  const albumRun = runs.find((x) => String(browseId(x) || '').startsWith('MPRE'));
  const plain = runs.map((x) => String(x.text || '').trim()).filter((t) => t && t !== '•' && !TYPE_WORDS.has(t) && !TIME.test(t) && !/просмотр|views/.test(t));
  const fixed = r.fixedColumns && r.fixedColumns[0] && r.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer;
  const dur = runsText(fixed && fixed.text) || runs.map((x) => String(x.text || '').trim()).find((t) => TIME.test(t)) || '';
  return track(videoId, {
    title: runsText(cols[0]),
    artist: artistRuns.map((x) => x.text).join(', ') || plain[0],
    artistId: artistRuns.length ? browseId(artistRuns[0]) : null,
    album: albumRun && albumRun.text,
    albumId: albumRun && browseId(albumRun),
    duration: parseDuration(dur),
    cover: thumbIn(r.thumbnail)
  });
}

export function mapPanel(p) {
  if (!p.videoId) return null;
  const runs = (p.longBylineText && p.longBylineText.runs) || [];
  const artistRuns = runs.filter((x) => String(browseId(x) || '').startsWith('UC'));
  const albumRun = runs.find((x) => String(browseId(x) || '').startsWith('MPRE'));
  return track(p.videoId, {
    title: runsText(p.title),
    artist: artistRuns.map((x) => x.text).join(', ') || (runs[0] && runs[0].text),
    artistId: artistRuns.length ? browseId(artistRuns[0]) : null,
    album: albumRun && albumRun.text,
    albumId: albumRun && browseId(albumRun),
    duration: parseDuration(runsText(p.lengthText)),
    cover: thumbIn(p.thumbnail)
  });
}

// Все videoId в поддереве (watchEndpoint / playlistItemData / videoId-поле)
function videoIds(node, out = new Set(), depth = 0) {
  if (depth > 30 || !node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const v of node) videoIds(v, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'videoId' && typeof v === 'string' && /^[\w-]{11}$/.test(v)) out.add(v);
    else if (v && typeof v === 'object') videoIds(v, out, depth + 1);
  }
  return out;
}

// Тексты элемента по порядку: runs/simpleText/content (так устроены и renderer'ы, и *ViewModel)
function texts(node, out = [], depth = 0) {
  if (depth > 14 || !node || typeof node !== 'object' || out.length > 8) return out;
  if (Array.isArray(node)) {
    for (const v of node) texts(v, out, depth + 1);
    return out;
  }
  if (Array.isArray(node.runs)) {
    out.push({ text: runsText(node), runs: node.runs });
    return out;
  }
  if (typeof node.simpleText === 'string') {
    out.push({ text: node.simpleText, runs: [] });
    return out;
  }
  if (typeof node.content === 'string') {
    out.push({ text: node.content, runs: node.commandRuns || [] });
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (/accessibility|menu|overlay|badge|tooltip|label$/i.test(k)) continue;
    texts(v, out, depth + 1);
  }
  return out;
}

// Последний шанс: незнакомая разметка. Элемент списка с ровно одним videoId — это трек.
export function guessTracks(root) {
  const out = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (depth > 40 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length >= 1 && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        for (const el of node) {
          const ids = videoIds(el);
          if (ids.size === 1) {
            const id = [...ids][0];
            if (seen.has(id)) continue;
            const ts = texts(el).filter((t) => t.text && t.text.trim() && t.text !== '•');
            if (!ts.length) continue;
            seen.add(id);
            const sub = ts.slice(1).map((t) => t.text).filter((t) => !TIME.test(t.trim()));
            const parts = (sub[0] || '').split(/\s*•\s*/).filter((p) => p && !TIME.test(p) && !TYPE_WORDS.has(p) && !/просмотр|views/.test(p));
            const dur = ts.map((t) => t.text.trim()).find((t) => TIME.test(t)) || '';
            out.push(track(id, { title: ts[0].text, artist: parts[0], album: parts[1], duration: parseDuration(dur), cover: thumbIn(el) }));
            continue;
          }
          walk(el, depth + 1);
        }
        return;
      }
      for (const v of node) walk(v, depth + 1);
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(root, 0);
  return out;
}

export function tracksIn(root) {
  const map = new Map();
  for (const r of findAll(root, 'musicResponsiveListItemRenderer')) {
    const t = mapResponsive(r);
    if (t && !map.has(t.id)) map.set(t.id, t);
  }
  for (const p of findAll(root, 'playlistPanelVideoRenderer')) {
    const t = mapPanel(p);
    if (t && !map.has(t.id)) map.set(t.id, t);
  }
  if (map.size) return [...map.values()];
  return guessTracks(root);
}

export function continuationOf(root) {
  const cmd = findAll(root, 'continuationCommand')[0];
  if (cmd && cmd.token) return { token: cmd.token };
  const legacy = findAll(root, 'nextContinuationData')[0];
  if (legacy && legacy.continuation) return { legacy: legacy.continuation };
  return null;
}

// Плейлисты из библиотеки / полок главной
export function mapTwoRow(i) {
  const nav = i.navigationEndpoint || {};
  const title = runsText(i.title);
  const sub = runsText(i.subtitle);
  const cover = thumbIn(i.thumbnailRenderer, 300);
  const bid = nav.browseEndpoint && nav.browseEndpoint.browseId;
  if (!bid || bid.startsWith('UC')) return null;
  return { id: `yt:${String(bid).replace(/^VL/, '')}`, source: 'yt', title, sub, cover, kind: bid.startsWith('MPRE') ? 'album' : 'playlist' };
}

// Форма ответа для отчёта: только имена ключей и типы, без значений (никаких имён, почты, токенов)
export function shapeOf(node, depth = 0, maxDepth = 9) {
  if (node == null) return null;
  if (Array.isArray(node)) {
    if (depth >= maxDepth) return `[${node.length}]`;
    const head = node.slice(0, 2).map((v) => shapeOf(v, depth + 1, maxDepth));
    return node.length > 2 ? [...head, `…+${node.length - 2}`] : head;
  }
  if (typeof node === 'object') {
    if (depth >= maxDepth) return `{${Object.keys(node).length}}`;
    const o = {};
    for (const [k, v] of Object.entries(node)) {
      if (/^(trackingParams|clickTrackingParams|loggingDirectives|responseContext|frameworkUpdates)$/.test(k)) continue;
      o[k] = shapeOf(v, depth + 1, maxDepth);
    }
    return o;
  }
  return typeof node;
}
