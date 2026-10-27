// Точка входа. Если в папке данных стоит проверенное горячее обновление кода (см. main/hot.js) — запускаем его,
// иначе код из установки. Библиотеки (youtubei.js) всегда из установки: горячий код получает их через globalThis.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HotStore, bundledCompat } from './main/hot.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
globalThis.__nyaoBundledRoot = ROOT;
globalThis.__nyaoDeps = { youtubei: await import('youtubei.js') };

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
let hot = null;
try {
  const pkg = readJson('package.json');
  const ver = readJson('version.json');
  const compat = bundledCompat(ROOT, pkg);
  let publicPem = null;
  try {
    publicPem = fs.readFileSync(path.join(ROOT, 'src', 'main', 'hot-key.pem'), 'utf8');
  } catch {
    // ключа нет — горячие обновления в этой сборке выключены
  }
  // в разработке (electron .) горячий код не подхватываем, если явно не попросили NYAO_HOT=1
  const allowed = (app.isPackaged || process.env.NYAO_HOT === '1') && !process.argv.includes('--no-hot');
  const store = new HotStore({ dir: path.join(app.getPath('userData'), 'hot'), publicPem: allowed ? publicPem : null, bundled: { build: ver.build, compat } });
  hot = { store, bundled: { name: ver.name, build: ver.build }, compat, running: null };
  globalThis.__nyaoHot = hot;
  const pick = store.choose();
  if (pick) {
    try {
      hot.running = pick.build;
      await import(pathToFileURL(path.join(pick.dir, 'src', 'main', 'main.js')).href);
      console.log(`[hot] запущена версия ${pick.build} из обновления`);
    } catch (e) {
      // код обновления упал ещё при загрузке — помечаем плохим и перезапускаемся на установленном
      console.error(`[hot] ${pick.build} не запустилась: ${e && e.stack ? e.stack : e}`);
      store.fail(pick.build);
      app.relaunch();
      app.exit(0);
    }
  }
} catch (e) {
  console.error(`[hot] ${e && e.message}`);
}
if (!hot || hot.running == null) await import('./main/main.js');
