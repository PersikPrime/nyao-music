// Живые события с сервера Nyao: команды Nyao Connect, «сейчас играет» на других устройствах, «Слушать вместе».
// Держим «длинный» запрос /events: сервер отвечает, как только что-то появилось (или через 25 секунд пустым).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LiveEvents {
  constructor({ cloud, onEvent, log = () => {}, idleMs = 10_000 }) {
    this.cloud = cloud;
    this.onEvent = onEvent;
    this.log = log;
    this.idleMs = idleMs;
    this.cursor = 0;
    this.running = false;
    this.fails = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
  }

  /** Один круг опроса; вынесен отдельно, чтобы проверять без бесконечного цикла */
  async tick() {
    if (!this.cloud.loggedIn) {
      this.cursor = 0;
      await sleep(this.idleMs);
      return;
    }
    try {
      const r = await this.cloud.request('GET', `/events?cursor=${this.cursor}`);
      this.fails = 0;
      if (r && Number.isFinite(r.cursor)) this.cursor = r.cursor;
      for (const e of (r && r.events) || []) {
        try {
          this.onEvent(e);
        } catch (err) {
          this.log(`[live] ${err.message}`);
        }
      }
    } catch (e) {
      this.fails++;
      if (e.status === 426) await sleep(10 * 60_000);
      else await sleep(Math.min(30_000, 2000 * this.fails));
    }
  }

  async loop() {
    while (this.running) await this.tick();
  }
}
