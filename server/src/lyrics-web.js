// Сайт текстов — одна страница (lyrics-web.html), разделы она открывает сама по адресу.
import fs from 'node:fs';

const FILE = new URL('./lyrics-web.html', import.meta.url);
let cached = null;

export function lyricsPage() {
  if (!cached || process.env.NODE_ENV !== 'production') cached = fs.readFileSync(FILE, 'utf8');
  return cached;
}
