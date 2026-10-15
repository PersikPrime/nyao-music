// Диагностика YouTube Music на раннере GitHub: поиск, исполнитель, поток — с полными стеками ошибок
import { YTMusicProvider } from '../src/main/providers/ytmusic.js';
const yt = new YTMusicProvider();
const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`OK  ${name}:`, JSON.stringify(r).slice(0, 300));
    return r;
  } catch (e) {
    console.log(`ERR ${name}:`, e && e.stack);
    return null;
  }
};
const c = await step('client', async () => { const x = await yt.client(); return !!x; });
const s = await step('search', () => yt.search('Queen Bohemian Rhapsody'));
await step('searchArtist', () => yt.searchArtist('Queen'));
const id = (s && s[0] && s[0].srcId) || 'fJ9rUzIMcZQ';
await step('radio', () => yt.radio(id));
await step('stream', () => yt.streamUrl(id, async (url, headers) => { const r = await fetch(url, { headers: { ...headers, Range: 'bytes=0-1' } }); return r.status; }, (m) => console.log('   -', m)));
