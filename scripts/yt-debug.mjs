// Диагностика YouTube Music на раннере GitHub
import { YTMusicProvider } from '../src/main/providers/ytmusic.js';
const out = [];
const say = (s) => { out.push(s); };
const yt = new YTMusicProvider();
const step = async (name, fn) => {
  try {
    const r = await fn();
    say(`OK ${name}: ${JSON.stringify(r).slice(0, 160)}`);
    return r;
  } catch (e) {
    say(`ERR ${name}: ${e && e.message} @ ${(e && e.stack || '').split('\n').slice(1, 5).map((l) => l.trim().replace(/file:\/\/\/home\/runner\/work\/nyao-music\/nyao-music\//, '')).join(' | ')}`);
    return null;
  }
};
const sc = await step('streamClient', async () => { const c = await yt.streamClient(); return { player: !!(c.session && c.session.player), pid: c.session && c.session.player && c.session.player.player_id }; });
await step('stream', () => yt.streamUrl('fJ9rUzIMcZQ', async (url, headers) => { const r = await fetch(url, { headers: { ...headers, Range: 'bytes=0-1' } }); return r.status; }, (m) => say('  - ' + m)));
await step('home(anon)', async () => (await yt.home()).length);
await step('artist', async () => (await yt.artist('UCEPMVbUzImPl4p8k4LkGevA')).name);
await step('album', async () => (await yt.album('MPREb_eEpQf8QskKl')).tracks.length);
await step('playlistTracks', async () => (await yt.playlistTracks('yt:RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs')).length);
console.log('=====');
for (const l of out.filter((x) => !x.startsWith('  -'))) console.log('::notice::' + l.replace(/\n/g, ' '));
