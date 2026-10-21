import { randomUUID } from 'node:crypto';

// read/write are synchronous so a completion can remove only its own revision.
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
    for (let n = 0; n < 100 && account && this.account() === account; n++) {
      const item = this.list()[0];
      if (!item) break;
      try { await this.send(item); }
      catch (e) {
        // трек удалён или запрос заведомо неверный — повторять бессмысленно, иначе застрянет вся очередь
        if (![400, 404, 410, 422].includes(e && e.status)) { error = e; break; }
        dropped++;
      }
      this.write(this.read().filter(x => x.revision !== item.revision));
      sent++;
    }
    return { sent, dropped, left: this.list().length, error };
  }
}
