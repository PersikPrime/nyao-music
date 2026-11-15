// Nyao Spotlight — нейросеть, которая по истории волны угадывает, что человеку понравится (только Nyao Music Red).
//
// Модель обучена отдельно (репозиторий nyao-spotlight-ml) на открытых данных ListenBrainz. Здесь она только считается:
// на JavaScript, без библиотек и без сервера — история прослушиваний не покидает компьютер.
// Пока модель работает «в тени»: волна играет как раньше, а мы записываем, что предложила бы модель,
// и потом сравниваем с тем, что человек дослушал или пролистал.
//
// Файлы модели (~70 МБ) скачиваются один раз из релиза spotlight-v1 на GitHub и сверяются по sha256.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const MODEL = 'spotlight-v1';
const BASE = `https://github.com/PersikPrime/nyao-music/releases/download/${MODEL}/`;
const JOURNAL_EVENTS = new Set(['trackStarted', 'trackFinished', 'skip', 'like', 'dislike']);
const FILES = ['manifest.json', 'weights.bin', 'vectors.i8.gz', 'scales.f32', 'vocab.tsv.gz'];

// ---------- ключ трека: те же правила, что в spotlight/keys.py (проверяется test/spotlight.test.js) ----------
const BRACKETS = /[([{][^)\]}]*(feat|ft\.|prod|remaster|version|edit|live)[^)\]}]*[)\]}]/giu;
const FEAT_TAIL = /(?<![\p{L}\p{N}_])(feat|ft)\.?\s.*$/iu;
const NON_WORD = /[^\p{L}\p{N}_]+/gu;
const SPLIT_ARTIST = /,|&|\s+(?:feat|ft)\.?\s+|\s+x\s+/iu;

export function norm(s) {
  let t = String(s ?? '').normalize('NFKD').toLowerCase().replace(/ё/g, 'е');
  t = t.replace(/\p{Mn}/gu, '');
  t = t.replace(BRACKETS, ' ').replace(FEAT_TAIL, ' ').replace(NON_WORD, ' ').replace(/_/g, ' ');
  return t.split(/\s+/).filter(Boolean).join(' ');
}
export const firstArtist = (artist) => String(artist ?? '').split(SPLIT_ARTIST)[0].trim();
export function trackKey(artist, title) {
  const a = norm(firstArtist(artist)), t = norm(title);
  return a && t ? `${a}|${t}` : '';
}
const TR = Object.fromEntries([...'абвгдежзийклмнопрстуфхцчшщъыьэюя'].map((ch, i) => [ch,
  ['a', 'b', 'v', 'g', 'd', 'e', 'zh', 'z', 'i', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u',
    'f', 'h', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya'][i]]));
const SIMPLE = [['ph', 'f'], ['kh', 'h'], ['ck', 'k'], ['w', 'v'], ['x', 'ks'], ['j', 'i'], ['y', 'i'], ['q', 'k'], ['c', 'k']];
/** «Кино» = «Kino», «Киркоров» = «Kirkorov»: латиница без различий в транслитерации */
export function soften(s) {
  let t = [...s].map(ch => TR[ch] ?? ch).join('');
  for (const [a, b] of SIMPLE) t = t.split(a).join(b);
  return t.replace(/([a-z])\1+/g, '$1');
}
export function looseKey(artist, title) {
  const k = trackKey(artist, title);
  if (!k) return '';
  const [a, t] = k.split('|');
  return `${soften(a)}|${soften(t)}`;
}

/** 52-битный хэш строки (два FNV-1a): столкновения на 500 тысячах ключей практически исключены */
export function hashKey(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a * 0x100000 + (b & 0xfffff);
}

// ---------- сама модель (SASRec: 2 слоя трансформера) ----------
const erf = (x) => { // Абрамовиц–Стиган, точность ~1e-7 — достаточно для GELU
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
};
const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));

function layerNorm(x, n, d, w, b, out) {
  for (let i = 0; i < n; i++) {
    const o = i * d;
    let mean = 0; for (let j = 0; j < d; j++) mean += x[o + j];
    mean /= d;
    let v = 0; for (let j = 0; j < d; j++) { const z = x[o + j] - mean; v += z * z; }
    const inv = 1 / Math.sqrt(v / d + 1e-5);
    for (let j = 0; j < d; j++) out[o + j] = (x[o + j] - mean) * inv * w[j] + b[j];
  }
}
/** y[n, outD] = x[n, inD] · Wᵀ + b; W хранится как [outD, inD] (как в PyTorch) */
function linear(x, n, inD, W, b, outD) {
  const y = new Float32Array(n * outD);
  for (let i = 0; i < n; i++) {
    const xo = i * inD;
    for (let r = 0; r < outD; r++) {
      const wo = r * inD;
      let s = b[r];
      for (let j = 0; j < inD; j++) s += x[xo + j] * W[wo + j];
      y[i * outD + r] = s;
    }
  }
  return y;
}

export class SpotlightModel {
  /** files: { manifest, weights: Buffer, vectors: Buffer(int8), scales: Buffer, vocab: Buffer (utf-8 tsv) } */
  constructor({ manifest, weights, vectors, scales, vocab }) {
    this.m = manifest;
    const all = new Float32Array(weights.buffer, weights.byteOffset, weights.byteLength / 4);
    this.w = {};
    for (const t of manifest.tensors) this.w[t.name] = all.subarray(t.offset, t.offset + t.shape.reduce((a, b) => a * b, 1));
    this.vectors = new Int8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength);
    this.scales = new Float32Array(scales.buffer.slice(scales.byteOffset, scales.byteOffset + scales.byteLength));
    // словарь держим как есть (utf-8) + начала строк, названия достаём по запросу; ключи — числовые хэши:
    // так 500 тысяч треков занимают десятки мегабайт, а не сотни
    this.vocab = vocab;
    this.lines = new Int32Array(manifest.items + 2);
    this.byKey = new Map();
    let pos = 0;
    while (pos < vocab.length) {
      let end = vocab.indexOf(10, pos);
      if (end < 0) end = vocab.length;
      const tab1 = vocab.indexOf(9, pos), tab2 = vocab.indexOf(9, tab1 + 1);
      const n = Number(vocab.toString('latin1', pos, tab1));
      if (n > 0 && n <= manifest.items) {
        this.lines[n] = pos;
        const [a, t = ''] = vocab.toString('utf8', tab1 + 1, tab2).split('|');
        const h = hashKey(`${soften(a)}|${soften(t)}`);
        if (!this.byKey.has(h)) this.byKey.set(h, n); // id идут по популярности — при дубле берём популярный
      }
      pos = end + 1;
    }
  }
  name(id) {
    if (!id || !this.lines[id]) return '';
    const start = this.lines[id];
    let end = this.vocab.indexOf(10, start);
    if (end < 0) end = this.vocab.length;
    const [, , artist, title] = this.vocab.toString('utf8', start, end).split('\t');
    return `${artist} — ${title}`;
  }
  idOf(track) { const k = looseKey(track?.artist, track?.title); return k ? this.byKey.get(hashKey(k)) || 0 : 0; }
  vector(id, out, scale = 1) {
    const d = this.m.dim, o = id * d, s = this.scales[id] * scale;
    for (let j = 0; j < d; j++) out[j] = this.vectors[o + j] * s;
  }
  /**
   * «Вектор вкуса» по истории (id треков, старые → новые). Пустые позиции слева на настоящие треки не влияют,
   * поэтому считаем только настоящие — так же, как PyTorch с маской.
   */
  taste(ids) {
    const { dim: d, len: L, heads: H } = this.m;
    const hist = ids.filter(Boolean).slice(-L);
    const n = hist.length;
    if (!n) return null;
    const w = this.w, hd = d / H, sq = Math.sqrt(d);
    let x = new Float32Array(n * d);
    const row = new Float32Array(d);
    for (let i = 0; i < n; i++) {
      this.vector(hist[i], row);
      const p = (L - n + i) * d; // позиция в окне длины L, история прижата вправо
      for (let j = 0; j < d; j++) x[i * d + j] = row[j] * sq + w['pos.weight'][p + j];
    }
    const h = new Float32Array(n * d);
    const scores = new Float32Array(n);
    for (let l = 0; l < this.m.layers; l++) {
      const p = (k) => w[`encoder.layers.${l}.${k}`];
      layerNorm(x, n, d, p('norm1.weight'), p('norm1.bias'), h);
      const qkv = linear(h, n, d, p('self_attn.in_proj_weight'), p('self_attn.in_proj_bias'), 3 * d);
      const att = new Float32Array(n * d);
      for (let hh = 0; hh < H; hh++) {
        const off = hh * hd;
        for (let i = 0; i < n; i++) {
          let max = -Infinity;
          for (let j = 0; j <= i; j++) { // причинная маска: только прошлое и сам трек
            let s = 0;
            for (let k = 0; k < hd; k++) s += qkv[i * 3 * d + off + k] * qkv[j * 3 * d + d + off + k];
            s /= Math.sqrt(hd);
            scores[j] = s; if (s > max) max = s;
          }
          let sum = 0;
          for (let j = 0; j <= i; j++) { scores[j] = Math.exp(scores[j] - max); sum += scores[j]; }
          for (let j = 0; j <= i; j++) {
            const a = scores[j] / sum;
            for (let k = 0; k < hd; k++) att[i * d + off + k] += a * qkv[j * 3 * d + 2 * d + off + k];
          }
        }
      }
      const o = linear(att, n, d, p('self_attn.out_proj.weight'), p('self_attn.out_proj.bias'), d);
      for (let i = 0; i < n * d; i++) x[i] += o[i];
      layerNorm(x, n, d, p('norm2.weight'), p('norm2.bias'), h);
      const f = linear(h, n, d, p('linear1.weight'), p('linear1.bias'), 4 * d);
      for (let i = 0; i < f.length; i++) f[i] = gelu(f[i]);
      const g = linear(f, n, 4 * d, p('linear2.weight'), p('linear2.bias'), d);
      for (let i = 0; i < n * d; i++) x[i] += g[i];
    }
    const last = x.subarray((n - 1) * d, n * d);
    const out = new Float32Array(d);
    layerNorm(last, 1, d, w['norm.weight'], w['norm.bias'], out);
    return out;
  }
  /** Лучшие k треков для вектора вкуса, кроме exclude (Set id). → [{ id, score }] по убыванию */
  top(taste, k = 200, exclude = new Set()) {
    const d = this.m.dim, N = this.m.items;
    const ids = new Int32Array(k).fill(-1), sc = new Float32Array(k).fill(-Infinity);
    let minAt = 0;
    for (let id = 1; id <= N; id++) {
      const o = id * d;
      let s = 0;
      for (let j = 0; j < d; j++) s += this.vectors[o + j] * taste[j];
      s *= this.scales[id];
      if (s <= sc[minAt] || exclude.has(id)) continue;
      sc[minAt] = s; ids[minAt] = id;
      for (let i = 0; i < k; i++) if (sc[i] < sc[minAt]) minAt = i;
    }
    return [...ids].map((id, i) => ({ id, score: sc[i] })).filter(x => x.id > 0).sort((a, b) => b.score - a.score);
  }
}

export function loadModel(dir) {
  const read = (f) => fs.readFileSync(path.join(dir, f));
  return new SpotlightModel({
    manifest: JSON.parse(read('manifest.json').toString('utf8')),
    weights: read('weights.bin'),
    vectors: zlib.gunzipSync(read('vectors.i8.gz')),
    scales: read('scales.f32'),
    vocab: zlib.gunzipSync(read('vocab.tsv.gz'))
  });
}

// ---------- скачивание и тень ----------
const sha256 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

export class Spotlight {
  constructor({ dir, fetch = globalThis.fetch, log = () => {}, base = BASE }) {
    Object.assign(this, { dir: path.join(dir, MODEL), fetch, log, base });
    this.model = null;
    this.state = 'idle'; // idle → downloading → loading → ready | error
    this.progress = 0;
    this.error = '';
    this.pending = null; // трек, который играет сейчас: что о нём думала модель
    this.cache = { sig: '', top: [] };
    this.logFile = path.join(dir, 'spotlight-shadow.jsonl');
    this.journalFile = path.join(dir, 'wave-journal.jsonl');
    this.reset();
  }
  reset() { this.stats = { judged: 0, unknown: 0, inTop: { n: 0, skipped: 0 }, outTop: { n: 0, skipped: 0 }, ranks: [] }; }
  status() {
    const suggest = this.cache.top.slice(0, 5).map(x => this.model?.name(x.id)).filter(Boolean);
    return { state: this.state, progress: this.progress, error: this.error, ...this.stats, ranks: undefined, medianRank: median(this.stats.ranks), suggest };
  }
  /** Скачать (если нужно) и загрузить модель. Повторные вызовы ждут того же. */
  ensure() {
    if (this.model || this.loading) return this.loading || Promise.resolve(this.model);
    this.loading = this.prepare().catch((e) => { this.state = 'error'; this.error = String(e.message || e); this.log(`[spotlight] ${this.error}`); return null; })
      .finally(() => { this.loading = null; });
    return this.loading;
  }
  async prepare() {
    fs.mkdirSync(this.dir, { recursive: true });
    const mf = path.join(this.dir, 'manifest.json');
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { /* ещё не скачано */ }
    const ok = (f, info) => { try { return fs.statSync(path.join(this.dir, f)).size === info.size; } catch { return false; } };
    if (!manifest || !Object.entries(manifest.files).every(([f, info]) => ok(f, info))) {
      this.state = 'downloading';
      await this.download('manifest.json');
      manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
      const total = Object.values(manifest.files).reduce((a, f) => a + f.size, 0);
      let done = 0;
      for (const [f, info] of Object.entries(manifest.files)) {
        if (!ok(f, info) || (await sha256(path.join(this.dir, f))) !== info.sha256) {
          await this.download(f, (n) => { this.progress = Math.round(((done + n) / total) * 100); });
          if ((await sha256(path.join(this.dir, f))) !== info.sha256) { fs.rmSync(path.join(this.dir, f), { force: true }); throw new Error(`${f}: не сошлась контрольная сумма`); }
        }
        done += info.size;
      }
    }
    this.state = 'loading';
    this.model = loadModel(this.dir);
    this.state = 'ready';
    this.progress = 100;
    this.log(`[spotlight] модель ${manifest.name}: ${manifest.items} треков`);
    return this.model;
  }
  async download(f, onProgress = () => {}) {
    const res = await this.fetch(this.base + f, { redirect: 'follow', headers: { 'User-Agent': 'NyaoMusic' } });
    if (!res.ok || !res.body) throw new Error(`скачивание ${f}: ${res.status}`);
    const tmp = path.join(this.dir, f + '.part');
    const out = fs.createWriteStream(tmp);
    let n = 0;
    for await (const chunk of res.body) {
      n += chunk.length; onProgress(n);
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    }
    await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    fs.renameSync(tmp, path.join(this.dir, f));
  }
  /** Что предложила бы модель сейчас. played — история волны, свежие сверху (как в wave-profile.json) */
  suggest(played) {
    const m = this.model;
    if (!m) return [];
    const ids = played.slice().reverse().map(p => m.idOf(p.track)).filter(Boolean);
    const sig = ids.slice(-60).join(',');
    if (sig === this.cache.sig) return this.cache.top;
    const taste = m.taste(ids);
    // недавно игравшее не предлагаем — как в волне и при обучении
    const top = taste ? m.top(taste, 200, new Set(ids.slice(-50))) : [];
    this.cache = { sig, top };
    return top;
  }
  /**
   * Свой набор данных: что играло в волне и чем закончилось — в том же виде, что открытые данные для обучения.
   * Только на этом компьютере (wave-journal.jsonl): без токенов и аккаунтов, только трек и реакция.
   * Отправлять куда-то — отдельное решение, по галочке; сейчас файл никуда не уходит.
   */
  journal(type, track, seconds = 0) {
    if (!track || !JOURNAL_EVENTS.has(type)) return;
    const key = trackKey(track.artist, track.title);
    if (!key) return;
    const e = { at: Date.now(), type, key, artist: track.artist, title: track.title, source: track.source || '', reason: track.waveReason || '' };
    if (type === 'skip' || type === 'trackFinished') e.seconds = Math.round(seconds || 0);
    if (track.duration) e.duration = Math.round(track.duration);
    this.journalWrites = (this.journalWrites || 0) + 1;
    fs.promises.appendFile(this.journalFile, JSON.stringify(e) + '\n')
      .then(() => { if (this.journalWrites % 200 === 0) return this.trimJournal(); })
      .catch(() => {});
  }
  /** Не даём файлу расти бесконечно: держим последние ~100 тысяч событий (это годы прослушиваний) */
  async trimJournal() {
    const st = await fs.promises.stat(this.journalFile);
    if (st.size < 40 * 1024 * 1024) return;
    const lines = (await fs.promises.readFile(this.journalFile, 'utf8')).split('\n').filter(Boolean);
    await fs.promises.writeFile(this.journalFile + '.tmp', lines.slice(-100000).join('\n') + '\n');
    await fs.promises.rename(this.journalFile + '.tmp', this.journalFile);
  }
  rank(p) {
    if (p.rank !== null) return;
    const top = this.suggest(p.history);
    p.rank = p.id ? top.findIndex(x => x.id === p.id) + 1 : 0;
    p.history = null;
  }
  /**
   * Тень: на старте трека запоминаем, где он был в топе модели; на финише или скипе — записываем итог.
   * played — история до этого трека.
   */
  observe(type, track, played, seconds) {
    this.journal(type, track, seconds);
    if (!this.model || !track) return;
    if (type === 'trackStarted') {
      const id = this.model.idOf(track);
      const p = { key: looseKey(track.artist, track.title), id, rank: null, history: played.slice(0, 300), reason: track.waveReason || '', source: track.source || '' };
      this.pending = p;
      // расчёт занимает доли секунды — не на старте трека, чтобы не задерживать воспроизведение
      setTimeout(() => this.rank(p), 1500).unref?.();
      return;
    }
    const p = this.pending;
    if (!p || p.key !== looseKey(track.artist, track.title)) return;
    if (type !== 'trackFinished' && type !== 'skip' && type !== 'dislike') return;
    this.pending = null;
    this.rank(p);
    const skipped = type === 'dislike' || (type === 'skip' && seconds < 30);
    const st = this.stats;
    if (!p.id) st.unknown++;
    else {
      st.judged++;
      const b = p.rank ? st.inTop : st.outTop;
      b.n++; if (skipped) b.skipped++;
      if (p.rank) st.ranks = [...st.ranks.slice(-199), p.rank];
    }
    const line = JSON.stringify({ at: Date.now(), model: MODEL, known: !!p.id, rank: p.rank || null, skipped, reason: p.reason, source: p.source });
    fs.promises.appendFile(this.logFile, line + '\n').catch(() => {});
  }
}
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
