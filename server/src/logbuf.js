// Кольцевой буфер последних строк лога сервера — Automator показывает их через GET /admin/logs.
// Перехватывает console.log / warn / error, в консоль всё по-прежнему уходит.

export class LogBuffer {
  constructor(size = 5000) {
    this.size = size;
    this.items = [];
    this.seq = 0;
  }

  push(level, text) {
    const line = { id: ++this.seq, at: Date.now(), level, text: String(text).slice(0, 4000) };
    this.items.push(line);
    if (this.items.length > this.size) this.items.splice(0, this.items.length - this.size);
    return line;
  }

  /** since — id последней уже полученной строки; q — подстрока; level — info | warn | error */
  query({ since = 0, q = '', level = '', limit = 1000 } = {}) {
    const needle = String(q || '').toLowerCase();
    const out = [];
    for (let i = this.items.length - 1; i >= 0 && out.length < limit; i--) {
      const l = this.items[i];
      if (l.id <= since) break;
      if (level && l.level !== level) continue;
      if (needle && !l.text.toLowerCase().includes(needle)) continue;
      out.push(l);
    }
    return out.reverse();
  }

  /** Подменить методы console: строки попадают и в буфер, и в stdout */
  hook(con = console) {
    const fmt = (args) => args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : safeJson(a))).join(' ');
    for (const [name, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
      const orig = con[name].bind(con);
      con[name] = (...args) => {
        this.push(level, fmt(args));
        orig(...args);
      };
    }
    return this;
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
