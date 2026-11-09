import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveRadio, mapStation, mapOnAir, parseMedia, yaImage, yaTrackId } from '../src/main/live-radio.js';

// MPEG-TS из одного аудио-PES (AAC): PAT → PMT → PES. Хватает, чтобы demuxTs узнал TS
function tsSegment(payload) {
  const pkt = (pid, body, start = true) => {
    const b = Buffer.alloc(188, 0xff);
    b[0] = 0x47; b[1] = (start ? 0x40 : 0) | ((pid >> 8) & 0x1f); b[2] = pid & 0xff; b[3] = 0x10;
    body.copy(b, 4);
    return b;
  };
  const pat = Buffer.from([0, 0x00, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0x00, 0, 0, 0, 0]);
  const pmt = Buffer.from([0, 0x02, 0xb0, 0x12, 0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0, 0x0f, 0xe1, 0x00, 0xf0, 0, 0, 0, 0, 0]);
  const pes = Buffer.concat([Buffer.from([0, 0, 1, 0xc0, 0, 0, 0x80, 0, 0]), payload]);
  return Buffer.concat([pkt(0, pat), pkt(0x1000, pmt), pkt(0x100, pes)]);
}

test('радио: картинки, id трека, станция и «сейчас звучит»', () => {
  assert.equal(yaImage('avatars.yandex.net/get-music-content/1/a/%%'), 'https://avatars.yandex.net/get-music-content/1/a/400x400');
  assert.equal(yaTrackId('https://music.yandex.ru/album/11406572/track/48173657?campaign_id=yandex-radio'), '48173657');
  const st = mapStation({
    slug: 'europa-plus', name: 'Европа Плюс',
    cardInfo: { logo: 'https://avatars.mds.yandex.net/x/%%', logoBackgroundColor: '#1B3FA6', shortDescription: 'Только хиты' },
    genres: [{ slug: 'pop' }], listeners: { count: 8412 },
    streams: [{ slug: 'europa-plus-moscow', compactName: 'Москва' }, { slug: 'europa-plus-russia', compactName: 'Россия' }],
    userDefaultStreamSlug: 'europa-plus-moscow',
  });
  assert.deepEqual([st.desc, st.listeners, st.stream, st.streams[1].name, st.genres[0]], ['Только хиты', 8412, 'europa-plus-moscow', 'Россия', 'pop']);
  assert.ok(st.logo.endsWith('/400x400'));
  const a = mapOnAir({ timestamp: 1793898827, track: { title: 'Dancing With A Stranger', artist: 'Sam Smith, Normani', yaMusicUrl: 'https://music.yandex.ru/album/1/track/48173657', yandexCover: 'avatars.yandex.net/c/%%' } });
  assert.deepEqual([a.yaId, a.at, a.cover.startsWith('https://')], ['48173657', 1793898827000, true]);
});

test('радио: разбор живого плейлиста HLS', () => {
  const pl = parseMedia('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:40\n#EXTINF:6,\na.ts\n#EXTINF:6,\nb.ts?x=1\n', 'https://h.example/live/112/playlist.m3u8');
  assert.deepEqual(pl.segs.map((x) => [x.seq, x.url]), [[40, 'https://h.example/live/112/a.ts'], [41, 'https://h.example/live/112/b.ts?x=1']]);
  assert.equal(pl.target, 6);
  assert.equal(pl.ended, false);
  assert.equal(parseMedia('#EXT-X-KEY:METHOD=AES-128,URI="k"\n', 'https://h/').encrypted, true);
});

test('радио: станции со всех страниц, популярные первыми', async () => {
  const pages = {
    '': { stations: [{ slug: 'a', name: 'A', listeners: { count: 5 } }], hasNext: true, continueFrom: 'p2' },
    p2: { stations: [{ slug: 'b', name: 'B', listeners: { count: 50 } }], hasNext: false },
  };
  const r = new LiveRadio({ fetch: async (url) => ({ ok: true, json: async () => pages[new URL(url).searchParams.get('continueFrom') || ''] }) });
  const list = await r.stations();
  assert.deepEqual(list.map((x) => x.slug), ['b', 'a']);
});

test('радио: эфир — бесконечный поток распакованных кусков, новые докачиваются', async () => {
  let n = 0; // сколько раз спросили медиа-плейлист: каждый раз эфир «сдвигается» на кусок
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/url')) return { ok: true, json: async () => ({ url: 'https://live.example/master.m3u8' }) };
    if (u.pathname === '/master.m3u8') return { ok: true, text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n112/pl.m3u8\n' };
    if (u.pathname === '/112/pl.m3u8') {
      const first = 10 + n++;
      const segs = [0, 1, 2].map((i) => `#EXTINF:1,\ns${first + i}.ts`).join('\n');
      return { ok: true, text: async () => `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${first}\n${segs}\n` };
    }
    const m = /s(\d+)\.ts$/.exec(u.pathname);
    if (m) return { ok: true, arrayBuffer: async () => tsSegment(Buffer.from(`[${m[1]}]`)) };
    return { ok: false, status: 404 };
  };
  const r = new LiveRadio({ fetch });
  const res = await r.response('st', 'st-moscow');
  assert.equal(res.headers.get('content-type'), 'audio/aac');
  const reader = res.body.getReader();
  let got = '';
  while (!got.includes('[13]')) got += Buffer.from((await reader.read()).value).toString('latin1');
  await reader.cancel();
  // три последних куска (10–12) сразу, дальше — новый 13-й, без повторов
  assert.deepEqual(got.match(/\[\d+\]/g), ['[10]', '[11]', '[12]', '[13]']);
});
