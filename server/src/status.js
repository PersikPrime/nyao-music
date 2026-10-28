// Статус сервиса: техработы и сбои отдельных музыкальных сервисов.
// Файл status.json пишет Nyao Automator через /admin/status (раньше — workflow «Техработы»); перезапуск сервера не нужен.
import fs from 'node:fs';
import path from 'node:path';

export const SERVICES = new Set(['ya', 'yt', 'sc', 'vk', 'sp']);

export function normalizeStatus(raw) {
  const m = (raw && raw.maintenance) || {};
  const active = !!m.active;
  return {
    maintenance: {
      active,
      title: active ? String(m.title || 'Скоро вернёмся').slice(0, 80) : '',
      text: active ? String(m.text || 'Nyao на техобслуживании — чиним сервер. Как только закончим, музыка вернётся сама.').slice(0, 400) : '',
      until: active ? String(m.until || '').slice(0, 60) : ''
    },
    outages: [...new Set((Array.isArray(raw && raw.outages) ? raw.outages : String((raw && raw.outages) || '').split(/[\s,]+/)).map((s) => String(s).trim().toLowerCase()).filter((s) => SERVICES.has(s)))],
    at: (raw && raw.at) || null
  };
}

export class StatusFile {
  constructor(file, ttlMs = 5000) {
    this.file = file;
    this.ttl = ttlMs;
    this.cache = null;
    this.readAt = 0;
  }

  get() {
    if (this.cache && Date.now() - this.readAt < this.ttl) return this.cache;
    let raw = null;
    try {
      raw = this.file ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null;
    } catch {
      raw = null; // файла нет — всё работает
    }
    this.cache = normalizeStatus(raw);
    this.readAt = Date.now();
    return this.cache;
  }

  /** Записать новый статус (из Automator). Возвращает нормализованный статус */
  set(raw) {
    const next = normalizeStatus({ ...raw, at: new Date().toISOString() });
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next));
      fs.renameSync(tmp, this.file);
    }
    this.cache = next;
    this.readAt = Date.now();
    return next;
  }
}
