// Локальные страницы дополнений (право «page»): например оверлей для OBS.
// Маленький HTTP-сервер только на 127.0.0.1. Отдаёт файлы из папки page дополнения и поток данных,
// которые дополнение само опубликовало (nyao.page.publish). Больше ничего: ни плеера, ни токенов тут нет.
//   GET /a/<id>/            → index.html из папки page
//   GET /a/<id>/<файл>      → файл из папки page
//   GET /a/<id>/__data      → последние опубликованные данные (JSON)
//   GET /a/<id>/__events    → они же потоком (Server-Sent Events): страница обновляется сама
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const PAGES_PORT = 47840;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };

export class AddonPages {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.server = null;
    this.port = 0;
    this.mounts = new Map(); // id → { dir, data, clients:Set<res> }
  }

  get running() { return !!this.server; }
  url(id) { return this.port ? `http://127.0.0.1:${this.port}/a/${id}/` : ''; }

  async mount(id, dir) {
    this.mounts.set(id, { dir: path.resolve(dir), data: null, clients: new Set() });
    await this.start();
    return this.url(id);
  }

  unmount(id) {
    const m = this.mounts.get(id);
    if (!m) return;
    for (const res of m.clients) res.end();
    this.mounts.delete(id);
    if (!this.mounts.size) this.stop();
  }

  publish(id, data) {
    const m = this.mounts.get(id);
    if (!m) return false;
    const json = JSON.stringify(data ?? null);
    if (json.length > 64 * 1024) throw new Error('слишком много данных для страницы (предел 64 КБ)');
    m.data = json;
    for (const res of m.clients) res.write(`data: ${json}\n\n`);
    return true;
  }

  start() {
    if (this.server) return Promise.resolve(this.port);
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve) => {
      const tryPort = (port, left) => {
        const srv = http.createServer((req, res) => this.handle(req, res));
        srv.once('error', () => (left > 0 ? tryPort(port + 1, left - 1) : resolve(0)));
        srv.listen(port, '127.0.0.1', () => { this.server = srv; this.port = port; this.log(`страницы дополнений: 127.0.0.1:${port}`); resolve(port); });
      };
      tryPort(PAGES_PORT, 9);
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  stop() {
    if (this.server) this.server.close();
    this.server = null;
    this.port = 0;
  }

  handle(req, res) {
    const send = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
    // только этот компьютер и только чтение; защита от подмены DNS — по заголовку Host
    if (req.method !== 'GET') return send(405, 'только GET');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host || ''))) return send(403, 'нет');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { return send(400, 'плохой адрес'); }
    const m = /^\/a\/([a-z0-9.-]+)\/(.*)$/.exec(pathname);
    const mount = m && this.mounts.get(m[1]);
    if (!mount) return send(404, 'нет такой страницы');
    const rest = m[2] || 'index.html';
    if (rest === '__data') return send(200, mount.data || 'null', TYPES['.json']);
    if (rest === '__events') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${mount.data || 'null'}\n\n`);
      mount.clients.add(res);
      req.on('close', () => mount.clients.delete(res));
      return;
    }
    const file = path.resolve(mount.dir, rest);
    if (file !== mount.dir && !file.startsWith(mount.dir + path.sep)) return send(403, 'нет');
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return send(404, 'нет такого файла');
    fs.readFile(file, (err, buf) => (err ? send(404, 'нет такого файла') : send(200, buf, type)));
  }
}
