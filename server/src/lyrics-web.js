// Сайт текстов — одна страница (lyrics-web.html), разделы она открывает сама по адресу.
import fs from 'node:fs';
import { LOGO_DATA } from './brand.js';

const FILE = new URL('./lyrics-web.html', import.meta.url);
let cached = null;

export function lyricsPage() {
  if (!cached || process.env.NODE_ENV !== 'production') cached = fs.readFileSync(FILE, 'utf8').replaceAll('%%LOGO%%', LOGO_DATA);
  return cached;
}
