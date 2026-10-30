// Горячие обновления ПК: код приложения (src/**, version.json, package.json) приходит маленьким подписанным
// пакетом и ставится в папку данных, без установщика. Electron и библиотеки (youtubei.js) остаются из установки —
// пакет годится, только если они те же (compat). Подпись Ed25519; открытый ключ — в установленном приложении.
//
// Папка: <userData>/hot/
//   state.json        { current: 89, pending: 89 | null, bad: [88] }
//   89/bundle.nui     пакет как скачан (gzip JSON) — его подпись проверяется при каждом запуске
//   89/bundle.sig     подпись (base64)
//   89/app/...        распакованные файлы: version.json, package.json, src/**
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const FORMAT = 1;

/**
 * Совместимость с установленным приложением: та же сборка Electron и те же версии библиотек.
 * Версии библиотек — фактически установленные (root/node_modules/<имя>/package.json), а не диапазон из package.json:
 * lock-файл может поднять youtubei.js при том же «^18.1.0».
 */
export function compatOf(pkg, root = null) {
  const deps = {};
  for (const [name, range] of Object.entries(pkg.dependencies || {}).sort()) {
    let v = range;
    if (root) {
      try {
        v = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version || range;
      } catch {
        // библиотеки нет на диске — сравниваем по диапазону
      }
    }
    deps[name] = v;
  }
  const key = JSON.stringify({ electron: (pkg.devDependencies && pkg.devDependencies.electron) || '', deps, ...(pkg.nyaoNativeAbi ? { nativeAbi: pkg.nyaoNativeAbi } : {}) });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** Совместимость установленного приложения: src/main/compat.json пишет CI при сборке (там же, где считает пакет) */
export function bundledCompat(root, pkg) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(root, 'src', 'main', 'compat.json'), 'utf8')).compat;
    if (c) return c;
  } catch {
    // сборка без файла (разработка) — считаем сами
  }
  return compatOf(pkg, root);
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Пакет из файлов: { format, name, build, channel, compat, files: { путь: base64 } } → gzip */
export function makeBundle(root, { exclude = [] } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const ver = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const files = {};
  const add = (rel) => {
    if (exclude.some((x) => rel === x || rel.startsWith(x + '/'))) return;
    const abs = path.join(root, rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) for (const n of fs.readdirSync(abs).sort()) add(`${rel}/${n}`);
    else files[rel] = fs.readFileSync(abs).toString('base64');
  };
  add('version.json');
  add('package.json');
  add('src');
  delete files['src/main/compat.json'];
  const data = { format: FORMAT, name: ver.name, build: ver.build, channel: ver.channel || null, compat: compatOf(pkg, root), files };
  return { buf: zlib.gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 }), meta: { name: data.name, build: data.build, channel: data.channel, compat: data.compat, count: Object.keys(files).length } };
}

export function signBundle(buf, privatePem) {
  return crypto.sign(null, buf, crypto.createPrivateKey(privatePem)).toString('base64');
}

export function verifyBundle(buf, sigB64, publicPem) {
  if (!publicPem || !sigB64) return false;
  try {
    return crypto.verify(null, buf, crypto.createPublicKey(publicPem), Buffer.from(String(sigB64).trim(), 'base64'));
  } catch {
    return false;
  }
}

export function readBundle(buf) {
  const data = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  if (!data || data.format !== FORMAT || !Number.isInteger(data.build) || !data.files || typeof data.files !== 'object') throw new Error('пакет не того формата');
  for (const rel of Object.keys(data.files)) {
    // только файлы приложения, без выхода из папки
    if (!/^(version\.json|package\.json|src\/[A-Za-z0-9._@\/-]+)$/.test(rel) || rel.split('/').includes('..')) throw new Error(`странный путь в пакете: ${rel}`);
  }
  return data;
}

export class HotStore {
  /**
   * dir — <userData>/hot; publicPem — открытый ключ из установленного приложения;
   * bundled — { build, compat } установленного приложения
   */
  constructor({ dir, publicPem, bundled }) {
    this.dir = dir;
    this.publicPem = publicPem;
    this.bundled = bundled;
  }

  get enabled() {
    return !!this.publicPem;
  }

  state() {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(this.dir, 'state.json'), 'utf8'));
      return { current: s.current ?? null, pending: s.pending ?? null, bad: Array.isArray(s.bad) ? s.bad : [] };
    } catch {
      return { current: null, pending: null, bad: [] };
    }
  }

  save(s) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, 'state.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, path.join(this.dir, 'state.json'));
  }

  /** Подходит ли пакет этому приложению: подпись, новее установки, тот же Electron и библиотеки, не помечен плохим */
  accept(buf, sig) {
    if (!this.enabled) throw new Error('горячие обновления выключены в этой сборке');
    if (!verifyBundle(buf, sig, this.publicPem)) throw new Error('подпись пакета не сходится');
    const data = readBundle(buf);
    if (data.compat !== this.bundled.compat) throw new Error('нужна полная установка: поменялся Electron или библиотеки');
    if (data.build <= this.bundled.build) throw new Error('пакет не новее установленной версии');
    if (this.state().bad.includes(data.build)) throw new Error('эта версия уже не запустилась — нужна полная установка');
    return data;
  }

  /** Поставить пакет: распаковать во временную папку, затем переименовать — недокачанного «наполовину» не бывает */
  install(buf, sig) {
    const data = this.accept(buf, sig);
    const target = path.join(this.dir, String(data.build));
    const tmp = `${target}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [rel, b64] of Object.entries(data.files)) {
      const abs = path.join(tmp, 'app', rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
    }
    fs.writeFileSync(path.join(tmp, 'bundle.nui'), buf);
    fs.writeFileSync(path.join(tmp, 'bundle.sig'), String(sig).trim());
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    const s = this.state();
    this.save({ ...s, current: data.build });
    return { name: data.name, build: data.build, channel: data.channel };
  }

  /** Проверка при запуске: подпись пакета и то, что распакованные файлы не тронуты. → папка app или null */
  verifyInstalled(build) {
    const base = path.join(this.dir, String(build));
    try {
      const buf = fs.readFileSync(path.join(base, 'bundle.nui'));
      const sig = fs.readFileSync(path.join(base, 'bundle.sig'), 'utf8');
      const data = this.accept(buf, sig);
      if (data.build !== build) return null;
      for (const [rel, b64] of Object.entries(data.files)) {
        const disk = fs.readFileSync(path.join(base, 'app', rel));
        if (sha(disk) !== sha(Buffer.from(b64, 'base64'))) return null;
      }
      return path.join(base, 'app');
    } catch {
      return null;
    }
  }

  /**
   * Что запускать. Прошлый запуск не подтвердил, что всё работает (pending остался) — версия помечается плохой
   * и запускается установленная. → { build, dir } или null (установленная версия)
   */
  choose() {
    if (!this.enabled) return null;
    const s = this.state();
    if (s.pending != null) {
      s.bad = [...new Set([...s.bad, s.pending])];
      if (s.current === s.pending) s.current = null;
      s.pending = null;
      this.save(s);
    }
    if (s.current == null || s.current <= this.bundled.build || s.bad.includes(s.current)) return null;
    const dir = this.verifyInstalled(s.current);
    if (!dir) return null;
    this.save({ ...s, pending: s.current });
    return { build: s.current, dir };
  }

  /** Запуск удался: снимаем «ожидание» и чистим старые папки */
  confirm() {
    const s = this.state();
    if (s.pending == null) return;
    this.save({ ...s, pending: null });
    this.cleanup();
  }

  /** Плохой запуск (упал при загрузке кода) — сразу помечаем */
  fail(build) {
    const s = this.state();
    this.save({ ...s, bad: [...new Set([...s.bad, build])], pending: null, current: s.current === build ? null : s.current });
  }

  cleanup() {
    const keep = String(this.state().current);
    try {
      for (const n of fs.readdirSync(this.dir)) {
        if (n === 'state.json' || n === keep) continue;
        fs.rmSync(path.join(this.dir, n), { recursive: true, force: true });
      }
    } catch {
      // папки ещё нет
    }
  }
}
