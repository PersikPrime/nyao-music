import { randomUUID } from 'node:crypto';

// read/write are synchronous so a completion can remove only its own revision.
const MAX_TRIES = 5;
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
export class PendingLikes {
  constructor({ read, write, account, send }) { Object.assign(this, { read, write, account, send }); this.running = null; }
  list() { return this.read().filter(x => x.account && x.account === this.account()); }
  enqueue(track, on) {
    const account = this.account();
    if (!account) throw new Error('Нужен вход в SoundCloud');
    const item = { account, srcId: String(track.srcId), title: track.title, on: !!on, at: Date.now(), revision: randomUUID() };
    this.write([...this.read().filter(x => !(x.account === account && x.srcId === item.srcId)), item]);
    return item;
  }
  flush() {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  async drain() {
    const account = this.account();
    let sent = 0, dropped = 0, error = null;
    const skip = new Set(); // не прошли в этот раз — повторим в следующий, но остальные не ждут
    for (let n = 0; n < 100 && account && this.account() === account; n++) {
      const item = this.list().find(x => !skip.has(x.revision));
      if (!item) break;
      try { await this.send(item); }
      catch (e) {
        const status = e && e.status;
        if ([400, 404, 410, 422].includes(status)) {
          // трек удалён или запрос заведомо неверный — повторять бессмысленно
          dropped++;
        } else if (status === 403) {
          // отказ по одному треку: пропускаем его, после 5 попыток или двух недель — выбрасываем
          const tries = (item.tries || 0) + 1;
          if (tries >= MAX_TRIES || Date.now() - (item.at || 0) > MAX_AGE) dropped++;
          else {
            this.write(this.read().map(x => (x.revision === item.revision ? { ...x, tries } : x)));
            skip.add(item.revision);
            error = e;
            continue;
          }
        } else {
          // сеть, вход, лимит запросов — общая проблема: остановимся и попробуем позже
          error = e;
          break;
        }
      }
      this.write(this.read().filter(x => x.revision !== item.revision));
      sent++;
    }
    return { sent, dropped, left: this.list().length, error };
  }
}
