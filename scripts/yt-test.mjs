// Диагностика потока YouTube без Electron: npm run yt-test -- <videoId>
// Перебирает тех же клиентов, что и приложение, и печатает, что ответил каждый.
import { YTMusicProvider } from '../src/main/providers/ytmusic.js';

const id = process.argv[2] || 'dQw4w9WgXcQ';
const yt = new YTMusicProvider();
const check = async (url, headers) => {
  try {
    const res = await fetch(url, { headers: { ...headers, Range: 'bytes=0-1' } });
    return res.status;
  } catch (e) {
    console.log('   сеть:', e.cause ? e.cause.code || e.cause.message : e.message);
    return 0;
  }
};

console.log(`Проверяю видео ${id}…`);
try {
  const r = await yt.streamUrl(id, check, (m) => console.log(' -', m));
  console.log(`\nИТОГ: работает через ${r.client}`);
} catch (e) {
  console.log('\nИТОГ: ни один клиент не дал рабочую ссылку');
  console.log(e.message);
}
